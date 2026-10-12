import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createInventoryMonitor,inventoryFreshness,inventoryRuntime} from '../lib/fm1-inventory-refresh.mjs';

const id='a'.repeat(32),nextId='b'.repeat(32),flush=async()=>{for(let step=0;step<20;step++)await Promise.resolve();};
function fakeClock(){let now=0,key=0;const timers=new Map();return {now:()=>now,setTimeout(fn,ms){const id=++key;timers.set(id,{fn,time:now+ms});return id;},clearTimeout(id){timers.delete(id);},get size(){return timers.size;},async advance(ms){const end=now+ms;let count=0;while(true){const due=[...timers].sort((a,b)=>a[1].time-b[1].time).find(([,timer])=>timer.time<=end);if(!due)break;if(++count>100)throw new Error('Timer storm');now=due[1].time;timers.delete(due[0]);due[1].fn();await flush();}now=end;await flush();}};}
const fresh=(overrides={})=>({relay:{connected:true},inventory:{device:{serial_ports:[{port:'COM10'}],update_mode:{mode:'serial'}}},inventory_status:{state:'fresh',observed_at:1000,age_seconds:0,max_age_seconds:15,request_id:id},_inventory_received_at:1000000,recent_requests:[],...overrides});
function fixture({states=['succeeded'],connected=true,backend,snapshotBackend,canRun=()=>true}={}){const clock=fakeClock(),calls=[],snapshots=[],errors=[],ages=[],controller=new AbortController();let snapshot=fresh({relay:{connected}}),reads=0;const monitor=createInventoryMonitor({clock,signal:controller.signal,getSnapshot:()=>snapshot,canRun,call:async(name,args,signal)=>{calls.push({name,args,signal});if(backend)return backend(name,args,signal);if(name==='get_fm1_status')return {request_id:id};return {id,operation:'status',state:states[Math.min(reads++,states.length-1)]};},readSnapshot:async()=>{snapshots.push(true);if(snapshotBackend)snapshot=await snapshotBackend(snapshot);return snapshot;},onAge:()=>ages.push(clock.now()),onError:(error,pending)=>errors.push({error,pending})});return {clock,calls,snapshots,errors,ages,monitor,controller,setSnapshot:next=>{snapshot=next;},get snapshot(){return snapshot;}};}

test('injected browser runtime preserves native timer receivers for start, poll, pause and teardown',async()=>{
  const browser=vm.createContext({window:{}});
  vm.runInContext(`
    globalThis.timers=new Map();globalThis.timerKey=0;globalThis.calls=[];globalThis.cleared=[];
    globalThis.setTimeout=function(fn,ms){if(this!==globalThis)throw new TypeError('Illegal invocation');const key=++timerKey;timers.set(key,{fn,ms});return key;};
    globalThis.clearTimeout=function(key){if(this!==globalThis)throw new TypeError('Illegal invocation');cleared.push(key);timers.delete(key);};
    ${inventoryRuntime}
    globalThis.monitor=window.FM1Inventory.monitor({getSnapshot:()=>({relay:{connected:true},recent_requests:[]}),readSnapshot:async()=>({relay:{connected:true}}),call:async(name,args)=>{calls.push(name);return name==='get_fm1_status'?{request_id:'${id}'}:{id:'${id}',operation:'status',state:'pending'};}});
  `,browser);
  assert.doesNotThrow(()=>browser.monitor.start());assert.equal(browser.timers.size,1);const [key,timer]=browser.timers.entries().next().value;assert.equal(timer.ms,1500);browser.timers.delete(key);timer.fn();await flush();
  assert.deepEqual(Array.from(browser.calls),['get_fm1_status','get_fm1_request']);assert.equal(browser.monitor.pendingRequestId,id);assert.equal(browser.timers.size,1);assert.equal(browser.timers.values().next().value.ms,1000);
  assert.doesNotThrow(()=>browser.monitor.pause());assert.equal(browser.timers.size,0);assert.ok(browser.cleared.length>0);assert.doesNotThrow(()=>browser.monitor.wake());await flush();assert.equal(browser.calls.filter(name=>name==='get_fm1_status').length,1);assert.equal(browser.timers.size,1);
  assert.doesNotThrow(()=>browser.monitor.close());assert.equal(browser.timers.size,0);browser.monitor.wake();await flush();assert.equal(browser.timers.size,0);
});

