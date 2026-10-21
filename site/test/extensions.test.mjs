import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { OpenAIExtensions, OpenAIFormSchema, createOpenAIFormContentSchema } from '@openai/mcp-extensions/server';
import { callTool, handleFm1Request } from '../lib/fm1-server.mjs';
import { readForgeSettings, updateForgeSettings, configureForgeProject, readForgeResource, searchForgeMentions, PROJECT_FORM, PROJECT_FORM_KEY } from '../lib/fm1-extensions.mjs';
import { projectConfig } from '../lib/fm1-forge-project.mjs';
import { MODULES, moduleGraphHtml, createModuleGraphEngine } from '../lib/fm1-module-graph.mjs';
import { RESOURCE_URI } from '../lib/fm1-contract.mjs';
import { database, cacheCatalog, cacheInventory, seconds } from './d1.mjs';

const fields={slug:'first-synth',displayName:'First Synth',lcdPreset:'stock-dma',module:'user',usbAudio:true};
const config=projectConfig({...fields,clockPreset:'sdk-default',clockOptIn:false});
function oldConfig(config,version=1){const {hal,...previous}=config,{uvc,midiUpdate,uacCapture,...usb}=config.usb;return {...previous,schemaVersion:version,usb:{...usb,...(version===3?{uvc}:{})},...(version>=2?{hal:{...hal}}:{})};}

