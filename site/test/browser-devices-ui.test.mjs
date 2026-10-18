import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mountBrowserDevicesUi } from '../lib/fm1-browser-devices-ui.mjs';
import { STOCK } from '../lib/browser-stock/index.mjs';
import { UI_HTML } from '../lib/fm1-ui.mjs';
import * as forge from '../lib/fm1-forge-project.mjs';
import * as appearance from '../lib/fm1-appearance.mjs';

const metadata={product:STOCK.product,raw_bytes:STOCK.rawBytes,sha256:STOCK.sha256};
const scope={origin:'https://actual-panel.test',sentinel:'durable-test-sentinel',durableReady:true,locksAvailable:true};
const event={isTrusted:true},fakeFile={name:'official.fwsc'};
const caps={secureContext:true,midi:{apiAvailable:true,policy:'allowed'},serial:{apiAvailable:true,policy:'allowed'}};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture({saved=null,stockError=null,inspection=metadata,storage=scope,updatingPromise=null}={}){
  const nodes=new Map(),calls=[],events=new Map();let serialPublish,stockPublish;
  const el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,hidden:true,open:false,style:{},dataset:{},value:'',files:[],attributes:new Map(),history:[],
    clicks:0,click(){this.clicks++;},setAttribute(key,value){this.attributes.set(key,value);},removeAttribute(key){this.attributes.delete(key);},showModal(){this.open=true;},close(){this.open=false;},addEventListener(key,fn){this[key]=fn;}});return nodes.get(id);};
  let serialState={connected:false,profile:null},stockState={connected:false,identityVerified:false,updating:false,loader:false,storageScope:{...storage}};
  class Serial{
    constructor({onState}){serialPublish=value=>{serialState={...serialState,...value};onState({...serialState});};}
    getState(){return {...serialState};}
    async connect(){calls.push('serial.connect');serialPublish({connecting:true});serialPublish({connecting:false,connected:true,profile:'MOD-EDITOR/1'});}
    async readStatus(){calls.push('serial.readStatus');serialPublish({checking:true});await tick();serialPublish({checking:false});}
    async close(){calls.push('serial.close');serialPublish({connected:false,profile:null});}
    async dispose(){calls.push('serial.dispose');}
  }
  const stockFactory=options=>{
    stockPublish=value=>{stockState={...stockState,...value};options.onState({...stockState});};
    return {status:()=>({...stockState}),initialize:async()=>{calls.push('storage.initialize');},savedAttempt:async()=>{calls.push('storage.savedAttempt');return saved;},
      async connect(){calls.push('midi.connect');stockPublish({connected:true,identityVerified:true,identity:'FM-1_014',pair:{inputId:'in',outputId:'out',inputName:'FM-1',outputName:'FM-1'}});},
      async probe(){calls.push('midi.probe');},async disconnect(){calls.push('midi.disconnect');stockPublish({connected:false,identityVerified:false});},
      async inspectPackage(file){calls.push({operation:'inspect',file});return inspection;},
      async update(input){calls.push({operation:'update',...input});stockPublish({updating:true});options.onEvent({phase:'writing',progress:.5});
        if(updatingPromise)await updatingPromise;if(stockError){stockPublish({updating:false,connected:false,recoveryRequired:stockError.recovery_required});throw stockError;}
        stockPublish({updating:false,identity:STOCK.product,connected:true,identityVerified:true});return {jobId:input.jobId,sha256:STOCK.sha256,identity:STOCK.product,transfer_finished:true,boot_identity_verified:true,readback_verified:false};},
      async resume(input){calls.push({operation:'resume',...input});stockPublish({updating:false,identity:STOCK.product,connected:true,identityVerified:true});return {jobId:input.jobId,sha256:STOCK.sha256,identity:STOCK.product,transfer_finished:true,boot_identity_verified:true,readback_verified:false};},
    };
  };
  let ids=0;const runtime={navigator:{serial:{}},document:{hidden:false},crypto:{randomUUID:()=>++ids===1?'a'.repeat(32):'b'.repeat(32)},addEventListener:(name,fn)=>events.set(name,fn)};
  const controller=mountBrowserDevicesUi({el,SerialClass:Serial,stockFactory,runtime,capabilityReport:caps});
  return {el,nodes,calls,events,controller,Serial,stockFactory,runtime,serialPublish:value=>serialPublish(value),stockPublish:value=>stockPublish(value)};
}
test('mount initializes durable metadata only, with no chooser, device open, read or write',async()=>{
  const f=fixture();await f.controller.ready;assert.deepEqual(f.calls,['storage.initialize','storage.savedAttempt']);assert.equal(f.el('device-heading').textContent,'FM-1 disconnected');
  assert.ok(UI_HTML.includes('id="direct-connect-common"'));assert.ok(UI_HTML.includes('id="direct-common-dialog"'));
  assert.equal(f.el('direct-stock-review').disabled,true);assert.deepEqual(JSON.parse(f.el('direct-storage-report').textContent),scope);f.controller.dispose();
});
test('synthetic chooser clicks do nothing; trusted serial connection uses real profile without invented COM port',async()=>{
  const f=fixture();await f.controller.ready;await f.controller.connectSerial({isTrusted:false});assert.ok(!f.calls.includes('serial.connect'));
  await f.controller.connectSerial(event);assert.equal(f.el('device-heading').textContent,'FM-1 via USB serial · MOD-EDITOR/1');assert.ok(!/COM\d/.test(f.el('device-heading').textContent));
  const stable=f.el('device-heading').textContent,pending=f.controller.refresh();assert.equal(f.el('device-heading').textContent,stable);assert.equal(f.el('connection-check').hidden,false);await pending;
  assert.equal(f.el('device-heading').textContent,stable);assert.equal(f.el('connection-check').hidden,true);assert.ok(![...f.nodes.keys()].some(id=>/keymask|activity|counter/.test(id)));f.controller.dispose();
});
test('exact package review precedes trusted one-use confirmation and bytes remain local',async()=>{
  const f=fixture();await f.controller.ready;await f.controller.connectMidi(event);await f.controller.selectPackage(fakeFile);f.controller.stage(event);
  assert.equal(f.el('direct-stock-dialog').open,true);assert.match(f.el('direct-review-text').textContent,new RegExp(STOCK.sha256));assert.match(f.el('direct-review-text').textContent,/699956 bytes/);
  assert.ok(!f.calls.some(value=>value?.operation==='update'));await f.controller.confirm({isTrusted:false});assert.ok(!f.calls.some(value=>value?.operation==='update'));
  await f.controller.confirm(event);await f.controller.confirm(event);const writes=f.calls.filter(value=>value?.operation==='update');assert.equal(writes.length,1);
  assert.equal(writes[0].jobId,'a'.repeat(32));assert.equal(writes[0].reviewId,'b'.repeat(32));assert.equal(writes[0].packageBytes,fakeFile);
  assert.match(f.el('direct-transfer-status').textContent,/reboot identity verified.*full flash readback not performed/);f.controller.dispose();
});
test('different package metadata cannot unlock review or a write',async()=>{
  const f=fixture({inspection:{...metadata,sha256:'f'.repeat(64)}});await f.controller.ready;await f.controller.connectMidi(event);await assert.rejects(f.controller.selectPackage(fakeFile),/pinned official/);
  assert.equal(f.el('direct-stock-review').disabled,true);f.controller.stage(event);await f.controller.confirm(event);assert.ok(!f.calls.some(value=>value?.operation==='update'));f.controller.dispose();
});
test('lost connection keeps original uncertain attempt and requires explicit same-ID loader recovery',async()=>{
  const error=Object.assign(new Error('Disconnected after upgrade'),{recovery_required:true});const f=fixture({stockError:error});await f.controller.ready;await f.controller.connectMidi(event);await f.controller.selectPackage(fakeFile);f.controller.stage(event);
  const original=f.controller.state().review;await assert.rejects(f.controller.confirm(event),/Disconnected/);assert.equal(f.controller.state().attempt.state,'unknown');assert.ok(!f.calls.some(value=>value?.operation==='resume'));
  await f.controller.connectMidi(event);f.controller.stage(event,{resume:true});assert.equal(f.controller.state().review,null);assert.equal(f.el('direct-stock-recovery').disabled,true);
  f.stockPublish({loader:true,identityVerified:true,connected:true,identity:'FM-1_014',recoveryRequired:true});f.controller.stage(event,{resume:true});assert.equal(f.controller.state().review.jobId,original.jobId);assert.equal(f.controller.state().review.reviewId,original.reviewId);
  await f.controller.confirm(event);const resumed=f.calls.find(value=>value?.operation==='resume');assert.equal(resumed.jobId,original.jobId);assert.equal(resumed.reviewId,original.reviewId);assert.equal(f.calls.filter(value=>value?.operation==='update').length,1);f.controller.dispose();
});
test('reopening reads original attempt but never reconnects or resumes automatically',async()=>{
  const f=fixture({saved:{jobId:'c'.repeat(32),reviewId:'d'.repeat(32),state:'unknown',sha256:STOCK.sha256}});await f.controller.ready;
  assert.equal(f.controller.state().attempt.jobId,'c'.repeat(32));assert.equal(f.el('direct-stock-recovery').hidden,false);assert.ok(!f.calls.includes('midi.connect'));assert.ok(!f.calls.some(value=>value?.operation==='resume'));f.controller.dispose();
});
test('disconnect and page teardown cannot duplicate or close an active stock writer',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});const f=fixture({updatingPromise:pending});await f.controller.ready;await f.controller.connectMidi(event);await f.controller.selectPackage(fakeFile);f.controller.stage(event);
  const writing=f.controller.confirm(event);assert.equal(f.el('direct-disconnect').disabled,true);await f.controller.disconnect(event);assert.ok(!f.calls.includes('midi.disconnect'));f.controller.dispose();assert.ok(!f.calls.includes('midi.disconnect'));release();await writing;assert.equal(f.calls.filter(value=>value?.operation==='update').length,1);
});
test('durable storage and cross-tab locks gate all stock write and resume actions',async()=>{
  for(const storage of [{...scope,durableReady:false},{...scope,locksAvailable:false}]){
    const f=fixture({storage});await f.controller.ready;await f.controller.connectMidi(event);await f.controller.selectPackage(fakeFile);f.controller.stage(event);await f.controller.confirm(event);
    assert.equal(f.el('direct-stock-review').disabled,true);assert.match(f.el('direct-stock-note').textContent,/durable browser storage/);assert.ok(!f.calls.some(value=>value?.operation==='update'));f.controller.dispose();
  }
});
test('main native default stays direct, ignores old cloud COM inventory, and never starts helper polling',async()=>{
  const f=fixture(),requests=[],events=new Map(),imports=[];let localSets=[];await f.controller.ready;
  for(const [id,value] of Object.entries({'forge-project-name':'Test project','forge-project-slug':'test-project','forge-project-goal':'','forge-clock-preset':'sdk-default','forge-lcd-preset':'stock-dma','forge-module':'user','diag-entry-method':'auto'}))f.el(id).value=value;
  for(const id of ['forge-usb-audio',...['buttons','encoders','volume','lcd','audio'].map(name=>'forge-hal-'+name)])f.el(id).checked=true;
  for(const node of f.nodes.values()){node.querySelectorAll=()=>[];node.setAttribute??=()=>{};}
  const window={navigator:{},parent:{},localStorage:{getItem:()=>null,setItem:()=>{}},addEventListener:(name,fn)=>events.set(name,fn),FM1Appearance:appearance,FM1Forge:forge,
    FM1ModuleGraph:{mount:()=>({sync(){}})},FM1ExtensionUI:()=>({snapshot(){},context(){},close(){}}),FM1Inventory:{monitor:()=>assert.fail('No helper inventory monitor in direct mode')},
    FM1BrowserHardwareCapabilities:()=>({...caps,secureContextKnown:true,usb:{apiAvailable:false,policy:'unknown'}}),FM1BrowserDevicesUI:{mount:()=>f.controller},
    FM1BrowserLibrary:{createBrowserLibrary:()=>({listSets:async()=>localSets,importFiles:async(files,options)=>{imports.push({files,options});const saved={id:'local-set',name:options.name,members:[{title:'Local NES',variant:'Fixture',sha256:'f'.repeat(64)}]};localSets=[saved];return saved;}})},
    FM1PluginHost:class{constructor(options){this.options=options;}async connect(){this.options.onToolResult({structuredContent:{profiles:[],catalog:null,forge:{},inventory:{device:{serial_ports:[{port:'COM99'}]}},relay:{connected:true,allow_switch:true}}});return {capabilities:{serverTools:{}},context:{}};}async call(name){requests.push(name);return {structuredContent:{profiles:[],forge:{}}};}features(){return {};}state(){return {};}close(){}},
  };
  const document={body:{dataset:{},style:{setProperty(){}},classList:{add(){}}},documentElement:{style:{}},hidden:false,getElementById:f.el,addEventListener:()=>{}};
  const context=vm.createContext({window,document,AbortController,Map,Object,Number,JSON,RegExp,String,Error,URL,crypto:globalThis.crypto,Date,setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){}});
  const script=[...UI_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];vm.runInContext(script,context);await tick();
  assert.equal(document.body.dataset.deviceMode,'direct');assert.equal(f.el('device-heading').textContent,'FM-1 disconnected');assert.equal(f.el('install-diagnostics').disabled,true);assert.equal(f.el('library-add').disabled,false);assert.equal(f.el('forge-ask').disabled,false);assert.equal(requests.length,0);
  f.el('library-add').onclick({isTrusted:false});assert.equal(f.el('direct-library-files').clicks,0);f.el('library-add').onclick(event);assert.equal(f.el('direct-library-files').clicks,1);
  const localFile={name:'exported-nes.json'},nonPackage={name:'README.txt'};f.el('direct-library-files').files=[localFile,nonPackage];f.el('direct-library-name').value='My local set';f.el('direct-library-files').onchange(event);await tick();
  assert.equal(imports.length,1);assert.equal(imports[0].files[0],localFile);assert.equal(imports[0].files.length,2);assert.equal(imports[0].files[1],nonPackage);assert.equal(imports[0].options.name,'My local set');assert.match(f.el('library').innerHTML,/Local NES.*manual UBOOT/);assert.equal(requests.length,0);
  assert.ok(!UI_HTML.includes('id="hardware-activity"'));events.get('pagehide')();
});
