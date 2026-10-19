import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { OpenAIExtensions, OpenAIUiResourceMetadataSchema, OpenAIUiToolMetadataSchema } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createDeviceService } from './lib/device-service.mjs';
import { createProjectStore } from './lib/project-store.mjs';
import { PROFILES } from '../site/lib/fm1-contract.mjs';
import { ICONS } from '../site/lib/fm1-icon.mjs';
import { PRESETS, PATTERNS } from '../site/lib/fm1-appearance.mjs';
import { normalizeProjectConfig } from '../site/lib/fm1-forge-project.mjs';

export const RESOURCE_URI='ui://fm1/forge-windows-v1.html';
export const VERSION='3.4.0-alpha.3';
const supportedTransports=['stock-midi','firmware-midi'];
const gate={diagnostics_verified:false,can_start_project:false,message:'Configure and build a project with Codex. Device installation remains unavailable in this Windows connection preview.'};
const result=data=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});
const empty=z.object({}).strict();
const projectId=z.string().regex(/^[a-f0-9]{32}$/);
const settingShape={palette:z.enum(PRESETS.map(p=>p.id)),pattern:z.enum(PATTERNS.map(p=>p.id)),entry_method:z.enum(['auto','serial','already_uboot']),default_module:z.enum(['diagnostics','user']),default_usb_audio:z.boolean()};
const inputConfig=z.unknown();

export async function createDesktopServer({deviceService=createDeviceService(),uiHtml,dataDirectory,store}={}){
  if(typeof uiHtml!=='string'||!uiHtml.includes('const desktopMode=true;'))throw new Error('The packaged Windows panel resource is missing.');
  store??=await createProjectStore({directory:dataDirectory});
  const server=new McpServer({name:'FM-1 Forge Windows',version:VERSION,icons:ICONS},{jsonSchemaValidator:new CfWorkerJsonSchemaValidator(),instructions:'This Windows desktop plugin contains its own runtime and native MIDI component. Open the Forge panel, then explicitly connect stock MIDI for stock V15 or firmware MIDI for the common custom identity. No browser MIDI permission or separately started helper is required. Device tools only send bounded identity/capability queries; they do not install firmware, enter a loader, reset, send arbitrary MIDI or operate UBOOT. Keep firmware installation disabled. Serial, native firmware transfers and compiler setup are not included in this connection preview. Keep project configuration and user files local, preserve existing cloud data, and report identity checks separately from physical hardware acceptance.'});
  const extensions=new OpenAIExtensions(server);
  const register=(name,description,inputSchema,handler,{readOnly=true,ui=false}={})=>server.registerTool(name,{title:name==='open_fm1_library'?'FM-1 Forge Windows':description.split('.')[0],description,inputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:false},icons:ICONS,...(ui?{_meta:{ui:{resourceUri:RESOURCE_URI},'openai/ui':OpenAIUiToolMetadataSchema.parse({...(name==='open_fm1_project'?{entrypoints:[{type:'file',extensions:['.fm1-forge.json']}]}:{}),preferredModelDisplayMode:'fullscreen'})}}:{})},async args=>{
    try{return result(await handler(args));}
    catch(error){const message=typeof error?.code==='string'?error.message:'The local Forge request could not be completed.';return {isError:true,content:[{type:'text',text:message}],structuredContent:{error:message,...(typeof error?.code==='string'?{code:error.code}:{})}};}
  });
  const snapshot=async()=>({desktop:{platform:'win32',protocolVersion:1,supportedTransports,installationAvailable:false},profiles:PROFILES,relay:{connected:false,allow_switch:false},catalog:{apps:[],sets:[]},forge:{settings:await store.readSettings(),projects:await store.listProjects(),gate},recent_requests:[]});
  register('open_fm1_library','Open the Windows Forge panel. Does not open a device or send MIDI.',empty,snapshot,{ui:true});
  register('get_fm1_device_status','Check a previously connected FM-1 using read-only identity queries. Never connects automatically.',empty,()=>deviceService.getStatus());
  register('connect_fm1_device','Connect exactly one FM-1 MIDI pair and confirm its identity. Sends only fixed read-only identity/capability queries.',z.object({transport:z.enum(supportedTransports)}).strict(),args=>deviceService.connect(args));
  register('disconnect_fm1_device','Close the plugin MIDI connection. Does not reset or modify firmware.',empty,()=>deviceService.disconnect(),{readOnly:false});
  register('list_fm1_projects','List locally saved configuration drafts.',empty,async()=>({projects:await store.listProjects(),gate}));
  register('get_fm1_project','Read one locally saved Forge configuration draft.',z.object({project_id:projectId}).strict(),async args=>({project:await store.getProject(args.project_id),gate}));
  register('save_fm1_project','Save a validated local configuration draft. Does not build or install firmware.',z.object({config:inputConfig,project_id:projectId.optional(),clock_opt_in:z.boolean().optional()}).strict(),async args=>({project:await store.saveProject(args),gate}),{readOnly:false});
  const settingsLayout=[{kind:'group',title:'Appearance',items:[{kind:'property',property:'palette'},{kind:'property',property:'pattern'}]},{kind:'group',title:'Firmware defaults',items:[{kind:'property',property:'entry_method'},{kind:'property',property:'default_module'},{kind:'property',property:'default_usb_audio'}]}];
  extensions.settings.register({fields:Object.fromEntries(Object.entries(settingShape).map(([key,schema])=>[key,{schema,title:key.replaceAll('_',' ')}])),layout:settingsLayout,read:()=>store.readSettings(),update:set=>store.updateSettings(set)});
  register('configure_fm1_project','Open the firmware configuration controls without building or contacting hardware.',empty,async()=>({action:'unsupported',created:false,settings:await store.readSettings(),gate,message:'Use the graphical firmware configuration controls in this Windows panel.'}),{ui:true});
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
  server.registerResource('FM-1 Forge Windows',RESOURCE_URI,{mimeType:'text/html;profile=mcp-app'},async()=>({contents:[{uri:RESOURCE_URI,mimeType:'text/html;profile=mcp-app',text:uiHtml,_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}},'openai/ui':OpenAIUiResourceMetadataSchema.parse({availableDisplayModes:['inline','fullscreen'],preferredDisplayMode:'fullscreen'})}}]}));
  const close=server.close.bind(server);let stopped=false;
  server.close=async()=>{if(stopped)return;stopped=true;try{await deviceService.close();}finally{await close();}};
  return server;
}

export async function startStdio(){
  if(process.platform!=='win32'||process.arch!=='x64')throw new Error('This package requires Windows x64.');
  const dataDirectory=process.env.PLUGIN_DATA??path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData','Local'),'FM1Forge','Windows');
  const uiHtml=await readFile(new URL('./panel.html',import.meta.url),'utf8');
  const handle=serveStdio(()=>createDesktopServer({dataDirectory,uiHtml}),{legacy:'serve',onerror:()=>process.stderr.write('FM-1 Forge protocol request could not be completed.\n')});
  const shutdown=()=>{void handle.close().finally(()=>{process.exitCode=0;});};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  return handle;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  startStdio().catch(()=>{process.stderr.write('FM-1 Forge Windows could not start. Verify the installed package and local data access.\n');process.exitCode=1;});
}
