import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { UI_HTML, WINDOWS_UI_HTML, MACOS_UI_HTML } from '../lib/fm1-ui.mjs';
import * as generated from '../lib/fm1-app-sdk.generated.mjs';
import { appearanceRuntime } from '../lib/fm1-appearance.mjs';
import { moduleGraphRuntime } from '../lib/fm1-module-graph.mjs';
import { extensionRuntime } from '../lib/fm1-extension-ui.mjs';
import { inventoryRuntime } from '../lib/fm1-inventory-refresh.mjs';
import { libraryRuntime } from '../lib/fm1-library-ui.mjs';
import { callTool } from '../lib/fm1-server.mjs';
import { database, connect, cacheCatalog, cacheInventory, digest } from './d1.mjs';
import {projectConfig,projectPrompt,verifiedDiagnostics,verifiedBaseline,forgeProjectRuntime} from '../lib/fm1-forge-project.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
async function until(predicate){for(let attempt=0;attempt<100;attempt++){if(predicate())return;await tick();}assert.fail('Panel did not reach the expected state.');}
let productionHtml;
function minifiedPanelHtml(){
  return productionHtml??=(async()=>{
    const built=await build({entryPoints:[fileURLToPath(new URL('../lib/fm1-ui.mjs',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',target:'node22',minify:true});
    const {UI_HTML:html}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
    return html;
  })();
}
async function panel({html=UI_HTML,embedded=false,initial=true,serverTools=true,hostMessages=false,hostRejectMessage=false,baseline=null,catalogValue=null,inventory=null,official=false,stock=false,loseConfirmationReply=false,jobData=null,beforeCall=null,nativeControls=false,omitPlanJobId=false,preferences=null,storageBlocked=false,legacyPreferences=null,nativeExtensions=false,initialFile=null,fileInputFirst=true,initialToolResult=null,nativeStartupDelay=1,preserveDirectMode=false,backendOverride=null}={}){
  // Historical helper transport contracts remain exercised through test-local
  // injection. The shipped panel has no switch to enable helper autoload;
  // browser-devices-ui.test.mjs verifies its actual direct-mode default.
  if(!preserveDirectMode)html=html.replace('const directMode=true;','const directMode=false;');
  const normalInventory=inventory||{device:{serial_ports:[{port:'COM10'}],update_mode:{mode:'serial',app_entry_method:'serial'},official_update:{configured:true,available:false,sha256:digest}},engine:{active:null,blocked_unknown:false}};
  const env=database();connect(env,true,official,stock);cacheCatalog(env,'alice',catalogValue||undefined);cacheInventory(env,'alice',normalInventory);
  const seededTasks=env.DB.sqlite.prepare('SELECT * FROM relay_tasks ORDER BY id').all();
  const nodes=new Map(),registered=new Map(),requests=[],requestArgs=[],events=new Map(),notifications=[],timers=new Map(),pollTimers=new Map(),delays=[],storage=new Map(),storageWrites=[];let panelNow=Date.now(),pollKey=0;
  if(preferences!==null)storage.set('fm1.appearance.v2',typeof preferences==='string'?preferences:JSON.stringify(preferences));
  if(legacyPreferences!==null)storage.set('fm1.appearance.v1',JSON.stringify(legacyPreferences));
  const initialValues={'forge-project-name':'My FM-1 firmware','forge-project-slug':'my-fm1-firmware','forge-project-goal':'','forge-clock-preset':'sdk-default','forge-lcd-preset':'stock-dma','forge-module':'diagnostics','diag-entry-method':'auto'};
  function node(id){if(!nodes.has(id)){let text='';const attributes=new Map();nodes.set(id,{history:[],get textContent(){return text;},set textContent(value){text=value;this.history.push(value);},innerHTML:'',value:initialValues[id]??(id==='variant-nes'?'nes-test':''),checked:id==='forge-usb-audio'||id==='forge-usb-audio-capture'||id==='forge-usb-midi-update'||id.startsWith('forge-hal-'),dataset:{profile:'nes',plan:'nes',switch:'nes'},hidden:true,open:id==='forge-designer',style:{},querySelectorAll:selector=>id==='library'&&nativeControls?selector==='select'?[node('variant-nes')]:selector==='[data-plan]'?[node('plan-nes')]:selector==='[data-switch]'?[node('switch-nes')]:[]:[],querySelector:selector=>id==='library'&&nativeControls?(selector.startsWith('[data-profile=')?node('variant-nes'):node('digest-nes')):null,setAttribute(name,value){attributes.set(name,String(value));},getAttribute(name){return attributes.get(name)??null;},removeAttribute(name){attributes.delete(name);if(name==='value')delete this.value;},showModal(){this.open=true;},close(){this.open=false;},addEventListener(name,fn){this[name]=fn;}});}return nodes.get(id);}
  const initialData=await callTool(env,'alice','open_fm1_library',{});
  if(baseline)initialData.forge={diagnostic_baseline:baseline};
  if(inventory)initialData.inventory=inventory;
  const window={localStorage:{getItem(key){if(storageBlocked)throw new Error('Local storage is blocked by this host.');return storage.get(key)??null;},setItem(key,value){if(storageBlocked)throw new Error('Local storage is blocked by this host.');storage.set(key,String(value));storageWrites.push({key,value:String(value)});}},addEventListener(name,fn,options){events.set(name,fn);options?.signal?.addEventListener('abort',()=>events.delete(name));},removeEventListener(name){events.delete(name);}};
  const parent=embedded?{postMessage(message){notifications.push(message);if(message.id===undefined||!message.method)return;queueMicrotask(async()=>{
    let response;
    try{
      const result=message.method==='ui/initialize'?{protocolVersion:'2026-01-26',hostInfo:{name:'FM-1 fixture host',version:'1'},hostCapabilities:{...(serverTools?{serverTools:{}}:{}),...(hostMessages?{message:{text:{}}}:{}),...(nativeExtensions?{experimental:{'openai/message':{}}}:{})},hostContext:{theme:'light',displayMode:'fullscreen'}}:message.method==='ui/message'?{isError:hostRejectMessage}:toolResult(await backend(message.params.name,message.params.arguments));
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
  async function backend(name,args){requests.push(name);requestArgs.push({name,args});await beforeCall?.(name,args);const answer=backendOverride?await backendOverride(name,args):await callTool(env,'alice',name,args);if(name==='open_fm1_library'&&baseline)answer.forge={diagnostic_baseline:baseline};if(answer.request_id){const defaultJob={id:args.job_id||answer.job_id||answer.request_id,status:'succeeded',simulation:true},data=jobData?await jobData({name,args,answer,defaultJob}):defaultJob;if(data!==null)env.DB.sqlite.prepare('UPDATE relay_tasks SET state=?,result=? WHERE id=?').run('succeeded',JSON.stringify({status:'succeeded',data,...(name==='get_fm1_status'?{_site_inventory_observed_at:Math.floor(Date.now()/1000)}:{}),...(name==='get_fm1_input_snapshot'?{_site_input_observed_at:Math.floor(Date.now()/1000)}:{})}),answer.request_id);}if(omitPlanJobId&&name==='plan_fm1_app'){const {job_id,...queued}=answer;return queued;}return answer;}
  const properties=new Map();
  const document={documentElement:{style:{setProperty(name,value){properties.set(name,String(value));}}},body:{classList:{add(){}},dataset:{},style:{setProperty(name,value){properties.set(name,String(value));},getPropertyValue(name){return properties.get(name)??'';}}},getElementById:id=>['job-id','inspect','requests','count','detail'].includes(id)?null:node(id),createElement(tag){return {tag,textContent:'',style:{}};},modelContext:{async registerTool(tool,{signal}){registered.set(tool.name,tool);signal.addEventListener('abort',()=>registered.delete(tool.name));}}};
  document.hidden=false;document.addEventListener=(name,fn,options)=>window.addEventListener(name,fn,options);window.navigator={onLine:true};
  const context=vm.createContext({document,window,AbortController,Map,Object,Number,JSON,RegExp,String,Error,URL,TextEncoder,TextDecoder,crypto,queueMicrotask,Date:class PanelDate extends Date{static now(){return panelNow;}},setTimeout:(fn,ms)=>{delays.push(ms);if(['inventoryTick','inputTick','inputAgeTick',...(preserveDirectMode?['check']:[])].includes(fn.name)){const timer='poll-'+(++pollKey);pollTimers.set(timer,{fn,time:panelNow+ms});return timer;}const timer=setTimeout(()=>{timers.delete(timer);fn();},ms>=10000?500:ms===1000?nativeStartupDelay:1);timers.set(timer,ms);return timer;},clearTimeout:timer=>{if(pollTimers.delete(timer))return;timers.delete(timer);clearTimeout(timer);},fetch:async(_url,options)=>{const input=JSON.parse(options.body);try{const answer=await backend(input.name,input.arguments);if(loseConfirmationReply&&input.name.startsWith('confirm_'))throw new Error('Confirmation reply lost.');return {ok:true,json:async()=>({structuredContent:answer})};}catch(error){return {ok:false,json:async()=>({error:error.message})};}}});
  for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(script[1],context);
  await tick();
  // Native initialization may outlast one wall-clock tick under suite load.
  // Arm the expected inventory timer before advancing the simulated clock;
  // file/form entrypoints and hosts without tools intentionally do not arm it.
  if(!preserveDirectMode&&(!embedded||serverTools)&&!initialFile&&!initialToolResult?.action)await until(()=>[...pollTimers.values()].some(timer=>timer.fn.name==='inventoryTick'));
  return {env,nodes,registered,requests,requestArgs,events,notifications,timers,pollTimers,delays,parent,window,document,storage,storageWrites,seededTasks,node,async advancePoll(ms){const end=panelNow+ms;let count=0;while(true){const next=[...pollTimers].sort((a,b)=>a[1].time-b[1].time).find(([,timer])=>timer.time<=end);if(!next)break;if(++count>100)throw new Error('Polling timer storm.');panelNow=next[1].time;pollTimers.delete(next[0]);next[1].fn();await tick();}panelNow=end;await tick();},async invoke(name,args){return registered.get(name).execute(args);},dispose(){events.get('pagehide')?.();}};
}
for(const [name,runtime] of Object.entries({appearanceRuntime,forgeProjectRuntime,moduleGraphRuntime,extensionRuntime,inventoryRuntime,libraryRuntime})){
  test('generated '+name+' matches the current browser runtime source',()=>{
    assert.equal(generated[name],runtime.replaceAll('</script','<\\/script'));
  });
}

for(const mode of ['source','production minified']){
  test(mode+' native panel starts with every injected runtime API available',async()=>{
    const p=await panel({html:mode==='source'?UI_HTML:await minifiedPanelHtml(),embedded:true});
    try{
      for(const name of ['FM1PluginHost','FM1ExtensionUI'])assert.equal(typeof p.window[name],'function',name);
      for(const [name,methods] of Object.entries({FM1Appearance:['resolveAppearance'],FM1Forge:['projectConfig','normalizeProjectConfig','projectPrompt','verifiedBaseline'],FM1ModuleGraph:['mount'],FM1Inventory:['freshness','monitor'],FM1Library:['filterLibrary','mount']})){
        for(const method of methods)assert.equal(typeof p.window[name]?.[method],'function',name+'.'+method);
      }
      assert.equal(p.node('relay-state').textContent,'Connected');assert.equal(p.node('surface-label').textContent,'FM-1 Forge plugin');
      assert.equal(p.window.FM1InputActivity,undefined);assert.equal(p.requests.length,0);
    }finally{p.dispose();}
  });

  test(mode+' everyday panel hides the guide and exposes configuration without request-history controls',async()=>{
    const html=mode==='source'?UI_HTML:await minifiedPanelHtml();
    for(const removed of ['Saved requests & progress','Inspect a saved job','id="job-id"','id="inspect"','id="requests"','id="detail"'])assert.ok(!html.includes(removed),removed);
    assert.match(html,/<details class="forge-guide" id="forge-guide"><summary>Getting started<\/summary>/);
    assert.match(html,/<details class="forge-designer" id="forge-designer" open>/);
    assert.ok(html.indexOf('id="forge-designer"')<html.indexOf('id="appearance-controls"'));
    const p=await panel({html,embedded:true});
    try{
      assert.equal(p.node('forge-designer').open,true);assert.equal(p.node('forge-guide').open,false);assert.equal(p.node('active-operation').hidden,true);
      await p.advancePoll(1500);await tick();assert.equal(p.node('active-operation').hidden,true);assert.equal(p.node('active-status').textContent,'');
      p.node('refresh').onclick();await tick();assert.equal(p.node('active-operation').hidden,true);assert.equal(p.node('active-status').textContent,'');
      assert.ok(p.requests.includes('get_fm1_status'));assert.ok(!p.nodes.has('requests'));assert.ok(!p.nodes.has('detail'));
    }finally{p.dispose();}
  });

  test(mode+' native panel has no hardware activity controls or lifecycle sampling requests',async()=>{
    const html=mode==='source'?UI_HTML:await minifiedPanelHtml();assert.ok(!html.includes('Hardware activity'));assert.ok(!html.includes('id="input-toggle"'));
    const p=await panel({html,embedded:true,jobData:({name,defaultJob})=>name==='get_fm1_status'?null:defaultJob});
    try{
      await p.advancePoll(1500);p.events.get('focus')();await tick();
      p.document.hidden=true;p.events.get('visibilitychange')();await p.advancePoll(5000);p.document.hidden=false;p.events.get('visibilitychange')();await tick();
      p.window.navigator.onLine=false;p.events.get('offline')();await p.advancePoll(5000);p.window.navigator.onLine=true;p.events.get('online')();await tick();
      p.events.get('message')({source:p.parent,data:{jsonrpc:'2.0',id:291,method:'ui/resource-teardown',params:{}}});await tick();const stopped=p.requests.length;await p.advancePoll(5000);
      assert.ok(p.requests.includes('get_fm1_status'));assert.ok(!p.requests.includes('get_fm1_input_snapshot'));assert.ok(![...p.pollTimers.values()].some(timer=>['inputTick','inputAgeTick'].includes(timer.fn.name)));assert.equal(p.requests.length,stopped);
    }finally{p.dispose();}
  });
}

test('host initial tool result renders without a duplicate library request',async()=>{const p=await panel({embedded:true});assert.equal(p.node('relay-state').textContent,'Connected');assert.equal(p.requests.length,0);assert.equal(p.registered.size,0);p.dispose();});
test('initial host result renders even without serverTools capability',async()=>{const p=await panel({embedded:true,serverTools:false});assert.equal(p.node('relay-state').textContent,'Connected');assert.equal(p.requests.length,0);p.dispose();});
test('native library set selection filters variants and retains the selected set on refresh',async()=>{
  const catalogValue={apps:[{profile:'nes',variants:[{id:'nes-test',title:'Local NES',variant:'One',sha256:digest,ready:true},{id:'nes-other',title:'Another NES',variant:'Two',sha256:'b'.repeat(64),ready:true}]}],sets:[{id:'set-one',name:'Local set',members:[{id:'nes-test',sha256:digest}]}]};
  const p=await panel({embedded:true,catalogValue,nativeControls:true});
  assert.match(p.node('library-sets').innerHTML,/Local set/);
  p.node('library-set').value='set-one';p.node('library-set').onchange();
  assert.match(p.node('library').innerHTML,/nes-test/);assert.ok(!p.node('library').innerHTML.includes('nes-other'));
  p.node('library-set').onchange();assert.equal(p.node('library-set').value,'set-one');
  p.dispose();
});
test('native local importer and metadata refresh preserve firmware draft and saved job progress',async()=>{
  const catalogValue={apps:[{profile:'nes',variants:[{id:'nes-test',title:'Local NES',variant:'One',sha256:digest,ready:true}]}],sets:[]};
  const p=await panel({embedded:true,catalogValue,jobData:({name,answer,defaultJob})=>name==='open_fm1_local_import'?{id:answer.request_id,opened:true,device_io:false}:name==='list_fm1_apps'?catalogValue:defaultJob});
  p.node('forge-project-goal').value='Keep this unsaved firmware idea';p.node('active-operation').dataset.jobId='e'.repeat(32);p.node('active-status').textContent='Existing verified sector progress';
  p.node('library-add').onclick();await tick();
  assert.equal(p.requests.filter(name=>name==='open_fm1_local_import').length,1);
  assert.equal(p.node('forge-project-goal').value,'Keep this unsaved firmware idea');
  assert.equal(p.node('active-operation').dataset.jobId,'e'.repeat(32));assert.equal(p.node('active-status').textContent,'Existing verified sector progress');
  assert.ok(!p.requests.some(name=>/^(confirm_|prepare_|plan_)/.test(name)));
  p.dispose();
});
test('native plugin opens on device controls with detected port and no duplicate refresh',async()=>{const p=await panel({embedded:true,inventory:{device:{serial_ports:[{port:'COM7'}],session_configured:false},engine:{active:null,blocked_unknown:false}}});assert.equal(p.node('surface-label').textContent,'FM-1 Forge plugin');assert.equal(p.node('device-heading').textContent,'FM-1 on COM7');assert.equal(p.node('physical-device').textContent,'FM-1 on COM7');assert.equal(p.requests.length,0);p.dispose();});
test('host with serverTools falls back once if initial result absent',async()=>{const p=await panel({embedded:true,initial:false});assert.deepEqual(p.requests,['open_fm1_library']);p.dispose();});
test('resource teardown is acknowledged and aborts the panel lifecycle',async()=>{const p=await panel({embedded:true});p.events.get('message')({source:p.parent,data:{jsonrpc:'2.0',id:91,method:'ui/resource-teardown',params:{}}});await tick();const ack=p.notifications.find(m=>m.id===91);assert.deepEqual(JSON.parse(JSON.stringify(ack)),{jsonrpc:'2.0',id:91,result:{}});const n=p.requests.length;p.node('refresh').onclick();await tick();assert.equal(p.requests.length,n);p.dispose();});
test('top-level document registers eight stage-only tools and abort removes them',async()=>{const p=await panel();assert.equal(p.registered.size,8);for(const name of ['confirm_fm1_switch','confirm_fm1_official_update','confirm_fm1_stock_update'])assert.ok(!p.registered.has(name));p.dispose();assert.equal(p.registered.size,0);});
test('WebMCP review opens a dialog without exposing approval or submitting write',async()=>{const p=await panel();const reviewed=await p.invoke('start_fm1_switch_review',{catalog_id:'nes-test',entry_method:'serial'});assert.equal(p.node('approval').open,true);assert.ok(!('_approval' in reviewed));const nonce=p.env.DB.sqlite.prepare('SELECT id FROM switch_approvals').get().id;assert.ok(!JSON.stringify(reviewed).includes(nonce));assert.ok(!p.requests.includes('confirm_fm1_switch'));p.dispose();});
test('programmatic confirmation cannot consume the approval',async()=>{const p=await panel();await p.invoke('start_fm1_switch_review',{catalog_id:'nes-test',entry_method:'serial'});p.node('confirm').onclick({isTrusted:false});await tick();assert.equal(p.env.DB.sqlite.prepare('SELECT used FROM switch_approvals').get().used,0);assert.equal(p.node('approval').open,true);p.dispose();});
test('cancel and Escape clear approval before any later click',async()=>{for(const mode of ['cancel','escape']){const p=await panel();await p.invoke('start_fm1_switch_review',{catalog_id:'nes-test',entry_method:'serial'});if(mode==='cancel')p.node('cancel').onclick();else p.node('approval').cancel();p.node('confirm').onclick({isTrusted:true});await tick();assert.ok(!p.requests.includes('confirm_fm1_switch'));p.dispose();}});
test('trusted confirmation uses the displayed approval once',async()=>{const p=await panel();await p.invoke('start_fm1_switch_review',{catalog_id:'nes-test',entry_method:'serial'});p.node('confirm').onclick({isTrusted:true});p.node('confirm').onclick({isTrusted:true});await tick();assert.equal(p.requests.filter(name=>name==='confirm_fm1_switch').length,1);assert.equal(p.env.DB.sqlite.prepare('SELECT used FROM switch_approvals').get().used,1);p.dispose();});
test('WebMCP job recovery awaits authoritative status without a manual inspector',async()=>{const p=await panel();const id='e'.repeat(32);await p.invoke('inspect_fm1_job',{job_id:id});assert.ok(p.requests.includes('get_fm1_request'));assert.equal(p.node('active-operation').dataset.status,'succeeded');assert.equal(p.node('active-operation').dataset.jobId,id);assert.equal(p.node('active-operation').hidden,false);p.dispose();});
test('refreshing metadata preserves the selected job for later recovery',async()=>{const p=await panel();const id='e'.repeat(32);await p.invoke('inspect_fm1_job',{job_id:id});await p.invoke('refresh_fm1_library',{});assert.equal(p.node('active-operation').dataset.jobId,id);await p.invoke('inspect_fm1_job',{job_id:id});assert.ok(p.requestArgs.filter(r=>r.name==='get_fm1_job').every(r=>r.args.job_id===id));p.dispose();});
test('lost confirmation reply retains the committed job ID and inspection does not resubmit',async()=>{const p=await panel({loseConfirmationReply:true});await p.invoke('start_fm1_switch_review',{catalog_id:'nes-test',entry_method:'serial'});const id=p.env.DB.sqlite.prepare('SELECT id FROM switch_approvals').get().id;p.node('confirm').onclick({isTrusted:true});await tick();assert.equal(p.node('active-operation').dataset.jobId,id);assert.match(p.node('message').textContent,/Resume progress/);assert.equal(p.node('active-operation').dataset.jobId,id);assert.equal(p.env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM relay_tasks WHERE operation='switch_app'").get().n,1);p.node('resume-active').onclick();await tick();assert.equal(p.requestArgs.find(r=>r.name==='get_fm1_job').args.job_id,id);assert.equal(p.requests.filter(name=>name==='confirm_fm1_switch').length,1);assert.equal(p.env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM relay_tasks WHERE operation='switch_app'").get().n,1);assert.equal(p.node('active-operation').dataset.jobId,id);p.dispose();});
test('WebMCP recovery keeps the exact job ID internally',async()=>{const p=await panel();const id='e'.repeat(32);await p.invoke('inspect_fm1_job',{job_id:id});assert.equal(p.node('active-operation').dataset.jobId,id);assert.equal(p.node('active-operation').dataset.jobId,id);p.dispose();});
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
  assert.equal(p.node('active-operation').dataset.jobId,id);
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
  assert.equal(p.node('active-operation').dataset.jobId,id);
  assert.equal(p.env.DB.sqlite.prepare('SELECT used FROM official_update_approvals').get().used,1);
  p.dispose();
});

test('official lost response retains exact job identity and inspection never opens another updater',async()=>{
  for(const embedded of [false,true]){
    const p=await panel({embedded,official:true,inventory:detectedInventory(),loseConfirmationReply:true});
    if(embedded){p.node('official-update').onclick();await tick();}else await p.invoke('start_fm1_official_update_review',{});
    const id=p.env.DB.sqlite.prepare('SELECT id FROM official_update_approvals').get().id;
    p.node('confirm').onclick({isTrusted:true});await tick();
    assert.equal(p.node('active-operation').dataset.jobId,id);assert.match(p.node('message').textContent,/Resume progress/);
    assert.equal(p.node('active-operation').dataset.jobId,id);
    assert.equal(p.env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='official_updater'").get().n,1);
    p.node('resume-active').onclick();await tick();
    assert.equal(p.requestArgs.find(item=>item.name==='get_fm1_job').args.job_id,id);
    assert.equal(p.requests.filter(name=>name==='confirm_fm1_official_update').length,1);
    assert.equal(p.node('active-operation').dataset.jobId,id);
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
  await until(()=>p.node('active-operation').dataset.status==='succeeded');
  const id=p.node('active-operation').dataset.jobId,inspections=p.requestArgs.filter(item=>item.name==='get_fm1_job');
  assert.equal(inspections.length,7);assert.ok(inspections.every(item=>item.args.job_id===id));
  assert.equal(p.requests.filter(name=>name==='plan_fm1_app').length,1);
  assert.ok(!p.requests.includes('confirm_fm1_switch'));assert.ok(!p.requests.includes('get_fm1_status'));assert.ok(!p.requests.includes('list_fm1_apps'));
  assert.ok(p.node('progress-text').history.some(value=>value.includes('readback')));
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
  await until(()=>p.node('active-operation').dataset.status==='succeeded');
  assert.equal(p.node('active-operation').dataset.jobId,id);assert.equal(p.requests.filter(name=>name==='confirm_fm1_switch').length,1);
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
  p.node('plan-nes').onclick();await until(()=>p.node('active-operation').dataset.status==='succeeded');
  const id=p.env.DB.sqlite.prepare("SELECT id FROM relay_tasks WHERE operation='plan_app'").get().id;
  assert.equal(p.node('active-operation').dataset.jobId,id);assert.equal(reads,2);
  assert.ok(p.requestArgs.filter(item=>item.name==='get_fm1_job').every(item=>item.args.job_id===id));
  assert.equal(p.requests.filter(name=>name==='plan_fm1_app').length,1);p.dispose();
});

test('Refresh updates metadata while preserving selected progress during work and after completion',async()=>{
  let reads=0,release;const held=new Promise(resolve=>{release=resolve;});const id='e'.repeat(32);
  const p=await panel({beforeCall:async name=>{if(name==='get_fm1_job'&&reads===1)await held;},jobData:({name,defaultJob})=>name==='get_fm1_job'?progressJob(defaultJob.id,++reads===1?'running':'succeeded',reads===1?32:96):defaultJob});
  const following=p.invoke('inspect_fm1_job',{job_id:id});await until(()=>p.node('progress-text').textContent.includes('32/96'));
  const runningDetail=p.node('active-status').textContent;await p.invoke('refresh_fm1_library',{});
  assert.equal(p.node('active-status').textContent,runningDetail);assert.equal(p.node('progress-bar').value,32);assert.equal(p.node('active-operation').dataset.jobId,id);
  release();await following;const completedDetail=p.node('active-status').textContent;
  await p.invoke('refresh_fm1_library',{});assert.equal(p.node('active-status').textContent,completedDetail);assert.equal(p.node('progress-bar').value,96);
  assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,2);assert.equal(p.requests.filter(name=>name==='list_fm1_apps').length,2);p.dispose();
});

test('automatic inspection stops on failed and unknown authoritative job outcomes',async()=>{
  for(const status of ['failed','unknown']){
    let reads=0;const id='f'.repeat(32);
    const p=await panel({jobData:({name,defaultJob})=>name==='get_fm1_job'?progressJob(defaultJob.id,++reads===1?'running':status,32):defaultJob});
    await p.invoke('inspect_fm1_job',{job_id:id});
    assert.equal(reads,2);assert.equal(p.node('active-operation').dataset.jobId,id);assert.equal(p.node('active-operation').dataset.status,status);
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

test('a lost relay delivery times out once and active Resume preserves the original job',async()=>{
  let inspectReads=0;
  const p=await panel({jobData:({name,defaultJob})=>name==='plan_fm1_app'?null:name==='get_fm1_job'?progressJob(defaultJob.id,++inspectReads===1?'running':'succeeded',inspectReads===1?48:96):defaultJob});
  await p.invoke('plan_fm1_app',{catalog_id:'nes-test'});
  const id=p.node('active-operation').dataset.jobId;assert.match(p.node('message').textContent,/Resume progress/);assert.equal(p.node('resume-active').hidden,false);
  assert.equal(p.requests.filter(name=>name==='plan_fm1_app').length,1);assert.equal(inspectReads,0);
  p.node('resume-active').onclick();await until(()=>inspectReads===2&&p.node('active-operation').dataset.status==='succeeded');
  assert.ok(p.requestArgs.filter(item=>item.name==='get_fm1_job').every(item=>item.args.job_id===id));
  assert.equal(p.requests.filter(name=>name==='plan_fm1_app').length,1);p.dispose();
});

test('offline job inspection stops with the saved ID and never retries a submission',async()=>{
  let reads=0;const id='e'.repeat(32);
  const p=await panel({beforeCall:name=>{if(name==='get_fm1_job'&&++reads===2)throw new Error('Bench connection is offline.');},jobData:({name,defaultJob})=>name==='get_fm1_job'?progressJob(defaultJob.id,'running',16):defaultJob});
  await assert.rejects(p.invoke('inspect_fm1_job',{job_id:id}),/offline.*Resume progress/s);
  const count=p.requests.length;await tick();assert.equal(p.requests.length,count);assert.equal(reads,2);
  assert.equal(p.node('active-operation').dataset.jobId,id);assert.ok(!p.requests.includes('plan_fm1_app'));assert.ok(!p.requests.includes('confirm_fm1_switch'));p.dispose();
});

test('repeated recovery calls share one running follow loop for the same original ID',async()=>{
  let reads=0,release;const held=new Promise(resolve=>{release=resolve;});const id='e'.repeat(32);
  const p=await panel({beforeCall:async name=>{if(name==='get_fm1_job'&&reads===1)await held;},jobData:({name,defaultJob})=>name==='get_fm1_job'?progressJob(defaultJob.id,++reads===1?'running':'succeeded',reads===1?16:96):defaultJob});
  void p.invoke('inspect_fm1_job',{job_id:id});await until(()=>reads===1);
  p.node('resume-active').onclick();p.node('resume-active').onclick();await tick();
  assert.equal(p.requests.filter(name=>name==='get_fm1_job').length,2);
  release();await until(()=>p.node('active-operation').dataset.status==='succeeded');assert.equal(reads,2);p.dispose();
});

test('a superseding inspection prevents an older in-flight result from replacing the selected job',async()=>{
  const oldId='e'.repeat(32),newId='f'.repeat(32);let oldReads=0,release;
  const held=new Promise(resolve=>{release=resolve;});
  const p=await panel({beforeCall:async(name,args)=>{if(name==='get_fm1_job'&&args.job_id===oldId&&oldReads===1)await held;},jobData:({name,args,defaultJob})=>{
    if(name!=='get_fm1_job')return defaultJob;
    if(args.job_id===oldId){oldReads++;return progressJob(oldId,oldReads===1?'running':'succeeded',oldReads===1?16:96);}
    return progressJob(newId,'succeeded',96);
  }});
  void p.invoke('inspect_fm1_job',{job_id:oldId});await until(()=>p.requests.filter(name=>name==='get_fm1_job').length===2);
  await p.invoke('inspect_fm1_job',{job_id:newId});release();await tick();
  assert.equal(p.node('active-operation').dataset.jobId,newId);assert.equal(p.node('active-operation').dataset.jobId,newId);assert.equal(p.node('message').textContent,'');
  const count=p.requests.length;await tick();assert.equal(p.requests.length,count);p.dispose();
});

test('native teardown cancels automatic follow timers and prevents later job requests',async()=>{
  const p=await panel({embedded:true,nativeControls:true,jobData:({name,defaultJob})=>['plan_fm1_app','get_fm1_job'].includes(name)?progressJob(defaultJob.id,'running',16):defaultJob});
  p.node('plan-nes').onclick();await until(()=>p.node('progress-text').textContent.includes('16/96'));const id=p.node('active-operation').dataset.jobId;
  p.events.get('message')({source:p.parent,data:{jsonrpc:'2.0',id:93,method:'ui/resource-teardown',params:{}}});
  const count=p.requests.length;await tick();assert.equal(p.requests.length,count);assert.equal(p.timers.size,0);
  assert.equal(p.node('active-operation').dataset.jobId,id);p.node('resume-active').onclick();await tick();assert.equal(p.requests.length,count);p.dispose();
});

test('long-running job inspection is bounded and retains its recovery ID',async()=>{
  const id='e'.repeat(32);
  const p=await panel({jobData:({name,defaultJob})=>name==='get_fm1_job'?progressJob(defaultJob.id,'running',16):defaultJob});
  await p.invoke('inspect_fm1_job',{job_id:id});
  assert.equal(p.requests.filter(name=>name==='get_fm1_job').length,180);assert.ok(p.delays.includes(3000));
  assert.match(p.node('message').textContent,/Automatic progress paused/);assert.equal(p.node('active-operation').dataset.jobId,id);
  const count=p.requests.length;await tick();assert.equal(p.requests.length,count);p.dispose();
});

test('a mismatched authoritative job ID stops inspection before rendering its progress',async()=>{
  const id='e'.repeat(32),wrongId='f'.repeat(32);
  const p=await panel({jobData:({name,defaultJob})=>name==='get_fm1_job'?progressJob(wrongId,'succeeded',96):defaultJob});
  await assert.rejects(p.invoke('inspect_fm1_job',{job_id:id}),/selected saved job/);
  assert.equal(p.node('active-operation').dataset.jobId,id);assert.ok(!p.node('active-status').history.some(value=>value.includes(wrongId)));
  assert.equal(p.requests.filter(name=>name==='get_fm1_job').length,1);p.dispose();
});

test('an older delivery snapshot is labeled as saved and does not start a second operation',async()=>{
  const id='e'.repeat(32);const p=await panel();
  p.env.DB.sqlite.prepare('INSERT INTO relay_tasks(id,user_id,operation,arguments,state,result,created) VALUES(?,?,?,?,?,?,?)').run(id,'alice','switch_app','{}','succeeded',JSON.stringify({status:'succeeded',data:progressJob(id,'running',16)}),1);
  await p.invoke('inspect_fm1_request',{request_id:id});
  assert.match(p.node('message').textContent,/Saved delivery snapshot/);assert.equal(p.node('active-operation').dataset.jobId,id);
  assert.ok(!p.requests.includes('get_fm1_job'));assert.ok(!p.requests.includes('confirm_fm1_switch'));
  await p.invoke('inspect_fm1_job',{job_id:id});assert.equal(p.node('active-operation').dataset.status,'succeeded');p.dispose();
});

test('official native confirmation stops at vendor handoff and never claims firmware transfer completion',async()=>{
  let reads=0;
  const p=await panel({embedded:true,official:true,inventory:detectedInventory(),jobData:({name,defaultJob})=>{
    if(name==='confirm_fm1_official_update')return {...defaultJob,status:'queued'};
    if(name==='get_fm1_job'){reads++;return {...defaultJob,operation:'official_updater',handoff:true,firmware_transfer_verified:false};}
    return defaultJob;
  }});
  p.node('official-update').onclick();await until(()=>p.node('approval').open);const id=p.env.DB.sqlite.prepare('SELECT id FROM official_update_approvals').get().id;
  p.node('confirm').onclick({isTrusted:true});await until(()=>p.node('active-status').textContent.includes('firmware transfer is not verified'));
  assert.equal(reads,1);assert.equal(p.node('progress').hidden,true);assert.equal(p.node('active-operation').dataset.jobId,id);
  assert.match(p.node('active-status').textContent,/Complete the update there; firmware transfer is not verified/);
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
const diagCatalog={apps:[{profile:'diagnostics',title:'Hardware diagnostics',variants:[{id:'factory-diag',title:'FM-1 diagnostics',variant:'baseline',ready:true,sha256:digest}]}]};
const defaultProject={slug:'my-fm1-firmware',displayName:'My FM-1 firmware',clockPreset:'sdk-default',clockOptIn:false,lcdPreset:'stock-dma',module:'diagnostics',usbAudio:true};

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
    p.node('new-forge-project').onclick();assert.equal(p.node('forge-designer').open,true);
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

test('module configuration generates the canonical version-four config with fixed recovery',async()=>{
  const p=await panel({embedded:true,baseline:forgeBaseline});
  p.node('forge-project-name').value='FM-1 Pad Lab';p.node('forge-project-slug').value='pad-lab';p.node('forge-module').value='user';
  p.node('forge-usb-audio').checked=false;p.node('forge-lcd-preset').value='spi15-rgb444';p.node('forge-module').onchange();
  assert.deepEqual(JSON.parse(p.node('forge-config').textContent),{schemaVersion:4,project:{slug:'pad-lab',displayName:'FM-1 Pad Lab'},profile:'forge-diag',clockPreset:'sdk-default',lcdPreset:'spi15-rgb444',module:'user',usb:{cdc:true,uac:false,uacCapture:false,uvc:false,midiUpdate:true,uboot:true},hal:{buttons:true,encoders:true,volume:true,lcd:true,audio:true}});
  assert.equal(p.node('forge-module-title').textContent,'Your module');assert.match(p.node('forge-prompt').value,/shared HAL/);
  assert.equal(JSON.parse(p.node('forge-config').textContent).clockPreset,'sdk-default');assert.equal(p.node('forge-clock-opt-in').checked,false);
  assertAppearanceStaysLocal(p);p.dispose();
});

for(const mode of ['source','production minified']){
test(mode+' new drafts expose read-only SDK-default CPU information without a 320 MHz choice',async()=>{
  const html=mode==='source'?UI_HTML:await minifiedPanelHtml();
  assert.ok(!html.includes('id="forge-add-tweak-clock"'));assert.ok(!html.includes('id="forge-card-tweak-clock"'));
  for(const id of ['forge-clock-preset','forge-clock-opt-in']){const tag=html.match(new RegExp('<(?:select|input)\\b[^>]*id="'+id+'"[^>]*>'))?.[0];assert.ok(tag?.includes('hidden'),id+' must remain hidden for legacy compatibility');}
  const p=await panel({html,embedded:true});
  try{assert.equal(JSON.parse(p.node('forge-config').textContent).clockPreset,'sdk-default');assert.equal(p.node('forge-clock-opt-in').checked,false);assert.equal(p.node('forge-clock-preset').onchange,undefined);assert.equal(p.node('forge-clock-opt-in').onchange,undefined);assert.equal(p.node('forge-cpu-summary').textContent,'CPU: SDK default · measured 360 MHz');assertAppearanceStaysLocal(p);}finally{p.dispose();}
});

test(mode+' an explicitly loaded legacy 320 MHz draft retains its reviewed setting and accurate read-only label',async()=>{
  const current=projectConfig({...defaultProject,clockPreset:'sdk-320',clockOptIn:true}),{uvc,midiUpdate,uacCapture,...legacyUsb}=current.usb,legacy={...current,schemaVersion:2,usb:legacyUsb};
  const html=mode==='source'?UI_HTML:await minifiedPanelHtml(),p=await panel({html,embedded:true,initialToolResult:{action:'accept',config:legacy,goal:'Keep my existing firmware configuration',gate:{diagnostics_verified:true,can_start_project:false},project:{id:'c'.repeat(32),config:legacy}}});
  try{
    assert.equal(p.node('forge-clock-preset').value,'sdk-320');assert.equal(p.node('forge-clock-opt-in').checked,true);assert.equal(p.node('forge-cpu-summary').textContent,'CPU: legacy draft · 320 MHz (retained)');
    let exported=JSON.parse(p.node('forge-config').textContent);assert.equal(exported.schemaVersion,4);assert.equal(exported.clockPreset,'sdk-320');assert.equal(exported.usb.uvc,false);
    p.node('forge-project-goal').value='Add another sequencer feature';p.node('forge-project-goal').oninput();exported=JSON.parse(p.node('forge-config').textContent);assert.equal(exported.clockPreset,'sdk-320');assert.match(p.node('forge-prompt').value,/"clockPreset": "sdk-320"/);assert.equal(p.node('forge-cpu-summary').textContent,'CPU: legacy draft · 320 MHz (retained)');assert.equal(p.requests.length,0);
  }finally{p.dispose();}
});

}

test('optional UVC selection exports canonical v4 locally and restores accepted configurations',async()=>{
  const p=await panel({embedded:true,baseline:forgeBaseline});
  try{
    assert.equal(p.node('forge-usb-video').checked,false);assert.equal(JSON.parse(p.node('forge-config').textContent).usb.uvc,false);
    p.node('forge-usb-audio-capture').checked=false;p.node('forge-usb-audio-capture').onchange();
    p.node('forge-usb-video').checked=true;p.node('forge-usb-video').onchange();
    const config=JSON.parse(p.node('forge-config').textContent);assert.equal(config.schemaVersion,4);assert.equal(config.usb.uvc,true);assert.equal(config.usb.cdc,true);assert.equal(config.usb.uboot,true);assert.match(p.node('forge-prompt').value,/"uvc": true/);assertAppearanceStaysLocal(p);
    const restored=await panel({embedded:true,initialToolResult:{action:'accept',config,goal:'Stream the screen through USB video',gate:{diagnostics_verified:true,can_start_project:false},project:{id:'b'.repeat(32),config}}});
    try{assert.equal(restored.node('forge-usb-video').checked,true);assert.equal(JSON.parse(restored.node('forge-config').textContent).usb.uvc,true);assert.equal(restored.requests.length,0);}finally{restored.dispose();}
  }finally{p.dispose();}
});

test('project configuration rejects malformed IDs, unsupported modules and bypassed clock opt-in',()=>{
  for(const overrides of [{slug:'../elsewhere'},{slug:'Upper'},{slug:'con'},{slug:'com1'},{displayName:'\u0000'},{clockPreset:'sdk-480'},{clockPreset:'sdk-320',clockOptIn:false},{lcdPreset:'fastest'},{module:'raw-usb'},{usbAudio:'true'},{usbVideo:'true'}])assert.throws(()=>projectConfig({...defaultProject,...overrides}));
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
  assert.equal(config().clockPreset,'sdk-default');assert.equal(p.node('forge-clock-opt-in').checked,false);
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
  const detail=p.node('active-status').textContent,requests=p.requests.length;p.node('forge-module').value='user';p.node('forge-module').onchange();p.node('palette-forge-black').onclick();
  assert.equal(p.node('active-operation').dataset.jobId,'3'.repeat(32));assert.equal(p.node('active-status').textContent,detail);assert.equal(p.node('progress-bar').value,96);
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
  await p.invoke('inspect_fm1_job',{job_id:id});const detail=p.node('active-status').textContent,requests=p.requests.length;
  p.node('forge-project-goal').value='A new sequencer';p.node('forge-project-goal').oninput();p.node('forge-copy').onclick();await tick();
  assert.equal(p.node('active-operation').dataset.jobId,id);assert.equal(p.node('active-status').textContent,detail);assert.equal(p.node('active-operation').dataset.status,'unknown');
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
    assert.match(p.node('diagnostics-status').textContent,/transfer and startup verified/);
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
for(const [name,inventory] of [['missing',null],['stale',{device:{serial_ports:[{port:'COM99'}],update_mode:{mode:'serial'}},engine:{active:null,blocked_unknown:false}}]]){
  test('an initially '+name+' observation keeps neutral device text while its first check is pending',async t=>{
    t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,12,12,0,0)});
    const instant=Math.floor(Date.now()/1000),initialToolResult={profiles:[],catalog:{apps:[]},relay:{connected:true,allow_switch:true},inventory,inventory_status:{state:inventory?'stale':'unavailable',observed_at:inventory?instant-20:null,age_seconds:inventory?20:null,max_age_seconds:15},recent_requests:[]};
    const p=await panel({embedded:true,nativeControls:true,initialToolResult,jobData:({name,defaultJob})=>name==='get_fm1_status'?null:defaultJob});
    try{
      if(inventory)cacheInventory(p.env,'alice',inventory,{observedAt:instant-20});else p.env.DB.sqlite.prepare("DELETE FROM relay_tasks WHERE operation='status'").run();
      assert.equal(p.node('device-heading').textContent,'FM-1');assert.equal(p.node('physical-device').textContent,'Not checked');assert.equal(p.node('connection-check').hidden,true);
      p.node('device-heading').history.length=0;p.node('physical-device').history.length=0;await p.advancePoll(6500);
      assert.equal(p.node('device-heading').textContent,'FM-1');assert.equal(p.node('physical-device').textContent,'Not checked');assert.equal(p.node('connection-check').hidden,false);assert.equal(p.node('switch-nes').disabled,true);
      assert.ok(p.node('device-heading').history.every(label=>label==='FM-1'),JSON.stringify(p.node('device-heading').history));assert.ok(p.node('physical-device').history.every(label=>label==='Not checked'),JSON.stringify(p.node('physical-device').history));assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);
    }finally{p.dispose();}
  });
}
for(const mode of ['source','production minified']){
  test(mode+' pending expiry and a fresh same-device result never repaint the confirmed label',async t=>{
    t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,12,12,0,0)});
    const p=await panel({html:mode==='source'?UI_HTML:await minifiedPanelHtml(),embedded:true,nativeControls:true,jobData:({name,defaultJob})=>name==='get_fm1_status'?null:defaultJob});
    try{
      p.node('device-heading').history.length=0;p.node('physical-device').history.length=0;
      assert.equal(p.node('connection-check').hidden,true);await p.advancePoll(1500);assert.equal(p.node('connection-check').hidden,false);assert.equal(p.node('switch-nes').disabled,false);
      await p.advancePoll(13500);p.events.get('focus')();await tick();assert.equal(p.node('switch-nes').disabled,false);
      await p.advancePoll(1001);p.events.get('focus')();await tick();assert.equal(p.node('switch-nes').disabled,true);assert.equal(p.node('official-state').textContent,'Unavailable');assert.equal(p.node('connection-check').hidden,false);
      assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');assert.equal(p.node('physical-device').textContent,'FM-1 on COM10');
      const saved=p.requestArgs.find(item=>item.name==='get_fm1_request').args.request_id;t.mock.timers.tick(16001);const instant=Math.floor(Date.now()/1000),data={device:{serial_ports:[{port:'COM10'}],update_mode:{mode:'serial'},observation:{started_at:instant,completed_at:instant}},engine:{active:null,blocked_unknown:false}};
      p.env.DB.sqlite.prepare('UPDATE relay_tasks SET state=?,result=? WHERE id=?').run('succeeded',JSON.stringify({status:'succeeded',data,_site_inventory_observed_at:instant}),saved);p.events.get('focus')();await until(()=>p.node('switch-nes').disabled===false&&p.node('connection-check').hidden);
      assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');assert.equal(p.node('physical-device').textContent,'FM-1 on COM10');assert.ok(p.node('device-heading').history.every(label=>label==='FM-1 on COM10'),JSON.stringify(p.node('device-heading').history));assert.ok(p.node('physical-device').history.every(label=>label==='FM-1 on COM10'),JSON.stringify(p.node('physical-device').history));assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);
    }finally{p.dispose();}
  });
}
test('the accessible connection circle appears only for a visible online check and pending request',async()=>{
  const indicator=UI_HTML.match(/<[^>]+\bid="connection-check"[^>]*>/)?.[0];assert.ok(indicator);assert.match(indicator,/aria-label="Checking connection"/);assert.match(indicator,/title="Checking connection"/);assert.match(indicator,/\bhidden\b/);
  let hold=true,release;
  const p=await panel({embedded:true,beforeCall:name=>name==='open_fm1_library'&&hold?new Promise(resolve=>{release=resolve;}):undefined,jobData:({name,defaultJob})=>name==='get_fm1_status'?null:defaultJob});
  try{
    assert.equal(p.node('connection-check').hidden,true);p.events.get('focus')();await tick();assert.ok(release);assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,0);assert.equal(p.node('connection-check').hidden,false);
    hold=false;release();await until(()=>p.requestArgs.some(item=>item.name==='get_fm1_request'));assert.equal(p.node('connection-check').hidden,false);
    p.document.hidden=true;p.events.get('visibilitychange')();assert.equal(p.node('connection-check').hidden,true);p.document.hidden=false;p.events.get('visibilitychange')();await tick();assert.equal(p.node('connection-check').hidden,false);
    p.window.navigator.onLine=false;p.events.get('offline')();assert.equal(p.node('connection-check').hidden,true);p.window.navigator.onLine=true;p.events.get('online')();await tick();assert.equal(p.node('connection-check').hidden,false);
    p.env.DB.sqlite.prepare("UPDATE relay_state SET last_seen=0 WHERE id='bench'").run();p.events.get('focus')();await until(()=>p.node('relay-state').textContent==='Offline');assert.equal(p.node('connection-check').hidden,true);
    assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');assert.equal(p.node('physical-device').textContent,'FM-1 on COM10');
  }finally{hold=false;release?.();p.dispose();}
});
for(const [label,device] of [['FM-1 on COM6',{serial_ports:[{port:'COM6'}],update_mode:{mode:'serial'}}],['FM-1 in UBOOT',{serial_ports:[],uboot_disks:[{drive:'H:'}],update_mode:{mode:'uboot'}}],['FM-1 on MIDI',{serial_ports:[],uboot_disks:[],update_mode:{mode:'sysex'}}]]){
  test('a completed fresh observation changes the confirmed device label to '+label,async t=>{
    t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,12,12,0,0)});
    const p=await panel({embedded:true,nativeControls:true,jobData:({name,defaultJob})=>name==='get_fm1_status'?null:defaultJob});
    try{
      p.node('device-heading').history.length=0;p.node('physical-device').history.length=0;await p.advancePoll(1500);
      assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');assert.equal(p.node('physical-device').textContent,'FM-1 on COM10');
      const saved=p.requestArgs.find(item=>item.name==='get_fm1_request').args.request_id,instant=Math.floor(Date.now()/1000),data={device:{...device,observation:{started_at:instant,completed_at:instant}},engine:{active:null,blocked_unknown:false}};
      p.env.DB.sqlite.prepare('UPDATE relay_tasks SET state=?,result=? WHERE id=?').run('succeeded',JSON.stringify({status:'succeeded',data,_site_inventory_observed_at:instant}),saved);await p.advancePoll(1000);await until(()=>p.node('device-heading').textContent===label);
      assert.equal(p.node('physical-device').textContent,label);for(const id of ['device-heading','physical-device']){const history=p.node(id).history;assert.ok(history.includes(label));assert.ok(history.every(value=>['FM-1 on COM10',label].includes(value)),JSON.stringify(history));}
    }finally{p.dispose();}
  });
}
test('native panel automatically observes physical disconnection without recataloging or replacing cards',async()=>{
  const p=await panel({embedded:true,nativeControls:true,jobData:({name,defaultJob})=>name==='get_fm1_status'?disconnectedInventory():defaultJob});
  p.node('device-heading').history.length=0;p.node('physical-device').history.length=0;
  const cards=p.node('library').innerHTML;assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');await p.advancePoll(1499);assert.equal(p.requests.length,0);await p.advancePoll(1);await until(()=>p.node('device-heading').textContent==='FM-1 disconnected');
  assert.equal(p.node('device-heading').textContent,'FM-1 disconnected');assert.equal(p.node('physical-device').textContent,'FM-1 disconnected');assert.equal(p.node('relay-state').textContent,'Connected');assert.match(p.node('inventory-freshness').textContent,/Checked \d+s ago/);
  for(const id of ['device-heading','physical-device']){const history=p.node(id).history;assert.ok(history.includes('FM-1 disconnected'));assert.ok(history.every(label=>['FM-1 on COM10','FM-1 disconnected'].includes(label)),JSON.stringify(history));}
  assert.equal(p.node('switch-nes').disabled,true);assert.equal(p.node('library').innerHTML,cards);assert.deepEqual(p.requests,['open_fm1_library','get_fm1_status','get_fm1_request','open_fm1_library']);await p.advancePoll(1000);assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,2);assert.ok(!p.requests.includes('list_fm1_apps'));assert.ok(!p.requests.some(name=>name.startsWith('confirm_')));p.dispose();assert.equal(p.pollTimers.size,0);
});
test('native pending observation detects a stopped relay and resumes the original check after reconnect',async()=>{
  const p=await panel({embedded:true,nativeControls:true,jobData:({name,defaultJob})=>name==='get_fm1_status'?null:defaultJob});
  p.node('forge-project-goal').value='Keep my unfinished firmware';p.node('active-operation').dataset.jobId='e'.repeat(32);
  const cards=p.node('library').innerHTML;await p.advancePoll(1500);
  const pending=p.requestArgs.find(item=>item.name==='get_fm1_request').args.request_id;
  p.env.DB.sqlite.prepare("UPDATE relay_state SET last_seen=0 WHERE id='bench'").run();
  await p.advancePoll(5000);
  assert.equal(p.node('connection-label').textContent,'Bench disconnected');assert.equal(p.node('relay-state').textContent,'Offline');
  assert.equal(p.node('physical-device').textContent,'FM-1 on COM10');assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');assert.equal(p.node('connection-check').hidden,true);assert.equal(p.node('switch-nes').disabled,true);
  assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);
  assert.equal(p.requestArgs.filter(item=>item.name==='get_fm1_request').length,2); // The last saved read overlaps the heartbeat that detects relay loss.
  connect(p.env,true);
  const data={device:{serial_ports:[{port:'COM4'}],update_mode:{mode:'serial'}},engine:{active:null,blocked_unknown:false}};
  p.env.DB.sqlite.prepare('UPDATE relay_tasks SET state=?,result=? WHERE id=?').run('succeeded',JSON.stringify({status:'succeeded',data,_site_inventory_observed_at:Math.floor(Date.now()/1000)}),pending);
  await p.advancePoll(1000);
  assert.equal(p.node('connection-label').textContent,'Bench connected');assert.equal(p.node('physical-device').textContent,'FM-1 on COM4');
  assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);
  assert.ok(p.requestArgs.filter(item=>item.name==='get_fm1_request').every(item=>item.args.request_id===pending));
  assert.equal(p.node('forge-project-goal').value,'Keep my unfinished firmware');assert.equal(p.node('active-operation').dataset.jobId,'e'.repeat(32));assert.equal(p.node('library').innerHTML,cards);
  assert.ok(!p.requests.includes('list_fm1_apps'));assert.ok(!p.requests.some(name=>name.startsWith('confirm_')));p.dispose();
});
test('pending automatic observations disable stale actions while retaining the last confirmed port',async()=>{
  const p=await panel({embedded:true,nativeControls:true,jobData:({name,defaultJob})=>name==='get_fm1_status'?null:defaultJob});await p.advancePoll(16500);
  assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');assert.equal(p.node('physical-device').textContent,'FM-1 on COM10');assert.match(p.node('inventory-freshness').textContent,/Last confirmed FM-1 on COM10.*check \d+s old/);assert.equal(p.node('connection-check').hidden,false);assert.equal(p.node('switch-nes').disabled,true);assert.equal(p.node('official-state').textContent,'Unavailable');assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);
  const id=p.requestArgs.find(item=>item.name==='get_fm1_status');assert.ok(id);const deliveries=p.requestArgs.filter(item=>item.name==='get_fm1_request');assert.ok(deliveries.length>=3);assert.equal(new Set(deliveries.map(item=>item.args.request_id)).size,1);p.dispose();
});
test('a stale native heading stays at its confirmed label throughout a delayed automatic refresh',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,12,12,0,0)});
  let hold=true,release;
  const p=await panel({embedded:true,nativeControls:true,beforeCall:name=>name==='open_fm1_library'&&hold?new Promise(resolve=>{release=resolve;}):undefined,jobData:({name,defaultJob})=>name==='get_fm1_status'?null:defaultJob});
  try{
    const stale=await callTool(p.env,'alice','open_fm1_library',{});stale.inventory={...stale.inventory,device:{...stale.inventory.device,serial_ports:[{port:'COM99'}]}};stale.inventory_status={...stale.inventory_status,state:'stale',age_seconds:20,observed_at:Math.floor(Date.now()/1000)-20};
    p.events.get('message')({source:p.parent,data:{jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{content:[],structuredContent:stale}}});
    await until(()=>p.node('switch-nes').disabled===true);assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');
    p.node('forge-project-goal').value='Keep the unsaved firmware draft';p.node('active-operation').dataset.jobId='e'.repeat(32);p.node('active-status').textContent='Saved sector progress';p.node('variant-nes').value='nes-test';const cards=p.node('library').innerHTML;
    p.node('device-heading').history.length=0;p.node('physical-device').history.length=0;
    p.events.get('focus')();await tick();assert.ok(release);assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');assert.equal(p.node('connection-check').hidden,false);assert.equal(p.node('switch-nes').disabled,true);
    await p.advancePoll(5000);assert.ok(p.node('device-heading').history.every(label=>label==='FM-1 on COM10'),JSON.stringify(p.node('device-heading').history));assert.ok(p.node('physical-device').history.every(label=>label==='FM-1 on COM10'),JSON.stringify(p.node('physical-device').history));
    hold=false;release();await until(()=>p.node('switch-nes').disabled===false);
    assert.ok(p.node('device-heading').history.every(label=>label==='FM-1 on COM10'),JSON.stringify(p.node('device-heading').history));assert.ok(p.node('physical-device').history.every(label=>label==='FM-1 on COM10'),JSON.stringify(p.node('physical-device').history));assert.equal(p.node('forge-project-goal').value,'Keep the unsaved firmware draft');assert.equal(p.node('active-operation').dataset.jobId,'e'.repeat(32));assert.equal(p.node('active-status').textContent,'Saved sector progress');assert.equal(p.node('variant-nes').value,'nes-test');assert.equal(p.node('library').innerHTML,cards);assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);
  }finally{hold=false;release?.();p.dispose();}
});
test('slow native startup cannot let the fixture advance observation time before its first monitor timer exists',async()=>{
  const p=await panel({embedded:true,nativeControls:true,nativeStartupDelay:60,jobData:({name,defaultJob})=>name==='get_fm1_status'?null:defaultJob});
  try{await p.advancePoll(16500);assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');assert.equal(p.node('physical-device').textContent,'FM-1 on COM10');assert.equal(p.node('connection-check').hidden,false);assert.equal(p.node('switch-nes').disabled,true);assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);}finally{p.dispose();}
});

test('connection-only snapshots preserve drafts and cards without exposing passive request history',async()=>{
  const p=await panel({embedded:true,nativeControls:true,jobData:({name,defaultJob})=>name==='get_fm1_status'?null:defaultJob});
  p.node('forge-project-goal').value='Keep the oscillator draft';p.node('active-operation').dataset.jobId='e'.repeat(32);p.node('active-status').textContent='Saved verified job progress';
  const cards=p.node('library').innerHTML;await p.advancePoll(1500);const saved=p.requestArgs.find(item=>item.name==='get_fm1_request').args.request_id;
  await p.advancePoll(1000);assert.equal(p.nodes.has('requests'),false);assert.equal(p.node('active-status').textContent,'Saved verified job progress');
  p.env.DB.sqlite.prepare('UPDATE relay_tasks SET state=?,result=? WHERE id=?').run('succeeded',JSON.stringify({status:'succeeded',data:disconnectedInventory(),_site_inventory_observed_at:Math.floor(Date.now()/1000)}),saved);
  await p.advancePoll(1000);assert.equal(p.nodes.has('requests'),false);assert.equal(p.node('active-status').textContent,'Saved verified job progress');
  assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);assert.equal(p.node('library').innerHTML,cards);assert.equal(p.node('forge-project-goal').value,'Keep the oscillator draft');assert.equal(p.node('active-operation').dataset.jobId,'e'.repeat(32));assert.equal(p.node('active-status').textContent,'Saved verified job progress');p.dispose();
});
test('a failed automatic check retains last seen history and does not claim physical disconnection',async()=>{
  const p=await panel({embedded:true,nativeControls:true,beforeCall:name=>{if(name==='get_fm1_status')throw new Error('Connection timed out.');}});await p.advancePoll(1500);
  assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');assert.match(p.node('inventory-freshness').textContent,/Checked \d+s ago.*refresh retrying/);assert.equal(p.node('switch-nes').disabled,false);
  await p.advancePoll(16000);p.events.get('focus')();await tick();
  assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');assert.equal(p.node('physical-device').textContent,'FM-1 on COM10');assert.match(p.node('inventory-freshness').textContent,/Last confirmed FM-1 on COM10.*refresh retrying/);assert.equal(p.node('official-state').textContent,'Unavailable');assert.equal(p.node('switch-nes').disabled,true);assert.ok(!p.node('physical-device').history.includes('FM-1 disconnected'));assert.equal(p.node('relay-state').textContent,'Connected');p.dispose();
});