const capabilities={elicitation:{form:{}},extensions:{'openai/elicitation':{form:{}}}};
const envelope=caps=>({'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':caps,'io.modelcontextprotocol/clientInfo':{name:'Forge extensions test',version:'1'}});
async function rpc(env,method,params={},owner='alice'){
  const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':method};
  if(owner)headers['oai-authenticated-user-id']=owner;
  if(params.name||params.uri)headers['Mcp-Name']=params.name||params.uri;
  const response=await handleFm1Request(new Request('https://fm1.test/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:11,method,params:{_meta:envelope(capabilities),...params}})}),env);
  return {response,data:await response.json()};
}
const tools=(env,name,args={})=>rpc(env,'tools/call',{name,arguments:args});
const drafts=env=>env.DB.sqlite.prepare('SELECT count(*) AS n FROM forge_projects').get().n;
const mutations=env=>env.DB.sqlite.prepare('SELECT count(*) AS n FROM relay_tasks').get().n;

test('official settings register discovery capabilities and native structured layouts on both SDK2 eras',async()=>{
  for(const [era,revision] of [['modern','2026-07-28'],['legacy','2025-11-25']]){
    const env=database(),client=new Client({name:'Forge SDK extension test',version:'1'},{capabilities:{},versionNegotiation:{mode:era==='modern'?{pin:revision}:'legacy'},supportedProtocolVersions:[revision]});
    const transport=new StreamableHTTPClientTransport(new URL('https://fm1.test/mcp'),{requestInit:{headers:{'oai-authenticated-user-id':'alice'}},fetch:(input,init)=>handleFm1Request(new Request(input,init),env)});
    try{
      await client.connect(transport);
      const caps=client.getServerCapabilities();assert.equal(caps.extensions['openai/settings'].readTool,'settings.read');assert.equal(caps.extensions['openai/mentions'].searchTool,'search_mentions');
      const read=await client.callTool({name:'settings.read',arguments:{}});
      assert.equal(read.structuredContent.values.palette,'forge-black');assert.equal(read.structuredContent.layout[0].items[0].kind,'property');
      assert.deepEqual(Object.keys(read.structuredContent.values).sort(),Object.keys(read.structuredContent.schema.properties).sort());
      const changed=await client.callTool({name:'settings.update',arguments:{set:{palette:'fm1-mint'}}});
      assert.equal(changed.structuredContent.values.palette,'fm1-mint');assert.equal(changed.structuredContent.values.default_usb_audio,true);
      const listed=await client.listTools(),file=listed.tools.find(tool=>tool.name==='open_fm1_project');
      assert.deepEqual(file._meta['openai/ui'].entrypoints,[{type:'file',extensions:['.fm1-forge.json']}]);
      const configure=listed.tools.find(tool=>tool.name==='configure_fm1_project');
      assert.equal(configure._meta.ui.resourceUri,RESOURCE_URI);assert.equal(configure._meta['openai/ui'].preferredModelDisplayMode,'fullscreen');assert.ok(configure.icons.length);
      const quickAction=listed.tools.find(tool=>tool.name==='open_fm1_library')._meta['openai/ui'].entrypoints[0].quickAction;assert.equal(quickAction.target.name,configure.name);
      const form=await client.callTool({name:configure.name,arguments:{}});assert.equal(form.structuredContent.action,'unsupported');assert.equal(form.structuredContent.created,false);
      const nativePanel=await client.readResource({uri:configure._meta.ui.resourceUri});assert.equal(nativePanel.contents[0].mimeType,'text/html;profile=mcp-app');assert.match(nativePanel.contents[0].text,/FM-1 Forge/);assert.equal(mutations(env),0);
    }finally{await client.close();}
  }
});

test('durable partial settings preserve independent fields and isolate owners without bench mutations',async()=>{
  const env=database();
  // The local SQLite adapter needs a queue to model D1 transaction serialization.
  const batch=env.DB.batch.bind(env.DB);let pending=Promise.resolve();
  env.DB.batch=statements=>{const operation=pending.then(()=>batch(statements));pending=operation.catch(()=>{});return operation;};
  await Promise.all([updateForgeSettings(env,'alice',{palette:'signal-red'}),updateForgeSettings(env,'alice',{pattern:'dots'})]);
  await updateForgeSettings(env,'alice',{default_usb_audio:false});
  assert.equal((await readForgeSettings(env,'alice')).palette,'signal-red');assert.equal((await readForgeSettings(env,'alice')).pattern,'dots');
  assert.equal((await readForgeSettings(env,'bob')).palette,'forge-black');
  assert.equal((await callTool(env,'alice','open_fm1_library',{})).forge.settings.default_usb_audio,false);assert.equal(mutations(env),0);
  for(const set of [{},{path:'C:\\private'},{palette:'not-known'},{default_usb_audio:'yes'},{entry_method:'sysex'},{pattern:null}])await assert.rejects(updateForgeSettings(env,'alice',set),/invalid/);
  const bad=await tools(env,'settings.update',{set:{clockPreset:'sdk-320'}});assert.equal(bad.data.result.isError,true);
});

test('settings transaction failure rolls back and missing storage never claims successful persistence',async()=>{
  const env=database(),batch=env.DB.batch.bind(env.DB);
  env.DB.batch=statements=>{statements.at(-1).run=async()=>{throw new Error('synthetic failure');};return batch(statements);};
  await assert.rejects(updateForgeSettings(env,'alice',{palette:'fm1-mint',pattern:'dots'}));
  assert.equal((await readForgeSettings(env,'alice')).palette,'forge-black');
  const absent=database();delete absent.DB;await assert.rejects(callTool(absent,'alice','save_fm1_project',{config}),/storage/);await assert.rejects(readForgeSettings(absent,'alice'),/storage/);
});

test('projects persist as configuration drafts with explicit diagnostic gate and owner-bound resources',async()=>{
  const env=database(),saved=await callTool(env,'alice','save_fm1_project',{config});
  assert.equal(saved.project.state,'configuration_draft');assert.equal(saved.gate.can_start_project,false);assert.match(saved.message,/No local directory/);
  assert.equal((await callTool(env,'alice','list_fm1_projects',{})).projects.length,1);assert.equal((await callTool(env,'bob','list_fm1_projects',{})).projects.length,0);
  const contents=await readForgeResource(env,'alice',saved.project.resource_uri);assert.deepEqual(JSON.parse(contents.contents[0].text),config);assert.equal(contents.contents[0]._meta['openai/resource'].writable,false);
  await assert.rejects(readForgeResource(env,'bob',saved.project.resource_uri),/not found/);
  await assert.rejects(callTool(env,'bob','save_fm1_project',{config,project_id:saved.project.id}),/not found/);
  const changed=structuredClone(config);changed.project.displayName='Renamed synth';
  assert.equal((await callTool(env,'alice','save_fm1_project',{config:changed,project_id:saved.project.id})).project.title,'Renamed synth');assert.equal(drafts(env),1);assert.equal(mutations(env),0);
  env.DB.sqlite.prepare('INSERT INTO forge_baselines(user_id,job_id,sha256,verified_at) VALUES(?,?,?,?)').run('alice','a'.repeat(32),'b'.repeat(64),seconds());
  assert.equal((await callTool(env,'alice','get_fm1_project',{project_id:saved.project.id})).gate.can_start_project,true);
  const read=await rpc(env,'resources/read',{uri:saved.project.resource_uri});assert.equal(read.data.result.ttlMs,0);assert.equal(read.data.result.cacheScope,'private');assert.equal(read.response.headers.get('cache-control').includes('no-store'),true);
  assert.equal((await rpc(env,'resources/read',{uri:saved.project.resource_uri},null)).response.status,401);
});

test('v4 HAL selections survive saved drafts, owner resources and updates including false values',async()=>{
  const env=database(),selected={...config,hal:{buttons:false,encoders:true,volume:false,lcd:false,audio:false}};
  const saved=await callTool(env,'alice','save_fm1_project',{config:selected});
  assert.deepEqual(saved.project.config,selected);
  assert.deepEqual((await callTool(env,'alice','list_fm1_projects',{})).projects[0].config,selected);
  assert.deepEqual(JSON.parse((await readForgeResource(env,'alice',saved.project.resource_uri)).contents[0].text),selected);
  const changed={...selected,hal:{...selected.hal,encoders:false}};
  await callTool(env,'alice','save_fm1_project',{config:changed,project_id:saved.project.id});
  assert.deepEqual(JSON.parse(env.DB.sqlite.prepare('SELECT config FROM forge_projects WHERE id=?').get(saved.project.id).config),changed);
  assert.equal(mutations(env),0);
});

test('legacy v1 drafts normalize on reads without rewriting storage and save as canonical v4',async()=>{
  const env=database(),legacy=oldConfig(config),expected={...config,usb:{...config.usb,midiUpdate:false}},id='e'.repeat(32),stored=JSON.stringify(legacy),at=seconds();
  env.DB.sqlite.prepare('INSERT INTO forge_projects(id,user_id,title,slug,config,created,updated) VALUES(?,?,?,?,?,?,?)').run(id,'alice',legacy.project.displayName,legacy.project.slug,stored,at,at);
  assert.deepEqual((await callTool(env,'alice','get_fm1_project',{project_id:id})).project.config,expected);
  assert.deepEqual((await callTool(env,'alice','list_fm1_projects',{})).projects[0].config,expected);
  assert.deepEqual(JSON.parse((await readForgeResource(env,'alice','fm1-forge://projects/'+id)).contents[0].text),expected);
  assert.equal(env.DB.sqlite.prepare('SELECT config FROM forge_projects WHERE id=?').get(id).config,stored);
  const saved=await callTool(env,'alice','save_fm1_project',{config:legacy,project_id:id});
  assert.deepEqual(saved.project.config,expected);assert.deepEqual(JSON.parse(env.DB.sqlite.prepare('SELECT config FROM forge_projects WHERE id=?').get(id).config),expected);
  assert.equal(mutations(env),0);
});

test('strict v2 drafts import with UVC off while v4 UVC persists through save, list, get and export',async()=>{
  for(const uvc of [true,false]){
    const env=database(),selected={...config,usb:{...config.usb,uvc,uacCapture:false},hal:{...config.hal,lcd:false,buttons:false}},saved=await callTool(env,'alice','save_fm1_project',{config:selected});
    assert.deepEqual(saved.project.config,selected);
    assert.deepEqual((await callTool(env,'alice','list_fm1_projects',{})).projects[0].config,selected);
    assert.deepEqual((await callTool(env,'alice','get_fm1_project',{project_id:saved.project.id})).project.config,selected);
    assert.deepEqual(JSON.parse((await readForgeResource(env,'alice',saved.project.resource_uri)).contents[0].text),selected);
    const previous=oldConfig(selected,2),serialized=JSON.stringify(previous),normalized={...selected,usb:{...selected.usb,uvc:false,midiUpdate:false,uacCapture:selected.usb.uac}};
    const imported=await callTool(env,'alice','save_fm1_project',{config:previous,project_id:saved.project.id});
    assert.deepEqual(imported.project.config,normalized);assert.equal(JSON.stringify(previous),serialized);assert.equal(mutations(env),0);
  }
});

test('strict canonical USB shapes reject malformed UVC and unexpected legacy additions before persistence',async()=>{
  const env=database(),{uvc,...missing}=config.usb;
  const bad=[{...config,usb:missing},...[null,'false',1,{},[]].map(uvc=>({...config,usb:{...config.usb,uvc}})),...[1,2].map(version=>({...oldConfig(config,version),usb:config.usb})),{...config,schemaVersion:5},{...config,usb:{...config.usb,cdc:false}},{...config,usb:{...config.usb,uboot:false}}];
  for(const candidate of bad){await assert.rejects(callTool(env,'alice','save_fm1_project',{config:candidate}));assert.equal((await tools(env,'save_fm1_project',{config:candidate})).data.result.isError,true);}
  assert.equal(drafts(env),0);assert.equal(mutations(env),0);
});

test('canonical schema rejects partial HALs, extra HALs, non-booleans and v1 HAL additions',async()=>{
  const env=database(),{hal,...previous}=config;
  for(const candidate of [{...previous},{...previous,schemaVersion:1,hal},{...config,hal:{...hal,extra:true}},{...config,hal:{...hal,audio:'false'}},{...config,hal:{buttons:true}},{...config,hal:null},{...config,schemaVersion:5}]){
    await assert.rejects(callTool(env,'alice','save_fm1_project',{config:candidate}));
    const rpc=await tools(env,'save_fm1_project',{config:candidate});assert.equal(rpc.data.result.isError,true);
  }
  assert.equal(drafts(env),0);assert.equal(mutations(env),0);
});

test('canonical configurations reject traversal, unknown fields, recovery edits and unguarded clocks',async()=>{
  const env=database(),bad=[{...config,extra:true},{...config,usb:{...config.usb,uboot:false}},{...config,project:{slug:'../old',displayName:'Unsafe'}},{...config,project:{slug:'con',displayName:'Reserved'}},{...config,project:{slug:'first-synth',displayName:'x'.repeat(65)}},{...config,project:{slug:'first-synth',displayName:'C:\\secret'}},{...config,clockPreset:'sdk-320'}];
  // A printable display title may contain punctuation but never becomes a path.
  bad.splice(5,1);
  for(const candidate of bad)await assert.rejects(callTool(env,'alice','save_fm1_project',{config:candidate}));
  await assert.rejects(callTool(env,'alice','save_fm1_project',{config:{...config,clockPreset:'sdk-320',lcdPreset:'spi30-rgb444'},clock_opt_in:true}),/incompatible/);
  assert.equal(drafts(env),0);assert.equal(mutations(env),0);
  const accepted=await callTool(env,'alice','save_fm1_project',{config:{...config,clockPreset:'sdk-320'},clock_opt_in:true});assert.equal(accepted.project.config.clockPreset,'sdk-320');
});

test('draft quota is atomically bounded and listing/search remain capped without relay work',async()=>{
  const env=database();
  for(let index=0;index<100;index++)await callTool(env,'alice','save_fm1_project',{config});
  await assert.rejects(callTool(env,'alice','save_fm1_project',{config}),/limit/);
  assert.equal(drafts(env),100);assert.equal((await callTool(env,'alice','list_fm1_projects',{})).projects.length,24);assert.equal((await searchForgeMentions(env,'alice','')).items.length,24);
  assert.equal((await callTool(env,'bob','save_fm1_project',{config})).project.state,'configuration_draft');assert.equal(mutations(env),0);
});

test('file viewer accepts bounded opaque references and does not resolve paths, fetch files or queue hardware',async()=>{
  const env=database(),file={name:'first-synth.fm1-forge.json',resourceUri:'host-resource://selected-project'};
  const opened=await callTool(env,'alice','open_fm1_project',{file});assert.deepEqual(opened.file,file);assert.equal(opened.mode,'project_file');assert.equal(mutations(env),0);assert.equal(drafts(env),0);
  assert.equal((await callTool(env,'alice','open_fm1_project',{file:{...file,resourceUri:'host-resource:opaque-selection'}})).file.resourceUri,'host-resource:opaque-selection');
  for(const input of [{...file,name:'../first-synth.fm1-forge.json'},{...file,name:'x.json'},{...file,name:'C:\\first-synth.fm1-forge.json'},...['file:///C:/secret','C:\\secret','https://example.test/file','host-resource://x%5csecret','host-resource://x\nsecret'].map(resourceUri=>({...file,resourceUri}))])await assert.rejects(callTool(env,'alice','open_fm1_project',{file:input}));
  await assert.rejects(callTool(env,'alice','open_fm1_project',{file,path:'C:\\secret'}));
});

test('mentions and project/job/catalog resources expose bounded metadata for the authenticated owner',async()=>{
  const env=database();cacheCatalog(env);cacheInventory(env);
  const saved=await callTool(env,'alice','save_fm1_project',{config});
  const searched=await searchForgeMentions(env,'alice','synth');assert.equal(searched.items[0].resourceUri,saved.project.resource_uri);
  assert.equal((await searchForgeMentions(env,'bob','')).items.length,0);await assert.rejects(searchForgeMentions(env,'alice','x'.repeat(129)));
  const items=(await tools(env,'search_mentions',{query:''})).data.result.structuredContent.items;assert.ok(items.some(item=>item.resourceUri==='fm1-forge://catalog/nes-test'));assert.ok(items.some(item=>item.resourceUri==='fm1-forge://jobs/'+('d'.repeat(32))));
  const job=await readForgeResource(env,'alice','fm1-forge://jobs/'+('d'.repeat(32)));assert.equal(JSON.parse(job.contents[0].text).operation,'status');assert.ok(!job.contents[0].text.includes('arguments'));
  await assert.rejects(readForgeResource(env,'bob','fm1-forge://jobs/'+('d'.repeat(32))),/not found/);
  await assert.rejects(readForgeResource(env,'bob','fm1-forge://catalog/nes-test'),/not found/);
  assert.ok(!JSON.stringify(items).includes('FM1_RELAY_TOKEN'));
});

test('native MRTR requests use official form schema, keyed continuation and no first-round mutation',async()=>{
  const env=database(),first=await tools(env,'configure_fm1_project');
  const discovery=await rpc(env,'tools/list'),configure=discovery.data.result.tools.find(tool=>tool.name==='configure_fm1_project');assert.equal(configure._meta.ui.resourceUri,RESOURCE_URI);
  assert.equal(first.data.result.resultType,'input_required');assert.equal(drafts(env),0);assert.equal(mutations(env),0);
  const form=first.data.result.inputRequests[PROJECT_FORM_KEY].params._meta['openai/elicitation'].requestedSchema;
  assert.equal(OpenAIFormSchema.safeParse(form).success,true);assert.match(form.properties.module.oneOf[0]['x-openai-thumbnail'].src,/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/);assert.ok(form.properties.slug['x-openai-suggestions']);
  assert.equal(form.properties.clockPreset,undefined);assert.equal(form.properties.clockOptIn,undefined);assert.ok(!form.required.some(key=>key.startsWith('clock')));
  const completed=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content:fields}}});
  assert.equal(completed.data.result.resultType,'complete');assert.equal(completed.data.result.structuredContent.action,'accept');assert.deepEqual(completed.data.result.structuredContent.config,config);assert.equal(drafts(env),1);assert.equal(mutations(env),0);
  assert.equal(completed.data.result.structuredContent.clock_opt_in,false);
  const panel=await rpc(env,'resources/read',{uri:configure._meta.ui.resourceUri});assert.equal(panel.data.result.contents[0].mimeType,'text/html;profile=mcp-app');assert.equal(mutations(env),0);
});

