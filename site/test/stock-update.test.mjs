import test from 'node:test';
import assert from 'node:assert/strict';
import { callTool, handleFm1Request } from '../lib/fm1-server.mjs';
import { TOOLS, validate } from '../lib/fm1-contract.mjs';
import { database, connect, cacheInventory, seconds, digest } from './d1.mjs';

const stockHash='db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a';
const pair={inputName:'FM-1',outputName:'FM-1'};
const inventory=()=>({engine:{active:null,blocked_unknown:false,storage_fault:false,updater_handoff:false},device:{
  serial_ports:[],uboot_disks:[],update_mode:{mode:'sysex',official_available:true},
  stock_update:{configured:true,available:true,native_runtime:true,sha256:stockHash,size:699956,identity:'FM-1_015',expected_stock_pair:pair},
  official_update:{configured:true,available:true,sha256:digest},
}});
function bench(){const env=database();connect(env,false,true,true);cacheInventory(env,'alice',inventory());return env;}
const tasks=env=>env.DB.sqlite.prepare("SELECT * FROM relay_tasks WHERE operation='stock_sysex_update'").all();
async function relay(env,path,value){return handleFm1Request(new Request('https://fm1.test'+path,{method:'POST',headers:{'Content-Type':'application/json',authorization:'Bearer '+env.FM1_RELAY_TOKEN},body:JSON.stringify(value)}),env);}

test('stock confirmation is app-only and accepts no path, endpoint override, bytes or hash override',()=>{
  assert.deepEqual(TOOLS.find(tool=>tool.name==='confirm_fm1_stock_update')._meta.ui.visibility,['app']);
  for(const args of [{localPackagePath:'local'}, {messages:[1]}, {expected_stock_pair:pair}, {expected_sha256:stockHash}])assert.throws(()=>validate('prepare_fm1_stock_update',args));
  assert.deepEqual(validate('confirm_fm1_stock_update',{approval_id:'a'.repeat(32)}),{approval_id:'a'.repeat(32)});
});
test('stock review is a one-use exact package and route approval with no write before confirmation',async()=>{
  const env=bench(),review=await callTool(env,'alice','prepare_fm1_stock_update',{});
  assert.equal(review.review.sha256,stockHash);assert.equal(review.review.identity,'FM-1_015');assert.deepEqual(review.review.pair,pair);assert.equal(review.review.handoff,false);assert.equal(review.review.readback_verified,false);
  assert.equal(tasks(env).length,0);
  const first=await callTool(env,'alice','confirm_fm1_stock_update',{approval_id:review._approval});
  const saved=tasks(env)[0],args=JSON.parse(saved.arguments);
  assert.equal(saved.id,review._approval);assert.equal(args.expected_sha256,stockHash);assert.deepEqual(args.expected_stock_pair,pair);assert.equal(args.endpoint_review_id,review._approval);
  env.DB.sqlite.prepare('UPDATE relay_state SET last_seen=0').run();
  env.DB.sqlite.prepare('UPDATE official_update_approvals SET expires=1').run();
  assert.deepEqual(await callTool(env,'alice','confirm_fm1_stock_update',{approval_id:review._approval}),{request_id:first.request_id,job_id:first.job_id,delivery:'pending'});
  assert.equal(tasks(env).length,1);
});
test('stock capability, stale data, changed route, changed digest and expired approval stay unconsumed',async()=>{
  for(const change of [
    env=>env.DB.sqlite.prepare('UPDATE relay_state SET allow_stock_update=0').run(),
    env=>cacheInventory(env,'alice',inventory(),{observedAt:seconds()-16}),
    env=>{const data=inventory();data.device.stock_update.expected_stock_pair={inputName:'ota-FM-1',outputName:'ota-FM-1'};cacheInventory(env,'alice',data);},
    env=>{const data=inventory();data.device.stock_update.sha256=digest;cacheInventory(env,'alice',data);},
    env=>env.DB.sqlite.prepare('UPDATE official_update_approvals SET expires=1').run(),
    env=>{const data=inventory();data.engine.blocked_unknown=true;cacheInventory(env,'alice',data);},
  ]){
    const env=bench(),review=await callTool(env,'alice','prepare_fm1_stock_update',{});change(env);
    await assert.rejects(callTool(env,'alice','confirm_fm1_stock_update',{approval_id:review._approval}));
    assert.equal(env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,0);assert.equal(tasks(env).length,0);
  }
});
test('stock and vendor handoff approvals cannot be consumed through the other update method',async()=>{
  const env=bench(),stock=await callTool(env,'alice','prepare_fm1_stock_update',{}),vendor=await callTool(env,'alice','prepare_fm1_official_update',{});
  await assert.rejects(callTool(env,'alice','confirm_fm1_official_update',{approval_id:stock._approval}),/different/);
  await assert.rejects(callTool(env,'alice','confirm_fm1_stock_update',{approval_id:vendor._approval}),/not found/);
  await assert.rejects(callTool(env,'bob','confirm_fm1_stock_update',{approval_id:stock._approval}),/not found/);
  assert.equal(env.DB.sqlite.prepare('SELECT sum(used) AS n FROM official_update_approvals').get().n,0);
});
test('already-OTA inventory refuses a new approval even if an older bridge advertises ready metadata',async()=>{
  const env=bench(),review=await callTool(env,'alice','prepare_fm1_stock_update',{}),data=inventory();
  data.device.update_mode.mode='ota_sysex';data.device.stock_update.expected_stock_pair={inputName:'ota-FM-1 3',outputName:'ota-FM-1 4'};cacheInventory(env,'alice',data);
  await assert.rejects(callTool(env,'alice','prepare_fm1_stock_update',{}),/already in OTA.*original transfer/);
  await assert.rejects(callTool(env,'alice','confirm_fm1_stock_update',{approval_id:review._approval}),/already in OTA.*original transfer/);
  assert.equal(tasks(env).length,0);assert.equal(env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,0);
});
test('stock heartbeat is independent and older relay heartbeat clears the capability',async()=>{
  const env=database();assert.equal((await relay(env,'/relay/heartbeat',{allow_switch:false,allow_stock_update:true})).status,200);
  assert.equal((await callTool(env,'alice','open_fm1_library',{})).relay.allow_stock_update,true);
  assert.equal((await relay(env,'/relay/heartbeat',{allow_switch:false})).status,200);
  assert.equal((await callTool(env,'alice','open_fm1_library',{})).relay.allow_stock_update,false);
});
test('verified stock transfer invalidates cached diagnostics without inventing full readback proof',async()=>{
  const env=bench();env.DB.sqlite.prepare('INSERT INTO forge_baselines(user_id,job_id,sha256,verified_at) VALUES(?,?,?,?)').run('alice','f'.repeat(32),digest,seconds());
  const review=await callTool(env,'alice','prepare_fm1_stock_update',{});await callTool(env,'alice','confirm_fm1_stock_update',{approval_id:review._approval});
  assert.equal((await relay(env,'/relay/poll',{})).status,200);
  const report={id:review._approval,status:'succeeded',data:{id:review._approval,operation:'stock_sysex_update',status:'succeeded',result:{ok:true,data:{transfer_finished:true,boot_identity_verified:true,readback_verified:false}}}};
  assert.equal((await relay(env,'/relay/result',report)).status,200);
  assert.equal((await callTool(env,'alice','open_fm1_library',{})).forge.diagnostic_baseline,null);
  assert.equal((await callTool(env,'alice','get_fm1_request',{request_id:review._approval})).data.result.data.readback_verified,false);
});
