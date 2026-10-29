import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {mountDesktopDevicesUi} from '../lib/fm1-desktop-devices-ui.mjs';
import {customFwscHtml} from '../lib/fm1-desktop-custom-ui.mjs';
import {MCP_APPS_SCRIPT} from '../lib/fm1-app-sdk.generated.mjs';

const user={isTrusted:true},synthetic={isTrusted:false},tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const rawBytes=623156,hash=letter=>letter.repeat(64),opaque=letter=>letter.repeat(32);
const manifest=overrides=>({schemaVersion:1,policy_version:'customfwsc-v1',package_sha256:hash('a'),logical_sha256:hash('b'),raw_bytes:rawBytes,logical_bytes:623136,target_build_sha256:hash('c'),expected_boot_identity:'FM1_FORGE_001',family:8,profile:'forge-diag',source_stock_sha256:hash('d'),ota_sha256:hash('e'),application_sha256:hash('f'),application_bytes:100,preservation:'public-v15-fixed-layout-app-only',hardware_qualified:false,stock_tail_proof:{block_bytes:32,mutable_blocks:4,prefix_hashes:[hash('0')]},...overrides});
const customReview=overrides=>({review_id:opaque('5'),job_id:opaque('6'),kind:'custom-fwsc',operation:'install',product:'FM-1 Forge diagnostics',identity:'FM-1_015',input_name:'FM-1 MIDI input',output_name:'FM-1 MIDI output',sha256:hash('a'),logical_sha256:hash('b'),target_build_sha256:hash('c'),manifest_sha256:hash('d'),raw_bytes:rawBytes,logical_bytes:623136,expected_boot_identity:'FM1_FORGE_001',expires_at:'2099-10-19T00:00:00.000Z',...overrides});
const stockReview=()=>({review_id:opaque('1'),job_id:opaque('2'),operation:'install',product:'FM-1_015',identity:'FM-1_015',input_name:'FM-1 MIDI input',output_name:'FM-1 MIDI output',sha256:hash('3'),raw_bytes:699956,logical_bytes:699936,expires_at:'2099-10-19T00:00:00.000Z'});
const stockAttempt=(state='active',overrides={})=>({job_id:opaque('2'),state,phase:'Serving stock package',progress:0.25,transfer_finished:false,boot_identity_verified:false,readback_verified:false,recovery_required:state==='unknown',...overrides});
const customAttempt=(state='active',overrides={})=>({...stockAttempt(state),job_id:opaque('6'),kind:'custom-fwsc',phase:'Serving custom package',boot_build_verified:false,target_build_sha256:hash('c'),expected_boot_identity:'FM1_FORGE_001',observed_boot_identity:null,observed_build_sha256:null,...overrides});
const trackerManifest=overrides=>manifest({profile:'protracker',family:9,expected_boot_identity:'MOD-EDITOR/1',...overrides});
const trackerReview=overrides=>customReview({product:'FM-1 Tracker',profile:'protracker',verification_transport:'cdc',expected_boot_identity:'MOD-EDITOR/1',...overrides});
const trackerAttempt=(state='unknown',overrides={})=>customAttempt(state,{profile:'protracker',verification_transport:'cdc',expected_boot_identity:'MOD-EDITOR/1',...overrides});
const status=overrides=>({supported:true,writing:false,attempt:null,review:null,...overrides});
const device=overrides=>({connected:true,transport:'stock-midi',identity:'FM-1_015',profile:null,loader:false,installationAvailable:false,supportedTransports:['stock-midi'],...overrides});
const packageFile=bytes=>({name:'my-firmware.fwsc',size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer});
const manifestFile=value=>{const bytes=new TextEncoder().encode(JSON.stringify(value));return {name:'my-firmware.manifest.json',size:bytes.length,arrayBuffer:async()=>bytes.buffer};};
function fixture({stockUpdateAvailable=true,customUpdateAvailable=true,stock=status(),custom=status(),handler,mount=mountDesktopDevicesUi}={}){
  const backend={stock,custom,device:device(),customReview:customReview(),stockReview:stockReview(),chunks:[],manifest:null},nodes=new Map(),calls=[],signals=[],timers=new Map(),events=new Map(),documentEvents=new Map();let sequence=0;
  const el=key=>{if(!nodes.has(key))nodes.set(key,{textContent:'',disabled:false,hidden:false,open:false,className:'',onclick:null,onchange:null,showModal(){this.open=true;},close(){this.open=false;},addEventListener(){},removeEventListener(){},removeAttribute(name){delete this[name];}});return nodes.get(key);};
  const forbidden=()=>assert.fail('Native custom FWSC controls must not call browser device APIs');
  const runtime={navigator:{requestMIDIAccess:forbidden,serial:{requestPort:forbidden},usb:{requestDevice:forbidden}},document:{hidden:false,addEventListener:(name,fn)=>documentEvents.set(name,fn),removeEventListener:name=>documentEvents.delete(name)},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),setTimeout:(fn,ms)=>{const key=++sequence;timers.set(key,{fn,ms});return key;},clearTimeout:key=>timers.delete(key)};
  const abort=new AbortController(),call=async(name,args,signal)=>{
    calls.push({name,args});signals.push(signal);if(handler){const reply=await handler(name,args,backend);if(reply!==undefined)return reply;}
    if(name==='get_fm1_stock_update_status')return backend.stock;
    if(name==='get_fm1_custom_update_status')return backend.custom;
    if(name==='connect_fm1_device')return backend.device;
    if(name==='get_fm1_device_status')return backend.device;
    if(name==='disconnect_fm1_device'){backend.device=device({connected:false,transport:null,identity:null});return backend.device;}
    if(name==='begin_fm1_custom_upload'){backend.manifest=structuredClone(args.manifest);backend.chunks=[];return {upload_id:opaque('7'),max_chunk_bytes:65536};}
    if(name==='append_fm1_custom_upload'){const bytes=Buffer.from(args.data_base64,'base64');backend.chunks.push({offset:args.offset,bytes});return {upload_id:args.upload_id,received_bytes:args.offset+bytes.length};}
    if(name==='review_fm1_custom_update'){backend.custom={...backend.custom,review:backend.customReview};return {review:backend.customReview};}
    if(name==='review_fm1_custom_recovery'){backend.customReview=customReview({operation:'resume',identity:backend.device.identity,job_id:args.job_id});backend.custom={...backend.custom,review:backend.customReview};return {review:backend.customReview};}
    if(name==='start_fm1_custom_update'){backend.custom=status({writing:true,attempt:customAttempt()});return {writing:true,attempt:backend.custom.attempt,review:null};}
    if(name==='begin_fm1_stock_upload')return {upload_id:opaque('4'),max_chunk_bytes:65536};
    if(name==='append_fm1_stock_upload')return {upload_id:args.upload_id,received_bytes:args.offset+Buffer.from(args.data_base64,'base64').length};
    if(name==='review_fm1_stock_update'){backend.stock={...backend.stock,review:backend.stockReview};return {review:backend.stockReview};}
    if(name==='start_fm1_stock_update'){backend.stock=status({writing:true,attempt:stockAttempt()});return {writing:true,attempt:backend.stock.attempt,review:null};}
    assert.fail('Unexpected native tool '+name);
  };
  const controller=mount({el,call,runtime,signal:abort.signal,supportedTransports:['stock-midi'],stockUpdateAvailable,customUpdateAvailable});
  return {el,calls,signals,backend,controller,runtime,abort,timers,events,documentEvents,async pair(){await controller.ready;await controller.connectMidi(user);const bytes=new Uint8Array(rawBytes).fill(7);await controller.custom.selectManifest(manifestFile(manifest()),user);await controller.custom.selectPackage(packageFile(bytes),user);return bytes;},async poll(){const row=timers.entries().next().value;assert.ok(row,'one shared status timer expected');timers.delete(row[0]);row[1].fn();await tick();}};
}

