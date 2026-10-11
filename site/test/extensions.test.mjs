import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { OpenAIExtensions, OpenAIFormSchema, createOpenAIFormContentSchema } from '@openai/mcp-extensions/server';
import { callTool, handleFm1Request } from '../lib/fm1-server.mjs';
import { readForgeSettings, updateForgeSettings, configureForgeProject, readForgeResource, searchForgeMentions, PROJECT_FORM, PROJECT_FORM_KEY } from '../lib/fm1-extensions.mjs';
import { projectConfig } from '../lib/fm1-forge-project.mjs';
import { RESOURCE_URI } from '../lib/fm1-contract.mjs';
import { database, cacheCatalog, cacheInventory, seconds } from './d1.mjs';

const fields={slug:'first-synth',displayName:'First Synth',clockPreset:'sdk-default',clockOptIn:false,lcdPreset:'stock-dma',module:'user',usbAudio:true};
const config=projectConfig(fields);
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
      const nativePanel=await client.readResource({uri:configure._meta.ui.resourceUri});assert.equal(nativePanel.contents[0].mimeType,'text/html;profile=mcp-app');assert.match(nativePanel.contents[0].text,/FM1 Forge/);assert.equal(mutations(env),0);
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
  const completed=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content:fields}}});
  assert.equal(completed.data.result.resultType,'complete');assert.equal(completed.data.result.structuredContent.action,'accept');assert.deepEqual(completed.data.result.structuredContent.config,config);assert.equal(drafts(env),1);assert.equal(mutations(env),0);
  const panel=await rpc(env,'resources/read',{uri:configure._meta.ui.resourceUri});assert.equal(panel.data.result.contents[0].mimeType,'text/html;profile=mcp-app');assert.equal(mutations(env),0);
});

test('native MRTR cancel, decline, wrong keys and malformed answers cannot save configuration drafts',async()=>{
  for(const action of ['cancel','decline']){const env=database(),answer=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action}}});assert.equal(answer.data.result.structuredContent.action,action);assert.equal(drafts(env),0);}
  const env=database(),wrong=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{other:{action:'accept',content:fields}}});assert.equal(wrong.data.result.resultType,'input_required');assert.equal(drafts(env),0);
  for(const content of [{...fields,usbAudio:'yes'},{...fields,unknown:'value'},{...fields,clockPreset:'sdk-320',clockOptIn:false},{...fields,displayName:'x'.repeat(65)}]){const answer=await rpc(env,'tools/call',{name:'configure_fm1_project',arguments:{},inputResponses:{[PROJECT_FORM_KEY]:{action:'accept',content}}});assert.equal(answer.data.result.isError,true);assert.equal(drafts(env),0);}
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