test('saved delivery timeouts preserve another panel fresh observation until it expires',async()=>{
  const p=await panel({embedded:true,nativeControls:true,beforeCall:name=>{if(name==='get_fm1_request')throw new Error('Saved delivery timed out.');},jobData:({name,defaultJob})=>name==='get_fm1_status'?null:defaultJob});
  p.node('forge-project-goal').value='Keep this oscillator draft';p.node('active-operation').dataset.jobId='e'.repeat(32);p.node('active-status').textContent='Verified saved job progress';p.node('message').textContent='Keep this job message';
  const cards=p.node('library').innerHTML,otherPanel={device:{serial_ports:[{port:'COM4'}],update_mode:{mode:'serial'}},engine:{active:null,blocked_unknown:false}};
  cacheInventory(p.env,'alice',otherPanel);await p.advancePoll(1500);
  assert.equal(p.node('physical-device').textContent,'FM-1 on COM4');assert.equal(p.node('device-heading').textContent,'FM-1 on COM4');assert.equal(p.node('switch-nes').disabled,false);
  assert.match(p.node('inventory-freshness').textContent,/Checked \d+s ago.*refresh retrying/);assert.match(p.node('bench-note').textContent,/retrying.*still fresh/);
  const pending=p.requestArgs.find(item=>item.name==='get_fm1_request').args.request_id;
  await p.advancePoll(16000);p.events.get('focus')();await tick();
  assert.equal(p.node('physical-device').textContent,'FM-1 on COM4');assert.equal(p.node('device-heading').textContent,'FM-1 on COM4');assert.equal(p.node('switch-nes').disabled,true);assert.match(p.node('inventory-freshness').textContent,/Last confirmed FM-1 on COM4.*refresh retrying/);
  assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);assert.ok(p.requestArgs.filter(item=>item.name==='get_fm1_request').every(item=>item.args.request_id===pending));
  assert.equal(p.nodes.has('requests'),false);
  assert.equal(p.node('forge-project-goal').value,'Keep this oscillator draft');assert.equal(p.node('active-operation').dataset.jobId,'e'.repeat(32));assert.equal(p.node('active-status').textContent,'Verified saved job progress');assert.equal(p.node('message').textContent,'Keep this job message');assert.equal(p.node('library').innerHTML,cards);
  assert.ok(!p.requests.some(name=>/^(confirm_|prepare_|plan_)/.test(name)));assert.ok(!p.requests.includes('list_fm1_apps'));p.dispose();
});