test('custom FWSC has separate controls and remains disabled without explicit native capability',async()=>{
  assert.match(customFwscHtml,/Custom firmware update · SysEx/);assert.match(customFwscHtml,/desktop-custom-manifest/);assert.doesNotMatch(customFwscHtml,/direct-common-(?:confirm|file|review)/);
  const f=fixture({stockUpdateAvailable:false,customUpdateAvailable:false});await f.controller.ready;assert.equal(f.calls.length,0);assert.equal(f.el('desktop-custom').hidden,true);assert.equal(f.el('desktop-custom-file').disabled,true);
  await f.controller.custom.selectManifest(manifestFile(manifest()),user);await f.controller.custom.selectPackage(packageFile(new Uint8Array(rawBytes)),user);await f.controller.custom.stage(user);assert.equal(f.calls.length,0);f.controller.dispose();
});

test('native panel opens with only both passive writer status reads and never auto-connects or retries',async()=>{
  const f=fixture();await f.controller.ready;assert.deepEqual(f.calls,[{name:'get_fm1_stock_update_status',args:{}},{name:'get_fm1_custom_update_status',args:{}}]);assert.equal(f.controller.state().connected,false);assert.equal(f.timers.size,0);
  assert.equal(f.el('desktop-custom-review').disabled,true);assert.equal(f.el('desktop-custom-manifest').disabled,true);assert.equal(f.el('direct-common-confirm').disabled,true);f.controller.dispose();
});

test('trusted custom file and manifest selection snapshots bytes, uploads bounded chunks and binds a complete plain-text review',async()=>{
  const f=fixture();await f.controller.ready;await f.controller.connectMidi(user);const before=f.calls.length;
  await f.controller.custom.selectManifest(manifestFile(manifest()),synthetic);await f.controller.custom.selectPackage(packageFile(new Uint8Array(rawBytes)),synthetic);assert.equal(f.el('desktop-custom-review').disabled,true);assert.equal(f.calls.length,before);
  const bytes=new Uint8Array(rawBytes).fill(7);await f.controller.custom.selectManifest(manifestFile(manifest()),user);await f.controller.custom.selectPackage(packageFile(bytes),user);bytes.fill(9);await f.controller.custom.stage(synthetic);assert.equal(f.calls.length,before);
  f.backend.customReview=customReview({product:'FM-1 <b>diagnostics</b>'});await f.controller.custom.stage(user);
  const begin=f.calls.find(row=>row.name==='begin_fm1_custom_upload');assert.deepEqual(begin.args,{raw_bytes:rawBytes,manifest:manifest()});assert.equal(f.backend.chunks.length,10);assert.ok(f.backend.chunks.every((row,index)=>row.offset===index*65536&&row.bytes.length<=65536));assert.ok(Buffer.concat(f.backend.chunks.map(row=>row.bytes)).every(value=>value===7));
  assert.equal(f.el('desktop-custom-dialog').open,true);assert.equal(f.el('desktop-custom-confirm').disabled,false);const text=f.el('desktop-custom-review-text').textContent;
  for(const expected of ['FM-1 <b>diagnostics</b>',String(rawBytes),'623136',hash('a'),hash('b'),hash('c'),hash('d'),'FM1_FORGE_001','FM-1_015','FM-1 MIDI input','FM-1 MIDI output',opaque('6'),'2099-10-19','fixed V15 layout checked offline','Live full-flash baseline: unavailable','full flash readback is not performed','Custom hardware qualification: pending'])assert.ok(text.includes(expected),expected);
  assert.equal(Object.hasOwn(f.el('desktop-custom-review-text'),'innerHTML'),false);assert.equal(f.calls.some(row=>row.name==='start_fm1_custom_update'||row.name==='begin_fm1_stock_upload'),false);f.controller.dispose();
});

