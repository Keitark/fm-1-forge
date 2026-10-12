import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFm1Request, callTool } from '../lib/fm1-server.mjs';
import { RESOURCE_URI, TOOLS, validate, sanitize } from '../lib/fm1-contract.mjs';
import { database, connect, cacheCatalog, cacheInventory, catalog, digest, seconds } from './d1.mjs';

async function request(env,path,value,{owner='alice',relay=false,origin,method='POST'}={}){
  const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
  if(owner)headers['oai-authenticated-user-id']=owner;
  if(relay)headers.authorization='Bearer '+env.FM1_RELAY_TOKEN;
  if(origin)headers.origin=origin;
  const response=await handleFm1Request(new Request('https://fm1.test'+path,{method,headers,...(method==='POST'?{body:JSON.stringify(value)}:{})}),env);
  const raw=await response.text();
  const data=response.headers.get('content-type')?.includes('text/event-stream')?raw.split('\n').filter(line=>line.startsWith('data: ')).at(-1)?.slice(6):raw;
  return {status:response.status,body:data?JSON.parse(data):null};
}
const api=(env,name,args={},options)=>request(env,'/api/fm1',{name,arguments:args},options);
const rpc=(env,method,params={},options)=>request(env,'/mcp',{jsonrpc:'2.0',id:7,method,params:method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'FM1 test',version:'1'},...params}:params},options);
test('generated migration creates expected durable storage',()=>{const env=database();assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,7);});
test('private user authentication is required for API and MCP tool execution',async()=>{const env=database();assert.equal((await api(env,'open_fm1_library',{}, {owner:null})).status,401);assert.equal((await rpc(env,'tools/call',{name:'open_fm1_library'},{owner:null})).status,401);});
test('foreign origin is rejected on both transports',async()=>{const env=database();assert.equal((await api(env,'open_fm1_library',{}, {origin:'https://evil.test'})).status,403);assert.equal((await rpc(env,'initialize',{}, {origin:'https://evil.test'})).status,403);});
test('disconnected library shows diagnostics and five app profiles without an invented baseline',async()=>{const env=database();const data=await callTool(env,'alice','open_fm1_library',{});assert.equal(data.profiles.length,6);assert.equal(data.profiles[0].profile,'diagnostics');assert.equal(data.relay.connected,false);assert.equal(data.catalog,null);assert.equal(data.forge.diagnostic_baseline,null);});
test('disconnected metadata requests are not queued',async()=>{const env=database();await assert.rejects(callTool(env,'alice','get_fm1_status',{}),/offline/);assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM relay_tasks').get().n,0);});
test('strict catalog IDs and arguments match bench contract',()=>{for(const id of ['NES','../nes','a'.repeat(65),''])assert.throws(()=>validate('plan_fm1_app',{catalog_id:id}));assert.deepEqual(validate('plan_fm1_app',{catalog_id:'nes-test'}),{catalog_id:'nes-test'});assert.throws(()=>validate('get_fm1_status',{path:'local'}));assert.throws(()=>validate('confirm_fm1_switch',{approval_id:'x'}));});
test('relay requires separate bearer and valid heartbeat',async()=>{const env=database();assert.equal((await request(env,'/relay/heartbeat',{allow_switch:false})).status,401);assert.equal((await request(env,'/relay/heartbeat',{allow_switch:'yes'},{relay:true})).status,400);assert.equal((await request(env,'/relay/heartbeat',{allow_switch:false},{relay:true})).status,200);});
test('headerless multibyte relay results enforce the exact 65536-byte request limit',async()=>{
  const env=database();connect(env);
  const queued=await callTool(env,'alice','get_fm1_status',{});
  await request(env,'/relay/poll',{}, {relay:true});
  const report={id:queued.request_id,status:'succeeded',data:{note:'あ'.repeat(21000)}};
  const encoder=new TextEncoder();
  report.data.note+='x'.repeat(65536-encoder.encode(JSON.stringify(report)).byteLength);
  const accepted=JSON.stringify(report);
  report.data.note+='x';
  const oversized=JSON.stringify(report);
  assert.equal(encoder.encode(accepted).byteLength,65536);
  assert.equal(encoder.encode(oversized).byteLength,65537);
  assert.ok(oversized.length<65536);
  const submit=async raw=>{
    const input=new Request('https://fm1.test/relay/result',{method:'POST',
      headers:{'Content-Type':'application/json',authorization:'Bearer '+env.FM1_RELAY_TOKEN},body:raw});
    assert.equal(input.headers.has('content-length'),false);
    return handleFm1Request(input,env);
  };
  const rejected=await submit(oversized);
  assert.equal(rejected.status,413);
  assert.deepEqual(await rejected.json(),{error:'Request too large.'});
  assert.equal(env.DB.sqlite.prepare('SELECT result FROM relay_tasks WHERE id=?').get(queued.request_id).result,null);
  const boundary=await submit(accepted);
  assert.equal(boundary.status,200);
  assert.deepEqual(await boundary.json(),{saved:true});
  assert.equal((await callTool(env,'alice','get_fm1_request',{request_id:queued.request_id})).state,'succeeded');
});
test('queue claim, metadata result and duplicate acknowledgment roundtrip',async()=>{const env=database();connect(env);const queued=await callTool(env,'alice','get_fm1_status',{});const poll=await request(env,'/relay/poll',{}, {relay:true});assert.equal(poll.body.tasks[0].id,queued.request_id);assert.equal(poll.body.tasks[0].operation,'status');assert.equal((await request(env,'/relay/poll',{}, {relay:true})).body.tasks.length,0);const report={id:queued.request_id,status:'succeeded',data:{engine:{active:false}}};for(let i=0;i<2;i++)assert.deepEqual((await request(env,'/relay/result',report,{relay:true})).body,{saved:true});const saved=await callTool(env,'alice','get_fm1_request',{request_id:queued.request_id});assert.equal(saved.state,'succeeded');assert.equal(saved.data.engine.active,false);});
test('conflicting relay result never overwrites saved outcome',async()=>{const env=database();connect(env);const queued=await callTool(env,'alice','get_fm1_status',{});await request(env,'/relay/poll',{}, {relay:true});await request(env,'/relay/result',{id:queued.request_id,status:'unknown',error:'uncertain'},{relay:true});assert.equal((await request(env,'/relay/result',{id:queued.request_id,status:'succeeded',data:{}},{relay:true})).status,409);assert.equal((await callTool(env,'alice','get_fm1_request',{request_id:queued.request_id})).state,'unknown');});
test('result cannot be saved before dispatch',async()=>{const env=database();connect(env);const queued=await callTool(env,'alice','get_fm1_status',{});assert.equal((await request(env,'/relay/result',{id:queued.request_id,status:'succeeded',data:{}},{relay:true})).status,409);});
test('dispatched retry keeps the exact ID',async()=>{const env=database();connect(env);const queued=await callTool(env,'alice','get_fm1_job',{job_id:'e'.repeat(32)});await request(env,'/relay/poll',{}, {relay:true});env.DB.sqlite.prepare('UPDATE relay_tasks SET dispatched=?').run(seconds()-16);const retry=await request(env,'/relay/poll',{}, {relay:true});assert.deepEqual(retry.body.tasks[0],{id:queued.request_id,operation:'job',arguments:{job_id:'e'.repeat(32)}});});
test('pending requests expire without reaching the bench',async()=>{const env=database();connect(env);const queued=await callTool(env,'alice','get_fm1_status',{});env.DB.sqlite.prepare('UPDATE relay_tasks SET created=?').run(seconds()-181);assert.equal((await request(env,'/relay/poll',{}, {relay:true})).body.tasks.length,0);assert.equal((await callTool(env,'alice','get_fm1_request',{request_id:queued.request_id})).state,'failed');});
test('saved requests and catalogs are user scoped',async()=>{const env=database();cacheCatalog(env);assert.equal((await callTool(env,'bob','open_fm1_library',{})).catalog,null);await assert.rejects(callTool(env,'bob','get_fm1_request',{request_id:'c'.repeat(32)}),/not found/);});
test('metadata sanitization removes private paths, credentials and firmware',()=>{assert.deepEqual(sanitize({token:'secret',image_hex:'00',target:'port',path:'private',profile:'nes',sha256:digest,nested:{text:'C:\\private\\file',note:'Bearer secret'}}),{profile:'nes',sha256:digest,nested:{text:'[local detail omitted]',note:'[local detail omitted]'}});});
test('delivery success preserves an authoritative unknown bridge job',async()=>{const env=database();connect(env);const queued=await callTool(env,'alice','plan_fm1_app',{catalog_id:'nes-test'});await request(env,'/relay/poll',{}, {relay:true});await request(env,'/relay/result',{id:queued.request_id,status:'succeeded',data:{id:queued.job_id,status:'unknown',token:'hidden'}},{relay:true});const saved=await callTool(env,'alice','get_fm1_request',{request_id:queued.request_id});assert.equal(saved.state,'succeeded');assert.equal(saved.data.status,'unknown');assert.ok(!('token' in saved.data));});
test('disabled switching cannot create approvals',async()=>{const env=database();connect(env,false);cacheCatalog(env);await assert.rejects(callTool(env,'alice','prepare_fm1_switch',{catalog_id:'nes-test',entry_method:'serial'}),/disabled/);});
test('review is nonce-free in MCP public output and does not queue a write',async()=>{const env=database();connect(env);cacheCatalog(env);const response=await rpc(env,'tools/call',{name:'prepare_fm1_switch',arguments:{catalog_id:'nes-test',entry_method:'serial'}});assert.equal(response.body.result.structuredContent.review.sha256,digest);assert.equal(response.body.result._meta.approval_id.length,32);assert.ok(!JSON.stringify(response.body.result.structuredContent).includes(response.body.result._meta.approval_id));assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='switch_app'").get().n,0);});
test('one approval queues one immutable-digest switch and retries same ID',async()=>{const env=database();connect(env);cacheCatalog(env);const prepared=await callTool(env,'alice','prepare_fm1_switch',{catalog_id:'nes-test',entry_method:'already_uboot'});const input={approval_id:prepared._approval};const saved=await callTool(env,'alice','confirm_fm1_switch',input);const repeated=await callTool(env,'alice','confirm_fm1_switch',input);assert.equal(saved.request_id,repeated.request_id);const task=env.DB.sqlite.prepare("SELECT * FROM relay_tasks WHERE operation='switch_app'").get();assert.deepEqual(JSON.parse(task.arguments),{catalog_id:'nes-test',entry_method:'already_uboot',expected_sha256:digest,approval_expires:prepared.review.expires});assert.equal(task.id,prepared._approval);});
test('consumed approval retry survives expiry and offline relay',async()=>{const env=database();connect(env);cacheCatalog(env);const p=await callTool(env,'alice','prepare_fm1_switch',{catalog_id:'nes-test',entry_method:'serial'});await callTool(env,'alice','confirm_fm1_switch',{approval_id:p._approval});env.DB.sqlite.prepare('UPDATE switch_approvals SET expires=0').run();env.DB.sqlite.prepare('DELETE FROM relay_state').run();assert.equal((await callTool(env,'alice','confirm_fm1_switch',{approval_id:p._approval})).request_id,p._approval);});
test('unconsumed expired approval remains unconsumed and unqueued',async()=>{const env=database();connect(env);cacheCatalog(env);const p=await callTool(env,'alice','prepare_fm1_switch',{catalog_id:'nes-test',entry_method:'serial'});env.DB.sqlite.prepare('UPDATE switch_approvals SET expires=0').run();await assert.rejects(callTool(env,'alice','confirm_fm1_switch',{approval_id:p._approval}),/expired/);assert.equal(env.DB.sqlite.prepare('SELECT used FROM switch_approvals').get().used,0);});
test('transaction deadline cannot consume approval without task',async()=>{const env=database();connect(env);cacheCatalog(env);const p=await callTool(env,'alice','prepare_fm1_switch',{catalog_id:'nes-test',entry_method:'serial'});const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=sql=>{if(sql.startsWith('INSERT INTO relay_tasks')&&sql.includes('SELECT id,user_id'))env.DB.sqlite.prepare('UPDATE switch_approvals SET expires=0').run();return prepare(sql);};await assert.rejects(callTool(env,'alice','confirm_fm1_switch',{approval_id:p._approval}),/expired/);assert.equal(env.DB.sqlite.prepare('SELECT used FROM switch_approvals').get().used,0);assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='switch_app'").get().n,0);});
test('changed digest and cross-user approval are rejected',async()=>{const env=database();connect(env);cacheCatalog(env);const p=await callTool(env,'alice','prepare_fm1_switch',{catalog_id:'nes-test',entry_method:'serial'});await assert.rejects(callTool(env,'bob','confirm_fm1_switch',{approval_id:p._approval}),/not found/);const changed=structuredClone(catalog);changed.apps[0].variants[0].sha256='b'.repeat(64);cacheCatalog(env,'alice',changed);await assert.rejects(callTool(env,'alice','confirm_fm1_switch',{approval_id:p._approval}),/changed/);});
test('MCP initialize, notifications, discovery and inline app resource',async()=>{const env=database();const init=await rpc(env,'initialize');assert.equal(init.body.id,7);assert.equal(init.body.result.protocolVersion,'2025-11-25');assert.ok(init.body.result.serverInfo.icons[0].src.startsWith('data:image/'));assert.equal((await request(env,'/mcp',{jsonrpc:'2.0',method:'notifications/initialized'})).status,202);const tools=(await rpc(env,'tools/list')).body.result.tools;assert.equal(tools.length,19);for(const name of ['confirm_fm1_switch','confirm_fm1_official_update','open_fm1_local_import'])assert.deepEqual(tools.find(t=>t.name===name)._meta.ui.visibility,['app']);const read=(await rpc(env,'resources/read',{uri:RESOURCE_URI})).body.result.contents[0];assert.equal(read.mimeType,'text/html;profile=mcp-app');assert.ok(read.text.includes('ui/resource-teardown'));assert.deepEqual(read._meta.ui.csp,{connectDomains:[],resourceDomains:[]});assert.equal((await request(env,'/mcp',null,{method:'GET'})).status,405);});

test('local importer requires a connected bench and accepts no local path or payload',async()=>{
  const env=database();await assert.rejects(callTool(env,'alice','open_fm1_local_import',{}),/offline/);
  connect(env,false,false);
  for(const args of [{path:'F:\\private'}, {url:'https://other.test'}, {bundles:[]}, {image:'raw'}])await assert.rejects(callTool(env,'alice','open_fm1_local_import',args),/arguments/);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM relay_tasks').get().n,0);
  assert.deepEqual(validate('open_fm1_local_import',{}),{});
});
test('local importer launch is owner scoped and coalesced without transfer approvals',async()=>{
  const env=database();connect(env,false,false);
  const [first,second]=await Promise.all([callTool(env,'alice','open_fm1_local_import',{}),callTool(env,'alice','open_fm1_local_import',{})]);
  assert.equal(first.request_id,second.request_id);
  const bob=await callTool(env,'bob','open_fm1_local_import',{});assert.notEqual(first.request_id,bob.request_id);
  await assert.rejects(callTool(env,'bob','get_fm1_request',{request_id:first.request_id}),/not found/);
  const tasks=env.DB.sqlite.prepare('SELECT * FROM relay_tasks ORDER BY rowid').all();assert.equal(tasks.length,2);
  assert.ok(tasks.every(task=>task.operation==='open_local_import'&&task.arguments==='{}'));
  for(const table of ['switch_approvals','official_update_approvals'])assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM '+table).get().n,0);
  const poll=await request(env,'/relay/poll',{}, {relay:true});assert.deepEqual(poll.body.tasks,[{id:first.request_id,operation:'open_local_import',arguments:{}}]);
  env.DB.sqlite.prepare('UPDATE relay_tasks SET dispatched=? WHERE id=?').run(seconds()-16,first.request_id);
  const retry=await request(env,'/relay/poll',{}, {relay:true});assert.deepEqual(retry.body.tasks,poll.body.tasks);
});
test('local importer receipt excludes local authority and preserves a saved uncertain outcome',async()=>{
  const env=database();connect(env);const queued=await callTool(env,'alice','open_fm1_local_import',{});
  await request(env,'/relay/poll',{}, {relay:true});
  const report={id:queued.request_id,status:'unknown',data:{id:queued.request_id,opened:false,device_io:false,expires_in:300,error:'local_import_launch_unknown',
    url:'http://127.0.0.1:9770/#secret',path:'F:\\private',token:'secret',image:'raw'}};
  assert.deepEqual((await request(env,'/relay/result',report,{relay:true})).body,{saved:true});
  const saved=await callTool(env,'alice','get_fm1_request',{request_id:queued.request_id});assert.equal(saved.state,'unknown');
  assert.deepEqual(saved.data,{id:queued.request_id,opened:false,device_io:false,expires_in:300,error:'local_import_launch_unknown'});
  assert.deepEqual((await request(env,'/relay/result',report,{relay:true})).body,{saved:true});
  assert.equal((await request(env,'/relay/result',{...report,status:'succeeded'},{relay:true})).status,409);
});
test('local importer rejects a mismatched or unsafe bridge receipt',async()=>{
  const env=database();connect(env);const queued=await callTool(env,'alice','open_fm1_local_import',{});
  await request(env,'/relay/poll',{}, {relay:true});
  const data={id:queued.request_id,opened:true,device_io:false,expires_in:300};
  for(const fields of [{id:'f'.repeat(32)}, {opened:'yes'}, {device_io:true}, {expires_in:301}, {error:'C:\\private\\exception'}])assert.equal((await request(env,'/relay/result',{id:queued.request_id,status:'succeeded',data:{...data,...fields}},{relay:true})).status,400);
  assert.equal(env.DB.sqlite.prepare('SELECT result FROM relay_tasks WHERE id=?').get(queued.request_id).result,null);
});
test('saved local sets remain metadata only, owner scoped and backward compatible',async()=>{
  const env=database();connect(env);cacheCatalog(env);
  assert.deepEqual((await callTool(env,'alice','open_fm1_library',{})).catalog.apps,catalog.apps);
  const queued=await callTool(env,'alice','list_fm1_apps',{});await request(env,'/relay/poll',{}, {relay:true});
  const sets=[{id:'a'.repeat(32),name:'My apps',members:[{id:'nes-test',profile:'nes',title:'NES',variant:'local',sha256:digest,path:'F:\\private',image:'raw'}],imported:seconds(),device_io:false,token:'secret'}];
  await request(env,'/relay/result',{id:queued.request_id,status:'succeeded',data:{...catalog,sets}},{relay:true});
  const library=await callTool(env,'alice','open_fm1_library',{});assert.deepEqual(library.catalog.apps,catalog.apps);
  assert.equal(library.catalog.sets[0].name,'My apps');assert.equal(library.catalog.sets[0].members[0].sha256,digest);
  assert.ok(!JSON.stringify(library.catalog).includes('secret'));assert.ok(!JSON.stringify(library.catalog).includes('private'));
  assert.ok(!('image' in library.catalog.sets[0].members[0]));assert.equal((await callTool(env,'bob','open_fm1_library',{})).catalog,null);
});
test('unknown JSON-RPC method and tool input produce explicit errors',async()=>{const env=database();assert.equal((await rpc(env,'arbitrary/exec')).body.error.code,-32601);const answer=await rpc(env,'tools/call',{name:'plan_fm1_app',arguments:{catalog_id:'../'}});assert.equal(answer.body.result.isError,true);});
test('server requires DB binding and never creates schema in requests',async()=>{const env=database();delete env.DB;assert.equal((await api(env,'open_fm1_library')).status,503);});

const serialInventory={engine:{active:null,blocked_unknown:false,storage_fault:false},device:{serial_ports:[{port:'COM10'}],uboot_disks:[],midi_endpoints:[],update_mode:{mode:'serial',app_entry_method:'serial'}}};
const absentInventory={engine:{active:null,blocked_unknown:false,storage_fault:false},device:{serial_ports:[],uboot_disks:[],midi_endpoints:[],update_mode:{mode:'disconnected',app_entry_method:null}}};
async function statusReport(env,{owner='alice',status='succeeded',data=serialInventory}={}){
  const queued=await callTool(env,owner,'get_fm1_status',{});
  await request(env,'/relay/poll',{}, {relay:true});
  const report={id:queued.request_id,status,...(status==='succeeded'?{data}:{error:'metadata unavailable'})};
  assert.equal((await request(env,'/relay/result',report,{relay:true})).status,200);
  return {queued,report};
}

test('inventory freshness is explicit and unavailable before the owner receives status metadata',async()=>{
  const env=database();connect(env);
  const snapshot=await callTool(env,'alice','open_fm1_library',{});
  assert.equal(snapshot.inventory,null);
  assert.deepEqual(snapshot.inventory_status,{state:'unavailable',observed_at:null,age_seconds:null,max_age_seconds:15,request_id:null});
  assert.equal(snapshot.relay.connected,true);
});

test('a successful status ACK stores its first Site receipt and retains the original queue age bound',async()=>{
  const env=database();connect(env);
  const queued=await callTool(env,'alice','get_fm1_status',{});
  env.DB.sqlite.prepare('UPDATE relay_tasks SET created=? WHERE id=?').run(seconds()-5,queued.request_id);
  await request(env,'/relay/poll',{}, {relay:true});
  const before=seconds(),report={id:queued.request_id,status:'succeeded',data:serialInventory};
  assert.equal((await request(env,'/relay/result',report,{relay:true})).status,200);
  const snapshot=await callTool(env,'alice','open_fm1_library',{});
  assert.equal(snapshot.inventory_status.state,'fresh');assert.equal(snapshot.inventory_status.request_id,queued.request_id);
  assert.ok(snapshot.inventory_status.observed_at>=before&&snapshot.inventory_status.observed_at<=seconds());assert.ok(snapshot.inventory_status.age_seconds>=5&&snapshot.inventory_status.age_seconds<=6);
  assert.deepEqual(snapshot.inventory,serialInventory);
  const saved=await callTool(env,'alice','get_fm1_request',{request_id:queued.request_id});
  assert.ok(!Object.hasOwn(saved,'_site_inventory_observed_at'));assert.ok(!JSON.stringify(snapshot.recent_requests).includes('_site_inventory_observed_at'));
});

test('a newly acknowledged old relay outbox sample remains stale rather than renewing device presence',async()=>{
  const env=database();connect(env);
  const queued=await callTool(env,'alice','get_fm1_status',{});
  // Claim promptly, sample the device, then model an hours-delayed Site ACK.
  await request(env,'/relay/poll',{}, {relay:true});
  env.DB.sqlite.prepare('UPDATE relay_tasks SET created=?,dispatched=? WHERE id=?').run(seconds()-7200,seconds(),queued.request_id);
  const before=seconds();assert.equal((await request(env,'/relay/result',{id:queued.request_id,status:'succeeded',data:serialInventory},{relay:true})).status,200);
  const snapshot=await callTool(env,'alice','open_fm1_library',{});
  assert.equal(snapshot.inventory_status.state,'stale');assert.ok(snapshot.inventory_status.observed_at>=before);assert.ok(snapshot.inventory_status.age_seconds>=7200);assert.equal(snapshot.inventory.device.serial_ports[0].port,'COM10');
});

test('duplicate status acknowledgments preserve the original observation and cannot renew stale inventory',async()=>{
  const env=database();connect(env);const {queued,report}=await statusReport(env);
  const row=env.DB.sqlite.prepare('SELECT result FROM relay_tasks WHERE id=?').get(queued.request_id),stored=JSON.parse(row.result);
  const original=seconds()-60;stored._site_inventory_observed_at=original;
  env.DB.sqlite.prepare('UPDATE relay_tasks SET result=? WHERE id=?').run(JSON.stringify(stored),queued.request_id);
  assert.equal((await request(env,'/relay/result',report,{relay:true})).status,200);
  const snapshot=await callTool(env,'alice','open_fm1_library',{});
  assert.equal(snapshot.inventory_status.state,'stale');assert.equal(snapshot.inventory_status.observed_at,original);assert.ok(snapshot.inventory_status.age_seconds>=60);
  assert.equal(JSON.parse(env.DB.sqlite.prepare('SELECT result FROM relay_tasks WHERE id=?').get(queued.request_id).result)._site_inventory_observed_at,original);
  assert.equal((await request(env,'/relay/result',{...report,data:absentInventory},{relay:true})).status,409);
});

test('legacy inventory without a receipt timestamp and expired observations remain saved but stale',async()=>{
  for(const observedAt of [null,seconds()-16]){
    const env=database();connect(env);cacheInventory(env,'alice',serialInventory,{observedAt});
    const snapshot=await callTool(env,'alice','open_fm1_library',{});
    assert.equal(snapshot.relay.connected,true);assert.equal(snapshot.inventory_status.state,'stale');assert.deepEqual(snapshot.inventory,serialInventory);
    assert.equal(snapshot.inventory_status.observed_at,observedAt);assert.equal(snapshot.inventory_status.max_age_seconds,15);
    if(observedAt===null)assert.equal(snapshot.inventory_status.age_seconds,null);
  }
});

test('relay heartbeat health never renews inventory or claims that FM1 is physically present',async()=>{
  const env=database();connect(env);cacheInventory(env,'alice',serialInventory,{observedAt:seconds()-60});
  assert.equal((await request(env,'/relay/heartbeat',{allow_switch:false},{relay:true})).status,200);
  let snapshot=await callTool(env,'alice','open_fm1_library',{});assert.equal(snapshot.relay.connected,true);assert.equal(snapshot.inventory_status.state,'stale');
  cacheInventory(env,'alice',serialInventory);
  env.DB.sqlite.prepare('UPDATE relay_state SET last_seen=?').run(seconds()-31);
  snapshot=await callTool(env,'alice','open_fm1_library',{});assert.equal(snapshot.relay.connected,false);assert.equal(snapshot.inventory_status.state,'stale');assert.ok(snapshot.inventory_status.age_seconds<=1);
});

test('new failed or unknown status invalidates the older success until a new successful observation',async()=>{
  for(const status of ['failed','unknown']){
    const env=database();connect(env);cacheInventory(env,'alice',serialInventory);
    const failed=await statusReport(env,{status});
    let snapshot=await callTool(env,'alice','open_fm1_library',{});
    assert.equal(snapshot.inventory,null);assert.equal(snapshot.inventory_status.state,'error');assert.equal(snapshot.inventory_status.request_id,failed.queued.request_id);assert.equal(snapshot.inventory_status.observed_at,null);
    assert.equal((await callTool(env,'alice','get_fm1_request',{request_id:'d'.repeat(32)})).data.device.serial_ports[0].port,'COM10');
    const refreshed=await statusReport(env,{data:absentInventory});snapshot=await callTool(env,'alice','open_fm1_library',{});
    assert.equal(snapshot.inventory_status.state,'fresh');assert.equal(snapshot.inventory_status.request_id,refreshed.queued.request_id);assert.deepEqual(snapshot.inventory.device.serial_ports,[]);assert.equal(snapshot.inventory.device.update_mode.mode,'disconnected');
  }
});

test('a successful bridge response containing an enumeration error is unavailable rather than a fresh disconnect',async()=>{
  const env=database();connect(env);
  const failed=structuredClone(absentInventory);failed.device.inventory_error='Windows disk enumeration failed';failed.device.update_mode={mode:'unknown',app_entry_method:null};
  await statusReport(env,{data:failed});
  const snapshot=await callTool(env,'alice','open_fm1_library',{});
  assert.equal(snapshot.relay.connected,true);assert.equal(snapshot.inventory_status.state,'error');assert.equal(snapshot.inventory.device.inventory_error,'Windows disk enumeration failed');
  cacheCatalog(env);await assert.rejects(callTool(env,'alice','prepare_fm1_switch',{catalog_id:'nes-test',entry_method:'auto'}),/fresh inventory/);
});

test('pending refresh retains the last completed observation and each owner has isolated freshness',async()=>{
  const env=database();connect(env);const alice=await statusReport(env);
  const pending=await callTool(env,'alice','get_fm1_status',{});
  let snapshot=await callTool(env,'alice','open_fm1_library',{});
  assert.equal(snapshot.inventory_status.request_id,alice.queued.request_id);assert.equal(snapshot.inventory_status.state,'fresh');assert.equal(snapshot.recent_requests.find(item=>item.id===pending.request_id).state,'pending');
  assert.equal((await callTool(env,'bob','open_fm1_library',{})).inventory_status.state,'unavailable');
  // Complete the older pending Alice refresh before dispatching Bob's request.
  await request(env,'/relay/poll',{}, {relay:true});await request(env,'/relay/result',{id:pending.request_id,status:'succeeded',data:serialInventory},{relay:true});
  await statusReport(env,{owner:'bob',status:'failed'});
  assert.equal((await callTool(env,'bob','open_fm1_library',{})).inventory_status.state,'error');
  snapshot=await callTool(env,'alice','open_fm1_library',{});assert.equal(snapshot.inventory_status.state,'fresh');assert.equal(snapshot.inventory.device.serial_ports[0].port,'COM10');
});

test('automatic routing cannot stage from stale inventory while explicit routing preserves its contract',async()=>{
  const env=database();connect(env);cacheCatalog(env);cacheInventory(env,'alice',serialInventory,{observedAt:seconds()-16});
  await assert.rejects(callTool(env,'alice','prepare_fm1_switch',{catalog_id:'nes-test',entry_method:'auto'}),/fresh inventory/);
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM switch_approvals').get().n,0);
  assert.ok((await callTool(env,'alice','prepare_fm1_switch',{catalog_id:'nes-test',entry_method:'serial'}))._approval);
  cacheInventory(env,'alice',serialInventory);
  assert.ok((await callTool(env,'alice','prepare_fm1_switch',{catalog_id:'nes-test',entry_method:'auto'}))._approval);
});

test('overlapping status refreshes share one owner request and do not coalesce across owners or operations',async()=>{
  const env=database();connect(env);
  const first=await Promise.all([callTool(env,'alice','get_fm1_status',{}),callTool(env,'alice','get_fm1_status',{})]);
  assert.equal(first[0].request_id,first[1].request_id);assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='status'").get().n,1);
  await request(env,'/relay/poll',{}, {relay:true});
  assert.equal((await callTool(env,'alice','get_fm1_status',{})).request_id,first[0].request_id);
  const bob=await callTool(env,'bob','get_fm1_status',{});assert.notEqual(bob.request_id,first[0].request_id);
  const catalog=await Promise.all([callTool(env,'alice','list_fm1_apps',{}),callTool(env,'alice','list_fm1_apps',{})]);assert.notEqual(catalog[0].request_id,catalog[1].request_id);
  await request(env,'/relay/result',{id:first[0].request_id,status:'succeeded',data:absentInventory},{relay:true});
  const next=await callTool(env,'alice','get_fm1_status',{});assert.notEqual(next.request_id,first[0].request_id);
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='status' AND user_id='alice'").get().n,2);
});

const officialInventory=(sha256=digest)=>({device:{
  update_mode:{mode:'sysex',app_entry_method:null,official_available:true},
  official_update:{configured:true,available:true,sha256,package_format:'.fwsc',handoff:true},
},engine:{active:null,blocked_unknown:false,updater_handoff:false}});
function officialBench(){const env=database();connect(env,true,true);cacheInventory(env,'alice',officialInventory());return env;}
const officialTasks=env=>env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='official_updater'").get().n;

test('official review and confirmation require fresh observations and stale approvals remain unconsumed',async()=>{
  const env=officialBench(),prepared=await callTool(env,'alice','prepare_fm1_official_update',{});
  cacheInventory(env,'alice',officialInventory(),{observedAt:seconds()-16});
  await assert.rejects(callTool(env,'alice','prepare_fm1_official_update',{}),/fresh/);
  await assert.rejects(callTool(env,'alice','confirm_fm1_official_update',{approval_id:prepared._approval}),/fresh/);
  assert.equal(env.DB.sqlite.prepare('SELECT used FROM official_update_approvals WHERE id=?').get(prepared._approval).used,0);assert.equal(officialTasks(env),0);
});

test('official tool input never accepts an executable, digest override or arbitrary operation',()=>{
  assert.deepEqual(validate('prepare_fm1_official_update',{}),{});
  for(const input of [{path:'M-UPGRADE.exe'},{expected_sha256:digest},{package_url:'https://other.test'},{operation:'launch'}])assert.throws(()=>validate('prepare_fm1_official_update',input));
  for(const input of [{},{approval_id:'A'.repeat(32)},{approval_id:'a'.repeat(32),expected_sha256:digest}])assert.throws(()=>validate('confirm_fm1_official_update',input));
  assert.deepEqual(validate('confirm_fm1_official_update',{approval_id:'a'.repeat(32)}),{approval_id:'a'.repeat(32)});
});

test('heartbeat advertises official capability independently and legacy heartbeat clears it',async()=>{
  const env=database();
  const beat=async value=>request(env,'/relay/heartbeat',value,{relay:true});
  assert.equal((await beat({allow_switch:false,allow_official_update:true})).status,200);
  let state=(await callTool(env,'alice','open_fm1_library',{})).relay;
  assert.equal(state.allow_switch,false);assert.equal(state.allow_official_update,true);
  assert.equal((await beat({allow_switch:true})).status,200);
  state=(await callTool(env,'alice','open_fm1_library',{})).relay;
  assert.equal(state.allow_switch,true);assert.equal(state.allow_official_update,false);
  for(const value of [{allow_switch:true,allow_official_update:'true'},{allow_switch:true,allow_official_update:1},{allow_switch:true,launch:true}])assert.equal((await beat(value)).status,400);
  assert.equal((await callTool(env,'alice','open_fm1_library',{})).relay.allow_official_update,false);
});

test('official stage is nonce-private in MCP output and never queues a handoff',async()=>{
  const env=officialBench();
  const response=await rpc(env,'tools/call',{name:'prepare_fm1_official_update',arguments:{}});
  const result=response.body.result,approval=result._meta.approval_id;
  assert.match(approval,/^[a-f0-9]{32}$/);
  assert.equal(result.structuredContent.review.sha256,digest);
  assert.equal(result.structuredContent.review.package_format,'.fwsc');
  assert.equal(result.structuredContent.review.handoff,true);
  assert.ok(!JSON.stringify(result.structuredContent).includes(approval));
  assert.ok(!JSON.stringify(result.content).includes(approval));
  assert.equal(env.DB.sqlite.prepare('SELECT used FROM official_update_approvals WHERE id=?').get(approval).used,0);
  assert.equal(officialTasks(env),0);
});

test('official stage requires its own capability and fresh available pinned metadata',async()=>{
  for(const setup of [env=>connect(env,true,false),env=>env.DB.sqlite.prepare('DELETE FROM relay_state').run(),
    env=>env.DB.sqlite.prepare("DELETE FROM relay_tasks WHERE operation='status'").run(),
    env=>cacheInventory(env,'alice',officialInventory('B'.repeat(64))),
    env=>{const value=officialInventory();value.device.official_update.available=false;cacheInventory(env,'alice',value);},
    env=>{const value=officialInventory();value.device.official_update.configured=false;cacheInventory(env,'alice',value);}]){
    const env=officialBench();setup(env);
    await assert.rejects(callTool(env,'alice','prepare_fm1_official_update',{}),/disabled|disconnected|Refresh/);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM official_update_approvals').get().n,0);
    assert.equal(officialTasks(env),0);
  }
});

test('official approval queues one exact hash and deadline with stable consumed retry identity',async()=>{
  const env=officialBench(),prepared=await callTool(env,'alice','prepare_fm1_official_update',{});
  const input={approval_id:prepared._approval};
  const first=await callTool(env,'alice','confirm_fm1_official_update',input);
  const repeated=await callTool(env,'alice','confirm_fm1_official_update',input);
  assert.equal(first.request_id,prepared._approval);assert.equal(first.job_id,prepared._approval);
  assert.equal(repeated.request_id,first.request_id);assert.equal(officialTasks(env),1);
  const task=env.DB.sqlite.prepare("SELECT * FROM relay_tasks WHERE operation='official_updater'").get();
  assert.equal(task.id,prepared._approval);
  assert.deepEqual(JSON.parse(task.arguments),{expected_sha256:digest,approval_expires:prepared.review.expires});
  assert.equal(env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,1);
});

test('consumed official approval retry survives expiry, capability removal and offline bench',async()=>{
  const env=officialBench(),p=await callTool(env,'alice','prepare_fm1_official_update',{});
  await callTool(env,'alice','confirm_fm1_official_update',{approval_id:p._approval});
  env.DB.sqlite.prepare('UPDATE official_update_approvals SET expires=0').run();
  env.DB.sqlite.prepare('DELETE FROM relay_state').run();
  env.DB.sqlite.prepare("DELETE FROM relay_tasks WHERE operation='status'").run();
  const retried=await callTool(env,'alice','confirm_fm1_official_update',{approval_id:p._approval});
  assert.equal(retried.request_id,p._approval);assert.equal(officialTasks(env),1);
});

test('unconsumed official approval expiry leaves both consumption and queue untouched',async()=>{
  const env=officialBench(),p=await callTool(env,'alice','prepare_fm1_official_update',{});
  env.DB.sqlite.prepare('UPDATE official_update_approvals SET expires=0').run();
  await assert.rejects(callTool(env,'alice','confirm_fm1_official_update',{approval_id:p._approval}),/expired/);
  assert.equal(env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,0);
  assert.equal(officialTasks(env),0);
});

test('official transaction deadline cannot consume approval without its durable task',async()=>{
  const env=officialBench(),p=await callTool(env,'alice','prepare_fm1_official_update',{});
  const prepare=env.DB.prepare.bind(env.DB);
  env.DB.prepare=sql=>{
    if(sql.startsWith('INSERT INTO relay_tasks')&&sql.includes('FROM official_update_approvals'))env.DB.sqlite.prepare('UPDATE official_update_approvals SET expires=0').run();
    return prepare(sql);
  };
  await assert.rejects(callTool(env,'alice','confirm_fm1_official_update',{approval_id:p._approval}),/expired/);
  assert.equal(env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,0);
  assert.equal(officialTasks(env),0);
});

test('official queue insertion rolls back if approval consumption fails in the transaction',async()=>{
  const env=officialBench(),p=await callTool(env,'alice','prepare_fm1_official_update',{});
  const batch=env.DB.batch.bind(env.DB);
  env.DB.batch=statements=>{statements[1].run=async()=>{throw new Error('Synthetic D1 transaction failure');};return batch(statements);};
  await assert.rejects(callTool(env,'alice','confirm_fm1_official_update',{approval_id:p._approval}),/transaction failure/);
  assert.equal(env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,0);
  assert.equal(officialTasks(env),0);
});

test('official confirmation rejects changed digest, unavailable updater, lost capability and cross-user nonce',async()=>{
  for(const change of [env=>cacheInventory(env,'alice',officialInventory('b'.repeat(64))),
    env=>{const value=officialInventory();value.device.official_update.available=false;cacheInventory(env,'alice',value);},
    env=>connect(env,true,false)]){
    const env=officialBench(),p=await callTool(env,'alice','prepare_fm1_official_update',{});
    await assert.rejects(callTool(env,'bob','confirm_fm1_official_update',{approval_id:p._approval}),/not found/);
    await assert.rejects(callTool(env,'bob','prepare_fm1_official_update',{}),/Refresh/);
    change(env);
    await assert.rejects(callTool(env,'alice','confirm_fm1_official_update',{approval_id:p._approval}),/changed|Refresh|disabled/);
    assert.equal(env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,0);
    assert.equal(officialTasks(env),0);
  }
});

test('official handoff dispatch and saved inspection preserve original job and unverified completion',async()=>{
  const env=officialBench(),p=await callTool(env,'alice','prepare_fm1_official_update',{});
  await callTool(env,'alice','confirm_fm1_official_update',{approval_id:p._approval});
  const delivered=(await request(env,'/relay/poll',{}, {relay:true})).body.tasks[0];
  assert.deepEqual(delivered,{id:p._approval,operation:'official_updater',arguments:{expected_sha256:digest,approval_expires:p.review.expires}});
  const report={id:p._approval,status:'succeeded',data:{id:p._approval,status:'succeeded',operation:'official_updater',result:{handoff:true,written_verified:false,sha256:digest}}};
  for(let count=0;count<2;count++)assert.deepEqual((await request(env,'/relay/result',report,{relay:true})).body,{saved:true});
  const saved=await callTool(env,'alice','get_fm1_request',{request_id:p._approval});
  assert.equal(saved.data.id,p._approval);assert.equal(saved.data.result.handoff,true);assert.equal(saved.data.result.written_verified,false);
  await assert.rejects(callTool(env,'bob','get_fm1_request',{request_id:p._approval}),/not found/);
});

test('auto switch review records detected serial or UBOOT route while keeping auto for fresh bench selection',async()=>{
  for(const [mode,entry] of [['serial','serial'],['uboot','already_uboot']]){
    const env=database();connect(env);cacheCatalog(env);
    cacheInventory(env,'alice',{device:{update_mode:{mode,app_entry_method:entry}}});
    const p=await callTool(env,'alice','prepare_fm1_switch',{catalog_id:'nes-test',entry_method:'auto'});
    assert.equal(p.review.entry_method,'auto');assert.equal(p.review.detected_method,entry);
    assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='switch_app'").get().n,0);
    await callTool(env,'alice','confirm_fm1_switch',{approval_id:p._approval});
    const task=env.DB.sqlite.prepare("SELECT arguments FROM relay_tasks WHERE operation='switch_app'").get();
    assert.equal(JSON.parse(task.arguments).entry_method,'auto');
  }
});

test('auto switch review refuses absent, ambiguous, failed and official MIDI inventory',async()=>{
  for(const mode of [null,'unknown','ambiguous','disconnected','sysex','ota_sysex']){
    const env=database();connect(env);cacheCatalog(env);
    if(mode)cacheInventory(env,'alice',{device:{update_mode:{mode,app_entry_method:null}}});
    await assert.rejects(callTool(env,'alice','prepare_fm1_switch',{catalog_id:'nes-test',entry_method:'auto'}),/automatic app routing/);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM switch_approvals').get().n,0);
  }
});

test('official staging and confirmation refuse busy or latched engine despite available vendor metadata',async()=>{
  for(const engine of [{active:'saved-job'}, {blocked_unknown:true}, {storage_fault:true}, {updater_handoff:true}]){
    const env=officialBench();
    const p=await callTool(env,'alice','prepare_fm1_official_update',{});
    const value=officialInventory();Object.assign(value.engine,engine);cacheInventory(env,'alice',value);
    await assert.rejects(callTool(env,'alice','prepare_fm1_official_update',{}),/Resolve the saved bench job/);
    await assert.rejects(callTool(env,'alice','confirm_fm1_official_update',{approval_id:p._approval}),/Resolve the saved bench job/);
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM official_update_approvals').get().n,1);
    assert.equal(env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,0);
    assert.equal(officialTasks(env),0);
  }
});
