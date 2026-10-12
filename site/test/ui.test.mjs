import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { UI_HTML } from '../lib/fm1-ui.mjs';
import { callTool } from '../lib/fm1-server.mjs';
import { database, connect, cacheCatalog, cacheInventory, digest } from './d1.mjs';
import {projectConfig,projectPrompt,verifiedDiagnostics,verifiedBaseline} from '../lib/fm1-forge-project.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
async function until(predicate){for(let attempt=0;attempt<100;attempt++){if(predicate())return;await tick();}assert.fail('Panel did not reach the expected state.');}
async function panel({embedded=false,initial=true,serverTools=true,hostMessages=false,hostRejectMessage=false,baseline=null,catalogValue=null,inventory=null,official=false,loseConfirmationReply=false,jobData=null,beforeCall=null,nativeControls=false,omitPlanJobId=false,preferences=null,storageBlocked=false,legacyPreferences=null,nativeExtensions=false,initialFile=null,fileInputFirst=true,initialToolResult=null}={}){
  const normalInventory=inventory||{device:{serial_ports:[{port:'COM10'}],update_mode:{mode:'serial',app_entry_method:'serial'},official_update:{configured:true,available:false,sha256:digest}},engine:{active:null,blocked_unknown:false}};
  const env=database();connect(env,true,official);cacheCatalog(env,'alice',catalogValue||undefined);cacheInventory(env,'alice',normalInventory);
  const seededTasks=env.DB.sqlite.prepare('SELECT * FROM relay_tasks ORDER BY id').all();
  const nodes=new Map(),registered=new Map(),requests=[],requestArgs=[],events=new Map(),notifications=[],timers=new Map(),pollTimers=new Map(),delays=[],storage=new Map(),storageWrites=[];let panelNow=Date.now(),pollKey=0;
  if(preferences!==null)storage.set('fm1.appearance.v2',typeof preferences==='string'?preferences:JSON.stringify(preferences));
  if(legacyPreferences!==null)storage.set('fm1.appearance.v1',JSON.stringify(legacyPreferences));
  const initialValues={'forge-project-name':'My FM1 firmware','forge-project-slug':'my-fm1-firmware','forge-project-goal':'','forge-clock-preset':'sdk-default','forge-lcd-preset':'stock-dma','forge-module':'diagnostics','diag-entry-method':'auto'};
  function node(id){if(!nodes.has(id)){let text='';const attributes=new Map();nodes.set(id,{history:[],get textContent(){return text;},set textContent(value){text=value;this.history.push(value);},innerHTML:'',value:initialValues[id]??(id==='variant-nes'?'nes-test':''),checked:id==='forge-usb-audio'||id.startsWith('forge-hal-'),dataset:{profile:'nes',plan:'nes',switch:'nes'},hidden:true,open:false,style:{},querySelectorAll:selector=>id==='library'&&nativeControls?selector==='select'?[node('variant-nes')]:selector==='[data-plan]'?[node('plan-nes')]:selector==='[data-switch]'?[node('switch-nes')]:[]:[],querySelector:selector=>id==='library'&&nativeControls?(selector.startsWith('[data-profile=')?node('variant-nes'):node('digest-nes')):null,setAttribute(name,value){attributes.set(name,String(value));},getAttribute(name){return attributes.get(name)??null;},removeAttribute(name){attributes.delete(name);if(name==='value')delete this.value;},showModal(){this.open=true;},close(){this.open=false;},addEventListener(name,fn){this[name]=fn;}});}return nodes.get(id);}
  const initialData=await callTool(env,'alice','open_fm1_library',{});
  if(baseline)initialData.forge={diagnostic_baseline:baseline};
  if(inventory)initialData.inventory=inventory;
  const window={localStorage:{getItem(key){if(storageBlocked)throw new Error('Local storage is blocked by this host.');return storage.get(key)??null;},setItem(key,value){if(storageBlocked)throw new Error('Local storage is blocked by this host.');storage.set(key,String(value));storageWrites.push({key,value:String(value)});}},addEventListener(name,fn,options){events.set(name,fn);options?.signal?.addEventListener('abort',()=>events.delete(name));},removeEventListener(name){events.delete(name);}};
  const parent=embedded?{postMessage(message){notifications.push(message);if(message.id===undefined||!message.method)return;queueMicrotask(async()=>{
    let response;
    try{
      const result=message.method==='ui/initialize'?{protocolVersion:'2026-01-26',hostInfo:{name:'FM1 fixture host',version:'1'},hostCapabilities:{...(serverTools?{serverTools:{}}:{}),...(hostMessages?{message:{text:{}}}:{}),...(nativeExtensions?{experimental:{'openai/message':{}}}:{})},hostContext:{theme:'light',displayMode:'fullscreen'}}:message.method==='ui/message'?{isError:hostRejectMessage}:toolResult(await backend(message.params.name,message.params.arguments));
      if(loseConfirmationReply&&message.params?.name?.startsWith('confirm_'))throw new Error('Confirmation reply lost.');
      response={result};
    }catch(error){response={error:{code:-32000,message:error.message}};}
    events.get('message')?.({source:parent,data:{jsonrpc:'2.0',id:message.id,...response}});
    if(message.method==='ui/initialize'){
      const emit=(method,params)=>events.get('message')?.({source:parent,data:{jsonrpc:'2.0',method,params}});
      if(initialFile&&fileInputFirst)emit('ui/notifications/tool-input',{arguments:{file:initialFile}});
      if(initial)emit('ui/notifications/tool-result',{content:[],structuredContent:initialFile?{file:initialFile,mode:'project_file'}:initialToolResult||initialData});
      if(initialFile&&!fileInputFirst)emit('ui/notifications/tool-input',{arguments:{file:initialFile}});
    }
  });}}:window;
  window.parent=parent;
  function toolResult(answer){const {_approval,...data}=answer;return {content:[],structuredContent:data,...(_approval?{_meta:{approval_id:_approval}}:{})};}
  async function backend(name,args){requests.push(name);requestArgs.push({name,args});await beforeCall?.(name,args);const answer=await callTool(env,'alice',name,args);if(name==='open_fm1_library'&&baseline)answer.forge={diagnostic_baseline:baseline};if(answer.request_id){const defaultJob={id:args.job_id||answer.job_id||answer.request_id,status:'succeeded',simulation:true},data=jobData?await jobData({name,args,answer,defaultJob}):defaultJob;if(data!==null)env.DB.sqlite.prepare('UPDATE relay_tasks SET state=?,result=? WHERE id=?').run('succeeded',JSON.stringify({status:'succeeded',data,...(name==='get_fm1_status'?{_site_inventory_observed_at:Math.floor(Date.now()/1000)}:{})}),answer.request_id);}if(omitPlanJobId&&name==='plan_fm1_app'){const {job_id,...queued}=answer;return queued;}return answer;}
  const properties=new Map();
  const document={documentElement:{style:{setProperty(name,value){properties.set(name,String(value));}}},body:{classList:{add(){}},dataset:{},style:{setProperty(name,value){properties.set(name,String(value));},getPropertyValue(name){return properties.get(name)??'';}}},getElementById:node,createElement(tag){return {tag,textContent:'',style:{}};},modelContext:{async registerTool(tool,{signal}){registered.set(tool.name,tool);signal.addEventListener('abort',()=>registered.delete(tool.name));}}};
  document.hidden=false;document.addEventListener=(name,fn,options)=>window.addEventListener(name,fn,options);window.navigator={onLine:true};
  const context=vm.createContext({document,window,AbortController,Map,Object,Number,JSON,RegExp,String,Error,URL,TextEncoder,TextDecoder,crypto,queueMicrotask,Date:class PanelDate extends Date{static now(){return panelNow;}},setTimeout:(fn,ms)=>{delays.push(ms);if(fn.name==='inventoryTick'){const timer='poll-'+(++pollKey);pollTimers.set(timer,{fn,time:panelNow+ms});return timer;}const timer=setTimeout(()=>{timers.delete(timer);fn();},ms>=10000?500:1);timers.set(timer,ms);return timer;},clearTimeout:timer=>{if(pollTimers.delete(timer))return;timers.delete(timer);clearTimeout(timer);},fetch:async(_url,options)=>{const input=JSON.parse(options.body);try{const answer=await backend(input.name,input.arguments);if(loseConfirmationReply&&input.name.startsWith('confirm_'))throw new Error('Confirmation reply lost.');return {ok:true,json:async()=>({structuredContent:answer})};}catch(error){return {ok:false,json:async()=>({error:error.message})};}}});
  for(const script of UI_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(script[1],context);
  await tick();
  return {env,nodes,registered,requests,requestArgs,events,notifications,timers,pollTimers,delays,parent,window,document,storage,storageWrites,seededTasks,node,async advancePoll(ms){const end=panelNow+ms;let count=0;while(true){const next=[...pollTimers].sort((a,b)=>a[1].time-b[1].time).find(([,timer])=>timer.time<=end);if(!next)break;if(++count>100)throw new Error('Polling timer storm.');panelNow=next[1].time;pollTimers.delete(next[0]);next[1].fn();await tick();}panelNow=end;await tick();},async invoke(name,args){return registered.get(name).execute(args);},dispose(){events.get('pagehide')?.();}};
}
test('host initial tool result renders without a duplicate library request',async()=>{const p=await panel({embedded:true});assert.equal(p.node('relay-state').textContent,'Connected');assert.equal(p.requests.length,0);assert.equal(p.registered.size,0);p.dispose();});
test('initial host result renders even without serverTools capability',async()=>{const p=await panel({embedded:true,serverTools:false});assert.equal(p.node('relay-state').textContent,'Connected');assert.equal(p.requests.length,0);p.dispose();});
test('native plugin opens on device controls with detected port and no duplicate refresh',async()=>{const p=await panel({embedded:true,inventory:{device:{serial_ports:[{port:'COM7'}],session_configured:false},engine:{active:null,blocked_unknown:false}}});assert.equal(p.node('surface-label').textContent,'FM1 Forge plugin');assert.equal(p.node('device-heading').textContent,'FM1 on COM7');assert.equal(p.node('physical-device').textContent,'FM1 on COM7');assert.equal(p.requests.length,0);p.dispose();});
test('host with serverTools falls back once if initial result absent',async()=>{const p=await panel({embedded:true,initial:false});assert.deepEqual(p.requests,['open_fm1_library']);p.dispose();});
test('resource teardown is acknowledged and aborts the panel lifecycle',async()=>{const p=await panel({embedded:true});p.events.get('message')({source:p.parent,data:{jsonrpc:'2.0',id:91,method:'ui/resource-teardown',params:{}}});await tick();const ack=p.notifications.find(m=>m.id===91);assert.deepEqual(JSON.parse(JSON.stringify(ack)),{jsonrpc:'2.0',id:91,result:{}});const n=p.requests.length;p.node('refresh').onclick();await tick();assert.equal(p.requests.length,n);p.dispose();});
test('top-level document registers seven stage-only tools and abort removes them',async()=>{const p=await panel();assert.equal(p.registered.size,7);for(const name of ['confirm_fm1_switch','confirm_fm1_official_update'])assert.ok(!p.registered.has(name));p.dispose();assert.equal(p.registered.size,0);});
test('WebMCP review opens a dialog without exposing approval or submitting write',async()=>{const p=await panel();const reviewed=await p.invoke('start_fm1_switch_review',{catalog_id:'nes-test',entry_method:'serial'});assert.equal(p.node('approval').open,true);assert.ok(!('_approval' in reviewed));const nonce=p.env.DB.sqlite.prepare('SELECT id FROM switch_approvals').get().id;assert.ok(!JSON.stringify(reviewed).includes(nonce));assert.ok(!p.requests.includes('confirm_fm1_switch'));p.dispose();});
test('programmatic confirmation cannot consume the approval',async()=>{const p=await panel();await p.invoke('start_fm1_switch_review',{catalog_id:'nes-test',entry_method:'serial'});p.node('confirm').onclick({isTrusted:false});await tick();assert.equal(p.env.DB.sqlite.prepare('SELECT used FROM switch_approvals').get().used,0);assert.equal(p.node('approval').open,true);p.dispose();});
test('cancel and Escape clear approval before any later click',async()=>{for(const mode of ['cancel','escape']){const p=await panel();await p.invoke('start_fm1_switch_review',{catalog_id:'nes-test',entry_method:'serial'});if(mode==='cancel')p.node('cancel').onclick();else p.node('approval').cancel();p.node('confirm').onclick({isTrusted:true});await tick();assert.ok(!p.requests.includes('confirm_fm1_switch'));p.dispose();}});
test('trusted confirmation uses the displayed approval once',async()=>{const p=await panel();await p.invoke('start_fm1_switch_review',{catalog_id:'nes-test',entry_method:'serial'});p.node('confirm').onclick({isTrusted:true});p.node('confirm').onclick({isTrusted:true});await tick();assert.equal(p.requests.filter(name=>name==='confirm_fm1_switch').length,1);assert.equal(p.env.DB.sqlite.prepare('SELECT used FROM switch_approvals').get().used,1);p.dispose();});
test('Inspect job awaits authoritative result and preserves the original job ID',async()=>{const p=await panel();const id='e'.repeat(32);p.node('job-id').value=id;p.node('inspect').onclick();await tick();assert.ok(p.requests.includes('get_fm1_request'));assert.match(p.node('detail').textContent,/succeeded/);assert.match(p.node('detail').textContent,new RegExp(id));assert.equal(p.node('job-id').value,id);p.dispose();});
test('refreshing metadata preserves a saved job for later inspection',async()=>{const p=await panel();const id='e'.repeat(32);p.node('job-id').value=id;await p.invoke('refresh_fm1_library',{});assert.equal(p.node('job-id').value,id);p.node('inspect').onclick();await tick();assert.equal(p.requestArgs.find(r=>r.name==='get_fm1_job').args.job_id,id);p.dispose();});
test('lost confirmation reply retains the committed job ID and inspection does not resubmit',async()=>{const p=await panel({loseConfirmationReply:true});await p.invoke('start_fm1_switch_review',{catalog_id:'nes-test',entry_method:'serial'});const id=p.env.DB.sqlite.prepare('SELECT id FROM switch_approvals').get().id;p.node('confirm').onclick({isTrusted:true});await tick();assert.equal(p.node('job-id').value,id);assert.match(p.node('message').textContent,/Inspect job/);assert.match(p.node('message').textContent,new RegExp(id));assert.equal(p.env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM relay_tasks WHERE operation='switch_app'").get().n,1);p.node('inspect').onclick();await tick();assert.equal(p.requestArgs.find(r=>r.name==='get_fm1_job').args.job_id,id);assert.equal(p.requests.filter(name=>name==='confirm_fm1_switch').length,1);assert.equal(p.env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM relay_tasks WHERE operation='switch_app'").get().n,1);assert.match(p.node('detail').textContent,new RegExp(id));p.dispose();});
test('WebMCP inspection selects the exact job ID in the recovery field',async()=>{const p=await panel();const id='e'.repeat(32);await p.invoke('inspect_fm1_job',{job_id:id});assert.equal(p.node('job-id').value,id);assert.match(p.node('detail').textContent,new RegExp(id));p.dispose();});
test('every browser tool rejects malformed arguments without backend call',async()=>{const p=await panel();const n=p.requests.length;for(const tool of p.registered.values())await assert.rejects(tool.execute({unexpected:'x'}),/arguments/);await assert.rejects(p.invoke('plan_fm1_app',{catalog_id:'Bad-ID'}),/Invalid/);assert.equal(p.requests.length,n);p.dispose();});

