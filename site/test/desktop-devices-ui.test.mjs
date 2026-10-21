import test from 'node:test';
import assert from 'node:assert/strict';
import {mountDesktopDevicesUi} from '../lib/fm1-desktop-devices-ui.mjs';

const user={isTrusted:true},synthetic={isTrusted:false},all=['stock-midi','firmware-midi','serial'];
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const disconnected=(supportedTransports=all)=>({connected:false,transport:null,identity:null,installationAvailable:false,supportedTransports});
const connected=transport=>({connected:true,transport,identity:transport==='stock-midi'?'FM-1_015':transport==='firmware-midi'?'FM1_FORGE_001':'FM1DIAG/1 MOD-EDITOR/1 RAM-TRANSFER UBOOT=SERIAL COMMIT=BLOCKED',...(transport==='serial'?{profile:'MOD-EDITOR/1'}:{}),loader:false,installationAvailable:false,supportedTransports:all});
function fixture({supportedTransports=all,stockUpdateAvailable=false,desktopPlatform='win32',handler}={}){
  const nodes=new Map(),calls=[],signals=[],timers=new Map(),events=new Map(),documentEvents=new Map(),changes=[];let sequence=0;
  const el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,hidden:false,className:'',onclick:null,onchange:null,open:false,showModal(){this.open=true;},close(){this.open=false;},addEventListener(){},removeEventListener(){},removeAttribute(name){delete this[name];}});return nodes.get(id);};
  const forbidden=()=>assert.fail('Desktop controls must not invoke browser device APIs');
  const runtime={navigator:{requestMIDIAccess:forbidden,serial:{requestPort:forbidden},usb:{requestDevice:forbidden}},document:{hidden:false,addEventListener:(name,fn)=>documentEvents.set(name,fn),removeEventListener:name=>documentEvents.delete(name)},
    addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  const abort=new AbortController(),call=async(name,args,signal)=>{calls.push({name,args});signals.push(signal);return handler?handler(name,args):name==='connect_fm1_device'?connected(args.transport):disconnected();};
  const controller=mountDesktopDevicesUi({el,call,runtime,signal:abort.signal,supportedTransports,stockUpdateAvailable,desktopPlatform,onChange:value=>changes.push(value)});
  return {el,nodes,calls,signals,timers,events,documentEvents,changes,controller,runtime,abort,async poll(){const entry=timers.entries().next().value;assert.ok(entry,'one status timer expected');timers.delete(entry[0]);entry[1].fn();await tick();}};
}

test('mount is passive, missing capabilities fail closed and every firmware write control remains disabled',async()=>{
  const f=fixture({supportedTransports:[]});await f.controller.ready;
  assert.equal(f.calls.length,0);assert.equal(f.timers.size,0);assert.equal(f.el('device-heading').textContent,'FM-1 disconnected');
  for(const id of ['direct-connect-midi','direct-connect-common','direct-connect-serial','direct-disconnect','direct-stock-file','direct-stock-review','direct-stock-recovery','direct-review-confirm','direct-common-manifest','direct-common-file','direct-common-review','direct-common-confirm','install-diagnostics','stock-update'])assert.equal(f.el(id).disabled,true,id);
  await f.controller.connectMidi(user);assert.equal(f.calls.length,0);assert.match(f.el('direct-device-note').textContent,/does not support stock MIDI/);
  await f.controller.refresh();assert.deepEqual(f.calls,[{name:'get_fm1_device_status',args:{}}]);assert.equal(f.el('direct-connect-midi').disabled,false);assert.equal(f.el('direct-stock-review').disabled,true);f.controller.dispose();
});

test('each trusted connect button calls its fixed local tool and never uses browser permissions',async()=>{
  for(const [transport,method] of [['stock-midi','connectMidi'],['firmware-midi','connectCommon'],['serial','connectSerial']]){
    const f=fixture();await f.controller[method](synthetic);assert.equal(f.calls.length,0);
    await f.controller[method](user);assert.deepEqual(f.calls,[{name:'connect_fm1_device',args:{transport}}]);assert.equal(f.controller.state().connected,true);assert.equal(f.controller.state().installationAvailable,false);
    assert.match(f.el('device-heading').textContent,/FM-1 via/);assert.equal(f.el('connection-label').textContent,'Device connected');assert.equal(f.timers.size,1);
    for(const id of ['direct-stock-review','direct-review-confirm','direct-common-review','direct-common-confirm']){assert.equal(f.el(id).disabled,true);f.el(id).onclick(user);}
    assert.equal(f.calls.length,1);f.controller.dispose();assert.equal(f.timers.size,0);
  }
});

