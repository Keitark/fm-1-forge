import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticProof } from '../lib/fm1-forge-baseline.mjs';
import { handleFm1Request, callTool } from '../lib/fm1-server.mjs';
import { database, connect, cacheCatalog, digest, seconds } from './d1.mjs';

const id='e'.repeat(32);
const task={id,operation:'switch_app',arguments:JSON.stringify({catalog_id:'factory-diag',expected_sha256:digest})};
function completed(){return {id,operation:'switch_app',status:'succeeded',updated:new Date().toISOString(),
  result:{ok:true,data:{catalog_id:'factory-diag',sha256:digest,profile:'FM1-FORGE/1',written_readback_verified:true,serial_boot_verified:true}},
  progress:{phase:'completed',failed:false,write_complete:true,full_readback_verified:true,boot_verified:true,total_sectors:96,verified_sectors:96}};}
test('proof requires exact identity, catalog, digest, firmware identity and all protected receipts',()=>{
  const good=completed();assert.equal(diagnosticProof(task,good,digest).job_id,id);
  const mutations=[j=>j.status='running',j=>j.id='f'.repeat(32),j=>j.operation='plan_app',j=>j.result.ok=false,
    j=>j.result.data.catalog_id='nes-test',j=>j.result.data.sha256='b'.repeat(64),j=>j.result.data.profile='NES',
    j=>j.result.data.written_readback_verified=false,j=>j.result.data.serial_boot_verified=false,
    j=>j.progress.write_complete=false,j=>j.progress.full_readback_verified=false,j=>j.progress.boot_verified=false,
    j=>j.progress.verified_sectors=95,j=>j.progress.total_sectors=0,j=>j.progress.failed=true,
    j=>j.updated='not a date',j=>j.updated=new Date(Date.now()+120000).toISOString()];
  for(const change of mutations){const job=structuredClone(good);change(job);assert.equal(diagnosticProof(task,job,digest),null);}
  assert.equal(diagnosticProof({...task,operation:'status'},good,digest),null);
  assert.equal(diagnosticProof({...task,arguments:JSON.stringify({catalog_id:'factory-diag',expected_sha256:'b'.repeat(64)})},good,digest),null);
  assert.equal(diagnosticProof({...task,operation:'job',arguments:JSON.stringify({job_id:id})},good,digest).job_id,id);
  assert.equal(diagnosticProof({...task,operation:'job',arguments:JSON.stringify({job_id:'f'.repeat(32)})},good,digest),null);
});
async function relay(env,path,value){const response=await handleFm1Request(new Request('https://fm1.test'+path,{method:'POST',headers:{'Content-Type':'application/json',authorization:'Bearer '+env.FM1_RELAY_TOKEN},body:JSON.stringify(value)}),env);return {status:response.status,data:await response.json()};}
test('diagnostic proof persists per owner beyond recent request history and survives duplicate ACK',async()=>{
  const env=database();connect(env);cacheCatalog(env,'alice',{apps:[{profile:'diagnostics',variants:[{id:'factory-diag',ready:true,sha256:digest}]}]});
  env.DB.sqlite.prepare('INSERT INTO relay_tasks(id,user_id,operation,arguments,state,created,dispatched) VALUES(?,?,?,?,?,?,?)').run(id,'alice','switch_app',task.arguments,'dispatched',seconds(),seconds());
  const report={id,status:'succeeded',data:completed()};
  for(let n=0;n<2;n++)assert.equal((await relay(env,'/relay/result',report)).status,200);
  const baseline=(await callTool(env,'alice','open_fm1_library',{})).forge.diagnostic_baseline;
  assert.equal(baseline.job_id,id);assert.equal(baseline.sha256,digest);assert.equal(baseline.boot_verified,true);
  for(let n=0;n<20;n++)env.DB.sqlite.prepare('INSERT INTO relay_tasks(id,user_id,operation,arguments,state,created) VALUES(?,?,?,?,?,?)').run(n.toString(16).padStart(32,'0'),'alice','status','{}','pending',seconds()+1);
  const library=await callTool(env,'alice','open_fm1_library',{});assert.ok(!library.recent_requests.some(t=>t.id===id));assert.deepEqual(library.forge.diagnostic_baseline,baseline);
  assert.equal((await callTool(env,'bob','open_fm1_library',{})).forge.diagnostic_baseline,null);
  assert.equal((await relay(env,'/relay/result',{...report,data:{...report.data,status:'failed'}})).status,409);
  assert.deepEqual((await callTool(env,'alice','open_fm1_library',{})).forge.diagnostic_baseline,baseline);
});
test('successful metadata delivery and matching card cannot unlock diagnostics without terminal receipt',async()=>{
  const env=database();connect(env);cacheCatalog(env,'alice',{apps:[{profile:'diagnostics',variants:[{id:'factory-diag',ready:true,sha256:digest}]}]});
  const queued=await callTool(env,'alice','get_fm1_job',{job_id:id});await relay(env,'/relay/poll',{});
  const job=completed();job.progress.full_readback_verified=false;
  assert.equal((await relay(env,'/relay/result',{id:queued.request_id,status:'succeeded',data:job})).status,200);
  assert.equal((await callTool(env,'alice','open_fm1_library',{})).forge.diagnostic_baseline,null);
});
