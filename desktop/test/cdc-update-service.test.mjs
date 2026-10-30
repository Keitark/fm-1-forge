import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createCdcUpdateService, MAX_CDC_CHUNK_BYTES } from '../lib/cdc-update-service.mjs';
import { CdcAttemptJournal, cdcRequestIdentity, assertOtherFamilyResolved } from '../../tools/jieli-wl82/stock-sysex/custom-journal.mjs';
import { StockError, STOCK } from '../../tools/jieli-wl82/stock-sysex/protocol.mjs';
import { planApplication } from '../../tools/jieli-wl82/cdc-uboot/policy.mjs';
import { baseline, app, BUILD } from '../../tools/jieli-wl82/cdc-uboot/test/fixtures.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex'),raw=Buffer.alloc(623156,42),application=app(4097,13);
const source={identity:'MOD-EDITOR/1',transport:'cdc',build_sha256:'a'.repeat(64),location_sha256:'b'.repeat(64),instance_sha256:'c'.repeat(64),nonceVerified:true};
const manifest={schemaVersion:1,policy_version:'customfwsc-v1',package_sha256:sha(raw),logical_sha256:'d'.repeat(64),raw_bytes:raw.length,logical_bytes:raw.length-20,target_build_sha256:BUILD,expected_boot_identity:'MOD-EDITOR/1',family:9,profile:'protracker',source_stock_sha256:STOCK.sha256,ota_sha256:'ef1f2db89b011fa53e71df363f0122de0ea896618c53fb53e8da676322004541',application_sha256:sha(application),application_bytes:application.length,preservation:'public-v15-fixed-layout-app-only',hardware_qualified:false,stock_tail_proof:{block_bytes:32,mutable_blocks:129,boundary_prefix_hex:'00',prefix_hashes:['1'.repeat(64)]}};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const error=code=>new StockError(code,'Synthetic transport fault.');
async function fixture(t,options={}){
  const directory=options.directory??await fs.mkdtemp(path.join(os.tmpdir(),'fm1-cdc-service-'));
  let factoryCalls=0,installCalls=[],resetCalls=0,closeCalls=0,leaseReleased=0,retained=0,verifyCalls=0,time=Date.now(),generation=0,latestPlan;
  const calls=[],liveBaseline=options.baseline??baseline(),worker={
    async prepare(){calls.push('prepare');if(options.prepare)return options.prepare();latestPlan=planApplication(liveBaseline,application,BUILD);return {baseline:Uint8Array.from(liveBaseline),...latestPlan,worker_receipt_sha256:'e'.repeat(64)};},
    async install(input){installCalls.push(input);if(options.install)return options.install(input,installCalls.length);return {candidate_sha256:input.plan.candidate_sha256,readback_verified:true,mutation_attempts:input.plan.no_changes?0:1};},
    async resetVerified(){resetCalls++;return options.reset?await options.reset():{reset_requested:true,worker_stopped:true};},
    async close(){closeCalls++;if(options.workerClose)await options.workerClose();},
  };
  const deviceService={async reviewCdcEndpoint(){calls.push('review');return {kind:'cdc-uboot',token:String(generation),generation,source:{...source}};},
    async acquireCdcWriter(reviewed){calls.push('lease');if(reviewed.token!==String(generation))throw error('device_changed');return {source:{...source},retain(){retained++;},async release(){leaseReleased++;}};},
    async acquireCdcObservation(){calls.push('observe-lease');return {async release(){leaseReleased++;}};}};
  const service=await createCdcUpdateService({directory,deviceService,clock:{now:()=>time},packageExtractor:async(bytes,value)=>{calls.push('extract');if(sha(bytes)!==value.package_sha256)throw error('invalid_package');return {application:Uint8Array.from(application)};},
    trackerVerifier:async input=>{verifyCalls++;calls.push({verify:input});if(options.verify)return options.verify(input,verifyCalls);return {text:'MOD-EDITOR/1',buildSha256:BUILD,transport:'cdc',nonceVerified:true};},
    transportFactory:async input=>{factoryCalls++;calls.push({factory:input});if(options.factory)return options.factory(input);return worker;},...options.service});
  t.after(async()=>{await service.close().catch(()=>{});if(!options.directory){assert.ok(path.basename(directory).startsWith('fm1-cdc-service-'));await fs.rm(directory,{recursive:true,force:true});}});
  return {service,directory,calls,worker,advance:ms=>{time+=ms;},changeDevice:()=>{generation++;},get factoryCalls(){return factoryCalls;},get installCalls(){return installCalls;},get resetCalls(){return resetCalls;},get closeCalls(){return closeCalls;},get released(){return leaseReleased;},get retained(){return retained;},get verifies(){return verifyCalls;},get plan(){return latestPlan;}};
}
async function selected(f){const begun=await f.service.beginUpload({raw_bytes:raw.length,manifest});for(let offset=0;offset<raw.length;offset+=MAX_CDC_CHUNK_BYTES)await f.service.appendUpload({upload_id:begun.upload_id,offset,data_base64:raw.subarray(offset,offset+MAX_CDC_CHUNK_BYTES).toString('base64')});return (await f.service.review({upload_id:begun.upload_id})).review;}
async function idle(f){for(let count=0;count<600;count++){const result=await f.service.status();if(!result.writing)return result;await new Promise(done=>setTimeout(done,5));}assert.fail('Synthetic CDC operation did not settle.');}
async function prepared(f){const review=await selected(f);await f.service.prepare({review_id:review.review_id,confirmed:true});return idle(f);}
async function installed(f){const ready=await prepared(f),review=(await f.service.reviewInstall({job_id:ready.attempt.job_id})).review;await f.service.start({review_id:review.review_id,confirmed:true});return idle(f);}

