import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {extensionRuntime,extensionHtml} from '../lib/fm1-extension-ui.mjs';
import {projectConfig,normalizeProjectConfig,projectPrompt,verifiedBaseline} from '../lib/fm1-forge-project.mjs';
import {createResourceEditor} from '../lib/fm1-extension-host.mjs';
import {ICON_PNG_DATA_URI} from '../lib/fm1-icon.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
const config=projectConfig({slug:'draft-fw',displayName:'Draft FW',clockPreset:'sdk-default',clockOptIn:false,lcdPreset:'stock-dma',module:'user',usbAudio:true});
const id='a'.repeat(32),project={id,title:'Draft FW',slug:'draft-fw',config,resource_uri:'fm1-forge://projects/'+id};
function ui({features={},modelContext,route,backend,draftConfig=config,resourceText=JSON.stringify(config),resourceWritable=true,firstReadFails=false}={}){
  const nodes=new Map(),calls=[],applied=[],appliedOptions=[],settingsApplied=[],opened=[],contexts=[],scrolls=[],writes=[];let changed,closed=false,readCount=0;
  function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',children:[],disabled:false,checked:false,options:[],appendChild(child){this.children.push(child);},scrollIntoView(){}});return nodes.get(id);}
  node('forge-message-mode').value='active-send';node('forge-message-mode').options=['active-send','active-draft','new-send','new-draft'].map(value=>({value}));
  const host={features:()=>features,state:()=>({features,modelContext,route}),fileInput:input=>input,
    modelContext:async params=>{contexts.push(params);return {updateId:'updated'};},openFile:async path=>{opened.push(path);return {};},displayMode:async mode=>({mode}),
    resourceEditor(callback){return createResourceEditor({addUpdateHandler(fn){changed=fn;return ()=>{closed=true;};},async read({uri}){if(++readCount===1&&firstReadFails)throw new Error('Temporary resource read failure.');return {contents:[{uri,text:resourceText,openaiMetadata:{etag:'a',writable:resourceWritable}}]};},async subscribe(){},async unsubscribe(){},async write(uri,data){writes.push({uri,...data});return {outcome:'saved',etag:'b'};}},callback);}};
  const document={createElement:tag=>({tag,textContent:'',className:'',onclick:null})},window={FM1Forge:{normalizeProjectConfig,projectPrompt,verifiedBaseline}},context=vm.createContext({document,window,Array,JSON,Object,Error,RegExp});vm.runInContext(extensionRuntime,context);
  const controller=new AbortController(),value=window.FM1ExtensionUI({el:node,call:async(name,args)=>{calls.push({name,args});if(backend)return backend(name,args);return name==='list_fm1_projects'?{projects:[project]}:name==='get_fm1_project'?{project}:name==='save_fm1_project'?{project}:{};},host:()=>host,embedded:true,signal:controller.signal,prepareProject:()=>({config:draftConfig,prompt:projectPrompt(draftConfig)}),applyConfig:(config,options)=>{applied.push(config);appliedOptions.push(options);},applySettings:(settings,options)=>settingsApplied.push({settings,options}),getState:()=>({}),contextIcon:ICON_PNG_DATA_URI,scroll:id=>scrolls.push(id)});
  return {value,node,calls,applied,appliedOptions,settingsApplied,opened,contexts,scrolls,writes,get closed(){return closed;},changeContext(next){modelContext=next;value.context();},changeRoute(next){route=next;value.context();},async notify(uri){await changed?.({params:{uri}});},close(){value.close();controller.abort();}};
}
test('all extension features have visible explicit UI controls',()=>{
  const html=extensionHtml([{id:'forge-black',name:'Forge Black'}],[{id:'solid',name:'Solid'}]);for(const id of ['forge-save-draft','forge-native-form','forge-context-attach','forge-context-clear','forge-open-local','forge-resource-save','forge-resource-load','forge-save-settings','forge-fullscreen','forge-inline'])assert.ok(html.includes('id="'+id+'"'));assert.ok(!html.includes('confirm_fm1_switch'));
});
test('unsupported host disables extension actions without issuing calls',()=>{
  const p=ui();for(const id of ['forge-context-attach','forge-context-clear','forge-open-local','forge-fullscreen','forge-inline'])assert.equal(p.node(id).disabled,true);assert.ok(p.node('forge-message-mode').options.slice(1).every(o=>o.disabled));assert.equal(p.calls.length,0);p.close();
});
test('extension-capable host enables advertised modes and context/files independently',()=>{
  const p=ui({features:{message:true,modelContext:true,files:true,displayModes:['fullscreen']}});assert.equal(p.node('forge-context-attach').disabled,false);assert.equal(p.node('forge-open-local').disabled,false);assert.equal(p.node('forge-fullscreen').disabled,false);assert.equal(p.node('forge-inline').disabled,true);assert.ok(p.node('forge-message-mode').options.every(o=>!o.disabled));p.close();
});
test('valid model context restores only validated config and is not repeatedly applied for the same update',()=>{
  const context={updateId:'one',structuredContent:{fm1Forge:{version:1,config,projectId:id,resourceUri:project.resource_uri}}},p=ui({features:{modelContext:true},modelContext:context});assert.deepEqual(p.applied,[config]);p.value.context();assert.equal(p.applied.length,1);assert.equal(p.value.selectedProject.id,id);p.close();
});