function detectedInventory(mode='sysex'){
  const official=['sysex','ota_sysex'].includes(mode);
  return {device:{update_mode:{mode,app_entry_method:mode==='serial'?'serial':mode==='uboot'?'already_uboot':null,official_available:official},
    official_update:{configured:true,available:official,sha256:digest,package_format:'.fwsc',handoff:true}},
    engine:{active:null,blocked_unknown:false,updater_handoff:false,storage_fault:false}};
}

test('official WebMCP review is stage-only and keeps nonce out of returned review and dialog',async()=>{
  const p=await panel({official:true,inventory:detectedInventory()});
  const review=await p.invoke('start_fm1_official_update_review',{});
  const approval=p.env.DB.sqlite.prepare('SELECT id,used FROM official_update_approvals').get();
  assert.equal(p.node('approval').open,true);assert.equal(p.node('approval-title').textContent,'Open official updater');
  assert.equal(review.review.sha256,digest);assert.equal(review.review.package_format,'.fwsc');
  assert.ok(!JSON.stringify(review).includes(approval.id));assert.ok(!p.node('review').innerHTML.includes(approval.id));
  assert.match(p.node('review').innerHTML,/\.fwsc/);assert.match(p.node('review').innerHTML,new RegExp(digest));
  assert.equal(approval.used,0);assert.ok(!p.requests.includes('confirm_fm1_official_update'));
  assert.equal(p.env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='official_updater'").get().n,0);
  p.dispose();
});

test('official synthetic confirmation leaves review open and trusted click consumes displayed approval once',async()=>{
  const p=await panel({official:true,inventory:detectedInventory()});
  await p.invoke('start_fm1_official_update_review',{});
  const id=p.env.DB.sqlite.prepare('SELECT id FROM official_update_approvals').get().id;
  p.node('confirm').onclick({isTrusted:false});await tick();
  assert.equal(p.env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,0);
  assert.equal(p.node('approval').open,true);assert.ok(!p.requests.includes('confirm_fm1_official_update'));
  p.node('confirm').onclick({isTrusted:true});p.node('confirm').onclick({isTrusted:true});await tick();
  assert.equal(p.requests.filter(name=>name==='confirm_fm1_official_update').length,1);
  assert.equal(p.env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,1);
  assert.equal(p.node('job-id').value,id);
  assert.equal(p.requestArgs.find(item=>item.name==='confirm_fm1_official_update').args.approval_id,id);
  assert.equal(p.env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='official_updater'").get().n,1);
  p.dispose();
});

test('official Cancel and Escape clear nonce before any later trusted click',async()=>{
  for(const mode of ['cancel','escape']){
    const p=await panel({official:true,inventory:detectedInventory()});
    await p.invoke('start_fm1_official_update_review',{});
    if(mode==='cancel')p.node('cancel').onclick();else p.node('approval').cancel();
    p.node('confirm').onclick({isTrusted:true});await tick();
    assert.ok(!p.requests.includes('confirm_fm1_official_update'));
    assert.equal(p.env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,0);
    p.dispose();
  }
});

test('native official review uses host-private approval metadata and trusted confirmation',async()=>{
  const p=await panel({embedded:true,official:true,inventory:detectedInventory('ota_sysex')});
  assert.equal(p.registered.size,0);assert.equal(p.node('official-update').disabled,false);
  p.node('official-update').onclick();await tick();
  assert.equal(p.node('approval').open,true);
  const id=p.env.DB.sqlite.prepare('SELECT id FROM official_update_approvals').get().id;
  assert.ok(!p.node('review').innerHTML.includes(id));
  p.node('confirm').onclick({isTrusted:false});await tick();
  assert.ok(!p.requests.includes('confirm_fm1_official_update'));
  p.node('confirm').onclick({isTrusted:true});await tick();
  assert.equal(p.requestArgs.find(item=>item.name==='confirm_fm1_official_update').args.approval_id,id);
  assert.equal(p.node('job-id').value,id);
  assert.equal(p.env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,1);
  p.dispose();
});

test('official lost response retains exact job identity and inspection never opens another updater',async()=>{
  for(const embedded of [false,true]){
    const p=await panel({embedded,official:true,inventory:detectedInventory(),loseConfirmationReply:true});
    if(embedded){p.node('official-update').onclick();await tick();}else await p.invoke('start_fm1_official_update_review',{});
    const id=p.env.DB.sqlite.prepare('SELECT id FROM official_update_approvals').get().id;
    p.node('confirm').onclick({isTrusted:true});await tick();
    assert.equal(p.node('job-id').value,id);assert.match(p.node('message').textContent,/Inspect job/);
    assert.match(p.node('message').textContent,new RegExp(id));
    assert.equal(p.env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='official_updater'").get().n,1);
    p.node('inspect').onclick();await tick();
    assert.equal(p.requestArgs.find(item=>item.name==='get_fm1_job').args.job_id,id);
    assert.equal(p.requests.filter(name=>name==='confirm_fm1_official_update').length,1);
    assert.match(p.node('detail').textContent,new RegExp(id));
    p.dispose();
  }
});

test('native update mode and official button reflect recognized MIDI and independent capability',async()=>{
  const labels={serial:'Serial USB → UBOOT',uboot:'UBOOT',sysex:'MIDI / SysEx',ota_sysex:'MIDI / OTA',
    ambiguous:'Multiple candidates',unknown:'Unrecognized',disconnected:'Disconnected'};
  for(const [mode,label] of Object.entries(labels)){
    const p=await panel({embedded:true,official:true,inventory:detectedInventory(mode)});
    assert.equal(p.node('update-mode').textContent,label);
    assert.equal(p.node('official-update').disabled,!['sysex','ota_sysex'].includes(mode));
    assert.equal(p.requests.length,0);p.dispose();
  }
  const p=await panel({embedded:true,official:false,inventory:detectedInventory()});
  assert.equal(p.node('official-update').disabled,true);assert.equal(p.node('official-state').textContent,'Disabled');
  p.dispose();
});

test('busy and persistent engine latches disable official button despite available updater metadata',async()=>{
  for(const engine of [{active:'saved-job'},{blocked_unknown:true},{storage_fault:true},{updater_handoff:true}]){
    const inventory=detectedInventory();Object.assign(inventory.engine,engine);
    const p=await panel({embedded:true,official:true,inventory});
    assert.equal(p.node('official-update').disabled,true);
    assert.equal(p.node('official-state').textContent,engine.updater_handoff?'Complete vendor update':'Resolve saved bench job');
    assert.equal(p.requests.length,0);p.dispose();
  }
});

test('replacing app review with official review confirms only latest displayed family and nonce',async()=>{
  const p=await panel({official:true,inventory:detectedInventory()});
  await p.invoke('start_fm1_switch_review',{catalog_id:'nes-test',entry_method:'serial'});
  const switchId=p.env.DB.sqlite.prepare('SELECT id FROM switch_approvals').get().id;
  await p.invoke('start_fm1_official_update_review',{});
  const officialId=p.env.DB.sqlite.prepare('SELECT id FROM official_update_approvals').get().id;
  p.node('confirm').onclick({isTrusted:true});await tick();
  assert.ok(!p.requests.includes('confirm_fm1_switch'));
  assert.equal(p.requestArgs.find(item=>item.name==='confirm_fm1_official_update').args.approval_id,officialId);
  assert.equal(p.env.DB.sqlite.prepare('SELECT used FROM switch_approvals WHERE id=?').get(switchId).used,0);
  assert.equal(p.env.DB.sqlite.prepare('SELECT used FROM official_update_approvals WHERE id=?').get(officialId).used,1);
  p.dispose();
});

test('auto WebMCP switch review shows detected route and never queues before human confirmation',async()=>{
  const p=await panel({inventory:detectedInventory('uboot')});
  const result=await p.invoke('start_fm1_switch_review',{catalog_id:'nes-test',entry_method:'auto'});
  assert.equal(result.review.entry_method,'auto');assert.equal(result.review.detected_method,'already_uboot');
  assert.match(p.node('review').innerHTML,/auto → already_uboot/);
  assert.equal(p.env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='switch_app'").get().n,0);
  p.dispose();
});

test('native teardown clears a staged official approval before any later trusted click',async()=>{
  const p=await panel({embedded:true,official:true,inventory:detectedInventory()});
  p.node('official-update').onclick();await tick();
  p.events.get('message')({source:p.parent,data:{jsonrpc:'2.0',id:92,method:'ui/resource-teardown',params:{}}});await tick();
  p.node('confirm').onclick({isTrusted:true});await tick();
  assert.ok(!p.requests.includes('confirm_fm1_official_update'));
  assert.equal(p.env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,0);
  p.dispose();
});

function progressJob(id,status,verified=0,total=96,phase=status==='succeeded'?'completed':status==='running'?'write':status){
  return {id,status,progress:{phase,verified_sectors:verified,total_sectors:total,message:'Fixture receipt',
    write_complete:verified===total,full_readback_verified:status==='succeeded',boot_verified:status==='succeeded',failed:status==='failed'}};
}

test('native plan submission follows only its exact saved job through running sector and readback progress',async()=>{
  let reads=0;
  const p=await panel({embedded:true,nativeControls:true,jobData:({name,defaultJob})=>{
    if(name==='plan_fm1_app')return {...defaultJob,status:'queued'};
    if(name==='get_fm1_job'){reads++;return progressJob(defaultJob.id,reads<7?'running':'succeeded',reads<6?reads*12:96,96,reads===6?'readback':reads<7?'write':'completed');}
    return defaultJob;
  }});
  p.node('plan-nes').onclick();
  await until(()=>p.node('detail').textContent.includes('"status": "succeeded"'));
  const id=p.node('job-id').value,inspections=p.requestArgs.filter(item=>item.name==='get_fm1_job');
  assert.equal(inspections.length,7);assert.ok(inspections.every(item=>item.args.job_id===id));
  assert.equal(p.requests.filter(name=>name==='plan_fm1_app').length,1);
  assert.ok(!p.requests.includes('confirm_fm1_switch'));assert.ok(!p.requests.includes('get_fm1_status'));assert.ok(!p.requests.includes('list_fm1_apps'));
  assert.ok(p.node('detail').history.some(value=>value.includes('"phase": "readback"')));
  assert.ok(p.node('progress-text').history.some(value=>value.includes('12/96 sectors verified')));
  assert.equal(p.node('progress').hidden,false);assert.equal(p.node('progress-bar').max,96);assert.equal(p.node('progress-bar').value,96);
  assert.ok(p.delays.includes(1000));assert.ok(p.delays.includes(3000));
  const count=p.requests.length;await tick();assert.equal(p.requests.length,count);p.dispose();
});

test('native trusted switch confirmation follows progress without repeating confirmation or the write',async()=>{
  let reads=0;
  const p=await panel({embedded:true,nativeControls:true,inventory:detectedInventory('uboot'),jobData:({name,defaultJob})=>{
    if(name==='confirm_fm1_switch')return {...defaultJob,status:'queued'};
    if(name==='get_fm1_job')return progressJob(defaultJob.id,++reads===1?'running':'succeeded',reads===1?32:96);
    return defaultJob;
  }});
  p.node('switch-nes').onclick();await until(()=>p.node('approval').open);
  const id=p.env.DB.sqlite.prepare('SELECT id FROM switch_approvals').get().id;
  p.node('confirm').onclick({isTrusted:true});p.node('confirm').onclick({isTrusted:true});
  await until(()=>p.node('detail').textContent.includes('"boot_verified": true'));
  assert.equal(p.node('job-id').value,id);assert.equal(p.requests.filter(name=>name==='confirm_fm1_switch').length,1);
  assert.equal(p.env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='switch_app'").get().n,1);
  assert.ok(p.requestArgs.filter(item=>item.name==='get_fm1_job').every(item=>item.args.job_id===id));
  assert.equal(reads,2);p.dispose();
});

test('native plan follows the submission request ID when the host response has no job_id field',async()=>{
  let reads=0;
  const p=await panel({embedded:true,nativeControls:true,omitPlanJobId:true,jobData:({name,defaultJob})=>{
    if(name==='plan_fm1_app')return {...defaultJob,status:'queued'};
    if(name==='get_fm1_job')return progressJob(defaultJob.id,++reads===1?'running':'succeeded',reads===1?16:96);
    return defaultJob;
  }});
  p.node('plan-nes').onclick();await until(()=>p.node('detail').textContent.includes('"status": "succeeded"'));
  const id=p.env.DB.sqlite.prepare("SELECT id FROM relay_tasks WHERE operation='plan_app'").get().id;
  assert.equal(p.node('job-id').value,id);assert.equal(reads,2);
  assert.ok(p.requestArgs.filter(item=>item.name==='get_fm1_job').every(item=>item.args.job_id===id));
  assert.equal(p.requests.filter(name=>name==='plan_fm1_app').length,1);p.dispose();
});

test('Refresh updates metadata while preserving selected progress during work and after completion',async()=>{
  let reads=0,release;const held=new Promise(resolve=>{release=resolve;});const id='e'.repeat(32);
  const p=await panel({beforeCall:async name=>{if(name==='get_fm1_job'&&reads===1)await held;},jobData:({name,defaultJob})=>name==='get_fm1_job'?progressJob(defaultJob.id,++reads===1?'running':'succeeded',reads===1?32:96):defaultJob});
  const following=p.invoke('inspect_fm1_job',{job_id:id});await until(()=>p.node('progress-text').textContent.includes('32/96'));
  const runningDetail=p.node('detail').textContent;await p.invoke('refresh_fm1_library',{});
  assert.equal(p.node('detail').textContent,runningDetail);assert.equal(p.node('progress-bar').value,32);assert.equal(p.node('job-id').value,id);
  release();await following;const completedDetail=p.node('detail').textContent;
  await p.invoke('refresh_fm1_library',{});assert.equal(p.node('detail').textContent,completedDetail);assert.equal(p.node('progress-bar').value,96);
  assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,2);assert.equal(p.requests.filter(name=>name==='list_fm1_apps').length,2);p.dispose();
});

test('automatic inspection stops on failed and unknown authoritative job outcomes',async()=>{
  for(const status of ['failed','unknown']){
    let reads=0;const id='f'.repeat(32);
    const p=await panel({jobData:({name,defaultJob})=>name==='get_fm1_job'?progressJob(defaultJob.id,++reads===1?'running':status,32):defaultJob});
    await p.invoke('inspect_fm1_job',{job_id:id});
    assert.equal(reads,2);assert.equal(p.node('job-id').value,id);assert.equal(JSON.parse(p.node('detail').textContent).status,status);
    const count=p.requests.length;await tick();assert.equal(p.requests.length,count);assert.ok(!p.requests.includes('confirm_fm1_switch'));p.dispose();
  }
});

test('missing sector totals remain indeterminate during work and do not animate after terminal completion',async()=>{
  const id='e'.repeat(32);let reads=0;let release;
  const held=new Promise(resolve=>{release=resolve;});
  const p=await panel({beforeCall:async name=>{if(name==='get_fm1_job'&&reads===1)await held;},jobData:({name,defaultJob})=>{
    if(name==='get_fm1_job')return progressJob(defaultJob.id,++reads===1?'running':'succeeded',null,null,reads===1?'preparing':'completed');
    return defaultJob;
  }});
  const follow=p.invoke('inspect_fm1_job',{job_id:id});await until(()=>reads===1&&p.node('progress-text').textContent.includes('preparing'));
  assert.equal(p.node('progress-bar').hidden,false);assert.ok(!('value' in p.node('progress-bar')));assert.ok(!p.node('progress-text').textContent.includes('sectors verified'));
  release();await follow;assert.equal(p.node('progress-bar').hidden,true);assert.match(p.node('progress-text').textContent,/completed/);p.dispose();
});

test('a lost relay delivery times out once and explicit Inspect resumes the preserved original job',async()=>{
  let inspectReads=0;
  const p=await panel({jobData:({name,defaultJob})=>name==='plan_fm1_app'?null:name==='get_fm1_job'?progressJob(defaultJob.id,++inspectReads===1?'running':'succeeded',inspectReads===1?48:96):defaultJob});
  await p.invoke('plan_fm1_app',{catalog_id:'nes-test'});
  const id=p.node('job-id').value;assert.match(p.node('message').textContent,new RegExp('Inspect job '+id));
  assert.equal(p.requests.filter(name=>name==='plan_fm1_app').length,1);assert.equal(inspectReads,0);
  p.node('inspect').onclick();await until(()=>inspectReads===2&&p.node('detail').textContent.includes('"status": "succeeded"'));
  assert.ok(p.requestArgs.filter(item=>item.name==='get_fm1_job').every(item=>item.args.job_id===id));
  assert.equal(p.requests.filter(name=>name==='plan_fm1_app').length,1);p.dispose();
});

test('offline job inspection stops with the saved ID and never retries a submission',async()=>{
  let reads=0;const id='e'.repeat(32);
  const p=await panel({beforeCall:name=>{if(name==='get_fm1_job'&&++reads===2)throw new Error('Bench connection is offline.');},jobData:({name,defaultJob})=>name==='get_fm1_job'?progressJob(defaultJob.id,'running',16):defaultJob});
  await assert.rejects(p.invoke('inspect_fm1_job',{job_id:id}),/offline.*Inspect job/s);
  const count=p.requests.length;await tick();assert.equal(p.requests.length,count);assert.equal(reads,2);
  assert.equal(p.node('job-id').value,id);assert.ok(!p.requests.includes('plan_fm1_app'));assert.ok(!p.requests.includes('confirm_fm1_switch'));p.dispose();
});

test('repeated Inspect clicks share one running follow loop for the same original ID',async()=>{
  let reads=0,release;const held=new Promise(resolve=>{release=resolve;});const id='e'.repeat(32);
  const p=await panel({beforeCall:async name=>{if(name==='get_fm1_job'&&reads===1)await held;},jobData:({name,defaultJob})=>name==='get_fm1_job'?progressJob(defaultJob.id,++reads===1?'running':'succeeded',reads===1?16:96):defaultJob});
  p.node('job-id').value=id;p.node('inspect').onclick();await until(()=>reads===1);
  p.node('inspect').onclick();p.node('inspect').onclick();await tick();
  assert.equal(p.requests.filter(name=>name==='get_fm1_job').length,2);
  release();await until(()=>p.node('detail').textContent.includes('"status": "succeeded"'));assert.equal(reads,2);p.dispose();
});

test('a superseding inspection prevents an older in-flight result from replacing the selected job',async()=>{
  const oldId='e'.repeat(32),newId='f'.repeat(32);let oldReads=0,release;
  const held=new Promise(resolve=>{release=resolve;});
  const p=await panel({beforeCall:async(name,args)=>{if(name==='get_fm1_job'&&args.job_id===oldId&&oldReads===1)await held;},jobData:({name,args,defaultJob})=>{
    if(name!=='get_fm1_job')return defaultJob;
    if(args.job_id===oldId){oldReads++;return progressJob(oldId,oldReads===1?'running':'succeeded',oldReads===1?16:96);}
    return progressJob(newId,'succeeded',96);
  }});
  p.node('job-id').value=oldId;p.node('inspect').onclick();await until(()=>p.requests.filter(name=>name==='get_fm1_job').length===2);
  await p.invoke('inspect_fm1_job',{job_id:newId});release();await tick();
  assert.equal(p.node('job-id').value,newId);assert.equal(JSON.parse(p.node('detail').textContent).id,newId);assert.equal(p.node('message').textContent,'');
  const count=p.requests.length;await tick();assert.equal(p.requests.length,count);p.dispose();
});

test('native teardown cancels automatic follow timers and prevents later job requests',async()=>{
  const id='e'.repeat(32);
  const p=await panel({embedded:true,jobData:({name,defaultJob})=>name==='get_fm1_job'?progressJob(defaultJob.id,'running',16):defaultJob});
  p.node('job-id').value=id;p.node('inspect').onclick();await until(()=>p.node('progress-text').textContent.includes('16/96'));
  p.events.get('message')({source:p.parent,data:{jsonrpc:'2.0',id:93,method:'ui/resource-teardown',params:{}}});
  const count=p.requests.length;await tick();assert.equal(p.requests.length,count);assert.equal(p.timers.size,0);
  assert.equal(p.node('job-id').value,id);p.node('inspect').onclick();await tick();assert.equal(p.requests.length,count);p.dispose();
});

test('long-running job inspection is bounded and retains its recovery ID',async()=>{
  const id='e'.repeat(32);
  const p=await panel({jobData:({name,defaultJob})=>name==='get_fm1_job'?progressJob(defaultJob.id,'running',16):defaultJob});
  await p.invoke('inspect_fm1_job',{job_id:id});
  assert.equal(p.requests.filter(name=>name==='get_fm1_job').length,180);assert.ok(p.delays.includes(3000));
  assert.match(p.node('message').textContent,/Automatic progress paused/);assert.match(p.node('message').textContent,new RegExp(id));
  const count=p.requests.length;await tick();assert.equal(p.requests.length,count);p.dispose();
});

test('a mismatched authoritative job ID stops inspection before rendering its progress',async()=>{
  const id='e'.repeat(32),wrongId='f'.repeat(32);
  const p=await panel({jobData:({name,defaultJob})=>name==='get_fm1_job'?progressJob(wrongId,'succeeded',96):defaultJob});
  await assert.rejects(p.invoke('inspect_fm1_job',{job_id:id}),/selected saved job/);
  assert.equal(p.node('job-id').value,id);assert.ok(!p.node('detail').history.some(value=>value.includes(wrongId)));
  assert.equal(p.requests.filter(name=>name==='get_fm1_job').length,1);p.dispose();
});

test('an older delivery snapshot is labeled as saved and does not start a second operation',async()=>{
  const id='e'.repeat(32);const p=await panel();
  p.env.DB.sqlite.prepare('INSERT INTO relay_tasks(id,user_id,operation,arguments,state,result,created) VALUES(?,?,?,?,?,?,?)').run(id,'alice','switch_app','{}','succeeded',JSON.stringify({status:'succeeded',data:progressJob(id,'running',16)}),1);
  await p.invoke('inspect_fm1_request',{request_id:id});
  assert.match(p.node('message').textContent,/Saved delivery snapshot/);assert.equal(p.node('job-id').value,id);
  assert.ok(!p.requests.includes('get_fm1_job'));assert.ok(!p.requests.includes('confirm_fm1_switch'));
  await p.invoke('inspect_fm1_job',{job_id:id});assert.equal(JSON.parse(p.node('detail').textContent).status,'succeeded');p.dispose();
});

test('official native confirmation stops at vendor handoff and never claims firmware transfer completion',async()=>{
  let reads=0;
  const p=await panel({embedded:true,official:true,inventory:detectedInventory(),jobData:({name,defaultJob})=>{
    if(name==='confirm_fm1_official_update')return {...defaultJob,status:'queued'};
    if(name==='get_fm1_job'){reads++;return {...defaultJob,operation:'official_updater',handoff:true,firmware_transfer_verified:false};}
    return defaultJob;
  }});
  p.node('official-update').onclick();await until(()=>p.node('approval').open);const id=p.env.DB.sqlite.prepare('SELECT id FROM official_update_approvals').get().id;
  p.node('confirm').onclick({isTrusted:true});await until(()=>p.node('detail').textContent.includes('firmware_transfer_verified'));
  assert.equal(reads,1);assert.equal(p.node('progress').hidden,true);assert.equal(p.node('job-id').value,id);
  assert.equal(JSON.parse(p.node('detail').textContent).firmware_transfer_verified,false);
  assert.equal(p.requests.filter(name=>name==='confirm_fm1_official_update').length,1);const count=p.requests.length;await tick();assert.equal(p.requests.length,count);p.dispose();
});

const appearanceKey='fm1.appearance.v2';
const savedAppearance=p=>JSON.parse(p.storage.get(appearanceKey));
function assertAppearanceStaysLocal(p){
  assert.equal(p.requests.length,0);
  assert.equal(p.notifications.filter(message=>message.method==='tools/call').length,0);
  assert.deepEqual(p.env.DB.sqlite.prepare('SELECT * FROM relay_tasks ORDER BY id').all(),p.seededTasks);
}

test('saved custom appearance restores controls and background without a device or MCP request',async()=>{
  const preferences={version:2,preset:'custom',pattern:'dots',background:'#eceff4',accent:'#2b6cb0'};
  const p=await panel({embedded:true,preferences});
  assert.equal(p.document.body.dataset.appearance,'custom');assert.equal(p.document.body.dataset.pattern,'dots');
  assert.equal(p.document.body.style.getPropertyValue('--paper'),'#eceff4');assert.equal(p.document.body.style.getPropertyValue('--accent'),'#2b6cb0');
  assert.equal(p.document.body.style.colorScheme,'light');assert.equal(p.node('appearance-summary').textContent,'Custom colours · Dots');
  assert.equal(p.node('appearance-background').value,'#eceff4');assert.equal(p.node('appearance-background-hex').value,'#eceff4');
  assert.equal(p.node('appearance-accent').value,'#2b6cb0');assert.equal(p.node('appearance-accent-hex').value,'#2b6cb0');
  assert.equal(p.node('appearance-pattern').value,'dots');assert.equal(p.storageWrites.length,0);assertAppearanceStaysLocal(p);p.dispose();
});

test('selecting a palette applies its colours and saves the selection locally',async()=>{
  const p=await panel({embedded:true});p.node('palette-mint-light').onclick();
  assert.equal(p.document.body.dataset.appearance,'mint-light');assert.equal(p.document.body.style.colorScheme,'light');
  assert.equal(p.document.body.style.getPropertyValue('--paper'),'#edf8f1');assert.equal(p.document.body.style.getPropertyValue('--accent'),'#16744f');
  assert.equal(p.node('appearance-summary').textContent,'Mint Light · Solid');
  assert.equal(p.node('palette-mint-light').getAttribute('aria-pressed'),'true');assert.equal(p.node('palette-fm1-mint').getAttribute('aria-pressed'),'false');
  assert.deepEqual(savedAppearance(p),{version:2,preset:'mint-light',pattern:'solid',background:'#edf8f1',accent:'#16744f'});
  assert.equal(p.node('appearance-status').textContent,'Appearance saved on this browser.');assertAppearanceStaysLocal(p);p.dispose();
});

test('changing the background pattern preserves the selected palette and saves its pattern',async()=>{
  const p=await panel({embedded:true,preferences:{version:2,preset:'midnight-blue',pattern:'solid'}});
  p.node('appearance-pattern').value='circuit-grid';p.node('appearance-pattern').onchange();
  assert.equal(p.document.body.dataset.appearance,'midnight-blue');assert.equal(p.document.body.dataset.pattern,'circuit-grid');
  assert.equal(p.node('appearance-summary').textContent,'Midnight Blue · Circuit Grid');
  assert.deepEqual(savedAppearance(p),{version:2,preset:'midnight-blue',pattern:'circuit-grid',background:'#0c1729',accent:'#86baff'});
  assertAppearanceStaysLocal(p);p.dispose();
});

test('the background colour picker creates a custom palette while preserving accent and pattern',async()=>{
  const p=await panel({embedded:true,preferences:{version:2,preset:'ocean-cyan',pattern:'scanlines'}});
  p.node('appearance-background').value='#ffffff';p.node('appearance-background').oninput();
  assert.equal(p.document.body.dataset.appearance,'custom');assert.equal(p.document.body.style.getPropertyValue('--paper'),'#ffffff');
  assert.equal(p.document.body.style.colorScheme,'light');assert.equal(p.node('appearance-background-hex').value,'#ffffff');
  assert.equal(p.node('palette-ocean-cyan').getAttribute('aria-pressed'),'false');
  assert.deepEqual(savedAppearance(p),{version:2,preset:'custom',pattern:'scanlines',background:'#ffffff',accent:'#67e6eb'});
  assertAppearanceStaysLocal(p);p.dispose();
});

test('the accent colour picker updates the custom accent and saves it without changing the background',async()=>{
  const p=await panel({embedded:true});p.node('appearance-accent').value='#ff6600';p.node('appearance-accent').oninput();
  assert.equal(p.document.body.style.getPropertyValue('--accent'),'#ff6600');assert.equal(p.node('appearance-accent-hex').value,'#ff6600');
  assert.deepEqual(savedAppearance(p),{version:2,preset:'custom',pattern:'solid',background:'#000000',accent:'#ff6600'});
  assertAppearanceStaysLocal(p);p.dispose();
});

test('complete custom hex input immediately applies and normalizes its colour',async()=>{
  const p=await panel({embedded:true});p.node('appearance-background-hex').value=' #E6EDF5 ';p.node('appearance-background-hex').oninput();
  assert.equal(p.node('appearance-background').value,'#e6edf5');assert.equal(p.node('appearance-background-hex').value,'#e6edf5');
  assert.equal(p.document.body.style.getPropertyValue('--paper'),'#e6edf5');assert.equal(savedAppearance(p).background,'#e6edf5');
  assert.equal(savedAppearance(p).preset,'custom');assertAppearanceStaysLocal(p);p.dispose();
});

test('reset restores and saves Forge Black with the solid pattern',async()=>{
  const p=await panel({embedded:true,preferences:{version:2,preset:'custom',pattern:'diagonal-stripes',background:'#ffffff',accent:'#0055ff'}});
  p.node('appearance-reset').onclick();
  assert.equal(p.document.body.dataset.appearance,'forge-black');assert.equal(p.document.body.dataset.pattern,'solid');
  assert.equal(p.document.body.style.colorScheme,'dark');assert.equal(p.node('appearance-summary').textContent,'Forge Black · Solid');
  assert.equal(p.node('palette-forge-black').getAttribute('aria-pressed'),'true');
  assert.deepEqual(savedAppearance(p),{version:2,preset:'forge-black',pattern:'solid',background:'#000000',accent:'#a3efcc'});
  assertAppearanceStaysLocal(p);p.dispose();
});

test('blocked preference storage still applies a palette and reports that it lasts for this panel',async()=>{
  const p=await panel({embedded:true,storageBlocked:true});p.node('palette-sakura-pink').onclick();
  assert.equal(p.document.body.dataset.appearance,'sakura-pink');assert.equal(p.node('appearance-summary').textContent,'Sakura Pink · Solid');
  assert.equal(p.document.body.style.getPropertyValue('--paper'),'#fff0f5');assert.equal(p.document.body.style.getPropertyValue('--accent'),'#a32d67');
  assert.equal(p.node('appearance-status').textContent,'Applied for this panel. This host does not allow saved colour preferences.');
  assert.equal(p.storageWrites.length,0);assertAppearanceStaysLocal(p);p.dispose();
});

test('malformed saved JSON falls back to Forge Black without replacing the stored value',async()=>{
  const p=await panel({embedded:true,preferences:'{broken'});
  assert.equal(p.document.body.dataset.appearance,'forge-black');assert.equal(p.node('appearance-summary').textContent,'Forge Black · Solid');
  assert.equal(p.document.body.style.getPropertyValue('--paper'),'#000000');assert.equal(p.storage.get(appearanceKey),'{broken');
  assert.equal(p.storageWrites.length,0);assertAppearanceStaysLocal(p);p.dispose();
});

test('an unsupported saved preference version uses the default palette and pattern',async()=>{
  const p=await panel({embedded:true,preferences:{version:99,preset:'sakura-pink',pattern:'dots'}});
  assert.equal(p.document.body.dataset.appearance,'forge-black');assert.equal(p.document.body.dataset.pattern,'solid');
  assert.equal(p.node('appearance-background').value,'#000000');assert.equal(p.node('appearance-accent').value,'#a3efcc');
  assert.equal(p.storageWrites.length,0);assertAppearanceStaysLocal(p);p.dispose();
});

test('unknown saved palette and pattern with invalid colours fall back to safe defaults',async()=>{
  const p=await panel({embedded:true,preferences:{version:2,preset:'missing',pattern:'missing',background:'url(https://invalid.test)',accent:'#123'}});
  assert.equal(p.document.body.dataset.appearance,'forge-black');assert.equal(p.document.body.dataset.pattern,'solid');
  assert.equal(p.document.body.style.getPropertyValue('--paper'),'#000000');assert.equal(p.document.body.style.getPropertyValue('--accent'),'#a3efcc');
  assert.equal(p.node('appearance-summary').textContent,'Forge Black · Solid');assert.equal(p.storageWrites.length,0);
  assertAppearanceStaysLocal(p);p.dispose();
});

test('invalid custom hex inputs keep the applied colours and do not save invalid preferences',async()=>{
  const p=await panel({embedded:true,preferences:{version:2,preset:'royal-violet',pattern:'circuit-grid'}});
  for(const [kind,value] of [['background','#123'],['accent','red']]){
    p.node('appearance-'+kind+'-hex').value=value;p.node('appearance-'+kind+'-hex').oninput();
    assert.equal(p.node('appearance-status').textContent,'Enter a colour as #RRGGBB.');
  }
  assert.equal(p.document.body.dataset.appearance,'royal-violet');assert.equal(p.document.body.dataset.pattern,'circuit-grid');
  assert.equal(p.document.body.style.getPropertyValue('--paper'),'#21162f');assert.equal(p.document.body.style.getPropertyValue('--accent'),'#c3a2ff');
  assert.equal(p.storageWrites.length,0);
  assertAppearanceStaysLocal(p);p.dispose();
});

const forgeBaseline={catalog_id:'factory-diag',job_id:'1'.repeat(32),sha256:digest,verified_at:'2026-10-11T01:00:00Z',write_verified:true,full_readback_verified:true,boot_verified:true};
const diagCatalog={apps:[{profile:'diagnostics',title:'Hardware diagnostics',variants:[{id:'factory-diag',title:'FM1 diagnostics',variant:'baseline',ready:true,sha256:digest}]}]};
const defaultProject={slug:'my-fm1-firmware',displayName:'My FM1 firmware',clockPreset:'sdk-default',clockOptIn:false,lcdPreset:'stock-dma',module:'diagnostics',usbAudio:true};

test('Forge starts opaque black and solid under a light host and ignores old version-one preferences',async()=>{
  const p=await panel({embedded:true,legacyPreferences:{version:1,preset:'mint-light',pattern:'circuit-grid'}});
  assert.equal(p.document.body.dataset.hostTheme,'light');assert.equal(p.document.body.dataset.appearance,'forge-black');
  assert.equal(p.document.body.dataset.pattern,'solid');assert.equal(p.document.body.style.getPropertyValue('--paper'),'#000000');
  assert.equal(p.document.documentElement.style.backgroundColor,'#000000');assert.equal(p.document.documentElement.style.colorScheme,'dark');
  assert.match(UI_HTML,/html\{background:#000000;min-height:100%;color-scheme:dark\}/);
  assert.match(UI_HTML,/min-height:100vh;min-height:100dvh/);assert.ok(!p.storage.has(appearanceKey));assertAppearanceStaysLocal(p);p.dispose();
});

test('only complete diagnostics transfer and startup evidence unlocks a new project',async()=>{
  for(const baseline of [null,{...forgeBaseline,catalog_id:'nes-test'},{...forgeBaseline,write_verified:false},{...forgeBaseline,full_readback_verified:false},{...forgeBaseline,boot_verified:false},{...forgeBaseline,job_id:'not-a-job'},{...forgeBaseline,sha256:'abc'}]){
    const p=await panel({embedded:true,baseline,catalogValue:diagCatalog});
    assert.equal(p.node('new-forge-project').disabled,true);assert.equal(p.node('forge-ask').disabled,true);
    assert.ok(!p.node('diagnostics-status').textContent.includes('startup verified'));
    p.node('new-forge-project').onclick();assert.equal(p.node('forge-designer').open,false);
    p.node('forge-ask').onclick({isTrusted:true});await tick();assert.match(p.node('forge-project-status').textContent,/verify the diagnostics baseline/);
    assert.ok(!p.notifications.some(message=>message.method==='ui/message'));p.dispose();
  }
  const p=await panel({embedded:true,baseline:forgeBaseline,catalogValue:diagCatalog});
  assert.equal(p.node('new-forge-project').disabled,false);assert.equal(p.node('forge-ask').disabled,false);
  assert.match(p.node('diagnostics-status').textContent,/transfer and startup verified/);assert.match(p.node('diagnostics-status').textContent,/Test every input/);
  p.node('new-forge-project').onclick();assert.equal(p.node('forge-designer').open,true);assertAppearanceStaysLocal(p);p.dispose();
});

test('diagnostics review preserves all three serial and UBOOT entry methods and does not transfer',async()=>{
  for(const entry_method of ['auto','serial','already_uboot']){
    const p=await panel({embedded:true,inventory:detectedInventory('serial'),catalogValue:diagCatalog});
    assert.equal(p.node('install-diagnostics').disabled,false);p.node('diag-entry-method').value=entry_method;p.node('install-diagnostics').onclick();await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(p.requestArgs.find(call=>call.name==='prepare_fm1_switch').args)),{catalog_id:'factory-diag',entry_method});
    assert.equal(p.node('approval').open,true);assert.ok(!p.requests.includes('confirm_fm1_switch'));
    assert.equal(p.node('new-forge-project').disabled,true);p.dispose();
  }
});

test('a completed saved job without canonical baseline evidence cannot unlock the project',async()=>{
  const p=await panel({catalogValue:diagCatalog,jobData:({defaultJob})=>({...defaultJob,catalog_id:'factory-diag',simulation:false,full_readback_verified:true,boot_verified:true})});
  await p.invoke('inspect_fm1_job',{job_id:'2'.repeat(32)});
  assert.equal(p.node('new-forge-project').disabled,true);assert.equal(p.node('forge-ask').disabled,true);
  assert.ok(!p.node('diagnostics-status').textContent.includes('startup verified'));p.dispose();
});

test('module configuration generates the canonical version-two config with fixed recovery',async()=>{
  const p=await panel({embedded:true,baseline:forgeBaseline});
  p.node('forge-project-name').value='FM1 Pad Lab';p.node('forge-project-slug').value='pad-lab';p.node('forge-module').value='user';
  p.node('forge-usb-audio').checked=false;p.node('forge-lcd-preset').value='spi15-rgb444';p.node('forge-module').onchange();
  assert.deepEqual(JSON.parse(p.node('forge-config').textContent),{schemaVersion:2,project:{slug:'pad-lab',displayName:'FM1 Pad Lab'},profile:'forge-diag',clockPreset:'sdk-default',lcdPreset:'spi15-rgb444',module:'user',usb:{cdc:true,uac:false,uboot:true},hal:{buttons:true,encoders:true,volume:true,lcd:true,audio:true}});
  assert.equal(p.node('forge-module-title').textContent,'Your module');assert.match(p.node('forge-prompt').value,/shared HAL/);
  p.node('forge-clock-preset').value='sdk-320';p.node('forge-clock-preset').onchange();assert.match(p.node('forge-project-status').textContent,/experimental CPU clock/);assert.equal(p.node('forge-config').textContent,'');
  p.node('forge-clock-opt-in').checked=true;p.node('forge-clock-opt-in').onchange();assert.match(p.node('forge-project-status').textContent,/incompatible.*53 MHz.*60 MHz/);
  p.node('forge-lcd-preset').value='stock-dma';p.node('forge-lcd-preset').onchange();assert.equal(JSON.parse(p.node('forge-config').textContent).clockPreset,'sdk-320');
  assertAppearanceStaysLocal(p);p.dispose();
});

test('project configuration rejects malformed IDs, unsupported modules and bypassed clock opt-in',()=>{
  for(const overrides of [{slug:'../elsewhere'},{slug:'Upper'},{slug:'con'},{slug:'com1'},{displayName:'\u0000'},{clockPreset:'sdk-480'},{clockPreset:'sdk-320',clockOptIn:false},{lcdPreset:'fastest'},{module:'raw-usb'},{usbAudio:'true'}])assert.throws(()=>projectConfig({...defaultProject,...overrides}));
  const config=projectConfig(defaultProject);assert.equal(config.usb.cdc,true);assert.equal(config.usb.uboot,true);
  assert.throws(()=>projectConfig({...defaultProject,devicePort:'COM10'}),/supported fields/);
  for(const malformed of [{...config,flash:true},{...config,project:{...config.project,path:'../outside'}},{...config,usb:{...config.usb,midi:true}}])assert.throws(()=>projectPrompt(malformed,'test'),/Invalid Forge/);
  assert.throws(()=>projectPrompt({...config,usb:{...config.usb,cdc:false}},'test'),/recovery/);
  assert.throws(()=>projectPrompt(config,'x'.repeat(2001)),/2000/);assert.throws(()=>projectPrompt(config,'\u0000'),/2000/);
  assert.equal(verifiedBaseline(forgeBaseline),true);
  assert.equal(verifiedDiagnostics({id:'1'.repeat(32),catalog_id:'factory-diag',status:'succeeded',full_readback_verified:true,boot_verified:true}),true);
  assert.equal(verifiedDiagnostics({id:'1'.repeat(32),catalog_id:'factory-diag',status:'succeeded',simulation:true,full_readback_verified:true,boot_verified:true}),false);
});

test('drag/drop and accessible actions edit the actual project while protecting recovery',async()=>{
  const p=await panel({embedded:true,baseline:forgeBaseline});
  const config=()=>JSON.parse(p.node('forge-config').textContent);
  const drag=(id,part)=>{const values=new Map();const dataTransfer={setData:(key,value)=>values.set(key,value),getData:key=>values.get(key)};p.node('forge-card-'+id).dragstart({dataTransfer});p.node('forge-drop-'+part).drop({dataTransfer,preventDefault(){}});};
  assert.deepEqual(config().hal,{buttons:true,encoders:true,volume:true,lcd:true,audio:true});
  for(const name of ['buttons','encoders','volume','lcd','audio']){
    drag('hal-'+name,'library');assert.equal(config().hal[name],false);assert.equal(p.node('forge-card-hal-'+name).hidden,true);
    assert.equal(p.node('forge-add-hal-'+name).hidden,false);p.node('forge-add-hal-'+name).onclick();assert.equal(config().hal[name],true);
  }
  const before=config();drag('hal-buttons','usb');assert.deepEqual(config(),before);assert.match(p.node('forge-graph-status').textContent,/belongs in HAL/);
  for(const id of ['usb-cdc','usb-uboot']){drag(id,'library');assert.deepEqual(config(),before);assert.match(p.node('forge-graph-status').textContent,/stays enabled/);assert.equal(p.node('forge-card-'+id).hidden,false);}
  drag('usb-uac','library');assert.equal(config().usb.uac,false);p.node('forge-add-usb-uac').onclick();assert.equal(config().usb.uac,true);
  p.node('forge-add-module-user').onclick();assert.equal(config().module,'user');assert.equal(p.node('forge-card-module-diagnostics').hidden,true);
  drag('module-user','library');assert.equal(config().module,'user');assert.match(p.node('forge-graph-status').textContent,/another user module/);
  p.node('forge-add-module-diagnostics').onclick();assert.equal(config().module,'diagnostics');
  p.node('forge-add-tweak-fast-lcd').onclick();assert.equal(config().lcdPreset,'spi15-rgb444');
  p.node('forge-lcd-preset').value='spi30-rgb444';p.node('forge-lcd-preset').onchange();drag('tweak-fast-lcd','tweaks');assert.equal(config().lcdPreset,'spi30-rgb444');
  p.node('forge-remove-tweak-fast-lcd').onclick();assert.equal(config().lcdPreset,'stock-dma');
  p.node('forge-add-tweak-clock').onclick();assert.equal(p.node('forge-config').textContent,'');assert.match(p.node('forge-project-status').textContent,/experimental CPU clock/);
  p.node('forge-clock-opt-in').checked=true;p.node('forge-clock-opt-in').onchange();assert.equal(config().clockPreset,'sdk-320');
  p.node('forge-remove-tweak-clock').onclick();assert.equal(config().clockPreset,'sdk-default');assert.equal(p.node('forge-clock-opt-in').checked,false);
  assert.equal(p.requests.length,0);assertAppearanceStaysLocal(p);p.dispose();
});

test('HAL checkbox selections survive passive refresh and are reflected in prompt/config',async()=>{
  const p=await panel({embedded:true,baseline:forgeBaseline});
  p.node('forge-hal-volume').checked=false;p.node('forge-hal-volume').onchange();
  assert.match(p.node('forge-graph-status').textContent,/4 of 5 HAL/);
  const before=p.node('forge-config').textContent;await p.advancePoll(5000);assert.ok(p.requests.includes('get_fm1_status'));
  assert.equal(p.node('forge-hal-volume').checked,false);assert.equal(p.node('forge-config').textContent,before);
  assert.equal(JSON.parse(before).hal.volume,false);assert.match(p.node('forge-prompt').value,/"volume": false/);p.dispose();
});

test('the compiler-proven CPU and fast-LCD combination is rejected without blocking supported presets',()=>{
  for(const lcdPreset of ['spi15-rgb444','spi30-rgb444']){
    assert.throws(()=>projectConfig({...defaultProject,clockPreset:'sdk-320',clockOptIn:true,lcdPreset}),/incompatible.*53 MHz.*60 MHz/);
    const config=projectConfig({...defaultProject,lcdPreset});assert.equal(config.lcdPreset,lcdPreset);
    assert.throws(()=>projectPrompt({...config,clockPreset:'sdk-320'}),/incompatible.*53 MHz.*60 MHz/);
  }
  assert.equal(projectConfig({...defaultProject,clockPreset:'sdk-320',clockOptIn:true}).lcdPreset,'stock-dma');
});

test('Ask Codex uses the supported native message method once and never submits a device operation',async()=>{
  const p=await panel({embedded:true,hostMessages:true,baseline:forgeBaseline});p.node('forge-project-goal').value='Make a pad-controlled synth.';
  p.node('forge-ask').onclick({isTrusted:false});await tick();assert.ok(!p.notifications.some(message=>message.method==='ui/message'));
  p.node('forge-ask').onclick({isTrusted:true});await tick();
  const messages=p.notifications.filter(message=>message.method==='ui/message');assert.equal(messages.length,1);
  assert.equal(messages[0].params.role,'user');assert.match(messages[0].params.content[0].text,/Make a pad-controlled synth/);
  assert.match(messages[0].params.content[0].text,/Do not flash/);assert.match(p.node('forge-project-status').textContent,/request sent to Codex/);
  assert.equal(p.requests.length,0);assert.deepEqual(p.env.DB.sqlite.prepare('SELECT * FROM relay_tasks ORDER BY id').all(),p.seededTasks);p.dispose();
});

test('missing message capability and standalone Site keep a copyable prompt without pretending to build',async()=>{
  for(const embedded of [true,false]){
    const p=await panel({embedded,baseline:forgeBaseline});const requests=p.requests.length;p.node('forge-ask').onclick({isTrusted:true});await tick();
    assert.match(p.node('forge-project-status').textContent,embedded?/does not support this conversation action/:/cannot send a project message/);assert.match(p.node('forge-prompt').value,/Create and build/);
    assert.equal(p.node('forge-output').open,true);assert.equal(p.requests.length,requests);assert.ok(!p.notifications.some(message=>message.method==='ui/message'));p.dispose();
  }
});

test('host rejection leaves the project prompt available and does not report a successful build request',async()=>{
  const p=await panel({embedded:true,hostMessages:true,hostRejectMessage:true,baseline:forgeBaseline});
  p.node('forge-ask').onclick({isTrusted:true});await tick();assert.match(p.node('forge-project-status').textContent,/host rejected/);
  assert.match(p.node('forge-project-status').textContent,/prompt remains available/);assert.ok(!p.node('forge-project-status').textContent.includes('request sent'));
  assert.ok(p.node('forge-prompt').value.length>100);assert.equal(p.requests.length,0);p.dispose();
});

test('editing user modules and appearance preserves the selected saved job and sector progress',async()=>{
  const p=await panel({jobData:({defaultJob})=>progressJob(defaultJob.id,'succeeded',96)});await p.invoke('inspect_fm1_job',{job_id:'3'.repeat(32)});
  const detail=p.node('detail').textContent,requests=p.requests.length;p.node('forge-module').value='user';p.node('forge-module').onchange();p.node('palette-forge-black').onclick();
  assert.equal(p.node('job-id').value,'3'.repeat(32));assert.equal(p.node('detail').textContent,detail);assert.equal(p.node('progress-bar').value,96);
  assert.equal(p.requests.length,requests);p.dispose();
});

test('project text stays in text-only controls and never enters rendered HTML or the transfer request',async()=>{
  const p=await panel({embedded:true,hostMessages:true,baseline:forgeBaseline});
  const payload='</textarea><img src=x onerror=alert(1)>';
  p.node('forge-project-name').value=payload;p.node('forge-project-goal').value=payload;p.node('forge-project-name').oninput();
  assert.equal(JSON.parse(p.node('forge-config').textContent).project.displayName,payload);
  assert.ok(p.node('forge-prompt').value.includes(payload));assert.ok(!p.node('library').innerHTML.includes(payload));
  p.node('forge-ask').onclick({isTrusted:true});await tick();assert.equal(p.requests.length,0);
  const message=p.notifications.find(message=>message.method==='ui/message');assert.equal(message.params.content[0].type,'text');p.dispose();
});

test('editing a project preserves an uncertain transfer outcome and its exact recovery ID',async()=>{
  const p=await panel({jobData:({defaultJob})=>progressJob(defaultJob.id,'unknown',32)});const id='4'.repeat(32);
  await p.invoke('inspect_fm1_job',{job_id:id});const detail=p.node('detail').textContent,requests=p.requests.length;
  p.node('forge-project-goal').value='A new sequencer';p.node('forge-project-goal').oninput();p.node('forge-copy').onclick();await tick();
  assert.equal(p.node('job-id').value,id);assert.equal(p.node('detail').textContent,detail);assert.equal(JSON.parse(detail).status,'unknown');
  assert.equal(p.requests.length,requests);assert.ok(!p.requests.includes('confirm_fm1_switch'));p.dispose();
});

test('the persisted diagnostics baseline remains usable after recent-request history rotates',async()=>{
  const p=await panel(),id='5'.repeat(32),timestamp=Math.floor(Date.now()/1000);
  p.env.DB.sqlite.prepare('INSERT INTO forge_baselines(user_id,job_id,sha256,verified_at) VALUES(?,?,?,?)').run('alice',id,digest,timestamp);
  for(let batch=0;batch<2;batch++){
    for(let index=1;index<=16;index++)p.env.DB.sqlite.prepare('INSERT INTO relay_tasks(id,user_id,operation,arguments,state,result,created) VALUES(?,?,?,?,?,?,?)')
      .run((batch*16+index).toString(16).padStart(32,'0'),'alice','plan_app','{}','succeeded',JSON.stringify({status:'succeeded',data:{simulation:true}}),timestamp+batch*16+index);
    const view=await p.invoke('view_fm1_library',{});
    assert.equal(view.recent_requests.length,12);assert.ok(!view.recent_requests.some(request=>request.id===id));
    assert.equal(view.forge.diagnostic_baseline.job_id,id);assert.equal(p.node('new-forge-project').disabled,false);
    assert.match(p.node('diagnostics-status').textContent,new RegExp(id));
  }
  assert.ok(!p.requests.includes('confirm_fm1_switch'));p.dispose();
});


test('native message controls use all official extension targets without submitting a device job',async()=>{
  for(const [mode,target,send] of [['active-send','active',true],['active-draft','active',false],['new-send','new',true],['new-draft','new',false]]){
    const p=await panel({embedded:true,nativeExtensions:true,baseline:forgeBaseline});p.node('forge-message-mode').value=mode;p.node('forge-ask').onclick({isTrusted:true});await tick();
    const messages=p.notifications.filter(message=>message.method==='ui/message');assert.equal(messages.length,1);assert.deepEqual(JSON.parse(JSON.stringify(messages[0].params._meta['openai/message'])),{target,send});
    assert.equal(p.requests.length,0);assert.deepEqual(p.env.DB.sqlite.prepare('SELECT * FROM relay_tasks ORDER BY id').all(),p.seededTasks);p.dispose();
  }
});
test('native file input/result ordering opens file mode without status, catalog or relay calls',async()=>{
  for(const fileInputFirst of [true,false]){
    const p=await panel({embedded:true,initialFile:{name:'selected.fm1-forge.json',resourceUri:'host-resource:opaque-file'},fileInputFirst});
    assert.equal(p.requests.length,0);assert.equal(p.node('forge-extension-panel').open,true);assert.match(p.node('forge-file-status').textContent,/cannot read selected resources/);
    await p.advancePoll(60000);assert.equal(p.pollTimers.size,0);assert.equal(p.requests.length,0);assert.deepEqual(p.env.DB.sqlite.prepare('SELECT * FROM relay_tasks ORDER BY id').all(),p.seededTasks);p.dispose();
  }
});


test('native quick action initial form result restores accepted goal and config before build handoff',async()=>{
  const config=projectConfig({...defaultProject,module:'user',slug:'quick-action',displayName:'Quick Action'}),goal='Make a pad-controlled synthesizer from the native form.';
  const p=await panel({embedded:true,hostMessages:true,initialToolResult:{action:'accept',config,goal,clock_opt_in:false,project:{id:'a'.repeat(32),config},forge:{diagnostic_baseline:forgeBaseline}}});
  assert.equal(p.node('forge-project-goal').value,goal);assert.equal(p.node('forge-project-slug').value,'quick-action');assert.equal(p.node('forge-module').value,'user');assert.match(p.node('forge-prompt').value,/Make a pad-controlled synthesizer from the native form/);
  await p.advancePoll(60000);assert.equal(p.pollTimers.size,0);p.node('forge-ask').onclick({isTrusted:true});await tick();assert.match(p.notifications.find(m=>m.method==='ui/message').params.content[0].text,/Make a pad-controlled synthesizer from the native form/);assert.deepEqual(p.requests,[]);p.dispose();
});


test('initial native form gate cannot fabricate diagnostic proof or start hardware work',async()=>{
  const config=projectConfig({...defaultProject,module:'user'}),p=await panel({embedded:true,hostMessages:true,initialToolResult:{action:'accept',config,goal:'A new synthesizer',gate:{diagnostics_verified:true,can_start_project:true},project:{id:'b'.repeat(32),config}}});
  assert.equal(p.node('forge-ask').disabled,true);p.node('forge-ask').onclick({isTrusted:true});await tick();assert.match(p.node('forge-project-status').textContent,/verify the diagnostics baseline/);
  assert.equal(p.requests.length,0);assert.ok(!p.notifications.some(m=>m.method==='ui/message'));assert.deepEqual(p.env.DB.sqlite.prepare('SELECT * FROM relay_tasks ORDER BY id').all(),p.seededTasks);p.dispose();
});

const disconnectedInventory=()=>({device:{serial_ports:[],uboot_disks:[],update_mode:{mode:'disconnected'},official_update:{configured:true,available:false}},engine:{active:null,blocked_unknown:false}});
test('native panel automatically observes physical disconnection without recataloging or replacing cards',async()=>{
  const p=await panel({embedded:true,nativeControls:true,jobData:({name,defaultJob})=>name==='get_fm1_status'?disconnectedInventory():defaultJob});
  const cards=p.node('library').innerHTML;assert.equal(p.node('device-heading').textContent,'FM1 on COM10');await p.advancePoll(1499);assert.equal(p.requests.length,0);await p.advancePoll(1);
  assert.equal(p.node('device-heading').textContent,'FM1 disconnected');assert.equal(p.node('physical-device').textContent,'FM1 disconnected');assert.equal(p.node('relay-state').textContent,'Connected');assert.match(p.node('inventory-freshness').textContent,/Checked \d+s ago/);
  assert.equal(p.node('switch-nes').disabled,true);assert.equal(p.node('library').innerHTML,cards);assert.deepEqual(p.requests,['get_fm1_status','get_fm1_request','open_fm1_library']);await p.advancePoll(5000);assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,2);assert.ok(!p.requests.includes('list_fm1_apps'));assert.ok(!p.requests.some(name=>name.startsWith('confirm_')));p.dispose();assert.equal(p.pollTimers.size,0);
});
test('pending automatic observations expire instead of indefinitely presenting the last connected port',async()=>{
  const p=await panel({embedded:true,nativeControls:true,jobData:({name,defaultJob})=>name==='get_fm1_status'?null:defaultJob});await p.advancePoll(16500);
  assert.equal(p.node('device-heading').textContent,'Connection status unavailable');assert.equal(p.node('physical-device').textContent,'Connection status unavailable');assert.match(p.node('inventory-freshness').textContent,/Last seen FM1 on COM10/);assert.equal(p.node('switch-nes').disabled,true);assert.equal(p.node('official-state').textContent,'Unavailable');assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);
  const id=p.requestArgs.find(item=>item.name==='get_fm1_status');assert.ok(id);const deliveries=p.requestArgs.filter(item=>item.name==='get_fm1_request');assert.ok(deliveries.length>=3);assert.equal(new Set(deliveries.map(item=>item.args.request_id)).size,1);p.dispose();
});
test('a failed automatic check retains last seen history and does not claim physical disconnection',async()=>{
  const p=await panel({embedded:true,nativeControls:true,beforeCall:name=>{if(name==='get_fm1_status')throw new Error('Connection timed out.');}});await p.advancePoll(1500);
  assert.equal(p.node('device-heading').textContent,'Connection status unavailable');assert.match(p.node('inventory-freshness').textContent,/Last seen FM1 on COM10.*refresh failed/);assert.equal(p.node('official-state').textContent,'Unavailable');assert.equal(p.node('switch-nes').disabled,true);assert.ok(!p.node('physical-device').history.includes('FM1 disconnected'));assert.equal(p.node('relay-state').textContent,'Connected');p.dispose();
});
test('successful transport with an enumeration error cannot replace connection history with disconnected',async()=>{
  const failed={...disconnectedInventory(),device:{...disconnectedInventory().device,inventory_error:'Windows device enumeration failed'}};
  const p=await panel({embedded:true,nativeControls:true,jobData:({name,defaultJob})=>name==='get_fm1_status'?failed:defaultJob});await p.advancePoll(1500);
  assert.equal(p.node('physical-device').textContent,'Connection status unavailable');assert.match(p.node('inventory-freshness').textContent,/Last seen FM1 on COM10.*refresh failed/);assert.equal(p.node('official-state').textContent,'Unavailable');assert.ok(!p.node('physical-device').history.includes('FM1 disconnected'));p.dispose();
});
test('cached native observations with old or future timestamps cannot revive connected headings',async()=>{
  for(const observed_at of [Math.floor(Date.now()/1000)-7200,Math.floor(Date.now()/1000)+7200]){
    const p=await panel({embedded:true,serverTools:false,initialToolResult:{profiles:[],catalog:{apps:[]},relay:{connected:true,allow_switch:true},inventory:{device:{serial_ports:[{port:'COM10'}],update_mode:{mode:'serial'}}},inventory_status:{state:'fresh',observed_at,age_seconds:1,max_age_seconds:15},recent_requests:[]}});
    assert.equal(p.node('physical-device').textContent,'Connection status unavailable');assert.equal(p.node('device-heading').textContent,'Connection status unavailable');assert.match(p.node('inventory-freshness').textContent,/Last seen FM1 on COM10/);await p.advancePoll(60000);assert.equal(p.requests.length,0);assert.equal(p.pollTimers.size,0);p.dispose();
  }
});
test('automatic metadata preserves job progress, firmware drafts, theme, selected variant and diagnostic proof',async()=>{
  const variants=[{id:'nes-test',title:'First NES',variant:'one',sha256:digest,ready:true},{id:'nes-second',title:'Second NES',variant:'two',sha256:digest,ready:true}];
  const p=await panel({embedded:true,nativeControls:true,baseline:forgeBaseline,catalogValue:{apps:[{profile:'nes',title:'NES',variants}]},jobData:({name,defaultJob})=>name==='get_fm1_status'?disconnectedInventory():name==='get_fm1_job'?progressJob(defaultJob.id,'succeeded',96):defaultJob});
  const id='e'.repeat(32);p.node('job-id').value=id;p.node('inspect').onclick();await until(()=>p.node('detail').textContent.includes(id)&&p.node('progress-bar').value===96);
  p.node('variant-nes').value='nes-second';p.node('forge-project-goal').value='Keep this unfinished synthesizer draft';p.node('forge-project-goal').oninput();p.node('palette-forge-black').onclick();
  const before={detail:p.node('detail').textContent,message:p.node('message').textContent,cards:p.node('library').innerHTML,config:p.node('forge-config').textContent,prompt:p.node('forge-prompt').value};await p.advancePoll(1500);
  assert.equal(p.node('device-heading').textContent,'FM1 disconnected');assert.equal(p.node('job-id').value,id);assert.equal(p.node('detail').textContent,before.detail);assert.equal(p.node('message').textContent,before.message);assert.equal(p.node('progress-bar').value,96);assert.equal(p.node('library').innerHTML,before.cards);assert.equal(p.node('variant-nes').value,'nes-second');assert.equal(p.node('forge-config').textContent,before.config);assert.equal(p.node('forge-prompt').value,before.prompt);assert.equal(p.document.body.dataset.appearance,'forge-black');assert.equal(p.node('new-forge-project').disabled,false);p.dispose();
});
test('manual Refresh shares a slow automatic observation and preserves a selected job result',async()=>{
  let release;const held=new Promise(done=>{release=done;});const p=await panel({embedded:true,beforeCall:name=>name==='get_fm1_status'?held:undefined,jobData:({name,defaultJob})=>name==='get_fm1_status'?disconnectedInventory():name==='get_fm1_job'?progressJob(defaultJob.id,'succeeded',96):defaultJob});
  const id='f'.repeat(32);p.node('job-id').value=id;p.node('inspect').onclick();await until(()=>p.node('detail').textContent.includes(id));const detail=p.node('detail').textContent,message=p.node('message').textContent;
  await p.advancePoll(1500);p.node('refresh').onclick();await tick();assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);release();await until(()=>p.requests.includes('list_fm1_apps'));await tick();
  assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);assert.equal(p.node('job-id').value,id);assert.equal(p.node('detail').textContent,detail);assert.equal(p.node('message').textContent,message);assert.equal(p.node('progress-bar').value,96);p.dispose();
});
test('automatic connection render keeps app cards without variants unavailable',async()=>{
  const p=await panel({embedded:true,nativeControls:true,catalogValue:{apps:[{profile:'nes',title:'NES',variants:[]}]},jobData:({name,defaultJob})=>name==='get_fm1_status'?{device:{serial_ports:[{port:'COM10'}],update_mode:{mode:'serial'}},engine:{blocked_unknown:false}}:defaultJob});await p.advancePoll(1500);
  assert.equal(p.node('physical-device').textContent,'FM1 on COM10');assert.equal(p.node('plan-nes').disabled,true);assert.equal(p.node('switch-nes').disabled,true);p.dispose();
});
test('hidden and offline panels pause observation; visible, focus and online events resume once',async()=>{
  const p=await panel({embedded:true,jobData:({name,defaultJob})=>name==='get_fm1_status'?disconnectedInventory():defaultJob});p.document.hidden=true;p.events.get('visibilitychange')();await p.advancePoll(30000);assert.equal(p.requests.length,0);assert.equal(p.pollTimers.size,0);
  p.document.hidden=false;p.events.get('visibilitychange')();p.events.get('focus')();await tick();assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);
  p.window.navigator.onLine=false;p.events.get('offline')();await p.advancePoll(30000);assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);assert.equal(p.pollTimers.size,0);assert.equal(p.node('device-heading').textContent,'Connection status unavailable');
  p.window.navigator.onLine=true;p.events.get('online')();p.events.get('focus')();await tick();assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,2);p.dispose();assert.equal(p.pollTimers.size,0);for(const event of ['visibilitychange','focus','online','offline','message'])assert.equal(p.events.has(event),false);await p.advancePoll(60000);assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,2);
});
