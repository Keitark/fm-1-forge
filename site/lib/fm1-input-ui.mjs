/** Sampled, read-only activity. This module never changes firmware or volume. */
export const INPUT_KEY_LABELS = ['OCT−','OCT+','FX','SCL','ENV','LFO','EDIT','GLO','HOME','SAVE','ARP','SEQ','PLAY','REC',...Array.from({length:27},(_,index)=>{const note=53+index;return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][note%12]+(Math.floor(note/12)-1);})];
export const INPUT_ENCODER_NAMES = ['SELECT','ALGORITHM','KNOB1','KNOB2','KNOB3','KNOB4','PRESETS'];

function normalizeInputSample(value){
  const uint=n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
  const exact=(item,fields)=>item&&typeof item==='object'&&!Array.isArray(item)&&Object.keys(item).length===fields.length&&fields.every(field=>Object.hasOwn(item,field));
  if(!exact(value,['state','firmware','port','capabilities','keys','encoders','volume','observation','message'])||!['available','unsupported','unavailable','busy'].includes(value.state)||!exact(value.capabilities,['keys','encoders','volume'])||['keys','encoders','volume'].some(name=>typeof value.capabilities[name]!=='boolean'))return null;
  if(value.firmware!==null&&!['FM1-FORGE/1','MOD-EDITOR/1'].includes(value.firmware)||value.port!==null&&(typeof value.port!=='string'||!/^COM[1-9][0-9]{0,3}$/.test(value.port)))return null;
  if(typeof value.message!=='string'||value.message.length>250||/(?:[a-z]:[\\/]|\\\\|Bearer\s)/i.test(value.message))return null;
  const observation=value.observation;
  if(!exact(observation,['started_at','completed_at'])||!Number.isSafeInteger(observation.started_at)||observation.started_at<=0||!Number.isSafeInteger(observation.completed_at)||observation.completed_at<observation.started_at||observation.completed_at-observation.started_at>3)return null;
  const cap=value.capabilities,keys=value.keys,encoders=value.encoders,volume=value.volume;
  // The firmware exposes 41 inputs. Reject masks containing imaginary controls.
  const mask=hex=>typeof hex==='string'&&/^[a-fA-F0-9]{16}$/.test(hex)&&parseInt(hex.slice(0,5),16)===0&&parseInt(hex[5],16)<=1;
  if(cap.keys?(value.firmware!=='FM1-FORGE/1'||!exact(keys,['pressed','seen','scans','errors'])||!mask(keys.pressed)||!mask(keys.seen)||!uint(keys.scans)||!uint(keys.errors)):keys!==null)return null;
  if(cap.encoders){if(value.firmware!=='FM1-FORGE/1'||!Array.isArray(encoders)||encoders.length!==7)return null;for(const [id,encoder] of encoders.entries()){if(!exact(encoder,['id','name','edges','invalid','seen'])||encoder.id!==id||encoder.name!==INPUT_ENCODER_NAMES[id]||!Number.isInteger(encoder.edges)||encoder.edges< -0x80000000||encoder.edges>0x7fffffff||!uint(encoder.invalid)||typeof encoder.seen!=='boolean')return null;}}
  else if(encoders!==null)return null;
  if(cap.volume?(value.firmware===null||!exact(volume,['value','gain','valid','samples','errors'])||!Number.isInteger(volume.value)||volume.value<0||volume.value>1023||!Number.isInteger(volume.gain)||volume.gain<0||volume.gain>127||typeof volume.valid!=='boolean'||!uint(volume.samples)||!uint(volume.errors)):volume!==null)return null;
  if(value.state==='available'&&(!cap.keys||!cap.encoders||!cap.volume)||value.state==='unsupported'&&(cap.keys||cap.encoders)||['unavailable','busy'].includes(value.state)&&Object.values(cap).some(Boolean))return null;
  return {state:value.state,firmware:value.firmware,port:value.port,capabilities:{...cap},keys:keys?{...keys,pressed:keys.pressed.toLowerCase(),seen:keys.seen.toLowerCase()}:null,encoders:encoders?[...encoders].sort((a,b)=>a.id-b.id).map(item=>({...item})):null,volume:volume?{...volume}:null,observation:{...observation}};
}
function inputFreshness(snapshot,now=Date.now()){
  const activity=snapshot?.input_activity||{},sample=normalizeInputSample(activity.sample),observed=activity.observed_at,received=snapshot?._input_received_at,base=activity.age_seconds;
  const requestId=/^[a-f0-9]{32}$/.test(activity.request_id||'')?activity.request_id:null;
  const valid=sample&&requestId&&Number.isFinite(observed)&&observed>0&&Number.isFinite(received)&&received<=now&&Number.isFinite(base)&&base>=0&&sample.observation.completed_at<=observed&&observed<=received/1000&&observed<=now/1000;
  const age=valid?Math.max(base+(now-received)/1000,now/1000-sample.observation.started_at,now/1000-observed):null;
  const limit=Math.min(15,Number.isFinite(activity.max_age_seconds)&&activity.max_age_seconds>0?activity.max_age_seconds:15);
  const fresh=!!valid&&activity.state==='fresh'&&!!snapshot?.relay?.connected&&age<=limit;
  return {sample,fresh,age,observed:valid?observed:null,state:fresh?'fresh':activity.state==='error'?'error':sample?'stale':'unavailable',requestId};
}
function createInputView(){
  let previous=null,lastRequest=null,lastModel=null;
  const bit=(hex,index)=>!!(parseInt(hex[15-Math.floor(index/4)],16)&(1<<(index%4)));
  return {read(snapshot,now=Date.now()){
    const fresh=inputFreshness(snapshot,now),sample=fresh.sample;
    if(!fresh.fresh||!['available','unsupported'].includes(sample?.state)){previous=null;lastRequest=null;lastModel=null;return {...fresh,keys:INPUT_KEY_LABELS.map((label,id)=>({id,label,held:false,seen:!!sample?.keys&&bit(sample.keys.seen,id),available:false})),encoders:INPUT_ENCODER_NAMES.map((name,id)=>({id,name,edges:null,delta:null,invalid:null,seen:false,available:false})),volume:null};}
    if(lastRequest===fresh.requestId&&lastModel)return {...lastModel,...fresh};
    const same=previous&&now/1000-previous.observation.started_at<=15&&previous.firmware===sample.firmware&&previous.port===sample.port&&previous.observation.completed_at<=sample.observation.started_at&&(!sample.keys||!previous.keys||sample.keys.scans>=previous.keys.scans)&&(!sample.volume||!previous.volume||sample.volume.samples>=previous.volume.samples);
    const model={...fresh,keys:INPUT_KEY_LABELS.map((label,id)=>({id,label,held:!!sample.keys&&bit(sample.keys.pressed,id),seen:!!sample.keys&&bit(sample.keys.seen,id),available:!!sample.capabilities.keys})),encoders:INPUT_ENCODER_NAMES.map((name,id)=>{const value=sample.encoders?.[id],before=same&&previous.encoders?.[id],difference=before&&value&&value.invalid>=before.invalid?value.edges-before.edges:null;return {id,name,edges:value?.edges??null,delta:difference!==null&&difference>=-0x80000000&&difference<=0x7fffffff?difference:null,invalid:value?.invalid??null,seen:value?.seen??false,available:!!sample.capabilities.encoders};}),volume:sample.volume?.valid?sample.volume:null};
    previous=sample;lastRequest=fresh.requestId;lastModel=model;return model;
  },reset(){previous=null;lastRequest=null;lastModel=null;}};
}
function inputBlockReason(snapshot){
  if(!snapshot?.relay?.connected)return 'Bench relay offline';
  const inventory=snapshot.inventory,engine=inventory?.engine||inventory,device=inventory?.device;
  if(engine?.active)return 'Bench job active';
  if(engine?.blocked_unknown||engine?.storage_fault||engine?.updater_handoff)return 'Resolve the saved bench job';
  const session=device?.session;
  if(session&&(session.operation!=='idle'||session.blocked||session.stopped||session.reset_pending||session.needs_observation||session.loader_running))return 'Protected session unavailable';
  return null;
}
function createInputMonitor({call,readSnapshot,getSnapshot,onError=()=>{},onAge=()=>{},onState=()=>{},canRun=()=>true,signal,clock={setTimeout:(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout:timer=>globalThis.clearTimeout(timer)},interval=5000,pendingInterval=1000}){
  let enabled=false,disposed=false,timer=null,ageTimer=null,inflight=null,pending=null,error=false,paused=false;
  const alive=()=>!disposed&&!signal?.aborted;
  const clear=()=>{if(timer!==null){clock.clearTimeout(timer);timer=null;}};
  const clearAge=()=>{if(ageTimer!==null){clock.clearTimeout(ageTimer);ageTimer=null;}};
  const notify=()=>onState({enabled,pending,error,paused:enabled&&(paused||!canRun()||!!inputBlockReason(getSnapshot()))});
  function ageTick(){clearAge();if(!alive()||!enabled)return;ageTimer=clock.setTimeout(function inputAgeTick(){ageTimer=null;onAge();notify();ageTick();},1000);}
  function schedule(delay){clear();if(!alive()||!enabled||!canRun())return;timer=clock.setTimeout(function inputTick(){timer=null;void refresh().catch(()=>{});},delay);}
  function adoptPending(snapshot){if(pending)return;const task=snapshot?.recent_requests?.find(item=>item.operation==='input_snapshot'&&['pending','dispatched'].includes(item.state)&&/^[a-f0-9]{32}$/.test(item.id||''));if(task)pending=task.id;}
  async function cycle(){
    const snapshot=await readSnapshot();
    if(!alive()||!enabled||!canRun())return snapshot;
    adoptPending(snapshot);
    paused=!!inputBlockReason(snapshot);notify();if(paused)return snapshot;
    if(!pending){const queued=await call('get_fm1_input_snapshot',{},signal);if(!alive())return queued;if(!/^[a-f0-9]{32}$/.test(queued?.request_id||''))throw new Error('The activity request did not return a saved request ID.');pending=queued.request_id;notify();}
    if(!alive()||!enabled||!canRun()||inputBlockReason(getSnapshot()))return;
    const id=pending,delivery=await call('get_fm1_request',{request_id:id},signal);
    if(!alive())return delivery;
    if(delivery.id!==id||delivery.operation!=='input_snapshot')throw new Error('The activity response did not match its saved request.');
    if(['pending','dispatched'].includes(delivery.state))return delivery;
    if(!['succeeded','failed','unknown'].includes(delivery.state))throw new Error('The activity request returned an unknown delivery state.');
    pending=null;if(!enabled||!canRun())return delivery;
    const latest=await readSnapshot();if(delivery.state!=='succeeded')throw new Error('The activity sample is unavailable.');return latest;
  }
  function refresh(){
    if(!alive()||!enabled||!canRun())return Promise.resolve(getSnapshot());if(inflight)return inflight;clear();
    inflight=(async()=>{try{const result=await cycle();error=false;return result;}catch(cause){if(alive()){error=true;onError(cause,pending);}throw cause;}finally{inflight=null;if(alive()){onAge();notify();schedule(pending?pendingInterval:interval);}}})();return inflight;
  }
  function start(){if(!alive())return;if(enabled){wake();return;}enabled=true;paused=false;error=false;notify();ageTick();void refresh().catch(()=>{});}
  function stop(){enabled=false;paused=false;clear();clearAge();onAge();notify();}
  function pause(){clear();clearAge();paused=true;onAge();notify();}
  function wake(){if(!alive()||!enabled)return;paused=false;notify();ageTick();void refresh().catch(()=>{});}
  function close(){if(disposed)return;disposed=true;enabled=false;clear();clearAge();}
  signal?.addEventListener('abort',close,{once:true});
  return {start,stop,pause,wake,refresh,close,get enabled(){return enabled;},get pendingRequestId(){return pending;},get inFlight(){return !!inflight;},get paused(){return paused||!canRun()||!!inputBlockReason(getSnapshot());},get error(){return error;}};
}
function mountInputActivity({el,call,readSnapshot,getSnapshot,canRun,signal}){
  const view=createInputView();let monitor;
  const paint=()=>{
    const model=view.read(getSnapshot()),sample=model.sample,enabled=!!monitor?.enabled,blocked=inputBlockReason(getSnapshot());
    el('input-toggle').textContent=enabled?'Stop monitoring':'Start monitoring';el('input-toggle').setAttribute?.('aria-pressed',String(enabled));
    el('input-monitor-state').textContent=!enabled?'Monitoring paused':monitor.paused?'Monitoring paused · '+(blocked||'panel hidden or offline'):monitor.error?'Activity refresh unavailable · checking saved requests':monitor.pendingRequestId?'Waiting for saved sample':'Sampling every 5 seconds';
    el('input-freshness').textContent=model.fresh?'Sample '+Math.floor(model.age)+'s old · '+(sample.firmware||'Unknown firmware')+' · '+(sample.port||'No serial port'):model.age!==null?'Stale sample · '+Math.floor(model.age)+'s old':'No fresh hardware activity sample';
    const missing=sample?['keys','encoders','volume'].filter(name=>!sample.capabilities[name]):[];
    el('input-capabilities').textContent=sample?.state==='busy'?'The bench is busy. No activity sample was read.':sample?.state==='unavailable'?'Hardware activity is unavailable. Connect an FM1 serial device.':sample?.capabilities.volume&&!sample.capabilities.keys&&!sample.capabilities.encoders?'This firmware exposes volume only. Install Forge diagnostics through the reviewed install flow to inspect keys and encoders.':sample?.state==='unsupported'?'This firmware does not expose input activity. Install Forge diagnostics through the reviewed install flow.':missing.length?'Unavailable in this firmware: '+missing.join(', '):sample?'Keys, encoders and volume are exposed by this firmware.':'Start monitoring to check which inputs the running firmware exposes.';
    for(const key of model.keys){const node=el('input-key-'+key.id);node.dataset.held=String(key.held);node.dataset.seen=String(key.seen);node.dataset.available=String(key.available);node.textContent=key.label;node.setAttribute?.('aria-label',key.label+' · '+(!key.available?'unavailable':key.held?'held now':key.seen?'seen since boot':'not seen since boot'));}
    for(const encoder of model.encoders){el('input-encoder-edges-'+encoder.id).textContent=encoder.available?String(encoder.edges):'Unavailable';el('input-encoder-delta-'+encoder.id).textContent=encoder.delta===null?'—':(encoder.delta>0?'+':'')+encoder.delta;el('input-encoder-invalid-'+encoder.id).textContent=encoder.available?String(encoder.invalid):'—';el('input-encoder-seen-'+encoder.id).textContent=encoder.available?(encoder.seen?'Seen':'Not seen'):'—';}
    el('input-key-counts').textContent=model.fresh&&sample?.keys?'Scans '+sample.keys.scans+' · errors '+sample.keys.errors:'Key scan counters unavailable';
    const volume=model.volume;el('input-volume-gauge').value=volume?.value??0;el('input-volume-gauge').hidden=!volume;el('input-volume-value').textContent=volume?'ADC '+volume.value+'/1023 · gain '+volume.gain+'/127 · samples '+volume.samples+' · errors '+volume.errors:'Volume unavailable';
  };
  monitor=createInputMonitor({call,readSnapshot,getSnapshot,canRun,signal,onAge:paint,onState:paint,onError:()=>paint()});
  el('input-toggle').onclick=()=>{if(signal?.aborted)return;if(monitor.enabled){monitor.stop();view.reset();paint();}else monitor.start();};
  paint();return {paint,pause:()=>monitor.pause(),wake:()=>monitor.wake(),close:()=>monitor.close(),monitor};
}

export {normalizeInputSample,inputFreshness,createInputView,inputBlockReason,createInputMonitor,mountInputActivity};
export const inputHtml=`<section class="input-activity" aria-labelledby="input-title"><div class="input-heading"><div><div class="eyebrow">Hardware activity</div><h2 id="input-title">Sampled activity</h2></div><button class="secondary" type="button" id="input-toggle" aria-pressed="false">Start monitoring</button></div><p class="note" id="input-monitor-state" role="status">Monitoring paused</p><p class="note" id="input-freshness">No fresh hardware activity sample</p><p class="note" id="input-capabilities">Start monitoring to check which inputs the running firmware exposes.</p><div class="input-legend"><span class="input-held-dot"></span>Held in latest sample <span class="input-seen-dot"></span>Seen since firmware boot</div><h3>Buttons and piano keys</h3><div class="input-buttons">${INPUT_KEY_LABELS.slice(0,14).map((name,id)=>`<span class="input-key" id="input-key-${id}" data-held="false" data-seen="false" data-available="false">${name}</span>`).join('')}</div><div class="input-piano">${INPUT_KEY_LABELS.slice(14).map((name,index)=>`<span class="input-key${name.includes('♯')?' input-sharp':''}" id="input-key-${index+14}" data-held="false" data-seen="false" data-available="false">${name}</span>`).join('')}</div><p class="note" id="input-key-counts">Key scan counters unavailable</p><h3>Encoders</h3><div class="input-encoder-table" role="table" aria-label="Sampled encoder counters"><div role="row" class="input-encoder-row input-encoder-header"><span role="columnheader">Control</span><span role="columnheader">Edges</span><span role="columnheader">Δ sample</span><span role="columnheader">Invalid</span><span role="columnheader">Since boot</span></div>${INPUT_ENCODER_NAMES.map((name,id)=>`<div role="row" class="input-encoder-row"><strong role="rowheader">${name}</strong><span role="cell" id="input-encoder-edges-${id}">Unavailable</span><span role="cell" id="input-encoder-delta-${id}">—</span><span role="cell" id="input-encoder-invalid-${id}">—</span><span role="cell" id="input-encoder-seen-${id}">—</span></div>`).join('')}</div><h3>Volume knob</h3><meter id="input-volume-gauge" min="0" max="1023" value="0" aria-label="Volume ADC sample" hidden></meter><p class="note" id="input-volume-value">Volume unavailable</p><p class="note">This is sampled activity, not a live event stream. Brief presses can happen between samples. Seen indicators are latched by firmware since boot. Monitoring never changes firmware or volume. Finish local RAM imports or exports before starting.</p></section>`;
export const inputCss=String.raw`.input-activity{background:var(--header);color:var(--ink);border:1px solid var(--line);border-radius:13px;padding:20px;margin:0 0 22px}.input-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.input-heading h2{font-size:23px;margin:5px 0 0}.input-activity h3{font-size:13px;margin:18px 0 8px}.input-legend{display:flex;align-items:center;flex-wrap:wrap;gap:7px;font-size:11px;color:var(--muted);margin-top:12px}.input-held-dot,.input-seen-dot{display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--accent);border:1px solid var(--accent)}.input-seen-dot{background:transparent;margin-left:10px}.input-buttons,.input-piano{display:grid;grid-template-columns:repeat(14,minmax(0,1fr));gap:4px;margin:8px 0}.input-piano{grid-template-columns:repeat(14,minmax(0,1fr))}.input-key{display:grid;place-items:center;min-height:36px;border:1px solid var(--line);border-radius:4px;background:var(--paper);color:var(--muted);font-size:10px;font-weight:650}.input-piano .input-key{min-height:45px}.input-sharp{border-top-width:5px}.input-key[data-available="false"]{opacity:.55}.input-key[data-seen="true"]{border-color:var(--accent)}.input-key[data-held="true"]{background:var(--accent);color:var(--accent-ink);opacity:1}.input-encoder-table{border:1px solid var(--line);border-radius:7px;overflow:hidden}.input-encoder-row{display:grid;grid-template-columns:1.4fr 1fr .8fr .7fr 1fr;gap:8px;padding:7px 10px;font-size:11px;border-bottom:1px solid var(--line)}.input-encoder-row:last-child{border-bottom:0}.input-encoder-header{color:var(--muted);background:var(--paper)}.input-activity meter{display:block;width:100%;height:18px;accent-color:var(--accent)}.input-activity meter[hidden]{display:none}@media(max-width:560px){.input-buttons,.input-piano{grid-template-columns:repeat(7,minmax(0,1fr))}.input-activity{padding:16px}.input-encoder-row{gap:4px;padding:7px;font-size:10px}.input-heading{align-items:flex-start}.input-heading h2{font-size:20px}}`;
export const inputRuntime='(()=>{const INPUT_KEY_LABELS='+JSON.stringify(INPUT_KEY_LABELS)+',INPUT_ENCODER_NAMES='+JSON.stringify(INPUT_ENCODER_NAMES)+';'+[normalizeInputSample,inputFreshness,createInputView,inputBlockReason,createInputMonitor,mountInputActivity].map(fn=>fn.toString()).join('\n')+';window.FM1InputActivity={freshness:inputFreshness,view:createInputView,monitor:createInputMonitor,mount:mountInputActivity};})();';