test('refresh retains confirmed text, shows only the small circle, and updates on a fresh disconnect result',async()=>{
  let release;const f=fixture({handler:(name,args)=>name==='connect_fm1_device'?connected(args.transport):new Promise(resolve=>{release=resolve;})});
  await f.controller.connectMidi(user);const heading=f.el('device-heading').textContent,summary=f.el('device-summary').textContent,pending=f.controller.refresh();
  assert.equal(f.el('device-heading').textContent,heading);assert.equal(f.el('device-summary').textContent,summary);assert.equal(f.el('connection-check').hidden,false);assert.equal(f.el('direct-disconnect').disabled,true);
  release(disconnected());await pending;assert.equal(f.el('connection-check').hidden,true);assert.equal(f.el('device-heading').textContent,'FM-1 disconnected');assert.equal(f.timers.size,0);assert.deepEqual(f.calls.map(row=>row.name),['connect_fm1_device','get_fm1_device_status']);f.controller.dispose();
});

test('visible polling uses read-only status after explicit connection and pauses while hidden',async()=>{
  const f=fixture({handler:(name,args)=>name==='connect_fm1_device'?connected(args.transport):connected('stock-midi')});
  await f.controller.connectMidi(user);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].ms,3000);await f.poll();assert.equal(f.calls.at(-1).name,'get_fm1_device_status');assert.equal(f.timers.size,1);
  f.runtime.document.hidden=true;f.documentEvents.get('visibilitychange')();assert.equal(f.timers.size,0);assert.equal(f.el('connection-check').hidden,true);
  const count=f.calls.length;f.runtime.document.hidden=false;f.documentEvents.get('visibilitychange')();assert.equal(f.calls.length,count);assert.equal(f.timers.size,1);f.controller.dispose();
});

test('failed status retains the last confirmed identity and stops automatic retries until explicit refresh',async()=>{
  let fail=true;const f=fixture({handler:(name,args)=>{if(name==='connect_fm1_device')return connected(args.transport);if(fail)throw new Error('Native identity reply timed out');return connected('stock-midi');}});
  await f.controller.connectMidi(user);const heading=f.el('device-heading').textContent;await assert.rejects(f.controller.refresh(),/timed out/);
  assert.equal(f.el('device-heading').textContent,heading);assert.equal(f.el('connection-check').hidden,true);assert.equal(f.timers.size,0);assert.match(f.el('direct-device-note').textContent,/Last confirmed identity retained/);
  fail=false;await f.controller.refresh();assert.equal(f.timers.size,1);assert.equal(f.calls.filter(row=>row.name==='connect_fm1_device').length,1);f.controller.dispose();
});

test('native capability subsets disable unsupported connection modes without changing selected firmware',async()=>{
  const f=fixture({supportedTransports:['stock-midi'],handler:(name,args)=>({...connected(args.transport),supportedTransports:['stock-midi']})});
  assert.equal(f.el('direct-connect-midi').disabled,false);assert.equal(f.el('direct-connect-common').disabled,true);assert.equal(f.el('direct-connect-serial').disabled,true);
  await f.controller.connectSerial(user);await f.controller.connectCommon(user);assert.equal(f.calls.length,0);await f.controller.connectMidi(user);assert.equal(f.calls.length,1);assert.match(f.el('device-heading').textContent,/FM-1_015/);f.controller.dispose();
});

test('invalid native replies cannot claim connection or enable installation',async()=>{
  const bad=[{...connected('stock-midi'),installationAvailable:true},{...connected('stock-midi'),identity:''},{...connected('stock-midi'),transport:'firmware-midi'},{...connected('stock-midi'),identity:'invalid'+String.fromCharCode(10)},{...connected('stock-midi'),supportedTransports:['stock-midi','stock-midi']}];
  for(const reply of bad){const f=fixture({handler:()=>reply});await assert.rejects(f.controller.connectMidi(user));assert.equal(f.controller.state().connected,false);assert.equal(f.controller.state().installationAvailable,false);assert.equal(f.timers.size,0);assert.equal(f.el('direct-review-confirm').disabled,true);f.controller.dispose();}
});

