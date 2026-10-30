export const extensionCss=String.raw`
.forge-extension{margin:0 0 20px;padding:16px;border:1px solid var(--line);border-radius:13px;background:var(--header)}
.forge-extension>summary{font-size:16px;font-weight:700;cursor:var(--cursor-interaction,pointer)}
.extension-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin:16px 0}.extension-grid label{display:block;font-size:12px;color:var(--muted);margin:0 0 6px}
.extension-grid .wide{grid-column:1/-1}.extension-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.extension-status{font-size:12px;color:var(--muted);margin-top:10px}.extension-project-list{display:grid;gap:8px;margin-top:14px}.extension-project-list button{text-align:left}
button,a,summary{cursor:var(--cursor-interaction,pointer)}#forge-resource-text{font:12px/1.5 ui-monospace,Consolas,monospace;min-height:180px}
body.plugin main{padding-top:calc(20px + var(--fm1-safe-top,0px));padding-bottom:calc(20px + var(--fm1-safe-bottom,0px));padding-left:calc(20px + var(--fm1-safe-left,0px));padding-right:calc(20px + var(--fm1-safe-right,0px))}
@media(max-width:560px){.extension-grid{grid-template-columns:1fr}.extension-grid .wide{grid-column:auto}}
`;
export function extensionHtml(palettes,patterns){return String.raw`
<details class="forge-extension" id="forge-project-library"><summary>Configuration drafts</summary><p class="note">Save and reopen project configurations before building. These drafts do not compile or transfer firmware.</p><div class="extension-actions"><button class="primary" id="forge-save-draft">Save configuration draft</button><button class="secondary" id="forge-new-draft">New configuration draft</button><button class="secondary" id="forge-native-form">Configure with native form</button><button class="secondary" id="forge-list-projects">Refresh drafts</button></div><p class="extension-status" id="forge-draft-status" role="status"></p><div class="extension-project-list" id="forge-projects"></div></details>
<details class="forge-extension" id="forge-extension-panel"><summary>Codex integration & files</summary><p class="note">Attach the selected configuration to model context, choose a conversation action, or inspect a file selected by the host.</p><div class="extension-actions"><button class="secondary" id="forge-context-attach">Attach configuration to context</button><button class="secondary" id="forge-context-clear">Clear attached context</button><button class="secondary" id="forge-fullscreen">Fullscreen</button><button class="secondary" id="forge-inline">Inline view</button></div><p class="extension-status" id="forge-context-status" role="status">Open the native plugin panel to use host features.</p><div class="extension-grid"><div class="wide"><label for="forge-local-path">Local file path on this device</label><input id="forge-local-path" placeholder="C:\\Projects\\my-fm1\\forge.json" maxlength="4096" spellcheck="false" autocomplete="off"><button class="secondary retry" id="forge-open-local">Open in native file viewer</button></div></div><p class="extension-status" id="forge-file-status" role="status"></p><section id="forge-resource-panel" hidden><h2 id="forge-resource-title">Selected file</h2><p class="digest" id="forge-resource-uri"></p><textarea id="forge-resource-text" rows="12" spellcheck="false" aria-label="Selected resource text"></textarea><div class="extension-actions"><button class="primary" id="forge-resource-save">Save file</button><button class="secondary" id="forge-resource-load">Use as project configuration</button><button class="secondary" id="forge-resource-reload">Discard edits & reload</button></div><p class="extension-status" id="forge-resource-status" role="status"></p><p class="note">File contents are shown as plain text. Saving requires a valid Forge configuration and host permission. Concurrent changes preserve your edits.</p></section></details>
<details class="forge-extension" id="forge-settings"><summary>Plugin defaults</summary><p class="note">Owner settings are saved with the service and appear in native plugin settings. This browser's appearance choice is retained until you apply defaults here.</p><div class="extension-grid"><div><label for="forge-settings-palette">Palette</label><select id="forge-settings-palette">${palettes.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div><div><label for="forge-settings-pattern">Pattern</label><select id="forge-settings-pattern">${patterns.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div><div><label for="forge-settings-entry">Transfer default</label><select id="forge-settings-entry"><option value="auto">Auto detect</option><option value="serial">Serial → UBOOT</option><option value="already_uboot">Already UBOOT</option></select></div><div><label for="forge-settings-module">Module default</label><select id="forge-settings-module"><option value="diagnostics">Diagnostics</option><option value="user">Blank user module</option></select></div><div class="wide"><label><input id="forge-settings-uac" type="checkbox" checked style="width:auto"> USB audio enabled by default</label></div></div><div class="extension-actions"><button class="primary" id="forge-save-settings">Save & apply defaults</button><button class="secondary" id="forge-read-settings">Reload defaults</button></div><p class="extension-status" id="forge-settings-status" role="status"></p></details>`;}