test('all file-change handlers remain usable during each deferred routine status check and retain choices after disconnect',async()=>{
  let defer=false,releaseStock,releaseCustom,releaseDevice;
  const f=fixture({handler:name=>{if(!defer)return;if(name==='get_fm1_stock_update_status')return new Promise(resolve=>{releaseStock=resolve;});if(name==='get_fm1_custom_update_status')return new Promise(resolve=>{releaseCustom=resolve;});if(name==='get_fm1_device_status')return new Promise(resolve=>{releaseDevice=resolve;});}});await f.pair();await f.controller.selectPackage(packageFile(new Uint8Array(699956)),user);
  const heading=f.el('device-heading').textContent,customSummary=f.el('desktop-custom-summary').textContent,stockSummary=f.el('direct-package-summary').textContent;
  const checkPending=()=>{for(const key of ['desktop-custom-file','desktop-custom-manifest','direct-stock-file'])assert.equal(f.el(key).disabled,false,key);for(const key of ['desktop-custom-review','desktop-custom-confirm','direct-stock-review','direct-review-confirm'])assert.equal(f.el(key).disabled,true,key);assert.equal(f.el('device-heading').textContent,heading);assert.doesNotMatch(f.el('direct-device-note').textContent,/unavailable/);assert.doesNotMatch(f.el('desktop-custom-note').textContent,/unavailable/);};
  defer=true;const pending=f.controller.refresh();checkPending();assert.equal(f.el('desktop-custom-summary').textContent,customSummary);assert.equal(f.el('direct-package-summary').textContent,stockSummary);
  releaseStock(f.backend.stock);await tick();checkPending();releaseCustom(f.backend.custom);await tick();checkPending();assert.equal(typeof releaseDevice,'function');
  f.el('desktop-custom-manifest').files=[manifestFile(manifest())];f.el('desktop-custom-manifest').onchange(user);await tick();
  f.el('desktop-custom-file').files=[{...packageFile(new Uint8Array(rawBytes).fill(9)),name:'Chosen custom during poll.fwsc'}];f.el('desktop-custom-file').onchange(user);await tick();
  f.el('direct-stock-file').files=[{...packageFile(new Uint8Array(699956)),name:'Chosen stock during poll.fwsc'}];f.el('direct-stock-file').onchange(user);await tick();checkPending();assert.match(f.el('desktop-custom-summary').textContent,/Chosen custom during poll/);assert.match(f.el('desktop-custom-summary').textContent,new RegExp(hash('c')));assert.match(f.el('direct-package-summary').textContent,/Chosen stock during poll/);
  releaseDevice(device());await pending;assert.equal(f.el('desktop-custom-review').disabled,false);assert.equal(f.el('direct-stock-review').disabled,false);assert.match(f.el('desktop-custom-summary').textContent,/Chosen custom during poll/);assert.match(f.el('direct-package-summary').textContent,/Chosen stock during poll/);
  const chosenCustom=f.el('desktop-custom-summary').textContent,chosenStock=f.el('direct-package-summary').textContent;defer=false;f.backend.device=device({connected:false,identity:null,transport:null});await f.controller.refresh();
  for(const key of ['desktop-custom-file','desktop-custom-manifest','direct-stock-file','desktop-custom-review','desktop-custom-confirm','direct-stock-review','direct-review-confirm'])assert.equal(f.el(key).disabled,true,key);assert.equal(f.el('desktop-custom-summary').textContent,chosenCustom);assert.equal(f.el('direct-package-summary').textContent,chosenStock);assert.equal(f.el('device-heading').textContent,'FM-1 disconnected');assert.equal(f.calls.some(row=>row.name==='begin_fm1_custom_upload'||row.name==='begin_fm1_stock_upload'||row.name==='start_fm1_custom_update'||row.name==='start_fm1_stock_update'),false);f.controller.dispose();
});

test('interactive reconnect and active transfer still lock file selectors and ignore file-change handlers',async()=>{
  let defer=false,release;const f=fixture({handler:name=>name==='connect_fm1_device'&&defer?new Promise(resolve=>{release=resolve;}):undefined});await f.pair();await f.controller.selectPackage(packageFile(new Uint8Array(699956)),user);
  const selectedCustom=f.el('desktop-custom-summary').textContent,selectedStock=f.el('direct-package-summary').textContent;defer=true;const reconnect=f.controller.connectMidi(user);
  for(const key of ['desktop-custom-file','desktop-custom-manifest','direct-stock-file'])assert.equal(f.el(key).disabled,true,key);assert.equal(f.controller.state().routineChecking,false);
  f.el('desktop-custom-file').files=[{...packageFile(new Uint8Array(rawBytes)),name:'Blocked custom.fwsc'}];f.el('desktop-custom-file').onchange(user);f.el('direct-stock-file').files=[{...packageFile(new Uint8Array(699956)),name:'Blocked stock.fwsc'}];f.el('direct-stock-file').onchange(user);await tick();assert.equal(f.el('desktop-custom-summary').textContent,selectedCustom);assert.equal(f.el('direct-package-summary').textContent,selectedStock);release(device());await reconnect;
  await f.controller.custom.stage(user);await f.controller.custom.confirm(user);const activeCustom=f.el('desktop-custom-summary').textContent,activeStock=f.el('direct-package-summary').textContent;
  for(const key of ['desktop-custom-file','desktop-custom-manifest','direct-stock-file','desktop-custom-review','desktop-custom-confirm','direct-stock-review','direct-review-confirm'])assert.equal(f.el(key).disabled,true,key);
  f.el('desktop-custom-manifest').files=[manifestFile(manifest({target_build_sha256:hash('a')}))];f.el('desktop-custom-manifest').onchange(user);f.el('desktop-custom-file').onchange(user);f.el('direct-stock-file').onchange(user);await tick();assert.equal(f.el('desktop-custom-summary').textContent,activeCustom);assert.equal(f.el('direct-package-summary').textContent,activeStock);assert.equal(f.calls.filter(row=>row.name==='start_fm1_custom_update').length,1);f.controller.dispose();
});

test('custom confirm is trusted, one-shot and independent of panel abort; either writer blocks all device operations',async()=>{
  const f=fixture();await f.pair();await f.controller.custom.stage(user);const heading=f.el('device-heading').textContent,before=f.calls.length;
  await f.controller.custom.confirm(synthetic);assert.equal(f.calls.length,before);await f.controller.custom.confirm(user);await f.controller.custom.confirm(user);
  assert.deepEqual(f.calls.filter(row=>row.name==='start_fm1_custom_update'),[{name:'start_fm1_custom_update',args:{review_id:opaque('5'),confirmed:true}}]);assert.equal(f.signals[f.calls.findIndex(row=>row.name==='start_fm1_custom_update')],null);
  for(const key of ['desktop-custom-file','desktop-custom-manifest','desktop-custom-review','desktop-custom-confirm','direct-stock-review','direct-stock-recovery','direct-review-confirm','direct-connect-midi','direct-disconnect'])assert.equal(f.el(key).disabled,true,key);
  const count=f.calls.length;await f.controller.connectMidi(user);await f.controller.disconnect(user);await f.controller.stage(user);await f.poll();assert.deepEqual(f.calls.slice(count).map(row=>row.name),['get_fm1_stock_update_status','get_fm1_custom_update_status']);assert.equal(f.el('device-heading').textContent,heading);assert.equal(f.el('connection-check').hidden,true);assert.equal(f.controller.state().writing,true);
  f.backend.custom=status({attempt:customAttempt('succeeded',{phase:'Reviewed build verified',progress:1,transfer_finished:true,boot_identity_verified:true,boot_build_verified:true,observed_boot_identity:'FM1_FORGE_001',observed_build_sha256:hash('c')})});await f.poll();
  assert.equal(f.controller.state().custom.operationStatus,'succeeded');assert.equal(f.controller.state().writing,false);assert.match(f.el('desktop-custom-transfer-status').textContent,/FM1_FORGE_001 identity and reviewed build verified/);assert.match(f.el('desktop-custom-transfer-status').textContent,/readback not performed/);assert.doesNotMatch(f.el('desktop-custom-transfer-status').textContent,/stock V15.*verified/);f.controller.dispose();
});