test('successful snapshot retry clears a transient saved delivery notice without replacing job progress',async()=>{
  let rejectDelivery=true;
  const p=await panel({embedded:true,nativeControls:true,beforeCall:name=>{if(name==='get_fm1_request'&&rejectDelivery)throw new Error('Saved delivery timed out.');},jobData:({name,defaultJob})=>name==='get_fm1_status'?null:defaultJob});
  p.node('forge-project-goal').value='Keep my unfinished synth';p.node('active-operation').dataset.jobId='f'.repeat(32);p.node('active-status').textContent='Saved sector progress';p.node('message').textContent='Inspect this saved job';
  await p.advancePoll(1500);assert.match(p.node('bench-note').textContent,/retrying/);
  const pending=p.requestArgs.find(item=>item.name==='get_fm1_request').args.request_id,data={device:{serial_ports:[{port:'COM6'}],update_mode:{mode:'serial'}},engine:{active:null,blocked_unknown:false}};
  p.env.DB.sqlite.prepare('UPDATE relay_tasks SET state=?,result=? WHERE id=?').run('succeeded',JSON.stringify({status:'succeeded',data,_site_inventory_observed_at:Math.floor(Date.now()/1000)}),pending);
  rejectDelivery=false;p.events.get('focus')();await until(()=>p.node('physical-device').textContent==='FM-1 on COM6');
  assert.equal(p.node('switch-nes').disabled,false);assert.ok(!p.node('inventory-freshness').textContent.includes('retrying'));assert.ok(!p.node('bench-note').textContent.includes('retrying'));
  assert.equal(p.node('forge-project-goal').value,'Keep my unfinished synth');assert.equal(p.node('active-operation').dataset.jobId,'f'.repeat(32));assert.equal(p.node('active-status').textContent,'Saved sector progress');assert.equal(p.node('message').textContent,'Inspect this saved job');
  assert.ok(!p.requests.some(name=>/^(confirm_|prepare_|plan_)/.test(name)));assert.ok(!p.requests.includes('list_fm1_apps'));p.dispose();
});
test('successful transport with an enumeration error cannot replace connection history with disconnected',async()=>{
  const failed={...disconnectedInventory(),device:{...disconnectedInventory().device,inventory_error:'Windows device enumeration failed'}};
  const p=await panel({embedded:true,nativeControls:true,jobData:({name,defaultJob})=>name==='get_fm1_status'?failed:defaultJob});await p.advancePoll(1500);
  assert.equal(p.node('physical-device').textContent,'FM-1 on COM10');assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');assert.match(p.node('inventory-freshness').textContent,/Last confirmed FM-1 on COM10.*refresh failed/);assert.equal(p.node('official-state').textContent,'Unavailable');assert.ok(!p.node('physical-device').history.includes('FM-1 disconnected'));p.dispose();
});
test('cached native observations with old or future timestamps cannot revive connected headings',async()=>{
  for(const observed_at of [Math.floor(Date.now()/1000)-7200,Math.floor(Date.now()/1000)+7200]){
    const p=await panel({embedded:true,serverTools:false,initialToolResult:{profiles:[],catalog:{apps:[]},relay:{connected:true,allow_switch:true},inventory:{device:{serial_ports:[{port:'COM10'}],update_mode:{mode:'serial'}}},inventory_status:{state:'fresh',observed_at,age_seconds:1,max_age_seconds:15},recent_requests:[]}});
    assert.equal(p.node('physical-device').textContent,'Not checked');assert.equal(p.node('device-heading').textContent,'FM-1');assert.ok(!p.node('physical-device').history.includes('FM-1 on COM10'));assert.ok(!p.node('device-heading').history.includes('FM-1 on COM10'));await p.advancePoll(60000);assert.equal(p.requests.length,0);assert.equal(p.pollTimers.size,0);p.dispose();
  }
});
test('automatic metadata preserves job progress, firmware drafts, theme, selected variant and diagnostic proof',async()=>{
  const variants=[{id:'nes-test',title:'First NES',variant:'one',sha256:digest,ready:true},{id:'nes-second',title:'Second NES',variant:'two',sha256:digest,ready:true}];
  const p=await panel({embedded:true,nativeControls:true,baseline:forgeBaseline,catalogValue:{apps:[{profile:'nes',title:'NES',variants}]},jobData:({name,defaultJob})=>name==='get_fm1_status'?disconnectedInventory():['plan_fm1_app','get_fm1_job'].includes(name)?progressJob(defaultJob.id,'succeeded',96):defaultJob});
  p.node('plan-nes').onclick();await until(()=>p.node('progress-bar').value===96);const id=p.node('active-operation').dataset.jobId;
  p.node('variant-nes').value='nes-second';p.node('forge-project-goal').value='Keep this unfinished synthesizer draft';p.node('forge-project-goal').oninput();p.node('palette-forge-black').onclick();
  const before={detail:p.node('active-status').textContent,message:p.node('message').textContent,cards:p.node('library').innerHTML,config:p.node('forge-config').textContent,prompt:p.node('forge-prompt').value};await p.advancePoll(1500);
  assert.equal(p.node('device-heading').textContent,'FM-1 disconnected');assert.equal(p.node('active-operation').dataset.jobId,id);assert.equal(p.node('active-status').textContent,before.detail);assert.equal(p.node('message').textContent,before.message);assert.equal(p.node('progress-bar').value,96);assert.equal(p.node('library').innerHTML,before.cards);assert.equal(p.node('variant-nes').value,'nes-second');assert.equal(p.node('forge-config').textContent,before.config);assert.equal(p.node('forge-prompt').value,before.prompt);assert.equal(p.document.body.dataset.appearance,'forge-black');assert.equal(p.node('new-forge-project').disabled,false);p.dispose();
});
test('manual Refresh shares a slow automatic observation and preserves a selected job result',async()=>{
  let release;const held=new Promise(done=>{release=done;});const p=await panel({embedded:true,nativeControls:true,beforeCall:name=>name==='get_fm1_status'?held:undefined,jobData:({name,defaultJob})=>name==='get_fm1_status'?disconnectedInventory():['plan_fm1_app','get_fm1_job'].includes(name)?progressJob(defaultJob.id,'succeeded',96):defaultJob});
  p.node('plan-nes').onclick();await until(()=>p.node('progress-bar').value===96);const id=p.node('active-operation').dataset.jobId;const detail=p.node('active-status').textContent,message=p.node('message').textContent;
  await p.advancePoll(1500);p.node('refresh').onclick();await tick();assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);release();await until(()=>p.requests.includes('list_fm1_apps'));await tick();
  assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);assert.equal(p.node('active-operation').dataset.jobId,id);assert.equal(p.node('active-status').textContent,detail);assert.equal(p.node('message').textContent,message);assert.equal(p.node('progress-bar').value,96);p.dispose();
});
test('automatic connection render keeps app cards without variants unavailable',async()=>{
  const p=await panel({embedded:true,nativeControls:true,catalogValue:{apps:[{profile:'nes',title:'NES',variants:[]}]},jobData:({name,defaultJob})=>name==='get_fm1_status'?{device:{serial_ports:[{port:'COM10'}],update_mode:{mode:'serial'}},engine:{blocked_unknown:false}}:defaultJob});await p.advancePoll(1500);
  assert.equal(p.node('physical-device').textContent,'FM-1 on COM10');assert.equal(p.node('plan-nes').disabled,true);assert.equal(p.node('switch-nes').disabled,true);p.dispose();
});
const stockPanelHash='db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a';
function stockPanelInventory(){return {engine:{active:null,blocked_unknown:false},device:{serial_ports:[],uboot_disks:[],update_mode:{mode:'sysex',official_available:true},stock_update:{configured:true,available:true,native_runtime:true,sha256:stockPanelHash,size:699956,identity:'FM-1_015',expected_stock_pair:{inputName:'FM-1',outputName:'FM-1'}}}};}
test('native stock review shows exact package and MIDI route and only a trusted click starts one transfer',async()=>{
  const p=await panel({embedded:true,stock:true,inventory:stockPanelInventory()});
  assert.equal(p.node('stock-update').disabled,false);p.node('stock-update').onclick();await tick();
  const approval=p.env.DB.sqlite.prepare('SELECT id,kind,used FROM official_update_approvals').get();
  assert.equal(approval.kind,'stock_sysex');assert.equal(approval.used,0);assert.equal(p.node('approval').open,true);
  assert.match(p.node('review').innerHTML,new RegExp(stockPanelHash));assert.match(p.node('review').innerHTML,/FM-1_015/);assert.match(p.node('review').innerHTML,/MIDI input: FM-1/);assert.ok(!p.node('review').innerHTML.includes(approval.id));
  p.node('confirm').onclick({isTrusted:false});await tick();assert.ok(!p.requests.includes('confirm_fm1_stock_update'));
  p.node('confirm').onclick({isTrusted:true});p.node('confirm').onclick({isTrusted:true});await tick();
  assert.equal(p.requests.filter(name=>name==='confirm_fm1_stock_update').length,1);assert.equal(p.node('active-operation').dataset.jobId,approval.id);assert.equal(p.node('active-title').textContent,'Stock firmware via SysEx');p.dispose();
});
test('native stock transfer follows original job and distinguishes reboot identity from full readback',async()=>{
  const p=await panel({embedded:true,stock:true,inventory:stockPanelInventory(),jobData:({name,args,answer,defaultJob})=>name==='confirm_fm1_stock_update'||name==='get_fm1_job'?{id:args.job_id||answer.job_id,status:'succeeded',operation:'stock_sysex_update',result:{ok:true,data:{transfer_finished:true,boot_identity_verified:true,readback_verified:false}},progress:{phase:'completed',message:'Stock transfer and reboot identity verified; full flash readback was not performed.',full_readback_verified:false}}:defaultJob});
  p.node('stock-update').onclick();await tick();p.node('confirm').onclick({isTrusted:true});await tick();
  assert.match(p.node('active-status').textContent,/reboot identity FM-1_015 verified/);assert.match(p.node('active-status').textContent,/full flash readback not performed/);assert.equal(p.requests.filter(name=>name==='confirm_fm1_stock_update').length,1);p.dispose();
});
test('native stock action refuses unavailable runtime, custom CDC mode and independent bench capability',async()=>{
  for(const options of [{stock:false},{stock:true,change:value=>value.device.stock_update.available=false},{stock:true,change:value=>{value.device.update_mode.mode='serial';value.device.stock_update.available=false;}},{stock:true,change:value=>value.engine.stock_baseline_invalidated=true}]){
    const value=stockPanelInventory();options.change?.(value);const p=await panel({embedded:true,stock:options.stock,inventory:value});assert.equal(p.node('stock-update').disabled,true);assert.ok(!p.requests.includes('confirm_fm1_stock_update'));p.dispose();
  }
});
test('native lost stock confirmation keeps the original job and Resume never confirms or writes again',async()=>{
  const p=await panel({embedded:true,stock:true,inventory:stockPanelInventory(),loseConfirmationReply:true});
  p.node('stock-update').onclick();await tick();const id=p.env.DB.sqlite.prepare('SELECT id FROM official_update_approvals').get().id;
  p.node('confirm').onclick({isTrusted:true});await tick();assert.equal(p.node('active-operation').dataset.jobId,id);assert.match(p.node('message').textContent,/Resume progress/);
  p.node('resume-active').onclick();await tick();assert.equal(p.requestArgs.find(item=>item.name==='get_fm1_job').args.job_id,id);assert.equal(p.requests.filter(name=>name==='confirm_fm1_stock_update').length,1);assert.equal(p.env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='stock_sysex_update'").get().n,1);p.dispose();
});
test('native already-OTA status disables new stock review and explains original-transfer recovery',async()=>{
  const value=stockPanelInventory();value.device.update_mode.mode='ota_sysex';value.device.stock_update.available=true;
  const p=await panel({embedded:true,stock:true,inventory:value});assert.equal(p.node('stock-update').disabled,true);assert.match(p.node('stock-update-state').textContent,/already in OTA.*original transfer locally/);assert.ok(!p.requests.includes('prepare_fm1_stock_update'));assert.ok(!p.requests.includes('confirm_fm1_stock_update'));p.dispose();
});
test('native reopening restores only the active stock transfer by its original ID without request-history controls',async()=>{
  const id='7'.repeat(32),value=stockPanelInventory();value.engine.active=id;
  const initialToolResult={profiles:[],relay:{connected:true,allow_stock_update:true},inventory:value,inventory_status:{state:'fresh',age_seconds:0,max_age_seconds:15},forge:{},recent_requests:[{id,operation:'stock_sysex_update',state:'succeeded',data:{id,status:'running'}}]};
  const p=await panel({embedded:true,stock:true,inventory:value,initialToolResult,jobData:({name,args,defaultJob})=>name==='get_fm1_job'?{id:args.job_id,status:'unknown',operation:'stock_sysex_update'}:defaultJob});
  await tick();assert.equal(p.node('active-operation').dataset.jobId,id);assert.equal(p.node('active-title').textContent,'Stock firmware via SysEx');assert.equal(p.requestArgs.find(item=>item.name==='get_fm1_job').args.job_id,id);assert.ok(!p.requests.includes('confirm_fm1_stock_update'));assert.ok(!UI_HTML.includes('id="requests"'));p.dispose();
});
test('hidden and offline panels pause observation; visible, focus and online events resume once',async()=>{
  const p=await panel({embedded:true,jobData:({name,defaultJob})=>name==='get_fm1_status'?disconnectedInventory():defaultJob});p.document.hidden=true;p.events.get('visibilitychange')();await p.advancePoll(30000);assert.equal(p.requests.length,0);assert.equal(p.pollTimers.size,0);
  p.document.hidden=false;p.events.get('visibilitychange')();p.events.get('focus')();await tick();assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);
  p.window.navigator.onLine=false;p.events.get('offline')();await p.advancePoll(30000);assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,1);assert.equal(p.pollTimers.size,0);assert.equal(p.node('device-heading').textContent,'FM-1 on COM10');assert.equal(p.node('connection-check').hidden,true);
  p.window.navigator.onLine=true;p.events.get('online')();p.events.get('focus')();await tick();assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,2);p.dispose();assert.equal(p.pollTimers.size,0);for(const event of ['visibilitychange','focus','online','offline','message'])assert.equal(p.events.has(event),false);await p.advancePoll(60000);assert.equal(p.requests.filter(name=>name==='get_fm1_status').length,2);
});


