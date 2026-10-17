import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserSerial,FM1_SERIAL_USB,serialHelloProfile} from '../lib/fm1-browser-serial.mjs';

const HELLO='FM1DIAG/1 MOD-EDITOR/1 RAM-TRANSFER UBOOT=SERIAL COMMIT=BLOCKED';
const MOD='MOD status ready=1 running=1 dirty=0 export=0 order=1 row=2 ch=3 sample=4 mix=1 edit=1 lcd=0 keys=0 audio=0 frames=123 underruns=0 ui=4 strips=1';
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
class Events{
  constructor(){this.listeners=new Map();}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
  removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
  emit(name,event={}){for(const fn of [...this.listeners.get(name)??[]])fn(event);}
}
function fakeClock(){let key=0;const timers=new Map();return {setTimeout(fn,ms){const id=++key;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},fire(){for(const [id,timer] of [...timers]){timers.delete(id);timer.fn();}},get size(){return timers.size;}};}
function fixture({hello=HELLO,status=MOD,info=FM1_SERIAL_USB,onWrite,chooseError}={}){
  const calls=[],states=[],clock=fakeClock(),serial=new Events(),lifecycle=new Events();let receive;
  const port=new Events();
  port.readable=new ReadableStream({start(controller){receive=controller;}});
  port.writable=new WritableStream({write(bytes){const command=new TextDecoder().decode(bytes);calls.push(['write',command]);if(onWrite)return onWrite(command,receive);if(command==='HELLO\n'&&hello!=null)receive.enqueue(new TextEncoder().encode(hello+'\n'));else if(status!=null)receive.enqueue(new TextEncoder().encode(status+'\n'));}});
  port.getInfo=()=>({...info});port.open=async options=>{calls.push(['open',options]);};
  port.setSignals=async signals=>{calls.push(['signals',signals]);};
  port.close=async()=>{calls.push(['close']);};
  serial.requestPort=async options=>{calls.push(['choose',options]);if(chooseError)throw chooseError;return port;};
  const controller=new BrowserSerial({serial,lifecycleTarget:lifecycle,clock,onState:state=>states.push(state)});
  return {controller,calls,states,clock,serial,port,lifecycle,receive};
}
test('constructor requests no permission, enumerates no ports and opens nothing',()=>{
  const f=fixture();assert.equal(f.calls.length,0);assert.equal(f.controller.getState().connected,false);assert.equal(f.clock.size,0);
});
test('explicit connection filters and verifies the exact USB identity, opens 115200 and asserts readiness once',async()=>{
  const f=fixture();const state=await f.controller.connect();
  assert.deepEqual(f.calls,[['choose',{filters:[FM1_SERIAL_USB]}],['open',{baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none',bufferSize:4096}],['signals',{dataTerminalReady:true,requestToSend:false}],['write','HELLO\n']]);
  assert.equal(state.profile,'MOD-EDITOR/1');assert.equal(state.connected,true);assert.equal(state.bootVerified,false);assert.equal(f.clock.size,0);
  await f.controller.close();assert.equal(f.port.readable.locked,false);assert.equal(f.port.writable.locked,false);assert.equal(f.controller.getState().connected,false);
});
test('wrong device is rejected before opening or any serial signal/write',async()=>{
  const f=fixture({info:{usbVendorId:0x1234,usbProductId:0x5155}});await assert.rejects(f.controller.connect(),{code:'wrong_device'});assert.deepEqual(f.calls.map(call=>call[0]),['choose']);
});
test('unknown or commit-enabled HELLO is rejected and closes the port',async()=>{
  for(const hello of ['FM1DIAG/1 OTHER/1','FM1DIAG/1 MOD-EDITOR/1 RAM-TRANSFER UBOOT=SERIAL COMMIT=ALLOWED']){
    const f=fixture({hello});await assert.rejects(f.controller.connect(),{code:'unknown_firmware'});assert.equal(f.controller.getState().connected,false);assert.equal(f.calls.at(-1)[0],'close');assert.equal(f.clock.size,0);
  }
});
test('known identities map to existing profile-bound diagnostics commands',async()=>{
  const fixtures=[
    ['FM1DIAG/1 FM1-FORGE/1 UBOOT=SERIAL COMMIT=BLOCKED','FM1-FORGE/1','FORGE STATUS','FORGE STATUS ready=1 running=1 pending=0 frames=22 audio_frames=44 scans=8 keys=ffffffffffffffff lcd=0 fault=0 input_errors=0 adc_errors=0'],
    ['FM1DIAG/1 DOOM-FM1/1 UBOOT=SERIAL COMMIT=BLOCKED','DOOM-FM1/1','DOOM STATUS','DOOM STATUS stage=4 fault=0 frames=12 stopped=0 lcd_stage=4 lcd_error=0 key_error=0 sys_hz=360000000 lsb_hz=60000000 error=private text'],
    ['FM1DIAG/1 MDX-KARAOKE/1 RAM-UPLOAD UBOOT=SERIAL COMMIT=BLOCKED','MDX-KARAOKE/1','MDX STATUS','MDX running=1 pending=0 frames=43 underruns=0 error=0 lcd=0 keys=0 audio=0'],
    ['FM1DIAG/1 NES=SMB1','NES','TEST STATUS','TEST STATUS ready=1 busy=1 mode=7 dropped=0 frames=44 irqs=6 fault=0'],
    ['FM1DIAG/1 PERIPHERAL-TEST/1 LCD=STOCK-SEQ NES=INES UBOOT=SERIAL UPDATE=VERIFY-ONLY COMMIT=BLOCKED','NES','TEST STATUS','TEST STATUS ready=1 busy=1 mode=7 dropped=0 frames=44 irqs=6 fault=0'],
    ['FM1DIAG/1 PERIPHERAL-TEST/1 LCD=STOCK-DMA UBOOT=SERIAL UPDATE=VERIFY-ONLY COMMIT=BLOCKED','PERIPHERAL-TEST/1','TEST STATUS','TEST STATUS ready=1 busy=0 mode=0 dropped=0 frames=0 irqs=0 fault=0'],
    ['FM1DIAG/1 USB-ONLY UPDATE=VERIFY-ONLY COMMIT=BLOCKED','USB-ONLY','STATUS','STATUS active=0 verified=0 bytes=0'],
  ];
  for(const [hello,profile,command,status] of fixtures){
    assert.equal(serialHelloProfile(hello),profile);const f=fixture({hello,status});await f.controller.connect();const sample=await f.controller.readStatus();assert.equal(sample.command,command);assert.equal(sample.profile,profile);assert.equal(sample.bootVerified,false);assert.ok(!Object.hasOwn(sample.counters,'keys'));assert.equal(f.calls.at(-1)[1],command+'\n');await f.controller.close();
  }
});
test('status retains diagnostics counters without input masks, editor coordinates or raw text',async()=>{
  const f=fixture();await f.controller.connect();const sample=await f.controller.readStatus();assert.deepEqual(sample.counters,{ready:1,running:1,lcd:0,audio:0,frames:123,underruns:0});assert.equal(f.controller.getState().checking,false);assert.ok(f.states.some(state=>state.connected&&state.checking));sample.counters.frames=99;assert.equal(f.controller.getState().status.counters.frames,123);await f.controller.close();
});
test('fragmented UTF8, CRLF, startup banners and multiple lines are framed without a transcript buffer',async()=>{
  const f=fixture({onWrite(command,receive){
    const data=new TextEncoder().encode(command==='HELLO\n'?'# FM1DIAG/1 harmless banner 🌱\r\n'+HELLO+'\r\n':MOD+'\n');
    for(let offset=0;offset<data.length;offset+=3)receive.enqueue(data.slice(offset,offset+3));
  }});
  await f.controller.connect();assert.equal((await f.controller.readStatus()).counters.frames,123);assert.ok(!Object.hasOwn(f.controller.getState(),'transcript'));await f.controller.close();
});
test('incomplete, duplicate, out-of-range and unknown status fields fail closed',async()=>{
  for(const status of ['MOD status ready=1',MOD+' frames=5',MOD.replace('frames=123','frames=9007199254740992'),MOD+' secret=1']){
    const f=fixture({status});await f.controller.connect();await assert.rejects(f.controller.readStatus(),{code:'invalid_status'});assert.equal(f.controller.getState().connected,false);assert.equal(f.clock.size,0);
  }
});
test('frame counters can report firmware faults without claiming boot or hardware acceptance',async()=>{
  const f=fixture({status:MOD.replace('lcd=0','lcd=-1').replace('underruns=0','underruns=12')});await f.controller.connect();const sample=await f.controller.readStatus();assert.equal(sample.counters.lcd,-1);assert.equal(sample.counters.underruns,12);assert.equal(sample.diagnosticOnly,true);assert.equal(sample.bootVerified,false);await f.controller.close();
});
test('a missing response times out and closes, preventing a late reply from satisfying the next request',async()=>{
  const f=fixture({status:null});await f.controller.connect();const attempt=f.controller.readStatus();await flush();f.clock.fire();await assert.rejects(attempt,{code:'serial_timeout'});assert.equal(f.controller.getState().connected,false);await assert.rejects(f.controller.readStatus(),{code:'not_connected'});assert.equal(f.clock.size,0);
});
test('overlong lines, overlong chunks and invalid UTF8 close and cancel pending diagnostics',async()=>{
  for(const payload of [new TextEncoder().encode('x'.repeat(4097)),new Uint8Array(65537),new Uint8Array([0xff])]){
    const f=fixture({onWrite(command,receive){receive.enqueue(payload);}});await assert.rejects(f.controller.connect(),error=>['serial_bounds','serial_read_failed'].includes(error.code));assert.equal(f.controller.getState().connected,false);assert.equal(f.port.readable.locked,false);assert.equal(f.port.writable.locked,false);
  }
});
test('concurrent requests are refused without a second chooser or status command',async()=>{
  const f=fixture({status:null});await f.controller.connect();await assert.rejects(f.controller.connect(),{code:'connection_busy'});const attempt=f.controller.readStatus();await assert.rejects(f.controller.readStatus(),{code:'operation_busy'});await f.controller.close();await assert.rejects(attempt,{code:'disconnected'});assert.equal(f.calls.filter(call=>call[0]==='choose').length,1);assert.equal(f.calls.filter(call=>call[1]==='MOD STATUS\n').length,1);
});
test('physical disconnect only affects the selected port, and never opens a replacement automatically',async()=>{
  const f=fixture();await f.controller.connect();f.serial.emit('disconnect',{port:{}});assert.equal(f.controller.getState().connected,true);f.serial.emit('disconnect',{port:f.port});await flush();assert.equal(f.controller.getState().connected,false);assert.equal(f.controller.getState().error,'disconnected');assert.equal(f.calls.filter(call=>call[0]==='choose').length,1);
});
test('pagehide cancels and closes streams, dispose removes lifecycle subscriptions',async()=>{
  const f=fixture();await f.controller.connect();f.lifecycle.emit('pagehide');await flush();assert.equal(f.controller.getState().connected,false);assert.equal(f.port.readable.locked,false);assert.equal(f.port.writable.locked,false);await f.controller.dispose();assert.equal(f.serial.listeners.get('disconnect').size,0);assert.equal(f.lifecycle.listeners.get('pagehide').size,0);
});
test('chooser cancel and host denial are actionable and do not try fallback hardware',async()=>{
  for(const [name,code] of [['NotFoundError','permission_canceled'],['NotAllowedError','permission_denied'],['SecurityError','permission_denied']]){
    const f=fixture({chooseError:Object.assign(new Error('private OS detail'),{name})});await assert.rejects(f.controller.connect(),error=>error.code===code&&!error.message.includes('private'));assert.equal(f.calls.length,1);assert.equal(f.controller.getState().connecting,false);
  }
  await assert.rejects(new BrowserSerial({serial:null}).connect(),{code:'serial_unavailable'});
});
test('NotFoundError distinguishes an unselected chooser from an unavailable selected port',async()=>{
  const noSelection=fixture({chooseError:new DOMException('Private chooser detail','NotFoundError')});
  await assert.rejects(noSelection.controller.connect(),{code:'permission_canceled',message:'No FM-1 serial port was selected. If no chooser appeared, this host may not support serial device selection.'});
  assert.deepEqual(noSelection.calls.map(call=>call[0]),['choose']);assert.equal(noSelection.controller.getState().connected,false);
  const unavailable=fixture();
  unavailable.port.open=async()=>{unavailable.calls.push(['open']);throw new DOMException('Private device detail','NotFoundError');};
  await assert.rejects(unavailable.controller.connect(),{code:'serial_open_failed',message:'The selected FM-1 serial port is unavailable.'});
  assert.deepEqual(unavailable.calls.map(call=>call[0]),['choose','open','close']);assert.equal(unavailable.controller.getState().connected,false);assert.equal(unavailable.calls.some(call=>call[0]==='signals'||call[0]==='write'),false);
});
test('missing readiness control cannot silently handshake with an unconfigured CDC session',async()=>{
  const f=fixture();delete f.port.setSignals;await assert.rejects(f.controller.connect(),{code:'signals_unavailable'});assert.equal(f.calls.some(call=>call[0]==='write'),false);assert.equal(f.calls.at(-1)[0],'close');
});
test('close while chooser is pending cancels opening and does not select/open another device',async()=>{
  const f=fixture();let choose;f.serial.requestPort=()=>new Promise(done=>{choose=done;});const attempt=f.controller.connect();await f.controller.close();choose(f.port);await assert.rejects(attempt,{code:'connection_canceled'});assert.equal(f.calls.some(call=>call[0]==='open'),false);assert.equal(f.controller.getState().connected,false);
});
test('an old canceled chooser cannot close a newer confirmed connection',async()=>{
  const f=fixture();let oldChoose;const normal=f.serial.requestPort;
  f.serial.requestPort=()=>new Promise(done=>{oldChoose=done;});
  const oldAttempt=f.controller.connect();await f.controller.close();
  f.serial.requestPort=normal;await f.controller.connect();
  oldChoose(f.port);await assert.rejects(oldAttempt,{code:'connection_canceled'});
  assert.equal(f.controller.getState().connected,true);await f.controller.close();
});
test('close during opening cleans up a late-opened port without writing HELLO',async()=>{
  const f=fixture();let opened;f.port.open=()=>new Promise(done=>{opened=done;});
  const attempt=f.controller.connect();await flush();await f.controller.close();opened();
  await assert.rejects(attempt,{code:'connection_canceled'});
  assert.equal(f.calls.some(call=>call[0]==='write'),false);assert.equal(f.controller.getState().connected,false);
});
