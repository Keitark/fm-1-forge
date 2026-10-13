import { OpenAIExtensions, requestFormInput, OpenAIUiToolMetadataSchema } from '@openai/mcp-extensions/server';
import { ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ID, CATALOG_ID, PublicError, RESOURCE_URI, sanitize } from './fm1-contract.mjs';
import { PRESETS, PATTERNS } from './fm1-appearance.mjs';
import { projectConfig, normalizeProjectConfig } from './fm1-forge-project.mjs';
import { ICONS } from './fm1-icon.mjs';

const clock=z.enum(['sdk-default','sdk-320']);
const lcd=z.enum(['stock-dma','spi15-rgb444','spi30-rgb444']);
const moduleName=z.enum(['diagnostics','user']);
const savedId=z.string().regex(ID);
const defaults=Object.freeze({palette:'forge-black',pattern:'solid',entry_method:'auto',default_module:'diagnostics',default_usb_audio:true});
const settingShape={palette:z.enum(PRESETS.map(item=>item.id)),pattern:z.enum(PATTERNS.map(item=>item.id)),entry_method:z.enum(['auto','serial','already_uboot']),default_module:moduleName,default_usb_audio:z.boolean()};
const valuesSchema=z.strictObject(settingShape);
const settingsLayout=[{kind:'group',title:'Appearance',items:[{kind:'property',property:'palette'},{kind:'property',property:'pattern'}]},{kind:'group',title:'Firmware defaults',items:[{kind:'property',property:'entry_method'},{kind:'property',property:'default_module'},{kind:'property',property:'default_usb_audio'},{kind:'tool',tool:'configure_fm1_project',description:'Open a firmware configuration form'}]}];
const settingTitles={palette:'FM1 color palette',pattern:'Background pattern',entry_method:'Preferred transfer entry',default_module:'Default user module',default_usb_audio:'Enable USB audio in new drafts'};
const settingInput=z.strictObject({set:z.strictObject(settingShape).partial().refine(value=>Object.keys(value).length>0)});
const canonicalShape={project:z.strictObject({slug:z.string().max(48),displayName:z.string().max(64)}),profile:z.literal('forge-diag'),clockPreset:clock,lcdPreset:lcd,module:moduleName,usb:z.strictObject({cdc:z.literal(true),uac:z.boolean(),uboot:z.literal(true)})};
const halShape={buttons:z.boolean(),encoders:z.boolean(),volume:z.boolean(),lcd:z.boolean(),audio:z.boolean()};
const canonical=z.union([z.strictObject({schemaVersion:z.literal(1),...canonicalShape}),z.strictObject({schemaVersion:z.literal(2),...canonicalShape,hal:z.strictObject(halShape)}),z.strictObject({schemaVersion:z.literal(3),...canonicalShape,usb:z.strictObject({cdc:z.literal(true),uac:z.boolean(),uvc:z.boolean(),uboot:z.literal(true)}),hal:z.strictObject(halShape)})]);
const configInput=z.strictObject({config:canonical,project_id:savedId.optional(),clock_opt_in:z.boolean().optional()});
const fileInput=z.strictObject({file:z.strictObject({name:z.string().min(1).max(128),resourceUri:z.string().min(1).max(2048)})});
const inputSchemas={
  'settings.read':z.strictObject({}),'settings.update':settingInput,
  list_fm1_projects:z.strictObject({}),save_fm1_project:configInput,get_fm1_project:z.strictObject({project_id:savedId}),
  open_fm1_project:fileInput,configure_fm1_project:z.strictObject({}),
};
export const EXTENSION_TOOLS=Object.freeze(Object.keys(inputSchemas));
const stamp=()=>Math.floor(Date.now()/1000);
const ident=()=>crypto.randomUUID().replaceAll('-','');
const result=data=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});
function database(env){if(!env.DB)throw new PublicError('Forge storage is temporarily unavailable.',503);return env.DB;}
function parse(schema,input){const answer=schema.safeParse(input);if(!answer.success)throw new PublicError('Unexpected or invalid Forge arguments.');return answer.data;}
function serializeProject(row){return {id:row.id,title:row.title,slug:row.slug,config:normalizeProjectConfig(JSON.parse(row.config)),resource_uri:'fm1-forge://projects/'+row.id,created:row.created,updated:row.updated,state:'configuration_draft'};}
export async function forgeGate(env,owner){
  const baseline=await database(env).prepare('SELECT job_id,sha256,verified_at FROM forge_baselines WHERE user_id=?').bind(owner).first();
  const verified=!!(baseline&&ID.test(baseline.job_id)&&/^[a-f0-9]{64}$/.test(baseline.sha256)&&baseline.verified_at>0);
  return {diagnostics_verified:verified,can_start_project:verified,message:verified?'Verified diagnostics permit starting a project. Every build and transfer still needs its own validation.':'Save a configuration draft now. Install and verify diagnostics before starting a firmware project.'};
}
export async function readForgeSettings(env,owner){
  const rows=(await database(env).prepare('SELECT setting_key,value FROM forge_settings WHERE user_id=?').bind(owner).all()).results;
  const saved=Object.fromEntries(rows.map(row=>[row.setting_key,JSON.parse(row.value)]));
  return parse(valuesSchema,{...defaults,...saved});
}
export async function updateForgeSettings(env,owner,set){
  const input=parse(settingInput,{set}).set;
  // A row per field makes omitted fields survive concurrent partial updates.
  // D1 batch commits the supplied fields together or returns an error.
  await database(env).batch(Object.entries(input).map(([key,value])=>database(env).prepare('INSERT INTO forge_settings(user_id,setting_key,value,updated) VALUES(?,?,?,?) ON CONFLICT(user_id,setting_key) DO UPDATE SET value=excluded.value,updated=excluded.updated').bind(owner,key,JSON.stringify(value),stamp())));
  return readForgeSettings(env,owner);
}
export async function listForgeProjects(env,owner){
  return (await database(env).prepare('SELECT * FROM forge_projects WHERE user_id=? ORDER BY updated DESC,id LIMIT 24').bind(owner).all()).results.map(serializeProject);
}
export async function forgeSnapshot(env,owner){return {settings:await readForgeSettings(env,owner),projects:await listForgeProjects(env,owner),gate:await forgeGate(env,owner)};}
function validatedConfig(config,optIn=false){
  const value=parse(canonical,config);
  try{
    const normalized=normalizeProjectConfig(value);
    const clean=projectConfig({slug:normalized.project.slug,displayName:normalized.project.displayName,clockPreset:normalized.clockPreset,clockOptIn:optIn,lcdPreset:normalized.lcdPreset,module:normalized.module,usbAudio:normalized.usb.uac,usbVideo:normalized.usb.uvc,hal:normalized.hal});
    return clean;
  }catch(error){throw new PublicError(error.message);}
}
export async function saveForgeProject(env,owner,input){
  const args=parse(configInput,input),config=validatedConfig(args.config,args.clock_opt_in===true),savedAt=stamp(),id=args.project_id||ident();
  if(args.project_id){
    const existing=await database(env).prepare('SELECT id FROM forge_projects WHERE id=? AND user_id=?').bind(id,owner).first();
    if(!existing)throw new PublicError('Saved project was not found.',404);
    await database(env).prepare('UPDATE forge_projects SET title=?,slug=?,config=?,updated=? WHERE id=? AND user_id=?').bind(config.project.displayName,config.project.slug,JSON.stringify(config),savedAt,id,owner).run();
  }else{
    const inserted=await database(env).prepare('INSERT INTO forge_projects(id,user_id,title,slug,config,created,updated) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM forge_projects WHERE user_id=?)<100').bind(id,owner,config.project.displayName,config.project.slug,JSON.stringify(config),savedAt,savedAt,owner).run();
    if(!inserted.meta?.changes)throw new PublicError('The saved draft limit has been reached.',409);
  }
  return {project:await getForgeProject(env,owner,id),gate:await forgeGate(env,owner),message:'Configuration draft saved. No local directory, firmware build or device write was created.'};
}
export async function getForgeProject(env,owner,id){
  parse(savedId,id);
  const row=await database(env).prepare('SELECT * FROM forge_projects WHERE id=? AND user_id=?').bind(id,owner).first();
  if(!row)throw new PublicError('Saved project was not found.',404);
  return serializeProject(row);
}
function validateFile(file){
  const {name,resourceUri}=file;
  if(!/^[^\\/\u0000-\u001f\u007f]+\.fm1-forge\.json$/i.test(name)||/^[a-z]:/i.test(name))throw new PublicError('Open a .fm1-forge.json configuration file by its filename.');
  // Host references are opaque; a drive, UNC or file URI must never become a
  // local filesystem authority at the hosted server.
  if(!/^[a-z][a-z0-9+.-]+:[^\s]+$/i.test(resourceUri)||/^(?:file|https?|ftp):/i.test(resourceUri)||/[\u0000-\u0020\u007f\\]/.test(resourceUri)||/%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(resourceUri))throw new PublicError('Use an opaque host resource URI, not a filesystem path or URL.');
  return {name,resourceUri};
}
export const PROJECT_FORM_KEY='fm1-project-configuration';
const formInput=z.strictObject({slug:z.string().max(48),displayName:z.string().max(64),lcdPreset:lcd,module:moduleName,usbAudio:z.boolean(),usbVideo:z.boolean().default(false),halButtons:z.boolean().default(true),halEncoders:z.boolean().default(true),halVolume:z.boolean().default(true),halLcd:z.boolean().default(true),halAudio:z.boolean().default(true),goal:z.string().max(2000).optional(),referenceProject:z.array(z.string().max(128)).max(1).optional()});
const thumbnail=(text)=>({src:'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" rx="8" fill="black"/><text x="80" y="50" fill="#a3efcc" text-anchor="middle" font-family="sans-serif" font-size="14">'+text+'</text></svg>'),mimeType:'image/svg+xml'});
export const PROJECT_FORM=Object.freeze({type:'object',required:['slug','displayName','lcdPreset','module','usbAudio'],properties:{
  slug:{type:'string',title:'Project folder name',minLength:1,maxLength:48,pattern:'^[a-z][a-z0-9-]{0,47}$','x-openai-suggestions':[{const:'first-synth',title:'First synthesizer'},{const:'pad-instrument',title:'Pad instrument'}]},
  displayName:{type:'string',title:'Project display name',minLength:1,maxLength:64,'x-openai-suggestions':[{const:'First Synth',title:'First Synth'},{const:'Pad Instrument',title:'Pad Instrument'}]},
  lcdPreset:{type:'string',title:'LCD transfer',oneOf:[{const:'stock-dma',title:'Stock DMA',description:'Conservative baseline transfer','x-openai-thumbnail':thumbnail('Stock DMA')},{const:'spi15-rgb444',title:'SPI 15 RGB444',description:'Requires 60 MHz LSB bus and bench validation','x-openai-thumbnail':thumbnail('SPI 15 RGB444')},{const:'spi30-rgb444',title:'SPI 30 RGB444',description:'Requires 60 MHz LSB bus and bench validation','x-openai-thumbnail':thumbnail('SPI 30 RGB444')}]},
  module:{type:'string',title:'User module',oneOf:[{const:'diagnostics',title:'Hardware diagnostics',description:'Inputs, LCD and key tones','x-openai-thumbnail':thumbnail('Diagnostics')},{const:'user',title:'Blank user module',description:'Silent starter for your own firmware','x-openai-thumbnail':thumbnail('User module')}]},usbAudio:{type:'boolean',title:'Enable USB audio'},
  usbVideo:{type:'boolean',title:'USB video (UVC) screen mirror',description:'256×240 YUY2 screen output at 5 fps. Experimental Forge integration; capture on this starter is not yet hardware-verified.',default:false},
  halButtons:{type:'boolean',title:'User module: buttons and pads HAL',default:true},
  halEncoders:{type:'boolean',title:'User module: encoders HAL',default:true},
  halVolume:{type:'boolean',title:'User module: volume HAL',description:'User access to the volume snapshot; physical master gain remains protected.',default:true},
  halLcd:{type:'boolean',title:'User module: LCD HAL',default:true},
  halAudio:{type:'boolean',title:'User module: audio HAL',description:'User audio callback access; fixed USB audio and master gain remain available.',default:true},
  goal:{type:'string',title:'Firmware goal (optional)',maxLength:2000,'x-openai-suggestions':[{const:'Create a simple polyphonic synthesizer controlled by the keys and knobs.',title:'Key synthesizer'},{const:'Create a pad instrument and show its current parameters on the LCD.',title:'Pad instrument'}]},
}});
export async function configureForgeProject(env,owner,context,extensions,server){
  const envelope=context?.mcpReq?.envelope||{},revision=envelope['io.modelcontextprotocol/protocolVersion']||server?.server?.getNegotiatedProtocolVersion();
  const capabilities=envelope['io.modelcontextprotocol/clientCapabilities']||server?.server?.getClientCapabilities()||{};
  const supportsExtension=!!capabilities.extensions?.['openai/elicitation']?.form;
  if(!context||!supportsExtension||(revision>='2026-07-28'&&!capabilities.elicitation?.form))return {action:'unsupported',created:false,settings:await readForgeSettings(env,owner),gate:await forgeGate(env,owner),message:'This host does not support native Forge forms. Use the panel configuration controls and save a draft.'};
  let answer;
  try{
    const projects=await listForgeProjects(env,owner),requestedSchema=structuredClone(PROJECT_FORM);
    if(projects.length)requestedSchema.properties.referenceProject={type:'array',title:'Saved configuration reference (optional)',minItems:0,maxItems:1,items:{type:'string',format:'uri'},'x-openai-input':{type:'resource',selection:'explicit',options:projects.map(project=>({uri:project.resource_uri,name:project.title,mimeType:'application/json'}))}};
    const params={mode:'form',message:'Configure an FM1 firmware draft. A saved reference is context; the fields you enter are saved. This does not build or flash firmware.',requestedSchema};
    answer=revision>='2026-07-28'?requestFormInput(context,{...params,key:PROJECT_FORM_KEY}):await extensions.elicitInputLegacy(context,params);
  }catch{throw new PublicError('The native form response is invalid or unavailable. No project was saved.');}
  if(answer.resultType==='input_required')return answer;
  if(answer.action!=='accept')return {action:answer.action,created:false,message:'Project configuration canceled. No project was saved.'};
  const fields=parse(formInput,answer.content);
  const {goal,referenceProject,halButtons,halEncoders,halVolume,halLcd,halAudio,...configuration}=fields;
  configuration.clockPreset='sdk-default';configuration.clockOptIn=false;
  configuration.hal={buttons:halButtons,encoders:halEncoders,volume:halVolume,lcd:halLcd,audio:halAudio};
  if(goal!==undefined&&/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(goal))throw new PublicError('Enter a printable firmware goal.');
  let reference;
  if(referenceProject?.length){const match=/^fm1-forge:\/\/projects\/([a-f0-9]{32})$/.exec(referenceProject[0]);if(!match)throw new PublicError('Choose one saved project reference.');reference=await getForgeProject(env,owner,match[1]);}
  let config;try{config=projectConfig(configuration);}catch(error){throw new PublicError(error.message);}
  return {action:'accept',config,clock_opt_in:false,...(goal!==undefined?{goal}:{}),...(reference?{reference_project_id:reference.id}:{}),...await saveForgeProject(env,owner,{config,clock_opt_in:false})};
}
export async function callExtensionTool(env,owner,name,input={},context,extensions,server){
  const args=parse(inputSchemas[name],input);
  if(name==='settings.read')return {schema:z.toJSONSchema(z.strictObject(Object.fromEntries(Object.entries(settingShape).map(([key,schema])=>[key,schema.meta({title:settingTitles[key]})])))),layout:settingsLayout,values:await readForgeSettings(env,owner)};
  if(name==='settings.update')return {values:await updateForgeSettings(env,owner,args.set)};
  if(name==='list_fm1_projects')return {projects:await listForgeProjects(env,owner),gate:await forgeGate(env,owner)};
  if(name==='save_fm1_project')return saveForgeProject(env,owner,args);
  if(name==='get_fm1_project')return {project:await getForgeProject(env,owner,args.project_id),gate:await forgeGate(env,owner)};
  if(name==='open_fm1_project')return {file:validateFile(args.file),mode:'project_file',gate:await forgeGate(env,owner),message:'Read this opaque resource through the host. Opening it does not create a project or contact the FM1.'};
  return configureForgeProject(env,owner,context,extensions,server);
}
async function latestCatalog(env,owner){const row=await database(env).prepare("SELECT result FROM relay_tasks WHERE user_id=? AND operation='catalog' AND state='succeeded' ORDER BY created DESC,rowid DESC LIMIT 1").bind(owner).first();return row?.result?JSON.parse(row.result).data:null;}
const catalogVariants=catalog=>(Array.isArray(catalog?.apps)?catalog.apps:[]).slice(0,100).flatMap(app=>(Array.isArray(app?.variants)?app.variants:[]).slice(0,100));
const mentionTitle=(value,fallback)=>typeof value==='string'&&value.trim()?String(sanitize(value)).slice(0,128):fallback;
export async function searchForgeMentions(env,owner,query){
  if(typeof query!=='string'||query.length>128||/[\u0000-\u001f\u007f]/.test(query))throw new PublicError('Search with up to 128 printable characters.');
  const projects=await listForgeProjects(env,owner),catalog=await latestCatalog(env,owner);
  const jobs=(await database(env).prepare('SELECT id,operation,state FROM relay_tasks WHERE user_id=? ORDER BY created DESC,rowid DESC LIMIT 24').bind(owner).all()).results;
  const items=[...projects.map(item=>({type:'resource',resourceUri:item.resource_uri,title:item.title,subtitle:'Forge configuration draft',icons:ICONS})),
    ...catalogVariants(catalog).filter(item=>CATALOG_ID.test(item?.id||'')).map(item=>({type:'resource',resourceUri:'fm1-forge://catalog/'+item.id,title:mentionTitle(item.title,item.id),subtitle:'FM1 package metadata',icons:ICONS})),
    ...jobs.map(item=>({type:'resource',resourceUri:'fm1-forge://jobs/'+item.id,title:item.operation+' · '+item.id.slice(0,8),subtitle:'Saved '+item.state+' request',icons:ICONS}))];
  const needle=query.toLowerCase().trim();
  return {items:items.filter(item=>(item.title+' '+item.subtitle+' '+item.resourceUri).toLowerCase().includes(needle)).slice(0,24)};
}
export async function readForgeResource(env,owner,uri){
  let value;
  const project=/^fm1-forge:\/\/projects\/([a-f0-9]{32})$/.exec(uri),job=/^fm1-forge:\/\/jobs\/([a-f0-9]{32})$/.exec(uri),catalog=/^fm1-forge:\/\/catalog\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(uri);
  if(project){const item=await getForgeProject(env,owner,project[1]);value=item.config;}
  else if(job){const row=await database(env).prepare('SELECT id,operation,state,created,result FROM relay_tasks WHERE id=? AND user_id=?').bind(job[1],owner).first();if(!row)throw new PublicError('Saved request was not found.',404);value=sanitize({id:row.id,operation:row.operation,state:row.state,created:row.created,...(row.result?JSON.parse(row.result):{})});}
  else if(catalog){const saved=await latestCatalog(env,owner),item=catalogVariants(saved).find(item=>item?.id===catalog[1]);if(!item)throw new PublicError('Saved package was not found.',404);value=sanitize(item);}
  else throw new PublicError('Unknown Forge resource.',404);
  return {contents:[{uri,mimeType:'application/json',text:JSON.stringify(value,null,2),_meta:{'openai/resource':{writable:false}}}]};
}
export function registerForgeExtensions(server,env,owner){
  const extensions=new OpenAIExtensions(server);
  extensions.settings.register({fields:{
    palette:{schema:settingShape.palette,title:'FM1 color palette'},pattern:{schema:settingShape.pattern,title:'Background pattern'},
    entry_method:{schema:settingShape.entry_method,title:'Preferred transfer entry'},default_module:{schema:settingShape.default_module,title:'Default user module'},
    default_usb_audio:{schema:settingShape.default_usb_audio,title:'Enable USB audio in new drafts'},
  },layout:settingsLayout,read:()=>readForgeSettings(env,owner()),update:set=>updateForgeSettings(env,owner(),set)});
  extensions.mentions.setHandler(params=>searchForgeMentions(env,owner(),params.query));
  const descriptions={list_fm1_projects:'List saved configuration drafts for the signed-in owner.',save_fm1_project:'Save a validated configuration draft. Does not create a directory, build firmware or contact hardware.',get_fm1_project:'Read one saved Forge configuration draft.',open_fm1_project:'Open a .fm1-forge.json configuration in the native Forge viewer.',configure_fm1_project:'Show a native configuration form and save the accepted draft. No build or device transfer.'};
  for(const name of Object.keys(descriptions)){
    server.registerTool(name,{title:name==='open_fm1_project'?'FM1 Forge project':name==='configure_fm1_project'?'Configure FM1 project':descriptions[name].split('.')[0],description:descriptions[name],inputSchema:inputSchemas[name],annotations:{readOnlyHint:['list_fm1_projects','get_fm1_project','open_fm1_project'].includes(name),destructiveHint:false,openWorldHint:false},
      ...(['open_fm1_project','configure_fm1_project'].includes(name)?{icons:ICONS,_meta:{ui:{resourceUri:RESOURCE_URI},'openai/ui':OpenAIUiToolMetadataSchema.parse({...(name==='open_fm1_project'?{entrypoints:[{type:'file',extensions:['.fm1-forge.json']}]}:{}),preferredModelDisplayMode:'fullscreen'})}}:{})},async(args,context)=>{
      try{const data=await callExtensionTool(env,owner(),name,args,context,extensions,server);return data.resultType==='input_required'?data:result(data);}
      catch(error){return {isError:true,content:[{type:'text',text:error instanceof PublicError?error.message:'Forge storage is temporarily unavailable.'}]};}
    });
  }
  for(const [kind,label] of [['projects','Forge project configurations'],['jobs','FM1 saved requests'],['catalog','FM1 package metadata']]){
    server.registerResource(label,new ResourceTemplate('fm1-forge://'+kind+'/{id}',{list:undefined}),{mimeType:'application/json'},uri=>readForgeResource(env,owner(),uri.href));
  }
  return extensions;
}
