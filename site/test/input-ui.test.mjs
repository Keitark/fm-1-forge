import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {INPUT_KEY_LABELS,INPUT_ENCODER_NAMES,normalizeInputSample,inputFreshness,createInputView,createInputMonitor,inputBlockReason,inputHtml,inputRuntime,mountInputActivity} from '../lib/fm1-input-ui.mjs';
import {UI_HTML} from '../lib/fm1-ui.mjs';

const id='a'.repeat(32),nextId='b'.repeat(32),flush=async()=>{for(let n=0;n<25;n++)await Promise.resolve();};
const mask=(...bits)=>bits.reduce((value,bit)=>value|(1n<<BigInt(bit)),0n).toString(16).padStart(16,'0');
function sample(overrides={}){return {state:'available',firmware:'FM1-FORGE/1',port:'COM4',capabilities:{keys:true,encoders:true,volume:true},keys:{pressed:mask(0,14,40),seen:mask(0,3,14,40),scans:100,errors:0},encoders:INPUT_ENCODER_NAMES.map((name,id)=>({id,name,edges:id*10,invalid:0,seen:id>0})),volume:{value:512,gain:64,valid:true,samples:100,errors:0},observation:{started_at:1000,completed_at:1001},message:'Sampled hardware input metadata.',...overrides};}
function snapshot(value=sample(),overrides={}){return {relay:{connected:true},inventory:{engine:{active:null,blocked_unknown:false,storage_fault:false,updater_handoff:false},device:{session:{operation:'idle'}}},recent_requests:[],input_activity:{sample:value,state:'fresh',age_seconds:1,observed_at:1001,max_age_seconds:15,request_id:id},_input_received_at:1001000,...overrides};}
function fakeClock(){let now=0,key=0;const timers=new Map();return {now:()=>now,setTimeout(fn,ms){const id=++key;timers.set(id,{fn,time:now+ms});return id;},clearTimeout(id){timers.delete(id);},get size(){return timers.size;},async advance(ms){const end=now+ms;let count=0;while(true){const due=[...timers].sort((a,b)=>a[1].time-b[1].time).find(([,timer])=>timer.time<=end);if(!due)break;if(++count>1000)throw new Error('Timer storm');now=due[1].time;timers.delete(due[0]);due[1].fn();await flush();}now=end;await flush();}};}
function fixture({states=['succeeded'],backend,snapshotBackend,canRun=()=>true}={}){const clock=fakeClock(),calls=[],reads=[],errors=[],ages=[],statesSeen=[],controller=new AbortController();let current=snapshot(),count=0;const monitor=createInputMonitor({clock,signal:controller.signal,getSnapshot:()=>current,canRun,readSnapshot:async()=>{reads.push(true);if(snapshotBackend)current=await snapshotBackend(current);return current;},call:async(name,args,signal)=>{calls.push({name,args,signal});if(backend)return backend(name,args,signal);return name==='get_fm1_input_snapshot'?{request_id:id}:{id,operation:'input_snapshot',state:states[Math.min(count++,states.length-1)]};},onError:(error,pending)=>errors.push({error,pending}),onAge:()=>ages.push(clock.now()),onState:state=>statesSeen.push(state)});return {clock,calls,reads,errors,ages,statesSeen,controller,monitor,setSnapshot:next=>{current=next;},get snapshot(){return current;}};}

