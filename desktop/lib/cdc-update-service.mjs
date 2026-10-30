import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { StockError } from '../../tools/jieli-wl82/stock-sysex/protocol.mjs';
import { absolutePath, checkPath, atomicJson, readJson } from '../../tools/jieli-wl82/stock-sysex/files.mjs';
import { CdcAttemptJournal, cdcRequestIdentity, validateCdcJournal, assertOtherFamilyResolved } from '../../tools/jieli-wl82/stock-sysex/custom-journal.mjs';
import { validateCustomManifest, MAX_CUSTOM_FWSC_BYTES } from '../../tools/jieli-wl82/stock-sysex/custom-package.mjs';

export const MAX_CDC_CHUNK_BYTES = 65536;
const defaultTransport = async options => (await import('../../tools/jieli-wl82/cdc-uboot/transport.mjs')).createCdcUbootTransport(options);
const defaultExtractor = async (raw, manifest) => (await import('../../tools/jieli-wl82/cdc-uboot/policy.mjs')).extractTrackerApplication(raw, manifest);
const defaultPlanner = async (...args) => (await import('../../tools/jieli-wl82/cdc-uboot/policy.mjs')).planApplication(...args);
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const digest = value => sha(JSON.stringify(canonical(value)));
const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
const id = () => randomBytes(16).toString('hex');
const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && value !== '0'.repeat(64);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const fail = (code,message) => new StockError(code,message);
const codeOf = error => /^[a-z][a-z0-9_]{0,63}$/.test(error?.code ?? '') ? error.code : 'cdc_update_failed';
const unresolved = record => record && ['prepared','active','unknown'].includes(record.state);
const planMetadata = plan => Object.fromEntries(['baseline_sha256','candidate_sha256','application_sha256','target_build_sha256','sectors','no_changes'].map(key => [key,clone(plan[key])]));