test('version 1 context envelope restores legacy configuration as v2 and retains deselected v2 HALs',()=>{
  const {hal,...previous}=config,legacy={...previous,schemaVersion:1},selected={...config,hal:{...hal,buttons:false,lcd:false,audio:false}};
  for(const [input,expected] of [[legacy,config],[selected,selected]]){
    const p=ui({features:{modelContext:true},modelContext:{updateId:'restored',structuredContent:{fm1Forge:{version:1,config:input}}}});
    assert.deepEqual(p.applied,[expected]);assert.equal(p.calls.length,0);p.close();
  }
});
test('invalid model context and invalid resource linkage retain current draft without backend calls',()=>{
  for(const payload of [{version:1,config:{usb:{uboot:false}}},{version:1,config,projectId:'bad'},{version:1,config,projectId:id,resourceUri:'file:///C:/secret'}]){const p=ui({features:{modelContext:true},modelContext:{updateId:'bad',structuredContent:{fm1Forge:payload}}});assert.equal(p.applied.length,0);assert.match(p.node('forge-context-status').textContent,/retained/);assert.equal(p.calls.length,0);p.close();}
});
test('undefined context is unsupported while host null is explicitly cleared without discarding draft',()=>{
  const p=ui({features:{modelContext:true}});assert.equal(p.applied.length,0);p.changeContext(null);assert.match(p.node('forge-context-status').textContent,/host cleared/);assert.equal(p.applied.length,0);p.close();
});
test('attach and clear context require explicit actions and contain no build or flash request',async()=>{
  const p=ui({features:{modelContext:true}});assert.equal(p.contexts.length,0);p.node('forge-context-attach').onclick();await tick();assert.deepEqual(p.contexts[0].structuredContent.fm1Forge.config,config);assert.match(p.contexts[0].content[0].text,/no build or flash/);const metadata=p.contexts[0].content[0]._meta;assert.equal(metadata['openai/title'],'Draft FW');assert.equal(metadata['openai/thumbnail'].src,ICON_PNG_DATA_URI);assert.deepEqual(Buffer.from(metadata['openai/thumbnail'].src.split(',')[1],'base64').subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));p.node('forge-context-clear').onclick();await tick();assert.deepEqual(JSON.parse(JSON.stringify(p.contexts[1])),{content:[],structuredContent:{}});assert.equal(p.calls.length,0);p.close();
});
test('project deep link reads the exact owner draft once and job deep link merely selects saved ID',async()=>{
  const p=ui({route:{section:'project',id}});await tick();assert.deepEqual(JSON.parse(JSON.stringify(p.calls)),[{name:'get_fm1_project',args:{project_id:id}}]);p.value.context();await tick();assert.equal(p.calls.length,1);p.changeRoute({section:'job',id});assert.equal(p.node('job-id').value,id);assert.equal(p.calls.length,1);assert.match(p.node('forge-context-status').textContent,/Use Inspect job/);p.close();
});
test('configuration drafts are saved and opened independently of firmware baseline gate',async()=>{
  const p=ui();p.node('forge-save-draft').onclick();await tick();assert.equal(p.calls[0].name,'save_fm1_project');assert.deepEqual(p.calls[0].args.config,config);assert.equal(p.value.selectedProject.id,id);p.node('forge-new-draft').onclick();assert.equal(p.value.selectedProject,null);p.node('forge-list-projects').onclick();await tick();assert.equal(p.node('forge-projects').children[0].textContent,'Draft FW · draft-fw');p.node('forge-projects').children[0].onclick();await tick();assert.deepEqual(p.applied,[config]);assert.ok(p.calls.every(c=>!['confirm_fm1_switch','plan_fm1_app','get_fm1_status'].includes(c.name)));p.close();
});

