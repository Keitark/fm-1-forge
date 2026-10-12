/** Passive observation only: this module never opens a device or submits a firmware job. */
function inventoryFreshness(snapshot,now=Date.now()){
  const status=snapshot?.inventory_status||{},observed=typeof status.observed_at==='number'&&Number.isFinite(status.observed_at)?status.observed_at:null;
  const received=snapshot?._inventory_received_at,base=status.age_seconds,validAge=Number.isFinite(base)&&base>=0&&Number.isFinite(received);
  const wallAge=observed===null?null:now/1000-observed;
  const age=validAge&&wallAge!==null?Math.max(base+Math.max(0,(now-received)/1000),Math.max(0,wallAge)):null,limit=Math.min(15,Number.isFinite(status.max_age_seconds)&&status.max_age_seconds>0?status.max_age_seconds:15);
  const enumerationError=snapshot?.inventory?.device?.inventory_error!=null;
  const fresh=!enumerationError&&status.state==='fresh'&&!!snapshot?.relay?.connected&&!!snapshot?.inventory&&observed!==null&&wallAge>=0&&validAge&&age<=limit;
  const mode=snapshot?.inventory?.device?.update_mode?.mode,device=snapshot?.inventory?.device;
  const present=fresh&&(!!device?.serial_ports?.length||!!device?.uboot_disks?.length||['serial','uboot','sysex','ota_sysex'].includes(mode));
  return {fresh,present,age,observed,state:fresh?'fresh':enumerationError||status.state==='error'?'error':snapshot?.inventory?'stale':'unavailable'};
}
/** A single unresolved status request survives ticks, timeouts and manual refreshes. */
function createInventoryMonitor({call,readSnapshot,getSnapshot,onError=()=>{},onAge=()=>{},canRun=()=>true,signal,clock={setTimeout:(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout:timer=>globalThis.clearTimeout(timer)},interval=5000,pendingInterval=1000,initialDelay=1500}){
  let enabled=false,disposed=false,timer=null,inflight=null,pending=null,failures=0,relayConnected=false,carrySnapshot=null;
  const clear=()=>{if(timer!==null){clock.clearTimeout(timer);timer=null;}};
  const alive=()=>!disposed&&!signal?.aborted;
  const now=()=>clock.now?.()??Date.now();
  function adoptPending(){if(pending)return;const task=getSnapshot()?.recent_requests?.find(item=>item.operation==='status'&&['pending','dispatched'].includes(item.state)&&/^[a-f0-9]{32}$/.test(item.id||''));if(task)pending=task.id;}
  function schedule(delay=interval){clear();if(!enabled||!alive()||!canRun())return;timer=clock.setTimeout(function inventoryTick(){timer=null;onAge();void refresh().catch(()=>{});schedule(interval);},delay);}
  async function cycle(options,outcome){
    onAge();
    adoptPending();
    // Delivery and heartbeat are independent saved reads. Catch the delivery
    // immediately: a hidden panel or an offline heartbeat may leave it unused.
    const saved=pending,deliveryRead=saved&&getSnapshot()?.relay?.connected?Promise.resolve().then(()=>call('get_fm1_request',{request_id:saved},signal)).then(delivery=>({delivery}),error=>({error})):null;
    // A saved pending request can outlive the relay. Observe its heartbeat on
    // every cycle so a cached connected flag cannot survive a dead relay.
    // Only the immediate next cycle may reuse the heartbeat just read on
    // completion. Observation timestamps are unchanged; paused/woken cycles
    // and saved pending deliveries always check the heartbeat again.
    const carry=carrySnapshot;carrySnapshot=null;
    const snapshot=carry&&now()-carry.at<=pendingInterval?carry.snapshot:await readSnapshot();
    relayConnected=!!snapshot?.relay?.connected;
    if(!alive()||!canRun(options)||!snapshot?.relay?.connected)return snapshot;
    adoptPending();
    if(!pending){const queued=await call('get_fm1_status',{},signal);if(!alive())return;const id=queued?.request_id;if(!/^[a-f0-9]{32}$/.test(id||''))throw new Error('The status refresh did not return a saved request ID.');pending=id;if(!canRun(options))return queued;}
    const id=pending,result=deliveryRead&&saved===id?await deliveryRead:{delivery:await call('get_fm1_request',{request_id:id},signal)};
    if(!alive()||!canRun(options))return;if(result.error)throw result.error;const delivery=result.delivery;
    if(delivery.id!==id||delivery.operation!=='status')throw new Error('The status response did not match its saved request.');
    if(['pending','dispatched'].includes(delivery.state)){onAge();return delivery;}
    if(!['succeeded','failed','unknown'].includes(delivery.state))throw new Error('The status request returned an unknown delivery state.');
    pending=null;if(!canRun(options))return delivery;const latest=await readSnapshot();if(!alive())return latest;
    if(delivery.state!=='succeeded')throw new Error(delivery.error||'The latest device observation was unavailable.');
    outcome.succeeded=true;outcome.snapshot=latest;relayConnected=!!latest?.relay?.connected;
    return latest;
  }
  function refresh({manual=false}={}){
    if(!alive()||!canRun({manual}))return Promise.resolve(getSnapshot());
    if(inflight)return inflight;clear();
    if(manual)carrySnapshot=null;const started=now(),outcome={succeeded:false};
    inflight=(async()=>{try{const result=await cycle({manual},outcome);failures=0;return result;}catch(error){if(alive()){failures++;onError(error,pending);}throw error;}finally{inflight=null;if(alive()){onAge();const elapsed=now()-started;const delay=failures?Math.min(60000,interval*2**Math.min(failures,4)):!relayConnected?interval:outcome.succeeded?(elapsed>0?0:pendingInterval):pending?pendingInterval:interval;if(outcome.succeeded&&delay===0)carrySnapshot={snapshot:outcome.snapshot,at:now()};schedule(delay);}}})();schedule(interval);return inflight;
  }
  function start(){if(enabled||!alive())return;enabled=true;schedule(initialDelay);}
  function wake(){clear();carrySnapshot=null;if(!alive())return;onAge();if(enabled&&canRun())void refresh().catch(()=>{});}
  function pause(){clear();carrySnapshot=null;if(alive())onAge();}
  function close(){if(disposed)return;disposed=true;enabled=false;carrySnapshot=null;clear();}
  signal?.addEventListener('abort',close,{once:true});
  return {start,refresh,wake,pause,close,get pendingRequestId(){return pending;},get inFlight(){return !!inflight;}};
}
export {inventoryFreshness,createInventoryMonitor};
export const inventoryRuntime='window.FM1Inventory={freshness:'+inventoryFreshness.toString()+',monitor:'+createInventoryMonitor.toString()+'};';