test('real custom prepared start receipt stays running until active polling and complete identity/build proof',async()=>{
  const prepared=customAttempt('prepared',{phase:'prepared',progress:null});
  const f=fixture({handler:(name,args,backend)=>{if(name==='start_fm1_custom_update'){backend.custom=status({writing:true,attempt:prepared});return {writing:true,attempt:prepared,review:null};}}});
  await f.pair();await f.controller.custom.stage(user);await f.controller.custom.confirm(user);
  assert.equal(f.controller.custom.state().attempt.state,'prepared');assert.equal(f.controller.custom.state().operationStatus,'running');assert.equal(f.controller.state().writing,true);assert.match(f.el('desktop-custom-transfer-status').textContent,/in progress/);assert.doesNotMatch(f.el('desktop-custom-note').textContent,/invalid|unavailable|incomplete/);assert.equal(f.el('direct-connect-midi').disabled,true);
  const before=f.calls.length;await f.poll();assert.deepEqual(f.calls.slice(before).map(row=>row.name),['get_fm1_stock_update_status','get_fm1_custom_update_status']);assert.equal(f.controller.custom.state().operationStatus,'running');
  f.backend.custom=status({writing:true,attempt:customAttempt('active',{progress:0.5})});await f.poll();assert.equal(f.controller.custom.state().attempt.state,'active');assert.equal(f.el('desktop-custom-progress').value,0.5);
  f.backend.custom=status({attempt:customAttempt('succeeded',{phase:'done',progress:1,transfer_finished:true,boot_identity_verified:true,boot_build_verified:true,observed_boot_identity:'FM1_FORGE_001',observed_build_sha256:hash('c')})});await f.poll();assert.equal(f.controller.custom.state().operationStatus,'succeeded');assert.equal(f.controller.state().writing,false);assert.match(f.el('desktop-custom-transfer-status').textContent,/identity and reviewed build verified/);assert.equal(f.calls.filter(row=>row.name==='start_fm1_custom_update').length,1);f.controller.dispose();
  const invalid=fixture({custom:status({writing:true,attempt:customAttempt('prepared',{phase:'unexpected'})})});await invalid.controller.ready;assert.equal(invalid.controller.custom.state().known,false);assert.equal(invalid.el('desktop-custom-confirm').disabled,true);invalid.controller.dispose();
});

test('custom terminal receipt during slow native cleanup retains locks and polling until writer release',async()=>{
  for(const terminal of ['succeeded','failed','unknown']){
    const proof=terminal==='succeeded'?{transfer_finished:true,boot_identity_verified:true,boot_build_verified:true,observed_boot_identity:'FM1_FORGE_001',observed_build_sha256:hash('c')}:{},pending=customAttempt(terminal,{...proof,phase:'cleanup pending',progress:terminal==='succeeded'?1:0.5});
    const f=fixture({custom:status({writing:true,attempt:pending})});await f.controller.ready;
    assert.equal(f.controller.state().writing,true);assert.equal(f.controller.custom.state().known,true);assert.equal(f.controller.custom.state().operationStatus,terminal==='succeeded'?'running':terminal);assert.equal(f.el('direct-connect-midi').disabled,true);assert.equal(f.el('direct-stock-review').disabled,true);assert.equal(f.el('desktop-custom-confirm').disabled,true);assert.doesNotMatch(f.el('desktop-custom-transfer-status').textContent,/Custom transfer finished/);
    const before=f.calls.length;await f.poll();assert.deepEqual(f.calls.slice(before).map(row=>row.name),['get_fm1_stock_update_status','get_fm1_custom_update_status']);assert.equal(f.timers.size,1);
    f.backend.custom=status({attempt:pending});await f.poll();assert.equal(f.controller.state().writing,false);assert.equal(f.controller.custom.state().operationStatus,terminal);assert.equal(f.timers.size,0);if(terminal==='succeeded')assert.match(f.el('desktop-custom-transfer-status').textContent,/identity and reviewed build verified/);else assert.doesNotMatch(f.el('desktop-custom-transfer-status').textContent,/Custom transfer finished/);f.controller.dispose();
  }
  const invalid=fixture({custom:status({writing:true,attempt:customAttempt('succeeded',{phase:'cleanup pending',transfer_finished:true,boot_identity_verified:true,boot_build_verified:false,observed_boot_identity:'FM1_FORGE_001',observed_build_sha256:hash('c')})})});await invalid.controller.ready;assert.equal(invalid.controller.custom.state().operationStatus,'unknown');assert.equal(invalid.controller.state().writing,true);assert.doesNotMatch(invalid.el('desktop-custom-transfer-status').textContent,/Custom transfer finished/);assert.equal(invalid.timers.size,1);invalid.controller.dispose();
});

test('custom completion requires both observed identity and exact build proof, transfer completion and no recovery latch',async()=>{
  const proof={transfer_finished:true,boot_identity_verified:true,boot_build_verified:true,observed_boot_identity:'FM1_FORGE_001',observed_build_sha256:hash('c'),progress:1};
  for(const mismatch of [{transfer_finished:false},{boot_identity_verified:false},{boot_build_verified:false},{observed_boot_identity:'FM-1_015'},{observed_build_sha256:hash('a')},{recovery_required:true}]){
    const f=fixture({custom:status({attempt:customAttempt('succeeded',{...proof,...mismatch})})});await f.controller.ready;
    assert.equal(f.controller.state().custom.operationStatus,'unknown');assert.equal(f.controller.state().custom.attempt.recovery_required,true);assert.doesNotMatch(f.el('desktop-custom-transfer-status').textContent,/Custom transfer finished/);assert.equal(f.el('direct-stock-review').disabled,true);f.controller.dispose();
  }
  const invalid=fixture({custom:status({attempt:customAttempt('succeeded',{...proof,readback_verified:true})})});await invalid.controller.ready;assert.equal(invalid.el('desktop-custom-confirm').disabled,true);assert.equal(invalid.controller.state().custom.known,false);invalid.controller.dispose();
});

