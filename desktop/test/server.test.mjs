import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Client} from '../../site/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import {InMemoryTransport} from '../../site/node_modules/@modelcontextprotocol/server/dist/index.mjs';
import {createProjectStore} from '../lib/project-store.mjs';
import {projectConfig} from '../../site/lib/fm1-forge-project.mjs';

const checkout=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(new URL('../../site/package.json',import.meta.url));
const {build}=require('esbuild');let serverModule,bundleRoot;
const panel='<!doctype html><html><body>FM-1 Forge<script>const desktopMode=true;</script></body></html>';
const config=()=>projectConfig({slug:'desktop-instrument',displayName:'Desktop instrument',clockPreset:'sdk-default',clockOptIn:false,lcdPreset:'stock-dma',module:'user',usbAudio:true});
const transports=['stock-midi','firmware-midi'];
const idle=()=>({connected:false,transport:null,identity:null,loader:false,installationAvailable:false,lastError:null,supportedTransports:transports});
before(async()=>{
  bundleRoot=await fs.mkdtemp(path.join(os.tmpdir(),'fm1-server-contract-bundle-'));
  const output=path.join(bundleRoot,'server.mjs');
  await build({absWorkingDir:checkout,entryPoints:['desktop/server.mjs'],outfile:output,bundle:true,format:'esm',platform:'node',target:'node22',nodePaths:[path.join(checkout,'site/node_modules')],external:['@julusian/midi'],logLevel:'silent',banner:{js:"import {createRequire as __fm1TestRequire} from 'node:module'; const require=__fm1TestRequire(import.meta.url);"}});
  serverModule=await import(pathToFileURL(output).href);
});
after(async()=>{if(bundleRoot){assert.ok(path.basename(bundleRoot).startsWith('fm1-server-contract-bundle-'));assert.equal(path.dirname(bundleRoot),os.tmpdir());await fs.rm(bundleRoot,{recursive:true,force:true});}});