test('CPU is read-only in the module graph and removed from native form input',async()=>{
  assert.equal(MODULES.length,14);assert.ok(!MODULES.some(module=>module.id==='tweak-clock'));
  assert.throws(()=>createModuleGraphEngine().placement('tweak-clock','tweaks'),/Unknown firmware module/);
  assert.ok(!moduleGraphHtml.includes('forge-add-tweak-clock'));assert.ok(!moduleGraphHtml.includes('forge-card-tweak-clock'));
  assert.match(moduleGraphHtml,/id="forge-cpu-summary">CPU: SDK default · measured 360 MHz<\/p>/);
  assert.match(moduleGraphHtml,/<select id="forge-clock-preset" hidden aria-hidden="true" tabindex="-1">/);
  assert.match(moduleGraphHtml,/<input id="forge-clock-opt-in" type="checkbox" hidden aria-hidden="true" tabindex="-1">/);
  const env=database();
  for(const clockFields of [{clockPreset:'sdk-320'},{clockOptIn:true},{clockPreset:'sdk-default',clockOptIn:false}]){
    const answer=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content:{...fields,...clockFields}}}});assert.equal(answer.data.result.isError,true);
  }
  assert.equal(drafts(env),0);assert.equal(mutations(env),0);
});

test('native optional HAL choices default on for old responses and preserve explicit off values',async()=>{
  const env=database(),first=await tools(env,'configure_fm1_project'),form=first.data.result.inputRequests[PROJECT_FORM_KEY].params._meta['openai/elicitation'].requestedSchema;
  for(const key of ['halButtons','halEncoders','halVolume','halLcd','halAudio']){assert.equal(form.properties[key].default,true);assert.ok(!form.required.includes(key));}
  const selected={...fields,halButtons:false,halEncoders:false,halVolume:false,halLcd:false,halAudio:false};
  assert.equal(createOpenAIFormContentSchema(form).safeParse(selected).success,true);
  const answered=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content:selected}}});
  const result=answered.data.result.structuredContent;assert.equal(result.action,'accept');assert.deepEqual(result.config.hal,{buttons:false,encoders:false,volume:false,lcd:false,audio:false});assert.equal(result.config.usb.uac,true);
  const old=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content:fields}}});
  assert.deepEqual(old.data.result.structuredContent.config.hal,config.hal);assert.equal(mutations(env),0);
});