test('stock and custom writers block one another in both directions, including unresolved original jobs',async()=>{
  for(const original of ['stock','custom']){
    for(const state of ['active','unknown']){
      const f=fixture({[original]:status({writing:state==='active',attempt:original==='stock'?stockAttempt(state):customAttempt(state)})});await f.controller.ready;
      if(state==='unknown')await f.controller.connectMidi(user);
      await f.controller.custom.selectManifest(manifestFile(manifest()),user);await f.controller.custom.selectPackage(packageFile(new Uint8Array(rawBytes)),user);await f.controller.custom.stage(user);
      await f.controller.selectPackage(packageFile(new Uint8Array(699956)),user);await f.controller.stage(user);await f.controller.confirm(user);
      assert.equal(f.calls.some(row=>row.name==='begin_fm1_custom_upload'||row.name==='begin_fm1_stock_upload'||row.name==='start_fm1_custom_update'||row.name==='start_fm1_stock_update'),false,original+' '+state);
      if(state==='active'){const before=f.calls.length;await f.controller.refresh();assert.deepEqual(f.calls.slice(before).map(row=>row.name),['get_fm1_stock_update_status','get_fm1_custom_update_status']);assert.equal(f.el('direct-connect-midi').disabled,true);}
      f.controller.dispose();
    }
  }
});

test('original custom recovery needs explicit OTA stock connection and reuses the saved job without file upload',async()=>{
  const f=fixture({custom:status({attempt:customAttempt('unknown')})});await f.controller.ready;assert.equal(f.el('desktop-custom-recovery').hidden,false);assert.equal(f.el('desktop-custom-recovery').disabled,true);
  await f.controller.custom.stage(user,{resume:true});await f.controller.connectMidi(user);await f.controller.custom.stage(user,{resume:true});assert.equal(f.calls.some(row=>row.name==='review_fm1_custom_recovery'),false);
  f.backend.device=device({loader:true,identity:'ota-FM-1_015'});await f.controller.connectMidi(user);await f.controller.custom.stage(user,{resume:true});assert.deepEqual(f.calls.at(-1),{name:'review_fm1_custom_recovery',args:{job_id:opaque('6')}});assert.equal(f.el('desktop-custom-confirm').textContent,'Resume original custom transfer');
  await f.controller.custom.confirm(user);assert.equal(f.controller.state().custom.writing,true);assert.equal(f.calls.some(row=>row.name==='begin_fm1_custom_upload'||row.name==='append_fm1_custom_upload'),false);f.controller.dispose();
});

test('custom reviews expire or invalidate on selected files, connection changes and cancel; neither path can replay them',async t=>{
  const f=fixture();await f.pair();await f.controller.custom.stage(user);f.controller.custom.cancel();await f.controller.custom.confirm(user);assert.equal(f.el('desktop-custom-dialog').open,false);
  await f.controller.custom.stage(user);await f.controller.custom.selectManifest(manifestFile(manifest()),user);assert.equal(f.controller.custom.state().review,null);await f.controller.custom.confirm(user);
  await f.controller.custom.stage(user);f.backend.device=device({identity:'another-device'});await f.controller.refresh();assert.equal(f.controller.custom.state().review,null);assert.equal(f.el('desktop-custom-dialog').open,false);
  f.backend.device=device();await f.controller.connectMidi(user);await f.controller.custom.stage(user);t.mock.method(Date,'now',()=>Date.parse('2100-01-01T00:00:00.000Z'));f.controller.paint();assert.equal(f.el('desktop-custom-confirm').disabled,true);await f.controller.custom.confirm(user);assert.equal(f.controller.custom.state().review,null);
  assert.equal(f.calls.some(row=>row.name==='start_fm1_custom_update'),false);f.controller.dispose();
});

test('custom file and manifest bounds reject invalid selections before upload and never read browser devices',async()=>{
  const invalidFiles=[{name:'wrong.bin',size:rawBytes,arrayBuffer:async()=>new ArrayBuffer(rawBytes)},{name:'huge.fwsc',size:2*1024*1024+1,arrayBuffer:()=>assert.fail('Oversized files must not be read')}];
  for(const file of invalidFiles){const f=fixture();await f.controller.ready;await f.controller.connectMidi(user);await assert.rejects(f.controller.custom.selectPackage(file,user));assert.equal(f.calls.length,3);f.controller.dispose();}
  for(const file of [{name:'huge.json',size:8193,arrayBuffer:()=>assert.fail('Oversized manifests must not be read')},manifestFile({schemaVersion:1}),manifestFile(manifest({expected_boot_identity:'FM-1_015'})),manifestFile(manifest({hardware_qualified:true}))]){
    const f=fixture();await f.controller.ready;await f.controller.connectMidi(user);await assert.rejects(f.controller.custom.selectManifest(file,user));assert.equal(f.calls.length,3);f.controller.dispose();
  }
  const mismatch=fixture();await mismatch.controller.ready;await mismatch.controller.connectMidi(user);await mismatch.controller.custom.selectManifest(manifestFile(manifest()),user);await assert.rejects(mismatch.controller.custom.selectPackage(packageFile(new Uint8Array(rawBytes-1)),user),/does not match/);assert.equal(mismatch.el('desktop-custom-review').disabled,true);mismatch.controller.dispose();
});

test('custom upload acknowledgement and manifest/hash bindings fail closed without retry or confirmation',async()=>{
  for(const variant of ['limit','offset','build','logical','package','kind']){
    const f=fixture({handler:name=>variant==='limit'&&name==='begin_fm1_custom_upload'?{upload_id:opaque('7'),max_chunk_bytes:65537}:variant==='offset'&&name==='append_fm1_custom_upload'?{upload_id:opaque('7'),received_bytes:1}:undefined});await f.pair();
    if(variant==='build')f.backend.customReview.target_build_sha256=hash('a');if(variant==='logical')f.backend.customReview.logical_sha256=hash('a');if(variant==='package')f.backend.customReview.sha256=hash('b');if(variant==='kind')f.backend.customReview.kind='stock';
    await assert.rejects(f.controller.custom.stage(user));assert.equal(f.el('desktop-custom-dialog').open,false);await f.controller.custom.confirm(user);assert.equal(f.calls.some(row=>row.name==='start_fm1_custom_update'),false);assert.equal(f.calls.filter(row=>row.name==='append_fm1_custom_upload').length,variant==='limit'?0:variant==='offset'?1:10);f.controller.dispose();
  }
});

