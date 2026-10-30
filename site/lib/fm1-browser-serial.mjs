/** Foreground FM-1 CDC diagnostics. Device permission is requested by connect() only.
 * This transport has no firmware, STOP, UBOOT or arbitrary command API.
 * UBOOT exposes a vendor mass-storage protocol outside standard Web Serial.
 */
export const FM1_SERIAL_USB=Object.freeze({usbVendorId:0x3654,usbProductId:0x5155});
const MAX_LINE=4096,MAX_CHUNK=65536;
const HELLO_PROFILES=new Map([
  ['FM1DIAG/1 FM1-FORGE/1 UBOOT=SERIAL COMMIT=BLOCKED','FM1-FORGE/1'],
  ['FM1DIAG/1 MOD-EDITOR/1 RAM-TRANSFER UBOOT=SERIAL COMMIT=BLOCKED','MOD-EDITOR/1'],
  ['FM1DIAG/1 MDX-KARAOKE/1 RAM-UPLOAD UBOOT=SERIAL COMMIT=BLOCKED','MDX-KARAOKE/1'],
  ['FM1DIAG/1 DOOM-FM1/1 UBOOT=SERIAL COMMIT=BLOCKED','DOOM-FM1/1'],
  ['FM1DIAG/1 USB-ONLY UPDATE=VERIFY-ONLY COMMIT=BLOCKED','USB-ONLY'],
  ['FM1DIAG/1 PERIPHERAL-TEST/1 UBOOT=SERIAL UPDATE=VERIFY-ONLY COMMIT=BLOCKED','PERIPHERAL-TEST/1'],
  ...['STOCK-SEQ','STOCK-DMA','STOCK-FILL'].map(lcd=>
    [`FM1DIAG/1 PERIPHERAL-TEST/1 LCD=${lcd} UBOOT=SERIAL UPDATE=VERIFY-ONLY COMMIT=BLOCKED`,'PERIPHERAL-TEST/1']),
]);
const rule=(command,prefix,required,optional=[])=>Object.freeze({command,prefix,required,allowed:new Set([...required,...optional])});
const RULES=Object.freeze({
  'FM1-FORGE/1':rule('FORGE STATUS','FORGE STATUS ',['ready','running','pending','frames','audio_frames','scans','keys','lcd','fault','input_errors','adc_errors']),
  'MOD-EDITOR/1':rule('MOD STATUS','MOD status ',['ready','running','dirty','export','order','row','ch','sample','lcd','keys','audio','frames','underruns'],['mix','edit','ui','strips']),
  'MDX-KARAOKE/1':rule('MDX STATUS','MDX ',['running','pending','frames','underruns','error','lcd','keys','audio']),
  'DOOM-FM1/1':rule('DOOM STATUS','DOOM STATUS ',['stage','fault','frames','stopped','lcd_stage','lcd_error','key_error','sys_hz','lsb_hz']),
  'NES':rule('TEST STATUS','TEST STATUS ',['ready','busy','mode','dropped','frames','irqs','fault']),
  'PERIPHERAL-TEST/1':rule('TEST STATUS','TEST STATUS ',['ready','busy','mode','dropped','frames','irqs','fault']),
  'USB-ONLY':rule('STATUS','STATUS ',['active','verified','bytes']),
});
const PUBLIC_COUNTERS=new Set(['ready','running','pending','frames','audio_frames','scans','lcd','fault','input_errors','adc_errors','audio','underruns','error','stage','stopped','lcd_stage','lcd_error','key_error','sys_hz','lsb_hz','busy','mode','dropped','irqs','active','verified','bytes']);
const timers={setTimeout:(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout:id=>globalThis.clearTimeout(id)};

export class BrowserSerialError extends Error{
  constructor(code,message){super(message);this.name='BrowserSerialError';this.code=code;}
}
const fail=(code,message)=>new BrowserSerialError(code,message);
export function serialHelloProfile(line){
  const exact=HELLO_PROFILES.get(line);
  if(exact)return exact;
  if(/^FM1DIAG\/1 NES=(?:SMB1|INES)$/.test(line)||
     /^FM1DIAG\/1 PERIPHERAL-TEST\/1 LCD=STOCK-SEQ NES=(?:SMB1|INES) UBOOT=SERIAL UPDATE=VERIFY-ONLY COMMIT=BLOCKED$/.test(line))return 'NES';
  return null;
}
function parseStatus(line,profile){
  const spec=RULES[profile];
  if(!spec||!line.startsWith(spec.prefix))return null;
  // Doom's free-text error follows its numeric record; it is never rendered.
  const body=(profile==='DOOM-FM1/1'?line.split(' error=',1)[0]:line).slice(spec.prefix.length);
  const values={};
  for(const token of body.split(' ')){
    const match=/^([a-z_]+)=(-?[0-9]+|[0-9a-fA-F]{16})$/.exec(token);
    if(!match||!spec.allowed.has(match[1])||Object.hasOwn(values,match[1]))throw fail('invalid_status','FM-1 returned an invalid diagnostics record.');
    const [,name,raw]=match;
    if(profile==='FM1-FORGE/1'&&name==='keys'){
      if(!/^[0-9a-fA-F]{16}$/.test(raw))throw fail('invalid_status','FM-1 returned an invalid diagnostics record.');
      values[name]=raw;
    }else{
      if(!/^-?[0-9]+$/.test(raw))throw fail('invalid_status','FM-1 returned an invalid diagnostics record.');
      const value=Number(raw);
      if(!Number.isSafeInteger(value)||value < -0x80000000||value > 0xffffffff)throw fail('invalid_status','FM-1 diagnostics value exceeds its bound.');
      values[name]=value;
    }
  }
  if(!spec.required.every(name=>Object.hasOwn(values,name)))throw fail('invalid_status','FM-1 returned an incomplete diagnostics record.');
  const counters=Object.fromEntries(Object.entries(values).filter(([name])=>PUBLIC_COUNTERS.has(name)));
  return {profile,command:spec.command,counters,diagnosticOnly:true,bootVerified:false};
}

export class BrowserSerial{
  constructor({serial=globalThis.navigator?.serial,onState=()=>{},clock=timers,timeoutMs=2500,lifecycleTarget=globalThis}={}){
    if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)throw new RangeError('Serial timeout must be 100–10000 milliseconds.');
    this._serial=serial;this._onState=onState;this._clock=clock;this._timeoutMs=timeoutMs;this._lifecycleTarget=lifecycleTarget;
    this._port=null;this._reader=null;this._writer=null;this._reading=null;this._closing=null;this._waiter=null;this._epoch=0;
    this._state={transport:'webserial',connected:false,connecting:false,checking:false,profile:null,statusCommand:null,status:null,error:null,diagnosticOnly:true,bootVerified:false};
    this._disconnect=event=>{if(event?.port===this._port||event?.target===this._port)void this._close('disconnected');};
    this._portDisconnect=()=>{void this._close('disconnected');};
    this._pageHide=()=>{void this._close(null);};
    this._serial?.addEventListener?.('disconnect',this._disconnect);
    this._lifecycleTarget?.addEventListener?.('pagehide',this._pageHide);
  }
  getState(){return {...this._state,status:this._state.status?{...this._state.status,counters:{...this._state.status.counters}}:null};}
  _publish(changes){Object.assign(this._state,changes);try{this._onState(this.getState());}catch{/* UI callbacks cannot take ownership of the port. */}}
  async connect(){
    if(this._state.connected||this._state.connecting||this._closing)throw fail('connection_busy','A browser serial connection is already active.');
    if(typeof this._serial?.requestPort!=='function')throw fail('serial_unavailable','This panel does not provide Web Serial device access.');
    const epoch=++this._epoch;
    this._publish({connecting:true,connected:false,checking:false,profile:null,statusCommand:null,status:null,error:null});
    let selected=null,stage='chooser';
    try{
      selected=await this._serial.requestPort({filters:[{...FM1_SERIAL_USB}]});
      stage='opening';
      if(epoch!==this._epoch)throw fail('connection_canceled','Browser serial connection was canceled.');
      const info=selected?.getInfo?.();
      if(info?.usbVendorId!==FM1_SERIAL_USB.usbVendorId||info?.usbProductId!==FM1_SERIAL_USB.usbProductId)throw fail('wrong_device','Select the FM-1 diagnostics USB serial device.');
      this._port=selected;selected.addEventListener?.('disconnect',this._portDisconnect);
      await selected.open({baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none',bufferSize:4096});
      if(epoch!==this._epoch)throw fail('connection_canceled','Browser serial connection was canceled.');
      // Existing CDC overlay gates ready/transmit on DTR (bmTransceiver &17).
      // Match flash_session_worker.py once: DTR true, RTS false. Never pulse it.
      if(typeof selected.setSignals!=='function')throw fail('signals_unavailable','FM-1 diagnostics requires the CDC DTR readiness signal.');
      await selected.setSignals({dataTerminalReady:true,requestToSend:false});
      if(epoch!==this._epoch)throw fail('connection_canceled','Browser serial connection was canceled.');
      if(!selected.readable||!selected.writable)throw fail('serial_stream_unavailable','FM-1 serial streams are unavailable.');
      this._reader=selected.readable.getReader();this._writer=selected.writable.getWriter();
      this._reading=this._readLoop(this._reader,epoch);
      const profile=await this._exchange('HELLO',line=>{
        if(!line.startsWith('FM1DIAG/1'))return null;
        const recognized=serialHelloProfile(line);
        if(!recognized)throw fail('unknown_firmware','FM-1 serial firmware identity is not recognized.');
        return recognized;
      });
      if(epoch!==this._epoch)throw fail('connection_canceled','Browser serial connection was canceled.');
      this._publish({connecting:false,connected:true,profile,statusCommand:RULES[profile].command,error:null});
      return this.getState();
    }catch(error){
      const safe=error instanceof BrowserSerialError?error:error?.name==='NotFoundError'
        ?stage==='chooser'
          ?fail('permission_canceled','No FM-1 serial port was selected. If no chooser appeared, this host may not support serial device selection.')
          :fail('serial_open_failed','The selected FM-1 serial port is unavailable.')
        :fail(error?.name==='SecurityError'||error?.name==='NotAllowedError'?'permission_denied':'serial_open_failed',error?.name==='SecurityError'||error?.name==='NotAllowedError'?'The host did not allow FM-1 serial access.':'Could not open the FM-1 diagnostics serial port.');
      // A canceled chooser/open must never close a newer connection. A port
      // whose open() completes after close() still needs its own cleanup.
      if(epoch!==this._epoch){
        if(selected!==this._port){try{await selected?.close?.();}catch{}}
        throw safe;
      }
      await this._close(safe.code);throw safe;
    }
  }
  async readStatus(){
    if(!this._state.connected||!this._state.profile)throw fail('not_connected','Connect to FM-1 serial diagnostics first.');
    if(this._waiter||this._state.checking)throw fail('operation_busy','A serial diagnostics request is already active.');
    const profile=this._state.profile;
    this._publish({checking:true});
    try{
      const status=await this._exchange(RULES[profile].command,line=>parseStatus(line,profile));
      this._publish({status,checking:false,error:null});return this.getState().status;
    }catch(error){
      const safe=error instanceof BrowserSerialError?error:fail('serial_io_failed','Could not read FM-1 serial diagnostics.');
      await this._close(safe.code);throw safe;
    }
  }
  async _exchange(command,accept){
    if(this._waiter)throw fail('operation_busy','A serial diagnostics request is already active.');
    if(!this._writer)throw fail('not_connected','The FM-1 serial port is closed.');
    let resolve,reject;
    const reply=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const waiter={accept,resolve,reject,timer:null};this._waiter=waiter;
    waiter.timer=this._clock.setTimeout(()=>this._finishWaiter(waiter,fail('serial_timeout','FM-1 serial diagnostics did not respond in time.')),this._timeoutMs);
    try{
      const write=this._writer.write(new TextEncoder().encode(command+'\n'));
      const [,answer]=await Promise.all([write,reply]);return answer;
    }catch(error){
      const safe=error instanceof BrowserSerialError?error:fail('serial_io_failed','Could not exchange FM-1 serial diagnostics.');
      this._finishWaiter(waiter,safe);throw safe;
    }
  }
  _finishWaiter(waiter,error,value){
    if(this._waiter!==waiter)return;
    this._waiter=null;this._clock.clearTimeout(waiter.timer);
    if(error)waiter.reject(error);else waiter.resolve(value);
  }
  _line(line){
    const waiter=this._waiter;if(!waiter)return;
    try{const result=waiter.accept(line);if(result!=null)this._finishWaiter(waiter,null,result);}
    catch(error){this._finishWaiter(waiter,error);}
  }
  async _readLoop(reader,epoch){
    const decoder=new TextDecoder('utf-8',{fatal:true});let pending='';
    try{
      while(epoch===this._epoch){
        const {value,done}=await reader.read();
        if(epoch!==this._epoch)return;
        if(done)throw fail('disconnected','FM-1 serial disconnected.');
        if(!(value instanceof Uint8Array)||value.byteLength>MAX_CHUNK)throw fail('serial_bounds','FM-1 serial data exceeds its bound.');
        pending+=decoder.decode(value,{stream:true});
        let end;
        while((end=pending.indexOf('\n'))!==-1){
          if(end>MAX_LINE)throw fail('serial_bounds','FM-1 serial line exceeds its bound.');
          const line=pending.slice(0,end).replace(/\r$/,'');pending=pending.slice(end+1);
          this._line(line);
        }
        if(pending.length>MAX_LINE)throw fail('serial_bounds','FM-1 serial line exceeds its bound.');
      }
    }catch(error){
      if(epoch!==this._epoch)return;
      const safe=error instanceof BrowserSerialError?error:fail('serial_read_failed','FM-1 serial stream could not be read.');
      if(this._waiter)this._finishWaiter(this._waiter,safe);
      // Do not await this loop's own cancellation during cleanup.
      void this._close(safe.code);
    }
  }
  close(){return this._close(null);}
  async _close(error){
    if(this._closing)return this._closing;
    ++this._epoch;
    if(this._waiter)this._finishWaiter(this._waiter,fail('disconnected','The FM-1 serial connection was closed.'));
    const port=this._port,reader=this._reader,writer=this._writer;
    this._port=null;this._reader=null;this._writer=null;this._reading=null;
    this._publish({connected:false,connecting:false,checking:false,profile:null,statusCommand:null,status:null,error});
    port?.removeEventListener?.('disconnect',this._portDisconnect);
    this._closing=(async()=>{
      try{await reader?.cancel();}catch{}
      try{reader?.releaseLock();}catch{}
      try{await writer?.abort();}catch{}
      try{writer?.releaseLock();}catch{}
      try{await port?.close();}catch{}
    })();
    try{await this._closing;}finally{this._closing=null;}
  }
  async dispose(){
    this._serial?.removeEventListener?.('disconnect',this._disconnect);
    this._lifecycleTarget?.removeEventListener?.('pagehide',this._pageHide);
    await this.close();
  }
}
if(typeof window!=='undefined')window.FM1BrowserSerial={BrowserSerial,FM1_SERIAL_USB};
