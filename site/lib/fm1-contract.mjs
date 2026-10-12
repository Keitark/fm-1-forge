import { ICONS } from './fm1-icon.mjs';
import { OpenAIUiToolMetadataSchema } from '@openai/mcp-extensions';
export const RESOURCE_URI = 'ui://fm1/forge-panel-v8.html';
export const PROFILES = [
  {profile:'diagnostics',title:'Forge diagnostics',description:'Test inputs, LCD and audio before starting your firmware project.',symbol:'F'},
  {profile:'nes',title:'NES',description:'Play your prepared cartridge collection.',symbol:'N'},
  {profile:'doom',title:'Doom',description:'The original engine, adapted for FM1.',symbol:'D'},
  {profile:'mdx',title:'MDX',description:'FM music playback and keyboard performance.',symbol:'M'},
  {profile:'buddha',title:'Buddha',description:'An Amiga module performance.',symbol:'B'},
  {profile:'protracker',title:'ProTracker',description:'Explore and perform tracker music.',symbol:'P'},
];
export const ID = /^[a-f0-9]{32}$/;
export const CATALOG_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export class PublicError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function validate(name,input={}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PublicError('Arguments must be an object.');
  const fields = {
    open_fm1_library:[], get_fm1_status:[], list_fm1_apps:[], open_fm1_local_import:[],
    plan_fm1_app:['catalog_id'], get_fm1_job:['job_id'], get_fm1_request:['request_id'],
    prepare_fm1_switch:['catalog_id','entry_method'], confirm_fm1_switch:['approval_id'],
    prepare_fm1_official_update:[], confirm_fm1_official_update:['approval_id'],
  }[name];
  if (!fields) throw new PublicError('Unknown tool.',404);
  if (Object.keys(input).some(key=>!fields.includes(key)) || fields.some(key=>!(key in input))) throw new PublicError('Unexpected or missing arguments.');
  for (const key of fields) {
    const value=input[key];
    if (key==='catalog_id' && (typeof value!=='string'||!CATALOG_ID.test(value))) throw new PublicError('Choose a valid catalog ID.');
    if (key.endsWith('_id') && key!=='catalog_id' && (typeof value!=='string'||!ID.test(value))) throw new PublicError('Use a saved 32-character lowercase job or request ID.');
    if (key==='entry_method' && !['auto','serial','already_uboot'].includes(value)) throw new PublicError('Choose auto, serial or already_uboot.');
  }
  return {...input};
}
const schemas = {
  catalog_id:{type:'string',pattern:CATALOG_ID.source}, job_id:{type:'string',pattern:ID.source},request_id:{type:'string',pattern:ID.source},approval_id:{type:'string',pattern:ID.source},
  entry_method:{type:'string',enum:['auto','serial','already_uboot']},
};
const definitions = [
  ['open_fm1_library','FM1 Forge','Open the installed FM1 Forge plugin panel: diagnostic onboarding, graphical module configuration, packages and saved jobs.',[],true],
  ['get_fm1_status','Refresh bench status','Request inventory and persisted bridge/session state. No device I/O.',[],true],
  ['list_fm1_apps','Refresh app packages','Request validated package metadata and readiness; never returns firmware bytes.',[],true],
  ['open_fm1_local_import','Add local app set','Open the local companion importer so the user can choose built FM1 package JSON files and save a named app set. Firmware bytes remain local. No device I/O. Inspect the saved request ID after a timeout.',[],false],
  ['plan_fm1_app','Plan app change','Submit an offline plan for an existing catalog ID. No device I/O. Returns a saved request ID; inspect it with get_fm1_request.',['catalog_id'],false],
  ['get_fm1_job','Inspect saved job','Request a saved bridge job by its exact ID. Does not resubmit any operation.',['job_id'],true],
  ['get_fm1_request','Inspect relay request','Read the saved delivery outcome, including the authoritative bridge job status.',['request_id'],true],
  ['prepare_fm1_switch','Review app switch','Stage a selected variant for explicit human review in the library. Does not submit a device write.',['catalog_id','entry_method'],false],
  ['confirm_fm1_switch','Confirm app switch','Consume the displayed one-use approval after human confirmation. Requires local bench switching to be enabled.',['approval_id'],false],
  ['prepare_fm1_official_update','Review official SysEx update','Review a handoff to the locally pinned official M-UPGRADE updater. The vendor tool handles .fwsc firmware and MIDI/OTA transitions. Does not launch or write.',[],false],
  ['confirm_fm1_official_update','Open official updater','Consume the displayed one-use approval after human confirmation to open the official Windows updater. Completion remains in the vendor tool.',['approval_id'],false],
];
export const TOOLS = definitions.map(([name,title,description,fields,readOnly])=>({
  name,title,description,inputSchema:{type:'object',properties:Object.fromEntries(fields.map(key=>[key,schemas[key]])),required:fields,additionalProperties:false},
  annotations:{readOnlyHint:readOnly,destructiveHint:name.startsWith('confirm_'),idempotentHint:readOnly,openWorldHint:false},
  ...(name==='open_fm1_library'?{icons:ICONS,_meta:{ui:{resourceUri:RESOURCE_URI},'openai/ui':OpenAIUiToolMetadataSchema.parse({entrypoints:[{type:'global',quickAction:{title:'Configure firmware',icons:ICONS,target:{type:'tool',name:'configure_fm1_project',arguments:{}}}},{type:'thread'}],preferredModelDisplayMode:'fullscreen'})}}:{}),
  ...(name.startsWith('confirm_')||name==='open_fm1_local_import'?{_meta:{ui:{visibility:['app']}}}:{}),
}));
const PRIVATE = /^(image|image_hex|firmware|firmware_bytes|baseline|baseline_sha256|token|credential|authorization|session_root|path|request_digest|target|PNPDeviceID|serial_number|private.*)$/i;
export function sanitize(value,depth=0) {
  if(depth>12)return null;
  if (typeof value==='string') return value.length>2048?'[omitted]':(/(?:[A-Z]:\\|\\\\|Bearer\s)/i.test(value)?'[local detail omitted]':value);
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(Array.isArray(value))return value.slice(0,1000).map(item=>sanitize(item,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!PRIVATE.test(key)).map(([key,item])=>[key,sanitize(item,depth+1)]));
  return null;
}