test('unknown native start outcome is not retried and cannot switch target job or build',async()=>{
  for(const mismatch of [{job_id:opaque('8')},{target_build_sha256:hash('a')}]){
    const f=fixture({handler:name=>name==='start_fm1_custom_update'?{writing:true,attempt:customAttempt('active',mismatch),review:null}:undefined});await f.pair();await f.controller.custom.stage(user);await assert.rejects(f.controller.custom.confirm(user),/original job/);
    assert.equal(f.controller.custom.state().operationStatus,'unknown');assert.equal(f.controller.custom.state().attempt.job_id,opaque('6'));assert.equal(f.controller.custom.state().attempt.target_build_sha256,hash('c'));assert.equal(f.timers.size,0);await f.controller.custom.confirm(user);assert.equal(f.calls.filter(row=>row.name==='start_fm1_custom_update').length,1);f.controller.dispose();
  }
});

test('hidden, teardown and reopened panels observe the independent custom job without disconnect or write replay',async()=>{
  let release;const f=fixture({handler:(name,args,backend)=>name==='start_fm1_custom_update'?new Promise(resolve=>{release=()=>{backend.custom=status({writing:true,attempt:customAttempt()});resolve({writing:true,attempt:backend.custom.attempt,review:null});};}):undefined});await f.pair();await f.controller.custom.stage(user);
  const pending=f.controller.custom.confirm(user);await f.controller.custom.confirm(user);assert.equal(f.controller.state().writing,true);f.abort.abort();release();await pending;assert.equal(f.timers.size,0);assert.equal(f.signals.at(-1),null);assert.equal(f.calls.some(row=>row.name==='disconnect_fm1_device'),false);assert.equal(f.calls.filter(row=>row.name==='start_fm1_custom_update').length,1);
  const reopened=fixture({custom:f.backend.custom});await reopened.controller.ready;assert.equal(reopened.controller.state().custom.attempt.job_id,opaque('6'));assert.equal(reopened.timers.size,1);assert.deepEqual(reopened.calls.map(row=>row.name),['get_fm1_stock_update_status','get_fm1_custom_update_status']);
  reopened.runtime.document.hidden=true;reopened.documentEvents.get('visibilitychange')();assert.equal(reopened.timers.size,0);const count=reopened.calls.length;reopened.runtime.document.hidden=false;reopened.documentEvents.get('visibilitychange')();assert.equal(reopened.calls.length,count);assert.equal(reopened.timers.size,1);await reopened.poll();assert.ok(reopened.calls.every(row=>row.name==='get_fm1_stock_update_status'||row.name==='get_fm1_custom_update_status'));reopened.controller.dispose();
});

test('writer status failures retain the original custom job and pause all automatic polling until explicit refresh',async()=>{
  let fail=false;const f=fixture({custom:status({writing:true,attempt:customAttempt()}),handler:name=>{if(fail&&name==='get_fm1_custom_update_status')throw new Error('Custom status unavailable');}});await f.controller.ready;fail=true;
  await assert.rejects(f.controller.refreshWriter(),/unavailable/);assert.equal(f.controller.state().writing,true);assert.equal(f.controller.custom.state().attempt.job_id,opaque('6'));assert.equal(f.timers.size,0);assert.equal(f.el('direct-disconnect').disabled,true);
  fail=false;await f.controller.refreshWriter();assert.equal(f.timers.size,1);assert.ok(f.calls.every(row=>row.name==='get_fm1_stock_update_status'||row.name==='get_fm1_custom_update_status'));f.controller.dispose();
});

test('independent delayed file reads keep the matching pair while a replaced late read cannot overwrite its snapshot',async()=>{
  const f=fixture();await f.controller.ready;await f.controller.connectMidi(user);let release;
  const selected=manifestFile(manifest()),pending=f.controller.custom.selectManifest({...selected,arrayBuffer:()=>new Promise(resolve=>{release=resolve;})},user);
  await f.controller.custom.selectPackage(packageFile(new Uint8Array(rawBytes).fill(7)),user);assert.equal(f.el('desktop-custom-review').disabled,true);release(await selected.arrayBuffer());await pending;assert.equal(f.el('desktop-custom-review').disabled,false);
  let releaseOld;const old=f.controller.custom.selectPackage({...packageFile(new Uint8Array(rawBytes).fill(1)),arrayBuffer:()=>new Promise(resolve=>{releaseOld=resolve;})},user);
  await f.controller.custom.selectPackage(packageFile(new Uint8Array(rawBytes).fill(7)),user);releaseOld(new Uint8Array(rawBytes).fill(1).buffer);await old;await f.controller.custom.stage(user);assert.ok(Buffer.concat(f.backend.chunks.map(row=>row.bytes)).every(value=>value===7));f.controller.dispose();
});

test('reviewing either package clears the opposite dialog and server review withdrawal prevents stale custom confirmation',async()=>{
  const f=fixture();await f.pair();await f.controller.selectPackage(packageFile(new Uint8Array(699956)),user);await f.controller.stage(user);assert.equal(f.el('direct-stock-dialog').open,true);
  await f.controller.custom.stage(user);assert.equal(f.el('direct-stock-dialog').open,false);assert.equal(f.controller.state().review,null);assert.equal(f.el('desktop-custom-dialog').open,true);
  await f.controller.stage(user);assert.equal(f.el('desktop-custom-dialog').open,false);assert.equal(f.controller.custom.state().review,null);
  await f.controller.custom.stage(user);f.backend.custom={...f.backend.custom,review:null};await f.controller.refreshWriter();assert.equal(f.controller.custom.state().review,null);await f.controller.custom.confirm(user);assert.equal(f.calls.some(row=>row.name==='start_fm1_custom_update'||row.name==='start_fm1_stock_update'),false);f.controller.dispose();
});

test('tracker selection and review bind the closed CDC profile without changing diagnostics',async()=>{
  const f=fixture({handler:(name,args,backend)=>{
    if(name==='start_fm1_custom_update'){backend.custom=status({writing:true,attempt:trackerAttempt('active')});return {writing:true,attempt:backend.custom.attempt,review:null};}
  }});
  await f.controller.ready;await f.controller.connectMidi(user);f.backend.customReview=trackerReview();
  await f.controller.custom.selectManifest(manifestFile(trackerManifest()),user);
  await f.controller.custom.selectPackage(packageFile(new Uint8Array(rawBytes)),user);
  assert.match(f.el('desktop-custom-summary').textContent,/Boot verification: CDC serial/);
  await f.controller.custom.stage(user);
  const text=f.el('desktop-custom-review-text').textContent;
  assert.match(text,/Profile: ProTracker/);assert.match(text,/CDC serial \(FWINFO nonce and exact build identity\)/);
  assert.match(text,/Expected boot identity: MOD-EDITOR\/1/);
  await f.controller.custom.confirm(user);
  assert.equal(f.controller.custom.state().attempt.profile,'protracker');
  assert.equal(f.controller.custom.state().attempt.expected_boot_identity,'MOD-EDITOR/1');
  f.backend.custom=status({attempt:trackerAttempt('succeeded',{transfer_finished:true,boot_identity_verified:true,boot_build_verified:true,
    observed_boot_identity:'MOD-EDITOR/1',observed_build_sha256:hash('c'),recovery_required:false,progress:1})});
  await f.poll();assert.equal(f.controller.custom.state().operationStatus,'succeeded');
  assert.match(f.el('desktop-custom-transfer-status').textContent,/MOD-EDITOR\/1 CDC identity and reviewed build verified/);
  assert.equal(f.el('desktop-custom-verify').hidden,true);f.controller.dispose();
});