for (const rendering of ['source', 'production']) test(rendering+' USB selections enforce the IN budget without silently dropping capture',async()=>{
  const html=rendering==='source'?UI_HTML:await minifiedPanelHtml(),p=await panel({html,embedded:true,baseline:forgeBaseline});
  const config=()=>JSON.parse(p.node('forge-config').textContent);
  try {
    assert.equal(config().schemaVersion,4);assert.equal(config().usb.midiUpdate,true);assert.equal(config().usb.uacCapture,true);
    assert.equal(p.node('forge-usb-midi-update').checked,true);assert.equal(p.node('forge-card-usb-midi-update').hidden,false);
    assert.match(p.node('forge-usb-budget').textContent,/4 \/ 4/);
    const values=new Map(),dataTransfer={setData:(k,v)=>values.set(k,v),getData:k=>values.get(k)};
    p.node('forge-card-usb-midi-update').dragstart({dataTransfer});p.node('forge-drop-library').drop({dataTransfer,preventDefault(){}});
    assert.equal(config().usb.midiUpdate,false);assert.equal(p.node('forge-add-usb-midi-update').hidden,false);
    p.node('forge-add-usb-midi-update').onclick();assert.equal(config().usb.midiUpdate,true);
    p.node('forge-add-usb-uvc').onclick();
    assert.equal(p.node('forge-usb-audio-capture').checked,true);assert.equal(p.node('forge-usb-midi-update').checked,true);assert.equal(p.node('forge-usb-video').checked,true);
    assert.match(p.node('forge-usb-budget').textContent,/5 \/ 4/);assert.equal(p.node('forge-usb-budget').getAttribute('data-over-budget'),'true');
    assert.match(p.node('forge-project-status').textContent,/endpoint budget exceeded/);assert.equal(p.node('forge-config').textContent,'');assert.equal(p.node('forge-prompt').value,'');
    p.node('forge-download').onclick();assert.match(p.node('forge-project-status').textContent,/endpoint budget exceeded/);
    p.node('forge-card-usb-uac-capture').dragstart({dataTransfer});p.node('forge-drop-library').drop({dataTransfer,preventDefault(){}});
    assert.equal(config().usb.uvc,true);assert.equal(config().usb.midiUpdate,true);assert.equal(config().usb.uac,true);assert.equal(config().usb.uacCapture,false);
    assert.match(p.node('forge-detail-usb-uac').textContent,/Playback only/);assert.match(p.node('forge-usb-budget').textContent,/4 \/ 4/);
    assert.match(p.node('forge-prompt').value,/playback.only/);assert.match(p.node('forge-prompt').value,/"midiUpdate": true/);
    p.node('forge-usb-midi-update').checked=false;p.node('forge-usb-midi-update').onchange();
    p.node('forge-add-usb-uac-capture').onclick();assert.equal(config().usb.uacCapture,true);assert.equal(config().usb.uvc,true);
    p.node('forge-remove-usb-uac').onclick();assert.equal(config().usb.uac,false);assert.equal(config().usb.uacCapture,false);assert.equal(p.node('forge-usb-audio-capture').disabled,true);
    p.node('forge-add-usb-uac-capture').onclick();assert.equal(config().usb.uac,true);assert.equal(config().usb.uacCapture,true);
    assert.equal(config().usb.cdc,true);assert.equal(config().usb.uboot,true);assert.equal(p.requests.length,0);assertAppearanceStaysLocal(p);
  } finally {p.dispose();}
});