async function fixture(t,{updates=true,custom=true,platform='win32',arch='x64'}={}){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'fm1-server-contract-data-')),original=await fs.realpath(base),directory=path.join(base,'metadata'),store=createProjectStore({directory}),calls=[];let current=idle(),closed=0;
  const deviceService={
    async connect(args){calls.push({method:'connect',args});current={...idle(),connected:true,transport:args.transport,identity:args.transport==='stock-midi'?'FM-1_015':'FM1_FORGE_001'};return {...current};},
    async getStatus(){calls.push({method:'status'});return {...current};},
    async disconnect(){calls.push({method:'disconnect'});current=idle();return {...current};},
    async close(){calls.push({method:'close'});closed++;current=idle();},
  };
  const updateCalls=[];
  const attempt={job_id:'c'.repeat(32),state:'active',phase:'checking',progress:0,transfer_finished:false,boot_identity_verified:false,readback_verified:false,recovery_required:false};
  const review={review_id:'b'.repeat(32),job_id:'c'.repeat(32),operation:'install',product:'FM-1_015',sha256:'d'.repeat(64),raw_bytes:699956,logical_bytes:699936,input_name:'FM-1',output_name:'FM-1',identity:'FM-1_015',expires_at:new Date(Date.now()+120000).toISOString()};
  const stockUpdateService=updates?{
    async status(){updateCalls.push({method:'status'});return {supported:true,writing:false,attempt:null,review:null};},
    async beginUpload(args){updateCalls.push({method:'beginUpload',args});return {upload_id:'a'.repeat(32),max_chunk_bytes:65536};},
    async appendUpload(args){updateCalls.push({method:'appendUpload',args});return {upload_id:args.upload_id,received_bytes:3};},
    async review(args){updateCalls.push({method:'review',args});return {review};},
    async reviewResume(args){updateCalls.push({method:'reviewResume',args});return {review:{...review,operation:'resume'}};},
    async start(args){updateCalls.push({method:'start',args});return {writing:true,attempt,review:null};},
    async close(){updateCalls.push({method:'close'});},
  }:undefined;
  const customCalls=[];
  const customReview={...review,kind:'custom-fwsc',product:'FM1_FORGE_001',logical_sha256:'e'.repeat(64),target_build_sha256:'f'.repeat(64),manifest_sha256:'1'.repeat(64),expected_boot_identity:'FM1_FORGE_001',raw_bytes:623156,logical_bytes:623136};
  const customAttempt={...attempt,kind:'custom-fwsc',target_build_sha256:'f'.repeat(64),expected_boot_identity:'FM1_FORGE_001',boot_build_verified:false,observed_boot_identity:null,observed_build_sha256:null};
  const customUpdateService=custom?{
    async status(){customCalls.push({method:'status'});return {supported:true,writing:false,attempt:null,review:null};},
    async beginUpload(args){customCalls.push({method:'beginUpload',args});return {upload_id:'a'.repeat(32),max_chunk_bytes:65536};},
    async appendUpload(args){customCalls.push({method:'appendUpload',args});return {upload_id:args.upload_id,received_bytes:3};},
    async review(args){customCalls.push({method:'review',args});return {review:customReview};},
    async reviewResume(args){customCalls.push({method:'reviewResume',args});return {review:{...customReview,operation:'resume'}};},
    async start(args){customCalls.push({method:'start',args});return {writing:true,attempt:customAttempt,review:null};},
    async close(){customCalls.push({method:'close'});},
    async verifyBoot(args){customCalls.push({method:'verifyBoot',args});return {writing:true,attempt:customAttempt,review:null};},
    async reviewLoaderEntry(args){customCalls.push({method:'reviewLoaderEntry',args});return {review:{...customReview,operation:'loader-entry'}};},
  }:undefined;
  const server=await serverModule.createDesktopServer({deviceService,stockUpdateService,customUpdateService,uiHtml:panel,store,platform,arch});
  const revision='2025-11-25',client=new Client({name:'FM-1 desktop contract test',version:'1'},{capabilities:{},supportedProtocolVersions:[revision],versionNegotiation:{mode:'legacy'}});
  t.after(async()=>{try{await server.close();await client.close();}finally{assert.equal(await fs.realpath(base),original);assert.ok(path.basename(base).startsWith('fm1-server-contract-data-'));await fs.rm(base,{recursive:true,force:true});}});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();await server.connect(serverTransport);await client.connect(clientTransport);
  return {server,client,store,calls,updateCalls,stockUpdateService,customCalls,customUpdateService,directory,deviceService,get closeCount(){return closed;},tool:async(name,args={})=>client.callTool({name,arguments:args})};
}
async function refused(f,name,args){
  let response,failure;try{response=await f.tool(name,args);}catch(error){failure=error;}
  assert.ok(failure||response?.isError===true,name+' must reject these arguments');return response??failure;
}

test('official SDK discovery, panel open and resource read are passive over the packaged legacy stdio protocol',async t=>{
    const f=await fixture(t);assert.deepEqual(f.calls,[]);
    const answer=await f.tool('open_fm1_library'),data=answer.structuredContent;
    assert.deepEqual(data.desktop,{platform:'win32',protocolVersion:2,supportedTransports:transports,installationAvailable:false,stockUpdateAvailable:true,customUpdateAvailable:true});assert.equal(data.forge.gate.can_start_project,false);assert.deepEqual(data.forge.projects,[]);
    const capabilities=f.client.getServerCapabilities();assert.equal(capabilities.extensions['openai/settings'].readTool,'settings.read');
    const resource=await f.client.readResource({uri:serverModule.RESOURCE_URI});assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');assert.match(resource.contents[0].text,/const desktopMode=true/);assert.deepEqual(f.calls,[]);
});

test('tool discovery separates app-only reviewed stock writes from connection tools and forbids raw MIDI',async t=>{
  const f=await fixture(t),listed=await f.client.listTools(),names=listed.tools.map(tool=>tool.name).sort();
  assert.deepEqual(names,['verify_fm1_custom_boot','begin_fm1_custom_upload','append_fm1_custom_upload','review_fm1_custom_update','review_fm1_custom_recovery','review_fm1_custom_loader_entry','start_fm1_custom_update','get_fm1_custom_update_status','begin_fm1_stock_upload','append_fm1_stock_upload','review_fm1_stock_update','review_fm1_stock_recovery','start_fm1_stock_update','get_fm1_stock_update_status','configure_fm1_project','connect_fm1_device','disconnect_fm1_device','get_fm1_device_status','get_fm1_project','list_fm1_projects','open_fm1_library','open_fm1_project','save_fm1_project','search_mentions','settings.read','settings.update'].sort());
  for(const name of ['flash_fm1','send_sysex','send_midi','enter_uboot','reset_fm1','install_firmware'])await refused(f,name,{});
  const connection=listed.tools.find(tool=>tool.name==='connect_fm1_device');assert.deepEqual(connection.inputSchema.properties.transport.enum,transports);assert.equal(connection.annotations.destructiveHint,false);
  assert.deepEqual(listed.tools.find(tool=>tool.name==='open_fm1_project')._meta['openai/ui'].entrypoints,[{type:'file',extensions:['.fm1-forge.json']}]);
  assert.deepEqual(f.calls,[]);
});