test('tracker manifests and reviews reject mixed identity, family or verification tuples before install',async()=>{
  for(const change of [{family:8},{family:'9'},{expected_boot_identity:'FM1_FORGE_001'},
    {profile:'tracker'},{verification_transport:'midi'}]){
    const f=fixture();await f.controller.ready;await f.controller.connectMidi(user);
    await assert.rejects(f.controller.custom.selectManifest(manifestFile(trackerManifest(change)),user));
    assert.equal(f.calls.some(row=>row.name==='begin_fm1_custom_upload'),false);f.controller.dispose();
  }
  for(const reply of [customReview(),trackerReview({verification_transport:'midi'}),trackerReview({family:8})]){
    const f=fixture();await f.controller.ready;await f.controller.connectMidi(user);f.backend.customReview=reply;
    await f.controller.custom.selectManifest(manifestFile(trackerManifest()),user);
    await f.controller.custom.selectPackage(packageFile(new Uint8Array(rawBytes)),user);
    await assert.rejects(f.controller.custom.stage(user));assert.equal(f.el('desktop-custom-dialog').open,false);
    await f.controller.custom.confirm(user);assert.equal(f.calls.some(row=>row.name==='start_fm1_custom_update'),false);f.controller.dispose();
  }
});

test('completed tracker transfer offers explicit CDC verification without a MIDI connection or resend',async()=>{
  const original=trackerAttempt('unknown',{phase:'Awaiting tracker CDC proof',transfer_finished:true});
  let release;
  const f=fixture({custom:status({attempt:original}),handler:(name,args,backend)=>{
    if(name==='verify_fm1_custom_boot')return new Promise(resolve=>{release=()=>{backend.custom=status({writing:true,attempt:trackerAttempt('active',{phase:'Verifying CDC boot',transfer_finished:true})});resolve({writing:true,attempt:backend.custom.attempt,review:null});};});
  }});
  await f.controller.ready;
  assert.match(customFwscHtml,/Verify tracker boot/);assert.equal(f.controller.state().connected,false);
  assert.equal(f.el('desktop-custom-verify').hidden,false);assert.equal(f.el('desktop-custom-verify').disabled,false);
  assert.equal(f.el('desktop-custom-recovery').hidden,true);assert.match(f.el('desktop-custom-note').textContent,/no MIDI connection or firmware resend/);
  await f.controller.custom.verifyBoot(synthetic);assert.equal(f.calls.filter(row=>row.name==='verify_fm1_custom_boot').length,0);
  const pending=f.controller.custom.verifyBoot(user);await f.controller.custom.verifyBoot(user);
  assert.equal(f.controller.custom.isWriting(),true);assert.equal(f.el('desktop-custom-verify').disabled,true);
  release();await pending;assert.equal(f.calls.filter(row=>row.name==='verify_fm1_custom_boot').length,1);
  assert.deepEqual(f.calls.find(row=>row.name==='verify_fm1_custom_boot').args,{job_id:opaque('6')});
  assert.equal(f.signals[f.calls.findIndex(row=>row.name==='verify_fm1_custom_boot')],null);
  assert.equal(f.calls.some(row=>/^(?:connect_fm1_device|review_fm1_custom_recovery|start_fm1_custom_update|begin_fm1_custom_upload)$/.test(row.name)),false);
  assert.equal(f.timers.size,1);
  f.backend.custom=status({attempt:trackerAttempt('succeeded',{phase:'CDC build verified',transfer_finished:true,boot_identity_verified:true,
    boot_build_verified:true,observed_boot_identity:'MOD-EDITOR/1',observed_build_sha256:hash('c'),progress:1,recovery_required:false})});
  await f.poll();assert.equal(f.controller.custom.state().operationStatus,'succeeded');
  assert.match(f.el('desktop-custom-transfer-status').textContent,/full flash readback not performed/);f.controller.dispose();
});

test('CDC verify cannot switch the original job, target build or profile and never retries automatically',async()=>{
  for(const wrong of [{job_id:opaque('8')},{target_build_sha256:hash('d')},
    {profile:'forge-diag',verification_transport:'midi',expected_boot_identity:'FM1_FORGE_001'}]){
    const f=fixture({custom:status({attempt:trackerAttempt('unknown',{transfer_finished:true})}),handler:name=>
      name==='verify_fm1_custom_boot'?{writing:true,attempt:trackerAttempt('active',{transfer_finished:true,...wrong}),review:null}:undefined});
    await f.controller.ready;await assert.rejects(f.controller.custom.verifyBoot(user),/original|profile/);
    const result=f.controller.custom.state();assert.equal(result.operationStatus,'unknown');
    assert.equal(result.attempt.job_id,opaque('6'));assert.equal(result.attempt.target_build_sha256,hash('c'));
    assert.equal(result.attempt.profile,'protracker');assert.equal(result.attempt.transfer_finished,true);
    await f.controller.custom.verifyBoot(user);assert.equal(f.calls.filter(row=>row.name==='verify_fm1_custom_boot').length,1);
    assert.equal(f.calls.some(row=>row.name==='start_fm1_custom_update'),false);f.controller.dispose();
  }
});

test('only completed unresolved tracker receipts enable CDC verify; mismatched boot proof stays unresolved',async()=>{
  for(const attempt of [customAttempt('unknown',{transfer_finished:true}),trackerAttempt('unknown',{transfer_finished:false})]){
    const f=fixture({custom:status({attempt})});await f.controller.ready;
    assert.equal(f.el('desktop-custom-verify').hidden,true);await f.controller.custom.verifyBoot(user);
    assert.equal(f.calls.some(row=>row.name==='verify_fm1_custom_boot'),false);f.controller.dispose();
  }
  const f=fixture({custom:status({attempt:trackerAttempt('succeeded',{transfer_finished:true,boot_identity_verified:true,boot_build_verified:true,
    observed_boot_identity:'FM1_FORGE_001',observed_build_sha256:hash('c'),recovery_required:false})})});
  await f.controller.ready;assert.equal(f.controller.custom.state().operationStatus,'unknown');
  assert.equal(f.el('desktop-custom-verify').hidden,false);assert.equal(f.el('desktop-custom-recovery').hidden,true);
  assert.doesNotMatch(f.el('desktop-custom-transfer-status').textContent,/Custom transfer finished/);f.controller.dispose();
});

