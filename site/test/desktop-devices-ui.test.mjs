import test from 'node:test';
import assert from 'node:assert/strict';
import {mountDesktopDevicesUi} from '../lib/fm1-desktop-devices-ui.mjs';

const user={isTrusted:true},synthetic={isTrusted:false},all=['stock-midi','firmware-midi','serial'];
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const disconnected=(supportedTransports=all)=>({connected:false,transport:null,identity:null,installationAvailable:false,supportedTransports});
const connected=transport=>({connected:true,transport,identity:transport==='stock-midi'?'FM-1_015':transport==='firmware-midi'?'FM1_FORGE_001':'FM1DIAG/1 MOD-EDITOR/1 RAM-TRANSFER UBOOT=SERIAL COMMIT=BLOCKED',...(transport==='serial'?{profile:'MOD-EDITOR/1'}:{}),loader:false,installationAvailable:false,supportedTransports:all});
function fixture({supportedTransports=all,handler}={}){
  const nodes=new Map(),calls=[],timers=new Map(),events=new Map(),documentEvents=new Map(),changes=[];let sequence=0;
  const el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,hidden:false,className:'',onclick:null,onchange:null});return nodes.get(id);};
  const forbidden=()=>assert.fail('Desktop controls must not invoke browser device APIs');
  const runtime={navigator:{requestMIDIAccess:forbidden,serial:{requestPort:forbidden},usb:{requestDevice:forbidden}},document:{hidden:false,addEventListener:(name,fn)=>documentEvents.set(name,fn),removeEventListener:name=>documentEvents.delete(name)},
    addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  const abort=new AbortController(),call=async(name,args)=>{calls.push({name,args});return handler?handler(name,args):name==='connect_fm1_device'?connected(args.transport):disconnected();};
  const controller=mountDesktopDevicesUi({el,call,runtime,signal:abort.signal,supportedTransports,onChange:value=>changes.push(value)});
  return {el,nodes,calls,timers,events,documentEvents,changes,controller,runtime,abort,async poll(){const entry=timers.entries().next().value;assert.ok(entry,'one status timer expected');timers.delete(entry[0]);entry[1].fn();await tick();}};
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
