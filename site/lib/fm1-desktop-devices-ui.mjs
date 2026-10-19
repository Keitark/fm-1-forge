/** Read-only foreground controls for the bundled Windows MCP device server.
 * Mounting never connects, requests browser permissions or sends device I/O.
 */
const TRANSPORTS=Object.freeze(['stock-midi','firmware-midi','serial']);
const BUTTONS=Object.freeze({'stock-midi':'direct-connect-midi','firmware-midi':'direct-connect-common',serial:'direct-connect-serial'});
const LABELS=Object.freeze({'stock-midi':'stock MIDI','firmware-midi':'firmware MIDI',serial:'USB serial'});
const UPDATE_CONTROLS=Object.freeze(['direct-stock-file','direct-stock-review','direct-stock-recovery','direct-review-confirm','direct-common-manifest','direct-common-file','direct-common-review','direct-common-confirm','install-diagnostics','stock-update']);
const trusted=event=>event?.isTrusted===true;
const printable=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!Array.from(value).some(character=>{const point=character.codePointAt(0);return point<32||point>=127&&point<=159||point>=0x202a&&point<=0x202e||point>=0x2066&&point<=0x2069;});
function transports(value){
  if(!Array.isArray(value)||value.length>TRANSPORTS.length||new Set(value).size!==value.length||value.some(item=>!TRANSPORTS.includes(item)))throw new Error('The desktop device transport capabilities are invalid.');
  return [...value];
}
function errorText(error){
  const value=typeof error==='string'?error:typeof error?.message==='string'?error.message:'The desktop device operation could not be completed.';
  return Array.from(value.slice(0,512)).filter(character=>{const point=character.codePointAt(0);return point>=32&&!(point>=127&&point<=159)&&!(point>=0x202a&&point<=0x202e)&&!(point>=0x2066&&point<=0x2069);}).join('').slice(0,256)||'The desktop device operation could not be completed.';
}
function snapshot(value,expectedTransport){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.connected!=='boolean'||value.installationAvailable!==false)throw new Error('The desktop device response did not confirm read-only operation.');
  if(value.transport!==null&&!TRANSPORTS.includes(value.transport))throw new Error('The desktop device response has an invalid transport.');
  if(value.connected&&(!printable(value.identity)||value.transport===null||expectedTransport&&value.transport!==expectedTransport))throw new Error('The desktop device connection identity or transport is invalid.');
  if(value.profile!==undefined&&value.profile!==null&&!printable(value.profile)||value.loader!==undefined&&typeof value.loader!=='boolean')throw new Error('The desktop device identity details are invalid.');
  return {connected:value.connected,transport:value.connected?value.transport:null,identity:value.connected?value.identity:null,profile:value.connected?(value.profile??null):null,loader:value.connected&&value.loader===true,installationAvailable:false,
    ...(value.supportedTransports!==undefined?{supportedTransports:transports(value.supportedTransports)}:{}),lastError:value.lastError?errorText(value.lastError):null};
}