test('freshness uses server age, client elapsed and wall age without accepting future receipt times',()=>{
  const value=fresh();assert.equal(inventoryFreshness(value,1000000).fresh,true);assert.equal(inventoryFreshness(value,1015000).fresh,true);assert.equal(inventoryFreshness(value,1016000).fresh,false);
  value.inventory_status.observed_at=50000000;value.inventory_status.age_seconds=14;assert.equal(inventoryFreshness(value,1000500).fresh,false);assert.equal(inventoryFreshness(value,1002000).fresh,false);
});
test('an hours-old initial tool payload cannot be revived by resetting its client receipt anchor',()=>{
  const value=fresh({_inventory_received_at:8200000});value.inventory_status.age_seconds=1;const result=inventoryFreshness(value,8200000);assert.equal(result.fresh,false);assert.equal(result.age,7200);
});
test('legacy, failed, missing inventory and old queue observations never count as current',()=>{
  for(const value of [fresh({inventory_status:{state:'fresh',observed_at:1000,age_seconds:3600}}),fresh({inventory_status:{state:'stale',observed_at:null,age_seconds:null}}),fresh({inventory_status:{state:'error',observed_at:1000,age_seconds:0}}),fresh({inventory:null}),fresh({relay:{connected:false}}),fresh({_inventory_received_at:undefined})])assert.equal(inventoryFreshness(value,1000000).fresh,false);
});
test('fresh empty inventories are disconnected but failed reads are unavailable',()=>{
  const disconnected=fresh({inventory:{device:{serial_ports:[],uboot_disks:[],update_mode:{mode:'disconnected'}}}});assert.equal(inventoryFreshness(disconnected,1000000).fresh,true);assert.equal(inventoryFreshness(disconnected,1000000).present,false);assert.equal(inventoryFreshness({...disconnected,inventory_status:{...disconnected.inventory_status,state:'error'}},1000000).state,'error');
});
test('enumeration errors override an older server payload that claims freshness',()=>{
  const value=fresh({inventory:{device:{serial_ports:[],uboot_disks:[],inventory_error:'MIDI enumeration failed',update_mode:{mode:'disconnected'}}}});
  assert.deepEqual(inventoryFreshness(value,1000000),{fresh:false,present:false,age:0,observed:1000,state:'error'});
});
test('monitor first refresh starts after a bounded delay and instantaneous replies yield without a hot loop',async()=>{
  const p=fixture();p.monitor.start();await p.clock.advance(1499);assert.equal(p.calls.length,0);await p.clock.advance(1);assert.deepEqual(p.calls.map(c=>c.name),['get_fm1_status','get_fm1_request']);await p.clock.advance(999);assert.equal(p.calls.length,2);await p.clock.advance(1);assert.equal(p.calls.length,4);assert.equal(p.snapshots.length,4);p.controller.abort();assert.equal(p.clock.size,0);
});
test('unresolved saved status request is reused through ticks and manual refresh',async()=>{
  const p=fixture({states:['pending','dispatched','succeeded']});p.monitor.start();await p.clock.advance(1500);assert.equal(p.monitor.pendingRequestId,id);await p.monitor.refresh({manual:true});assert.equal(p.monitor.pendingRequestId,id);await p.clock.advance(1000);assert.equal(p.monitor.pendingRequestId,null);assert.equal(p.calls.filter(c=>c.name==='get_fm1_status').length,1);assert.ok(p.calls.filter(c=>c.name==='get_fm1_request').every(c=>c.args.request_id===id));p.controller.abort();
});
test('a pending observation found in saved request history is resumed before a new request',async()=>{
  const p=fixture();p.setSnapshot(fresh({recent_requests:[{id,operation:'status',state:'dispatched'}]}));await p.monitor.refresh();assert.deepEqual(p.calls.map(c=>c.name),['get_fm1_request']);p.controller.abort();
});
test('completed inventory_status.request_id is never mistaken for an unresolved request',async()=>{
  const p=fixture();await p.monitor.refresh();assert.equal(p.calls[0].name,'get_fm1_status');p.controller.abort();
});
test('auto and manual overlap share one in-flight request and preserve its signal',async()=>{
  let resolve;const p=fixture({backend:(name)=>name==='get_fm1_status'?new Promise(done=>{resolve=done;}):{id,operation:'status',state:'pending'}});p.monitor.start();await p.clock.advance(1500);const manual=p.monitor.refresh({manual:true}),another=p.monitor.refresh();assert.equal(manual,another);assert.equal(p.calls.length,1);resolve({request_id:id});await manual;assert.equal(p.calls.length,2);assert.equal(p.monitor.pendingRequestId,id);p.controller.abort();
});
test('independent age ticks continue while a native status RPC is slow',async()=>{
  let resolve;const p=fixture({backend:(name)=>name==='get_fm1_status'?new Promise(done=>{resolve=done;}):{id,operation:'status',state:'pending'}});p.monitor.start();await p.clock.advance(20000);assert.equal(p.calls.length,1);assert.ok(p.ages.some(age=>age>=16500));resolve({request_id:id});await flush();p.controller.abort();
});
test('manual refresh also retains independent age ticks while its RPC is slow',async()=>{
  let resolve;const p=fixture({backend:(name)=>name==='get_fm1_status'?new Promise(done=>{resolve=done;}):{id,operation:'status',state:'pending'}});p.monitor.start();const manual=p.monitor.refresh({manual:true});await p.clock.advance(20000);assert.equal(p.calls.length,1);assert.ok(p.ages.some(age=>age>=15000));resolve({request_id:id});await manual;p.controller.abort();
});
test('status timeout preserves pending ID and retries that ID after backoff',async()=>{
  let read=0;const p=fixture({backend:name=>name==='get_fm1_status'?{request_id:id}:++read===1?Promise.reject(new Error('Timed out')):{id,operation:'status',state:'succeeded'}});p.monitor.start();await p.clock.advance(1500);assert.equal(p.monitor.pendingRequestId,id);assert.equal(p.errors.length,1);await p.clock.advance(10000);assert.equal(p.calls.filter(c=>c.name==='get_fm1_status').length,1);assert.equal(p.monitor.pendingRequestId,null);assert.equal(p.snapshots.length,3);p.controller.abort();
});
test('terminal failed status is read from its own snapshot before the next request is permitted',async()=>{
  const p=fixture({states:['failed']});await assert.rejects(p.monitor.refresh(),/unavailable/);assert.equal(p.snapshots.length,2);assert.equal(p.monitor.pendingRequestId,null);p.controller.abort();
});
test('hidden or offline panel pauses and a wake resumes immediately without duplicate work',async()=>{
  let available=true;const p=fixture({canRun:()=>available});p.monitor.start();available=false;p.monitor.pause();await p.clock.advance(30000);assert.equal(p.calls.length,0);available=true;p.monitor.wake();p.monitor.wake();await flush();assert.equal(p.calls.filter(c=>c.name==='get_fm1_status').length,1);p.controller.abort();
});
test('offline relay checks saved heartbeat without queuing a status request',async()=>{
  const p=fixture({connected:false});p.monitor.start();await p.clock.advance(1500);assert.equal(p.snapshots.length,1);assert.equal(p.calls.length,0);p.setSnapshot(fresh());await p.clock.advance(5000);assert.equal(p.calls[0].name,'get_fm1_status');p.controller.abort();
});

