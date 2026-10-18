import { ID, PublicError, PROFILES, RESOURCE_URI, TOOLS, sanitize, validate } from './fm1-contract.mjs';
import { UI_HTML } from './fm1-ui.mjs';
import { ICONS } from './fm1-icon.mjs';
import { diagnosticProof } from './fm1-forge-baseline.mjs';
import { inputSample, inputActivity } from './fm1-input-contract.mjs';
import { EXTENSION_TOOLS, callExtensionTool, forgeSnapshot, registerForgeExtensions } from './fm1-extensions.mjs';
import { OpenAIUiResourceMetadataSchema } from '@openai/mcp-extensions';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';

const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const ident=()=>crypto.randomUUID().replaceAll('-','');
const now=()=>Math.floor(Date.now()/1000);
const result=(data)=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});
async function body(request) {
  if(Number(request.headers.get('content-length')||0)>65536)throw new PublicError('Request too large.',413);
  const bytes=await request.arrayBuffer();
  if(bytes.byteLength>65536)throw new PublicError('Request too large.',413);
  const raw=new TextDecoder().decode(bytes);
  try{return JSON.parse(raw);}catch{throw new PublicError('Invalid JSON.');}
}
const INVENTORY_MAX_AGE_SECONDS=15;
const STOCK_PACKAGE_SHA256='db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a';
const stockPair=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&['inputName','outputName'].every(key=>typeof value[key]==='string'&&/^(?:FM-1|FM-1 Midi|ota-FM-1)(?: [0-9]{1,3})?$/.test(value[key]))&&value.inputName.replace(/ [0-9]+$/,'')===value.outputName.replace(/ [0-9]+$/,'');
// This timestamp belongs to the Site receipt, never to caller-controlled data,
// queue creation or a retried dispatch. Keep it private to the cache contract.
const INVENTORY_OBSERVED_FIELD='_site_inventory_observed_at';
function publicResult(encoded){const value=JSON.parse(encoded);delete value[INVENTORY_OBSERVED_FIELD];delete value._site_input_observed_at;return value;}
const parse=(row)=>row?{id:row.id,operation:row.operation,state:row.state,created:row.created,...(row.result?publicResult(row.result):{})}:null;
function db(env){if(!env.DB)throw new PublicError('Saved requests are unavailable.',503);return env.DB;}
function user(request){const value=request.headers.get('oai-authenticated-user-id');if(!value)throw new PublicError('Sign in to use your FM-1 library.',401);return value;}
function safeOrigin(request,env){const origin=request.headers.get('origin');if(origin&&origin!==(env.SITE_ORIGIN||new URL(request.url).origin))throw new PublicError('Origin is not permitted.',403);}
async function relayState(env) {
  const row=await db(env).prepare("SELECT last_seen,allow_switch,allow_official_update,allow_stock_update FROM relay_state WHERE id='bench'").first();
  return {connected:!!row&&now()-row.last_seen<30,last_seen:row?.last_seen??null,allow_switch:!!row?.allow_switch,allow_official_update:!!row?.allow_official_update,allow_stock_update:!!row?.allow_stock_update};
}
async function latest(env,owner,operation){const row=await db(env).prepare("SELECT result FROM relay_tasks WHERE user_id=? AND operation=? AND state='succeeded' ORDER BY created DESC,rowid DESC LIMIT 1").bind(owner,operation).first();return row?.result?JSON.parse(row.result).data:null;}
async function inventorySnapshot(env,owner,connection){
  const row=await db(env).prepare("SELECT id,state,result,created FROM relay_tasks WHERE user_id=? AND operation='status' AND state IN ('succeeded','failed','unknown') ORDER BY created DESC,rowid DESC LIMIT 1").bind(owner).first();
  const status={state:'unavailable',observed_at:null,age_seconds:null,max_age_seconds:INVENTORY_MAX_AGE_SECONDS,request_id:row?.id||null};
  if(!row?.result)return {inventory:null,inventory_status:status};
  const saved=JSON.parse(row.result);
  if(row.state!=='succeeded'||saved.status!=='succeeded')return {inventory:null,inventory_status:{...status,state:'error'}};
  if(!saved.data||typeof saved.data!=='object'||Array.isArray(saved.data))return {inventory:null,inventory_status:status};
  const observed=saved[INVENTORY_OBSERVED_FIELD],valid=Number.isSafeInteger(observed)&&observed>0;
  const createdValid=Number.isSafeInteger(row.created)&&row.created>0,instant=now();
  const device=saved.data.device,hasObservation=!!device&&typeof device==='object'&&Object.hasOwn(device,'observation');
  const observation=hasObservation?device.observation:null;
  // Actual local enumeration starts after queue wait. Validate its interval
  // against creation and the immutable first Site receipt before using it.
  // Legacy samples retain their conservative queue-age bound; a malformed
  // upgraded interval must never fall back to that less-specific contract.
  const intervalValid=hasObservation&&!!observation&&typeof observation==='object'&&!Array.isArray(observation)
    &&Number.isSafeInteger(observation.started_at)&&observation.started_at>0
    &&Number.isSafeInteger(observation.completed_at)&&observation.completed_at>0
    &&valid&&createdValid&&row.created<=observation.started_at
    &&observation.started_at<=observation.completed_at&&observation.completed_at<=observed&&observed<=instant
    &&observation.completed_at-observation.started_at<=INVENTORY_MAX_AGE_SECONDS;
  const age=hasObservation?(intervalValid?Math.max(0,instant-observation.started_at,instant-observed):null)
    :valid&&createdValid?Math.max(0,instant-observed,instant-row.created):null;
  const timestampsValid=hasObservation?intervalValid:valid&&createdValid&&observed<=instant&&row.created<=instant;
  const fresh=timestampsValid&&age<=INVENTORY_MAX_AGE_SECONDS&&connection.connected;
  const enumerationError=saved.data.device&&Object.hasOwn(saved.data.device,'inventory_error')&&saved.data.device.inventory_error!==null;
  return {inventory:saved.data,inventory_status:{...status,state:enumerationError?'error':fresh?'fresh':'stale',observed_at:valid?observed:null,age_seconds:age}};
}
async function library(env,owner){
  const baseline=await db(env).prepare('SELECT job_id,sha256,verified_at FROM forge_baselines WHERE user_id=?').bind(owner).first();
  const connection=await relayState(env),inventory=await inventorySnapshot(env,owner,connection);
  const input=await db(env).prepare("SELECT id,state,result,created FROM relay_tasks WHERE user_id=? AND operation='input_snapshot' AND state IN ('succeeded','failed','unknown') ORDER BY created DESC,rowid DESC LIMIT 1").bind(owner).first();
  return {profiles:PROFILES,relay:connection,catalog:await latest(env,owner,'catalog'),...inventory,input_activity:inputActivity(input,connection,now()),
    forge:{diagnostic_baseline:baseline?{...baseline,catalog_id:'factory-diag',write_verified:true,full_readback_verified:true,boot_verified:true}:null,...await forgeSnapshot(env,owner)},
    recent_requests:(await db(env).prepare('SELECT * FROM relay_tasks WHERE user_id=? ORDER BY created DESC,rowid DESC LIMIT 12').bind(owner).all()).results.map(parse)};
}
async function rememberDiagnostics(env,task,clean){
  if(clean.status==='succeeded'&&clean.data?.operation==='stock_sysex_update'&&['succeeded','unknown'].includes(clean.data.status)){
    await db(env).prepare('DELETE FROM forge_baselines WHERE user_id=?').bind(task.user_id).run();
    return;
  }
  if(clean.status!=='succeeded'||!['switch_app','job'].includes(task.operation))return;
  const catalog=await latest(env,task.user_id,'catalog');
  const variant=catalog?.apps?.find(app=>app.profile==='diagnostics')?.variants?.find(item=>item.id==='factory-diag');
  const proof=diagnosticProof(task,clean.data,variant?.sha256);
  if(!proof)return;
  // Scope to the authenticated owner and keep a proof after recent-request
  // history rotates. Duplicate acknowledgments repair an interrupted save.
  await db(env).prepare('INSERT INTO forge_baselines(user_id,job_id,sha256,verified_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET job_id=excluded.job_id,sha256=excluded.sha256,verified_at=excluded.verified_at WHERE excluded.verified_at>=forge_baselines.verified_at')
    .bind(task.user_id,proof.job_id,proof.sha256,proof.verified_at).run();
}
async function enqueue(env,owner,operation,args,taskId=ident()){
  const connection=await relayState(env);
  if(!connection.connected)throw new PublicError('Bench connection is offline. Reconnect the relay before requesting fresh data.',503);
  if(operation==='switch_app'&&!connection.allow_switch)throw new PublicError('App switching is disabled at the bench.',403);
  if(operation==='official_updater'&&!connection.allow_official_update)throw new PublicError('Official updating is disabled at the bench.',403);
  const existing=await db(env).prepare('SELECT * FROM relay_tasks WHERE id=? AND user_id=?').bind(taskId,owner).first();
  if(existing)return {request_id:existing.id,delivery:existing.state};
  if(operation==='status'){
    // Coalesce passive refreshes from multiple native panels for this owner.
    // The INSERT predicate is atomic in D1; concurrent callers cannot both add
    // a refresh. A finished request can be followed by a new observation.
    for(let attempt=0;attempt<2;attempt++){
      const inserted=await db(env).prepare("INSERT INTO relay_tasks(id,user_id,operation,arguments,state,created) SELECT ?,?,'status',?,'pending',? WHERE NOT EXISTS(SELECT 1 FROM relay_tasks WHERE user_id=? AND operation='status' AND state IN ('pending','dispatched'))").bind(taskId,owner,JSON.stringify(args),now(),owner).run();
      if(inserted.meta?.changes)return {request_id:taskId,delivery:'pending',message:'Saved passive status request. Inspect this ID; do not submit another request after a timeout.'};
      const pending=await db(env).prepare("SELECT id,state FROM relay_tasks WHERE user_id=? AND operation='status' AND state IN ('pending','dispatched') ORDER BY created DESC,rowid DESC LIMIT 1").bind(owner).first();
      if(pending)return {request_id:pending.id,delivery:pending.state,message:'Resume the existing passive status request by this ID.'};
    }
    throw new PublicError('The previous status refresh finished while queuing. Refresh the saved library before requesting another observation.',409);
  }
  if(operation==='input_snapshot'){
    // One bounded sample per owner. Multiple panels resume the same saved ID.
    for(let attempt=0;attempt<2;attempt++){
      const inserted=await db(env).prepare("INSERT INTO relay_tasks(id,user_id,operation,arguments,state,created) SELECT ?,?,'input_snapshot',?,'pending',? WHERE NOT EXISTS(SELECT 1 FROM relay_tasks WHERE user_id=? AND operation='input_snapshot' AND state IN ('pending','dispatched'))").bind(taskId,owner,JSON.stringify(args),now(),owner).run();
      if(inserted.meta?.changes)return {request_id:taskId,delivery:'pending',message:'Saved read-only input sample. Inspect this ID after a timeout; do not resubmit it.'};
      const pending=await db(env).prepare("SELECT id,state FROM relay_tasks WHERE user_id=? AND operation='input_snapshot' AND state IN ('pending','dispatched') ORDER BY created DESC,rowid DESC LIMIT 1").bind(owner).first();
      if(pending)return {request_id:pending.id,delivery:pending.state,message:'Resume this saved input sample by its request ID.'};
    }
    throw new PublicError('The previous input sample finished while queuing. Refresh the saved library before requesting another sample.',409);
  }
  if(operation==='open_local_import'){
    // Concurrent panels share one pending launch for this owner. Opening the
    // local picker is a deliberate action; reading the library never launches it.
    for(let attempt=0;attempt<2;attempt++){
      const inserted=await db(env).prepare("INSERT INTO relay_tasks(id,user_id,operation,arguments,state,created) SELECT ?,?,'open_local_import',?,'pending',? WHERE NOT EXISTS(SELECT 1 FROM relay_tasks WHERE user_id=? AND operation='open_local_import' AND state IN ('pending','dispatched'))").bind(taskId,owner,JSON.stringify(args),now(),owner).run();
      if(inserted.meta?.changes)return {request_id:taskId,delivery:'pending',message:'Saved local importer request. Choose packages in the local companion window; inspect this ID after a timeout. No device I/O.'};
      const pending=await db(env).prepare("SELECT id,state FROM relay_tasks WHERE user_id=? AND operation='open_local_import' AND state IN ('pending','dispatched') ORDER BY created DESC,rowid DESC LIMIT 1").bind(owner).first();
      if(pending)return {request_id:pending.id,delivery:pending.state,message:'Resume this local importer request by its saved ID.'};
    }
    throw new PublicError('The importer launch finished while queuing. Inspect the saved request before opening another window.',409);
  }
  await db(env).prepare('INSERT INTO relay_tasks(id,user_id,operation,arguments,state,created) VALUES(?,?,?,?,?,?)').bind(taskId,owner,operation,JSON.stringify(args),'pending',now()).run();
  return {request_id:taskId,delivery:'pending',...(['plan_app','switch_app','official_updater'].includes(operation)?{job_id:taskId}:{}),message:'Saved request. Inspect this ID; do not submit another request after a timeout.'};
}
async function stagedSwitch(env,owner,args){
  const connection=await relayState(env);
  if(!connection.connected||!connection.allow_switch)throw new PublicError('App switching is disabled or the bench is disconnected.',403);
  const catalog=await latest(env,owner,'catalog');
  const variant=catalog?.apps?.flatMap(app=>app.variants||[]).find(item=>item.id===args.catalog_id);
  if(!variant||!variant.ready||!/^[a-f0-9]{64}$/.test(variant.sha256))throw new PublicError('Refresh packages and choose a validated, ready variant.',409);
  const status=await inventorySnapshot(env,owner,connection),inventory=status.inventory;
  const mode=inventory?.device?.update_mode;
  if(args.entry_method==='auto'&&(status.inventory_status.state!=='fresh'||!['serial','already_uboot'].includes(mode?.app_entry_method)))throw new PublicError('Refresh the device: automatic app routing needs fresh inventory and one recognized serial or UBOOT device.',409);
  const approval=ident();
  await db(env).prepare('INSERT INTO switch_approvals(id,user_id,catalog_id,digest,entry_method,expires,used) VALUES(?,?,?,?,?,?,0)').bind(approval,owner,args.catalog_id,variant.sha256,args.entry_method,now()+180).run();
  return {review:{title:variant.title,variant:variant.variant,sha256:variant.sha256,catalog_id:variant.id,entry_method:args.entry_method,...(args.entry_method==='auto'?{detected_method:mode.app_entry_method}:{}),expires:now()+180},_approval:approval,message:'Review the variant in the library and click Confirm app switch. No device write has been submitted.'};
}
async function officialState(env,owner){
  const status=await inventorySnapshot(env,owner,await relayState(env)),inventory=status.inventory;
  if(status.inventory_status.state!=='fresh')throw new PublicError('Refresh the device: official updating needs fresh FM-1 MIDI/SysEx inventory.',409);
  const engine=inventory?.engine;
  if(engine?.active||engine?.blocked_unknown||engine?.storage_fault||engine?.updater_handoff)throw new PublicError('Resolve the saved bench job or updater handoff before another official update.',409);
  const update=inventory?.device?.official_update;
  if(!update?.configured||!update.available||!/^[a-f0-9]{64}$/.test(update.sha256||''))throw new PublicError('Refresh the device: the pinned official updater needs a recognized FM-1 MIDI/SysEx connection.',409);
  return update;
}
async function stagedOfficial(env,owner){
  const connection=await relayState(env);
  if(!connection.connected||!connection.allow_official_update)throw new PublicError('Official updating is disabled or the bench is disconnected.',403);
  const update=await officialState(env,owner),approval=ident(),expires=now()+180;
  await db(env).prepare('INSERT INTO official_update_approvals(id,user_id,digest,expires,used) VALUES(?,?,?,?,0)').bind(approval,owner,update.sha256,expires).run();
  return {review:{title:'Official FM-1 SysEx update',sha256:update.sha256,package_format:'.fwsc',expires,handoff:true},_approval:approval,message:'Review and open the official Windows updater. Select the official .fwsc package there; the vendor tool handles the MIDI/OTA transfer. No updater has been launched.'};
}
async function commitOfficial(env,owner,args){
  const approval=await db(env).prepare('SELECT * FROM official_update_approvals WHERE id=? AND user_id=?').bind(args.approval_id,owner).first();
  if(!approval)throw new PublicError('This approval was not found. Review the official update again.',409);
  if(approval.kind!=='vendor_handoff')throw new PublicError('This approval belongs to a different update method.',409);
  if(approval.used){const saved=await db(env).prepare('SELECT id,state FROM relay_tasks WHERE id=? AND user_id=?').bind(approval.id,owner).first();if(saved)return {request_id:saved.id,job_id:saved.id,delivery:saved.state};throw new PublicError('Approval was consumed; inspect the saved request.',409);}
  if(approval.expires<now())throw new PublicError('This approval has expired. Review the official update again.',409);
  const connection=await relayState(env);
  if(!connection.connected||!connection.allow_official_update)throw new PublicError('Official updating is disabled or the bench is disconnected.',403);
  const update=await officialState(env,owner);
  if(update.sha256!==approval.digest)throw new PublicError('The pinned updater changed. Refresh and review again.',409);
  const committedAt=now();
  await db(env).batch([
    db(env).prepare('INSERT INTO relay_tasks(id,user_id,operation,arguments,state,created) SELECT id,user_id,?,?,?,? FROM official_update_approvals WHERE id=? AND user_id=? AND used=0 AND expires>=?').bind('official_updater',JSON.stringify({expected_sha256:approval.digest,approval_expires:approval.expires}),'pending',committedAt,approval.id,owner,committedAt),
    db(env).prepare('UPDATE official_update_approvals SET used=1 WHERE id=? AND user_id=? AND used=0 AND expires>=?').bind(approval.id,owner,committedAt),
  ]);
  const saved=await db(env).prepare('SELECT id,state FROM relay_tasks WHERE id=? AND user_id=?').bind(approval.id,owner).first();
  if(!saved)throw new PublicError('This approval has expired. Review again.',409);
  return {request_id:saved.id,job_id:saved.id,delivery:saved.state,message:'Confirmed updater handoff saved. Inspect this ID; complete the update in the official Windows tool.'};
}
async function stockState(env,owner,connection){
  const snapshot=await inventorySnapshot(env,owner,connection),inventory=snapshot.inventory;
  if(snapshot.inventory_status.state!=='fresh')throw new PublicError('Refresh the device: stock updating needs fresh FM-1 MIDI inventory.',409);
  const engine=inventory?.engine,update=inventory?.device?.stock_update,mode=inventory?.device?.update_mode;
  if(engine?.active||engine?.blocked_unknown||engine?.storage_fault||engine?.updater_handoff||engine?.stock_baseline_invalidated)throw new PublicError('Resolve the saved bench job or establish a fresh baseline before a stock update.',409);
  if(mode?.mode==='ota_sysex')throw new PublicError('FM-1 is already in OTA mode. Inspect and recover the original transfer locally; a new update approval cannot resume it.',409);
  if(!update?.configured||!update.available||update.native_runtime!==true||update.sha256!==STOCK_PACKAGE_SHA256||update.size!==699956||update.identity!=='FM-1_015'||!stockPair(update.expected_stock_pair)||mode?.mode!=='sysex')throw new PublicError('The pinned stock package and native SysEx runtime need one recognized stock FM-1 MIDI connection. Custom CDC firmware must be restored separately first.',409);
  return update;
}
async function stagedStock(env,owner){
  const connection=await relayState(env);
  if(!connection.connected||!connection.allow_stock_update)throw new PublicError('Stock SysEx updating is disabled or the bench is disconnected.',403);
  const update=await stockState(env,owner,connection),approval=ident(),expires=now()+180;
  await db(env).prepare('INSERT INTO official_update_approvals(id,user_id,digest,expires,used,kind,route_review) VALUES(?,?,?,?,0,?,?)').bind(approval,owner,update.sha256,expires,'stock_sysex',JSON.stringify(update.expected_stock_pair)).run();
  return {review:{title:'Stock FM-1 firmware · V15',sha256:update.sha256,size:update.size,identity:update.identity,pair:update.expected_stock_pair,expires,handoff:false,readback_verified:false},_approval:approval,message:'Review the exact official package and stock MIDI connection, then confirm once. The local native worker handles SysEx/OTA; full flash readback is not supported.'};
}
async function commitStock(env,owner,args){
  const approval=await db(env).prepare('SELECT * FROM official_update_approvals WHERE id=? AND user_id=?').bind(args.approval_id,owner).first();
  if(!approval||approval.kind!=='stock_sysex')throw new PublicError('This stock update approval was not found. Review again.',409);
  if(approval.used){const saved=await db(env).prepare('SELECT id,state FROM relay_tasks WHERE id=? AND user_id=?').bind(approval.id,owner).first();if(saved)return {request_id:saved.id,job_id:saved.id,delivery:saved.state};throw new PublicError('Approval was consumed; inspect the original transfer.',409);}
  if(approval.expires<now())throw new PublicError('This approval has expired. Review the stock update again.',409);
  const connection=await relayState(env);
  if(!connection.connected||!connection.allow_stock_update)throw new PublicError('Stock SysEx updating is disabled or the bench is disconnected.',403);
  const update=await stockState(env,owner,connection),pair=JSON.parse(approval.route_review);
  if(update.sha256!==approval.digest||!stockPair(pair)||JSON.stringify(update.expected_stock_pair)!==JSON.stringify(pair))throw new PublicError('The package or stock MIDI route changed. Refresh and review again.',409);
  const committedAt=now(),argumentsValue={expected_sha256:approval.digest,expected_stock_pair:pair,endpoint_review_id:approval.id,approval_expires:approval.expires};
  await db(env).batch([
    db(env).prepare("INSERT INTO relay_tasks(id,user_id,operation,arguments,state,created) SELECT id,user_id,?,?,?,? FROM official_update_approvals WHERE id=? AND user_id=? AND kind='stock_sysex' AND used=0 AND expires>=?").bind('stock_sysex_update',JSON.stringify(argumentsValue),'pending',committedAt,approval.id,owner,committedAt),
    db(env).prepare("UPDATE official_update_approvals SET used=1 WHERE id=? AND user_id=? AND kind='stock_sysex' AND used=0 AND expires>=?").bind(approval.id,owner,committedAt),
  ]);
  const saved=await db(env).prepare('SELECT id,state FROM relay_tasks WHERE id=? AND user_id=?').bind(approval.id,owner).first();
  if(!saved)throw new PublicError('This approval expired. Review again.',409);
  return {request_id:saved.id,job_id:saved.id,delivery:saved.state,message:'Stock update saved. Follow this original transfer; never resubmit after a disconnect. Reboot identity and full readback are reported separately.'};
}
async function commitSwitch(env,owner,args){
  const approval=await db(env).prepare('SELECT * FROM switch_approvals WHERE id=? AND user_id=?').bind(args.approval_id,owner).first();
  if(!approval)throw new PublicError('This approval was not found. Review the app again.',409);
  if(approval.used){const previous=await db(env).prepare('SELECT id,state FROM relay_tasks WHERE id=? AND user_id=?').bind(approval.id,owner).first();if(previous)return {request_id:previous.id,job_id:previous.id,delivery:previous.state};throw new PublicError('Approval was already consumed; inspect the saved request.',409);}
  if(approval.expires<now())throw new PublicError('This approval has expired. Review the app again.',409);
  const connection=await relayState(env);
  if(!connection.connected||!connection.allow_switch)throw new PublicError('App switching is disabled or the bench is disconnected.',403);
  const catalog=await latest(env,owner,'catalog');
  const variant=catalog?.apps?.flatMap(app=>app.variants||[]).find(item=>item.id===approval.catalog_id);
  if(!variant?.ready||variant.sha256!==approval.digest)throw new PublicError('Package readiness changed. Refresh and review again.',409);
  // Approval consumption and queue insertion are one D1 transaction. The same
  // approval ID is also the durable bridge job ID; retries can only inspect it.
  const committedAt=now();
  await db(env).batch([
    db(env).prepare('INSERT INTO relay_tasks(id,user_id,operation,arguments,state,created) SELECT id,user_id,?,?,?,? FROM switch_approvals WHERE id=? AND user_id=? AND used=0 AND expires>=?').bind('switch_app',JSON.stringify({catalog_id:approval.catalog_id,entry_method:approval.entry_method,expected_sha256:approval.digest,approval_expires:approval.expires}),'pending',committedAt,approval.id,owner,committedAt),
    db(env).prepare('UPDATE switch_approvals SET used=1 WHERE id=? AND user_id=? AND used=0 AND expires>=?').bind(approval.id,owner,committedAt),
  ]);
  const saved=await db(env).prepare('SELECT id,state FROM relay_tasks WHERE id=? AND user_id=?').bind(approval.id,owner).first();
  if(!saved)throw new PublicError('This approval has expired. Review the app again.',409);
  return {request_id:saved.id,job_id:saved.id,delivery:saved.state,message:'Confirmed request saved. Follow this job ID; do not resubmit after a disconnect.'};
}
export async function callTool(env,owner,name,input){
  if(EXTENSION_TOOLS.includes(name))return callExtensionTool(env,owner,name,input);
  const args=validate(name,input);
  if(name==='open_fm1_library')return library(env,owner);
  if(name==='get_fm1_request'){
    const row=await db(env).prepare('SELECT * FROM relay_tasks WHERE id=? AND user_id=?').bind(args.request_id,owner).first();
    if(!row)throw new PublicError('Saved request was not found.',404);
    return parse(row);
  }
  if(name==='prepare_fm1_switch')return stagedSwitch(env,owner,args);
  if(name==='confirm_fm1_switch')return commitSwitch(env,owner,args);
  if(name==='prepare_fm1_official_update')return stagedOfficial(env,owner);
  if(name==='confirm_fm1_official_update')return commitOfficial(env,owner,args);
  if(name==='prepare_fm1_stock_update')return stagedStock(env,owner);
  if(name==='confirm_fm1_stock_update')return commitStock(env,owner,args);
  return enqueue(env,owner,{get_fm1_status:'status',get_fm1_input_snapshot:'input_snapshot',list_fm1_apps:'catalog',open_fm1_local_import:'open_local_import',plan_fm1_app:'plan_app',get_fm1_job:'job'}[name],args);
}
function localImportReceipt(value,id){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.id!==id||typeof value.opened!=='boolean'||value.device_io!==false||!Number.isInteger(value.expires_in)||value.expires_in<0||value.expires_in>300||(value.error!==undefined&&(typeof value.error!=='string'||!/^[a-z_]{1,80}$/.test(value.error))))throw new PublicError('Invalid local importer receipt.');
  return Object.fromEntries(['id','opened','device_io','expires_in','error'].filter(key=>key in value).map(key=>[key,value[key]]));
}
async function relayRequest(request,env,path){
  if(request.method!=='POST')return json({error:'POST required.'},405);
  const configured=env.FM1_RELAY_TOKEN;
  if(!configured||configured.length<32||request.headers.get('authorization')!=='Bearer '+configured)throw new PublicError('Relay authentication required.',401);
  const value=await body(request);
  if(path==='/relay/heartbeat'){
    if(!value||Object.keys(value).some(key=>!['allow_switch','allow_official_update','allow_stock_update'].includes(key))||typeof value.allow_switch!=='boolean'||['allow_official_update','allow_stock_update'].some(key=>value[key]!==undefined&&typeof value[key]!=='boolean'))throw new PublicError('Invalid heartbeat.');
    await db(env).prepare("INSERT INTO relay_state(id,last_seen,allow_switch,allow_official_update,allow_stock_update) VALUES('bench',?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,allow_switch=excluded.allow_switch,allow_official_update=excluded.allow_official_update,allow_stock_update=excluded.allow_stock_update").bind(now(),Number(value.allow_switch),Number(value.allow_official_update===true),Number(value.allow_stock_update===true)).run();
    return json({connected:true});
  }
  if(path==='/relay/poll'){
    if(!value||Object.keys(value).length)throw new PublicError('Poll takes no arguments.');
    const state=await relayState(env);
    if(!state.connected)return json({tasks:[],connected:false});
    await db(env).prepare("UPDATE relay_tasks SET state='failed',result=? WHERE state='pending' AND created<?").bind(JSON.stringify({status:'failed',error:'Request expired before bench delivery. Review and submit a fresh request deliberately.'}),now()-180).run();
    // Claimed requests may be delivered again after a disconnect, always with
    // the same ID. The agent's durable journal prevents another bridge POST.
    const task=await db(env).prepare("SELECT * FROM relay_tasks WHERE state='pending' OR (state='dispatched' AND dispatched<?) ORDER BY created,rowid LIMIT 1").bind(now()-15).first();
    if(!task)return json({tasks:[],connected:true});
    const claim=await db(env).prepare("UPDATE relay_tasks SET state='dispatched',dispatched=? WHERE id=? AND (state='pending' OR (state='dispatched' AND dispatched<?))").bind(now(),task.id,now()-15).run();
    if(!claim.meta?.changes)return json({tasks:[],connected:true});
    return json({connected:true,tasks:[{id:task.id,operation:task.operation,arguments:JSON.parse(task.arguments)}]});
  }
  if(path==='/relay/result'){
    if(!value||!ID.test(value.id||'')||!['succeeded','failed','unknown'].includes(value.status)||Object.keys(value).some(key=>!['id','status','data','error'].includes(key)))throw new PublicError('Invalid relay result.');
    const task=await db(env).prepare('SELECT * FROM relay_tasks WHERE id=?').bind(value.id).first();
    if(!task||task.state==='pending')throw new PublicError('Request was not dispatched.',409);
    const clean={status:value.status,...(value.data!==undefined?{data:task.operation==='open_local_import'?localImportReceipt(value.data,task.id):task.operation==='input_snapshot'?inputSample(value.data):sanitize(value.data)}:{}),...(value.error?{error:sanitize(String(value.error))}:{})};
    const encoded=JSON.stringify(clean);
    if(encoded.length>60000)throw new PublicError('Result is too large.',413);
    if(task.result){if(JSON.stringify(publicResult(task.result))!==encoded)throw new PublicError('A different result is already saved.',409);await rememberDiagnostics(env,task,clean);return json({saved:true});}
    const receipt=task.operation==='status'?INVENTORY_OBSERVED_FIELD:task.operation==='input_snapshot'?'_site_input_observed_at':null;
    const persisted=receipt&&clean.status==='succeeded'?JSON.stringify({...clean,[receipt]:now()}):encoded;
    const saved=await db(env).prepare('UPDATE relay_tasks SET state=?,result=? WHERE id=? AND result IS NULL').bind(value.status,persisted,value.id).run();
    if(!saved.meta?.changes){const current=await db(env).prepare('SELECT result FROM relay_tasks WHERE id=?').bind(value.id).first();if(!current?.result||JSON.stringify(publicResult(current.result))!==encoded)throw new PublicError('A different result is already saved.',409);}
    await rememberDiagnostics(env,task,clean);
    return json({saved:true});
  }
  throw new PublicError('Unknown relay route.',404);
}
async function mcp(request,env){
  safeOrigin(request,env);
  // Use the SDK's serving entry so modern per-request envelopes, discovery,
  // typed results and legacy stateless clients share the same registrations.
  // Authentication remains the Sites boundary's responsibility, not the SDK's.
  if(request.method==='POST'){
    const rpc=await body(request.clone());
    if(rpc?.method==='tools/call'||(rpc?.method==='resources/read'&&String(rpc.params?.uri||'').startsWith('fm1-forge:')))user(request);
  }
  const handler=createMcpHandler(()=>{
    const server=new McpServer({name:'FM-1 Forge',version:'3.3.0',icons:ICONS},{
      jsonSchemaValidator:new CfWorkerJsonSchemaValidator(),
      instructions:'Open FM-1 Forge through this installed plugin. Normal device actions use browser JavaScript; do not start Python or Node helpers. Configure USB/system, HAL and user modules and use Ask Codex to request a build; drafts and builds do not install firmware. Stock updates require review of the exact local package and fresh MIDI identity, followed by explicit panel confirmation. Recover the original saved attempt after a disconnect; never resubmit it as another write. Common firmware MIDI updating is experimental and requires local manifest/package review, exact build identity, firmware baseline validation and a qualified installation capability; normal builds leave installation disabled. Existing firmware without that interface uses manual UBOOT recovery and current-unit verification. Preserve the SDK-default CPU setting; nondefault LCD presets need device validation. Screen, sound and controls require separate physical acceptance.',
    });
    registerForgeExtensions(server,env,()=>user(request));
    for(const tool of TOOLS){
      const shape=Object.fromEntries(Object.entries(tool.inputSchema.properties).map(([key,schema])=>[
        key,schema.enum?z.enum(schema.enum):z.string().regex(new RegExp(schema.pattern)),
      ]));
      registerAppTool(server,tool.name,{title:tool.title,description:tool.description,
        inputSchema:z.object(shape).strict(),annotations:tool.annotations,icons:tool.icons,_meta:tool._meta||{}},async args=>{
        try{
          const data=await callTool(env,user(request),tool.name,args);
          if(data._approval){const {_approval,...publicData}=data;return {...result(publicData),_meta:{approval_id:_approval}};}
          return result(data);
        }catch(error){
          if(error instanceof PublicError)return {isError:true,content:[{type:'text',text:error.message}],structuredContent:{error:error.message}};
          console.error('FM-1 tool storage failure');
          return {isError:true,content:[{type:'text',text:'The library is temporarily unavailable.'}]};
        }
      });
    }
    // Older installed descriptors can still fetch the current panel at their
    // original URI. New descriptors exclusively advertise RESOURCE_URI.
    for(const uri of [RESOURCE_URI,'ui://fm1/forge-panel-v20.html','ui://fm1/forge-panel-v19.html','ui://fm1/forge-panel-v18.html','ui://fm1/forge-panel-v17.html','ui://fm1/forge-panel-v16.html','ui://fm1/forge-panel-v15.html','ui://fm1/forge-panel-v14.html','ui://fm1/forge-panel-v13.html','ui://fm1/forge-panel-v12.html','ui://fm1/forge-panel-v11.html','ui://fm1/forge-panel-v10.html','ui://fm1/forge-panel-v9.html','ui://fm1/forge-panel-v8.html','ui://fm1/forge-panel-v7.html','ui://fm1/forge-panel-v6.html','ui://fm1/forge-panel-v5.html','ui://fm1/forge-panel-v4.html','ui://fm1/forge-panel-v3.html','ui://fm1/forge-panel-v2.html','ui://fm1/forge-panel-v1.html','ui://fm1/app-library-v1.html','ui://fm1/device-panel-v2.html','ui://fm1/device-panel-v3.html','ui://fm1/device-panel-v4.html','ui://fm1/device-panel-v5.html','ui://fm1/device-panel-v6.html']){
      registerAppResource(server,'FM-1 Forge',uri,{},async()=>({contents:[{
        uri,mimeType:'text/html;profile=mcp-app',text:UI_HTML,
        _meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}},'openai/ui':OpenAIUiResourceMetadataSchema.parse({availableDisplayModes:['inline','fullscreen'],preferredDisplayMode:'fullscreen'})},
      }]}));
    }
    return server;
  },{legacy:'stateless',responseMode:'auto',maxRequestBodySize:65536,onerror:error=>console.error('FM-1 MCP serving failure:',sanitize(error.message))});
  const response=await handler.fetch(request);
  const headers=new Headers(response.headers);
  headers.set('Cache-Control','private, no-store');
  headers.set('X-Content-Type-Options','nosniff');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export async function handleFm1Request(request,env){
  const path=new URL(request.url).pathname;
  try{
    if(path==='/mcp')return await mcp(request,env);
    if(path.startsWith('/relay/'))return await relayRequest(request,env,path);
    if(path==='/api/fm1'){
      if(request.method!=='POST')return json({error:'POST required.'},405);
      safeOrigin(request,env);const owner=user(request);const input=await body(request);
      if(!input||Object.keys(input).some(key=>!['name','arguments'].includes(key)))throw new PublicError('Invalid tool request.');
      const data=await callTool(env,owner,input.name,input.arguments||{});
      return json(result(data));
    }
    if(path==='/'&&request.method==='GET')return new Response(UI_HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
    return null;
  }catch(error){if(!(error instanceof PublicError))console.error('FM-1 storage/request failure:',error instanceof Error?error.message:'Unknown error');return json({error:error instanceof PublicError?error.message:'The library is temporarily unavailable.'},error instanceof PublicError?error.status:503);}
}
