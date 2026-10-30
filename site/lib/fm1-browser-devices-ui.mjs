import { BrowserSerial } from './fm1-browser-serial.mjs';
import { createBrowserStockUpdater, STOCK, StockError } from './browser-stock/index.mjs';
import { browserHardwareCapabilities } from './fm1-browser-hardware.mjs';
import { commonDevicesHtml, commonDialogHtml, mountBrowserCommonUi } from './fm1-browser-common-ui.mjs';
import { createCommonUpdater, UpdateError } from './browser-common/index.mjs';

export const directDevicesCss=String.raw`.direct-devices{border:1px solid var(--line);background:var(--header);border-radius:13px;padding:18px;margin:0 0 20px}.direct-devices h2{margin-bottom:10px}.direct-buttons{display:flex;gap:8px;flex-wrap:wrap}.direct-stock{border-top:1px solid var(--line);margin-top:14px;padding-top:12px}.direct-stock>summary{cursor:pointer;font-weight:600;font-size:13px}.direct-stock input{margin-top:10px}.direct-stock-review{margin-top:12px}.direct-device-transfer{margin-top:14px;border-top:1px solid var(--line);padding-top:12px}.direct-device-transfer[hidden]{display:none}.direct-devices .note{overflow-wrap:anywhere}.direct-review-text{max-height:280px}.direct-buttons button{min-height:39px}`;
export const directDevicesHtml=String.raw`<section class="direct-devices" id="direct-devices" aria-label="Connect FM-1 directly"><h2>Connect FM-1</h2><div class="direct-buttons"><button class="primary" id="direct-connect-serial" type="button">Connect USB serial</button><button class="secondary" id="direct-connect-midi" type="button">Connect stock MIDI</button><button class="secondary" id="direct-connect-common" type="button">Connect firmware MIDI</button><button class="secondary" id="direct-disconnect" type="button" disabled>Disconnect</button></div><p class="note">Stock firmware: use Connect stock MIDI. USB serial and firmware MIDI require compatible custom firmware.</p><p class="note" id="direct-device-note" role="status" aria-live="polite">Choose a connection. Device access stays in this panel.</p><details class="direct-stock" id="direct-stock"><summary>Stock firmware · V15 SysEx update</summary><label class="note" for="direct-stock-file">Select the official V15 .fwsc package. The file stays in this panel.</label><input type="file" id="direct-stock-file" accept=".fwsc" aria-label="Official stock firmware package"><p class="digest" id="direct-package-summary">No package selected.</p><div class="direct-buttons direct-stock-review"><button class="secondary" id="direct-stock-review" type="button" disabled>Review stock update</button><button class="secondary" id="direct-stock-recovery" type="button" hidden disabled>Review original transfer recovery</button></div><p class="note" id="direct-stock-note">Connect stock MIDI and review the exact package before transferring.</p></details>${commonDevicesHtml}<section class="direct-device-transfer" id="direct-transfer" hidden aria-label="Current stock transfer"><h2>Stock firmware transfer</h2><p id="direct-transfer-status" role="status" aria-live="polite"></p><progress id="direct-transfer-progress" max="1" aria-label="Stock transfer progress"></progress><p class="note" id="direct-transfer-phase"></p></section></section><dialog id="direct-stock-dialog"><h2 id="direct-review-title">Review stock firmware</h2><p class="muted">This transfers the reviewed official package and restarts FM-1. Keep USB connected.</p><pre class="direct-review-text" id="direct-review-text"></pre><p class="note">Transfer completion and reboot identity are checked. Full flash readback is not provided.</p><div class="actions"><button class="secondary" id="direct-review-cancel" type="button">Cancel</button><button class="primary" id="direct-review-confirm" type="button">Install stock firmware</button></div></dialog>${commonDialogHtml}`;