test('native UVC option defaults off and preserves explicit accepted screen-mirror selection',async()=>{
  const env=database(),first=await tools(env,'configure_fm1_project'),form=first.data.result.inputRequests[PROJECT_FORM_KEY].params._meta['openai/elicitation'].requestedSchema;
  assert.equal(form.properties.usbVideo.default,false);assert.ok(!form.required.includes('usbVideo'));
  for(const usbVideo of [true,false]){
    const content={...fields,usbVideo,usbMidiUpdate:false,halLcd:false};assert.equal(createOpenAIFormContentSchema(form).safeParse(content).success,true);
    const answered=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content}}}),value=answered.data.result.structuredContent;
    assert.equal(value.config.usb.uvc,usbVideo);assert.equal(value.config.schemaVersion,4);assert.equal(value.config.hal.lcd,false);
    assert.deepEqual(JSON.parse((await readForgeResource(env,'alice',value.project.resource_uri)).contents[0].text),value.config);
  }
  const legacy=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content:fields}}});assert.equal(legacy.data.result.structuredContent.config.usb.uvc,false);
  for(const usbVideo of [null,'true',1])assert.equal((await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content:{...fields,usbVideo}}}})).data.result.isError,true);
  assert.equal(drafts(env),3);assert.equal(mutations(env),0);
});