test('relay loss during a pending observation is detected and reconnect resumes its exact saved ID',async()=>{
  let connected=true;
  const p=fixture({states:['pending','succeeded'],snapshotBackend:previous=>({...previous,relay:{connected}})});
  p.monitor.start();await p.clock.advance(1500);
  assert.equal(p.monitor.pendingRequestId,id);assert.equal(p.calls.filter(c=>c.name==='get_fm1_status').length,1);
  connected=false;await p.clock.advance(5000);
  assert.equal(p.snapshot.relay.connected,false);assert.equal(p.monitor.pendingRequestId,id);
  const calls=p.calls.length;await p.clock.advance(5000);assert.equal(p.calls.length,calls);
  connected=true;p.monitor.wake();p.monitor.wake();await flush();
  assert.equal(p.snapshot.relay.connected,true);assert.equal(p.monitor.pendingRequestId,null);
  assert.equal(p.calls.filter(c=>c.name==='get_fm1_status').length,1);
  assert.ok(p.calls.filter(c=>c.name==='get_fm1_request').every(c=>c.args.request_id===id));
  p.controller.abort();assert.equal(p.clock.size,0);
});

test('heartbeat refresh detects relay loss before an enqueue retry after a status transport error',async()=>{
  let connected=true;
  const p=fixture({snapshotBackend:previous=>({...previous,relay:{connected}}),backend:async()=>{connected=false;throw new Error('Relay is offline');}});
  p.monitor.start();await p.clock.advance(1500);assert.equal(p.errors.length,1);
  await p.clock.advance(10000);assert.equal(p.snapshot.relay.connected,false);assert.equal(p.calls.length,1);
  p.controller.abort();
});