/** Owns reviewed CDC preparation and the original protected UBOOT worker. */
export async function createCdcUpdateService({ directory, deviceService, transportFactory = defaultTransport, trackerVerifier,
  clock = { now: Date.now }, packageExtractor = defaultExtractor, planner = defaultPlanner } = {}) {
  if (!deviceService?.reviewCdcEndpoint || !deviceService?.acquireCdcWriter) throw fail('invalid_service','The fixed tracker CDC device service is required.');
  const now = () => typeof clock === 'function' ? clock() : clock.now();
  const root = path.join(absolutePath(directory),'cdc-update'), packages = path.join(root,'packages'), requests = path.join(root,'requests'), jobs = path.join(root,'jobs'), attemptRoot = path.join(root,'attempt');
  for (const folder of [root,packages,requests,jobs,attemptRoot]) {
    await checkPath(folder,true); await fs.mkdir(folder,{recursive:true,mode:0o700});
    if (!(await checkPath(folder)).isDirectory()) throw fail('unsafe_path','CDC update storage is invalid.');
  }
  const attemptFile = path.join(attemptRoot,'attempt.json');
  let record = await readJson(attemptFile,true); if (record) validateCdcJournal(record);
  let queue = Promise.resolve(), closed = false, upload = null, currentReview = null, writing = false, session = null, progress = 0;
  const serial = action => { const result=queue.then(() => { if(closed)throw fail('service_closed','The CDC updater is closed.'); return action(); }); queue=result.catch(()=>{}); return result; };
  const idle = () => { if(writing)throw fail('update_busy','The original CDC operation is still running.'); };
  const load = async () => { record=await readJson(attemptFile,true); if(record)validateCdcJournal(record); return record; };
  const peers = () => assertOtherFamilyResolved(directory,'cdc-uboot');
  const resolved = async () => { await peers(); if(unresolved(await load()))throw fail('recovery_required','The original CDC update must be resolved before another package.'); };
  const checkInputJob = input => { if(!exact(input,['job_id'])||!validId(input.job_id))throw fail('invalid_job','Choose the exact original CDC job.'); };
  const readBytes = async (file,size) => {
    const stat=await checkPath(file);if(!stat.isFile()||stat.size!==size||size>MAX_CUSTOM_FWSC_BYTES)throw fail('invalid_package','Saved CDC update bytes changed.');
    const handle=await fs.open(file,'r');try { const before=await handle.stat(), bytes=await handle.readFile(),after=await handle.stat();
      if(!before.isFile()||bytes.length!==size||after.size!==size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw fail('invalid_package','Saved CDC bytes changed during validation.'); return Uint8Array.from(bytes);
    }finally{await handle.close();}
  };
  const immutableBytes = async (file,bytes) => {
    await checkPath(file,true);let handle;
    try { handle=await fs.open(file,'wx',0o600);await handle.writeFile(bytes);await handle.sync(); }
    catch(error){if(error.code!=='EEXIST')throw error;if(sha(await readBytes(file,bytes.length))!==sha(bytes))throw fail('invalid_package','An immutable CDC snapshot changed.');}
    finally{await handle?.close();}
  };
  const extracted = async (raw,manifest) => {
    if(manifest.profile!=='protracker'||typeof trackerVerifier!=='function'||raw.length!==manifest.raw_bytes||sha(raw)!==manifest.package_sha256)throw fail('invalid_package','CDC updates require the exact tracker package and boot verifier.');
    const result=await packageExtractor(raw,manifest),application=result?.application;
    if(!(application instanceof Uint8Array)||application.length!==manifest.application_bytes||sha(application)!==manifest.application_sha256)throw fail('invalid_package','The extracted tracker application differs from its manifest.');
    return Uint8Array.from(application);
  };
  const snapshot = async request => {
    const saved=await readJson(path.join(requests,request.jobId+'.json'));
    if(saved?.schema!==1||saved.digest!==cdcRequestIdentity(request).digest||digest(saved.request)!==digest(request))throw fail('invalid_package','The original reviewed CDC request changed.');
    const manifest=validateCustomManifest(await readJson(path.join(packages,request.manifestSha256+'.json')));
    if(digest(manifest)!==request.manifestSha256||manifest.package_sha256!==request.sha256||manifest.logical_sha256!==request.logicalSha256||manifest.target_build_sha256!==request.targetBuildSha256||manifest.raw_bytes!==request.rawBytes||manifest.logical_bytes!==request.logicalBytes||manifest.application_sha256!==request.applicationSha256||manifest.application_bytes!==request.applicationBytes)throw fail('invalid_package','The original CDC manifest changed.');
    return extracted(await readBytes(path.join(packages,request.sha256+'.fwsc'),request.rawBytes),manifest);
  };
  const publicAttempt = () => {
    if(!record)return null;const succeeded=record.state==='succeeded', recovered=!session&&['active','prepared'].includes(record.state);
    return {kind:'cdc-uboot',profile:'protracker',job_id:record.jobId,state:recovered?'unknown':record.state,phase:record.phase,progress:succeeded?1:Math.min(0.99,progress),
      sha256:record.request.sha256,logical_sha256:record.request.logicalSha256,manifest_sha256:record.request.manifestSha256,raw_bytes:record.request.rawBytes,logical_bytes:record.request.logicalBytes,
      source_build_sha256:record.request.source.build_sha256,target_build_sha256:record.request.targetBuildSha256,expected_boot_identity:'MOD-EDITOR/1',
      baseline_sha256:record.plan?.baseline_sha256??null,candidate_sha256:record.plan?.candidate_sha256??null,sectors:record.plan?.sectors??[],no_changes:record.plan?.no_changes??false,
      transfer_finished:record.transfer_finished,readback_verified:record.readback_verified,boot_identity_verified:record.boot_identity_verified,boot_build_verified:record.boot_build_verified,
      observed_boot_identity:record.final_identity??null,observed_build_sha256:record.final_build_sha256??null,recovery_required:recovered||record.state==='unknown',recovery_available:!!session?.worker&&!session.stopped&&!record.transfer_finished&&!!record.plan,
      ...(record.error_code?{error_code:record.error_code}:{})};
  };
  const statusValue = () => ({supported:true,writing,attempt:clone(publicAttempt()),review:clone(currentReview?.fields)});
  const fields = (request,operation) => ({kind:'cdc-uboot',profile:'protracker',operation,review_id:id(),job_id:request.jobId,sha256:request.sha256,logical_sha256:request.logicalSha256,
    manifest_sha256:request.manifestSha256,raw_bytes:request.rawBytes,logical_bytes:request.logicalBytes,source_build_sha256:request.source.build_sha256,target_build_sha256:request.targetBuildSha256,expected_boot_identity:'MOD-EDITOR/1',
    baseline_sha256:record?.jobId===request.jobId?record.plan?.baseline_sha256??null:null,candidate_sha256:record?.jobId===request.jobId?record.plan?.candidate_sha256??null:null,sectors:record?.jobId===request.jobId?record.plan?.sectors??[]:[],no_changes:record?.jobId===request.jobId?record.plan?.no_changes??false:false,expires_at:new Date(now()+120000).toISOString()});
  const consume = (input,operations) => {
    if(!exact(input,['review_id','confirmed'])||input.confirmed!==true||!currentReview||input.review_id!==currentReview.fields.review_id||!operations.includes(currentReview.fields.operation))throw fail('review_required','Explicitly confirm this original CDC review.');
    if(now()>=Date.parse(currentReview.fields.expires_at)){currentReview=null;throw fail('review_expired','Review the original CDC package and plan again.');}
    const approved=currentReview;currentReview=null;return approved;
  };
  const transition = async (context,phase,extra={}) => {
    const result=context.journalQueue.then(async()=>{if(context.stopped)throw fail('service_closed','The CDC operation stopped.');await context.journal.transition(phase,extra);record=context.journal.record;});
    context.journalQueue=result.catch(()=>{});return result;
  };
  const closeContext = async context => {
    if(context.closing)return context.closing;
    context.closing=(async()=>{try{if(context.workerUnknown)throw fail('worker_shutdown_unproven','The original elevated worker could not be proven stopped. Preserve its original job.');await context.worker?.close();}catch(error){context.lease?.retain?.();throw error;}await context.lease?.release();await context.journal.close();if(session===context)session=null;})();
    return context.closing;
  };
  const failure = async (context,error) => { if(context.stopped)return;await transition(context,record.phase,{state:'unknown',boot_identity_verified:false,boot_build_verified:false,error_code:codeOf(error)}); };
  const checkedPlan = async (request,baseline,application) => {
    if(!(baseline instanceof Uint8Array)||baseline.length!==0x100000)throw fail('invalid_baseline','The protected worker did not return a complete live baseline.');
    const plan=await planner(Uint8Array.from(baseline),Uint8Array.from(application),request.targetBuildSha256);
    if(!(plan?.candidate instanceof Uint8Array)||plan.candidate.length!==0x100000||plan.baseline_sha256!==sha(baseline)||plan.candidate_sha256!==sha(plan.candidate)||plan.application_sha256!==request.applicationSha256||plan.target_build_sha256!==request.targetBuildSha256)throw fail('invalid_plan','The protected application plan differs from the original bytes.');
    validateCdcJournal({...record,plan:planMetadata(plan),planDigest:digest(planMetadata(plan))});return plan;
  };
  const originalPlan = async context => {
    const application=await snapshot(record.request),folder=path.join(jobs,record.jobId),baseline=await readBytes(path.join(folder,'baseline.bin'),0x100000),candidate=await readBytes(path.join(folder,'candidate.bin'),0x100000);
    const plan=await checkedPlan(record.request,baseline,application);
    if(digest(planMetadata(plan))!==record.planDigest||sha(candidate)!==plan.candidate_sha256||context.jobId!==record.jobId)throw fail('invalid_plan','The original saved effective image or scope changed.');return plan;
  };
  const beginUpload = input => serial(async()=>{
    idle();await resolved();if(!exact(input,['raw_bytes','manifest']))throw fail('invalid_package','Choose a tracker package and its matching manifest.');
    const manifest=validateCustomManifest(input.manifest);if(manifest.profile!=='protracker'||input.raw_bytes!==manifest.raw_bytes||typeof trackerVerifier!=='function')throw fail('invalid_package','Only the closed tracker CDC update profile is available.');
    upload?.bytes.fill(0);upload={id:id(),manifest,bytes:Buffer.alloc(input.raw_bytes),received:0};currentReview=null;return {upload_id:upload.id,max_chunk_bytes:MAX_CDC_CHUNK_BYTES};
  });
  const appendUpload = input => serial(async()=>{
    idle();if(!exact(input,['upload_id','offset','data_base64'])||!upload||input.upload_id!==upload.id||input.offset!==upload.received||typeof input.data_base64!=='string'||input.data_base64.length>Math.ceil(MAX_CDC_CHUNK_BYTES/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data_base64))throw fail('invalid_upload','CDC package chunks must be canonical and sequential.');
    const bytes=Buffer.from(input.data_base64,'base64');if(!bytes.length||bytes.length>MAX_CDC_CHUNK_BYTES||bytes.toString('base64')!==input.data_base64||upload.received+bytes.length>upload.bytes.length)throw fail('invalid_upload','The CDC package chunk exceeds its bounds.');bytes.copy(upload.bytes,upload.received);upload.received+=bytes.length;return {upload_id:upload.id,received_bytes:upload.received};
  });
  const review = input => serial(async()=>{
    idle();await resolved();if(!exact(input,['upload_id'])||!upload||input.upload_id!==upload.id||upload.received!==upload.bytes.length)throw fail('invalid_upload','Select the complete original tracker package pair.');
    const chosen=upload;upload=null;try{
      await extracted(chosen.bytes,chosen.manifest);const endpoint=await deviceService.reviewCdcEndpoint(),manifest=chosen.manifest;
      const request=cdcRequestIdentity({kind:'cdc-uboot',jobId:id(),sha256:manifest.package_sha256,logicalSha256:manifest.logical_sha256,manifestSha256:digest(manifest),targetBuildSha256:manifest.target_build_sha256,rawBytes:manifest.raw_bytes,logicalBytes:manifest.logical_bytes,applicationSha256:manifest.application_sha256,applicationBytes:manifest.application_bytes,endpointReviewId:id(),source:endpoint.source}).request;
      await immutableBytes(path.join(packages,request.sha256+'.fwsc'),chosen.bytes);const manifestFile=path.join(packages,request.manifestSha256+'.json'),prior=await readJson(manifestFile,true);
      if(prior&&digest(prior)!==digest(manifest))throw fail('invalid_package','The saved manifest changed.');if(!prior)await atomicJson(manifestFile,manifest);
      await atomicJson(path.join(requests,request.jobId+'.json'),{schema:1,...cdcRequestIdentity(request)});const value=fields(request,'prepare');currentReview={fields:value,request,endpoint};return {review:clone(value)};
    }finally{chosen.bytes.fill(0);}
  });
  const prepare = input => serial(async()=>{
    idle();await resolved();const approved=consume(input,['prepare']),application=await snapshot(approved.request);
    const journal=await CdcAttemptJournal.open(attemptRoot,cdcRequestIdentity(approved.request));let lease;
    try{lease=await deviceService.acquireCdcWriter(approved.endpoint);await peers();}
    catch(error){await journal.transition('failed',{state:'failed',error_code:codeOf(error)});await journal.close();await lease?.release();record=journal.record;throw error;}
    const context={jobId:approved.request.jobId,journal,lease,worker:null,workerUnknown:false,factoryStarted:false,stopped:false,journalQueue:Promise.resolve(),closing:null,task:null};session=context;record=journal.record;writing=true;progress=0;
    context.task=(async()=>{try{
      await transition(context,'preparing',{state:'active'});
      if(context.stopped)return;
      context.factoryStarted=true;
      const worker=await transportFactory({application:Uint8Array.from(application),targetBuildSha256:approved.request.targetBuildSha256,source:clone(lease.source??approved.request.source),onProgress:event=>{if(!context.stopped&&Number.isFinite(event?.progress))progress=Math.min(0.99,Math.max(progress,event.progress));}});context.worker=worker;
      if(context.stopped){await worker.close();return;}
      const prepared=await worker.prepare();if(context.stopped)return;
      const baseline=Uint8Array.from(prepared.baseline??[]),plan=await checkedPlan(approved.request,baseline,application),folder=path.join(jobs,context.jobId);
      if(prepared.baseline_sha256!==plan.baseline_sha256||prepared.candidate_sha256!==plan.candidate_sha256||!hash(prepared.worker_receipt_sha256)||JSON.stringify(prepared.sectors)!==JSON.stringify(plan.sectors))throw fail('invalid_plan','The independent protected worker plan differs from the original live application plan.');
      await checkPath(folder,true);await fs.mkdir(folder,{mode:0o700});
      await immutableBytes(path.join(folder,'baseline.bin'),baseline);await immutableBytes(path.join(folder,'candidate.bin'),plan.candidate);
      await transition(context,'awaiting_install',{state:'prepared',plan:planMetadata(plan),planDigest:digest(planMetadata(plan)),worker_receipt_sha256:prepared.worker_receipt_sha256,verified_prefix:[]});
    }catch(error){if(context.factoryStarted&&!context.worker){context.workerUnknown=true;context.lease?.retain?.();}await failure(context,error);}finally{application.fill(0);writing=false;}})();
    void context.task.catch(()=>{});return statusValue();
  });
  const liveSession = input => {checkInputJob(input);if(!record||record.jobId!==input.job_id||!unresolved(record)||record.transfer_finished||!record.plan)throw fail('recovery_required','Choose the original unresolved prepared CDC job.');if(!session?.worker||session.stopped||session.jobId!==input.job_id)throw fail('recovery_session_lost','The original protected worker session is unavailable. Preserve this attempt for a local recovery handoff.');if(session.journal.identity.digest!==record.requestDigest)throw fail('invalid_package','The retained original worker request changed.');return session;};
  const makeInstallReview = (input,recover) => serial(async()=>{idle();await peers();await load();const context=liveSession(input);if(!recover&&(record.state!=='prepared'||record.phase!=='awaiting_install'))throw fail('recovery_required','Review recovery for the original interrupted CDC write.');if(recover&&record.state!=='unknown')throw fail('recovery_required','Only the original interrupted CDC attempt can recover.');await originalPlan(context);const value=fields(record.request,recover?'recover':'install');currentReview={fields:value,request:record.request};return {review:clone(value)};});
  const reviewInstall = input => makeInstallReview(input,false), reviewRecovery = input => makeInstallReview(input,true);
  const verifyProof = async context => {
    const proof=await trackerVerifier({buildSha256:record.request.targetBuildSha256,source:clone(record.request.source),timeoutMs:40000,signal:context.controller?.signal});
    if(context.stopped)return;if(proof?.text!=='MOD-EDITOR/1'||proof.buildSha256!==record.request.targetBuildSha256||proof.transport!=='cdc'||proof.nonceVerified!==true)throw fail('boot_build_mismatch','The running tracker does not match the original reviewed build.');
    // A valid running build does not prove that an old privileged worker stopped.
    // Commit success only after its authenticated shutdown (or the durable reset receipt).
    try{if(context.worker)await context.worker.close();else if(record.reset_verified!==true)throw fail('worker_shutdown_unproven','The original protected worker shutdown is unproven.');}
    catch(error){context.lease?.retain?.();throw error;}
    if(context.stopped)return;
    await transition(context,'done',{state:'succeeded',worker_stopped_verified:true,boot_identity_verified:true,boot_build_verified:true,final_identity:proof.text,final_build_sha256:proof.buildSha256,error_code:null});
  };
  const start = input => serial(async()=>{
    idle();await peers();const approved=consume(input,['install','recover']);await load();const context=liveSession({job_id:approved.request.jobId}),plan=await originalPlan(context);
    if(approved.fields.operation==='install'&&(record.state!=='prepared'||record.phase!=='awaiting_install')||approved.fields.operation==='recover'&&record.state!=='unknown')throw fail('review_required','The original CDC operation state changed; review its recovery explicitly.');
    if(approved.fields.baseline_sha256!==record.plan.baseline_sha256||approved.fields.candidate_sha256!==record.plan.candidate_sha256||digest(approved.request)!==digest(record.request))throw fail('invalid_plan','The reviewed original application plan changed.');
    context.controller=new AbortController();writing=true;
    context.task=(async()=>{try{
      await transition(context,'installing',{state:'active',error_code:null});
      if(context.stopped)return;
      const result=await context.worker.install({plan,recover:approved.fields.operation==='recover'});if(context.stopped)return;
      if(result?.readback_verified!==true||result.candidate_sha256!==record.plan.candidate_sha256||!Number.isSafeInteger(result.mutation_attempts)||result.mutation_attempts<0||(record.plan.no_changes&&result.mutation_attempts!==0))throw fail('readback_failed','The protected worker did not prove the exact full effective image.');
      await transition(context,'waiting_reboot',{transfer_finished:true,readback_verified:true,verified_prefix:[...record.plan.sectors],mutation_attempts:result.mutation_attempts});
      if(context.stopped)return;
      const reset=await context.worker.resetVerified();if(context.stopped)return;
      if(reset?.reset_requested!==true||reset.worker_stopped!==true)throw fail('worker_shutdown_unproven','The protected worker did not prove its verified reset and shutdown.');
      await transition(context,'waiting_reboot',{reset_verified:true});await verifyProof(context);await closeContext(context);
    }catch(error){await failure(context,error);}finally{writing=false;}})();void context.task.catch(()=>{});return statusValue();
  });
  const verifyBoot = input => serial(async()=>{
    idle();await peers();checkInputJob(input);await load();if(!record||record.jobId!==input.job_id||!unresolved(record)||!record.transfer_finished||!record.readback_verified)throw fail('verification_required','Only an original completed CDC write can be verified without rewriting.');
    await snapshot(record.request);let context=session;
    if(!context&&record.reset_verified!==true)throw fail('recovery_session_lost','The original privileged worker shutdown is unproven. Preserve this job for a local recovery handoff.');
    if(!context){const journal=await CdcAttemptJournal.open(attemptRoot,cdcRequestIdentity(record.request),{resume:true});let lease;try{lease=await deviceService.acquireCdcObservation();await peers();}catch(error){await journal.close();await lease?.release();throw error;}context={jobId:record.jobId,journal,lease,worker:null,stopped:false,journalQueue:Promise.resolve(),closing:null};session=context;record=journal.record;}
    context.controller=new AbortController();writing=true;currentReview=null;
    context.task=(async()=>{try{await verifyProof(context);await closeContext(context);}catch(error){await failure(context,error);}finally{writing=false;}})();void context.task.catch(()=>{});return statusValue();
  });
  const status = () => serial(async()=>{if(!writing)await load();if(currentReview&&now()>=Date.parse(currentReview.fields.expires_at))currentReview=null;return statusValue();});
  const close = async()=>{
    if(closed)return;closed=true;await queue;upload?.bytes.fill(0);upload=null;currentReview=null;const context=session;if(!context)return;
    context.stopped=true;context.controller?.abort();await context.journalQueue;
    await context.journal.transition(record.phase,{state:'unknown',boot_identity_verified:false,boot_build_verified:false,error_code:'service_closed'});record=context.journal.record;
    try{try{await context.worker?.close();}catch(error){context.lease?.retain?.();throw error;}await context.task;await closeContext(context);}finally{writing=false;}
  };
  return Object.freeze({beginUpload,appendUpload,review,prepare,reviewInstall,start,reviewRecovery,verifyBoot,status,close});
}
