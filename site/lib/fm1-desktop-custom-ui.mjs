/** Reviewed custom FWSC writes use the stock bootloader through fixed native
 * tools. The separate common-MIDI ARM updater is never enabled here. */
export const customFwscHtml=String.raw`<section class="direct-devices" id="desktop-custom" aria-label="Custom firmware through stock SysEx"><h2>Custom firmware update · SysEx</h2><p class="note">Select a generated .fwsc package and its matching build manifest. Start from stock V15, or explicitly recover the original OTA transfer. The bundled Windows plugin validates both files before review.</p><label class="note" for="desktop-custom-manifest">Matching build manifest (.json)</label><input type="file" id="desktop-custom-manifest" accept=".json,application/json" aria-label="Custom FWSC build manifest"><label class="note" for="desktop-custom-file">Custom firmware package (.fwsc)</label><input type="file" id="desktop-custom-file" accept=".fwsc" aria-label="Custom FWSC firmware package"><p class="digest" id="desktop-custom-summary">Select the package and its manifest.</p><div class="direct-buttons"><button class="secondary" id="desktop-custom-review" type="button" disabled>Review custom firmware</button><button class="secondary" id="desktop-custom-loader-entry" type="button" hidden disabled>Prepare original recovery</button><button class="secondary" id="desktop-custom-recovery" type="button" hidden disabled>Review original custom recovery</button><button class="secondary" id="desktop-custom-verify" type="button" hidden disabled>Verify tracker boot</button></div><p class="note" id="desktop-custom-note" role="status" aria-live="polite"></p><section class="direct-device-transfer" id="desktop-custom-transfer" hidden aria-label="Current custom FWSC transfer"><h2>Custom firmware transfer</h2><p id="desktop-custom-transfer-status" role="status" aria-live="polite"></p><progress id="desktop-custom-progress" max="1" aria-label="Custom FWSC transfer progress"></progress><p class="note" id="desktop-custom-phase"></p></section></section><dialog id="desktop-custom-dialog"><h2 id="desktop-custom-review-title">Review custom firmware</h2><pre class="direct-review-text" id="desktop-custom-review-text"></pre><p class="note" id="desktop-custom-review-note">This replaces the application using the stock OTA path and restarts FM-1. Keep USB connected. The package's fixed V15 layout is checked offline; stock V15 cannot verify the connected device's complete live flash baseline. Completion checks the reviewed custom firmware identity and build digest, without full flash readback. Custom hardware qualification is pending.</p><div class="actions"><button class="secondary" id="desktop-custom-cancel" type="button">Cancel</button><button class="primary" id="desktop-custom-confirm" type="button" disabled>Install reviewed custom firmware</button></div></dialog>`;

