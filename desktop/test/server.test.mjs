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

async function fixture(t){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'fm1-server-contract-data-')),original=await fs.realpath(base),directory=path.join(base,'metadata'),store=createProjectStore({directory}),calls=[];let current=idle(),closed=0;
  const deviceService={
    async connect(args){calls.push({method:'connect',args});current={...idle(),connected:true,transport:args.transport,identity:args.transport==='stock-midi'?'FM-1_015':'FM1_FORGE_001'};return {...current};},
    async getStatus(){calls.push({method:'status'});return {...current};},
    async disconnect(){calls.push({method:'disconnect'});current=idle();return {...current};},
    async close(){calls.push({method:'close'});closed++;current=idle();},
  };
  const server=await serverModule.createDesktopServer({deviceService,uiHtml:panel,store});
  const revision='2025-11-25',client=new Client({name:'FM-1 desktop contract test',version:'1'},{capabilities:{},supportedProtocolVersions:[revision],versionNegotiation:{mode:'legacy'}});
  t.after(async()=>{try{await server.close();await client.close();}finally{assert.equal(await fs.realpath(base),original);assert.ok(path.basename(base).startsWith('fm1-server-contract-data-'));await fs.rm(base,{recursive:true,force:true});}});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();await server.connect(serverTransport);await client.connect(clientTransport);
  return {server,client,store,calls,directory,deviceService,get closeCount(){return closed;},tool:async(name,args={})=>client.callTool({name,arguments:args})};
}
async function refused(f,name,args){
  let response,failure;try{response=await f.tool(name,args);}catch(error){failure=error;}
  assert.ok(failure||response?.isError===true,name+' must reject these arguments');return response??failure;
}

test('official SDK discovery, panel open and resource read are passive over the packaged legacy stdio protocol',async t=>{
    const f=await fixture(t);assert.deepEqual(f.calls,[]);
    const answer=await f.tool('open_fm1_library'),data=answer.structuredContent;
    assert.deepEqual(data.desktop,{platform:'win32',protocolVersion:1,supportedTransports:transports,installationAvailable:false});assert.equal(data.forge.gate.can_start_project,false);assert.deepEqual(data.forge.projects,[]);
    const capabilities=f.client.getServerCapabilities();assert.equal(capabilities.extensions['openai/settings'].readTool,'settings.read');
    const resource=await f.client.readResource({uri:serverModule.RESOURCE_URI});assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');assert.match(resource.contents[0].text,/const desktopMode=true/);assert.deepEqual(f.calls,[]);
});

test('tool discovery exposes only the fixed connection and configuration surface with no flashing or raw MIDI',async t=>{
  const f=await fixture(t),listed=await f.client.listTools(),names=listed.tools.map(tool=>tool.name).sort();
  assert.deepEqual(names,['configure_fm1_project','connect_fm1_device','disconnect_fm1_device','get_fm1_device_status','get_fm1_project','list_fm1_projects','open_fm1_library','open_fm1_project','save_fm1_project','search_mentions','settings.read','settings.update'].sort());
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
  let touched=false;await assert.rejects(serverModule.createDesktopServer({deviceService:{close(){touched=true;}},uiHtml:'<html>wrong panel</html>',store:f.store}),/packaged Windows panel/);assert.equal(touched,false);
});

test('protocol shutdown completes even when native device cleanup reports an error',async t=>{
  const f=await fixture(t);let closeCalls=0,protocolClosed=false;
  f.deviceService.close=async()=>{closeCalls++;throw new Error('Synthetic native close failure');};f.client.onclose=()=>{protocolClosed=true;};
  await f.server.close().catch(()=>{});assert.equal(protocolClosed,true);await f.server.close().catch(()=>{});assert.equal(closeCalls,1);
});
