import test from 'node:test';
import assert from 'node:assert/strict';
import { callTool, handleFm1Request } from '../lib/fm1-server.mjs';
import { validate } from '../lib/fm1-contract.mjs';
import { inputSample, inputActivity } from '../lib/fm1-input-contract.mjs';
import { database, connect, seconds } from './d1.mjs';

const names=['SELECT','ALGORITHM','KNOB1','KNOB2','KNOB3','KNOB4','PRESETS'];
function sample(t=seconds()){
  return {state:'available',firmware:'FM1-FORGE/1',port:'COM4',capabilities:{keys:true,encoders:true,volume:true},
    keys:{pressed:'0000000000004000',seen:'0000000000004001',scans:200,errors:0},
    encoders:names.map((name,id)=>({id,name,edges:id-3,invalid:0,seen:id===2})),
    volume:{value:512,gain:63,valid:true,samples:300,errors:0},observation:{started_at:t,completed_at:t},message:'Input sample available.'};
}
async function relay(env,path,data){
  const response=await handleFm1Request(new Request('https://fm1.test'+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+env.FM1_RELAY_TOKEN},body:JSON.stringify(data)}),env);
  return {status:response.status,body:await response.json()};
}
async function deliver(env,owner='alice',data=sample()){
  const queued=await callTool(env,owner,'get_fm1_input_snapshot',{});
  await relay(env,'/relay/poll',{});
  assert.equal((await relay(env,'/relay/result',{id:queued.request_id,status:'succeeded',data})).status,200);
  return queued;
}

test('input sampler takes no caller-controlled commands or ports and coalesces separately by owner',async()=>{
  const env=database();connect(env,false,false);
  for(const input of [{port:'COM4'},{command:'UBOOT'},{sample:true}])assert.throws(()=>validate('get_fm1_input_snapshot',input));
  const [a,b]=await Promise.all([callTool(env,'alice','get_fm1_input_snapshot',{}),callTool(env,'alice','get_fm1_input_snapshot',{})]);
  assert.equal(a.request_id,b.request_id);
  const status=await callTool(env,'alice','get_fm1_status',{}),other=await callTool(env,'bob','get_fm1_input_snapshot',{});
  assert.notEqual(status.request_id,a.request_id);assert.notEqual(other.request_id,a.request_id);
  assert.deepEqual((await relay(env,'/relay/poll',{})).body.tasks[0],{id:a.request_id,operation:'input_snapshot',arguments:{}});
  assert.equal((await callTool(env,'alice','get_fm1_input_snapshot',{})).request_id,a.request_id);
  await assert.rejects(callTool(env,'bob','get_fm1_request',{request_id:a.request_id}),/not found/);
});

test('a normalized input sample preserves identity and owner scope without altering passive inventory or boot proof',async()=>{
  const env=database();connect(env);const payload=sample(),queued=await deliver(env,'alice',payload);
  const library=await callTool(env,'alice','open_fm1_library',{});
  assert.deepEqual(library.input_activity.sample,payload);assert.equal(library.input_activity.state,'fresh');
  assert.equal(library.input_activity.request_id,queued.request_id);assert.equal(library.inventory,null);assert.equal(library.forge.diagnostic_baseline,null);
  assert.equal((await callTool(env,'bob','open_fm1_library',{})).input_activity.sample,null);
  const saved=await callTool(env,'alice','get_fm1_request',{request_id:queued.request_id});
  assert.equal(saved.data.firmware,'FM1-FORGE/1');assert.ok(!JSON.stringify(saved).includes('_site_input_observed_at'));
  assert.ok(!JSON.stringify(library.recent_requests).includes('_site_input_observed_at'));
});