test('a paused or torn down heartbeat refresh does not start device-status calls afterward',async()=>{
  for(const mode of ['hidden','teardown']){
    let available=true,release;
    const p=fixture({canRun:()=>available,snapshotBackend:previous=>new Promise(resolve=>{release=()=>resolve(previous);})});
    p.monitor.start();await p.clock.advance(1500);assert.equal(p.calls.length,0);
    if(mode==='hidden'){available=false;p.monitor.pause();}else p.controller.abort();
    release();await flush();assert.equal(p.calls.length,0);assert.equal(p.clock.size,0);
    p.controller.abort();
  }
});
test('closed monitor has no timers, hook calls, or late response updates',async()=>{
  let resolve;const p=fixture({backend:()=>new Promise(done=>{resolve=done;})});p.monitor.start();await p.clock.advance(1500);p.controller.abort();const ages=p.ages.length;p.monitor.wake();p.monitor.pause();resolve({request_id:id});await flush();await p.clock.advance(60000);assert.equal(p.clock.size,0);assert.equal(p.calls.length,1);assert.equal(p.ages.length,ages);assert.equal(p.snapshots.length,1);
});
test('unsupported native host never schedules an auto observation',async()=>{
  const p=fixture({canRun:()=>false});p.monitor.start();await p.clock.advance(60000);assert.equal(p.calls.length,0);assert.equal(p.clock.size,0);p.controller.abort();
});
test('stale automatic, manual and wake refreshes publish checking before every synchronous age paint',async()=>{
  for(const mode of ['automatic','manual','wake']){
    const clock=fakeClock(),epoch=1000000,paints=[];let monitor,release,snapshot=fresh({inventory_status:{state:'stale',observed_at:980,age_seconds:20,max_age_seconds:15},_inventory_received_at:epoch});
    const paint=()=>{const observation=inventoryFreshness(snapshot,epoch+clock.now());paints.push(!snapshot.relay.connected?'Connection status unavailable':observation.fresh?'FM1 on COM10':monitor.checking||monitor.pendingRequestId?'Checking connection':'Connection status unavailable');};
    monitor=createInventoryMonitor({clock,getSnapshot:()=>snapshot,readSnapshot:()=>new Promise(resolve=>{release=()=>{paint();resolve(snapshot);};}),call:async name=>name==='get_fm1_status'?{request_id:id}:{id,operation:'status',state:'pending'},onAge:paint});monitor.start();
    if(mode==='automatic')await clock.advance(1500);else if(mode==='manual')void monitor.refresh({manual:true});else monitor.wake();await flush();
    assert.equal(monitor.checking,true);assert.ok(paints.length>=1);assert.ok(paints.every(value=>value==='Checking connection'),mode+' must not flash unavailable before its heartbeat resolves');
    await clock.advance(20000);assert.ok(paints.length>=4,'independent age checks continue while the heartbeat is slow');assert.ok(paints.every(value=>value==='Checking connection'));
    release();await flush();assert.equal(monitor.pendingRequestId,id);assert.ok(paints.every(value=>value==='Checking connection'));monitor.close();
  }
});
test('successful immediate resampling keeps checking between cycles without renewing stale observation data',async()=>{
  const clock=fakeClock(),epoch=1000000,paints=[];let monitor,enqueues=0,snapshot=fresh({inventory_status:{state:'stale',observed_at:980,age_seconds:20,max_age_seconds:15},_inventory_received_at:epoch});
  const paint=()=>{const current=inventoryFreshness(snapshot,epoch+clock.now());assert.equal(current.fresh,false);paints.push(monitor.checking||monitor.pendingRequestId?'Checking connection':'Connection status unavailable');};
  monitor=createInventoryMonitor({clock,getSnapshot:()=>snapshot,readSnapshot:()=>new Promise(resolve=>clock.setTimeout(()=>{paint();resolve(snapshot);},10)),call:async name=>name==='get_fm1_status'?{request_id:++enqueues===1?id:nextId}:{id:enqueues===1?id:nextId,operation:'status',state:enqueues===1?'succeeded':'pending'},onAge:paint});monitor.start();await clock.advance(1520);
  assert.equal(enqueues,2);assert.equal(monitor.pendingRequestId,nextId);assert.ok(paints.every(value=>value==='Checking connection'));assert.equal(snapshot.inventory_status.observed_at,980);monitor.close();
});
test('genuine refresh failure and offline heartbeat clear checking after completion',async()=>{
  for(const mode of ['error','offline']){
    const clock=fakeClock();let snapshot=fresh({inventory_status:{state:'stale',observed_at:980,age_seconds:20,max_age_seconds:15},_inventory_received_at:1000000}),monitor;
    const paints=[];monitor=createInventoryMonitor({clock,getSnapshot:()=>snapshot,readSnapshot:async()=>{if(mode==='offline')snapshot={...snapshot,relay:{connected:false}};return snapshot;},call:async()=>{throw new Error('Real delivery failure');},onAge:()=>paints.push(snapshot.relay.connected&&(monitor.checking||monitor.pendingRequestId)?'Checking connection':'Connection status unavailable')});monitor.start();await clock.advance(1500);
    assert.equal(monitor.checking,false);assert.equal(monitor.pendingRequestId,null);assert.equal(paints.at(-1),'Connection status unavailable');monitor.close();
  }
});
test('mismatched response cannot release the selected pending ID or paint new inventory',async()=>{
  const p=fixture({backend:name=>name==='get_fm1_status'?{request_id:id}:{id:nextId,operation:'status',state:'succeeded'}});await assert.rejects(p.monitor.refresh(),/match/);assert.equal(p.monitor.pendingRequestId,id);assert.equal(p.snapshots.length,1);p.controller.abort();
});

