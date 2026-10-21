import {mountDesktopCustomUi} from './fm1-desktop-custom-ui.mjs';

/** Foreground controls for the bundled native MCP server.
 * Mounting reads a saved writer receipt only; connections and writes require a
 * trusted action. The native server owns transfers across panel lifetimes.
 */
const TRANSPORTS=Object.freeze(['stock-midi','firmware-midi','serial']);
const BUTTONS=Object.freeze({'stock-midi':'direct-connect-midi','firmware-midi':'direct-connect-common',serial:'direct-connect-serial'});
const LABELS=Object.freeze({'stock-midi':'stock MIDI','firmware-midi':'firmware MIDI',serial:'USB serial'});
const UPDATE_CONTROLS=Object.freeze(['direct-stock-file','direct-stock-review','direct-stock-recovery','direct-review-confirm','direct-common-manifest','direct-common-file','direct-common-review','direct-common-confirm','install-diagnostics','stock-update']);
const RAW_BYTES=699956,MAX_CHUNK_BYTES=65536;
const trusted=event=>event?.isTrusted===true;
const printable=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!Array.from(value).some(character=>{const point=character.codePointAt(0);return point<32||point>=127&&point<=159||point>=0x202a&&point<=0x202e||point>=0x2066&&point<=0x2069;});
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
function transports(value){
  if(!Array.isArray(value)||value.length>TRANSPORTS.length||new Set(value).size!==value.length||value.some(item=>!TRANSPORTS.includes(item)))throw new Error('The desktop device transport capabilities are invalid.');
  return [...value];
}
function errorText(error){
  const value=typeof error==='string'?error:typeof error?.message==='string'?error.message:'The desktop device operation could not be completed.';
  return Array.from(value.slice(0,512)).filter(character=>{const point=character.codePointAt(0);return point>=32&&!(point>=127&&point<=159)&&!(point>=0x202a&&point<=0x202e)&&!(point>=0x2066&&point<=0x2069);}).join('').slice(0,256)||'The desktop device operation could not be completed.';
}
function snapshot(value,expectedTransport){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.connected!=='boolean'||value.installationAvailable!==false)throw new Error('The desktop device response did not confirm the scoped device capabilities.');
  if(value.transport!==null&&!TRANSPORTS.includes(value.transport))throw new Error('The desktop device response has an invalid transport.');
  if(value.connected&&(!printable(value.identity)||value.transport===null||expectedTransport&&value.transport!==expectedTransport))throw new Error('The desktop device connection identity or transport is invalid.');
  if(value.profile!==undefined&&value.profile!==null&&!printable(value.profile)||value.loader!==undefined&&typeof value.loader!=='boolean')throw new Error('The desktop device identity details are invalid.');
  return {connected:value.connected,transport:value.connected?value.transport:null,identity:value.connected?value.identity:null,profile:value.connected?(value.profile??null):null,loader:value.connected&&value.loader===true,installationAvailable:false,
    ...(value.supportedTransports!==undefined?{supportedTransports:transports(value.supportedTransports)}:{}),lastError:value.lastError?errorText(value.lastError):null};
}
function checkedReview(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!validId(value.review_id)||!validId(value.job_id)||!['install','resume'].includes(value.operation)||
    ![value.product,value.input_name,value.output_name,value.identity].every(printable)||!(/^[a-f0-9]{64}$/.test(value.sha256))||value.raw_bytes!==RAW_BYTES||
    !Number.isSafeInteger(value.logical_bytes)||value.logical_bytes<1||value.logical_bytes>value.raw_bytes||typeof value.expires_at!=='string'||!Number.isFinite(Date.parse(value.expires_at)))throw new Error('The stock update review is invalid. Review the package and device again.');
  return Object.fromEntries(['review_id','job_id','operation','product','sha256','raw_bytes','logical_bytes','input_name','output_name','identity','expires_at'].map(key=>[key,value[key]]));
}
function checkedAttempt(value){
  if(value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||!validId(value.job_id)||!['prepared','active','unknown','succeeded','failed'].includes(value.state)||!printable(value.phase)||
    value.progress!==null&&!(Number.isFinite(value.progress)&&value.progress>=0&&value.progress<=1)||typeof value.transfer_finished!=='boolean'||typeof value.boot_identity_verified!=='boolean'||
    value.readback_verified!==false||typeof value.recovery_required!=='boolean'||value.error_code!==undefined&&value.error_code!==null&&!printable(value.error_code))throw new Error('The native stock transfer receipt is invalid. Refresh the original job status.');
  return Object.fromEntries(['job_id','state','phase','progress','transfer_finished','boot_identity_verified','readback_verified','recovery_required','error_code'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
}
function base64(bytes){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let result='';
  for(let index=0;index<bytes.length;index+=3){const a=bytes[index],b=bytes[index+1],c=bytes[index+2];result+=alphabet[a>>2]+alphabet[((a&3)<<4)|((b??0)>>4)]+(index+1<bytes.length?alphabet[((b&15)<<2)|((c??0)>>6)]:'=')+(index+2<bytes.length?alphabet[c&63]:'=');}
  return result;
}

export function mountDesktopDevicesUi({el,call,runtime=globalThis,signal,onChange=()=>{},supportedTransports=[],stockUpdateAvailable=false,customUpdateAvailable=false,pollIntervalMs=3000,desktopPlatform='win32'}={}){
  const desktopLabel=desktopPlatform==='darwin'?'macOS':'Windows';
  if(typeof el!=='function'||typeof call!=='function')throw new TypeError('Desktop device controls require the panel elements and fixed MCP tool caller.');
  if(!Number.isInteger(pollIntervalMs)||pollIntervalMs<1000||pollIntervalMs>60000)throw new RangeError('Desktop status polling must be 1000–60000 milliseconds.');
  const stockCapability=stockUpdateAvailable===true,customCapability=customUpdateAvailable===true;
  let available=transports(supportedTransports),current={connected:false,transport:null,identity:null,profile:null,loader:false,installationAvailable:false,lastError:null},closed=false,busy=false,checking=false,routineChecking=false,epoch=0,timer=null,pollPaused=false,notice='';
  let writerLoaded=!stockCapability,writerKnown=!stockCapability,writerSupported=false,writing=false,starting=false,attempt=null,review=null,operationStatus=null,selected=null,metadata=null,fileEpoch=0,selecting=false,custom=null;
  const put=(id,text)=>{const node=el(id);if(node&&node.textContent!==text)node.textContent=text;};
  const clearTimer=()=>{if(timer!==null){if(typeof runtime.clearTimeout==='function')runtime.clearTimeout(timer);else globalThis.clearTimeout(timer);timer=null;}};
  const deviceKey=()=>JSON.stringify([current.connected,current.transport,current.identity,current.profile,current.loader]);
  const stockConnected=()=>current.connected&&current.transport==='stock-midi';
  const unresolved=()=>attempt&&(attempt.recovery_required||['prepared','active','unknown'].includes(attempt.state));
  const writerBlocked=()=>stockCapability&&(!writerLoaded||!writerKnown||writing||starting)||custom?.blocksDevice();
  const anyWriting=()=>writing||starting||custom?.isWriting();
  const canUseStock=()=>stockCapability&&writerKnown&&writerSupported;
  const validReview=()=>review&&!custom?.hasUnresolved()&&Date.parse(review.expires_at)>Date.now()&&review.deviceKey===deviceKey()&&review.fileEpoch===fileEpoch&&stockConnected()&&(review.operation==='resume'?current.loader:!current.loader);
  function clearReview(){review=null;try{el('direct-stock-dialog')?.close?.();}catch{}}
  function clearAllReviews(){clearReview();custom?.clearReview();}
  const label=()=>current.connected?'FM-1 via '+LABELS[current.transport]+' · '+(current.profile||current.identity):'FM-1 disconnected';
  const summary=()=>current.connected?(canUseStock()&&current.transport==='stock-midi'?(current.loader?'OTA loader identity confirmed. Review the original transfer recovery.':'Stock firmware identity confirmed. Review the official V15 package to update.'):(current.loader?'OTA loader identity confirmed. Native firmware installation is unavailable.':'Firmware identity confirmed through the desktop plugin. Device installation remains unavailable.')):'Choose a supported connection. The desktop plugin checks the selected FM-1 identity.';
  function paint(){
    if(closed)return;
    put('device-heading',label());put('device-summary',summary());put('physical-device',label());
    put('connection-label',current.connected?'Device connected':'Device disconnected');
    const badge=el('connection');if(badge)badge.className='badge'+(current.connected?' online':'');
    const indicator=el('connection-check');if(indicator)indicator.hidden=!checking||runtime.document?.hidden===true;
    put('update-mode',current.connected?LABELS[current.transport]+(canUseStock()&&current.transport==='stock-midi'?' · official V15 updates':' · desktop read-only'):'Not connected');
    put('inventory-freshness',desktopLabel+' desktop plugin connection');
    for(const transport of TRANSPORTS){const node=el(BUTTONS[transport]);if(node)node.disabled=busy||writerBlocked()||!available.includes(transport);}
    const disconnect=el('direct-disconnect');if(disconnect)disconnect.disabled=busy||writerBlocked()||!current.connected;
    for(const id of UPDATE_CONTROLS){const node=el(id);if(node)node.disabled=true;}
    for(const id of ['direct-stock-recovery','direct-transfer','direct-common-transfer']){const node=el(id);if(node)node.hidden=true;}
    const capabilities=available.length?'Available: '+available.map(transport=>LABELS[transport]).join(', ')+'.':'Device transport capabilities are unavailable. Use Refresh to check the desktop server.';
    put('direct-device-note',notice||'Device access runs through the bundled '+desktopLabel+' plugin server. '+capabilities);
    const qualification='Desktop firmware installation is unavailable until the native transfer and recovery path is qualified. Connection checks do not write firmware.';
    put('direct-stock-note',qualification);put('direct-common-note',qualification);put('direct-package-summary','Native device connection only · package installation disabled.');put('direct-common-summary','Native device connection only · package installation disabled.');
    put('direct-hardware-note','Desktop connections use fixed MCP device tools. Browser MIDI, serial and USB permissions are not used.');
    if(stockCapability){
      const blocked=busy||writerBlocked()||selecting;
      const file=el('direct-stock-file');if(file)file.disabled=busy&&!routineChecking||writerBlocked()||selecting||!canUseStock()||!current.connected;
      const stageButton=el('direct-stock-review');if(stageButton)stageButton.disabled=blocked||!canUseStock()||custom?.hasUnresolved()||!selected||!stockConnected()||current.loader||!!unresolved();
      const recover=el('direct-stock-recovery');if(recover){recover.hidden=!unresolved();recover.disabled=blocked||!canUseStock()||custom?.hasUnresolved()||!stockConnected()||!current.loader;}
      const confirm=el('direct-review-confirm');if(confirm)confirm.disabled=blocked||!canUseStock()||!validReview();
      put('direct-package-summary',selecting?'Reading the selected package…':metadata?metadata.product+' · '+metadata.raw_bytes+' bytes\nSHA256 '+metadata.sha256:selected?'Selected '+selected.name+' · '+selected.bytes.length+' bytes. Review uploads this package to the bundled local plugin for validation.':'Select the official V15 .fwsc package. Review sends it only to the bundled local plugin.');
      put('direct-stock-note',!writerLoaded||!writerKnown?'Native updater status is unavailable. Use Refresh before selecting or starting an update.':!writerSupported?'This desktop server does not expose the stock updater.':writing||starting?'The native plugin owns this transfer. Keep USB connected. Closing the panel does not cancel the job.':unresolved()?(stockConnected()&&current.loader?'Review recovery to continue only the original saved transfer.':'The original transfer is unresolved. Connect stock MIDI to the original FM-1 in OTA mode, then review recovery.'):current.loader?'A new update cannot start in OTA mode. Use the original saved transfer recovery.':metadata?'Official V15 package validated by the local plugin. Confirm the reviewed device and package before writing.':'Connect stock MIDI, select the official V15 package, then review it.');
      put('direct-common-note',customCapability?'The common-MIDI ARM updater remains unavailable. Use Custom firmware update · SysEx for a reviewed custom FWSC package.':'Custom firmware installation remains unavailable. The native writer supports only the reviewed official V15 package.');
      const transfer=el('direct-transfer');if(transfer)transfer.hidden=!attempt;
      if(attempt){
        put('direct-transfer-status',operationStatus==='succeeded'?'Transfer finished · reboot identity verified · full flash readback not performed':operationStatus==='running'?'Stock transfer in progress':operationStatus==='unknown'||unresolved()?'Original transfer requires attention. Review its status and recovery; do not start another update.':'Stock transfer stopped before completion.');
        const bar=el('direct-transfer-progress');if(bar){bar.hidden=!writing&&!starting;if(Number.isFinite(attempt.progress))bar.value=attempt.progress;else bar.removeAttribute?.('value');}
        put('direct-transfer-phase',[attempt.phase,Number.isFinite(attempt.progress)?Math.round(attempt.progress*100)+'% served':null,attempt.error_code?'Code: '+attempt.error_code:null].filter(Boolean).join(' · '));
      }
    }
    custom?.paint();
    onChange({connected:current.connected,transport:current.transport,profile:current.profile||current.identity,checking,writing:!!anyWriting(),label:label(),installationAvailable:false});
  }
  function schedule(){
    clearTimer();if(closed||busy||pollPaused||runtime.document?.hidden)return;
    if(!current.connected&&!anyWriting())return;
    const check=()=>{timer=null;void (anyWriting()?refreshWriter():refresh()).catch(()=>{});};
    timer=typeof runtime.setTimeout==='function'?runtime.setTimeout(check,pollIntervalMs):globalThis.setTimeout(check,pollIntervalMs);
  }
  function applyWriter(reply,{expectedJob,start=false}={}){
    if(!reply||typeof reply!=='object'||Array.isArray(reply)||!start&&typeof reply.supported!=='boolean'||typeof reply.writing!=='boolean'||!Object.hasOwn(reply,'attempt')||!Object.hasOwn(reply,'review'))throw new Error('The native stock updater status is invalid. Refresh the original job status.');
    const next=checkedAttempt(reply.attempt),remoteReview=reply.review===null?null:checkedReview(reply.review);
    const original=expectedJob||(writing||starting||unresolved()?attempt?.job_id:null);
    if(original&&next?.job_id!==original)throw new Error('The native updater did not return the original transfer. Refresh its saved status.');
    // The async engine may not have committed active when start() returns.
    const pendingStart=next?.state==='prepared'&&next.phase==='prepared';
    // Durable terminal evidence precedes async session/journal release. The
    // writer still owns the job until its writing flag clears.
    const pendingCleanup=next&&['succeeded','failed','unknown'].includes(next.state);
    if(reply.writing&&(!next||next.state!=='active'&&!pendingStart&&!pendingCleanup))throw new Error('The native updater returned inconsistent transfer activity.');
    if(start&&remoteReview!==null)throw new Error('The native updater did not consume the reviewed transfer.');
    writerLoaded=true;writerKnown=true;writerSupported=start?writerSupported:reply.supported;
    writing=reply.writing;attempt=next;
    if(attempt&&(attempt.state==='succeeded'&&(!attempt.transfer_finished||!attempt.boot_identity_verified||attempt.recovery_required)||attempt.state==='active'&&!writing)){
      attempt={...attempt,state:'unknown',recovery_required:true,error_code:'completion_unverified'};notice='Transfer completion proof is incomplete. Inspect the original native transfer.';
    }
    operationStatus=attempt?(attempt.state==='active'||writing&&(pendingStart||attempt.state==='succeeded')?'running':attempt.state):null;
    if(review&&remoteReview?.review_id!==review.review_id)clearReview();
  }
  async function work(fn,{check=false,writer=false,routine=false}={}){
    if(closed||busy)return;
    clearTimer();busy=true;checking=check;routineChecking=routine;notice='';const ticket=++epoch;paint();
    try{const result=await fn(()=>!closed&&ticket===epoch);if(closed||ticket!==epoch)return;pollPaused=false;return result;}
    catch(error){if(closed||ticket!==epoch)return;pollPaused=true;if(writer)writerKnown=false;notice=errorText(error)+(current.connected&&!writer?' Last confirmed identity retained; use Refresh to check again.':'');throw error;}
    finally{if(!closed&&ticket===epoch){busy=false;checking=false;routineChecking=false;paint();schedule();}}
  }
  function connect(transport,event){
    if(!trusted(event)||closed||busy||writerBlocked())return;
    if(!available.includes(transport)){notice='This desktop build does not support '+LABELS[transport]+'.';paint();return;}
    clearAllReviews();return work(async alive=>{const reply=await call('connect_fm1_device',{transport},signal);if(!alive())return;const next=snapshot(reply,transport),nextAvailable=next.supportedTransports??available;if(next.connected&&!nextAvailable.includes(next.transport))throw new Error('The desktop server reported a connection through an unavailable transport.');available=nextAvailable;current=next;notice=next.lastError||'';return {...current,supportedTransports:[...available]};},{check:true});
  }
  const connectSerial=event=>connect('serial',event),connectMidi=event=>connect('stock-midi',event),connectCommon=event=>connect('firmware-midi',event);
  async function loadWriters(alive){
    let failure;
    if(stockCapability){try{const reply=await call('get_fm1_stock_update_status',{},signal);if(!alive())return;applyWriter(reply);}catch(error){writerKnown=false;failure=error;}}
    if(customCapability&&alive()){try{await custom.loadStatus(alive);}catch(error){failure??=error;}}
    if(failure)throw failure;
  }
  function refreshWriter(){if(!stockCapability&&!customCapability)return Promise.resolve();return work(loadWriters,{check:true,writer:true,routine:true});}
  function refresh(){return work(async alive=>{if(stockCapability||customCapability){await loadWriters(alive);if(!alive()||anyWriting())return;}const reply=await call('get_fm1_device_status',{},signal);if(!alive())return;const next=snapshot(reply),nextAvailable=next.supportedTransports??available;if(next.connected&&!nextAvailable.includes(next.transport))throw new Error('The desktop server reported a connection through an unavailable transport.');if(deviceKey()!==JSON.stringify([next.connected,next.transport,next.identity,next.profile,next.loader]))clearAllReviews();available=nextAvailable;current=next;notice=next.lastError||'';return {...current,supportedTransports:[...available]};},{check:true,writer:stockCapability||customCapability,routine:true});}
  function disconnect(event){if(!trusted(event)||closed||busy||writerBlocked()||!current.connected)return;clearAllReviews();return work(async alive=>{const reply=await call('disconnect_fm1_device',{},signal);if(!alive())return;current=snapshot(reply);notice=current.lastError||'';});}
  async function selectPackage(file,event){
    if(!trusted(event)||closed||busy&&!routineChecking||writerBlocked()||!canUseStock()||!current.connected)return;
    const ticket=++fileEpoch;clearReview();selected=null;metadata=null;selecting=true;notice='';paint();
    try{
      if(!file||!printable(file.name)||!file.name.toLowerCase().endsWith('.fwsc')||file.size!==RAW_BYTES||typeof file.arrayBuffer!=='function')throw new Error('Select the official V15 .fwsc package ('+RAW_BYTES+' bytes).');
      const buffer=await file.arrayBuffer();if(closed||ticket!==fileEpoch)return;
      if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==RAW_BYTES||file.size!==RAW_BYTES)throw new Error('The selected stock package size changed. Select it again.');
      selected={name:file.name,bytes:new Uint8Array(buffer).slice()};
    }catch(error){if(!closed&&ticket===fileEpoch)notice=errorText(error);throw error;}
    finally{if(!closed&&ticket===fileEpoch){selecting=false;paint();}}
  }
  function showReview(value,{resume=false,key,fileTicket}={}){
    const next=checkedReview(value);
    if(next.operation!==(resume?'resume':'install')||next.identity!==current.identity||Date.parse(next.expires_at)<=Date.now()||key!==deviceKey()||fileTicket!==fileEpoch||resume&&next.job_id!==attempt?.job_id)throw new Error('The stock device, package or review changed. Review it again.');
    review={...next,deviceKey:key,fileEpoch:fileTicket};metadata={product:next.product,raw_bytes:next.raw_bytes,sha256:next.sha256};
    put('direct-review-title',resume?'Recover original stock transfer':'Install official stock firmware');put('direct-review-confirm',resume?'Resume original transfer':'Install stock firmware');
    put('direct-review-text',[next.product,next.raw_bytes+' package bytes · '+next.logical_bytes+' logical bytes','SHA256 '+next.sha256,'Current identity: '+next.identity,'MIDI input: '+next.input_name,'MIDI output: '+next.output_name,'Original transfer: '+next.job_id,'Review expires: '+next.expires_at].join('\n'));
    el('direct-stock-dialog')?.showModal?.();return {...next};
  }
  function stage(event,{resume=false}={}){
    if(!trusted(event)||closed||busy||writerBlocked()||custom?.hasUnresolved()||selecting||!canUseStock()||!stockConnected())return;
    if(resume?(!unresolved()||!current.loader):(!selected||current.loader||unresolved()))return;
    const key=deviceKey(),fileTicket=fileEpoch,packageBytes=selected?.bytes,jobId=attempt?.job_id;clearAllReviews();
    return work(async alive=>{
      let reply;
      if(resume)reply=await call('review_fm1_stock_recovery',{job_id:jobId},signal);
      else{
        const upload=await call('begin_fm1_stock_upload',{raw_bytes:packageBytes.length},signal);if(!alive())return;
        if(!validId(upload?.upload_id)||!Number.isSafeInteger(upload.max_chunk_bytes)||upload.max_chunk_bytes<1||upload.max_chunk_bytes>MAX_CHUNK_BYTES)throw new Error('The native plugin returned invalid stock upload limits.');
        for(let offset=0;offset<packageBytes.length;offset+=upload.max_chunk_bytes){
          const chunk=packageBytes.subarray(offset,Math.min(packageBytes.length,offset+upload.max_chunk_bytes));
          const accepted=await call('append_fm1_stock_upload',{upload_id:upload.upload_id,offset,data_base64:base64(chunk)},signal);if(!alive())return;
          if(accepted?.upload_id!==upload.upload_id||accepted.received_bytes!==offset+chunk.length)throw new Error('The stock package upload acknowledgement changed. Review a fresh upload; no chunk is retried automatically.');
        }
        reply=await call('review_fm1_stock_update',{upload_id:upload.upload_id},signal);
      }
      if(!alive())return;return showReview(reply?.review,{resume,key,fileTicket});
    });
  }
  function confirm(event){
    if(!trusted(event)||closed||busy||writerBlocked()||custom?.hasUnresolved()||!canUseStock()||!review)return;
    if(!validReview()){clearReview();notice='The selected device, package or review expired. Review it again.';paint();return;}
    const selectedReview=review;clearAllReviews();starting=true;operationStatus='running';
    attempt={job_id:selectedReview.job_id,state:'prepared',phase:'Starting reviewed transfer',progress:null,transfer_finished:false,boot_identity_verified:false,readback_verified:false,recovery_required:false};
    return work(async alive=>{
      try{
        // The server owns the transfer. Panel abort/teardown must not cancel this RPC.
        const reply=await call('start_fm1_stock_update',{review_id:selectedReview.review_id,confirmed:true},null);if(!alive())return;
        applyWriter(reply,{expectedJob:selectedReview.job_id,start:true});
      }catch(error){if(alive()){attempt={...attempt,state:'unknown',phase:'Start outcome unavailable',recovery_required:true,error_code:'start_outcome_unknown'};operationStatus='unknown';writerKnown=false;}throw error;}
      finally{if(alive())starting=false;}
    });
  }
  function cancel(){if(closed)return;clearReview();paint();}
  function visibility(){if(runtime.document?.hidden){clearTimer();paint();}else{paint();schedule();}}
  function dispose(){if(closed)return;closed=true;++epoch;++fileEpoch;clearReview();custom?.dispose();clearTimer();runtime.document?.removeEventListener?.('visibilitychange',visibility);runtime.removeEventListener?.('pagehide',dispose);signal?.removeEventListener?.('abort',dispose);el('direct-stock-dialog')?.removeEventListener?.('cancel',cancel);}
  for(const transport of TRANSPORTS){const node=el(BUTTONS[transport]);if(node)node.onclick=event=>{void Promise.resolve(connect(transport,event)).catch(()=>{});};}
  const disconnectButton=el('direct-disconnect');if(disconnectButton)disconnectButton.onclick=event=>{void Promise.resolve(disconnect(event)).catch(()=>{});};
  for(const id of UPDATE_CONTROLS){const node=el(id);if(node){node.onclick=()=>{};node.onchange=()=>{};}}
  if(stockCapability){
    const clicked=fn=>event=>{if(trusted(event))void Promise.resolve(fn(event)).catch(()=>{});};
    const file=el('direct-stock-file');if(file)file.onchange=event=>{if(trusted(event))void selectPackage(file.files?.[0],event).catch(()=>{});};
    const stageButton=el('direct-stock-review');if(stageButton)stageButton.onclick=clicked(event=>stage(event));
    const recover=el('direct-stock-recovery');if(recover)recover.onclick=clicked(event=>stage(event,{resume:true}));
    const confirmButton=el('direct-review-confirm');if(confirmButton)confirmButton.onclick=clicked(confirm);
    const cancelButton=el('direct-review-cancel');if(cancelButton)cancelButton.onclick=cancel;
    el('direct-stock-dialog')?.addEventListener?.('cancel',cancel);
  }
  custom=mountDesktopCustomUi({el,call,signal,enabled:customCapability,context:()=>({connected:current.connected,transport:current.transport,identity:current.identity,loader:current.loader,deviceKey:deviceKey(),busy,routineChecking,stockWriting:writing||starting,stockUnresolved:!!unresolved(),stockReady:!stockCapability||writerLoaded&&writerKnown}),runExclusive:work,clearOtherReview:clearReview,onChange:()=>{if(custom?.isWriting())clearReview();paint();schedule();}});
  runtime.document?.addEventListener?.('visibilitychange',visibility);runtime.addEventListener?.('pagehide',dispose,{once:true});signal?.addEventListener?.('abort',dispose,{once:true});
  paint();if(signal?.aborted)dispose();
  const ready=(stockCapability||customCapability)&&!closed?refreshWriter().catch(()=>{}):Promise.resolve();
  return {paint,refresh,refreshWriter,connectSerial,connectMidi,connectCommon,disconnect,selectPackage,stage,confirm,cancel,dispose,ready,custom,state:()=>({connected:current.connected,transport:current.transport,identity:current.identity,profile:current.profile,loader:current.loader,installationAvailable:false,stockUpdateAvailable:canUseStock(),supportedTransports:[...available],label:label(),busy,checking,routineChecking,writing:!!anyWriting(),operationStatus,attempt:attempt?{...attempt}:null,review:review?{...review}:null,custom:custom?.state()??null})};
}
if(typeof window!=='undefined')window.FM1DesktopDevicesUI={mount:mountDesktopDevicesUi};