test('CDC construction and status are passive; strict bounded uploads reject unexpected fields and chunks',async t=>{
  const f=await fixture(t);assert.deepEqual(await f.service.status(),{supported:true,writing:false,attempt:null,review:null});assert.deepEqual(f.calls,[]);
  await assert.rejects(f.service.beginUpload({raw_bytes:raw.length,manifest,path:'C:/arbitrary'}));
  await assert.rejects(f.service.beginUpload({raw_bytes:raw.length,manifest:{...manifest,profile:'forge-diag',family:8,expected_boot_identity:'FM1_FORGE_001'}}));
  const begun=await f.service.beginUpload({raw_bytes:raw.length,manifest});
  for(const value of [{offset:1,data_base64:'Kg=='},{offset:0,data_base64:'Kh=='},{offset:0,data_base64:'A'.repeat(90000)}])await assert.rejects(f.service.appendUpload({upload_id:begun.upload_id,...value}));
  assert.equal(f.factoryCalls,0);assert.deepEqual(f.calls,[]);
});
test('review proves only the source and original package; preparation requires unexpired explicit confirmation',async t=>{
  const f=await fixture(t),review=await selected(f);assert.equal(review.operation,'prepare');assert.equal(review.source_build_sha256,source.build_sha256);assert.equal(review.target_build_sha256,BUILD);assert.equal(f.factoryCalls,0);
  await assert.rejects(f.service.prepare({review_id:review.review_id,confirmed:false}),{code:'review_required'});f.advance(120001);
  await assert.rejects(f.service.prepare({review_id:review.review_id,confirmed:true}),{code:'review_expired'});assert.equal(f.factoryCalls,0);
  const second=await selected(f);f.changeDevice();await assert.rejects(f.service.prepare({review_id:second.review_id,confirmed:true}),{code:'device_changed'});assert.equal(f.factoryCalls,0);
});
test('preparation retains the lease, records an independent live plan and never installs or resets automatically',async t=>{
  const f=await fixture(t),result=await prepared(f);assert.equal(result.attempt.state,'prepared');assert.equal(result.attempt.phase,'awaiting_install');assert.equal(result.attempt.readback_verified,false);assert.equal(result.attempt.boot_build_verified,false);
  assert.equal(result.attempt.baseline_sha256,f.plan.baseline_sha256);assert.equal(result.attempt.candidate_sha256,f.plan.candidate_sha256);assert.deepEqual(result.attempt.sectors,f.plan.sectors);
  assert.equal(f.installCalls.length,0);assert.equal(f.resetCalls,0);assert.equal(f.released,0);
  for(const kind of ['stock','custom-fwsc'])await assert.rejects(assertOtherFamilyResolved(f.directory,kind),{code:'recovery_required'});
  await assert.rejects(f.service.beginUpload({raw_bytes:raw.length,manifest}),{code:'recovery_required'});
});
test('an explicitly reviewed install verifies the exact image, resets once and proves target build and source location',async t=>{
  const f=await fixture(t),result=await installed(f);assert.equal(result.attempt.state,'succeeded');assert.equal(result.attempt.transfer_finished,true);assert.equal(result.attempt.readback_verified,true);assert.equal(result.attempt.boot_identity_verified,true);assert.equal(result.attempt.boot_build_verified,true);
  assert.equal(f.installCalls.length,1);assert.equal(f.installCalls[0].recover,false);assert.equal(f.resetCalls,1);assert.equal(f.verifies,1);assert.equal(f.released,1);
  assert.deepEqual(f.calls.find(value=>value.verify).verify.source,source);await assertOtherFamilyResolved(f.directory,'stock');
});
test('a no-change live plan still needs Install confirmation and returns with zero application mutations',async t=>{
  const f=await fixture(t,{baseline:baseline(application)}),ready=await prepared(f);assert.equal(ready.attempt.no_changes,true);assert.deepEqual(ready.attempt.sectors,[]);assert.equal(f.resetCalls,0);
  const review=(await f.service.reviewInstall({job_id:ready.attempt.job_id})).review;assert.equal(review.no_changes,true);await f.service.start({review_id:review.review_id,confirmed:true});const result=await idle(f);
  assert.equal(result.attempt.state,'succeeded');assert.equal(f.installCalls.length,1);assert.equal(f.resetCalls,1);
});
test('original package, manifest, baseline and effective candidate corruption cannot reach programming',async t=>{
  for(const asset of ['package','manifest','baseline','candidate']){
    const f=await fixture(t),ready=await prepared(f),job=ready.attempt.job_id;
    const file=asset==='package'?path.join(f.directory,'cdc-update/packages',manifest.package_sha256+'.fwsc'):asset==='manifest'?path.join(f.directory,'cdc-update/packages',ready.attempt.manifest_sha256+'.json'):path.join(f.directory,'cdc-update/jobs',job,asset+'.bin');
    const data=await fs.readFile(file);data[data.length-1]^=1;await fs.writeFile(file,data);
    await assert.rejects(f.service.reviewInstall({job_id:job}));assert.equal(f.installCalls.length,0);assert.equal(f.resetCalls,0);
  }
});
test('failed programming never retries or resets; recovery reuses exactly the original live session and plan',async t=>{
  const f=await fixture(t,{install:async(input,count)=>{if(count===1)throw error('cdc_operation_stopped');return {candidate_sha256:input.plan.candidate_sha256,readback_verified:true,mutation_attempts:2};}}),ready=await prepared(f),job=ready.attempt.job_id;
  const review=(await f.service.reviewInstall({job_id:job})).review;await f.service.start({review_id:review.review_id,confirmed:true});let result=await idle(f);
  assert.equal(result.attempt.state,'unknown');assert.equal(f.installCalls.length,1);assert.equal(f.resetCalls,0);await f.service.status();assert.equal(f.installCalls.length,1);
  await assert.rejects(f.service.reviewRecovery({job_id:'0'.repeat(32)}));const recovery=(await f.service.reviewRecovery({job_id:job})).review;assert.equal(recovery.candidate_sha256,ready.attempt.candidate_sha256);
  await f.service.start({review_id:recovery.review_id,confirmed:true});result=await idle(f);assert.equal(result.attempt.state,'succeeded');assert.equal(f.factoryCalls,1);assert.equal(f.installCalls[1].recover,true);assert.equal(f.installCalls[0].plan.candidate_sha256,f.installCalls[1].plan.candidate_sha256);
});
test('failed or incomplete readback cannot reset or claim completion',async t=>{
  for(const result of [{readback_verified:false,candidate_sha256:'1'.repeat(64),mutation_attempts:1},{readback_verified:true,candidate_sha256:'1'.repeat(64),mutation_attempts:1}]){
    const f=await fixture(t,{install:async()=>result}),receipt=await installed(f);assert.equal(receipt.attempt.state,'unknown');assert.equal(receipt.attempt.transfer_finished,false);assert.equal(receipt.attempt.readback_verified,false);assert.equal(f.resetCalls,0);assert.equal(f.verifies,0);
  }
});
test('boot-only retry never reprograms or resets and retains the completed original plan',async t=>{
  const f=await fixture(t,{verify:async(_input,count)=>{if(count===1)throw error('reboot_timeout');return {text:'MOD-EDITOR/1',buildSha256:BUILD,transport:'cdc',nonceVerified:true};}}),pending=await installed(f),job=pending.attempt.job_id;
  assert.equal(pending.attempt.state,'unknown');assert.equal(pending.attempt.transfer_finished,true);assert.equal(pending.attempt.readback_verified,true);
  await assert.rejects(f.service.reviewRecovery({job_id:job}));await f.service.verifyBoot({job_id:job});const proved=await idle(f);assert.equal(proved.attempt.state,'succeeded');assert.equal(f.installCalls.length,1);assert.equal(f.resetCalls,1);assert.equal(f.verifies,2);
});
test('reopened preparation cannot create a new worker or discard its original lost-session handoff',async t=>{
  const f=await fixture(t),ready=await prepared(f),job=ready.attempt.job_id;await f.service.close();
  const reopened=await fixture(t,{directory:f.directory});const result=await reopened.service.status();assert.equal(result.attempt.job_id,job);assert.equal(result.attempt.state,'unknown');assert.equal(result.attempt.recovery_available,false);
  await assert.rejects(reopened.service.reviewRecovery({job_id:job}),{code:'recovery_session_lost'});await assert.rejects(reopened.service.reviewInstall({job_id:job}),{code:'recovery_session_lost'});assert.equal(reopened.factoryCalls,0);
});
test('factory and worker-close uncertainty retain the original device lease and recovery evidence',async t=>{
  const f=await fixture(t,{factory:async()=>{throw error('worker_start_timeout');}}),review=await selected(f);await f.service.prepare({review_id:review.review_id,confirmed:true});const result=await idle(f);
  assert.equal(result.attempt.state,'unknown');assert.equal(f.released,0);assert.ok(f.retained>0);await assert.rejects(f.service.close(),{code:'worker_shutdown_unproven'});assert.equal(f.released,0);
  const close=await fixture(t,{workerClose:async()=>{throw error('worker_shutdown_unproven');}});await prepared(close);await assert.rejects(close.service.close(),{code:'worker_shutdown_unproven'});assert.equal(close.released,0);assert.ok(close.retained>0);
});
test('shutdown during delayed boot proof preserves unknown and ignores a late valid result',async t=>{
  const gate=deferred();let entered=false;const f=await fixture(t,{verify:async()=>{entered=true;return gate.promise;}}),ready=await prepared(f),review=(await f.service.reviewInstall({job_id:ready.attempt.job_id})).review;
  await f.service.start({review_id:review.review_id,confirmed:true});while(!entered)await new Promise(done=>setTimeout(done,2));const closing=f.service.close();gate.resolve({text:'MOD-EDITOR/1',buildSha256:BUILD,transport:'cdc',nonceVerified:true});await closing;
  const saved=JSON.parse(await fs.readFile(path.join(f.directory,'cdc-update/attempt/attempt.json'),'utf8'));assert.equal(saved.state,'unknown');assert.equal(saved.boot_build_verified,false);assert.equal(saved.error_code,'service_closed');
});
test('third-route orphan locks and changed immutable request digests fail closed for every peer',async t=>{
  const f=await fixture(t),attemptRoot=path.join(f.directory,'cdc-update/attempt');await fs.writeFile(path.join(attemptRoot,'worker.lock'),JSON.stringify({schema:1,pid:process.pid}));
  for(const kind of ['stock','custom-fwsc'])await assert.rejects(assertOtherFamilyResolved(f.directory,kind),{code:'corrupt_journal'});
  await fs.unlink(path.join(attemptRoot,'worker.lock'));const ready=await prepared(f),record=JSON.parse(await fs.readFile(path.join(attemptRoot,'attempt.json'),'utf8'));
  await assert.rejects(CdcAttemptJournal.open(attemptRoot,cdcRequestIdentity({...record.request,jobId:'0'.repeat(32)}),{resume:true}),{code:'worker_busy'});
  record.request.targetBuildSha256='f'.repeat(64);await fs.writeFile(path.join(attemptRoot,'attempt.json'),JSON.stringify(record));
  for(const kind of ['stock','custom-fwsc'])await assert.rejects(assertOtherFamilyResolved(f.directory,kind),{code:'corrupt_journal'});
  assert.equal(f.installCalls.length,0);assert.ok(ready.attempt.job_id);
});