test('failed tracker verification preserves the job; successful refresh clears its stale notice before an explicit retry',async()=>{
  let calls=0;
  const original=trackerAttempt('unknown',{transfer_finished:true,phase:'Awaiting tracker CDC proof'});
  const f=fixture({custom:status({attempt:original}),handler:(name,_args,backend)=>{
    if(name!=='verify_fm1_custom_boot')return;
    if(++calls===1)throw new Error('Tracker CDC is temporarily busy.');
    backend.custom=status({writing:true,attempt:trackerAttempt('unknown',{transfer_finished:true,phase:'Verifying tracker boot'})});
    return {writing:true,attempt:backend.custom.attempt,review:null};
  }});
  await f.controller.ready;await assert.rejects(f.controller.custom.verifyBoot(user),/temporarily busy/);
  assert.equal(f.controller.custom.state().attempt.job_id,original.job_id);
  assert.equal(f.controller.custom.state().attempt.target_build_sha256,original.target_build_sha256);
  assert.equal(f.controller.custom.state().attempt.state,'unknown');assert.equal(f.controller.custom.state().known,false);
  assert.match(f.el('desktop-custom-note').textContent,/temporarily busy/);
  assert.equal(f.el('desktop-custom-verify').disabled,true);assert.equal(f.timers.size,0);
  await f.controller.refresh();assert.equal(f.controller.custom.state().known,true);
  assert.doesNotMatch(f.el('desktop-custom-note').textContent,/temporarily busy/);
  assert.match(f.el('desktop-custom-note').textContent,/no MIDI connection or firmware resend/);
  assert.equal(f.el('desktop-custom-verify').disabled,false);assert.equal(calls,1);
  await f.controller.custom.verifyBoot(user);assert.equal(calls,2);assert.equal(f.controller.custom.state().operationStatus,'unknown');
  f.backend.custom=status({attempt:trackerAttempt('unknown',{transfer_finished:true,error_code:'boot_build_mismatch'})});
  await f.poll();assert.equal(f.controller.custom.state().attempt.state,'unknown');
  assert.equal(f.el('desktop-custom-verify').disabled,false);assert.equal(calls,2);
  assert.equal(f.calls.some(row=>row.name==='connect_fm1_device'||row.name==='start_fm1_custom_update'),false);
  f.controller.dispose();
});

function generatedDesktopMount(script){
  const window={},context=vm.createContext({window,AbortController,TextEncoder,TextDecoder,ArrayBuffer,Uint8Array,
    URL,console,crypto:globalThis.crypto,setTimeout,clearTimeout,queueMicrotask});
  vm.runInContext(script,context,{timeout:10000});
  assert.equal(typeof window.FM1DesktopDevicesUI?.mount,'function','delivered script must expose the desktop controller');
  return window.FM1DesktopDevicesUI.mount;
}
async function generatedPackageManifest(){
  if(process.env.FM1_CUSTOM_MANIFEST_JSON)return JSON.parse(await fs.readFile(process.env.FM1_CUSTOM_MANIFEST_JSON,'utf8'));
  // Metadata captured from the actual tracker V15 package that exposed the stale
  // generated-script bug. Full preservation proof remains the native validator's job.
  return trackerManifest({package_sha256:'beeb2b58a698223a47916cd7cd3763b60eb60b74b3db4af99df1329676dc6940',
    logical_sha256:'6e129e46c7862b4eda2a8974a72202878bf6ebb3d11eeda59a996137f4a55ab9',
    target_build_sha256:'251763e12335d417fc6b3a370a9600f268c9d26b928be26a74be57d3575eb931',
    application_sha256:'9ef399c21da34a71e83dfc99831b75c3b65beef5988500635ed42369c5f1e1fc',application_bytes:511760});
}
for(const mode of ['source','generated'])test(mode+' desktop controller accepts the generated tracker package manifest and binds CDC review',async()=>{
  const selected=await generatedPackageManifest(),mount=mode==='source'?mountDesktopDevicesUi:generatedDesktopMount(MCP_APPS_SCRIPT);
  const f=fixture({mount});
  try{
    await f.controller.ready;await f.controller.connectMidi(user);
    await f.controller.custom.selectManifest(manifestFile(selected),user);
    await f.controller.custom.selectPackage(packageFile(new Uint8Array(selected.raw_bytes)),user);
    f.backend.customReview=trackerReview({sha256:selected.package_sha256,logical_sha256:selected.logical_sha256,
      target_build_sha256:selected.target_build_sha256,raw_bytes:selected.raw_bytes,logical_bytes:selected.logical_bytes});
    assert.equal(f.el('desktop-custom-review').disabled,false);
    await f.controller.custom.stage(user);
    assert.equal(f.el('desktop-custom-dialog').open,true);assert.equal(f.el('desktop-custom-confirm').disabled,false);
    assert.match(f.el('desktop-custom-review-text').textContent,/CDC serial/);
    assert.ok(f.el('desktop-custom-review-text').textContent.includes(selected.target_build_sha256));
    assert.deepEqual(f.backend.manifest,selected);
    assert.equal(f.calls.some(row=>row.name==='start_fm1_custom_update'),false);
  }finally{f.controller.dispose();}
});
test('delivered native panel controller accepts the exact generated tracker manifest',{
  skip:!process.env.FM1_DELIVERED_PANEL_HTML,
},async()=>{
  const html=await fs.readFile(process.env.FM1_DELIVERED_PANEL_HTML,'utf8');
  const script=/<script>([\s\S]*?)<\/script>/.exec(html)?.[1];assert.ok(script,'native panel must deliver its controller script');
  const f=fixture({mount:generatedDesktopMount(script)});
  try{
    await f.controller.ready;await f.controller.connectMidi(user);
    const selected=await generatedPackageManifest();
    await f.controller.custom.selectManifest(manifestFile(selected),user);
    await f.controller.custom.selectPackage(packageFile(new Uint8Array(selected.raw_bytes)),user);
    assert.equal(f.el('desktop-custom-review').disabled,false);
    assert.ok(f.el('desktop-custom-summary').textContent.includes(selected.target_build_sha256));
  }finally{f.controller.dispose();}
});