test('41 control labels and seven encoder IDs match physical slots and include upper key bit 40',()=>{
  assert.equal(INPUT_KEY_LABELS.length,41);assert.deepEqual(INPUT_KEY_LABELS.slice(0,14),['OCT−','OCT+','FX','SCL','ENV','LFO','EDIT','GLO','HOME','SAVE','ARP','SEQ','PLAY','REC']);assert.equal(INPUT_KEY_LABELS[14],'F3');assert.equal(INPUT_KEY_LABELS[40],'G5');
  const model=createInputView().read(snapshot(),1001000);assert.equal(model.keys.length,41);assert.equal(model.keys[40].held,true);assert.equal(model.keys[3].seen,true);assert.equal(model.keys[3].held,false);assert.equal(model.keys[1].seen,false);assert.equal(model.encoders.length,7);
  assert.equal((inputHtml.match(/id="input-key-\d+"/g)||[]).length,41);
});
test('malformed masks, impossible inputs, duplicate or mismatched encoders, invalid volume and interval are rejected',()=>{
  for(const value of [sample({keys:{...sample().keys,pressed:'FFFF'}}),sample({keys:{...sample().keys,seen:mask(41)}}),sample({encoders:sample().encoders.slice(1)}),sample({encoders:sample().encoders.map((item,i)=>i===6?{...item,id:5}:item)}),sample({encoders:sample().encoders.map((item,i)=>i===2?{...item,name:'INJECTED'}:item)}),sample({encoders:sample().encoders.map((item,i)=>i===2?{...item,edges:0x80000000}:item)}),sample({volume:{...sample().volume,value:1024}}),sample({volume:{...sample().volume,gain:128}}),sample({keys:{...sample().keys,scans:-1}}),sample({observation:{started_at:1002,completed_at:1001}}),sample({observation:{started_at:1000,completed_at:1016}}),sample({firmware:'x'.repeat(65)}),sample({port:'COM4<script>'})])assert.equal(normalizeInputSample(value),null);
});
test('browser normalization enforces bounded firmware identities, partial capabilities and a three-second sample interval',()=>{
  for(const value of [sample({firmware:'FM1-FORGE/2'}),sample({firmware:'MOD-EDITOR/1'}),sample({port:'COM10000'}),sample({observation:{started_at:1000,completed_at:1004}}),sample({capabilities:{keys:true,encoders:true,volume:false},volume:null}),sample({state:'busy'}),sample({keys:{...sample().keys,transcript:'extra'}}),sample({message:'C:\\private\\trace.txt'})])assert.equal(normalizeInputSample(value),null);
});
test('unsupported capability values are represented as unavailable rather than zero activity',()=>{
  const value=sample({state:'unsupported',firmware:'MOD-EDITOR/1',capabilities:{keys:false,encoders:false,volume:true},keys:null,encoders:null});
  const model=createInputView().read(snapshot(value),1001000);assert.ok(model.keys.every(key=>!key.available&&!key.held));assert.ok(model.encoders.every(encoder=>!encoder.available&&encoder.edges===null));assert.equal(model.volume.value,512);
  assert.equal(normalizeInputSample({...value,keys:sample().keys}),null);
});
test('sample age uses immutable source wall age and receipt plus elapsed; old, future, errored and offline samples fail closed',()=>{
  const value=snapshot();assert.equal(inputFreshness(value,1001000).fresh,true);assert.equal(inputFreshness(value,1015000).fresh,true);assert.equal(inputFreshness(value,1015001).fresh,false);
  for(const candidate of [snapshot(sample(),{_input_received_at:1002000}),snapshot(sample(),{relay:{connected:false}}),snapshot(sample(),{input_activity:{...value.input_activity,state:'error'}}),snapshot(sample(),{input_activity:{...value.input_activity,observed_at:1000}}),snapshot(sample(),{input_activity:{...value.input_activity,request_id:'bad'}})])assert.equal(inputFreshness(candidate,1001000).fresh,false);
  assert.equal(inputFreshness(snapshot(sample(),{_input_received_at:8200000}),8200000).fresh,false);
});
test('delayed Site reception remains fresh using the actual sample start rather than requiring identical receipt time',()=>{
  const value=snapshot(sample(),{input_activity:{...snapshot().input_activity,observed_at:1004,age_seconds:4},_input_received_at:1004000});
  assert.equal(inputFreshness(value,1004000).fresh,true);assert.equal(inputFreshness(value,1004000).age,4);assert.equal(inputFreshness(value,1015000).fresh,true);assert.equal(inputFreshness(value,1016000).fresh,false);
  assert.equal(inputFreshness({...value,input_activity:{...value.input_activity,observed_at:1000}},1004000).fresh,false);
});
test('stale activity clears held highlights, active deltas and volume without discarding latched seen history',()=>{
  const view=createInputView();view.read(snapshot(),1001000);const stale=view.read(snapshot(),1016000);assert.ok(stale.keys.every(key=>!key.held));assert.ok(stale.encoders.every(encoder=>encoder.delta===null));assert.equal(stale.volume,null);assert.equal(stale.keys[40].seen,true);assert.ok(stale.keys.every(key=>!key.available));
});
test('encoder deltas require fresh consecutive distinct observations with the same firmware and port',()=>{
  const view=createInputView(),first=snapshot();assert.equal(view.read(first,1001000).encoders[1].delta,null);
  const next=sample({keys:{...sample().keys,scans:200},encoders:sample().encoders.map(item=>({...item,edges:item.edges-3})),volume:{...sample().volume,samples:200},observation:{started_at:1005,completed_at:1006}});
  const second=snapshot(next,{input_activity:{...first.input_activity,sample:next,request_id:nextId,observed_at:1006,age_seconds:1},_input_received_at:1006000});
  assert.equal(view.read(second,1006000).encoders[1].delta,-3);assert.equal(view.read(second,1007000).encoders[1].delta,-3);
  const other=sample({...next,port:'COM5',observation:{started_at:1010,completed_at:1011}}),changed=snapshot(other,{input_activity:{...second.input_activity,sample:other,request_id:'c'.repeat(32),observed_at:1011},_input_received_at:1011000});assert.equal(view.read(changed,1011000).encoders[1].delta,null);
  const newFirmware={...other,firmware:'FM1-FORGE/2'};assert.equal(view.read({...changed,input_activity:{...changed.input_activity,sample:newFirmware,request_id:'d'.repeat(32)}},1011000).encoders[1].delta,null);
});
test('stale gap or counter reset prevents fabricated encoder deltas after resuming',()=>{
  for(const mode of ['stale','reset','gap-without-age-tick']){
    const view=createInputView(),first=snapshot();view.read(first,1001000);if(mode==='stale')view.read(first,1016000);
    const value=sample({keys:{...sample().keys,scans:mode==='reset'?1:200},encoders:sample().encoders.map(item=>({...item,edges:100})),observation:{started_at:1020,completed_at:1021}});
    const latest=snapshot(value,{input_activity:{...first.input_activity,sample:value,request_id:nextId,observed_at:1021},_input_received_at:1021000});assert.equal(view.read(latest,1021000).encoders[1].delta,null);
  }
});
test('encoder counter wrap does not become a fabricated multi-billion-edge activity delta',()=>{
  const view=createInputView(),first=snapshot(sample({encoders:sample().encoders.map((item,index)=>index===0?{...item,edges:0x7fffffff}:item)}));view.read(first,1001000);
  const next=sample({encoders:sample().encoders.map((item,index)=>index===0?{...item,edges:-0x80000000}:item),observation:{started_at:1005,completed_at:1006}}),latest=snapshot(next,{input_activity:{...first.input_activity,sample:next,observed_at:1006,request_id:nextId},_input_received_at:1006000});assert.equal(view.read(latest,1006000).encoders[0].delta,null);
});
test('monitor is paused by default and only submits a no-argument sampled read after explicit Start',async()=>{
  const p=fixture();await p.clock.advance(30000);assert.equal(p.calls.length,0);assert.equal(p.monitor.enabled,false);p.monitor.start();await flush();assert.deepEqual(p.calls.map(item=>item.name),['get_fm1_input_snapshot','get_fm1_request']);assert.deepEqual(p.calls[0].args,{});assert.equal(p.reads.length,2);await p.clock.advance(4999);assert.equal(p.calls.length,2);await p.clock.advance(1);assert.equal(p.calls.length,4);p.controller.abort();assert.equal(p.clock.size,0);
});
test('pending reads poll their single saved ID every second, without submitting another sample',async()=>{
  const p=fixture({states:['pending','dispatched','succeeded']});p.monitor.start();await flush();assert.equal(p.monitor.pendingRequestId,id);await p.clock.advance(1000);assert.equal(p.monitor.pendingRequestId,id);await p.clock.advance(1000);assert.equal(p.monitor.pendingRequestId,null);assert.equal(p.calls.filter(item=>item.name==='get_fm1_input_snapshot').length,1);assert.ok(p.calls.filter(item=>item.name==='get_fm1_request').every(item=>item.args.request_id===id));p.controller.abort();
});
test('timed out saved reads resume the same ID; overlapping Start, wake and refresh share one inflight operation',async()=>{
  let release,reads=0;const p=fixture({backend:name=>name==='get_fm1_input_snapshot'?{request_id:id}:++reads===1?new Promise(resolve=>{release=resolve;}):Promise.reject(new Error('Timed out'))});p.monitor.start();await flush();const pending=p.monitor.refresh();assert.equal(pending,p.monitor.refresh());p.monitor.wake();assert.equal(p.calls.length,2);await p.clock.advance(3000);assert.equal(p.calls.length,2);assert.ok(p.ages.length>=3);release({id,operation:'input_snapshot',state:'pending'});await pending;await p.clock.advance(1000);assert.equal(p.monitor.pendingRequestId,id);assert.equal(p.errors.length,1);await p.clock.advance(1000);assert.equal(p.calls.filter(item=>item.name==='get_fm1_input_snapshot').length,1);assert.equal(p.monitor.pendingRequestId,id);p.controller.abort();
});
test('saved pending history is adopted even when enqueue transport reply was lost',async()=>{
  let replyLost=false;const p=fixture({snapshotBackend:before=>({...before,recent_requests:replyLost?[{operation:'input_snapshot',id,state:'dispatched'}]:[]}),backend:name=>{if(name==='get_fm1_input_snapshot'){replyLost=true;throw new Error('Reply lost');}return {id,operation:'input_snapshot',state:'succeeded'};}});p.monitor.start();await flush();assert.equal(p.errors.length,1);await p.clock.advance(5000);assert.equal(p.calls.filter(item=>item.name==='get_fm1_input_snapshot').length,1);assert.equal(p.monitor.pendingRequestId,null);p.controller.abort();
});
test('Stop prevents new samples while preserving a pending ID that Start resumes',async()=>{
  const p=fixture({states:['pending','succeeded']});p.monitor.start();await flush();p.monitor.stop();const n=p.calls.length;await p.clock.advance(30000);assert.equal(p.calls.length,n);assert.equal(p.monitor.pendingRequestId,id);p.monitor.start();await flush();assert.equal(p.calls.filter(item=>item.name==='get_fm1_input_snapshot').length,1);p.controller.abort();
});
test('hidden, offline and teardown stop polling; wake resumes with the original saved request',async()=>{
  let visible=true;const p=fixture({states:['pending','succeeded'],canRun:()=>visible});p.monitor.start();await flush();visible=false;p.monitor.pause();const n=p.calls.length;await p.clock.advance(30000);assert.equal(p.calls.length,n);visible=true;p.monitor.wake();await flush();assert.equal(p.calls.filter(item=>item.name==='get_fm1_input_snapshot').length,1);p.controller.abort();p.monitor.wake();await p.clock.advance(30000);assert.equal(p.clock.size,0);
});
test('relay loss and every engine/session gate prevent sampling until fresh snapshot clears the gate',async()=>{
  const gates=[{relay:{connected:false}},...['active','blocked_unknown','storage_fault','updater_handoff'].map(field=>({inventory:{engine:{[field]:field==='active'?{id}:true}}})),...['blocked','reset_pending','needs_observation','loader_running','stopped'].map(field=>({inventory:{device:{session:{operation:'idle',[field]:true}}}})),{inventory:{device:{session:{operation:'write'}}}}];
  for(const gate of gates){let blocked=true;const p=fixture({snapshotBackend:()=>snapshot(sample(),blocked?gate:{})});p.monitor.start();await flush();assert.equal(p.calls.length,0);assert.ok(inputBlockReason(p.snapshot));blocked=false;await p.clock.advance(5000);assert.equal(p.calls[0].name,'get_fm1_input_snapshot');p.controller.abort();}
});
test('gating or Stop during heartbeat read never submits a late serial sample',async()=>{
  for(const mode of ['stop','hidden','abort']){let visible=true,release;const p=fixture({canRun:()=>visible,snapshotBackend:before=>new Promise(resolve=>{release=()=>resolve(before);})});p.monitor.start();await flush();if(mode==='stop')p.monitor.stop();else if(mode==='hidden'){visible=false;p.monitor.pause();}else p.controller.abort();release();await flush();assert.equal(p.calls.length,0);p.controller.abort();}
});
test('mismatched delivery identity is rejected while the exact pending ID remains recoverable',async()=>{
  const p=fixture({backend:name=>name==='get_fm1_input_snapshot'?{request_id:id}:{id:nextId,operation:'input_snapshot',state:'succeeded'}});p.monitor.start();await flush();assert.equal(p.errors.length,1);assert.equal(p.monitor.pendingRequestId,id);p.controller.abort();
});
test('injected native runtime preserves browser timer receivers and needs no frame document or body',async()=>{
  const context=vm.createContext({window:{}});vm.runInContext(`globalThis.timers=new Map();globalThis.key=0;globalThis.setTimeout=function(fn,ms){if(this!==globalThis)throw new Error('Illegal timer receiver');const id=++key;timers.set(id,{fn,ms});return id;};globalThis.clearTimeout=function(id){if(this!==globalThis)throw new Error('Illegal timer receiver');timers.delete(id);};${inputRuntime}globalThis.monitor=window.FM1InputActivity.monitor({call:async(name)=>name==='get_fm1_input_snapshot'?{request_id:'${id}'}:{id:'${id}',operation:'input_snapshot',state:'pending'},getSnapshot:()=>({relay:{connected:true}}),readSnapshot:async()=>({relay:{connected:true}})});`,context);
  assert.doesNotThrow(()=>context.monitor.start());await flush();assert.equal(context.monitor.pendingRequestId,id);assert.equal(context.timers.size,2);assert.doesNotThrow(()=>context.monitor.stop());assert.equal(context.timers.size,0);assert.ok(!inputRuntime.includes('document.body'));assert.ok(!inputRuntime.includes('frameElement'));context.monitor.close();
});
test('activity mount displays MOD volume support truthfully and never touches selected progress or project fields',()=>{
  const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',dataset:{},setAttribute(){}});return nodes.get(id);},controller=new AbortController();let value=snapshot(sample({state:'unsupported',firmware:'MOD-EDITOR/1',capabilities:{keys:false,encoders:false,volume:true},keys:null,encoders:null}));
  el('detail').textContent='Existing saved job';el('forge-project-goal').textContent='Unsaved draft';const activity=mountInputActivity({el,getSnapshot:()=>value,readSnapshot:async()=>value,call:async()=>{throw new Error('Paused monitor must not call');},canRun:()=>true,signal:controller.signal});
  // The default mount uses browser Date.now(), so assign current source times for a fresh sample.
  const now=Math.floor(Date.now()/1000);value={...value,input_activity:{...value.input_activity,sample:{...value.input_activity.sample,observation:{started_at:now,completed_at:now}},observed_at:now,age_seconds:0},_input_received_at:Date.now()};activity.paint();
  assert.match(el('input-capabilities').textContent,/volume only/);assert.match(el('input-capabilities').textContent,/reviewed install flow/);assert.equal(el('input-encoder-edges-0').textContent,'Unavailable');assert.match(el('input-volume-value').textContent,/ADC 512/);assert.equal(el('input-toggle').textContent,'Start monitoring');assert.equal(el('detail').textContent,'Existing saved job');assert.equal(el('forge-project-goal').textContent,'Unsaved draft');controller.abort();
});
test('native HTML mounts separate activity monitor in connection refresh and lifecycle paths',()=>{
  assert.ok(UI_HTML.indexOf('id="input-title"')<UI_HTML.indexOf('aria-label="FM1 firmware factory"'));assert.match(UI_HTML,/input_activity:data\.input_activity/);assert.match(UI_HTML,/_input_received_at:Date\.now\(\)/);assert.match(UI_HTML,/inputActivity\?\.paint\(\)/);assert.match(UI_HTML,/inputActivity\?\.close\(\)/);assert.match(UI_HTML,/inputActivity\.pause\(\)/);assert.match(inputHtml,/Brief presses can happen between samples/);assert.match(inputHtml,/Monitoring never changes firmware or volume/);
});