test('duplicate acknowledgments do not renew old input observations',async()=>{
  const env=database();connect(env);const old=seconds()-16,data=sample(old),queued=await callTool(env,'alice','get_fm1_input_snapshot',{});
  env.DB.sqlite.prepare('UPDATE relay_tasks SET created=? WHERE id=?').run(old,queued.request_id);
  await relay(env,'/relay/poll',{});
  const report={id:queued.request_id,status:'succeeded',data};assert.equal((await relay(env,'/relay/result',report)).status,200);
  const row=env.DB.sqlite.prepare('SELECT result FROM relay_tasks WHERE id=?').get(queued.request_id),receipt=JSON.parse(row.result)._site_input_observed_at;
  assert.equal((await relay(env,'/relay/result',report)).status,200);
  assert.equal(JSON.parse(env.DB.sqlite.prepare('SELECT result FROM relay_tasks WHERE id=?').get(queued.request_id).result)._site_input_observed_at,receipt);
  const activity=(await callTool(env,'alice','open_fm1_library',{})).input_activity;
  assert.equal(activity.state,'stale');assert.ok(activity.age_seconds>=16);
  assert.equal((await relay(env,'/relay/result',{...report,data:{...data,message:'Different'}})).status,409);
});

test('freshness rejects impossible source intervals, future receipt and replay while respecting an actual delayed scan',()=>{
  const t=1000,payload=sample(t),row={id:'a'.repeat(32),state:'succeeded',created:t,result:JSON.stringify({status:'succeeded',data:payload,_site_input_observed_at:t})};
  assert.equal(inputActivity(row,{connected:true},t+15).state,'fresh');assert.equal(inputActivity(row,{connected:true},t+16).state,'stale');
  assert.equal(inputActivity(row,{connected:false},t).state,'stale');
  for(const [start,end,receipt,created] of [[t-1,t,t,t],[t+1,t+1,t,t],[t,t-1,t,t],[t,t,t+1,t]]){
    const changed={...row,created,result:JSON.stringify({status:'succeeded',data:{...payload,observation:{started_at:start,completed_at:end}},_site_input_observed_at:receipt})};
    assert.notEqual(inputActivity(changed,{connected:true},t).state,'fresh');
  }
  assert.equal(inputActivity({...row,created:t-100},{connected:true},t).state,'fresh');
  assert.equal(inputActivity({...row,result:JSON.stringify({status:'succeeded',data:payload})},{connected:true},t).state,'stale');
});

test('malformed inputs, firmware payloads and fabricated unsupported activity are rejected',()=>{
  const base=sample();
  const invalid=[{...base,image:'00'},{...base,firmware:'firmware bytes'}, {...base,keys:{...base.keys,pressed:'ffffffffffffffff'}},
    {...base,encoders:base.encoders.slice(1)}, {...base,encoders:base.encoders.map((knob,id)=>id===0?{...knob,id:1}:knob)},
    {...base,volume:{...base.volume,value:1024}}, {...base,volume:{...base.volume,gain:128}}, {...base,message:'C:\\private\\token'},
    {...base,state:'unsupported'}, {...base,firmware:'MOD-EDITOR/1'}, {...base,observation:{started_at:0,completed_at:0}}];
  for(const data of invalid)assert.throws(()=>inputSample(data),/Invalid hardware/);
  const mod={...base,state:'unsupported',firmware:'MOD-EDITOR/1',capabilities:{keys:false,encoders:false,volume:true},keys:null,encoders:null};
  assert.deepEqual(inputSample(mod),mod);
  const unavailable={...mod,state:'busy',firmware:null,port:null,capabilities:{keys:false,encoders:false,volume:false},volume:null};
  assert.deepEqual(inputSample(unavailable),unavailable);
});

test('pending inputs preserve the last sample; failed terminal sample takes precedence',async()=>{
  const env=database();connect(env);await deliver(env);const next=await callTool(env,'alice','get_fm1_input_snapshot',{});
  assert.equal((await callTool(env,'alice','open_fm1_library',{})).input_activity.state,'fresh');
  await relay(env,'/relay/poll',{});assert.equal((await relay(env,'/relay/result',{id:next.request_id,status:'failed',error:'input unavailable'})).status,200);
  const activity=(await callTool(env,'alice','open_fm1_library',{})).input_activity;
  assert.equal(activity.state,'error');assert.equal(activity.sample,null);assert.equal(activity.request_id,next.request_id);
});