const MAX_PACKAGE_BYTES=2*1024*1024,MAX_MANIFEST_BYTES=8192,MAX_CHUNK_BYTES=65536;
const PROFILE_POLICIES=Object.freeze({
  'forge-diag':Object.freeze({profile:'forge-diag',identity:'FM1_FORGE_001',family:8,transport:'midi'}),
  protracker:Object.freeze({profile:'protracker',identity:'MOD-EDITOR/1',family:9,transport:'cdc'}),
});
function profileTuple(value,{manifest=false}={}){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const name=Object.hasOwn(value,'profile')?value.profile:manifest?null:'forge-diag';
  if(typeof name!=='string'||!Object.hasOwn(PROFILE_POLICIES,name))return null;
  const policy=PROFILE_POLICIES[name];
  if(value.expected_boot_identity!==policy.identity||(manifest?value.family!==policy.family:value.family!==undefined&&value.family!==policy.family))return null;
  if(manifest?Object.hasOwn(value,'verification_transport'):name==='protracker'?value.verification_transport!=='cdc':value.verification_transport!==undefined&&value.verification_transport!=='midi')return null;
  return policy;
}
const sameProfile=(a,b,{manifest=false}={})=>{const first=profileTuple(a),second=profileTuple(b,{manifest});return !!first&&!!second&&first.profile===second.profile;};
const trusted=event=>event?.isTrusted===true;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const originalMetadataKeys=['sha256','logical_sha256','manifest_sha256','raw_bytes','logical_bytes'];
const hasOriginalMetadata=value=>originalMetadataKeys.every(key=>value[key]!==undefined);
const id=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const printable=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(value);
const errorText=error=>Array.from((typeof error?.message==='string'?error.message:'The custom firmware operation could not be completed.').slice(0,512)).filter(value=>!/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(value)).join('').slice(0,256);
function base64(bytes){let text='';const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';for(let index=0;index<bytes.length;index+=3){const a=bytes[index],b=bytes[index+1],c=bytes[index+2];text+=alphabet[a>>2]+alphabet[((a&3)<<4)|((b??0)>>4)]+(index+1<bytes.length?alphabet[((b&15)<<2)|((c??0)>>6)]:'=')+(index+2<bytes.length?alphabet[c&63]:'=');}return text;}
function checkedManifest(value){
  // This is a bounded metadata check. Container, preservation and cryptographic
  // validation remain authoritative in the native plugin.
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||value.policy_version!=='customfwsc-v1'||!profileTuple(value,{manifest:true})||value.hardware_qualified!==false||
    ![value.package_sha256,value.logical_sha256,value.target_build_sha256].every(hash)||!Number.isSafeInteger(value.raw_bytes)||value.raw_bytes<1||value.raw_bytes>MAX_PACKAGE_BYTES||!Number.isSafeInteger(value.logical_bytes)||value.logical_bytes<1||value.logical_bytes>value.raw_bytes)throw new Error('Choose the matching generated custom FWSC manifest. The native plugin performs full package validation.');
  return JSON.parse(JSON.stringify(value));
}
function checkedReview(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!id(value.review_id)||!id(value.job_id)||value.kind!=='custom-fwsc'||!['install','resume','loader-entry'].includes(value.operation)||!profileTuple(value)||
    ![value.sha256,value.logical_sha256,value.target_build_sha256,value.manifest_sha256].every(hash)||![value.product,value.identity,value.input_name,value.output_name].every(printable)||
    !Number.isSafeInteger(value.raw_bytes)||value.raw_bytes<1||value.raw_bytes>MAX_PACKAGE_BYTES||!Number.isSafeInteger(value.logical_bytes)||value.logical_bytes<1||value.logical_bytes>value.raw_bytes||typeof value.expires_at!=='string'||!Number.isFinite(Date.parse(value.expires_at)))throw new Error('The custom firmware review is invalid. Review the package and manifest again.');
  return Object.fromEntries(['review_id','job_id','kind','operation','product','identity','input_name','output_name','sha256','logical_sha256','target_build_sha256','manifest_sha256','raw_bytes','logical_bytes','expected_boot_identity','expires_at','profile','verification_transport','family'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
}
function checkedAttempt(value){
  if(value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||!id(value.job_id)||value.kind!=='custom-fwsc'||!['prepared','active','unknown','succeeded','failed'].includes(value.state)||!printable(value.phase)||
    !profileTuple(value)||!hash(value.target_build_sha256)||value.progress!==null&&!(Number.isFinite(value.progress)&&value.progress>=0&&value.progress<=1)||
    typeof value.transfer_finished!=='boolean'||typeof value.boot_identity_verified!=='boolean'||typeof value.boot_build_verified!=='boolean'||value.readback_verified!==false||typeof value.recovery_required!=='boolean'||
    value.observed_boot_identity!==null&&!printable(value.observed_boot_identity)||value.observed_build_sha256!==null&&!hash(value.observed_build_sha256)||value.error_code!==undefined&&value.error_code!==null&&!printable(value.error_code)||value.loader_entry_stage!==undefined&&!['entering_check','checking','waiting_loader','loader_ready','failed'].includes(value.loader_entry_stage)||value.loader_entry_error_code!==undefined&&!printable(value.loader_entry_error_code)||
    originalMetadataKeys.some(key=>value[key]!==undefined)&&!hasOriginalMetadata(value)||
    ['sha256','logical_sha256','manifest_sha256'].some(key=>value[key]!==undefined&&!hash(value[key]))||['raw_bytes','logical_bytes'].some(key=>value[key]!==undefined&&(!Number.isSafeInteger(value[key])||value[key]<1||value[key]>MAX_PACKAGE_BYTES)))throw new Error('The custom firmware receipt is invalid. Refresh the original transfer status.');
  return Object.fromEntries(['job_id','kind','state','phase','progress','transfer_finished','boot_identity_verified','boot_build_verified','readback_verified','recovery_required','target_build_sha256','expected_boot_identity','observed_boot_identity','observed_build_sha256','error_code','profile','verification_transport','family','loader_entry_stage','loader_entry_error_code','sha256','logical_sha256','manifest_sha256','raw_bytes','logical_bytes'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
}

export function mountDesktopCustomUi({el,call,signal,enabled=false,context=()=>({}),runExclusive,onChange=()=>{},clearOtherReview=()=>{}}={}){
  if(typeof el!=='function'||typeof call!=='function'||typeof runExclusive!=='function')throw new TypeError('Custom firmware controls need the fixed native tool caller and shared operation lock.');
  const capability=enabled===true;
  let closed=false,loaded=!capability,known=!capability,supported=false,writing=false,starting=false,attempt=null,review=null,operationStatus=null,manifest=null,selected=null,notice='',fileEpoch=0,manifestEpoch=0,packageEpoch=0,selectionCount=0,activeOperation=null;
  const put=(key,value)=>{const node=el(key);if(node&&node.textContent!==value)node.textContent=value;};
  const stateContext=()=>context()||{};
  const deviceKey=()=>stateContext().deviceKey;
  const connected=()=>stateContext().connected&&stateContext().transport==='stock-midi';
  const normalStock=()=>connected()&&!stateContext().loader&&stateContext().identity==='FM-1_015';
  const unresolved=()=>!!attempt&&(attempt.recovery_required||['prepared','active','unknown'].includes(attempt.state));
  const canVerifyTracker=()=>attempt?.profile==='protracker'&&attempt.verification_transport==='cdc'&&attempt.transfer_finished&&unresolved();
  const canEnterLoader=()=>unresolved()&&['active','unknown'].includes(attempt.state)&&!attempt.transfer_finished&&hasOriginalMetadata(attempt)&&normalStock();
  const enteringLoader=()=>(writing||starting)&&(activeOperation==='loader-entry'||activeOperation===null&&!!attempt?.loader_entry_stage&&attempt.state==='unknown');
  const blocksDevice=()=>capability&&(!loaded||!known||writing||starting);
  const otherBlocked=()=>!!stateContext().stockWriting||!!stateContext().stockUnresolved||stateContext().stockReady===false;
  const usable=()=>capability&&known&&supported;
  const validReview=()=>review&&review.fileEpoch===fileEpoch&&review.deviceKey===deviceKey()&&review.identity===stateContext().identity&&Date.parse(review.expires_at)>Date.now()&&connected()&&(review.operation==='resume'?stateContext().loader:normalStock());
  function clearReview(){review=null;try{el('desktop-custom-dialog')?.close?.();}catch{}}
  function paint(){
    if(closed)return;
    const section=el('desktop-custom');if(section)section.hidden=!capability;
    const blocked=closed||!usable()||blocksDevice()||otherBlocked()||stateContext().busy||selectionCount>0;
    const selectionBlocked=closed||!usable()||blocksDevice()||otherBlocked()||stateContext().busy&&!stateContext().routineChecking||selectionCount>0||!stateContext().connected;
    for(const key of ['desktop-custom-file','desktop-custom-manifest']){const node=el(key);if(node)node.disabled=selectionBlocked;}
    const stage=el('desktop-custom-review');if(stage)stage.disabled=blocked||!normalStock()||!selected||!manifest||unresolved();
    const recover=el('desktop-custom-recovery');if(recover){recover.hidden=!unresolved()||canVerifyTracker();recover.disabled=blocked||!connected()||!stateContext().loader;}
    const prepare=el('desktop-custom-loader-entry');if(prepare){prepare.hidden=!unresolved()||attempt.transfer_finished;prepare.disabled=blocked||!canEnterLoader();}
    const verify=el('desktop-custom-verify');if(verify){verify.hidden=!canVerifyTracker();verify.disabled=blocked||!canVerifyTracker();}
    const confirm=el('desktop-custom-confirm');if(confirm)confirm.disabled=blocked||!validReview();
    put('desktop-custom-summary',selectionCount?'Reading selected files…':[selected?'Package: '+selected.name+' · '+selected.bytes.length+' bytes':'No custom .fwsc package selected.',manifest?'Build SHA256 '+manifest.target_build_sha256+'\nExpected identity: '+manifest.expected_boot_identity+(manifest.profile==='protracker'?'\nBoot verification: CDC serial':''):'No matching manifest selected.','Review sends both files only to the bundled local plugin.'].join('\n'));
    put('desktop-custom-note',notice||(!loaded||!known?'Custom updater status is unavailable. Use Refresh before an update.':!supported?'This native server does not expose the custom FWSC updater.':writing||starting?(enteringLoader()?'Checking the original saved package and entering its recovery loader. This step stops before application programming. Keep USB connected.':canVerifyTracker()?'The native plugin is verifying tracker boot over CDC. Keep USB connected.':'The native plugin owns this custom transfer. Closing the panel does not cancel it. Keep USB connected.'):otherBlocked()?'Resolve the original stock transfer before another custom update.':canVerifyTracker()?'The tracker transfer finished. Verify tracker boot over CDC; no MIDI connection or firmware resend is needed.':unresolved()?(normalStock()?(hasOriginalMetadata(attempt)?'The previous attempt remains unresolved. Use Prepare original recovery to check its saved package and enter OTA, then separately review the original custom recovery.':'The previous attempt remains unresolved. Refresh the plugin to obtain its original saved package metadata before preparing recovery.'):attempt?.loader_entry_stage==='loader_ready'?'Recovery loader entry completed; the application-write phase has not started in this step. Connect stock MIDI, then review the original custom recovery.':'Connect stock MIDI to the original FM-1 in OTA mode, then explicitly review its original custom recovery.'):!normalStock()?'Connect the FM-1 running stock V15 using Connect stock MIDI.':'Select a generated custom .fwsc package and its matching manifest, then review the exact device and build.'));
    const transfer=el('desktop-custom-transfer');if(transfer)transfer.hidden=!attempt;
    if(attempt){
      put('desktop-custom-transfer-status',operationStatus==='succeeded'?'Custom transfer finished · '+attempt.expected_boot_identity+(attempt.profile==='protracker'?' CDC':'')+' identity and reviewed build verified · full flash readback not performed':enteringLoader()?'Preparing original recovery loader; application programming remains blocked':attempt.loader_entry_stage==='loader_ready'&&!writing&&!starting?'Recovery loader identified; original transfer still unresolved':(writing||starting)&&canVerifyTracker()?'Verifying tracker boot over CDC':operationStatus==='running'?'Custom firmware transfer in progress':operationStatus==='unknown'||unresolved()?'Original custom transfer requires attention. Review its status and recovery; another update is blocked.':'Custom firmware transfer stopped before completion.');
      const bar=el('desktop-custom-progress');if(bar){bar.hidden=!writing&&!starting;if(Number.isFinite(attempt.progress))bar.value=attempt.progress;else bar.removeAttribute?.('value');}
      put('desktop-custom-phase',[attempt.phase,attempt.state!=='succeeded'&&attempt.loader_entry_stage?'Recovery preparation: '+attempt.loader_entry_stage:null,Number.isFinite(attempt.progress)?Math.round(attempt.progress*100)+'% served':null,'Target build SHA256 '+attempt.target_build_sha256,attempt.state!=='succeeded'&&attempt.loader_entry_error_code?'Recovery preparation code: '+attempt.loader_entry_error_code:null,attempt.error_code?'Code: '+attempt.error_code:null].filter(Boolean).join(' · '));
    }
  }
  const notify=()=>{paint();onChange();};
  function applyStatus(reply,{start=false,expectedJob,expectedBuild}={}){
    if(!reply||typeof reply!=='object'||Array.isArray(reply)||!start&&typeof reply.supported!=='boolean'||typeof reply.writing!=='boolean'||!Object.hasOwn(reply,'attempt')||!Object.hasOwn(reply,'review'))throw new Error('The native custom updater status is invalid. Refresh the original transfer.');
    const next=checkedAttempt(reply.attempt),remoteReview=reply.review===null?null:checkedReview(reply.review),retainingJob=writing||starting||unresolved(),original=expectedJob||(retainingJob?attempt?.job_id:null),target=expectedBuild||(retainingJob?attempt?.target_build_sha256:null);
    if(original&&next?.job_id!==original||target&&next?.target_build_sha256!==target)throw new Error('The custom updater did not return the original job and target build.');
    if(retainingJob&&attempt&&next&&!sameProfile(attempt,next))throw new Error('The custom updater changed the original firmware profile or verification transport.');
    if(retainingJob&&attempt&&next&&hasOriginalMetadata(attempt)&&originalMetadataKeys.some(key=>next[key]!==attempt[key]))throw new Error('The custom updater changed the original package metadata.');
    // start() owns the job before its asynchronous engine enters active state.
    const pendingStart=next?.state==='prepared'&&next.phase==='prepared';
    // A terminal receipt can be durable before session/journal cleanup releases
    // the runner. Keep its job locked and poll until writing becomes false.
    const pendingCleanup=next&&['succeeded','failed','unknown'].includes(next.state);
    if(reply.writing&&next?.state!=='active'&&!pendingStart&&!pendingCleanup||start&&remoteReview!==null)throw new Error('The custom updater returned inconsistent transfer activity.');
    loaded=true;known=true;supported=start?supported:reply.supported;writing=reply.writing;attempt=next;
    if(attempt&&(attempt.state==='succeeded'&&(!attempt.transfer_finished||!attempt.boot_identity_verified||!attempt.boot_build_verified||attempt.observed_boot_identity!==attempt.expected_boot_identity||attempt.observed_build_sha256!==attempt.target_build_sha256||attempt.recovery_required)||attempt.state==='active'&&!writing)){
      attempt={...attempt,state:'unknown',recovery_required:true,error_code:'custom_completion_unverified'};notice='Custom completion evidence is incomplete. Inspect the original transfer; the reviewed identity and build must both match.';
    }
    operationStatus=attempt?(attempt.state==='active'||writing&&(pendingStart||attempt.state==='succeeded')?'running':attempt.state):null;if(review&&remoteReview?.review_id!==review.review_id)clearReview();notify();
  }
  async function loadStatus(alive=()=>!closed){
    if(!capability||closed)return;
    try{const reply=await call('get_fm1_custom_update_status',{},signal);if(!closed&&alive()){notice='';applyStatus(reply);}}
    catch(error){if(!closed&&alive()){known=false;notice=errorText(error);notify();}throw error;}
  }
  async function selectFile(file,event,{json=false}={}){
    if(!trusted(event)||closed||stateContext().busy&&!stateContext().routineChecking||blocksDevice()||!usable()||otherBlocked()||!stateContext().connected)return;
    ++fileEpoch;const ticket=json?++manifestEpoch:++packageEpoch,isCurrent=()=>ticket===(json?manifestEpoch:packageEpoch);clearReview();if(json)manifest=null;else selected=null;selectionCount++;notice='';notify();
    try{
      const maximum=json?MAX_MANIFEST_BYTES:MAX_PACKAGE_BYTES;
      if(!file||!printable(file.name)||!(json?/\.json$/i:/\.fwsc$/i).test(file.name)||!Number.isSafeInteger(file.size)||file.size<1||file.size>maximum||typeof file.arrayBuffer!=='function')throw new Error(json?'Choose a generated custom FWSC manifest JSON file up to 8192 bytes.':'Choose a generated custom .fwsc package up to 2 MiB.');
      const buffer=await file.arrayBuffer();if(closed||!isCurrent())return;
      if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==file.size||buffer.byteLength>maximum)throw new Error('A selected custom firmware file changed size. Select it again.');
      const copy=new Uint8Array(buffer).slice();
      if(json){let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(copy).replace(/^\uFEFF/,''));}catch{throw new Error('The custom manifest must be valid UTF-8 JSON.');}manifest=checkedManifest(value);}
      else selected={name:file.name,bytes:copy};
      if(selected&&manifest&&selected.bytes.length!==manifest.raw_bytes)throw new Error('The selected custom package size does not match its manifest. Select the matching pair.');
    }catch(error){if(!closed&&isCurrent()){if(json)manifest=null;else selected=null;notice=errorText(error);}throw error;}
    finally{selectionCount--;if(!closed)notify();}
  }
  const selectManifest=(file,event)=>selectFile(file,event,{json:true}),selectPackage=(file,event)=>selectFile(file,event);
  function showReview(value,{resume,loaderEntry,key,ticket}={}){
    const next=checkedReview(value),originalRecovery=resume||loaderEntry;
    if(next.operation!==(loaderEntry?'loader-entry':resume?'resume':'install')||next.identity!==stateContext().identity||Date.parse(next.expires_at)<=Date.now()||key!==deviceKey()||ticket!==fileEpoch||originalRecovery&&next.job_id!==attempt?.job_id||
      originalRecovery&&(loaderEntry&&!hasOriginalMetadata(attempt)||!sameProfile(next,attempt)||next.target_build_sha256!==attempt.target_build_sha256||['sha256','logical_sha256','manifest_sha256','raw_bytes','logical_bytes'].some(key=>attempt[key]!==undefined&&next[key]!==attempt[key]))||!originalRecovery&&(!manifest||!sameProfile(next,manifest,{manifest:true})||next.sha256!==manifest.package_sha256||next.logical_sha256!==manifest.logical_sha256||next.target_build_sha256!==manifest.target_build_sha256||next.raw_bytes!==manifest.raw_bytes||next.logical_bytes!==manifest.logical_bytes))throw new Error('The custom package, build or device binding changed. Review it again.');
    review={...next,deviceKey:key,fileEpoch:ticket};
    put('desktop-custom-review-title',loaderEntry?'Prepare original recovery loader':resume?'Recover original custom transfer':'Install reviewed custom firmware');put('desktop-custom-confirm',loaderEntry?'Enter recovery loader':resume?'Resume original custom transfer':'Install reviewed custom firmware');
    put('desktop-custom-review-note',loaderEntry?'This runs the stock package-check phase using the original saved package and restarts FM-1 into its OTA recovery loader. It stops before application programming. Keep USB connected. After this step, connect stock MIDI and separately review the original custom recovery before confirming a flash.':`This replaces the application using the stock OTA path and restarts FM-1. Keep USB connected. The package's fixed V15 layout is checked offline; stock V15 cannot verify the connected device's complete live flash baseline. Completion checks the reviewed custom firmware identity and build digest, without full flash readback. Custom hardware qualification is pending.`);
    put('desktop-custom-review-text',[next.product,...(next.profile==='protracker'?['Profile: ProTracker','Boot verification: CDC serial (FWINFO nonce and exact build identity)']:[]),next.raw_bytes+' package bytes · '+next.logical_bytes+' logical bytes','Package SHA256 '+next.sha256,'Logical SHA256 '+next.logical_sha256,'Build SHA256 '+next.target_build_sha256,'Manifest SHA256 '+next.manifest_sha256,'Current identity: '+next.identity,'Expected boot identity: '+next.expected_boot_identity,'MIDI input: '+next.input_name,'MIDI output: '+next.output_name,'Original transfer: '+next.job_id,'Review expires: '+next.expires_at,'Preservation: fixed V15 layout checked offline.','Live full-flash baseline: unavailable from stock V15.',loaderEntry?'This step: check original package and identify OTA loader; stop before application programming.':'Completion evidence: reviewed identity and build digest; full flash readback is not performed.','Custom hardware qualification: pending.'].join('\n'));
    el('desktop-custom-dialog')?.showModal?.();notify();return {...next};
  }
  function stage(event,{resume=false,loaderEntry=false}={}){
    if(!trusted(event)||closed||stateContext().busy||blocksDevice()||!usable()||otherBlocked()||selectionCount)return;
    if(loaderEntry?!canEnterLoader():resume?(!unresolved()||canVerifyTracker()||!connected()||!stateContext().loader):(!normalStock()||!selected||!manifest||selected.bytes.length!==manifest.raw_bytes||unresolved()))return;
    const key=deviceKey(),ticket=fileEpoch,bytes=selected?.bytes,selectedManifest=manifest,jobId=attempt?.job_id;clearReview();clearOtherReview();notice='';
    return runExclusive(async alive=>{
      try{
        let reply;
        if(loaderEntry)reply=await call('review_fm1_custom_loader_entry',{job_id:jobId},signal);
        else if(resume)reply=await call('review_fm1_custom_recovery',{job_id:jobId},signal);
        else{
          const upload=await call('begin_fm1_custom_upload',{raw_bytes:bytes.length,manifest:JSON.parse(JSON.stringify(selectedManifest))},signal);if(closed||!alive())return;
          if(!id(upload?.upload_id)||!Number.isSafeInteger(upload.max_chunk_bytes)||upload.max_chunk_bytes<1||upload.max_chunk_bytes>MAX_CHUNK_BYTES)throw new Error('The native plugin returned invalid custom upload limits.');
          for(let offset=0;offset<bytes.length;offset+=upload.max_chunk_bytes){const chunk=bytes.subarray(offset,Math.min(bytes.length,offset+upload.max_chunk_bytes)),accepted=await call('append_fm1_custom_upload',{upload_id:upload.upload_id,offset,data_base64:base64(chunk)},signal);if(closed||!alive())return;if(accepted?.upload_id!==upload.upload_id||accepted.received_bytes!==offset+chunk.length)throw new Error('The custom upload acknowledgement changed. No chunk is retried automatically.');}
          reply=await call('review_fm1_custom_update',{upload_id:upload.upload_id},signal);
        }
        if(closed||!alive())return;return showReview(reply?.review,{resume,loaderEntry,key,ticket});
      }catch(error){if(!closed&&alive()){notice=errorText(error);notify();}throw error;}
    });
  }
  function confirm(event){
    if(!trusted(event)||closed||stateContext().busy||blocksDevice()||!usable()||otherBlocked()||!review)return;
    if(!validReview()){clearReview();notice='The custom review expired or its selected device changed. Review it again.';notify();return;}
    const selectedReview=review;clearReview();clearOtherReview();starting=true;activeOperation=selectedReview.operation;operationStatus='running';notice='';
    const original=attempt;
    attempt=selectedReview.operation==='loader-entry'?{...original,loader_entry_stage:'starting'}:{job_id:selectedReview.job_id,kind:'custom-fwsc',state:'prepared',phase:'Starting reviewed custom transfer',progress:null,transfer_finished:false,boot_identity_verified:false,boot_build_verified:false,readback_verified:false,recovery_required:false,target_build_sha256:selectedReview.target_build_sha256,expected_boot_identity:selectedReview.expected_boot_identity,observed_boot_identity:null,observed_build_sha256:null,...(selectedReview.profile==='protracker'?{profile:'protracker',verification_transport:'cdc'}:{})};
    return runExclusive(async alive=>{
      try{const reply=await call('start_fm1_custom_update',{review_id:selectedReview.review_id,confirmed:true},null);if(!closed&&alive())applyStatus(reply,{start:true,expectedJob:selectedReview.job_id,expectedBuild:selectedReview.target_build_sha256});}
      catch(error){if(!closed&&alive()){known=false;attempt=selectedReview.operation==='loader-entry'?{...original,state:'unknown',recovery_required:true,loader_entry_stage:'failed',loader_entry_error_code:'loader_entry_outcome_unknown'}:{...attempt,state:'unknown',phase:'Custom start outcome unavailable',recovery_required:true,error_code:'custom_start_outcome_unknown'};operationStatus='unknown';notice=errorText(error);notify();}throw error;}
      finally{if(!closed&&alive()){starting=false;notify();}}
    });
  }
  function verifyBoot(event){
    if(!trusted(event)||closed||stateContext().busy||blocksDevice()||!usable()||otherBlocked()||!canVerifyTracker())return;
    const original={...attempt};clearReview();clearOtherReview();starting=true;operationStatus='running';notice='';
    return runExclusive(async alive=>{
      try{
        const reply=await call('verify_fm1_custom_boot',{job_id:original.job_id},null);
        if(!closed&&alive())applyStatus(reply,{start:true,expectedJob:original.job_id,expectedBuild:original.target_build_sha256});
      }catch(error){
        if(!closed&&alive()){
          known=false;attempt={...original,state:'unknown',recovery_required:true,error_code:'custom_verification_outcome_unknown'};
          operationStatus='unknown';notice=errorText(error);notify();
        }
        throw error;
      }finally{if(!closed&&alive()){starting=false;notify();}}
    });
  }
  function cancel(){if(closed)return;clearReview();notify();}
  function dispose(){if(closed)return;closed=true;++fileEpoch;++manifestEpoch;++packageEpoch;clearReview();el('desktop-custom-dialog')?.removeEventListener?.('cancel',cancel);}
  const caught=fn=>event=>{if(trusted(event))void Promise.resolve(fn(event)).catch(()=>{});};
  for(const [key,fn] of [['desktop-custom-manifest',selectManifest],['desktop-custom-file',selectPackage]]){const node=el(key);if(node)node.onchange=event=>{if(trusted(event))void fn(node.files?.[0],event).catch(()=>{});};}
  for(const [key,fn] of [['desktop-custom-review',event=>stage(event)],['desktop-custom-recovery',event=>stage(event,{resume:true})],['desktop-custom-loader-entry',event=>stage(event,{loaderEntry:true})],['desktop-custom-confirm',confirm],['desktop-custom-verify',verifyBoot]]){const node=el(key);if(node)node.onclick=caught(fn);}
  const cancelButton=el('desktop-custom-cancel');if(cancelButton)cancelButton.onclick=cancel;el('desktop-custom-dialog')?.addEventListener?.('cancel',cancel);paint();
  return {paint,loadStatus,selectManifest,selectPackage,stage,confirm,verifyBoot,cancel,clearReview,dispose,blocksDevice,hasUnresolved:unresolved,isWriting:()=>writing||starting,state:()=>({enabled:capability,known,loaded,supported,writing:writing||starting,operationStatus,attempt:attempt?{...attempt}:null,review:review?{...review}:null})};
}