test('lost-session boot verification requires the durable verified-reset worker-stop receipt',async t=>{
  const f=await fixture(t,{reset:async()=>{throw error('reset_outcome_unknown');}}),pending=await installed(f),job=pending.attempt.job_id;
  assert.equal(pending.attempt.state,'unknown');assert.equal(pending.attempt.transfer_finished,true);assert.equal(f.verifies,0);await f.service.close();
  const reopened=await fixture(t,{directory:f.directory});await assert.rejects(reopened.service.verifyBoot({job_id:job}),{code:'recovery_session_lost'});assert.equal(reopened.verifies,0);assert.equal(reopened.factoryCalls,0);
});

test('a valid live boot proof cannot mark success while its original worker shutdown remains unproven',async t=>{
  const f=await fixture(t,{reset:async()=>{throw error('reset_outcome_unknown');},workerClose:async()=>{throw error('worker_shutdown_unproven');}}),pending=await installed(f);
  await f.service.verifyBoot({job_id:pending.attempt.job_id});const result=await idle(f);assert.equal(f.verifies,1);assert.equal(result.attempt.state,'unknown');assert.equal(result.attempt.boot_build_verified,false);assert.equal(result.attempt.boot_identity_verified,false);assert.equal(f.resetCalls,1);assert.equal(f.released,0);assert.ok(f.retained>0);
});

test('shutdown before durable preparation completes cannot launch a privileged worker afterward',async t=>{
  const f=await fixture(t),review=await selected(f);await f.service.prepare({review_id:review.review_id,confirmed:true});await f.service.close();
  assert.equal(f.factoryCalls,0);assert.equal(f.installCalls.length,0);const saved=JSON.parse(await fs.readFile(path.join(f.directory,'cdc-update/attempt/attempt.json'),'utf8'));assert.equal(saved.state,'unknown');
});

test('shutdown before durable install intent completes cannot program or reset afterward',async t=>{
  const f=await fixture(t),ready=await prepared(f),review=(await f.service.reviewInstall({job_id:ready.attempt.job_id})).review;
  await f.service.start({review_id:review.review_id,confirmed:true});await f.service.close();assert.equal(f.installCalls.length,0);assert.equal(f.resetCalls,0);
});