test('version 3 drafts keep firmware MIDI disabled while new projects enable it',async()=>{
  const current=projectConfig(defaultProject),{midiUpdate,uacCapture,...usb}=current.usb,legacy={...current,schemaVersion:3,usb};
  const p=await panel({embedded:true,initialToolResult:{action:'accept',config:legacy,project:{id:'d'.repeat(32),config:legacy}}});
  try {const restored=JSON.parse(p.node('forge-config').textContent);assert.equal(restored.schemaVersion,4);assert.equal(restored.usb.midiUpdate,false);assert.equal(p.node('forge-usb-midi-update').checked,false);assert.equal(p.requests.length,0);}finally{p.dispose();}
});


test('Windows native panel mounts its fixed MCP transport without browser permission or automatic connection',async()=>{
  const markup=WINDOWS_UI_HTML.split('<script>')[0];
  assert.doesNotMatch(markup,/id="direct-common(?:-|")/);
  assert.match(UI_HTML.split('<script>')[0],/id="direct-common"/);
  assert.match(markup,/<summary>Restore stock V15<\/summary>/);
  assert.match(markup,/<h2>Custom firmware update · SysEx<\/h2>/);
  assert.match(markup,/id="direct-connect-common"/);
  let connected=false;
  const status=()=>({connected,transport:connected?'stock-midi':null,identity:connected?'FM-1_015':null,loader:false,installationAvailable:false,supportedTransports:['stock-midi','firmware-midi'],lastError:null});
  const p=await panel({html:WINDOWS_UI_HTML,embedded:true,preserveDirectMode:true,backendOverride:async(name,args)=>{
    if(name==='connect_fm1_device'){assert.equal(args.transport,'stock-midi');connected=true;return status();}
    if(name==='get_fm1_device_status')return status();
    if(name==='get_fm1_stock_update_status'||name==='get_fm1_custom_update_status')return {supported:true,writing:false,attempt:null,review:null};
    if(name==='disconnect_fm1_device'){connected=false;return status();}
    assert.fail('Unexpected desktop tool '+name);
  }});
  try{
    await until(()=>p.requests.includes('get_fm1_custom_update_status')&&!p.node('direct-connect-midi').disabled);
    assert.equal(typeof p.window.FM1DesktopDevicesUI?.mount,'function');
    assert.equal(p.node('surface-label').textContent,'FM-1 Forge Windows plugin');
    assert.equal(p.node('device-heading').textContent,'FM-1 disconnected');
    assert.equal(p.node('direct-midi').textContent,'Native MIDI · no browser permission');
    assert.equal(p.node('direct-connect-serial').disabled,true);
    assert.equal(p.node('direct-connect-midi').disabled,false);
    assert.equal(p.node('direct-connect-common').disabled,false);
    assert.deepEqual(p.requests,['get_fm1_stock_update_status','get_fm1_custom_update_status']);
    p.node('direct-connect-midi').onclick({isTrusted:false});await tick();assert.deepEqual(p.requests,['get_fm1_stock_update_status','get_fm1_custom_update_status']);
    p.node('direct-connect-midi').onclick({isTrusted:true});
    await until(()=>p.node('device-heading').textContent.includes('FM-1_015'));
    assert.equal(p.node('connection-label').textContent,'Device connected');
    assert.equal(p.node('direct-stock-review').disabled,true);
    assert.match(p.node('diagnostics-status').textContent,/generated FWSC through Custom firmware update · SysEx/);
    await p.advancePoll(3000);
    assert.ok(p.requests.includes('get_fm1_device_status'));
    assert.ok(!p.node('device-heading').history.some(label=>/checking/i.test(label)));
    p.node('direct-disconnect').onclick({isTrusted:true});
    await until(()=>p.node('connection-label').textContent==='Device disconnected');
    assert.deepEqual(p.requests.filter(name=>name==='connect_fm1_device'),['connect_fm1_device']);
    assert.ok(p.requests.includes('disconnect_fm1_device'));
  }finally{p.dispose();}
});

