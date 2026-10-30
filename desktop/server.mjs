import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { OpenAIExtensions, OpenAIUiResourceMetadataSchema, OpenAIUiToolMetadataSchema } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDeviceService } from './lib/device-service.mjs';
import { resolveDesktopPlatform, desktopDataDirectory } from './lib/platform.mjs';
import { createProjectStore } from './lib/project-store.mjs';
import { createStockUpdateService, RAW_PACKAGE_BYTES, MAX_CHUNK_BYTES } from './lib/stock-update-service.mjs';
import { createCustomUpdateService } from './lib/custom-update-service.mjs';
import { createCdcUpdateService } from './lib/cdc-update-service.mjs';
import { MAX_CUSTOM_FWSC_BYTES } from '../tools/jieli-wl82/stock-sysex/custom-package.mjs';
import { createTrackerVerifier } from '../tools/jieli-wl82/stock-sysex/tracker-cdc.mjs';
import { createCdcBootVerifier } from '../tools/jieli-wl82/cdc-uboot/transport.mjs';
import { PROFILES } from '../site/lib/fm1-contract.mjs';
import { ICONS } from '../site/lib/fm1-icon.mjs';
import { PRESETS, PATTERNS } from '../site/lib/fm1-appearance.mjs';
import { normalizeProjectConfig } from '../site/lib/fm1-forge-project.mjs';

export const RESOURCE_URI='ui://fm1/forge-windows-v8.html';
export const VERSION='3.4.0-alpha.16';
const projectGate=label=>({diagnostics_verified:false,can_start_project:false,message:'Configure and build a project with Codex, then review the generated custom FWSC and exact target build in the '+label+' panel. A build request does not authorize installation.'});
const result=data=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});
const empty=z.object({}).strict();
const projectId=z.string().regex(/^[a-f0-9]{32}$/);
const settingShape={palette:z.enum(PRESETS.map(p=>p.id)),pattern:z.enum(PATTERNS.map(p=>p.id)),entry_method:z.enum(['auto','serial','already_uboot']),default_module:z.enum(['diagnostics','user']),default_usb_audio:z.boolean()};
const inputConfig=z.unknown();

