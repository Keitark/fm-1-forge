/** Windows-only closed tracker CDC -> UBOOT update flow. Native tools own jobs
 * across panel lifetimes; the panel only confirms reviewed fixed operations. */
export const cdcUpdateHtml=String.raw`<section class="direct-devices" id="desktop-cdc" aria-label="Tracker firmware through USB serial"><h2>Tracker update · USB serial</h2><p class="note">For an FM-1 already running the tracker. Connect USB serial, then select the generated firmware.fwsc and matching firmware.json. Preparation requests Windows administrator access, then enters recovery. Review the live sector plan separately before installation.</p><label class="note" for="desktop-cdc-manifest">Matching build manifest (.json)</label><input id="desktop-cdc-manifest" type="file" accept=".json,application/json"><label class="note" for="desktop-cdc-file">Tracker firmware package (.fwsc)</label><input id="desktop-cdc-file" type="file" accept=".fwsc"><p class="digest" id="desktop-cdc-summary">Select the package and matching manifest.</p><div class="direct-buttons"><button id="desktop-cdc-review" type="button" class="secondary" disabled>Review tracker update</button><button id="desktop-cdc-plan" type="button" class="secondary" hidden disabled>Review application sector plan</button><button id="desktop-cdc-recovery" type="button" class="secondary" hidden disabled>Review original CDC recovery</button><button id="desktop-cdc-verify" type="button" class="secondary" hidden disabled>Verify original tracker boot</button></div><p id="desktop-cdc-note" class="note" role="status" aria-live="polite"></p><section id="desktop-cdc-transfer" class="direct-device-transfer" hidden><h2>Tracker USB update</h2><p id="desktop-cdc-transfer-status" role="status" aria-live="polite"></p><progress id="desktop-cdc-progress" max="1" aria-label="Tracker update progress"></progress><p id="desktop-cdc-phase" class="note"></p></section></section><dialog id="desktop-cdc-dialog"><h2 id="desktop-cdc-review-title">Review tracker update</h2><pre id="desktop-cdc-review-text" class="direct-review-text"></pre><p id="desktop-cdc-review-note" class="note"></p><div class="actions"><button id="desktop-cdc-cancel" type="button" class="secondary">Cancel</button><button id="desktop-cdc-confirm" type="button" class="primary" disabled>Prepare recovery and read flash</button></div></dialog>`;