export function mountDesktopDevicesUi({el,call,runtime=globalThis,signal,onChange=()=>{},supportedTransports=[],pollIntervalMs=3000}={}){
  if(typeof el!=='function'||typeof call!=='function')throw new TypeError('Desktop device controls require the panel elements and fixed MCP tool caller.');
  if(!Number.isInteger(pollIntervalMs)||pollIntervalMs<1000||pollIntervalMs>60000)throw new RangeError('Desktop status polling must be 1000–60000 milliseconds.');
  let available=transports(supportedTransports),current={connected:false,transport:null,identity:null,profile:null,loader:false,installationAvailable:false,lastError:null},closed=false,busy=false,checking=false,epoch=0,timer=null,pollPaused=false,notice='';
  const put=(id,text)=>{const node=el(id);if(node&&node.textContent!==text)node.textContent=text;};
  const clearTimer=()=>{if(timer!==null){if(typeof runtime.clearTimeout==='function')runtime.clearTimeout(timer);else globalThis.clearTimeout(timer);timer=null;}};
  const label=()=>current.connected?'FM-1 via '+LABELS[current.transport]+' · '+(current.profile||current.identity):'FM-1 disconnected';
  const summary=()=>current.connected?(current.loader?'OTA loader identity confirmed. Native firmware installation is unavailable.':'Firmware identity confirmed through the desktop plugin. Device installation remains unavailable.'):'Choose a supported connection. The desktop plugin checks the selected FM-1 identity.';
  function paint(){
    if(closed)return;
    put('device-heading',label());put('device-summary',summary());put('physical-device',label());
    put('connection-label',current.connected?'Device connected':'Device disconnected');
    const badge=el('connection');if(badge)badge.className='badge'+(current.connected?' online':'');
    const indicator=el('connection-check');if(indicator)indicator.hidden=!checking||runtime.document?.hidden===true;
    put('update-mode',current.connected?LABELS[current.transport]+' · desktop read-only':'Not connected');
    put('inventory-freshness','Windows desktop plugin connection');
    for(const transport of TRANSPORTS){const node=el(BUTTONS[transport]);if(node)node.disabled=busy||!available.includes(transport);}
    const disconnect=el('direct-disconnect');if(disconnect)disconnect.disabled=busy||!current.connected;
    for(const id of UPDATE_CONTROLS){const node=el(id);if(node)node.disabled=true;}
    for(const id of ['direct-stock-recovery','direct-transfer','direct-common-transfer']){const node=el(id);if(node)node.hidden=true;}
    const capabilities=available.length?'Available: '+available.map(transport=>LABELS[transport]).join(', ')+'.':'Device transport capabilities are unavailable. Use Refresh to check the desktop server.';
    put('direct-device-note',notice||'Device access runs through the bundled Windows plugin server. '+capabilities);
    const qualification='Desktop firmware installation is unavailable until the native transfer and recovery path is qualified. Connection checks do not write firmware.';
    put('direct-stock-note',qualification);put('direct-common-note',qualification);put('direct-package-summary','Native device connection only · package installation disabled.');put('direct-common-summary','Native device connection only · package installation disabled.');
    put('direct-hardware-note','Desktop connections use fixed MCP device tools. Browser MIDI, serial and USB permissions are not used.');
    onChange({connected:current.connected,transport:current.transport,profile:current.profile||current.identity,checking,writing:false,label:label(),installationAvailable:false});
  }
  function schedule(){
    clearTimer();if(closed||busy||pollPaused||!current.connected||runtime.document?.hidden)return;
    const check=()=>{timer=null;void refresh().catch(()=>{});};
    timer=typeof runtime.setTimeout==='function'?runtime.setTimeout(check,pollIntervalMs):globalThis.setTimeout(check,pollIntervalMs);
  }
  async function run(name,args,{expectedTransport,check=false}={}){
    if(closed||busy)return;
    clearTimer();busy=true;checking=check;notice='';const ticket=++epoch;paint();
    try{
      const reply=await call(name,args,signal);if(closed||ticket!==epoch)return;
      const next=snapshot(reply,expectedTransport),nextAvailable=next.supportedTransports??available;
      if(next.connected&&!nextAvailable.includes(next.transport))throw new Error('The desktop server reported a connection through an unavailable transport.');
      available=nextAvailable;current=next;pollPaused=false;notice=next.lastError||'';return {...current,supportedTransports:[...available]};
    }catch(error){
      if(closed||ticket!==epoch)return;
      pollPaused=true;notice=errorText(error)+(current.connected?' Last confirmed identity retained; use Refresh to check again.':'');throw error;
    }finally{if(!closed&&ticket===epoch){busy=false;checking=false;paint();schedule();}}
  }
  function connect(transport,event){
    if(!trusted(event)||closed||busy)return;
    if(!available.includes(transport)){notice='This desktop build does not support '+LABELS[transport]+'.';paint();return;}
    return run('connect_fm1_device',{transport},{expectedTransport:transport,check:true});
  }
  const connectSerial=event=>connect('serial',event),connectMidi=event=>connect('stock-midi',event),connectCommon=event=>connect('firmware-midi',event);
  function refresh(){return run('get_fm1_device_status',{}, {check:true});}
  function disconnect(event){if(!trusted(event)||closed||busy||!current.connected)return;return run('disconnect_fm1_device',{});}
  function visibility(){if(runtime.document?.hidden){clearTimer();paint();}else{paint();schedule();}}
  function dispose(){if(closed)return;closed=true;++epoch;clearTimer();runtime.document?.removeEventListener?.('visibilitychange',visibility);runtime.removeEventListener?.('pagehide',dispose);signal?.removeEventListener?.('abort',dispose);}
  for(const transport of TRANSPORTS){const node=el(BUTTONS[transport]);if(node)node.onclick=event=>{void Promise.resolve(connect(transport,event)).catch(()=>{});};}
  const disconnectButton=el('direct-disconnect');if(disconnectButton)disconnectButton.onclick=event=>{void Promise.resolve(disconnect(event)).catch(()=>{});};
  for(const id of UPDATE_CONTROLS){const node=el(id);if(node){node.onclick=()=>{};node.onchange=()=>{};}}
  runtime.document?.addEventListener?.('visibilitychange',visibility);runtime.addEventListener?.('pagehide',dispose,{once:true});signal?.addEventListener?.('abort',dispose,{once:true});
  paint();if(signal?.aborted)dispose();
  return {paint,refresh,connectSerial,connectMidi,connectCommon,disconnect,dispose,ready:Promise.resolve(),state:()=>({connected:current.connected,transport:current.transport,identity:current.identity,profile:current.profile,loader:current.loader,installationAvailable:false,supportedTransports:[...available],label:label(),busy,checking,operationStatus:null,attempt:null,review:null})};
}
if(typeof window!=='undefined')window.FM1DesktopDevicesUI={mount:mountDesktopDevicesUi};
