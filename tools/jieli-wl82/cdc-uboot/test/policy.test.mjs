import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inspectBaseline, planApplication, validateCandidate, crc16 } from '../policy.mjs';
import { app, baseline, BUILD, APP_START, APP_END, APP_CAPACITY } from './fixtures.mjs';
import { buildCustomFwsc, customPackageFormat as f, extractTrackerApplication } from '../../stock-sysex/custom-package.mjs';

test('live V15 planning preserves every non-application byte and supports same-image zero-change return',()=>{
 const original=app(),base=baseline(original),info=inspectBaseline(base);
 assert.equal(info.application_capacity,581564);assert.equal(info.configuration_offset,0x920dc);assert.equal(info.vm_offset,0x93000);assert.equal(Object.hasOwn(info,'key'),false);
 const same=planApplication(base,original,BUILD);assert.equal(same.no_changes,true);assert.deepEqual(same.sectors,[]);assert.deepEqual(same.candidate,base);
 const next=app(APP_CAPACITY,7),planned=planApplication(base,next,BUILD);assert.equal(planned.sectors.at(-1),0x4000);assert.equal(planned.sectors.includes(0x92000),true);assert.equal(planned.no_changes,false);
 assert.deepEqual(planned.candidate.subarray(0,0x4000),base.subarray(0,0x4000));assert.deepEqual(planned.candidate.subarray(0x4040,APP_START),base.subarray(0x4040,APP_START));
 assert.deepEqual(planned.candidate.subarray(APP_END),base.subarray(APP_END));assert.equal(validateCandidate(base,planned.candidate,next,BUILD),true);
 assert.equal(inspectBaseline(planned.candidate).application_bytes,APP_CAPACITY);
 assert.deepEqual(base,baseline(original));
});
test('shorter replacement preserves unused tail including partial final cipher block',()=>{
 const base=baseline(app(65536)),next=app(65,4),plan=planApplication(base,next,BUILD);
 assert.deepEqual(plan.candidate.subarray(APP_START+next.length),base.subarray(APP_START+next.length));
 assert.equal(validateCandidate(base,plan.candidate,next,BUILD),true);
});
test('invalid baselines payloads V14 layout protected changes and target identity fail closed',()=>{
 const base=baseline(),next=app(8192,17),plan=planApplication(base,next,BUILD);
 for(const at of [0,32,14544,0x4000,0x4040,APP_START,APP_END]){const bad=base.slice();bad[at]^=1;assert.throws(()=>inspectBaseline(bad));}
 for(const at of [0,0x4000,0x4040,APP_START+next.length,APP_END,0x93000,0xff010]){const bad=plan.candidate.slice();bad[at]^=1;assert.throws(()=>validateCandidate(base,bad,next,BUILD));}
 assert.throws(()=>planApplication(base,app(APP_CAPACITY+1),BUILD));assert.throws(()=>planApplication(base,next,'0'.repeat(64)));assert.throws(()=>planApplication(base,next,'a'.repeat(64)));
 assert.throws(()=>inspectBaseline(base.subarray(0,base.length-1)));
 // Changing the synthetic cfg entry to V14's offset, with valid header CRC,
 // must still reject the fixed layout (rather than accepting CRCs alone).
 const bad=base.slice();const crypt=(bytes,key)=>{const b=bytes.slice();for(let i=0;i<b.length;i++){b[i]^=key&255;key=((key<<1)^(key&0x8000?0x1021:0))&65535;}return b;};
 const at=0x4040,b=crypt(bad.subarray(at,at+32),0x1234^((at-0x4000)>>>2)),v=new DataView(b.buffer);v.setUint32(4,0x92e1c-0x4000,true);v.setUint16(0,crc16(b.subarray(2)),true);bad.set(crypt(b,0x1234^((at-0x4000)>>>2)),at);assert.throws(()=>inspectBaseline(bad));
});

