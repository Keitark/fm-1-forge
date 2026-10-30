/** Portable Forge project configuration; no filesystem, service or device I/O. */
function createForgeProjectEngine() {
  const STARTER='firmware/forge';
  const CLOCK_PRESETS=['sdk-default','sdk-320'];
  const LCD_PRESETS=['stock-dma','spi15-rgb444','spi30-rgb444'];
  const HAL_KEYS=['buttons','encoders','volume','lcd','audio'];
  const exactFields=(value,fields)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field));
  const defaultHal=()=>Object.fromEntries(HAL_KEYS.map(key=>[key,true]));
  function validatedHal(value){
    if(!exactFields(value,HAL_KEYS)||HAL_KEYS.some(key=>typeof value[key]!=='boolean'))throw new Error('Choose exactly five boolean HAL selections: buttons, encoders, volume, LCD and audio.');
    return Object.fromEntries(HAL_KEYS.map(key=>[key,value[key]]));
  }
  function projectConfig(input={}) {
    const fields=['slug','displayName','clockPreset','clockOptIn','lcdPreset','module','usbAudio'];
    if(!exactFields(input,[...fields,...['hal','usbVideo','usbMidiUpdate','usbAudioCapture'].filter(key=>Object.hasOwn(input??{},key))]))throw new Error('Enter a firmware project configuration with the supported fields.');
    const slug=typeof input.slug==='string'?input.slug.trim():'',displayName=typeof input.displayName==='string'?input.displayName.trim():'';
    if(!/^[a-z][a-z0-9-]{0,47}$/.test(slug)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slug))throw new Error('Use a project folder with lowercase letters, numbers and hyphens, starting with a letter; avoid Windows reserved names.');
    if(!displayName||displayName.length>64||/[\u0000-\u001f\u007f]/.test(displayName))throw new Error('Enter a project name of 1–64 printable characters.');
    if(!CLOCK_PRESETS.includes(input.clockPreset))throw new Error('Choose a supported CPU clock preset.');
    if(input.clockPreset==='sdk-320'&&input.clockOptIn!==true)throw new Error('Confirm the experimental CPU clock before preparing this project.');
    if(!LCD_PRESETS.includes(input.lcdPreset))throw new Error('Choose a supported LCD preset.');
    if(input.clockPreset==='sdk-320'&&input.lcdPreset!=='stock-dma')throw new Error('320 MHz is incompatible with the RGB444 LCD presets: its 53 MHz LSB bus cannot provide their required 60 MHz clock. Choose stock DMA or the SDK default CPU clock.');
    if(!['diagnostics','user'].includes(input.module))throw new Error('Choose diagnostics or a blank user module.');
    if(typeof input.usbAudio!=='boolean')throw new Error('Choose whether USB audio is enabled.');
    if(Object.hasOwn(input,'usbVideo')&&typeof input.usbVideo!=='boolean')throw new Error('Choose whether USB video is enabled.');
    if(Object.hasOwn(input,'usbMidiUpdate')&&typeof input.usbMidiUpdate!=='boolean')throw new Error('Choose whether firmware MIDI update is enabled.');
    if(Object.hasOwn(input,'usbAudioCapture')&&typeof input.usbAudioCapture!=='boolean')throw new Error('Choose whether USB audio capture is enabled.');
    const uacCapture=input.usbAudio&&(input.usbAudioCapture??true),usbVideo=input.usbVideo??false,usbMidiUpdate=input.usbMidiUpdate??true;
    const usbInEndpoints=2+Number(uacCapture)+Number(usbMidiUpdate)+Number(usbVideo);
    if(usbInEndpoints>4)throw new Error('USB IN endpoint budget exceeded ('+usbInEndpoints+'/4). Disable audio capture, MIDI or video.');
    const hal=Object.hasOwn(input,'hal')?validatedHal(input.hal):defaultHal();
    return {schemaVersion:4,project:{slug,displayName},profile:'forge-diag',clockPreset:input.clockPreset,lcdPreset:input.lcdPreset,module:input.module,usb:{cdc:true,uac:input.usbAudio,uacCapture,uvc:usbVideo,midiUpdate:usbMidiUpdate,uboot:true},hal};
  }
  function normalizeProjectConfig(config) {
    // Migrate legacy intent: earlier files never selected the firmware MIDI receiver.
    const fields=['schemaVersion','project','profile','clockPreset','lcdPreset','module','usb'];
    if(!config||![1,2,3,4].includes(config.schemaVersion)||!exactFields(config,config.schemaVersion===1?fields:[...fields,'hal'])||
      !exactFields(config.project,['slug','displayName'])||!exactFields(config.usb,config.schemaVersion===4?['cdc','uac','uacCapture','uvc','midiUpdate','uboot']:config.schemaVersion===3?['cdc','uac','uvc','uboot']:['cdc','uac','uboot'])||
      config.profile!=='forge-diag'||config.usb.cdc!==true||config.usb.uboot!==true||(config.schemaVersion===4&&config.usb.uac===false&&config.usb.uacCapture!==false))throw new Error('Invalid Forge project or recovery configuration.');
    const safe=projectConfig({slug:config.project.slug,displayName:config.project.displayName,clockPreset:config.clockPreset,clockOptIn:config.clockPreset==='sdk-320',lcdPreset:config.lcdPreset,module:config.module,usbAudio:config.usb.uac,usbAudioCapture:config.schemaVersion===4?config.usb.uacCapture:config.usb.uac,usbVideo:config.schemaVersion>=3?config.usb.uvc:false,usbMidiUpdate:config.schemaVersion===4?config.usb.midiUpdate:false,...(config.schemaVersion!==1?{hal:config.hal}:{})});
    if(safe.project.slug!==config.project.slug||safe.project.displayName!==config.project.displayName)throw new Error('Invalid Forge project names: leading or trailing spaces are not supported.');
    return safe;
  }
  function projectPrompt(config,goal='') {
    const safe=normalizeProjectConfig(config);
    if(typeof goal!=='string'||goal.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(goal))throw new Error('Describe your firmware goal in up to 2000 characters.');
    return 'Create and build my FM-1 Forge firmware project from the repository starter '+STARTER+'.\n'+
      'Read the repository instructions and the Forge starter guide first. Preserve active firmware work and rollback.\n'+
      'Use the selected shared HAL access for the user module: '+(HAL_KEYS.filter(key=>safe.hal[key]).join(', ')||'none')+'. Disabled selections are unavailable to user callbacks; they do not power down fixed hardware drivers.\n'+
      'Preserve fixed diagnostics, CDC serial, UBOOT recovery, USB audio mixing and the physical master-volume gain. The HAL covers all 41 inputs, 7 encoders, volume ADC, LCD and audio.\n'+
      'Implement the configured user module and keep fixed USB/system code separate. Validate the configuration with the Forge generator, build it and report the binary/hash and offline checks.\n'+
      'USB video (UVC) screen mirror is '+(safe.usb.uvc?'selected; validate USB enumeration and capture on the target hardware.':'disabled; do not enable it implicitly.')+'\n'+
      'Firmware MIDI update is '+(safe.usb.midiUpdate?'selected: include the experimental USB MIDI + SysEx receiver in the composite device. This does not qualify a loader installation or enable device installation; retain the existing installation gate.':'disabled; do not enable the USB MIDI + SysEx receiver implicitly.')+'\n'+
      'USB audio profile is '+(!safe.usb.uac?'disabled.':!safe.usb.uacCapture?'playback-only; USB audio capture is explicitly disabled. This composite profile still requires hardware validation.':'duplex; retain USB audio playback and capture.')+'\n'+
      'Keep the USB IN endpoint budget within four: CDC uses two; audio capture, MIDI and video each use one. Preserve the explicit module choices; do not disable a selected module automatically.'+'\n'+
      'Save the JSON below to a local configuration file. Create a fresh directory with python firmware/forge/create_project.py --base <new-project-parent> --slug '+safe.project.slug+' --config <configuration-file>. It must not overwrite an existing project.\n'+
      'The generated project contains forge.json and user.c. Build with python firmware/forge/build_project.py --project <generated-project-directory>; use --dry-run first to inspect the command.\n'+
      'Experimental CPU clocks require bus/readback guards and explicit bench validation. Do not flash from this request; prepare a reviewed transfer and wait for human confirmation.\n'+
      'Project goal (user-provided brief):\n'+(goal.trim()||'Start with the selected module and document how to extend it.')+'\n\n'+
      'Forge configuration:\n'+JSON.stringify(safe,null,2);
  }
  function verifiedDiagnostics(job) {
    return !!(job&&/^[a-f0-9]{32}$/.test(job.id||'')&&job.catalog_id==='factory-diag'&&job.status==='succeeded'&&job.full_readback_verified===true&&job.boot_verified===true&&!job.simulation);
  }
  function verifiedBaseline(baseline) {
    return !!(baseline&&baseline.catalog_id==='factory-diag'&&/^[a-f0-9]{32}$/.test(baseline.job_id||'')&&/^[a-f0-9]{64}$/.test(baseline.sha256||'')&&baseline.verified_at&&baseline.write_verified===true&&baseline.full_readback_verified===true&&baseline.boot_verified===true);
  }
  return {STARTER,CLOCK_PRESETS,LCD_PRESETS,HAL_KEYS,projectConfig,normalizeProjectConfig,projectPrompt,verifiedDiagnostics,verifiedBaseline};
}
export const {STARTER,CLOCK_PRESETS,LCD_PRESETS,HAL_KEYS,projectConfig,normalizeProjectConfig,projectPrompt,verifiedDiagnostics,verifiedBaseline}=createForgeProjectEngine();
export const forgeProjectRuntime='window.FM1Forge=('+createForgeProjectEngine.toString()+')();';