test('disconnect requires a trusted action and reports the new state without device writes',async()=>{
  const f=fixture();await f.controller.disconnect(user);await f.controller.connectMidi(user);await f.controller.disconnect(synthetic);assert.equal(f.calls.length,1);
  await f.controller.disconnect(user);assert.deepEqual(f.calls.at(-1),{name:'disconnect_fm1_device',args:{}});assert.equal(f.controller.state().connected,false);assert.equal(f.timers.size,0);f.controller.dispose();
});

test('teardown drops late replies, clears timers and does not issue implicit disconnect or reconnect tools',async()=>{
  let release;const f=fixture({handler:()=>new Promise(resolve=>{release=resolve;})}),pending=f.controller.connectMidi(user),before=f.el('device-heading').textContent;
  f.abort.abort();release(connected('stock-midi'));await pending;assert.equal(f.el('device-heading').textContent,before);assert.equal(f.controller.state().connected,false);assert.equal(f.timers.size,0);assert.deepEqual(f.calls.map(row=>row.name),['connect_fm1_device']);assert.equal(f.documentEvents.size,0);assert.equal(f.events.size,0);
});

test('native errors are bounded plain text and a disconnected response clears a stale identity',async()=>{
  const f=fixture({handler:(name,args)=>name==='connect_fm1_device'?connected(args.transport):({...disconnected(),lastError:{code:'disconnected',message:'USB removed'+String.fromCharCode(0,10,0x202e)+'x'.repeat(1000)}})});
  await f.controller.connectMidi(user);await f.controller.refresh();assert.equal(f.controller.state().identity,null);assert.equal(f.el('device-heading').textContent,'FM-1 disconnected');assert.ok(f.el('direct-device-note').textContent.length<=256);assert.equal([...f.el('direct-device-note').textContent].some(character=>character.codePointAt(0)<32||character.codePointAt(0)===0x202e),false);f.controller.dispose();
});

const packageBytes=699956;
const reviewed=overrides=>({review_id:'1'.repeat(32),job_id:'2'.repeat(32),operation:'install',product:'FM-1_015',sha256:'3'.repeat(64),raw_bytes:packageBytes,logical_bytes:589824,input_name:'FM-1 MIDI input',output_name:'FM-1 MIDI output',identity:'FM-1_015',expires_at:'2099-10-19T00:00:00.000Z',...overrides});
const receipt=(state='active',overrides={})=>({job_id:'2'.repeat(32),state,phase:'Serving package',progress:0.25,transfer_finished:false,boot_identity_verified:false,readback_verified:false,recovery_required:state==='unknown',...overrides});
const stockStatus=overrides=>({supported:true,writing:false,attempt:null,review:null,...overrides});
const fileFor=bytes=>({name:'Official V15.fwsc',size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer});
function stockFixture(options={}){
  const backend={status:options.status??stockStatus(),device:connected('stock-midi'),chunks:[],review:reviewed(options.review),...options.backend};
  const f=fixture({stockUpdateAvailable:true,handler:async(name,args)=>{
    if(options.handler){const result=await options.handler(name,args,backend);if(result!==undefined)return result;}
    if(name==='get_fm1_stock_update_status')return backend.status;
    if(name==='connect_fm1_device')return {...backend.device,transport:args.transport};
    if(name==='get_fm1_device_status')return backend.device;
    if(name==='disconnect_fm1_device'){backend.device=disconnected();return backend.device;}
    if(name==='begin_fm1_stock_upload'){backend.chunks=[];return {upload_id:'4'.repeat(32),max_chunk_bytes:65536};}
    if(name==='append_fm1_stock_upload'){const bytes=Buffer.from(args.data_base64,'base64');backend.chunks.push({offset:args.offset,bytes});return {upload_id:args.upload_id,received_bytes:args.offset+bytes.length};}
    if(name==='review_fm1_stock_update'){backend.status={...backend.status,review:backend.review};return {review:backend.review};}
    if(name==='review_fm1_stock_recovery'){backend.review=reviewed({...backend.review,operation:'resume',job_id:args.job_id,identity:backend.device.identity});backend.status={...backend.status,review:backend.review};return {review:backend.review};}
    if(name==='start_fm1_stock_update'){backend.status=stockStatus({writing:true,attempt:receipt('active'),review:null});return {writing:true,attempt:backend.status.attempt,review:null};}
    assert.fail('Unexpected native stock tool '+name);
  }});
  return {...f,backend,async select(){await f.controller.ready;await f.controller.connectMidi(user);const bytes=new Uint8Array(packageBytes);await f.controller.selectPackage(fileFor(bytes),user);return bytes;}};
}