test('native connection arguments are validated before the device service and only explicit fixed calls reach it',async t=>{
  const f=await fixture(t);
  for(const [name,args] of [['connect_fm1_device',{}],['connect_fm1_device',{transport:'serial'}],['connect_fm1_device',{transport:'stock-midi',command:'UPGRADE'}],['get_fm1_device_status',{refresh:true}],['disconnect_fm1_device',{reset:true}]])await refused(f,name,args);
  assert.deepEqual(f.calls,[]);const before=await f.tool('get_fm1_device_status');assert.equal(before.structuredContent.connected,false);assert.equal(f.calls.filter(call=>call.method==='connect').length,0);
  for(const transport of transports){
    const connected=await f.tool('connect_fm1_device',{transport});assert.equal(connected.structuredContent.connected,true);assert.equal(connected.structuredContent.transport,transport);assert.equal(connected.structuredContent.installationAvailable,false);
    assert.equal((await f.tool('get_fm1_device_status')).structuredContent.identity,connected.structuredContent.identity);assert.equal((await f.tool('disconnect_fm1_device')).structuredContent.connected,false);
  }
  assert.deepEqual(f.calls.map(call=>call.method),['status','connect','status','disconnect','connect','status','disconnect']);
});

test('official native settings persist partial updates and malformed values cannot mutate local metadata',async t=>{
  const f=await fixture(t),initial=await f.tool('settings.read');assert.equal(initial.structuredContent.values.palette,'forge-black');assert.ok(initial.structuredContent.layout.length);
  await f.tool('settings.update',{set:{palette:'fm1-mint',default_usb_audio:false}});await f.tool('settings.update',{set:{pattern:'dots'}});
  const expected={...initial.structuredContent.values,palette:'fm1-mint',default_usb_audio:false,pattern:'dots'};assert.deepEqual((await f.tool('settings.read')).structuredContent.values,expected);assert.deepEqual(await createProjectStore({directory:f.directory}).readSettings(),expected);
  for(const set of [{},{palette:'unknown'},{default_usb_audio:'false'},{path:'C:/private'}])await refused(f,'settings.update',{set});
  assert.deepEqual((await f.tool('settings.read')).structuredContent.values,expected);assert.deepEqual(f.calls,[]);
});

test('saved drafts, listing, project resources and mentions round trip schema v4 without device calls',async t=>{
  const f=await fixture(t),selected=config();selected.usb.uacCapture=false;selected.usb.uvc=true;selected.hal.lcd=false;
  const answer=await f.tool('save_fm1_project',{config:selected}),saved=answer.structuredContent.project;assert.equal(answer.structuredContent.gate.can_start_project,false);assert.deepEqual(saved.config,selected);assert.match(saved.id,/^[a-f0-9]{32}$/);
  assert.deepEqual((await f.tool('list_fm1_projects')).structuredContent.projects,[saved]);assert.deepEqual((await f.tool('get_fm1_project',{project_id:saved.id})).structuredContent.project,saved);
  const resource=await f.client.readResource({uri:saved.resource_uri});assert.deepEqual(JSON.parse(resource.contents[0].text),selected);assert.equal(resource.contents[0]._meta['openai/resource'].writable,false);
  const mentions=await f.tool('search_mentions',{query:'Desktop instrument'});assert.equal(mentions.structuredContent.items[0].resourceUri,saved.resource_uri);
  const changed=structuredClone(selected);changed.project.displayName='Renamed';await f.tool('save_fm1_project',{config:changed,project_id:saved.id});assert.equal((await f.tool('get_fm1_project',{project_id:saved.id})).structuredContent.project.title,'Renamed');assert.equal((await f.tool('list_fm1_projects')).structuredContent.projects.length,1);assert.deepEqual(f.calls,[]);
});