test('draft save and attached model context use canonical v2 and preserve false HAL selections',async()=>{
  const selected={...config,hal:{...config.hal,volume:false,encoders:false}},p=ui({features:{modelContext:true},draftConfig:selected});
  p.node('forge-save-draft').onclick();await tick();assert.deepEqual(p.calls[0].args.config,selected);
  p.node('forge-context-attach').onclick();await tick();assert.deepEqual(p.contexts[0].structuredContent.fm1Forge.config,selected);assert.equal(p.contexts[0].structuredContent.fm1Forge.version,1);p.close();
  const {hal,...previous}=config,q=ui({features:{modelContext:true},draftConfig:{...previous,schemaVersion:1}});
  q.node('forge-save-draft').onclick();await tick();assert.deepEqual(q.calls[0].args.config,config);
  q.node('forge-context-attach').onclick();await tick();assert.deepEqual(q.contexts[0].structuredContent.fm1Forge.config,config);q.close();
});

test('old saved drafts load through the normalizer without replacing the backend payload',async()=>{
  const {hal,...previous}=config,legacy={...previous,schemaVersion:1},saved={...project,config:legacy},p=ui({route:{section:'project',id},backend:async()=>({project:saved})});
  await tick();assert.deepEqual(p.applied,[config]);assert.deepEqual(p.value.selectedProject.config,config);assert.equal(saved.config.schemaVersion,1);p.close();
});
test('unsupported native form opens the manual designer and reports its server message',async()=>{
  const p=ui({backend:async()=>({action:'unsupported',message:'This host does not support native forms.'})});p.node('forge-native-form').onclick();await tick();assert.equal(p.node('forge-designer').open,true);assert.match(p.node('forge-draft-status').textContent,/does not support native forms/);assert.equal(p.applied.length,0);p.close();
});
test('accepted native form populates designer but never submits firmware work',async()=>{
  const p=ui({backend:async name=>name==='configure_fm1_project'?{action:'accept',config,project}:{projects:[project]}});p.node('forge-native-form').onclick();await tick();assert.deepEqual(p.applied,[config]);assert.deepEqual(p.calls.map(c=>c.name),['configure_fm1_project','list_fm1_projects']);assert.match(p.node('forge-draft-status').textContent,/No firmware build or transfer/);p.close();
});

test('native form restores selected HALs and supports a legacy form configuration response',async()=>{
  const selected={...config,hal:{...config.hal,buttons:false,audio:false}}, {hal,...previous}=config;
  for(const [input,expected] of [[selected,selected],[{...previous,schemaVersion:1},config]]){
    const p=ui({backend:async name=>name==='configure_fm1_project'?{action:'accept',config:input,project}:{projects:[]}});
    p.node('forge-native-form').onclick();await tick();assert.deepEqual(p.applied,[expected]);p.close();
  }
});
test('owner defaults load once and explicit save applies values through settings tools',async()=>{
  const values={palette:'forge-black',pattern:'solid',entry_method:'auto',default_module:'user',default_usb_audio:true},p=ui({backend:async()=>({values})});p.value.snapshot({forge:{settings:values,projects:[]}});p.value.snapshot({forge:{settings:values}});assert.equal(p.settingsApplied.length,1);assert.equal(p.settingsApplied[0].options.explicit,false);p.node('forge-save-settings').onclick();await tick();assert.equal(p.calls[0].name,'settings.update');assert.deepEqual(JSON.parse(JSON.stringify(p.calls[0].args.set)),values);assert.equal(p.settingsApplied[1].options.explicit,true);p.close();
});
test('host-selected file uses only resource API and never queues hardware or cloud library refresh',async()=>{
  const p=ui({features:{resources:true}});await p.value.fileInput({file:{name:'test.fm1-forge.json',resourceUri:'opaque:file'}});assert.equal(p.node('forge-resource-panel').hidden,false);assert.equal(p.node('forge-resource-text').value,JSON.stringify(config));assert.equal(p.calls.length,0);p.node('forge-resource-load').onclick();await tick();assert.deepEqual(p.applied,[config]);assert.equal(p.calls.length,0);p.close();assert.equal(p.closed,true);
});
test('resource edits save with original ETag and valid Forge schema',async()=>{
  const p=ui({features:{resources:true}});await p.value.fileInput({file:{name:'test.fm1-forge.json',resourceUri:'opaque:file'}});p.node('forge-resource-text').value=JSON.stringify(config,null,2);p.node('forge-resource-text').oninput();assert.equal(p.node('forge-resource-save').disabled,false);p.node('forge-resource-save').onclick();await tick();assert.equal(p.writes[0].ifMatch,'a');assert.equal(p.writes[0].uri,'opaque:file');assert.match(p.node('forge-resource-status').textContent,/File saved/);p.close();
});