test('three-second RPCs and relay observations remain fresh without duplicate pending status requests',async()=>{
  const clock=fakeClock(),epoch=1000000,tasks=new Map(),enqueues=[],deliveries=[],ages=[];
  const sleep=ms=>new Promise(resolve=>clock.setTimeout(resolve,ms));
  let snapshot=fresh(),serial=0,active=0,maxActive=0;
  const observe=()=>{const last=[...tasks.values()].filter(task=>task.state==='succeeded').at(-1);return fresh({inventory_status:{state:'fresh',observed_at:last?.observed??1000,age_seconds:(epoch+clock.now())/1000-(last?.observed??1000),max_age_seconds:15},_inventory_received_at:epoch+clock.now(),recent_requests:[...tasks.values()]});};
  const monitor=createInventoryMonitor({clock,getSnapshot:()=>snapshot,readSnapshot:async()=>{active++;maxActive=Math.max(maxActive,active);await sleep(3000);active--;snapshot=observe();return snapshot;},call:async(name,args)=>{
    active++;maxActive=Math.max(maxActive,active);
    try{
      if(name==='get_fm1_status'){
        assert.equal([...tasks.values()].filter(task=>task.state==='pending').length,0,'one unresolved relay observation at a time');
        const request_id=(++serial).toString(16).padStart(32,'0'),task={id:request_id,operation:'status',state:'pending'};tasks.set(request_id,task);enqueues.push(clock.now());
        clock.setTimeout(()=>{task.state='succeeded';task.observed=(epoch+clock.now())/1000;},3000);
        await sleep(3000);return {request_id};
      }
      const task=tasks.get(args.request_id),delivery={id:task.id,operation:'status',state:task.state};deliveries.push({id:task.id,at:clock.now()});await sleep(3000);return delivery;
    }finally{active--;}
  },onAge:()=>ages.push(inventoryFreshness(snapshot,epoch+clock.now()))});
  monitor.start();
  for(let step=0;step<60;step++){await clock.advance(1000);assert.equal(inventoryFreshness(snapshot,epoch+clock.now()).fresh,true,'unchanged15-second expiry must hold through slow successful cycles');}
  assert.ok(enqueues.length>=5);assert.ok(enqueues.slice(1).every((at,index)=>at-enqueues[index]===9000),'a terminal snapshot is followed immediately by the next enqueue');
  assert.equal(new Set(deliveries.map(item=>item.id)).size,deliveries.length,'completed saved IDs are not replayed');assert.ok(maxActive<=2);assert.ok(ages.every(item=>item.fresh));
  monitor.close();await clock.advance(10000);assert.equal(clock.size,0);
});

test('saved pending delivery and heartbeat start together and a pause safely discards a rejected saved read',async()=>{
  const clock=fakeClock(),started=[];let available=true,releaseRead,releaseSnapshot,snapshot=fresh({recent_requests:[{id,operation:'status',state:'pending'}]});
  const monitor=createInventoryMonitor({clock,getSnapshot:()=>snapshot,canRun:()=>available,readSnapshot:()=>{started.push('heartbeat');return new Promise(resolve=>{releaseSnapshot=()=>resolve(snapshot);});},call:name=>{started.push(name);return new Promise((_resolve,reject)=>{releaseRead=()=>reject(new Error('Saved read interrupted'));});}});
  const work=monitor.refresh();await flush();assert.deepEqual(started,['heartbeat','get_fm1_request']);
  available=false;monitor.pause();releaseRead();releaseSnapshot();await work;assert.equal(monitor.pendingRequestId,id);assert.equal(clock.size,0);monitor.close();
});