test('invalid config, unknown IDs and unconfirmed experimental clocks cannot become saved drafts',async t=>{
  const f=await fixture(t),invalid=config();invalid.usb.uvc=true;
  await refused(f,'save_fm1_project',{config:invalid});await refused(f,'save_fm1_project',{config:config(),project_id:'a'.repeat(32)});await refused(f,'save_fm1_project',{config:config(),firmwareBytes:'unreviewed'});
  const clock=config();clock.clockPreset='sdk-320';await refused(f,'save_fm1_project',{config:clock});assert.equal((await f.tool('list_fm1_projects')).structuredContent.projects.length,0);
  const accepted=await f.tool('save_fm1_project',{config:clock,clock_opt_in:true});assert.equal(accepted.structuredContent.project.config.clockPreset,'sdk-320');assert.deepEqual(f.calls,[]);
});

test('file viewer accepts opaque host references and rejects filesystem paths and network URLs',async t=>{
  const f=await fixture(t),file={name:'project.fm1-forge.json',resourceUri:'host-resource:local-selection'};assert.deepEqual((await f.tool('open_fm1_project',{file})).structuredContent.file,file);
  for(const resourceUri of ['file:///C:/private','C:/private','https://example.test/project','ftp://example.test/project'])await refused(f,'open_fm1_project',{file:{...file,resourceUri}});
  await refused(f,'open_fm1_project',{file:{...file,name:'../project.fm1-forge.json'}});assert.deepEqual(f.calls,[]);
});

test('server shutdown closes the injected device service exactly once and rejects missing packaged panel',async t=>{
  const f=await fixture(t);await f.tool('connect_fm1_device',{transport:'stock-midi'});await f.server.close();await f.server.close();assert.equal(f.closeCount,1);assert.equal(f.calls.at(-1).method,'close');
  let touched=false;await assert.rejects(serverModule.createDesktopServer({deviceService:{close(){touched=true;}},uiHtml:'<html>wrong panel</html>',store:f.store,platform:'win32',arch:'x64'}),/packaged Windows panel/);assert.equal(touched,false);
});

test('protocol shutdown completes even when native device cleanup reports an error',async t=>{
  const f=await fixture(t);let closeCalls=0,protocolClosed=false;
  f.deviceService.close=async()=>{closeCalls++;throw new Error('Synthetic native close failure');};f.client.onclose=()=>{protocolClosed=true;};
  await f.server.close().catch(()=>{});assert.equal(protocolClosed,true);await f.server.close().catch(()=>{});assert.equal(closeCalls,1);
});


test('stock writer tools are app-only, destructive install is explicit, and status is passive',async t=>{
  const f=await fixture(t),listed=await f.client.listTools();
  for(const name of ['begin_fm1_stock_upload','append_fm1_stock_upload','review_fm1_stock_update','review_fm1_stock_recovery','start_fm1_stock_update']){
    const tool=listed.tools.find(tool=>tool.name===name);assert.deepEqual(tool._meta.ui.visibility,['app']);assert.equal(tool.annotations.readOnlyHint,false);
    assert.equal(tool.annotations.destructiveHint,name==='start_fm1_stock_update');
  }
  assert.equal(listed.tools.find(tool=>tool.name==='get_fm1_stock_update_status').annotations.readOnlyHint,true);
  assert.deepEqual(f.updateCalls,[]);await f.tool('get_fm1_stock_update_status');assert.deepEqual(f.updateCalls,[{method:'status'}]);assert.deepEqual(f.calls,[]);
  const invalid=[['begin_fm1_stock_upload',{raw_bytes:1}],['begin_fm1_stock_upload',{raw_bytes:699956,path:'C:/private'}],['append_fm1_stock_upload',{upload_id:'a'.repeat(32),offset:-1,data_base64:'AAAA'}],['append_fm1_stock_upload',{upload_id:'a'.repeat(32),offset:0,data_base64:'A'.repeat(87388)}],['review_fm1_stock_update',{upload_id:'../private'}],['review_fm1_stock_recovery',{job_id:'a'.repeat(32),reset:true}],['start_fm1_stock_update',{review_id:'b'.repeat(32)}],['start_fm1_stock_update',{review_id:'b'.repeat(32),confirmed:false}],['start_fm1_stock_update',{review_id:'b'.repeat(32),confirmed:true,package:'unreviewed'}]];
  for(const [name,args] of invalid)await refused(f,name,args);
  assert.equal(f.updateCalls.length,1);assert.deepEqual(f.calls,[]);
});