test('native MRTR cancel, decline, wrong keys and malformed answers cannot save configuration drafts',async()=>{
  for(const action of ['cancel','decline']){const env=database(),answer=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action}}});assert.equal(answer.data.result.structuredContent.action,action);assert.equal(drafts(env),0);}
  const env=database(),wrong=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{other:{action:'accept',content:fields}}});assert.equal(wrong.data.result.resultType,'input_required');assert.equal(drafts(env),0);
  for(const content of [{...fields,usbAudio:'yes'},{...fields,unknown:'value'},{...fields,halButtons:'false'},{...fields,halAudio:null},{...fields,clockPreset:'sdk-320',clockOptIn:false},{...fields,displayName:'x'.repeat(65)}]){const answer=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content}}});assert.equal(answer.data.result.isError,true);assert.equal(drafts(env),0);}
});

test('native form capability checks require both modern capability maps and never borrow prior clients',async()=>{
  const env=database();
  for(const caps of [{},{elicitation:{form:{}}},{extensions:{'openai/elicitation':{form:{}}}}]){
    const answer=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},_meta:envelope(caps)});assert.equal(answer.data.result.structuredContent.action,'unsupported');
  }
  assert.equal((await callTool(env,'alice','configure_fm1_project',{})).action,'unsupported');assert.equal(drafts(env),0);
});