test('stock capability is explicit and ready reads saved status without device I/O or enabling custom installation',async()=>{
  const f=stockFixture();await f.controller.ready;
  assert.deepEqual(f.calls,[{name:'get_fm1_stock_update_status',args:{}}]);assert.equal(f.timers.size,0);
  assert.equal(f.controller.state().stockUpdateAvailable,true);assert.equal(f.controller.state().installationAvailable,false);assert.equal(f.el('direct-stock-file').disabled,true);
  for(const id of ['direct-common-review','direct-common-confirm','install-diagnostics','stock-update'])assert.equal(f.el(id).disabled,true,id);
  assert.equal(f.el('direct-stock-review').disabled,true);assert.match(f.el('direct-package-summary').textContent,/bundled local plugin/);f.controller.dispose();
});

test('official selection snapshots bytes and review uploads fixed bounded chunks only after a trusted action',async()=>{
  const f=stockFixture({review:{product:'FM-1 <b>V15</b>'}});await f.controller.ready;await f.controller.connectMidi(user);
  const bytes=new Uint8Array(packageBytes).fill(7),file=fileFor(bytes),before=f.calls.length;
  await f.controller.selectPackage(file,synthetic);assert.equal(f.el('direct-stock-review').disabled,true);assert.equal(f.calls.length,before);
  await f.controller.selectPackage(file,user);bytes.fill(9);assert.equal(f.calls.length,before);
  await f.controller.stage(synthetic);assert.equal(f.calls.length,before);await f.controller.stage(user);
  const upload=f.calls.find(row=>row.name==='begin_fm1_stock_upload');assert.deepEqual(upload.args,{raw_bytes:packageBytes});
  assert.equal(f.backend.chunks.length,11);assert.ok(f.backend.chunks.every((row,index)=>row.offset===index*65536&&row.bytes.length<=65536));
  const uploaded=Buffer.concat(f.backend.chunks.map(row=>row.bytes));assert.equal(uploaded.length,packageBytes);assert.ok(uploaded.every(value=>value===7));
  assert.ok(f.calls.filter(row=>row.name==='append_fm1_stock_upload').every(row=>row.args.data_base64.length<=87384));
  assert.equal(f.el('direct-stock-dialog').open,true);assert.equal(f.el('direct-review-confirm').disabled,false);
  const detail=f.el('direct-review-text').textContent;for(const expected of ['FM-1 <b>V15</b>',String(packageBytes),'589824','3'.repeat(64),'FM-1_015','FM-1 MIDI input','FM-1 MIDI output','2'.repeat(32),'2099-10-19'])assert.ok(detail.includes(expected),expected);
  assert.equal(Object.hasOwn(f.el('direct-review-text'),'innerHTML'),false);assert.equal(f.calls.some(row=>row.name==='start_fm1_stock_update'),false);f.controller.dispose();
});

test('stock file chooser stays usable through routine polling and only confirmed disconnect disables it',async()=>{
  let release;const f=stockFixture({handler:name=>name==='get_fm1_device_status'?new Promise(resolve=>{release=resolve;}):undefined});await f.select();
  const heading=f.el('device-heading').textContent,summary=f.el('direct-package-summary').textContent,pending=f.controller.refresh();await tick();assert.equal(typeof release,'function');
  assert.equal(f.controller.state().routineChecking,true);assert.equal(f.el('direct-stock-file').disabled,false);assert.equal(f.el('device-heading').textContent,heading);assert.equal(f.el('direct-package-summary').textContent,summary);assert.equal(f.el('direct-stock-review').disabled,true);assert.equal(f.el('direct-review-confirm').disabled,true);assert.doesNotMatch(f.el('direct-device-note').textContent,/unavailable/);
  f.el('direct-stock-file').files=[{...fileFor(new Uint8Array(packageBytes)),name:'Chosen during poll.fwsc'}];f.el('direct-stock-file').onchange(user);await tick();assert.match(f.el('direct-package-summary').textContent,/Chosen during poll/);
  release(connected('stock-midi'));await pending;assert.equal(f.el('direct-stock-file').disabled,false);assert.match(f.el('direct-package-summary').textContent,/Chosen during poll/);assert.equal(f.controller.state().routineChecking,false);assert.equal(f.calls.some(row=>row.name==='begin_fm1_stock_upload'||row.name==='start_fm1_stock_update'),false);
  const selected=f.el('direct-package-summary').textContent,disconnectedPoll=f.controller.refresh();await tick();assert.equal(f.el('direct-stock-file').disabled,false);release(disconnected());await disconnectedPoll;assert.equal(f.el('direct-stock-file').disabled,true);assert.equal(f.el('direct-stock-review').disabled,true);assert.equal(f.el('direct-review-confirm').disabled,true);assert.equal(f.el('direct-package-summary').textContent,selected);assert.equal(f.el('device-heading').textContent,'FM-1 disconnected');f.controller.dispose();
});