function createExtensionUI({el,call,host,embedded,signal,prepareProject,applyConfig,applySettings,getState,scroll,contextIcon}){
  let disposed=false,selectedProject=null,editor=null,lastRoute='',lastContext='',settingsSeen=false,lastSettings='',lastFile='',pendingFileKey='',pendingFilePromise=null;
  const status=(id,text)=>{if(!disposed)el(id).textContent=text;};
  const action=(id,work)=>{void(async()=>{try{await work();}catch(error){status(id,error.message||'Request failed.');}})();};
  const validConfig=text=>{if(typeof text!=='string'||text.length>131072)throw new Error('Configuration exceeds the editor limit.');return window.FM1Forge.normalizeProjectConfig(JSON.parse(text));};
  function selected(config){return {version:1,config,...(selectedProject?{projectId:selectedProject.id,resourceUri:selectedProject.resource_uri}:{})};}
  function projectList(projects){
    el('forge-projects').innerHTML='';
    for(const project of Array.isArray(projects)?projects:[]){
      if(!/^[a-f0-9]{32}$/.test(project?.id||'')||typeof project.title!=='string')continue;
      const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=project.title+' · '+project.slug;button.onclick=()=>action('forge-draft-status',()=>loadProject(project.id));el('forge-projects').appendChild(button);
    }
  }
  function settings(values,{apply=false}={}){
    if(!values||typeof values!=='object')return;
    const signature=JSON.stringify(values);if(signature===lastSettings&&!apply)return;lastSettings=signature;
    for(const [key,id] of Object.entries({palette:'palette',pattern:'pattern',entry_method:'entry',default_module:'module'}))if(typeof values[key]==='string')el('forge-settings-'+id).value=values[key];
    if(typeof values.default_usb_audio==='boolean')el('forge-settings-uac').checked=values.default_usb_audio;
    if(apply)applySettings(values,{explicit:true});else if(!settingsSeen){settingsSeen=true;applySettings(values,{explicit:false});}
    status('forge-settings-status','Owner defaults loaded.');
  }
  function snapshot(data){if(disposed)return;if(data?.forge?.projects)projectList(data.forge.projects);if(data?.forge?.settings)settings(data.forge.settings);}
  async function loadProject(id){
    const result=await call('get_fm1_project',{project_id:id},signal);if(disposed)return;
    const config=window.FM1Forge.normalizeProjectConfig(result.project?.config);selectedProject={...result.project,config};applyConfig(config);el('forge-designer').open=true;status('forge-draft-status','Loaded '+result.project.title+'. Configuration draft; use Ask Codex to request a build. Device installation remains separate.');
  }
  async function listProjects(){const data=await call('list_fm1_projects',{},signal);if(!disposed){projectList(data.projects);status('forge-draft-status','Saved configuration drafts refreshed.');}}
  async function saveDraft(){const prepared=prepareProject(),args={config:window.FM1Forge.normalizeProjectConfig(prepared.config),clock_opt_in:el('forge-clock-opt-in').checked===true};if(selectedProject)args.project_id=selectedProject.id;const result=await call('save_fm1_project',args,signal);if(disposed)return;selectedProject=result.project;status('forge-draft-status','Configuration draft saved. No build or transfer started.');await listProjects();}
  function formResult(result){if(disposed||!['accept','cancel','decline','unsupported'].includes(result?.action))return false;
    if(result.action==='accept'){const config=window.FM1Forge.normalizeProjectConfig(result.config);window.FM1Forge.projectPrompt(config,result.goal??'');applyConfig(config,{...(typeof result.goal==='string'?{goal:result.goal}:{}),clockOptIn:result.clock_opt_in===true});selectedProject=result.project;el('forge-designer').open=true;status('forge-draft-status','Native form configuration saved. No firmware build or transfer started.');}
    else{el('forge-designer').open=true;status('forge-draft-status',result.message||'Use the configuration fields in this panel.');}return true;
  }
  function resourceChanged(data){
    if(disposed||!data)return;el('forge-resource-panel').hidden=false;el('forge-resource-title').textContent=data.name;el('forge-resource-uri').textContent=data.uri;
    if(el('forge-resource-text').value!==data.text)el('forge-resource-text').value=data.text;
    let configValid=false;try{validConfig(data.text);configValid=true;}catch{}
    el('forge-resource-save').disabled=data.loading||data.saving||!data.writable||!data.etag||!configValid||!data.dirty;
    el('forge-resource-load').disabled=data.loading||!configValid;
    el('forge-resource-text').readOnly=!data.writable;
    status('forge-resource-status',data.error||(data.loading?'Loading selected resource…':data.stale?'The file changed elsewhere. Your edits are preserved.':data.dirty?'Unsaved edits.':data.writable&&data.etag?'Writable Forge file · concurrent changes checked on save.':'Read-only resource.'));
  }
  async function fileInput(input){
    if(disposed)return;el('forge-extension-panel').open=true;
    const native=host();if(!native||!native.features().resources){status('forge-file-status','This host cannot read selected resources. Open the local file in its native viewer or copy the configuration.');return;}
    const parsed=native.fileInput(input);if(!/\.fm1-forge\.json$/i.test(parsed.file.name))throw new Error('Choose a .fm1-forge.json configuration file.');
    const key=JSON.stringify(parsed.file);if(key===lastFile)return;if(key===pendingFileKey)return pendingFilePromise;
    if(!editor)editor=native.resourceEditor(resourceChanged);
    pendingFileKey=key;pendingFilePromise=editor.open(parsed.file.resourceUri,parsed.file.name);
    try{await pendingFilePromise;if(!disposed&&editor.state?.uri===parsed.file.resourceUri){lastFile=key;status('forge-file-status','Selected file opened through the host resource API.');}}
    finally{if(pendingFileKey===key){pendingFileKey='';pendingFilePromise=null;}}
  }
  function context(){
    if(disposed)return;const native=host(),features=native?.features()||{};
    for(const id of ['forge-context-attach','forge-context-clear'])el(id).disabled=!features.modelContext;
    el('forge-open-local').disabled=!features.files;
    el('forge-fullscreen').disabled=!features.displayModes?.includes('fullscreen');el('forge-inline').disabled=!features.displayModes?.includes('inline');
    const mode=el('forge-message-mode');for(const option of Array.from(mode.options||[]))option.disabled=option.value!=='active-send'&&!features.message;
    if(mode.value!=='active-send'&&!features.message)mode.value='active-send';
    status('forge-context-status',!embedded?'Native host features are available in the Codex plugin panel.':features.modelContext?'Configuration context is available. Attach it explicitly when ready.':'This host does not advertise model context. Copy the project brief to provide it.');
    if(!native)return;
    const state=native.state(),model=state.modelContext;
    if(model===null){lastContext='';status('forge-context-status','The host cleared attached context. Your configuration draft is retained.');}
    else if(model!==undefined&&model.updateId!==lastContext){
      lastContext=model.updateId;const payload=model.structuredContent?.fm1Forge;
      try{if(!payload||payload.version!==1)throw new Error('The current context is not an FM-1 Forge configuration.');const config=window.FM1Forge.normalizeProjectConfig(payload.config);if(payload.projectId!==undefined&&!/^[a-f0-9]{32}$/.test(payload.projectId))throw new Error('Invalid project context.');if(payload.resourceUri!==undefined&&payload.resourceUri!=='fm1-forge://projects/'+payload.projectId)throw new Error('Invalid project resource context.');applyConfig(config);selectedProject=payload.projectId?{id:payload.projectId,resource_uri:payload.resourceUri}:null;status('forge-context-status','Restored the configuration from host model context.');}catch(error){status('forge-context-status',error.message+' Your current draft was retained.');}
    }
    const route=state.route,key=JSON.stringify(route);
    if(route===null){status('forge-context-status','The host provided an unsupported deep link. No action was taken.');return;}
    if(!route||key===lastRoute)return;lastRoute=key;
    if(route.section==='project')action('forge-draft-status',()=>loadProject(route.id));
    else if(route.section==='job'){el('job-id').value=route.id;scroll('detail');status('forge-context-status','Saved job selected. Use Inspect job to read its current progress.');}
    else if(route.section==='catalog'){scroll('library');status('forge-context-status',route.id?'Catalog package selected: '+route.id+'. Choose View plan or Review switch.':'Catalog opened.');}
    else{const ids={projects:'forge-project-library',settings:'forge-settings',appearance:'appearance-controls',designer:'forge-designer'},id=ids[route.section];if(id){el(id).open=true;scroll(id);}}
  }
  el('forge-save-draft').onclick=()=>action('forge-draft-status',saveDraft);
  el('forge-new-draft').onclick=()=>{selectedProject=null;el('forge-designer').open=true;status('forge-draft-status','A new configuration draft will receive a new ID when saved.');};
  el('forge-list-projects').onclick=()=>action('forge-draft-status',listProjects);
  el('forge-native-form').onclick=()=>action('forge-draft-status',async()=>{const result=await call('configure_fm1_project',{},signal);if(!formResult(result))return;if(result.action==='accept'){await listProjects();status('forge-draft-status','Native form configuration saved. No firmware build or transfer started.');}});
  el('forge-save-settings').onclick=()=>action('forge-settings-status',async()=>{const set={palette:el('forge-settings-palette').value,pattern:el('forge-settings-pattern').value,entry_method:el('forge-settings-entry').value,default_module:el('forge-settings-module').value,default_usb_audio:el('forge-settings-uac').checked===true};const result=await call('settings.update',{set},signal);if(!disposed){settings(result.values,{apply:true});status('forge-settings-status','Owner defaults saved and applied to this panel.');}});
  el('forge-read-settings').onclick=()=>action('forge-settings-status',async()=>{const result=await call('settings.read',{},signal);if(!disposed)settings(result.values);});
  el('forge-context-attach').onclick=()=>action('forge-context-status',async()=>{const config=window.FM1Forge.normalizeProjectConfig(prepareProject().config),thumbnail=typeof contextIcon==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(contextIcon)?{src:contextIcon,mimeType:'image/png',sizes:['128x128']}:undefined,result=await host().modelContext({content:[{type:'text',text:'Selected FM-1 Forge configuration: '+config.project.displayName+'. This context is a configuration draft; no build or flash is requested.',_meta:{'openai/title':config.project.displayName,...(thumbnail?{'openai/thumbnail':thumbnail}:{})}}],structuredContent:{fm1Forge:selected(config)}},signal);if(!disposed){if(result?.updateId)lastContext=result.updateId;status('forge-context-status',result?.updateId?'Configuration attached · update '+result.updateId:'Configuration attached. The host did not return an update ID.');}});
  el('forge-context-clear').onclick=()=>action('forge-context-status',async()=>{await host().modelContext({content:[],structuredContent:{}},signal);status('forge-context-status','Attached configuration cleared. Your draft is retained.');});
  el('forge-open-local').onclick=()=>action('forge-file-status',async()=>{await host().openFile(el('forge-local-path').value);status('forge-file-status','The local file was opened by the native host.');});
  for(const [id,mode] of [['forge-fullscreen','fullscreen'],['forge-inline','inline']])el(id).onclick=()=>action('forge-context-status',async()=>{const result=await host().displayMode(mode);status('forge-context-status','Host display mode: '+(result.mode||mode));});
  el('forge-resource-text').oninput=()=>{if(editor)editor.edit(el('forge-resource-text').value);};
  el('forge-resource-save').onclick=()=>action('forge-resource-status',async()=>{if(!editor)throw new Error('Select a host file first.');const result=await editor.save(validConfig);if(result.outcome==='saved')status('forge-resource-status','File saved.');});
  el('forge-resource-load').onclick=()=>action('forge-resource-status',async()=>{if(!editor)throw new Error('Select a host file first.');applyConfig(validConfig(editor.state.text));selectedProject=null;el('forge-designer').open=true;status('forge-resource-status','Configuration loaded into the designer. No build or transfer started.');});
  el('forge-resource-reload').onclick=()=>action('forge-resource-status',async()=>{await editor?.reload();});
  context();
  return {snapshot,context,fileInput,formResult,close(){if(disposed)return;disposed=true;editor?.close();},get selectedProject(){return selectedProject;}};
}
export const extensionRuntime='window.FM1ExtensionUI=('+createExtensionUI.toString()+');';