test('legacy official elicitation sends the dedicated extension method and validates accepted response',async()=>{
  const env=database(),server=new McpServer({name:'Forge legacy test',version:'1'}),extensions=new OpenAIExtensions(server),sent=[];
  const context={mcpReq:{envelope:{'io.modelcontextprotocol/protocolVersion':'2025-11-25','io.modelcontextprotocol/clientCapabilities':{extensions:{'openai/elicitation':{form:{}}}}},send:async(request)=>{sent.push(request);return {action:'accept',content:fields};}}};
  const answer=await configureForgeProject(env,'alice',context,extensions,server);assert.equal(answer.action,'accept');assert.equal(sent[0].method,'openai/elicitation/create');assert.equal(drafts(env),1);assert.equal(mutations(env),0);
  context.mcpReq.send=async()=>({action:'accept',content:{...fields,usbAudio:'invalid'}});await assert.rejects(configureForgeProject(env,'alice',context,extensions,server),/invalid/);assert.equal(drafts(env),1);
});

test('native form resource picker lists only owner saved drafts and validates selected references',async()=>{
  const env=database(),saved=await callTool(env,'alice','save_fm1_project',{config});
  const first=await tools(env,'configure_fm1_project'),form=first.data.result.inputRequests[PROJECT_FORM_KEY].params._meta['openai/elicitation'].requestedSchema;
  assert.equal(form.properties.referenceProject['x-openai-input'].options[0].uri,saved.project.resource_uri);assert.equal(createOpenAIFormContentSchema(form).safeParse({...fields,referenceProject:[saved.project.resource_uri]}).success,true);
  const accepted=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content:{...fields,referenceProject:[saved.project.resource_uri],goal:'Build a key synth.'}}}});
  assert.equal(accepted.data.result.structuredContent.reference_project_id,saved.project.id);assert.equal(accepted.data.result.structuredContent.goal,'Build a key synth.');
  const bob=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content:{...fields,referenceProject:[saved.project.resource_uri]}}}},'bob');assert.equal(bob.data.result.isError,true);
});