test('trusted confirmation consumes one review and start has no panel abort signal; writer polling keeps stable identity',async()=>{
  const f=stockFixture();await f.select();await f.controller.stage(user);const heading=f.el('device-heading').textContent;
  const before=f.calls.length;await f.controller.confirm(synthetic);assert.equal(f.calls.length,before);
  await f.controller.confirm(user);await f.controller.confirm(user);
  const starts=f.calls.filter(row=>row.name==='start_fm1_stock_update');assert.deepEqual(starts,[{name:'start_fm1_stock_update',args:{review_id:'1'.repeat(32),confirmed:true}}]);
  assert.equal(f.signals[f.calls.findIndex(row=>row.name==='start_fm1_stock_update')],null);
  assert.equal(f.el('direct-stock-dialog').open,false);assert.equal(f.controller.state().writing,true);assert.equal(f.el('direct-transfer').hidden,false);assert.equal(f.el('direct-transfer-progress').value,0.25);
  for(const id of ['direct-stock-file','direct-stock-review','direct-connect-midi','direct-connect-common','direct-connect-serial','direct-disconnect','direct-review-confirm'])assert.equal(f.el(id).disabled,true,id);
  await f.controller.connectMidi(user);await f.controller.disconnect(user);const count=f.calls.length;await f.poll();
  assert.deepEqual(f.calls.slice(count),[{name:'get_fm1_stock_update_status',args:{}}]);assert.equal(f.el('device-heading').textContent,heading);assert.equal(f.el('connection-check').hidden,true);
  f.backend.status=stockStatus({attempt:receipt('succeeded',{phase:'Reboot verified',progress:1,transfer_finished:true,boot_identity_verified:true})});await f.poll();
  assert.equal(f.controller.state().operationStatus,'succeeded');assert.equal(f.controller.state().writing,false);assert.match(f.el('direct-transfer-status').textContent,/reboot identity verified/);assert.match(f.el('direct-transfer-status').textContent,/readback not performed/);f.controller.dispose();
});

test('real stock prepared start receipt stays running through active polling until transfer and boot proof',async()=>{
  const prepared=receipt('prepared',{phase:'prepared',progress:null});
  const f=stockFixture({handler:(name,args,backend)=>{if(name==='start_fm1_stock_update'){backend.status=stockStatus({writing:true,attempt:prepared});return {writing:true,attempt:prepared,review:null};}}});
  await f.select();await f.controller.stage(user);await f.controller.confirm(user);assert.equal(f.controller.state().attempt.state,'prepared');assert.equal(f.controller.state().operationStatus,'running');assert.equal(f.controller.state().writing,true);assert.match(f.el('direct-transfer-status').textContent,/in progress/);assert.doesNotMatch(f.el('direct-device-note').textContent,/invalid|unavailable|incomplete/);
  const before=f.calls.length;await f.poll();assert.deepEqual(f.calls.slice(before).map(row=>row.name),['get_fm1_stock_update_status']);assert.equal(f.controller.state().operationStatus,'running');
  f.backend.status=stockStatus({writing:true,attempt:receipt('active',{progress:0.5})});await f.poll();assert.equal(f.controller.state().attempt.state,'active');assert.equal(f.el('direct-transfer-progress').value,0.5);
  f.backend.status=stockStatus({attempt:receipt('succeeded',{phase:'done',progress:1,transfer_finished:true,boot_identity_verified:true})});await f.poll();assert.equal(f.controller.state().operationStatus,'succeeded');assert.equal(f.controller.state().writing,false);assert.match(f.el('direct-transfer-status').textContent,/reboot identity verified/);assert.equal(f.calls.filter(row=>row.name==='start_fm1_stock_update').length,1);f.controller.dispose();
  const invalid=stockFixture({status:stockStatus({writing:true,attempt:receipt('prepared',{phase:'unexpected'})})});await invalid.controller.ready;assert.equal(invalid.controller.state().stockUpdateAvailable,false);assert.equal(invalid.el('direct-review-confirm').disabled,true);invalid.controller.dispose();
});