const MAX_PACKAGE=2097152,MAX_MANIFEST=8192,MAX_CHUNK=65536;
const trusted=event=>event?.isTrusted===true;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const printable=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(value);
const errorText=error=>printable(error?.message)?error.message:'The tracker USB update response could not be verified. Refresh the original job.';
const fields=['job_id','kind','profile','source_build_sha256','target_build_sha256','sha256','logical_sha256','manifest_sha256','raw_bytes','logical_bytes','expected_boot_identity','baseline_sha256','candidate_sha256','sectors','no_changes'];
const clone=value=>JSON.parse(JSON.stringify(value));
function base64(bytes){let text='';for(let index=0;index<bytes.length;index+=8192)text+=String.fromCharCode(...bytes.subarray(index,index+8192));if(typeof btoa==='function')return btoa(text);const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let result='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];result+=alphabet[a>>2]+alphabet[((a&3)<<4)|((b??0)>>4)]+(i+1<bytes.length?alphabet[((b&15)<<2)|((c??0)>>6)]:'=')+(i+2<bytes.length?alphabet[c&63]:'=');}return result;}
function checkMetadata(value,{plan=false}={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||!id(value.job_id)||value.kind!=='cdc-uboot'||value.profile!=='protracker'||value.expected_boot_identity!=='MOD-EDITOR/1'||!['source_build_sha256','target_build_sha256','sha256','logical_sha256','manifest_sha256'].every(key=>hash(value[key]))||!Number.isSafeInteger(value.raw_bytes)||value.raw_bytes<1||value.raw_bytes>MAX_PACKAGE||!Number.isSafeInteger(value.logical_bytes)||value.logical_bytes<1||value.logical_bytes>value.raw_bytes)throw new Error('The tracker USB update metadata is invalid. Refresh the original job.');
  if(plan||value.baseline_sha256!=null||value.candidate_sha256!=null){
    if(!hash(value.baseline_sha256)||!hash(value.candidate_sha256)||!Array.isArray(value.sectors)||value.sectors.length>144||new Set(value.sectors).size!==value.sectors.length||value.sectors.some(offset=>!Number.isSafeInteger(offset)||offset<0x4000||offset>=0x93000||offset%4096!==0)||typeof value.no_changes!=='boolean'||value.no_changes!==(value.sectors.length===0)||value.no_changes&&(value.baseline_sha256!==value.candidate_sha256)||value.sectors.includes(0x4000)&&value.sectors.at(-1)!==0x4000)throw new Error('The original tracker application-sector plan is invalid.');
  }
  else if(value.sectors!=null&&(!Array.isArray(value.sectors)||value.sectors.length!==0)||value.no_changes!=null&&value.no_changes!==false)throw new Error('An unprepared tracker review cannot include a sector plan.');
  return Object.fromEntries(fields.filter(key=>value[key]!==undefined).map(key=>[key,clone(value[key])]));
}
function checkedReview(value){
  if(!value||!id(value.review_id)||!['prepare','install','recover'].includes(value.operation)||typeof value.expires_at!=='string'||!Number.isFinite(Date.parse(value.expires_at)))throw new Error('The tracker USB review is invalid. Review it again.');
  return {...checkMetadata(value,{plan:value.operation!=='prepare'}),review_id:value.review_id,operation:value.operation,expires_at:value.expires_at};
}
function checkedAttempt(value){
  if(value===null)return null;
  const metadata=checkMetadata(value);
  if(!['prepared','active','unknown','succeeded','failed'].includes(value.state)||!printable(value.phase)||value.progress!==null&&!(Number.isFinite(value.progress)&&value.progress>=0&&value.progress<=1)||!['transfer_finished','readback_verified','boot_identity_verified','boot_build_verified','recovery_required'].every(key=>typeof value[key]==='boolean')||value.recovery_available!==undefined&&typeof value.recovery_available!=='boolean'||value.error_code!=null&&!printable(value.error_code)||value.observed_build_sha256!=null&&!hash(value.observed_build_sha256)||value.observed_boot_identity!=null&&value.observed_boot_identity!=='MOD-EDITOR/1')throw new Error('The tracker USB receipt is invalid. Refresh its original job.');
  return {...metadata,...Object.fromEntries(['state','phase','progress','transfer_finished','readback_verified','boot_identity_verified','boot_build_verified','recovery_required','recovery_available','error_code','observed_build_sha256','observed_boot_identity'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]))};
}
function checkedManifest(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||value.policy_version!=='customfwsc-v1'||value.profile!=='protracker'||value.family!==9||value.expected_boot_identity!=='MOD-EDITOR/1'||value.hardware_qualified!==false||!['package_sha256','logical_sha256','target_build_sha256'].every(key=>hash(value[key]))||!Number.isSafeInteger(value.raw_bytes)||value.raw_bytes<1||value.raw_bytes>MAX_PACKAGE)throw new Error('Select the generated tracker manifest matching this FWSC package.');
  return clone(value);
}

