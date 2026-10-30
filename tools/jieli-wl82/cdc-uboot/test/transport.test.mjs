import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import { inspectTrackerCdc,createCdcUbootTransport,createCdcBootVerifier,validateCdcSource } from '../transport.mjs';
import { baseline,app,BUILD } from './fixtures.mjs';
import { planApplication } from '../policy.mjs';

const source = {identity:'MOD-EDITOR/1',transport:'cdc',build_sha256:BUILD,location_sha256:'b'.repeat(64),instance_sha256:'c'.repeat(64),nonceVerified:true};
function fakeWorker({mutate = x => x,failInstall = false,hangClose = false} = {}) {
  const child = new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.emit('exit',1);};
  const seen=[];const base=baseline(app(4096));const application=app(8192,9),plan=planApplication(base,application,BUILD);
  child.stdin=new Writable({write(bytes,encoding,done){
    const request=JSON.parse(bytes.toString());seen.push(request);
    let data;
    if(request.application)data={ready:true,session_id:'a'.repeat(32)};
    else if(request.op==='prepare')data={baseline_base64:Buffer.from(base).toString('base64'),baseline_sha256:plan.baseline_sha256,candidate_sha256:plan.candidate_sha256,sectors:plan.sectors,worker_receipt_sha256:'d'.repeat(64)};
    else if(request.op==='install'&&failInstall){queueMicrotask(()=>child.stdout.write(JSON.stringify({ok:false,code:'cdc_operation_stopped'})+'\n'));done();return;}
    else if(['install','recover'].includes(request.op))data={candidate_sha256:plan.candidate_sha256,readback_verified:true,mutation_attempts:17*plan.sectors.length};
    else if(request.op==='close')data={closed:true,worker_stopped:!hangClose};
    else if(request.op==='reset')data={reset_requested:true,worker_stopped:true};
    queueMicrotask(()=>child.stdout.write(JSON.stringify({ok:true,data:mutate(data,request)})+'\n'));done();
  }});
  return {child,seen,base,application,plan};
}
test('fixed inspector accepts fresh nonce only and exposes opaque unit hashes',async()=>{
  const proof=await inspectTrackerCdc({platform:'win32',random:()=>Buffer.alloc(16,3),run:async(exe,args,options)=>{
    assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.deepEqual(args.slice(-3),['-Inspect','-Nonce','03'.repeat(16)]);
    return {stdout:JSON.stringify({...source,nonce:'03'.repeat(16),port:'never-publish'})};
  }});
  assert.deepEqual(proof,source);assert.equal(Object.hasOwn(proof,'port'),false);
  await assert.rejects(inspectTrackerCdc({platform:'linux'}),{code:'unsupported_transport'});
  await assert.rejects(inspectTrackerCdc({platform:'win32',random:()=>Buffer.alloc(16,3),run:async()=>({stdout:JSON.stringify({...source,nonce:'04'.repeat(16)})})}),{code:'cdc_identity_mismatch'});
  assert.throws(()=>validateCdcSource({...source,nonceVerified:false}));
});
test('owned worker checks independent plan, binds original scope and proves close/reset',async()=>{
  const fake=fakeWorker();const session=await createCdcUbootTransport({application:fake.application,targetBuildSha256:BUILD,source,platform:'win32',spawnChild:(exe,args,options)=>{assert.equal(options.windowsHide,true);assert.equal(options.shell,false);return fake.child;}});
  const prepared=await session.prepare();assert.deepEqual(prepared.baseline,fake.base);
  await assert.rejects(session.install({plan:{...fake.plan,candidate_sha256:'f'.repeat(64)}}),{code:'review_changed'});
  assert.equal(fake.seen.length,2);
  await session.install({plan:fake.plan});await session.resetVerified();await session.close();
  assert.deepEqual(fake.seen.slice(1).map(x=>x.op),['prepare','install','reset']);
});
test('partial operation stops without retry and allows only explicit original-scope recovery',async()=>{
  const fake=fakeWorker({failInstall:true});const session=await createCdcUbootTransport({application:fake.application,targetBuildSha256:BUILD,source,platform:'win32',spawnChild:()=>fake.child});
  await session.prepare();await assert.rejects(session.install({plan:fake.plan}),{code:'cdc_operation_stopped'});
  assert.equal(fake.seen.filter(x=>x.op==='install').length,1);assert.equal(fake.seen.some(x=>x.op==='reset'),false);
  await session.install({plan:fake.plan,recover:true});await session.close();
});
test('changed worker receipt and unproven privileged shutdown fail closed',async()=>{
  const fake=fakeWorker({mutate:(data,request)=>request.op==='prepare'?{...data,sectors:[0]}:data});
  const session=await createCdcUbootTransport({application:fake.application,targetBuildSha256:BUILD,source,platform:'win32',spawnChild:()=>fake.child});
  await assert.rejects(session.prepare(),{code:'worker_plan_mismatch'});await session.close();
  const other=fakeWorker({hangClose:true});const held=await createCdcUbootTransport({application:other.application,targetBuildSha256:BUILD,source,platform:'win32',spawnChild:()=>other.child});
  await assert.rejects(held.close(),{code:'worker_shutdown_unproven'});
});
test('final boot proof requires target build at the original USB location',async()=>{
  const verify=createCdcBootVerifier({platform:'win32',inspect:async()=>source});
  assert.equal((await verify({buildSha256:BUILD,source})).nonceVerified,true);
  await assert.rejects(verify({buildSha256:'e'.repeat(64),source}),{code:'boot_build_mismatch'});
  const wrong=createCdcBootVerifier({platform:'win32',inspect:async()=>({...source,location_sha256:'f'.repeat(64)})});
  await assert.rejects(wrong({buildSha256:BUILD,source}),{code:'device_changed'});
});
test('privileged bridge freezes executable payload, restricts IPC peers and forbids arbitrary operations',async()=>{
  const relay=await fs.readFile(new URL('../windows-cdc-relay.ps1',import.meta.url),'utf8'),server=await fs.readFile(new URL('../windows-cdc-server.ps1',import.meta.url),'utf8');
  for(const marker of ['frozen_hash_changed','frozen_length_changed','-WindowStyle Hidden','-Verb RunAs','Fm1RelayPeer]::Server'])assert.ok(relay.includes(marker));
  for(const marker of ['O:BAG:BAD:P','Fm1PipePeer]::Client','WriteThrough','Flush($true)','client_start_ticks','Enter-Fm1Loader','preparation-intent.json'])assert.ok(server.includes(marker));
  assert.ok(!server.includes('Invoke-Expression'));assert.ok(!server.includes('chip_key'));
});
test('Windows physical binding selects one PCI alias and read-only challenge tolerates host-open settling',{skip:process.platform!=='win32'},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fm1-cdc-contract-')),script=path.join(dir,'contract.ps1');
  t.after(async()=>{await fs.unlink(script);await fs.rmdir(dir);});
  await fs.writeFile(script,`param([string]$Source)
$ErrorActionPreference='Stop'
. $Source
function Get-PnpDeviceProperty {param($InstanceId,$KeyName,$ErrorAction) return @{Data=@('ACPI(_SB_)#USB(1)','PCIROOT(0)#PCI(1400)#USBROOT(0)#USB(1)')}}
$h=Get-Fm1Location 'USB\\VID_3654&PID_5155\\UNIT'
if($h -cnotmatch '^[0-9a-f]{64}$'){throw 'location'}
$script:reads=0;$script:writes=0
function Read-Fm1Until {param($Port,$Pattern,$TimeoutMs) $script:reads++;if($script:reads -eq 1){throw 'serial_timeout'};return ('FM1FW/1 MOD-EDITOR/1 '+('a'*64)+' '+('b'*32))}
$p=[pscustomobject]@{};$p|Add-Member -MemberType ScriptMethod -Name Write -Value {param($Text) if($Text -cne ('FWINFO '+('b'*32)+[char]10)){throw 'command'};$script:writes++}
$proof=Get-Fm1Proof $p @{location_sha256=$h;instance_sha256=('c'*64)} ('b'*32)
if($script:reads -ne 2 -or $script:writes -ne 2 -or $proof.build_sha256 -cne ('a'*64)){throw 'challenge'}
function Get-PnpDeviceProperty {param($InstanceId,$KeyName,$ErrorAction) return @{Data=@('PCIROOT(0)#USB(1)','PCIROOT(0)#USB(2)')}}
$rejected=$false;try{Get-Fm1Location 'USB\\VID_3654&PID_5155\\UNIT'}catch{$rejected=$true};if(-not $rejected){throw 'ambiguity'}
Write-Output 'physical-binding-and-read-only-settling-ok'
`);
  const out=execFileSync(path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-Source',fileURLToPath(new URL('../windows-cdc-link.ps1',import.meta.url))],{windowsHide:true,encoding:'utf8',timeout:15000});
  assert.match(out,/physical-binding-and-read-only-settling-ok/);
});