test('legacy file loading normalizes the designer while saves retain exact edited text and ETag',async()=>{
  const {hal,...previous}=config,legacy={...previous,schemaVersion:1},raw=JSON.stringify(legacy,null,3)+'\n',p=ui({features:{resources:true},resourceText:raw});
  await p.value.fileInput({file:{name:'legacy.fm1-forge.json',resourceUri:'opaque:legacy'}});
  p.node('forge-resource-load').onclick();await tick();assert.deepEqual(p.applied,[config]);assert.equal(p.node('forge-resource-text').value,raw);
  const edited=raw+'\n';p.node('forge-resource-text').value=edited;p.node('forge-resource-text').oninput();p.node('forge-resource-save').onclick();await tick();
  assert.equal(p.writes[0].text,edited);assert.equal(p.writes[0].ifMatch,'a');assert.equal(JSON.parse(p.writes[0].text).schemaVersion,1);p.close();
});

test('selected v2 file loads false HAL flags and malformed HAL text cannot be loaded or saved',async()=>{
  const selected={...config,hal:{...config.hal,lcd:false,encoders:false}},p=ui({features:{resources:true},resourceText:JSON.stringify(selected)});
  await p.value.fileInput({file:{name:'selected.fm1-forge.json',resourceUri:'opaque:selected'}});p.node('forge-resource-load').onclick();await tick();assert.deepEqual(p.applied,[selected]);
  p.node('forge-resource-text').value=JSON.stringify({...config,hal:{...config.hal,audio:'false'}});p.node('forge-resource-text').oninput();assert.equal(p.node('forge-resource-load').disabled,true);assert.equal(p.node('forge-resource-save').disabled,true);p.node('forge-resource-save').onclick();await tick();assert.equal(p.writes.length,0);assert.match(p.node('forge-resource-status').textContent,/HAL/);p.close();
});
test('unrecognized JSON and HTML content remains plain text, read-only, and cannot become a project',async()=>{
  for(const resourceText of ['<script>flash()</script>','{"unknown":true}']){const p=ui({features:{resources:true},resourceText,resourceWritable:false});await p.value.fileInput({file:{name:'test.fm1-forge.json',resourceUri:'opaque:file'}});assert.equal(p.node('forge-resource-text').value,resourceText);assert.equal(p.node('forge-resource-text').readOnly,true);assert.equal(p.node('forge-resource-load').disabled,true);assert.equal(p.node('forge-resource-save').disabled,true);assert.equal(p.calls.length,0);p.close();}
});
test('local file opening passes only the explicit field and is separate from cloud resource URI',async()=>{
  const p=ui({features:{files:true}});p.node('forge-local-path').value='C:\\Projects\\forge.json';p.node('forge-open-local').onclick();await tick();assert.deepEqual(p.opened,['C:\\Projects\\forge.json']);assert.equal(p.calls.length,0);p.close();
});
test('late draft reply cannot update a torn-down panel',async()=>{
  let resolve;const p=ui({backend:()=>new Promise(done=>{resolve=done;})});p.node('forge-save-draft').onclick();p.close();resolve({project});await tick();assert.equal(p.value.selectedProject,null);assert.equal(p.calls.length,1);
});
test('native form goal and experimental clock opt-in are forwarded into the editable brief',async()=>{
  const goal='A pad-controlled synthesizer.',p=ui({backend:async name=>name==='configure_fm1_project'?{action:'accept',config,project,goal,clock_opt_in:true}:{projects:[]}});p.node('forge-native-form').onclick();await tick();assert.equal(p.appliedOptions[0].goal,goal);assert.equal(p.appliedOptions[0].clockOptIn,true);p.close();
});
test('failed host file read can reopen the same selection and establish a fresh resource session',async()=>{
  const p=ui({features:{resources:true},firstReadFails:true}),input={file:{name:'retry.fm1-forge.json',resourceUri:'opaque:retry'}};await assert.rejects(p.value.fileInput(input),/Temporary/);await p.value.fileInput(input);assert.equal(p.node('forge-resource-text').value,JSON.stringify(config));assert.equal(p.node('forge-resource-load').disabled,false);p.close();
});
test('ordinary home deep link does not show an invalid-route error or start a tool',()=>{
  const p=ui({features:{modelContext:true},route:{section:'home'}});assert.equal(p.calls.length,0);assert.ok(!p.node('forge-context-status').textContent.includes('unsupported deep link'));p.close();
});