test('fixed upload review and confirmed start dispatch only to the native stock service',async t=>{
  const f=await fixture(t),upload=await f.tool('begin_fm1_stock_upload',{raw_bytes:699956});assert.equal(upload.structuredContent.max_chunk_bytes,65536);
  await f.tool('append_fm1_stock_upload',{upload_id:'a'.repeat(32),offset:0,data_base64:'AAAA'});
  const reviewed=await f.tool('review_fm1_stock_update',{upload_id:'a'.repeat(32)});assert.equal(reviewed.structuredContent.review.review_id,'b'.repeat(32));
  const started=await f.tool('start_fm1_stock_update',{review_id:'b'.repeat(32),confirmed:true});assert.equal(started.structuredContent.writing,true);assert.equal(started.structuredContent.attempt.readback_verified,false);
  await f.tool('review_fm1_stock_recovery',{job_id:'c'.repeat(32)});
  assert.deepEqual(f.updateCalls.map(call=>call.method),['beginUpload','appendUpload','review','start','reviewResume']);assert.deepEqual(f.calls,[]);
});

test('missing native writer capability fails closed and shutdown still closes MIDI if writer cleanup fails',async t=>{
  const absent=await fixture(t,{updates:false}),opened=await absent.tool('open_fm1_library');assert.equal(opened.structuredContent.desktop.stockUpdateAvailable,false);
  assert.deepEqual((await absent.tool('get_fm1_stock_update_status')).structuredContent,{supported:false,writing:false,attempt:null,review:null});
  await refused(absent,'begin_fm1_stock_upload',{raw_bytes:699956});assert.deepEqual(absent.calls,[]);
  const f=await fixture(t);f.stockUpdateService.close=async()=>{throw new Error('Synthetic writer cleanup failure');};await f.server.close().catch(()=>{});assert.equal(f.closeCount,1);
});


test('custom FWSC tools are separately app-only with explicit destructive confirmation and bounded input',async t=>{
  const f=await fixture(t),tools=(await f.client.listTools()).tools;
  for(const name of ['begin_fm1_custom_upload','append_fm1_custom_upload','review_fm1_custom_update','review_fm1_custom_recovery','review_fm1_custom_loader_entry','start_fm1_custom_update','verify_fm1_custom_boot']){
    const tool=tools.find(value=>value.name===name);assert.deepEqual(tool._meta.ui.visibility,['app']);assert.equal(tool.annotations.readOnlyHint,false);assert.equal(tool.annotations.destructiveHint,name==='start_fm1_custom_update');
  }
  assert.deepEqual(f.customCalls,[]);await f.tool('get_fm1_custom_update_status');assert.deepEqual(f.customCalls,[{method:'status'}]);assert.deepEqual(f.calls,[]);
  for(const [name,args] of [['begin_fm1_custom_upload',{raw_bytes:2097153,manifest:{}}],['begin_fm1_custom_upload',{raw_bytes:623156}],['begin_fm1_custom_upload',{raw_bytes:623156,manifest:{},path:'C:/private'}],['append_fm1_custom_upload',{upload_id:'a'.repeat(32),offset:0,data_base64:'A'.repeat(87388)}],['start_fm1_custom_update',{review_id:'b'.repeat(32),confirmed:false}],['start_fm1_custom_update',{review_id:'b'.repeat(32),confirmed:true,skip_review:true}],['review_fm1_custom_recovery',{job_id:'../private'}]])await refused(f,name,args);
  assert.equal(f.customCalls.length,1);assert.deepEqual(f.calls,[]);assert.deepEqual(f.updateCalls,[]);
});