test('v4 firmware MIDI selections persist with UVC while legacy imports keep the receiver off',async()=>{
  for(const midiUpdate of [true,false]){
    const env=database(),selected={...config,usb:{...config.usb,uvc:true,midiUpdate,uacCapture:false}},saved=await callTool(env,'alice','save_fm1_project',{config:selected});
    assert.deepEqual(saved.project.config,selected);
    assert.deepEqual((await callTool(env,'alice','list_fm1_projects',{})).projects[0].config,selected);
    assert.deepEqual((await callTool(env,'alice','get_fm1_project',{project_id:saved.project.id})).project.config,selected);
    assert.deepEqual(JSON.parse((await readForgeResource(env,'alice',saved.project.resource_uri)).contents[0].text),selected);
    for(const version of [1,2,3]){
      const previous=oldConfig(selected,version),serialized=JSON.stringify(previous),expected={...selected,usb:{...selected.usb,uvc:version===3,midiUpdate:false,uacCapture:selected.usb.uac}};
      const imported=await callTool(env,'alice','save_fm1_project',{config:previous,project_id:saved.project.id});
      assert.deepEqual(imported.project.config,expected);assert.equal(JSON.stringify(previous),serialized);
    }
    assert.equal(mutations(env),0);
  }
});

test('canonical MIDI selection rejects missing, unexpected and nonboolean values before storage',async()=>{
  const env=database(),{midiUpdate,...missing}=config.usb;
  const invalid=[{...config,usb:missing},...[null,'false',0,1,{},[]].map(midiUpdate=>({...config,usb:{...config.usb,midiUpdate}})),...[1,2,3].map(version=>({...oldConfig(config,version),usb:{...oldConfig(config,version).usb,midiUpdate:false}}))];
  for(const candidate of invalid){await assert.rejects(callTool(env,'alice','save_fm1_project',{config:candidate}));assert.equal((await tools(env,'save_fm1_project',{config:candidate})).data.result.isError,true);}
  assert.equal(drafts(env),0);assert.equal(mutations(env),0);
});

