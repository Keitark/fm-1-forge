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
function createInventoryMonitor({call,readSnapshot,getSnapshot,onError=()=>{},onAge=()=>{},canRun=()=>true,signal,clock={setTimeout,clearTimeout},interval=5000,initialDelay=1500}){
  let enabled=false,disposed=false,timer=null,inflight=null,pending=null,failures=0;
  const clear=()=>{if(timer!==null){clock.clearTimeout(timer);timer=null;}};
  const alive=()=>!disposed&&!signal?.aborted;
  function adoptPending(){if(pending)return;const task=getSnapshot()?.recent_requests?.find(item=>item.operation==='status'&&['pending','dispatched'].includes(item.state)&&/^[a-f0-9]{32}$/.test(item.id||''));if(task)pending=task.id;}
  function schedule(delay=interval){clear();if(!enabled||!alive()||!canRun())return;timer=clock.setTimeout(function inventoryTick(){timer=null;onAge();void refresh().catch(()=>{});schedule(interval);},delay);}
  async function cycle(){
    onAge();let snapshot=getSnapshot();
    // The relay heartbeat must also be observed while no local relay is connected.
    if(!snapshot?.relay?.connected){snapshot=await readSnapshot();if(!alive())return snapshot;if(!snapshot?.relay?.connected)return snapshot;}
    adoptPending();
    if(!pending){const queued=await call('get_fm1_status',{},signal);if(!alive())return;const id=queued?.request_id;if(!/^[a-f0-9]{32}$/.test(id||''))throw new Error('The status refresh did not return a saved request ID.');pending=id;}
    const id=pending,delivery=await call('get_fm1_request',{request_id:id},signal);if(!alive())return;
    if(delivery.id!==id||delivery.operation!=='status')throw new Error('The status response did not match its saved request.');
    if(['pending','dispatched'].includes(delivery.state)){onAge();return delivery;}
    if(!['succeeded','failed','unknown'].includes(delivery.state))throw new Error('The status request returned an unknown delivery state.');
    pending=null;const latest=await readSnapshot();if(!alive())return latest;
    if(delivery.state!=='succeeded')throw new Error(delivery.error||'The latest device observation was unavailable.');
    return latest;
  }
  function refresh({manual=false}={}){
    if(!alive()||!canRun({manual}))return Promise.resolve(getSnapshot());
    if(inflight)return inflight;clear();
    inflight=(async()=>{try{const result=await cycle();failures=0;return result;}catch(error){if(alive()){failures++;onError(error,pending);}throw error;}finally{inflight=null;if(alive()){onAge();schedule(Math.min(60000,interval*2**Math.min(failures,4)));}}})();schedule(interval);return inflight;
  }
  function start(){if(enabled||!alive())return;enabled=true;schedule(initialDelay);}
  function wake(){clear();if(!alive())return;onAge();if(enabled&&canRun())void refresh().catch(()=>{});}
  function pause(){clear();if(alive())onAge();}
  function close(){if(disposed)return;disposed=true;enabled=false;clear();}
  signal?.addEventListener('abort',close,{once:true});
  return {start,refresh,wake,pause,close,get pendingRequestId(){return pending;},get inFlight(){return !!inflight;}};
}
export {inventoryFreshness,createInventoryMonitor};
export const inventoryRuntime='window.FM1Inventory={freshness:'+inventoryFreshness.toString()+',monitor:'+createInventoryMonitor.toString()+'};';