test('custom review/start dispatch remains bound to the separate service and missing capability fails closed',async t=>{
  const f=await fixture(t);await f.tool('begin_fm1_custom_upload',{raw_bytes:623156,manifest:{policy_version:'customfwsc-v1'}});await f.tool('append_fm1_custom_upload',{upload_id:'a'.repeat(32),offset:0,data_base64:'AAAA'});
  const reviewed=await f.tool('review_fm1_custom_update',{upload_id:'a'.repeat(32)});assert.equal(reviewed.structuredContent.review.expected_boot_identity,'FM1_FORGE_001');
  const started=await f.tool('start_fm1_custom_update',{review_id:'b'.repeat(32),confirmed:true});assert.equal(started.structuredContent.attempt.boot_build_verified,false);assert.equal(started.structuredContent.attempt.observed_build_sha256,null);
  await f.tool('review_fm1_custom_recovery',{job_id:'c'.repeat(32)});assert.deepEqual(f.customCalls.map(value=>value.method),['beginUpload','appendUpload','review','start','reviewResume']);assert.deepEqual(f.updateCalls,[]);assert.deepEqual(f.calls,[]);
  const absent=await fixture(t,{custom:false});assert.equal((await absent.tool('open_fm1_library')).structuredContent.desktop.customUpdateAvailable,false);await refused(absent,'begin_fm1_custom_upload',{raw_bytes:623156,manifest:{}});assert.deepEqual(absent.calls,[]);
});

test('original loader preparation is app-only, bounded to a job and never dispatched as a write',async t=>{
  const f=await fixture(t);
  for(const args of [{job_id:'../unsafe'},{job_id:'c'.repeat(32),confirmed:true},{job_id:'c'.repeat(32),image:'arbitrary'}])await refused(f,'review_fm1_custom_loader_entry',args);
  assert.deepEqual(f.customCalls,[]);
  const result=await f.tool('review_fm1_custom_loader_entry',{job_id:'c'.repeat(32)});
  assert.equal(result.structuredContent.review.operation,'loader-entry');
  assert.deepEqual(f.customCalls,[{method:'reviewLoaderEntry',args:{job_id:'c'.repeat(32)}}]);
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.updateCalls,[]);
  const absent=await fixture(t,{custom:false});await refused(absent,'review_fm1_custom_loader_entry',{job_id:'c'.repeat(32)});
});

test('macOS editions advertise actual platform, native resource and passive tools for Apple Silicon and Intel',async t=>{
  for(const arch of ['arm64','x64']){
    const f=await fixture(t,{platform:'darwin',arch});
    assert.equal(f.client.getServerVersion().name,'FM-1 Forge macOS');
    const answer=(await f.tool('open_fm1_library')).structuredContent;
    assert.equal(answer.desktop.platform,'darwin');assert.equal(answer.desktop.protocolVersion,2);
    assert.deepEqual(answer.desktop.supportedTransports,transports);assert.equal(answer.desktop.stockUpdateAvailable,true);assert.equal(answer.desktop.customUpdateAvailable,true);
    assert.match(answer.forge.gate.message,/in the macOS panel/);
    const tools=(await f.client.listTools()).tools;
    assert.equal(tools.find(value=>value.name==='open_fm1_library').title,'FM-1 Forge macOS');
    for(const name of ['open_fm1_library','review_fm1_stock_update','review_fm1_custom_update'])assert.equal(tools.find(value=>value.name===name)._meta.ui.resourceUri,'ui://fm1/forge-macos-v1.html');
    const resource=await f.client.readResource({uri:'ui://fm1/forge-macos-v1.html'});assert.match(resource.contents[0].text,/const desktopMode=true/);
    const configured=(await f.tool('configure_fm1_project')).structuredContent;assert.match(configured.message,/this macOS panel/);
    assert.deepEqual(f.calls,[]);assert.deepEqual(f.updateCalls,[]);assert.deepEqual(f.customCalls,[]);
  }
});

test('unsupported platform injection is rejected before creating local stores or MIDI services',async()=>{
  await assert.rejects(serverModule.createDesktopServer({platform:'linux',arch:'x64',uiHtml:panel}),{code:'unsupported_desktop_platform'});
  await assert.rejects(serverModule.createDesktopServer({platform:'darwin',arch:'ia32',uiHtml:panel}),{code:'unsupported_desktop_platform'});
});