test('native firmware MIDI option defaults on and accepts off alongside USB video without device work',async()=>{
  const env=database(),first=await tools(env,'configure_fm1_project'),form=first.data.result.inputRequests[PROJECT_FORM_KEY].params._meta['openai/elicitation'].requestedSchema;
  assert.equal(form.properties.usbMidiUpdate.default,true);assert.ok(!form.required.includes('usbMidiUpdate'));
  assert.match(form.properties.usbMidiUpdate.description,/experimental USB MIDI \+ SysEx receiver/);assert.match(form.properties.usbMidiUpdate.description,/Loader installation remains unqualified/);
  for(const usbMidiUpdate of [true,false]){
    const content={...fields,usbMidiUpdate,usbVideo:true,usbAudioCapture:false};assert.equal(createOpenAIFormContentSchema(form).safeParse(content).success,true);
    const answered=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content}}}),value=answered.data.result.structuredContent;
    assert.equal(value.config.usb.midiUpdate,usbMidiUpdate);assert.equal(value.config.usb.uvc,true);assert.equal(value.config.schemaVersion,4);
    assert.deepEqual(JSON.parse((await readForgeResource(env,'alice',value.project.resource_uri)).contents[0].text),value.config);
  }
  const omitted=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content:fields}}});assert.equal(omitted.data.result.structuredContent.config.usb.midiUpdate,true);
  for(const usbMidiUpdate of [null,'true',1])assert.equal((await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content:{...fields,usbMidiUpdate}}}})).data.result.isError,true);
  assert.equal(drafts(env),3);assert.equal(mutations(env),0);
});


test('native capture choice defaults on, persists explicit off and reports endpoint overcapacity without saving',async()=>{
  const env=database(),first=await tools(env,'configure_fm1_project'),form=first.data.result.inputRequests[PROJECT_FORM_KEY].params._meta['openai/elicitation'].requestedSchema;
  assert.equal(form.properties.usbAudioCapture.default,true);assert.ok(!form.required.includes('usbAudioCapture'));assert.match(form.properties.usbAudioCapture.description,/one USB IN endpoint/);
  for(const usbAudio of [true,false])for(const usbAudioCapture of [true,false]){
    const content={...fields,usbAudio,usbAudioCapture};assert.equal(createOpenAIFormContentSchema(form).safeParse(content).success,true);
    const answered=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content}}}),value=answered.data.result.structuredContent;
    assert.equal(value.config.usb.uacCapture,usbAudio&&usbAudioCapture);assert.equal(value.project.config.usb.uacCapture,usbAudio&&usbAudioCapture);
  }
  const before=drafts(env),over=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content:{...fields,usbAudioCapture:true,usbVideo:true,usbMidiUpdate:true}}}});
  assert.equal(over.data.result.isError,true);assert.match(over.data.result.content[0].text,/USB IN endpoint budget/);assert.equal(drafts(env),before);
  for(const usbAudioCapture of [null,'true',1])assert.equal((await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content:{...fields,usbAudioCapture}}}})).data.result.isError,true);
  assert.equal(drafts(env),before);assert.equal(mutations(env),0);
});

test('saved canonical capture requires exact booleans and rejects disabled audio or endpoint overcapacity',async()=>{
  const env=database(),{uacCapture,...missing}=config.usb;
  const invalid=[{...config,usb:missing},...[null,'false',0,1,{},[]].map(uacCapture=>({...config,usb:{...config.usb,uacCapture}})),{...config,usb:{...config.usb,uac:false,uacCapture:true}},{...config,usb:{...config.usb,uvc:true}},...[1,2,3].map(version=>({...oldConfig(config,version),usb:{...oldConfig(config,version).usb,uacCapture:false}}))];
  for(const candidate of invalid){await assert.rejects(callTool(env,'alice','save_fm1_project',{config:candidate}));assert.equal((await tools(env,'save_fm1_project',{config:candidate})).data.result.isError,true);}
  assert.equal(drafts(env),0);assert.equal(mutations(env),0);
});