test('stock terminal receipt during slow native cleanup retains locks and polling until writer release',async()=>{
  for(const terminal of ['succeeded','failed','unknown']){
    const proof=terminal==='succeeded'?{transfer_finished:true,boot_identity_verified:true}:{},pending=receipt(terminal,{...proof,phase:'cleanup pending',progress:terminal==='succeeded'?1:0.5});
    const f=stockFixture({status:stockStatus({writing:true,attempt:pending})});await f.controller.ready;
    assert.equal(f.controller.state().writing,true);assert.equal(f.controller.state().stockUpdateAvailable,true);assert.equal(f.controller.state().operationStatus,terminal==='succeeded'?'running':terminal);assert.equal(f.el('direct-connect-midi').disabled,true);assert.equal(f.el('direct-stock-review').disabled,true);assert.equal(f.el('direct-review-confirm').disabled,true);assert.doesNotMatch(f.el('direct-transfer-status').textContent,/Transfer finished/);
    const before=f.calls.length;await f.poll();assert.deepEqual(f.calls.slice(before).map(row=>row.name),['get_fm1_stock_update_status']);assert.equal(f.timers.size,1);
    f.backend.status=stockStatus({attempt:pending});await f.poll();assert.equal(f.controller.state().writing,false);assert.equal(f.controller.state().operationStatus,terminal);assert.equal(f.timers.size,0);if(terminal==='succeeded')assert.match(f.el('direct-transfer-status').textContent,/reboot identity verified/);else assert.doesNotMatch(f.el('direct-transfer-status').textContent,/Transfer finished/);f.controller.dispose();
  }
  const invalid=stockFixture({status:stockStatus({writing:true,attempt:receipt('succeeded',{phase:'cleanup pending',transfer_finished:true,boot_identity_verified:false})})});await invalid.controller.ready;assert.equal(invalid.controller.state().operationStatus,'unknown');assert.equal(invalid.controller.state().writing,true);assert.doesNotMatch(invalid.el('direct-transfer-status').textContent,/Transfer finished/);assert.equal(invalid.timers.size,1);invalid.controller.dispose();
});

test('cancel, file replacement, changed device identity and expired reviews cannot replay a confirmation',async t=>{
  const f=stockFixture();await f.select();await f.controller.stage(user);f.controller.cancel();await f.controller.confirm(user);assert.equal(f.el('direct-stock-dialog').open,false);
  await f.controller.stage(user);await f.controller.selectPackage(fileFor(new Uint8Array(packageBytes)),user);assert.equal(f.controller.state().review,null);await f.controller.confirm(user);
  await f.controller.stage(user);f.backend.device=connected('firmware-midi');await f.controller.refresh();assert.equal(f.controller.state().review,null);assert.equal(f.el('direct-stock-dialog').open,false);await f.controller.confirm(user);
  f.backend.device=connected('stock-midi');await f.controller.connectMidi(user);await f.controller.stage(user);
  t.mock.method(Date,'now',()=>Date.parse('2100-10-19T00:00:00.000Z'));f.controller.paint();assert.equal(f.el('direct-review-confirm').disabled,true);await f.controller.confirm(user);assert.equal(f.controller.state().review,null);
  assert.equal(f.calls.some(row=>row.name==='start_fm1_stock_update'),false);f.controller.dispose();
});

