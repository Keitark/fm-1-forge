import test from 'node:test';
import assert from 'node:assert/strict';
import {createInventoryMonitor,inventoryFreshness} from '../lib/fm1-inventory-refresh.mjs';

const id='a'.repeat(32),nextId='b'.repeat(32),flush=async()=>{for(let step=0;step<20;step++)await Promise.resolve();};
function fakeClock(){let now=0,key=0;const timers=new Map();return {now:()=>now,setTimeout(fn,ms){const id=++key;timers.set(id,{fn,time:now+ms});return id;},clearTimeout(id){timers.delete(id);},get size(){return timers.size;},async advance(ms){const end=now+ms;let count=0;while(true){const due=[...timers].sort((a,b)=>a[1].time-b[1].time).find(([,timer])=>timer.time<=end);if(!due)break;if(++count>100)throw new Error('Timer storm');now=due[1].time;timers.delete(due[0]);due[1].fn();await flush();}now=end;await flush();}};}
const fresh=(overrides={})=>({relay:{connected:true},inventory:{device:{serial_ports:[{port:'COM10'}],update_mode:{mode:'serial'}}},inventory_status:{state:'fresh',observed_at:1000,age_seconds:0,max_age_seconds:15,request_id:id},_inventory_received_at:1000000,recent_requests:[],...overrides});
function fixture({states=['succeeded'],connected=true,backend,canRun=()=>true}={}){const clock=fakeClock(),calls=[],snapshots=[],errors=[],ages=[],controller=new AbortController();let snapshot=fresh({relay:{connected}}),reads=0;const monitor=createInventoryMonitor({clock,signal:controller.signal,getSnapshot:()=>snapshot,canRun,call:async(name,args,signal)=>{calls.push({name,args,signal});if(backend)return backend(name,args,signal);if(name==='get_fm1_status')return {request_id:id};return {id,operation:'status',state:states[Math.min(reads++,states.length-1)]};},readSnapshot:async()=>{snapshots.push(true);return snapshot;},onAge:()=>ages.push(clock.now()),onError:(error,pending)=>errors.push({error,pending})});return {clock,calls,snapshots,errors,ages,monitor,controller,setSnapshot:next=>{snapshot=next;},get snapshot(){return snapshot;}};}

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
test('monitor first refresh starts after a bounded delay then repeats every five seconds',async()=>{
  const p=fixture();p.monitor.start();await p.clock.advance(1499);assert.equal(p.calls.length,0);await p.clock.advance(1);assert.deepEqual(p.calls.map(c=>c.name),['get_fm1_status','get_fm1_request']);await p.clock.advance(4999);assert.equal(p.calls.length,2);await p.clock.advance(1);assert.equal(p.calls.length,4);assert.equal(p.snapshots.length,2);p.controller.abort();assert.equal(p.clock.size,0);
});
test('unresolved saved status request is reused through ticks and manual refresh',async()=>{
  const p=fixture({states:['pending','dispatched','succeeded']});p.monitor.start();await p.clock.advance(1500);assert.equal(p.monitor.pendingRequestId,id);await p.monitor.refresh({manual:true});assert.equal(p.monitor.pendingRequestId,id);await p.clock.advance(5000);assert.equal(p.monitor.pendingRequestId,null);assert.equal(p.calls.filter(c=>c.name==='get_fm1_status').length,1);assert.ok(p.calls.filter(c=>c.name==='get_fm1_request').every(c=>c.args.request_id===id));p.controller.abort();
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
  let read=0;const p=fixture({backend:name=>name==='get_fm1_status'?{request_id:id}:++read===1?Promise.reject(new Error('Timed out')):{id,operation:'status',state:'succeeded'}});p.monitor.start();await p.clock.advance(1500);assert.equal(p.monitor.pendingRequestId,id);assert.equal(p.errors.length,1);await p.clock.advance(10000);assert.equal(p.calls.filter(c=>c.name==='get_fm1_status').length,1);assert.equal(p.monitor.pendingRequestId,null);assert.equal(p.snapshots.length,1);p.controller.abort();
});
test('terminal failed status is read from its own snapshot before the next request is permitted',async()=>{
  const p=fixture({states:['failed']});await assert.rejects(p.monitor.refresh(),/unavailable/);assert.equal(p.snapshots.length,1);assert.equal(p.monitor.pendingRequestId,null);p.controller.abort();
});
test('hidden or offline panel pauses and a wake resumes immediately without duplicate work',async()=>{
  let available=true;const p=fixture({canRun:()=>available});p.monitor.start();available=false;p.monitor.pause();await p.clock.advance(30000);assert.equal(p.calls.length,0);available=true;p.monitor.wake();p.monitor.wake();await flush();assert.equal(p.calls.filter(c=>c.name==='get_fm1_status').length,1);p.controller.abort();
});
test('offline relay checks saved heartbeat without queuing a status request',async()=>{
  const p=fixture({connected:false});p.monitor.start();await p.clock.advance(1500);assert.equal(p.snapshots.length,1);assert.equal(p.calls.length,0);p.setSnapshot(fresh());await p.clock.advance(5000);assert.equal(p.calls[0].name,'get_fm1_status');p.controller.abort();
});
test('closed monitor has no timers, hook calls, or late response updates',async()=>{
  let resolve;const p=fixture({backend:()=>new Promise(done=>{resolve=done;})});p.monitor.start();await p.clock.advance(1500);p.controller.abort();const ages=p.ages.length;p.monitor.wake();p.monitor.pause();resolve({request_id:id});await flush();await p.clock.advance(60000);assert.equal(p.clock.size,0);assert.equal(p.calls.length,1);assert.equal(p.ages.length,ages);assert.equal(p.snapshots.length,0);
});
test('unsupported native host never schedules an auto observation',async()=>{
  const p=fixture({canRun:()=>false});p.monitor.start();await p.clock.advance(60000);assert.equal(p.calls.length,0);assert.equal(p.clock.size,0);p.controller.abort();
});
test('mismatched response cannot release the selected pending ID or paint new inventory',async()=>{
  const p=fixture({backend:name=>name==='get_fm1_status'?{request_id:id}:{id:nextId,operation:'status',state:'succeeded'}});await assert.rejects(p.monitor.refresh(),/match/);assert.equal(p.monitor.pendingRequestId,id);assert.equal(p.snapshots.length,0);p.controller.abort();
});