test('independent privileged C# policy matches full candidate and rejects altered preserved bytes',{skip:process.platform!=='win32'},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fm1-v15-vectors-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const base=baseline(app(65536)),application=app(APP_CAPACITY,19),plan=planApplication(base,application,BUILD);
 await fs.writeFile(path.join(dir,'baseline.bin'),base);await fs.writeFile(path.join(dir,'application.bin'),application);await fs.writeFile(path.join(dir,'candidate.bin'),plan.candidate);
 const script=path.join(dir,'check.ps1');await fs.writeFile(script,`param([string]$Source,[string]$Root,[string]$Build)
$ErrorActionPreference='Stop'
Add-Type -Path $Source
$b=[IO.File]::ReadAllBytes((Join-Path $Root 'baseline.bin'));$a=[IO.File]::ReadAllBytes((Join-Path $Root 'application.bin'));$c=[IO.File]::ReadAllBytes((Join-Path $Root 'candidate.bin'))
$p=[FlashPolicy]::Plan($b,$a,$Build)
if(-not [FlashPolicy]::ValidateCandidate($b,$c,$a,$Build)){throw 'candidate'}
$c[0x920dc]=$c[0x920dc] -bxor 1;$rejected=$false
try{[void][FlashPolicy]::ValidateCandidate($b,$c,$a,$Build)}catch{$rejected=$true}
if(-not $rejected){throw 'preserved bytes accepted'}
@{baseline=$p.BaselineSha256;candidate=$p.CandidateSha256;application=$p.ApplicationSha256;build=$p.TargetBuildSha256;sectors=@($p.Sectors);bytes_equal=[Linq.Enumerable]::SequenceEqual([byte[]]$p.Candidate,[byte[]][IO.File]::ReadAllBytes((Join-Path $Root 'candidate.bin')))}|ConvertTo-Json -Compress
`);
 const out=execFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-Source',fileURLToPath(new URL('../FlashPolicy.cs',import.meta.url)),'-Root',dir,'-Build',BUILD],{encoding:'utf8',timeout:30000,windowsHide:true});
 const actual=JSON.parse(out.replace(/^\uFEFF/,''));assert.equal(actual.candidate,plan.candidate_sha256);assert.equal(actual.baseline,plan.baseline_sha256);assert.equal(actual.application,plan.application_sha256);assert.equal(actual.build,BUILD);assert.deepEqual(actual.sectors,plan.sectors);assert.equal(actual.bytes_equal,true);
});

test('public V15 template yields a baseline-derived plan and closed tracker application extraction',{skip:!process.env.FM1_PUBLIC_V15_FWSC},async()=>{
 const stock=await fs.readFile(process.env.FM1_PUBLIC_V15_FWSC),flash=f.parseUfw(f.unwrapFwsc(stock,'FM-1_015'),{verifyPayloadCrc:false}).entries.find(e=>e.name==='flash.bin').data;
 const base=new Uint8Array(0x100000).fill(0x73);base.set(flash);assert.equal(inspectBaseline(base).application_bytes,APP_CAPACITY);
 const application=app(511760),{raw,manifest}=await buildCustomFwsc({stockPackage:stock,application,targetBuildSha256:BUILD,profile:'protracker'}),extracted=await extractTrackerApplication(raw,manifest);
 assert.deepEqual(extracted.application,application);assert.equal(extracted.metadata.profile,'protracker');
 const plan=planApplication(base,application,BUILD);assert.deepEqual(plan.candidate.subarray(0,flash.length),f.parseUfw(f.unwrapFwsc(raw,'FM1_FORGE_001')).entries[0].data);
 const diag=await buildCustomFwsc({stockPackage:stock,application,targetBuildSha256:BUILD,profile:'forge-diag'});await assert.rejects(extractTrackerApplication(diag.raw,diag.manifest));
 const tampered=raw.slice();tampered[1000]^=1;await assert.rejects(extractTrackerApplication(tampered,manifest));
});