test('unknown saved jobs require explicitly connected original OTA mode and recovery review; no package upload or automatic retry',async()=>{
  const f=stockFixture({status:stockStatus({attempt:receipt('unknown',{phase:'Connection interrupted'})})});await f.controller.ready;
  assert.deepEqual(f.calls,[{name:'get_fm1_stock_update_status',args:{}}]);assert.equal(f.el('direct-stock-recovery').hidden,false);assert.equal(f.el('direct-stock-recovery').disabled,true);assert.match(f.el('direct-stock-note').textContent,/original FM-1 in OTA mode/);
  await f.controller.stage(user,{resume:true});await f.controller.connectMidi(user);await f.controller.stage(user,{resume:true});assert.equal(f.calls.some(row=>row.name==='review_fm1_stock_recovery'),false);
  f.backend.device={...connected('stock-midi'),loader:true,identity:'FM-1_OTA'};await f.controller.connectMidi(user);assert.equal(f.el('direct-stock-recovery').disabled,false);
  await f.controller.stage(user,{resume:true});assert.deepEqual(f.calls.at(-1),{name:'review_fm1_stock_recovery',args:{job_id:'2'.repeat(32)}});assert.equal(f.el('direct-review-confirm').textContent,'Resume original transfer');
  assert.equal(f.calls.some(row=>/upload|review_fm1_stock_update/.test(row.name)),false);await f.controller.confirm(user);assert.equal(f.calls.filter(row=>row.name==='start_fm1_stock_update').length,1);f.controller.dispose();
});

test('hidden and disposed panels stop only status polling; reopening observes the independently owned native job',async()=>{
  const f=stockFixture({status:stockStatus({writing:true,attempt:receipt()})});await f.controller.ready;assert.equal(f.controller.state().writing,true);assert.equal(f.timers.size,1);
  f.runtime.document.hidden=true;f.documentEvents.get('visibilitychange')();assert.equal(f.timers.size,0);const count=f.calls.length;
  f.runtime.document.hidden=false;f.documentEvents.get('visibilitychange')();assert.equal(f.calls.length,count);assert.equal(f.timers.size,1);await f.poll();
  assert.deepEqual(f.calls.map(row=>row.name),['get_fm1_stock_update_status','get_fm1_stock_update_status']);f.controller.dispose();assert.equal(f.timers.size,0);assert.equal(f.calls.length,2);
  const reopened=stockFixture({status:f.backend.status});await reopened.controller.ready;assert.equal(reopened.controller.state().attempt.job_id,'2'.repeat(32));assert.equal(reopened.controller.state().writing,true);assert.equal(reopened.calls.length,1);reopened.controller.dispose();
});

test('teardown during the start RPC cannot cancel the transfer, consume another review or mutate detached UI',async()=>{
  let release;const f=stockFixture({handler:(name,args,backend)=>name==='start_fm1_stock_update'?new Promise(resolve=>{release=()=>{backend.status=stockStatus({writing:true,attempt:receipt()});resolve({writing:true,attempt:receipt(),review:null});};}):undefined});
  await f.select();await f.controller.stage(user);const pending=f.controller.confirm(user),text=f.el('direct-transfer-status').textContent;assert.equal(f.controller.state().writing,true);
  f.abort.abort();release();await pending;assert.equal(f.el('direct-transfer-status').textContent,text);assert.equal(f.timers.size,0);assert.equal(f.signals.at(-1),null);assert.equal(f.backend.status.writing,true);
  assert.equal(f.calls.some(row=>row.name==='disconnect_fm1_device'),false);assert.equal(f.calls.filter(row=>row.name==='start_fm1_stock_update').length,1);
});

test('upload size, bounded chunk contract and offset acknowledgements fail closed without chunk retry or start',async()=>{
  for(const variant of ['size','limit','offset']){
    const f=stockFixture({handler:name=>variant==='limit'&&name==='begin_fm1_stock_upload'?{upload_id:'4'.repeat(32),max_chunk_bytes:65537}:variant==='offset'&&name==='append_fm1_stock_upload'?{upload_id:'4'.repeat(32),received_bytes:1}:undefined});
    await f.controller.ready;await f.controller.connectMidi(user);
    if(variant==='size')await assert.rejects(f.controller.selectPackage(fileFor(new Uint8Array(packageBytes-1)),user),/official V15/);
    else{await f.controller.selectPackage(fileFor(new Uint8Array(packageBytes)),user);await assert.rejects(f.controller.stage(user),variant==='limit'?/upload limits/:/acknowledgement/);}
    assert.equal(f.calls.some(row=>row.name==='review_fm1_stock_update'||row.name==='start_fm1_stock_update'),false);assert.equal(f.calls.filter(row=>row.name==='append_fm1_stock_upload').length,variant==='offset'?1:0);assert.equal(f.timers.size,variant==='size'?1:0);f.controller.dispose();
  }
});