export function mountDesktopCdcUi({el,call,signal,enabled=false,context=()=>({}),runExclusive,onChange=()=>{},clearOtherReview=()=>{}}={}){
  if(typeof el!=='function'||typeof call!=='function'||typeof runExclusive!=='function')throw new TypeError('Tracker USB controls require the fixed native caller and shared operation lock.');
  const capability=enabled===true;
  let closed=false,loaded=!capability,known=!capability,supported=false,writing=false,starting=false,attempt=null,review=null,manifest=null,selected=null,notice='',fileEpoch=0,manifestEpoch=0,packageEpoch=0,selectionCount=0;
  const ctx=()=>context()||{},put=(key,text)=>{const node=el(key);if(node&&node.textContent!==text)node.textContent=text;};
  const usable=()=>capability&&loaded&&known&&supported;
  const isWriting=()=>writing||starting;
  const unresolved=()=>!!attempt&&(attempt.recovery_required||['prepared','active','unknown'].includes(attempt.state));
  const blocksDevice=()=>capability&&(!loaded||!known||isWriting()||unresolved());
  const otherBlocked=()=>ctx().otherWriting||ctx().otherUnresolved||ctx().otherReady===false;
  const normal=()=>ctx().connected&&ctx().transport==='usb-serial'&&ctx().identity==='MOD-EDITOR/1';
  const canVerify=()=>unresolved()&&attempt?.transfer_finished&&attempt.readback_verified;
  const canPlan=()=>attempt?.phase==='awaiting_install'&&attempt.state==='prepared';
  const validReview=()=>!!review&&Date.parse(review.expires_at)>Date.now()&&review.fileEpoch===fileEpoch&&(review.operation!=='prepare'||normal()&&review.deviceKey===ctx().deviceKey);
  function clearReview(){review=null;try{el('desktop-cdc-dialog')?.close?.();}catch{}}
  function paint(){
    if(closed)return;const section=el('desktop-cdc');if(section)section.hidden=!capability;
    const blocked=!usable()||isWriting()||otherBlocked()||ctx().busy||selectionCount>0;
    for(const key of ['desktop-cdc-file','desktop-cdc-manifest']){const node=el(key);if(node)node.disabled=!usable()||isWriting()||otherBlocked()||unresolved()||selectionCount>0||ctx().busy&&!ctx().routineChecking||!normal();}
    const button=(key,hidden,disabled)=>{const node=el(key);if(node){node.hidden=hidden;node.disabled=disabled;}};
    button('desktop-cdc-review',false,blocked||!normal()||!manifest||!selected||unresolved());
    button('desktop-cdc-plan',!canPlan(),blocked||!canPlan());
    button('desktop-cdc-recovery',!unresolved()||canPlan()||canVerify(),blocked||!unresolved()||canPlan()||canVerify()||attempt?.recovery_available===false);
    button('desktop-cdc-verify',!canVerify(),blocked||!canVerify());
    const confirm=el('desktop-cdc-confirm');if(confirm)confirm.disabled=blocked||!validReview();
    put('desktop-cdc-summary',selectionCount?'Reading selected files…':[selected?'Package: '+selected.name+' · '+selected.bytes.length+' bytes':'No tracker FWSC selected.',manifest?'Target build SHA256 '+manifest.target_build_sha256:'No tracker manifest selected.','Files remain on this computer.'].join('\n'));
    put('desktop-cdc-note',notice||(!loaded||!known?'Tracker USB status is unavailable. Use Refresh before continuing.':!supported?'This server does not expose the Windows tracker USB updater.':isWriting()?'The native plugin owns this job. Keep USB connected; closing this panel does not cancel it.':otherBlocked()?'Resolve the original firmware operation before starting another tracker update.':canPlan()?'Live flash readback is ready. Review the exact application-sector plan; programming has not started.':canVerify()?'Full flash readback completed. Verify the original tracker build; do not resend firmware.':unresolved()&&attempt?.recovery_available===false?'The original protected worker session is unavailable. Preserve this job and its evidence for the recovery handoff. Another update remains blocked.':unresolved()?'The original CDC/UBOOT job needs attention. Review its saved recovery; do not start a new job or power-cycle automatically.':!normal()?'Connect USB serial to the FM-1 running the tracker.':'Review the package, then prepare recovery. Installation has its own sector-plan confirmation.'));
    const transfer=el('desktop-cdc-transfer');if(transfer)transfer.hidden=!attempt;
    if(attempt){
      put('desktop-cdc-transfer-status',attempt.state==='succeeded'&&!isWriting()?'Application readback and exact tracker boot verified. Screen, audio and controls still require physical acceptance.':canPlan()?'Prepared · awaiting your sector-plan confirmation':isWriting()?'Tracker USB operation in progress':unresolved()?'Original tracker USB job requires attention.':'Tracker USB operation stopped.');
      const bar=el('desktop-cdc-progress');if(bar){bar.hidden=!isWriting();if(Number.isFinite(attempt.progress))bar.value=attempt.progress;else bar.removeAttribute?.('value');}
      put('desktop-cdc-phase',[attempt.phase,Number.isFinite(attempt.progress)?Math.round(attempt.progress*100)+'%':null,'Target build SHA256 '+attempt.target_build_sha256,attempt.baseline_sha256?'Baseline SHA256 '+attempt.baseline_sha256:null,attempt.candidate_sha256?'Candidate SHA256 '+attempt.candidate_sha256:null,attempt.error_code?'Code: '+attempt.error_code:null].filter(Boolean).join(' · '));
    }
  }
  const notify=()=>{paint();onChange();};
  function applyStatus(reply,{expectedJob,start=false}={}){
    if(!reply||typeof reply!=='object'||!start&&typeof reply.supported!=='boolean'||typeof reply.writing!=='boolean'||!Object.hasOwn(reply,'attempt')||!Object.hasOwn(reply,'review'))throw new Error('The tracker USB updater status is invalid.');
    const next=checkedAttempt(reply.attempt),remote=reply.review===null?null:checkedReview(reply.review),original=expectedJob||(isWriting()||unresolved()?attempt?.job_id:null);
    if(original&&next?.job_id!==original||attempt&&next&&original&&fields.filter(key=>!['baseline_sha256','candidate_sha256','sectors','no_changes'].includes(key)).some(key=>JSON.stringify(attempt[key])!==JSON.stringify(next[key]))||attempt?.candidate_sha256&&next&&original&&['baseline_sha256','candidate_sha256','sectors','no_changes'].some(key=>JSON.stringify(attempt[key])!==JSON.stringify(next[key])))throw new Error('The tracker USB updater changed the original request or sector plan.');
    if(start&&remote!==null||reply.writing&&!next)throw new Error('The tracker USB updater returned inconsistent activity.');
    loaded=true;known=true;supported=start?supported:reply.supported;writing=reply.writing;attempt=next;
    if(attempt&&(attempt.state==='succeeded'&&(!attempt.transfer_finished||!attempt.readback_verified||!attempt.boot_identity_verified||!attempt.boot_build_verified||attempt.observed_build_sha256!==attempt.target_build_sha256||attempt.observed_boot_identity!=='MOD-EDITOR/1'||attempt.recovery_required)||attempt.state==='active'&&!writing)){attempt={...attempt,state:'unknown',recovery_required:true,error_code:'completion_unverified'};notice='Tracker completion proof is incomplete. Keep the original job for recovery.';}
    if(review&&remote?.review_id!==review.review_id)clearReview();notify();
  }
  async function loadStatus(alive=()=>!closed){if(!capability||closed)return;try{const reply=await call('get_fm1_cdc_update_status',{},signal);if(!closed&&alive()){notice='';applyStatus(reply);}}catch(error){if(!closed&&alive()){known=false;notice=errorText(error);notify();}throw error;}}
  async function selectFile(file,event,{isManifest=false}={}){
    if(!trusted(event)||closed||!usable()||isWriting()||unresolved()||otherBlocked()||ctx().busy&&!ctx().routineChecking||!normal())return;
    ++fileEpoch;const ticket=isManifest?++manifestEpoch:++packageEpoch;const selectedEpoch=()=>isManifest?manifestEpoch:packageEpoch;clearReview();if(isManifest)manifest=null;else selected=null;selectionCount++;notice='';notify();
    try{if(!file||!printable(file.name)||!file.name.toLowerCase().endsWith(isManifest?'.json':'.fwsc')||!Number.isSafeInteger(file.size)||file.size<1||file.size>(isManifest?MAX_MANIFEST:MAX_PACKAGE)||typeof file.arrayBuffer!=='function')throw new Error('Select a bounded tracker '+(isManifest?'manifest (.json).':'package (.fwsc).'));const buffer=await file.arrayBuffer();if(closed||ticket!==selectedEpoch())return;if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==file.size)throw new Error('The selected file changed. Select it again.');if(isManifest)manifest=checkedManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)));else selected={name:file.name,bytes:new Uint8Array(buffer).slice()};}
    catch(error){if(!closed&&ticket===selectedEpoch())notice=errorText(error);throw error;}
    finally{selectionCount--;if(!closed)notify();}
  }
  function showReview(value,{operation,key,ticket,job}={}){
    const next=checkedReview(value);if(next.operation!==operation||Date.parse(next.expires_at)<=Date.now()||ticket!==fileEpoch||operation==='prepare'&&key!==ctx().deviceKey||job&&next.job_id!==job||operation==='prepare'&&(next.source_build_sha256!==ctx().buildSha256||next.target_build_sha256!==manifest?.target_build_sha256||next.sha256!==manifest?.package_sha256||next.logical_sha256!==manifest?.logical_sha256||next.raw_bytes!==manifest?.raw_bytes||next.logical_bytes!==manifest?.logical_bytes||next.raw_bytes!==selected?.bytes.length)||operation!=='prepare'&&fields.some(field=>JSON.stringify(next[field])!==JSON.stringify(attempt?.[field])))throw new Error('The tracker source, package or original review changed. Review it again.');
    review={...next,deviceKey:key,fileEpoch:ticket};
    put('desktop-cdc-review-title',operation==='prepare'?'Prepare tracker recovery':operation==='recover'?'Recover original application sectors':next.no_changes?'Return to the verified tracker':'Install reviewed application sectors');
    put('desktop-cdc-confirm',operation==='prepare'?'Prepare recovery and read flash':next.no_changes?'Return to verified tracker':operation==='recover'?'Recover original sector plan':'Install reviewed application sectors');
    put('desktop-cdc-review-note',operation==='prepare'?'Accept the Windows administrator prompt for the plugin-owned worker. After elevation it stops tracker playback, enters UBOOT, uploads the pinned RAM helper and reads the current flash twice. Helper initialization can change flash status/protection. Flash-array programming requires a separate sector-plan confirmation.':next.no_changes?'The live flash already matches this application. This confirms final readback and returns to the same verified tracker without erasing or programming.':'This erases and programs only the displayed application sectors, preserving boot, configuration and reserved data. The application directory sector is written last. Each operation and final full readback are verified before restart. Keep USB connected. An uncertain operation is never retried automatically.');
    put('desktop-cdc-review-text',['Original job: '+next.job_id,'Source build SHA256 '+next.source_build_sha256,'Target build SHA256 '+next.target_build_sha256,'Package SHA256 '+next.sha256,'Manifest SHA256 '+next.manifest_sha256,next.raw_bytes+' package bytes · '+next.logical_bytes+' logical bytes',next.baseline_sha256?'Live baseline SHA256 '+next.baseline_sha256:null,next.candidate_sha256?'Candidate SHA256 '+next.candidate_sha256:null,next.baseline_sha256&&Array.isArray(next.sectors)?'Ordered application sectors ('+next.sectors.length+'): '+(next.sectors.length?next.sectors.map(offset=>'0x'+offset.toString(16).padStart(6,'0')).join(', '):'none — no erase/program'):null,'Review expires: '+next.expires_at].filter(Boolean).join('\n'));
    el('desktop-cdc-dialog')?.showModal?.();notify();return clone(next);
  }
  function stage(event,{operation='prepare'}={}){
    if(!trusted(event)||closed||!usable()||isWriting()||otherBlocked()||ctx().busy||selectionCount)return;
    if(operation==='prepare'&&(!normal()||!selected||!manifest||unresolved())||operation==='install'&&!canPlan()||operation==='recover'&&(!unresolved()||canPlan()||canVerify()||attempt?.recovery_available===false))return;
    const key=ctx().deviceKey,ticket=fileEpoch,job=attempt?.job_id,bytes=selected?.bytes,buildManifest=manifest;clearOtherReview();clearReview();
    return runExclusive(async alive=>{
      let reply;
      if(operation==='prepare'){
        const upload=await call('begin_fm1_cdc_upload',{raw_bytes:bytes.length,manifest:buildManifest},signal);if(!alive())return;if(!id(upload?.upload_id)||!Number.isSafeInteger(upload.max_chunk_bytes)||upload.max_chunk_bytes<1||upload.max_chunk_bytes>MAX_CHUNK)throw new Error('The tracker upload limits are invalid.');
        for(let offset=0;offset<bytes.length;offset+=upload.max_chunk_bytes){const chunk=bytes.subarray(offset,offset+upload.max_chunk_bytes),accepted=await call('append_fm1_cdc_upload',{upload_id:upload.upload_id,offset,data_base64:base64(chunk)},signal);if(!alive())return;if(accepted?.upload_id!==upload.upload_id||accepted.received_bytes!==offset+chunk.length)throw new Error('The tracker upload acknowledgement changed. No chunk is retried automatically.');}
        reply=await call('review_fm1_cdc_update',{upload_id:upload.upload_id},signal);
      }else reply=await call(operation==='install'?'review_fm1_cdc_install':'review_fm1_cdc_recovery',{job_id:job},signal);
      if(alive())return showReview(reply?.review,{operation,key,ticket,job:operation==='prepare'?null:job});
    });
  }
  function confirm(event){
    if(!trusted(event)||closed||!usable()||isWriting()||otherBlocked()||ctx().busy||!review)return;if(!validReview()){clearReview();notice='The original review expired or the source changed. Review it again.';notify();return;}
    const next=review;clearReview();clearOtherReview();starting=true;notify();
    return runExclusive(async alive=>{try{const reply=await call(next.operation==='prepare'?'prepare_fm1_cdc_update':'start_fm1_cdc_update',{review_id:next.review_id,confirmed:true},null);if(alive())applyStatus(reply,{expectedJob:next.job_id,start:true});}catch(error){if(alive()){known=false;notice='The confirmed operation outcome is unavailable. Refresh its original job before any further operation.';}throw error;}finally{if(alive()){starting=false;notify();}}});
  }
  function verify(event){if(!trusted(event)||closed||!usable()||isWriting()||otherBlocked()||ctx().busy||!canVerify())return;const job=attempt.job_id;clearReview();clearOtherReview();starting=true;notify();return runExclusive(async alive=>{try{const reply=await call('verify_fm1_cdc_boot',{job_id:job},null);if(alive())applyStatus(reply,{expectedJob:job,start:true});}catch(error){if(alive()){known=false;notice=errorText(error);}throw error;}finally{if(alive()){starting=false;notify();}}});}
  function cancel(){clearReview();notify();}
  function dispose(){if(closed)return;closed=true;++fileEpoch;++manifestEpoch;++packageEpoch;clearReview();el('desktop-cdc-dialog')?.removeEventListener?.('cancel',cancel);}
  const click=fn=>event=>{if(trusted(event))void Promise.resolve(fn(event)).catch(error=>{if(!closed){notice=errorText(error);notify();}});};
  for(const [key,isManifest]of [['desktop-cdc-file',false],['desktop-cdc-manifest',true]]){const node=el(key);if(node)node.onchange=event=>{if(trusted(event))void selectFile(node.files?.[0],event,{isManifest}).catch(()=>{});};}
  for(const [key,fn]of [['desktop-cdc-review',event=>stage(event)],['desktop-cdc-plan',event=>stage(event,{operation:'install'})],['desktop-cdc-recovery',event=>stage(event,{operation:'recover'})],['desktop-cdc-verify',verify],['desktop-cdc-confirm',confirm],['desktop-cdc-cancel',cancel]]){const node=el(key);if(node)node.onclick=click(fn);}
  el('desktop-cdc-dialog')?.addEventListener?.('cancel',cancel);paint();
  return {paint,loadStatus,selectFile,stage,confirm,verify,cancel,clearReview,dispose,blocksDevice,isWriting,hasUnresolved:unresolved,ready:()=>!capability||loaded&&known,state:()=>({loaded,known,supported,writing:isWriting(),attempt:attempt?clone(attempt):null,review:review?clone(review):null})};
}
