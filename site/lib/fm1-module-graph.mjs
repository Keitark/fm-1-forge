// Static module catalogue and a small DOM controller shared by web/native panels.
export function createModuleGraphEngine(){
  const modules=[
    {id:'usb-cdc',part:'usb',title:'CDC serial',detail:'System connection',required:true},
    {id:'usb-uboot',part:'usb',title:'UBOOT helper',detail:'Recovery enabled by default',required:true},
    {id:'usb-uac',part:'usb',title:'USB audio · UAC',detail:'Playback + capture'},
    {id:'hal-buttons',part:'hal',title:'Keys, pads + buttons',detail:'41 inputs'},
    {id:'hal-encoders',part:'hal',title:'Encoders',detail:'7 rotary controls'},
    {id:'hal-volume',part:'hal',title:'Volume',detail:'Master-volume telemetry'},
    {id:'hal-lcd',part:'hal',title:'LCD drawing',detail:'Shared display API'},
    {id:'hal-audio',part:'hal',title:'Audio output',detail:'User sound callback'},
    {id:'module-diagnostics',part:'user',title:'Diagnostics + key tones',detail:'Input monitor and test tones'},
    {id:'module-user',part:'user',title:'Your firmware',detail:'Blank user-module starter'},
    {id:'tweak-fast-lcd',part:'tweaks',title:'Fast LCD',detail:'RGB444 · 15 / 30 MHz'},
    {id:'tweak-clock',part:'tweaks',title:'CPU · 320 MHz',detail:'Experimental · explicit opt-in'}
  ];
  const parts=['usb','hal','user','tweaks'];
  function moduleFor(id){const value=modules.find(item=>item.id===id);if(!value)throw new Error('Unknown firmware module.');return value;}
  function placement(id,part){const item=moduleFor(id);if(part==='library'){if(item.required)throw new Error(item.title+' stays enabled for connection and recovery.');return item;}if(part!==item.part)throw new Error(item.title+' belongs in '+({usb:'USB',hal:'HAL',user:'User module',tweaks:'Tweaks'}[item.part])+'.');return item;}
  function mount({el,onChange,signal}){
    let dragging=null;
    const announce=text=>{el('forge-graph-status').textContent=text;};
    function enabled(id){if(id==='usb-cdc'||id==='usb-uboot')return true;if(id==='usb-uac')return el('forge-usb-audio').checked===true;if(id.startsWith('hal-'))return el('forge-'+id).checked===true;if(id.startsWith('module-'))return el('forge-module').value===id.slice(7);if(id==='tweak-fast-lcd')return el('forge-lcd-preset').value!=='stock-dma';return el('forge-clock-preset').value==='sdk-320';}
    function sync(){
      for(const item of modules){const active=enabled(item.id);el('forge-card-'+item.id).hidden=!active;el('forge-add-'+item.id).hidden=active;el('forge-card-'+item.id).setAttribute('aria-label',item.title+(item.required?' · required':item.part==='user'?' · selected user module':' · drag to Available modules to remove'));}
      for(const part of parts)el('forge-empty-'+part).hidden=modules.some(item=>item.part===part&&enabled(item.id));
      el('forge-module-title').textContent=el('forge-module').value==='diagnostics'?'Diagnostics + key tones':'Your module';
      el('forge-module-summary').textContent=el('forge-module').value==='diagnostics'?'LCD input monitor and simple tones from the keys.':'A blank module using the selected HAL access.';
      announce(modules.filter(item=>item.part==='hal'&&enabled(item.id)).length+' of 5 HAL access modules selected. CDC and UBOOT helper enabled.');
    }
    function place(id,part){
      try{
        const item=placement(id,part),active=part!=='library';
        if(item.required){sync();announce(item.title+' is already enabled.');return true;}
        if(id==='usb-uac')el('forge-usb-audio').checked=active;
        else if(id.startsWith('hal-'))el('forge-'+id).checked=active;
        else if(id.startsWith('module-')){if(!active)throw new Error('Choose another user module to replace this one.');el('forge-module').value=id.slice(7);}
        else if(id==='tweak-fast-lcd'){if(!active)el('forge-lcd-preset').value='stock-dma';else if(el('forge-lcd-preset').value==='stock-dma')el('forge-lcd-preset').value='spi15-rgb444';}
        else {el('forge-clock-preset').value=active?'sdk-320':'sdk-default';if(!active)el('forge-clock-opt-in').checked=false;}
        sync();onChange();announce(item.title+(active?' added to '+({usb:'USB',hal:'HAL',user:'User module',tweaks:'Tweaks'}[part])+'.':' removed from the user configuration.')+(id==='tweak-clock'&&active?' Confirm the experimental clock below before exporting.':''));return true;
      }catch(error){announce(error.message);return false;}
    }
    function clearDrop(){for(const part of [...parts,'library'])el('forge-drop-'+part).removeAttribute('data-drag-over');}
    for(const item of modules){
      const start=event=>{dragging=item.id;event.dataTransfer?.setData('application/x-fm1-forge-module',item.id);if(event.dataTransfer)event.dataTransfer.effectAllowed=item.required?'copy':'move';announce('Drop '+item.title+' in '+({usb:'USB',hal:'HAL',user:'User module',tweaks:'Tweaks'}[item.part])+'.');};
      for(const id of ['forge-card-','forge-add-']){el(id+item.id).addEventListener('dragstart',start,{signal});el(id+item.id).addEventListener('dragend',()=>{dragging=null;clearDrop();},{signal});}
      el('forge-add-'+item.id).onclick=()=>place(item.id,item.part);
      if(!item.required)el('forge-remove-'+item.id).onclick=()=>item.part==='user'?place(item.id==='module-user'?'module-diagnostics':'module-user','user'):place(item.id,'library');
    }
    for(const part of [...parts,'library']){
      const zone=el('forge-drop-'+part);
      zone.addEventListener('dragover',event=>{if(!dragging)return;event.preventDefault();zone.setAttribute('data-drag-over','true');if(event.dataTransfer)event.dataTransfer.dropEffect='move';},{signal});
      zone.addEventListener('dragleave',()=>zone.removeAttribute('data-drag-over'),{signal});
      zone.addEventListener('drop',event=>{event.preventDefault();const id=event.dataTransfer?.getData('application/x-fm1-forge-module')||dragging;clearDrop();dragging=null;if(id)place(id,part);},{signal});
    }
    sync();return {sync,place};
  }
  return {modules,parts,placement,mount};
}
const engine=createModuleGraphEngine();
export const MODULES=engine.modules;
const card=item=>`<article id="forge-card-${item.id}" class="forge-module-card" draggable="true"><div><strong>${item.title}</strong><span>${item.detail}</span></div>${item.required?'<span class="forge-required">Required</span>':`<button id="forge-remove-${item.id}" class="forge-remove" type="button" aria-label="${item.part==='user'?'Replace':'Remove'} ${item.title}">${item.part==='user'?'Replace':'Remove'}</button>`}</article>`;
const zone=(part,title,note,extra='')=>`<section id="forge-drop-${part}" class="forge-drop-zone" aria-label="${title} modules"><div class="forge-zone-heading"><span class="eyebrow">${part==='usb'?'01':part==='hal'?'02':part==='user'?'03':'04'}</span><h3>${title}</h3></div><p class="note">${note}</p><div class="forge-zone-modules">${MODULES.filter(item=>item.part===part).map(card).join('')}<p id="forge-empty-${part}" class="forge-empty">Drop a ${title} module here.</p></div>${extra}</section>`;
export const moduleGraphHtml=`<div class="forge-graph-toolbar"><p>Drag modules into their matching section. Use Add / Remove with a keyboard.</p><span class="tag">USB recovery protected</span></div><section id="forge-drop-library" class="forge-module-library" aria-label="Available firmware modules"><h3>Available modules</h3><p class="note">Drag an optional module back here to remove it. Replacing the user module returns the previous one here.</p><div class="forge-module-shelf">${MODULES.map(item=>`<button id="forge-add-${item.id}" class="forge-module-chip" type="button" draggable="true" aria-label="Add ${item.title} to ${item.part}"><span aria-hidden="true">＋</span> ${item.title}</button>`).join('')}</div></section><div class="forge-module-canvas" aria-label="Firmware module graph">${zone('usb','USB','Serial and UBOOT helper stay enabled. UAC is optional.','<label class="forge-graph-check" for="forge-usb-audio"><input id="forge-usb-audio" type="checkbox" checked>USB audio (UAC)</label>')}${zone('hal','HAL','Available to your user module. All access is enabled by default. Fixed diagnostics and master-volume protection remain active.',`<div class="forge-hal-options">${['buttons','encoders','volume','lcd','audio'].map(name=>`<label class="forge-graph-check" for="forge-hal-${name}"><input id="forge-hal-${name}" type="checkbox" checked>${{buttons:'Keys / pads',encoders:'Encoders',volume:'Volume',lcd:'LCD',audio:'Audio'}[name]}</label>`).join('')}</div>`)}${zone('user','User module','Replace diagnostics with a starter for your own code.','<label for="forge-module">Module</label><select id="forge-module"><option value="diagnostics">Diagnostics + key tones</option><option value="user">Blank module starter</option></select><p class="note" id="forge-module-summary">LCD input monitor and simple tones from the keys.</p><span id="forge-module-title" class="forge-sr-only">Diagnostics + key tones</span>')}${zone('tweaks','Tweaks','Clock and LCD profiles apply to the fixed system runtime. Start with conservative settings.','<label for="forge-lcd-preset">LCD renderer</label><select id="forge-lcd-preset"><option value="stock-dma">Stock DMA · conservative</option><option value="spi15-rgb444">RGB444 · 15 MHz SPI</option><option value="spi30-rgb444">RGB444 · 30 MHz SPI</option></select><label for="forge-clock-preset">CPU clock</label><select id="forge-clock-preset"><option value="sdk-default">SDK default · conservative</option><option value="sdk-320">320 MHz · experimental opt-in</option></select><label class="forge-graph-check" for="forge-clock-opt-in"><input id="forge-clock-opt-in" type="checkbox">I choose the experimental clock for bench validation.</label><p class="note">Higher clocks require measured bus, USB, LCD and audio checks.</p>')}</div><p id="forge-graph-status" class="forge-status" role="status" aria-live="polite">All HAL access and the USB UBOOT helper are enabled.</p>`;
export const moduleGraphCss=`.forge-graph-toolbar{display:flex;gap:12px;justify-content:space-between;align-items:center;margin:18px 0 12px}.forge-graph-toolbar p{font-size:12px;color:var(--muted);margin:0}.forge-module-library{position:sticky;top:10px;z-index:2;border:1px dashed var(--line);background:var(--surface);border-radius:10px;padding:14px;margin-bottom:12px}.forge-module-library h3{font-size:13px;margin:0 0 5px}.forge-module-shelf{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;min-height:32px}.forge-module-chip{background:var(--header);border:1px solid var(--line);color:var(--ink);border-radius:7px;padding:8px 10px;font-size:12px;cursor:grab}.forge-module-canvas{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:20px}.forge-drop-zone{border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:14px;min-width:0}.forge-zone-heading{display:flex;align-items:center;gap:8px;margin-bottom:7px}.forge-zone-heading h3{font-size:16px;margin:0}.forge-zone-heading .eyebrow{margin:0}.forge-zone-modules{display:grid;gap:7px;margin:12px 0}.forge-module-card{display:flex;gap:8px;align-items:center;justify-content:space-between;border:1px solid var(--line);border-radius:7px;background:var(--header);padding:10px;cursor:grab;min-width:0}.forge-module-card strong{display:block;font-size:12px;line-height:1.4}.forge-module-card span:not(.forge-required){display:block;font-size:11px;color:var(--muted);margin-top:3px}.forge-remove{background:var(--surface);color:var(--ink);border:1px solid var(--line);font-size:11px;padding:5px;border-radius:5px;flex-shrink:0;cursor:pointer}.forge-required{font-size:10px;color:var(--accent-ink);flex-shrink:0}.forge-drop-zone>label{display:block;font-size:12px;color:var(--muted);margin:10px 0 5px}.forge-graph-check{display:flex!important;align-items:center;gap:6px;color:var(--ink)!important;font-size:12px;margin:8px 0}.forge-graph-check input{width:auto;accent-color:var(--accent);flex-shrink:0}.forge-hal-options{display:flex;flex-wrap:wrap;gap:0 14px}.forge-drop-zone[data-drag-over],.forge-module-library[data-drag-over]{outline:2px solid var(--accent);outline-offset:-2px}.forge-empty{font-size:12px;color:var(--muted);padding:18px;border:1px dashed var(--line);border-radius:6px}.forge-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.forge-module-canvas [hidden],.forge-module-library [hidden]{display:none!important}.forge-module-chip:focus-visible,.forge-remove:focus-visible{outline:2px solid var(--accent);outline-offset:3px}@media(max-width:560px){.forge-module-canvas{grid-template-columns:1fr}.forge-graph-toolbar{align-items:flex-start;flex-direction:column}}`;
export const moduleGraphRuntime='window.FM1ModuleGraph=('+createModuleGraphEngine.toString()+')();';