const validId=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const pairKey=pair=>pair?JSON.stringify([pair.inputId,pair.outputId,pair.inputName,pair.outputName]):null;
const trusted=event=>event?.isTrusted===true;
const errorText=error=>typeof error?.message==='string'?error.message:'The device operation could not be completed.';
export function mountBrowserDevicesUi({el,runtime=globalThis,SerialClass=BrowserSerial,stockFactory=createBrowserStockUpdater,commonFactory=createCommonUpdater,
  capabilityReport=browserHardwareCapabilities(runtime),signal,onChange=()=>{},makeId=()=>runtime.crypto.randomUUID().replaceAll('-','')}={}){
  let closed=false,busy=false,checking=false,transport=null,label='FM-1 disconnected',summary='Connect USB serial, stock MIDI or firmware MIDI.',
    serialState={connected:false},stockState={connected:false,identityVerified:false},commonState={connected:false},common=null,packageFile=null,metadata=null,
    review=null,attempt=null,progress=null,operationStatus=null,notice='',connectionNotice='',fileEpoch=0,restoring=true;
  const stock=stockFactory({navigator:runtime.navigator,indexedDB:runtime.indexedDB,crypto:runtime.crypto,
    beforeWrite:requireNoCommonAttempt,
    onState:value=>{if(stockState.connected&&!value.connected&&transport==='midi')clearConnectionNotice();stockState=value;if(!busy&&transport==='midi')confirmed();paint();},
    onEvent:value=>{progress=value;paint();}});
  const serial=new SerialClass({serial:runtime.navigator?.serial,lifecycleTarget:runtime,
    onState:value=>{if(serialState.connected&&!value.connected&&transport==='serial')clearConnectionNotice();serialState=value;checking=!!(value.connecting||value.checking);if(!busy&&transport==='serial')confirmed();paint();}});
  const usable=name=>capabilityReport.secureContext&&capabilityReport[name]?.apiAvailable&&capabilityReport[name]?.policy!=='blocked';
  const isWriting=()=>operationStatus==='running'||stockState.updating===true||common?.isWriting()===true;
  const recoverable=()=>attempt&&['active','unknown'].includes(attempt.state);
  const durable=()=>stockState.storageScope?.durableReady===true&&stockState.storageScope?.locksAvailable===true;
  common=mountBrowserCommonUi({el,runtime,updaterFactory:commonFactory,makeId,
    context:()=>({active:transport==='common',busy,writing:isWriting(),recoveryOther:!!recoverable()||stockState.recoveryRequired===true||operationStatus==='unknown'}),
    runExclusive:work,beforeWrite:requireNoStockAttempt,onChange:value=>{if(commonState.connected&&!value.connected&&transport==='common')clearConnectionNotice();commonState=value;if(!busy&&transport==='common')confirmed();paint();}});
  function clearConnectionNotice(){if(notice===connectionNotice)notice='';connectionNotice='';}
  async function requireNoCommonAttempt(){
    let record;
    try{if(!common)throw new Error('Common storage is not initialized.');record=await common.peekSavedAttempt();}
    catch{throw new StockError('opposite_storage_unavailable','The custom firmware journal could not be checked. No stock transfer was started.');}
    if(record&&['prepared','active','unknown'].includes(record.state))throw new StockError('opposite_recovery_required','An original custom firmware update is unresolved. Inspect that attempt before a stock update.');
  }
  async function requireNoStockAttempt(){
    let record;
    try{record=await stock.savedAttempt();}
    catch{throw new UpdateError('opposite_storage_unavailable','The stock firmware journal could not be checked. No custom transfer was started.');}
    if(record&&['prepared','active','unknown'].includes(record.state))throw new UpdateError('opposite_recovery_required','An original stock firmware update is unresolved. Inspect that attempt before a custom update.');
  }
  function confirmed(){
    if(transport==='serial'&&serialState.connected&&serialState.profile){label='FM-1 via USB serial · '+serialState.profile;summary='Firmware identity confirmed. Hardware acceptance is separate.';}
    else if(transport==='midi'&&stockState.connected&&stockState.identityVerified){label='FM-1 via stock MIDI · '+stockState.identity;summary=stockState.loader?'OTA mode: recover the original transfer.':'Stock firmware identity confirmed.';}
    else if(transport==='common'&&commonState.connected&&commonState.identity){label='FM-1 via firmware MIDI · '+commonState.identity;summary=commonState.recoveryRequired?'An original custom update is unresolved. Inspect it before another update.':commonState.installAvailable?'Common update capability confirmed. Physical update qualification is pending.':'Firmware MIDI connected · installation unavailable. Loader qualification is pending.';}
    else{label='FM-1 disconnected';summary='Connect USB serial, stock MIDI or firmware MIDI.';}
  }
  function paint(){
    if(closed)return;
    const writing=isWriting(),connected=transport==='serial'?serialState.connected:transport==='midi'?stockState.connected:transport==='common'?commonState.connected:false;
    const put=(id,text)=>{const node=el(id);if(node&&node.textContent!==text)node.textContent=text;};
    put('device-heading',label);put('device-summary',summary);put('physical-device',label);
    put('connection-label',connected?'Device connected':'Device disconnected');if(el('connection'))el('connection').className='badge'+(connected?' online':'');
    if(el('connection-check'))el('connection-check').hidden=!(checking&&!runtime.document?.hidden);
    put('update-mode',transport==='serial'&&serialState.connected?'USB serial':transport==='midi'&&stockState.connected?(stockState.loader?'OTA recovery':'MIDI / SysEx'):transport==='common'&&commonState.connected?(commonState.installAvailable?'Common MIDI / SysEx':'Firmware MIDI · install unavailable'):'Not connected');
    put('inventory-freshness','Direct connection · no local helper');
    el('direct-connect-serial').disabled=busy||writing||restoring||!usable('serial');el('direct-connect-midi').disabled=busy||writing||restoring||!usable('midi');el('direct-connect-common').disabled=busy||writing||restoring||!usable('midi');
    el('direct-disconnect').disabled=busy||writing||!connected;
    const midiReady=transport==='midi'&&stockState.connected&&stockState.identityVerified;
    el('direct-stock-review').disabled=busy||writing||restoring||operationStatus==='unknown'||!durable()||!metadata||!midiReady||stockState.loader||stockState.recoveryRequired||recoverable()||common?.recoverable();
    el('direct-stock-recovery').hidden=!recoverable();el('direct-stock-recovery').disabled=busy||writing||!durable()||!metadata||!midiReady||stockState.loader!==true||!recoverable()||common?.recoverable();
    el('direct-stock-file').disabled=busy||writing;el('direct-review-confirm').disabled=busy||writing||!review||!midiReady||review.pairKey!==pairKey(stockState.pair)||review.fileEpoch!==fileEpoch||common?.recoverable();
    put('direct-package-summary',metadata?metadata.product+' · '+metadata.raw_bytes+' bytes\nSHA256 '+metadata.sha256:'No validated package selected.');
    put('direct-device-note',notice||(usable('serial')||usable('midi')?'Use a connection button to grant browser device access.':'This host does not expose the required direct device APIs. See Direct device access below.'));
    put('direct-stock-note',!restoring&&!durable()?'Stock writing is disabled: durable browser storage and cross-tab device locks must be available.':recoverable()?(stockState.loader?'An interrupted transfer is saved. Select the same official package, then explicitly review recovery.':'An interrupted transfer is saved. Normal MIDI mode cannot replay it. Reconnect the original FM-1 in verified OTA recovery mode.'):stockState.loader?'FM-1 is already in OTA mode. A new update is disabled; recover the original saved transfer.':metadata?'The package is validated locally. Review it with the selected stock MIDI pair.':'Select the official V15 .fwsc package. Nothing is uploaded.');
    put('direct-storage-report',JSON.stringify(stockState.storageScope||{origin:null,sentinel:null,durableReady:false,locksAvailable:false}));
    const visible=!!operationStatus||!!recoverable();el('direct-transfer').hidden=!visible;
    if(visible){put('direct-transfer-status',operationStatus==='succeeded'?'Transfer finished · reboot identity verified · full flash readback not performed':operationStatus==='running'?'Transfer in progress':recoverable()||operationStatus==='unknown'?'Transfer outcome uncertain. Keep the original attempt and review recovery; do not start another update.':'Transfer stopped before completion.');
      const bar=el('direct-transfer-progress');bar.hidden=operationStatus!=='running';if(Number.isFinite(progress?.progress)&&progress.progress>=0&&progress.progress<=1)bar.value=progress.progress;else bar.removeAttribute('value');
      put('direct-transfer-phase',progress?[progress.phase,Number.isFinite(progress.progress)?Math.round(progress.progress*100)+'% served':null].filter(Boolean).join(' · '):'');}
    common?.paint();
    onChange({connected,transport,profile:transport==='serial'?serialState.profile:transport==='common'?commonState.identity:stockState.identity,checking,writing,label});
  }
  async function work(fn){if(closed||busy||isWriting())return;busy=true;notice='';paint();try{return await fn();}catch(error){notice=errorText(error);throw error;}finally{busy=false;checking=false;confirmed();paint();}}
  async function connectSerial(event){if(!trusted(event))return;return work(async()=>{
    if(!usable('serial'))throw new Error('Web Serial is unavailable or blocked by this host.');
    if(transport==='midi')await stock.disconnect();if(transport==='common')await common.disconnect();transport='serial';checking=true;paint();
    await serial.connect();serialState=serial.getState();confirmed();notice='USB serial connected. Refresh reads firmware status only.';connectionNotice=notice;
  });}
  async function connectMidi(event){if(!trusted(event))return;return work(async()=>{
    if(!usable('midi'))throw new Error('Web MIDI is unavailable or blocked by this host.');
    if(transport==='serial')await serial.close();if(transport==='common')await common.disconnect();transport='midi';checking=true;paint();
    await stock.connect();stockState=stock.status();confirmed();notice='Stock MIDI identity verified. Select the official package to update.';connectionNotice=notice;
  });}
  async function connectCommon(event){if(!trusted(event))return;return work(async()=>{
    if(!usable('midi'))throw new Error('Web MIDI is unavailable or blocked by this host.');
    if(transport==='serial')await serial.close();if(transport==='midi')await stock.disconnect();transport='common';checking=true;paint();
    await common.connect();commonState=common.snapshot();confirmed();notice=commonState.installAvailable?'Firmware MIDI identity and capability confirmed. Physical update qualification is pending.':'Firmware MIDI connected. Installation is unavailable in this build; loader qualification is pending.';connectionNotice=notice;
  });}
  async function refresh(){return work(async()=>{
    checking=true;paint();if(transport==='serial'&&serialState.connected){await serial.readStatus();serialState=serial.getState();}
    else if(transport==='midi'&&stockState.connected){await stock.probe();stockState=stock.status();}
    else if(transport==='common'&&commonState.connected){await common.refresh();commonState=common.snapshot();}
    confirmed();
  });}
  async function disconnect(event){if(!trusted(event))return;return work(async()=>{
    if(transport==='serial')await serial.close();if(transport==='midi')await stock.disconnect();if(transport==='common')await common.disconnect();
    serialState=serial.getState();stockState=stock.status();commonState=common.snapshot();transport=null;confirmed();notice='Disconnected. Your transfer journal is preserved.';
  });}
  async function selectPackage(file){if(closed||busy||isWriting())return;const ticket=++fileEpoch;review=null;packageFile=null;metadata=null;paint();
    try{if(!file||typeof file.name!=='string'||!file.name.toLowerCase().endsWith('.fwsc'))throw new Error('Select the official V15 .fwsc package.');
      const result=await stock.inspectPackage(file);if(closed||ticket!==fileEpoch)return;
      if(result?.product!==STOCK.product||result.raw_bytes!==STOCK.rawBytes||result.sha256!==STOCK.sha256)throw new Error('The package metadata does not match the pinned official V15 firmware.');
      packageFile=file;metadata=result;notice='Official V15 package validated locally. No device write.';
    }catch(error){if(ticket===fileEpoch)notice=errorText(error);throw error;}finally{paint();}}
  function stage(event,{resume=false}={}){if(!trusted(event)||closed||busy||isWriting()||common?.recoverable()||!durable()||!metadata||!stockState.connected||!stockState.identityVerified)return;
    if(resume&&(!recoverable()||stockState.loader!==true)||!resume&&(operationStatus==='unknown'||stockState.loader||stockState.recoveryRequired||recoverable()))return;
    const jobId=resume?attempt.jobId:makeId(),reviewId=resume?attempt.reviewId:makeId();if(!validId(jobId)||!validId(reviewId))throw new Error('Secure transfer identity is unavailable.');
    review={jobId,reviewId,resume,pairKey:pairKey(stockState.pair),fileEpoch};
    el('direct-review-title').textContent=resume?'Recover original stock transfer':'Install official stock firmware';
    el('direct-review-confirm').textContent=resume?'Resume original transfer':'Install stock firmware';
    el('direct-review-text').textContent=[metadata.product,metadata.raw_bytes+' bytes','SHA256 '+metadata.sha256,'Current identity: '+stockState.identity,
      'MIDI input: '+stockState.pair.inputName,'MIDI output: '+stockState.pair.outputName,resume?'Original transfer: '+jobId:null].filter(Boolean).join('\n');
    paint();el('direct-stock-dialog').showModal();
  }
  async function confirm(event){if(!trusted(event)||closed||busy||isWriting()||common?.recoverable()||!durable()||!review||!metadata||!packageFile||!stockState.connected||!stockState.identityVerified)return;
    const selected=review;if(selected.pairKey!==pairKey(stockState.pair)||selected.fileEpoch!==fileEpoch){review=null;paint();throw new Error('The selected device or package changed. Review it again.');}
    if(selected.resume&&stockState.loader!==true||!selected.resume&&(operationStatus==='unknown'||stockState.loader||stockState.recoveryRequired||recoverable())){review=null;paint();throw new Error('The stock transfer mode changed. Review the original attempt again.');}
    review=null;el('direct-stock-dialog').close();busy=true;operationStatus='running';progress=null;notice='';attempt={jobId:selected.jobId,reviewId:selected.reviewId,state:'active',sha256:metadata.sha256};paint();
    try{const result=await stock[selected.resume?'resume':'update']({jobId:selected.jobId,reviewId:selected.reviewId,packageBytes:packageFile});
      if(result.jobId!==selected.jobId||result.sha256!==metadata.sha256||result.identity!==STOCK.product||result.transfer_finished!==true||result.boot_identity_verified!==true||result.readback_verified!==false)throw Object.assign(new Error('Stock completion proof is incomplete; inspect the original transfer.'),{recovery_required:true});
      operationStatus='succeeded';attempt={...attempt,state:'succeeded'};stockState=stock.status();confirmed();notice='Stock V15 transfer and reboot identity verified. Physical acceptance remains separate.';
    }catch(error){stockState=stock.status();const uncertain=error.recovery_required===true||stockState.recoveryRequired;operationStatus=uncertain?'unknown':'failed';attempt={...attempt,state:uncertain?'unknown':'failed'};notice=errorText(error);throw error;
    }finally{busy=false;if(typeof stock.savedAttempt==='function'){try{const saved=await stock.savedAttempt();if(saved)attempt=saved;}catch{}}confirmed();paint();}}
  function cancel(){review=null;el('direct-stock-dialog').close();paint();}
  const click=fn=>event=>{if(!trusted(event))return;void Promise.resolve().then(()=>fn(event)).catch(error=>{notice=errorText(error);paint();});};
  // Connect calls remain synchronous until their chooser invocation so user activation survives.
  el('direct-connect-serial').onclick=event=>{if(trusted(event))void connectSerial(event).catch(()=>{});};
  el('direct-connect-midi').onclick=event=>{if(trusted(event))void connectMidi(event).catch(()=>{});};
  el('direct-connect-common').onclick=event=>{if(trusted(event))void connectCommon(event).catch(()=>{});};
  el('direct-disconnect').onclick=event=>{if(trusted(event))void disconnect(event).catch(()=>{});};
  el('direct-stock-file').onchange=event=>{if(trusted(event))void selectPackage(el('direct-stock-file').files?.[0]).catch(()=>{});};
  el('direct-stock-review').onclick=click(event=>stage(event));el('direct-stock-recovery').onclick=click(event=>stage(event,{resume:true}));
  el('direct-review-confirm').onclick=event=>{if(trusted(event))void confirm(event).catch(()=>{});};el('direct-review-cancel').onclick=cancel;
  el('direct-stock-dialog').addEventListener('cancel',cancel);
  const dispose=()=>{if(closed)return;closed=true;review=null;if(isWriting())return;void serial.dispose();if(transport==='midi')void stock.disconnect().catch(()=>{});common?.dispose();};
  signal?.addEventListener('abort',dispose,{once:true});
  runtime.addEventListener?.('beforeunload',event=>{if(isWriting()){event.preventDefault?.();event.returnValue='';}},{signal});
  runtime.addEventListener?.('pagehide',dispose,{once:true,signal});
  paint();
  const ready=(async()=>{try{if(typeof stock.initialize==='function')await stock.initialize();if(typeof stock.savedAttempt==='function')attempt=await stock.savedAttempt();stockState=stock.status();}catch(error){notice=errorText(error);}finally{await common.initialize();commonState=common.snapshot();restoring=false;confirmed();paint();}})();
  return {paint,refresh,connectSerial,connectMidi,connectCommon,disconnect,selectPackage,stage,confirm,cancel,dispose,ready,common,
    state:()=>({label,transport,busy,checking,operationStatus,attempt:attempt?{...attempt}:null,review:review?{...review}:null})};
}
if(typeof window!=='undefined')window.FM1BrowserDevicesUI={mount:mountBrowserDevicesUi};