test('macOS native panel renders its own edition with the same app-only native transport',async()=>{
  const markup=MACOS_UI_HTML.split('<script>')[0];assert.doesNotMatch(markup,/id="direct-common(?:-|")/);assert.match(markup,/<h2>Custom firmware update · SysEx<\/h2>/);
  const p=await panel({html:MACOS_UI_HTML,embedded:true,preserveDirectMode:true,backendOverride:async(name)=>{
    if(name==='get_fm1_stock_update_status'||name==='get_fm1_custom_update_status')return {supported:true,writing:false,attempt:null,review:null};
    assert.fail('Unexpected macOS desktop tool '+name);
  }});
  try{
    await until(()=>p.requests.includes('get_fm1_custom_update_status')&&!p.node('direct-connect-midi').disabled);
    assert.equal(JSON.parse(p.node('direct-hardware-report').textContent).platform,'darwin');assert.equal(p.node('surface-label').textContent,'FM-1 Forge macOS plugin');assert.equal(p.node('direct-context').textContent,'macOS · bundled runtime');
    assert.equal(p.node('inventory-freshness').textContent,'macOS desktop plugin connection');assert.match(p.node('direct-device-note').textContent,/bundled macOS plugin server/);
    assert.equal(p.node('direct-midi').textContent,'Native MIDI · no browser permission');assert.equal(p.node('direct-connect-serial').disabled,true);
    assert.deepEqual(p.requests,['get_fm1_stock_update_status','get_fm1_custom_update_status']);
  }finally{p.dispose();}
});