test('failed writer polling retains the original active job and requires explicit status refresh without retrying a write',async()=>{
  let fail=false;const f=stockFixture({status:stockStatus({writing:true,attempt:receipt()}),handler:name=>{if(name==='get_fm1_stock_update_status'&&fail)throw new Error('Native status unavailable');}});await f.controller.ready;fail=true;
  await assert.rejects(f.controller.refreshWriter(),/unavailable/);assert.equal(f.controller.state().writing,true);assert.equal(f.controller.state().attempt.job_id,'2'.repeat(32));assert.equal(f.timers.size,0);assert.equal(f.el('direct-connect-midi').disabled,true);
  fail=false;await f.controller.refreshWriter();assert.equal(f.timers.size,1);assert.ok(f.calls.every(row=>row.name==='get_fm1_stock_update_status'));f.controller.dispose();
});

test('terminal success requires transfer and reboot proof and never claims readback',async()=>{
  for(const proof of [{transfer_finished:false,boot_identity_verified:true},{transfer_finished:true,boot_identity_verified:false},{transfer_finished:true,boot_identity_verified:true,recovery_required:true}]){
    const f=stockFixture({status:stockStatus({attempt:receipt('succeeded',{...proof,phase:'Claimed completion',progress:1})})});await f.controller.ready;
    assert.equal(f.controller.state().operationStatus,'unknown');assert.equal(f.controller.state().attempt.recovery_required,true);assert.doesNotMatch(f.el('direct-transfer-status').textContent,/Transfer finished/);f.controller.dispose();
  }
  const f=stockFixture({status:stockStatus({attempt:receipt('succeeded',{transfer_finished:true,boot_identity_verified:true,readback_verified:true})})});await f.controller.ready;
  assert.equal(f.controller.state().stockUpdateAvailable,false);assert.equal(f.el('direct-review-confirm').disabled,true);assert.match(f.el('direct-device-note').textContent,/receipt is invalid/);f.controller.dispose();
});

test('invalid review binding, expiration and changed original jobs cannot open or authorize a write',async()=>{
  for(const override of [{identity:'another FM-1'},{operation:'resume'},{expires_at:'2000-10-19T00:00:00.000Z'},{raw_bytes:packageBytes+1},{sha256:'not-a-digest'}]){
    const f=stockFixture({review:override});await f.select();await assert.rejects(f.controller.stage(user));assert.equal(f.el('direct-stock-dialog').open,false);await f.controller.confirm(user);assert.equal(f.calls.some(row=>row.name==='start_fm1_stock_update'),false);f.controller.dispose();
  }
  const f=stockFixture({status:stockStatus({writing:true,attempt:receipt()})});await f.controller.ready;f.backend.status=stockStatus({writing:true,attempt:receipt('active',{job_id:'5'.repeat(32)})});
  await assert.rejects(f.controller.refreshWriter(),/original transfer/);assert.equal(f.controller.state().attempt.job_id,'2'.repeat(32));assert.equal(f.controller.state().writing,true);f.controller.dispose();
});

test('unsupported updater and late initial responses keep stock controls disabled',async()=>{
  const f=stockFixture({status:stockStatus({supported:false})});await f.controller.ready;assert.equal(f.controller.state().stockUpdateAvailable,false);assert.equal(f.el('direct-stock-file').disabled,true);await f.controller.selectPackage(fileFor(new Uint8Array(packageBytes)),user);assert.equal(f.calls.length,1);f.controller.dispose();
  let release;const late=stockFixture({handler:name=>name==='get_fm1_stock_update_status'?new Promise(resolve=>{release=resolve;}):undefined});late.controller.dispose();release(stockStatus({writing:true,attempt:receipt()}));await late.controller.ready;
  assert.equal(late.controller.state().attempt,null);assert.equal(late.timers.size,0);assert.equal(late.calls.length,1);
});

test('macOS connection controls use the bundled native edition and preserve passive mount',async()=>{
  const f=fixture({desktopPlatform:'darwin'});await f.controller.ready;
  assert.equal(f.el('inventory-freshness').textContent,'macOS desktop plugin connection');
  assert.match(f.el('direct-device-note').textContent,/bundled macOS plugin server/);
  assert.doesNotMatch(f.el('direct-device-note').textContent,/Windows/);assert.equal(f.calls.length,0);
  await f.controller.connectMidi(user);assert.equal(f.calls[0].name,'connect_fm1_device');assert.equal(f.controller.state().identity,'FM-1_015');f.controller.dispose();
});