export async function createDesktopServer({deviceService,stockUpdateService,customUpdateService,cdcUpdateService,uiHtml,dataDirectory,store,platform=process.platform,arch=process.arch}={}){
  const edition=resolveDesktopPlatform({platform,arch}),resourceUri=edition.resourceUri,gate=projectGate(edition.label);
  const supportedTransports=['stock-midi','firmware-midi',...(platform==='win32'?['usb-serial']:[])];
  if(typeof uiHtml!=='string'||!uiHtml.includes('const desktopMode=true;'))throw new Error('The packaged '+edition.label+' panel resource is missing.');
  store??=await createProjectStore({directory:dataDirectory});
  deviceService??=createDeviceService({directory:dataDirectory});
  stockUpdateService??=dataDirectory?await createStockUpdateService({directory:dataDirectory,deviceService}):null;
  customUpdateService??=dataDirectory?await createCustomUpdateService({directory:dataDirectory,deviceService,trackerVerifier:createTrackerVerifier({platform})}):null;
  cdcUpdateService??=dataDirectory&&platform==='win32'?await createCdcUpdateService({directory:dataDirectory,deviceService,trackerVerifier:createCdcBootVerifier({platform})}):null;
  const server=new McpServer({name:edition.name,version:VERSION,icons:ICONS},{jsonSchemaValidator:new CfWorkerJsonSchemaValidator(),instructions:'This '+edition.label+' desktop plugin contains its own runtime and native MIDI component. Open the Forge panel, then explicitly connect stock MIDI for stock V15 or firmware MIDI for the common custom identity. No browser MIDI permission or separately started helper is required. Connection tools only send bounded identity/capability queries. Stock V15 restoration and V15-to-custom FWSC installation are separate destructive operations exposed only to the app: select the exact official package or a validated custom FWSC with its build manifest, review the verified device, hashes and target build, then explicitly confirm Install in the panel. Preserve original unresolved attempts; never automatically retry an uncertain transfer. The common firmware ARM/update capability remains disabled; custom FWSC installation starts from stock V15 and verifies the exact profile identity/build after reboot: diagnostic MIDI or a fresh tracker CDC challenge on Windows. On Windows, connect the installed tracker with USB serial for its fixed identity/build challenge. The separate app-only CDC/UBOOT updater requires explicit Prepare confirmation, Windows elevation, two live baseline reads, then a separate exact application-sector-plan confirmation. Preserve its original job and protected worker after interruption; no automatic retry, transport fallback or reset is permitted. Raw MIDI, general serial/SCSI commands and compiler setup are not exposed. Keep project configuration and user files local, preserve existing cloud data, and report identity checks separately from physical hardware acceptance.'});
  const extensions=new OpenAIExtensions(server);
  const register=(name,description,inputSchema,handler,{readOnly=true,ui=false,appOnly=false,destructive=false}={})=>server.registerTool(name,{title:name==='open_fm1_library'?edition.name:description.split('.')[0],description,inputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:destructive,openWorldHint:false},icons:ICONS,...(ui||appOnly?{_meta:{ui:{resourceUri,...(appOnly?{visibility:['app']}:{})},...(ui?{'openai/ui':OpenAIUiToolMetadataSchema.parse({...(name==='open_fm1_project'?{entrypoints:[{type:'file',extensions:['.fm1-forge.json']}]}:{}),preferredModelDisplayMode:'fullscreen'})}:{})}}:{})},async args=>{
    try{return result(await handler(args));}
    catch(error){const message=typeof error?.code==='string'?error.message:'The local Forge request could not be completed.';return {isError:true,content:[{type:'text',text:message}],structuredContent:{error:message,...(typeof error?.code==='string'?{code:error.code}:{})}};}
  });
  const snapshot=async()=>({desktop:{platform:edition.platform,protocolVersion:2,supportedTransports,installationAvailable:false,stockUpdateAvailable:stockUpdateService!==null,customUpdateAvailable:customUpdateService!==null,cdcUpdateAvailable:cdcUpdateService!==null},profiles:PROFILES,relay:{connected:false,allow_switch:false},catalog:{apps:[],sets:[]},forge:{settings:await store.readSettings(),projects:await store.listProjects(),gate},recent_requests:[]});
  register('open_fm1_library','Open the '+edition.label+' Forge panel. Does not open a device or send MIDI.',empty,snapshot,{ui:true});
  register('get_fm1_device_status','Check a previously connected FM-1 using read-only identity queries. Never connects automatically.',empty,()=>deviceService.getStatus());
  register('connect_fm1_device','Connect exactly one FM-1 MIDI pair or Windows tracker CDC interface and confirm its identity. Sends only fixed read-only identity/capability queries.',z.object({transport:z.enum(supportedTransports)}).strict(),args=>deviceService.connect(args));
  register('disconnect_fm1_device','Close the plugin device connection. Does not reset or modify firmware.',empty,()=>deviceService.disconnect(),{readOnly:false});
  const updateId=z.string().regex(/^[a-f0-9]{32}$/);
  const updateService=()=>{if(!stockUpdateService)throw Object.assign(new Error('The native stock updater is unavailable.'),{code:'stock_update_unavailable'});return stockUpdateService;};
  register('get_fm1_stock_update_status','Read the original stock transfer progress and recovery state. Does not query MIDI or start a transfer.',empty,()=>stockUpdateService?stockUpdateService.status():({supported:false,writing:false,attempt:null,review:null}));
  register('begin_fm1_stock_upload','Stage one exact-size official V15 package for review. Does not contact a device.',z.object({raw_bytes:z.literal(RAW_PACKAGE_BYTES)}).strict(),args=>updateService().beginUpload(args),{readOnly:false,appOnly:true});
  register('append_fm1_stock_upload','Append a bounded sequential package chunk. Does not contact a device.',z.object({upload_id:updateId,offset:z.number().int().min(0).max(RAW_PACKAGE_BYTES),data_base64:z.string().min(4).max(Math.ceil(MAX_CHUNK_BYTES/3)*4).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict(),args=>updateService().appendUpload(args),{readOnly:false,appOnly:true});
  register('review_fm1_stock_update','Validate the exact official package and freshly connected stock device for human review. Does not install firmware.',z.object({upload_id:updateId}).strict(),args=>updateService().review(args),{readOnly:false,appOnly:true});
  register('review_fm1_stock_recovery','Review the identical unresolved stock attempt with a freshly connected OTA loader. Does not resume automatically.',z.object({job_id:updateId}).strict(),args=>updateService().reviewResume(args),{readOnly:false,appOnly:true});
  register('start_fm1_stock_update','Install only the reviewed official V15 package after explicit confirmation in the panel. Destructive: may enter OTA and replace firmware. Never accepts custom images or raw MIDI.',z.object({review_id:updateId,confirmed:z.literal(true)}).strict(),args=>updateService().start(args),{readOnly:false,appOnly:true,destructive:true});
  const customService=()=>{if(!customUpdateService)throw Object.assign(new Error('The native custom FWSC updater is unavailable.'),{code:'custom_update_unavailable'});return customUpdateService;};
  register('get_fm1_custom_update_status','Read the original custom FWSC transfer progress and recovery evidence. Does not query MIDI or start an update.',empty,()=>customUpdateService?customUpdateService.status():({supported:false,writing:false,attempt:null,review:null}));
  register('verify_fm1_custom_boot','Verify the original completed tracker transfer using a fresh fixed CDC identity/build challenge and record its receipt. No firmware write or MIDI command. Accepts only the original job ID.',z.object({job_id:updateId}).strict(),args=>customService().verifyBoot(args),{readOnly:false});
  register('begin_fm1_custom_upload','Stage a bounded custom FWSC and its reviewed build manifest. Does not contact a device.',z.object({raw_bytes:z.number().int().min(1024).max(MAX_CUSTOM_FWSC_BYTES),manifest:z.record(z.string(),z.unknown())}).strict(),args=>customService().beginUpload(args),{readOnly:false,appOnly:true});
  register('append_fm1_custom_upload','Append a bounded sequential custom FWSC chunk. Does not contact a device.',z.object({upload_id:updateId,offset:z.number().int().min(0).max(MAX_CUSTOM_FWSC_BYTES),data_base64:z.string().min(4).max(Math.ceil(MAX_CHUNK_BYTES/3)*4).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict(),args=>customService().appendUpload(args),{readOnly:false,appOnly:true});
  register('review_fm1_custom_update','Validate a custom FWSC, target build and freshly connected stock V15 device for human review. Does not install firmware.',z.object({upload_id:updateId}).strict(),args=>customService().review(args),{readOnly:false,appOnly:true});
  register('review_fm1_custom_recovery','Review the identical unresolved custom FWSC attempt using its original package and pinned OTA loader. Does not resume automatically.',z.object({job_id:updateId}).strict(),args=>customService().reviewResume(args),{readOnly:false,appOnly:true});
  register('review_fm1_custom_loader_entry','Review loader preparation for the identical unresolved custom job from stock V15. Confirmation runs only CHECK and stops in the pinned OTA loader; application-write recovery requires a separate review.',z.object({job_id:updateId}).strict(),args=>customService().reviewLoaderEntry(args),{readOnly:false,appOnly:true});
  register('start_fm1_custom_update','Execute only the explicitly confirmed custom review. Install/resume replaces application firmware; loader-entry runs only original-package CHECK and stops before WRITE. Requires the validated package, target build and original recovery record.',z.object({review_id:updateId,confirmed:z.literal(true)}).strict(),args=>customService().start(args),{readOnly:false,appOnly:true,destructive:true});

  const cdcService=()=>{if(!cdcUpdateService)throw Object.assign(new Error('The Windows tracker CDC updater is unavailable.'),{code:'cdc_update_unavailable'});return cdcUpdateService;};
  register('get_fm1_cdc_update_status','Read the original CDC/UBOOT preparation, sector readback and boot evidence. Does not contact a device or start an update.',empty,()=>cdcUpdateService?cdcUpdateService.status():({supported:false,writing:false,attempt:null,review:null}));
  register('verify_fm1_cdc_boot','Verify the exact original CDC update build after completed readback using a fresh tracker challenge. Does not write firmware.',z.object({job_id:updateId}).strict(),args=>cdcService().verifyBoot(args),{readOnly:false});
  register('begin_fm1_cdc_upload','Stage a tracker FWSC and its matching manifest for CDC/UBOOT review. Does not contact a device.',z.object({raw_bytes:z.number().int().min(1024).max(MAX_CUSTOM_FWSC_BYTES),manifest:z.record(z.string(),z.unknown())}).strict(),args=>cdcService().beginUpload(args),{readOnly:false,appOnly:true});
  register('append_fm1_cdc_upload','Append a bounded sequential tracker package chunk. Does not contact a device.',z.object({upload_id:updateId,offset:z.number().int().min(0).max(MAX_CUSTOM_FWSC_BYTES),data_base64:z.string().min(4).max(Math.ceil(MAX_CHUNK_BYTES/3)*4).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict(),args=>cdcService().appendUpload(args),{readOnly:false,appOnly:true});
  register('review_fm1_cdc_update','Review a validated tracker package and freshly identified CDC source. Does not enter UBOOT or program firmware.',z.object({upload_id:updateId}).strict(),args=>cdcService().review(args),{readOnly:false,appOnly:true});
  register('prepare_fm1_cdc_update','After explicit panel confirmation request Windows elevation, then stop playback, enter UBOOT and read the live flash twice. Does not erase or program the flash array; installation needs a separate sector-plan confirmation.',z.object({review_id:updateId,confirmed:z.literal(true)}).strict(),args=>cdcService().prepare(args),{readOnly:false,appOnly:true,destructive:true});
  register('review_fm1_cdc_install','Review the original live baseline, candidate hashes and exact application-sector plan. Does not program or reset.',z.object({job_id:updateId}).strict(),args=>cdcService().reviewInstall(args),{readOnly:false,appOnly:true});
  register('review_fm1_cdc_recovery','Review recovery of the identical original CDC/UBOOT job in its existing protected worker session. Never substitutes a package or retries automatically.',z.object({job_id:updateId}).strict(),args=>cdcService().reviewRecovery(args),{readOnly:false,appOnly:true});
  register('start_fm1_cdc_update','Install only the explicitly confirmed original application-sector plan, verify full readback, then reset and verify the target build. A zero-change plan returns to the verified application without erasing or programming.',z.object({review_id:updateId,confirmed:z.literal(true)}).strict(),args=>cdcService().start(args),{readOnly:false,appOnly:true,destructive:true});


  register('list_fm1_projects','List locally saved configuration drafts.',empty,async()=>({projects:await store.listProjects(),gate}));
  register('get_fm1_project','Read one locally saved Forge configuration draft.',z.object({project_id:projectId}).strict(),async args=>({project:await store.getProject(args.project_id),gate}));
  register('save_fm1_project','Save a validated local configuration draft. Does not build or install firmware.',z.object({config:inputConfig,project_id:projectId.optional(),clock_opt_in:z.boolean().optional()}).strict(),async args=>({project:await store.saveProject(args),gate}),{readOnly:false});
  const settingsLayout=[{kind:'group',title:'Appearance',items:[{kind:'property',property:'palette'},{kind:'property',property:'pattern'}]},{kind:'group',title:'Firmware defaults',items:[{kind:'property',property:'entry_method'},{kind:'property',property:'default_module'},{kind:'property',property:'default_usb_audio'}]}];
  extensions.settings.register({fields:Object.fromEntries(Object.entries(settingShape).map(([key,schema])=>[key,{schema,title:key.replaceAll('_',' ')}])),layout:settingsLayout,read:()=>store.readSettings(),update:set=>store.updateSettings(set)});
  register('configure_fm1_project','Open the firmware configuration controls without building or contacting hardware.',empty,async()=>({action:'unsupported',created:false,settings:await store.readSettings(),gate,message:'Use the graphical firmware configuration controls in this '+edition.label+' panel.'}),{ui:true});
  register('open_fm1_project','Open an opaque .fm1-forge.json resource in the native configuration viewer.',z.object({file:z.object({name:z.string().min(1).max(128),resourceUri:z.string().min(1).max(2048)}).strict()}).strict(),async({file})=>{
    if(!/^[^\\/\u0000-\u001f\u007f]+\.fm1-forge\.json$/i.test(file.name)||/^[a-z]:/i.test(file.name)||! /^[a-z][a-z0-9+.-]+:[^\s]+$/i.test(file.resourceUri)||/^(?:file|https?|ftp):/i.test(file.resourceUri)||/[\u0000-\u0020\u007f\\]/.test(file.resourceUri)||/%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(file.resourceUri))throw Object.assign(new Error('Choose a native host resource for a .fm1-forge.json file.'),{code:'invalid_file'});
    return {file,mode:'project_file',gate};
  },{ui:true});
  extensions.mentions.setHandler(async({query})=>{
    if(typeof query!=='string'||query.length>128)return {items:[]};
    const needle=query.toLowerCase();return {items:(await store.listProjects()).filter(p=>p.title.toLowerCase().includes(needle)).map(p=>({type:'resource',resourceUri:p.resource_uri,title:p.title,subtitle:'Local Forge draft',icons:ICONS}))};
  });
  server.registerResource('Forge local project',new ResourceTemplate('fm1-forge://projects/{id}',{list:undefined}),{mimeType:'application/json'},async(uri,{id})=>{
    const project=await store.getProject(String(id));return {contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(normalizeProjectConfig(project.config),null,2),_meta:{'openai/resource':{writable:false}}}]};
  });
  server.registerResource(edition.name,resourceUri,{mimeType:'text/html;profile=mcp-app'},async()=>({contents:[{uri:resourceUri,mimeType:'text/html;profile=mcp-app',text:uiHtml,_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}},'openai/ui':OpenAIUiResourceMetadataSchema.parse({availableDisplayModes:['inline','fullscreen'],preferredDisplayMode:'fullscreen'})}}]}));
  const close=server.close.bind(server);let stopped=false;
  server.close=async()=>{if(stopped)return;stopped=true;try{try{try{try{await cdcUpdateService?.close();}finally{await customUpdateService?.close();}}finally{await stockUpdateService?.close();}}finally{await deviceService.close();}}finally{await close();}};
  return server;
}

export async function startStdio(){
  resolveDesktopPlatform(); // Never accept an injected platform for actual startup.
  const dataDirectory=desktopDataDirectory();
  const uiHtml=await readFile(new URL('./panel.html',import.meta.url),'utf8');
  const handle=serveStdio(()=>createDesktopServer({dataDirectory,uiHtml}),{legacy:'serve',onerror:()=>process.stderr.write('FM-1 Forge protocol request could not be completed.\n')});
  const shutdown=()=>{void handle.close().finally(()=>{process.exitCode=0;});};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  return handle;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  startStdio().catch(()=>{process.stderr.write('FM-1 Forge could not start. Verify the installed package and local data access.\n');process.exitCode=1;});
}
