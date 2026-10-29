// Native package acceptance only: never enumerate, connect, reset or write an FM-1.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { Client } from '../../site/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import { StdioClientTransport } from '../../site/node_modules/@modelcontextprotocol/client/dist/stdio.mjs';

const argv=process.argv.slice(2), rootArg=argv[0]==='--marketplace'?argv[1]:argv[0];
assert.ok(rootArg&&path.isAbsolute(rootArg)&&argv.length===(argv[0]==='--marketplace'?2:1),'Pass an absolute unified marketplace root');
const target=`${process.platform}-${process.arch}`, targets=['win32-x64','darwin-arm64','darwin-x64'];
assert.ok(targets.includes(target),'Acceptance requires Windows x64 or native macOS arm64/x64');
const marketplace=await fs.realpath(rootArg), root=await fs.realpath(path.join(marketplace,'fm1-app-library'));
assert.equal(path.dirname(root),marketplace,'The plugin must be contained in the marketplace');
const manifest=JSON.parse(await fs.readFile(path.join(root,'BUILD-MANIFEST.json'),'utf8'));
assert.equal(manifest.format,'fm1-forge-universal-package-v1');
assert.deepEqual(manifest.targets,targets);assert.equal(manifest.version,'3.4.0-alpha.14');
assert.deepEqual(manifest.nativeInputs.map(input=>input.target).sort(),[...targets].sort());
const hash=data=>createHash('sha256').update(data).digest('hex');
const maximumGitFileBytes=100*1024*1024;
assert.ok((await fs.stat(path.join(root,'BUILD-MANIFEST.json'))).size<maximumGitFileBytes,'The outer manifest must fit GitHub ordinary Git');
const safeRelative=name=>typeof name==='string'&&name.length>0&&!name.includes('\\')&&!/[\u0000-\u001f\u007f:]/.test(name)&&!name.startsWith('/')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
async function tree(directory,relative=''){
  const output=[];
  for(const entry of await fs.readdir(path.join(directory,relative),{withFileTypes:true})){
    const name=relative?`${relative}/${entry.name}`:entry.name;assert.ok(safeRelative(name),'Unsafe package path');
    const stat=await fs.lstat(path.join(directory,name));assert.equal(stat.isSymbolicLink(),false,'Package symlinks are unsupported');
    if(stat.isDirectory())output.push(...await tree(directory,name));else{assert.ok(stat.isFile(),'Package contains a special file');output.push(name);}
  }
  return output;
}
async function verifyFiles(directory){
  const expected=new Set(['BUILD-MANIFEST.json']);
  for(const record of manifest.files){
    assert.ok(safeRelative(record.path),'Unsafe manifest file path');assert.ok(!expected.has(record.path),'Duplicate manifest file path');expected.add(record.path);
    assert.ok(Number.isInteger(record.mode)&&record.mode>=0&&record.mode<=0o777,'Missing package file mode');
    assert.ok(Number.isSafeInteger(record.bytes)&&record.bytes>=0&&record.bytes<maximumGitFileBytes,`Package file exceeds GitHub ordinary Git limit: ${record.path}`);
    const filename=path.join(directory,record.path),data=await fs.readFile(filename),stat=await fs.lstat(filename);
    assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'Manifest file must be a regular file');
    assert.equal(data.length,record.bytes,`Package byte count: ${record.path}`);assert.equal(hash(data),record.sha256,`Package SHA-256: ${record.path}`);
    if(process.platform==='darwin')assert.equal(stat.mode&0o777,record.mode,`Package POSIX mode: ${record.path}`);
  }
  assert.deepEqual((await tree(directory)).sort(),[...expected].sort(),'The complete package file set must match its manifest');
  assert.equal(hash(await fs.readFile(path.join(directory,'BUILD-MANIFEST.json'))),hash(await fs.readFile(path.join(root,'BUILD-MANIFEST.json'))),'Installed manifest changed');
}
await verifyFiles(root);
const nativeManifests=new Map();
for(const input of manifest.nativeInputs){
  assert.equal(input.path,`payloads/${input.target}`);
  const bytes=await fs.readFile(path.join(root,input.path,'BUILD-MANIFEST.json'));assert.equal(hash(bytes),input.manifestSha256);
  const native=JSON.parse(bytes);assert.equal(`${native.platform}-${native.arch}`,input.target);assert.equal(native.version,manifest.version);
  assert.equal(native.nativeLoadCheck.loaded,true);assert.equal(native.nativeLoadCheck.enumeratedPorts,false);assert.equal(native.nativeLoadCheck.openedDevice,false);
  assert.equal(input.runtimeSha256,native.runtime.sha256);nativeManifests.set(input.target,native);
}
// macOS Node distributions exceed GitHub's ordinary Git file limit. Verify the
// gzip representation against the unchanged, natively tested raw runtime receipt.
const archivedTargets=['darwin-arm64','darwin-x64'];
assert.ok(Array.isArray(manifest.runtimeArchives),'Missing compressed runtime receipts');
assert.deepEqual(manifest.runtimeArchives.map(archive=>archive.target).sort(),archivedTargets);
const outerFiles=new Map(manifest.files.map(record=>[record.path,record]));
for(const archive of manifest.runtimeArchives){
  const rawPath=`runtime/${archive.target}/node`,prefix=`payloads/${archive.target}/`;
  assert.equal(archive.path,`${prefix}${rawPath}.gz`);
  const native=nativeManifests.get(archive.target),raw=native.files.find(record=>record.path===rawPath);
  assert.ok(raw,'Missing immutable native runtime file receipt');assert.equal(raw.mode,0o755);
  assert.equal(archive.rawBytes,raw.bytes);assert.equal(archive.rawSha256,raw.sha256);assert.equal(archive.rawSha256,native.runtime.sha256);
  assert.ok(Number.isSafeInteger(archive.rawBytes)&&archive.rawBytes>0&&archive.rawBytes<=200*1024*1024,'Unexpected raw Node runtime size');
  const packed=outerFiles.get(archive.path),digestFile=outerFiles.get(`${prefix}${rawPath}.sha256`);
  assert.ok(packed&&digestFile,'Missing packaged compressed runtime files');
  assert.equal(packed.bytes,archive.bytes);assert.equal(packed.sha256,archive.sha256);assert.equal(packed.mode,0o644);assert.equal(digestFile.mode,0o644);
  assert.equal(outerFiles.has(`${prefix}${rawPath}`),false,'Raw macOS Node must not be stored in the Git package');
  await assert.rejects(fs.lstat(path.join(root,prefix,rawPath)),{code:'ENOENT'},'Raw macOS Node must be absent');
  assert.equal(await fs.readFile(path.join(root,prefix,`${rawPath}.sha256`),'utf8'),`${archive.rawSha256}\n`);
  const bytes=await fs.readFile(path.join(root,archive.path));assert.equal(hash(bytes),archive.sha256);
  const decoded=gunzipSync(bytes,{maxOutputLength:archive.rawBytes});assert.equal(decoded.length,archive.rawBytes);assert.equal(hash(decoded),archive.rawSha256);
}
for(const filename of ['mcp.json','.mcp.json']){
  const config=JSON.parse(await fs.readFile(path.join(root,filename),'utf8'));
  assert.deepEqual(Object.keys(config.mcpServers),['fm1-forge']);
  assert.deepEqual(config.mcpServers['fm1-forge'],{type:'stdio',command:'./runtime/node',args:['${PLUGIN_ROOT}/start.mjs'],cwd:'${PLUGIN_ROOT}'});
}
const catalog=JSON.parse(await fs.readFile(path.join(marketplace,'.agents/plugins/marketplace.json'),'utf8'));
assert.equal(catalog.name,'fm1-forge');assert.equal(catalog.plugins.length,1);assert.equal(catalog.plugins[0].name,'fm1-app-library');
const temporary=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),`forge-universal-${target}-`));
const node=path.join(root,'runtime',process.platform==='win32'?'node.exe':'node');
if(process.platform==='darwin')assert.ok((await fs.stat(node)).mode&0o111,'The POSIX runtime launcher must remain executable');
const environment={...process.env,CODEX_HOME:path.join(temporary,'codex-home'),HOME:path.join(temporary,'home'),USERPROFILE:path.join(temporary,'home'),PLUGIN_DATA:path.join(temporary,'codex-data'),TMPDIR:temporary,TEMP:temporary,TMP:temporary};
for(const name of Object.keys(environment))if(/^(?:OPENAI|CODEX|CHATGPT)_.*(?:KEY|TOKEN|SECRET|PASSWORD)$/i.test(name))delete environment[name];
for(const directory of ['codex-home','home','codex-data'])await fs.mkdir(path.join(temporary,directory));
function run(command,args,{env=environment,cwd=root,timeout=120000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Passive acceptance command timed out'));},timeout);timer.unref();
    child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error(`Passive command ${args[0]} failed (${code}): ${stderr.slice(-2000)}`));else resolve(stdout.trim());});
  });
}
const selectedBundle=path.join(root,'payloads',target);
const nativeProbe=`import {createRequire} from 'node:module';const midi=createRequire(${JSON.stringify(pathToFileURL(path.join(selectedBundle,'server/index.mjs')).href)})('@julusian/midi');if(typeof midi.Input!=='function'||typeof midi.Output!=='function')throw new Error('Missing native MIDI exports');console.log(JSON.stringify({platform:process.platform,arch:process.arch,loaded:true,enumeratedPorts:false,openedDevice:false}));`;
const nativeAddon=JSON.parse(await run(node,['--input-type=module','--eval',nativeProbe]));
assert.deepEqual(nativeAddon,{platform:process.platform,arch:process.arch,loaded:true,enumeratedPorts:false,openedDevice:false});

const expectedName=process.platform==='darwin'?'FM-1 Forge macOS':'FM-1 Forge Windows';
const resourceUri=process.platform==='darwin'?'ui://fm1/forge-macos-v1.html':'ui://fm1/forge-windows-v7.html';
const checks=[];
for(const revision of ['2026-07-28','2025-11-25','2024-11-05']){
  const data=path.join(temporary,revision);await fs.mkdir(data);
  const transport=new StdioClientTransport({command:node,args:[path.join(root,'start.mjs')],cwd:root,env:{...environment,PATH:'',PLUGIN_DATA:data,TMPDIR:data,TEMP:data,TMP:data},stderr:'pipe'});
  const client=new Client({name:'Forge universal passive acceptance',version:'1'},{capabilities:{},supportedProtocolVersions:[revision],versionNegotiation:{mode:revision==='2026-07-28'?{pin:revision}:'legacy'}});
  try{
    await client.connect(transport);assert.equal(client.getServerVersion().name,expectedName);assert.equal(client.getServerVersion().version,manifest.version);
    const tools=(await client.listTools()).tools;assert.equal(tools.length,26);assert.equal(new Set(tools.map(tool=>tool.name)).size,26);
    for(const name of ['start_fm1_stock_update','start_fm1_custom_update']){const tool=tools.find(item=>item.name===name);assert.deepEqual(tool._meta.ui.visibility,['app']);assert.equal(tool.annotations.destructiveHint,true);}
    const opened=await client.callTool({name:'open_fm1_library',arguments:{}});assert.ok(!opened.isError,'Passive library call failed');
    assert.equal(opened.structuredContent.desktop.platform,process.platform);assert.equal(opened.structuredContent.desktop.customUpdateAvailable,true);assert.equal(opened.structuredContent.desktop.installationAvailable,false);
    for(const name of ['get_fm1_stock_update_status','get_fm1_custom_update_status']){const status=await client.callTool({name,arguments:{}});assert.deepEqual(status.structuredContent,{supported:true,writing:false,attempt:null,review:null});}
    const panel=await client.readResource({uri:resourceUri});const html=panel.contents[0].text,markup=html.split('<script>')[0];
    assert.ok(html.includes(`const desktopPlatform='${process.platform}';`));assert.ok(html.includes('const desktopMode=true;'));
    assert.ok(markup.includes('Custom firmware update · SysEx'));assert.ok(!/id="direct-common(?:-|\")/.test(markup));
    checks.push({revision,tools:tools.length,passive:true,emptyPath:true,selectedTarget:target});
  }finally{await client.close();}
}

// Exercise the real Codex plugin installer in a fresh home, never the user's home.
assert.ok(process.env.CODEX_CLI_PATH&&path.isAbsolute(process.env.CODEX_CLI_PATH),'Set CODEX_CLI_PATH to the actual native Codex executable');
const codex=await fs.realpath(process.env.CODEX_CLI_PATH),codexVersion=await run(codex,['--version']);
assert.match(codexVersion,/0\.162\.1\b/,'Acceptance pins the native Codex CLI');
const added=JSON.parse(await run(codex,['plugin','marketplace','add',marketplace,'--json']));assert.equal(added.marketplaceName,'fm1-forge');
const installed=JSON.parse(await run(codex,['plugin','add','fm1-app-library@fm1-forge','--json']));
assert.equal(installed.pluginId,'fm1-app-library@fm1-forge');assert.equal(installed.version,manifest.version);
const installedRoot=await fs.realpath(installed.installedPath),relativeInstalled=path.relative(environment.CODEX_HOME,installedRoot);
assert.ok(relativeInstalled&&!path.isAbsolute(relativeInstalled)&&!relativeInstalled.split(path.sep).includes('..'),'Codex must install inside its isolated home');
await verifyFiles(installedRoot);
const listed=JSON.parse(await run(codex,['plugin','list','--json']));
assert.equal(listed.installed.length,1);assert.equal(listed.installed[0].pluginId,installed.pluginId);assert.equal(listed.installed[0].enabled,true);

async function codexStatus(){
  const child=spawn(codex,['app-server','--stdio'],{cwd:installedRoot,env:environment,stdio:['pipe','pipe','pipe'],windowsHide:true});
  const pending=new Map();let id=0,stderr='';const lines=readline.createInterface({input:child.stdout});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const rejectPending=error=>{for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(error);}pending.clear();};
  child.on('error',rejectPending);child.stdin.on('error',rejectPending);child.on('exit',code=>rejectPending(new Error(`Codex app-server exited during passive acceptance (${code})`)));
  lines.on('line',line=>{let message;try{message=JSON.parse(line);}catch{return;}const waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);clearTimeout(waiter.timer);if(message.error)waiter.reject(new Error(`Codex ${waiter.method} failed: ${JSON.stringify(message.error)}`));else waiter.resolve(message.result);});
  const request=(method,params)=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(new Error(`Codex ${method} timed out: ${stderr.slice(-2000)}`));},60000);timer.unref();pending.set(key,{resolve,reject,timer,method});child.stdin.write(JSON.stringify({id:key,method,params})+'\n');});
  try{
    const initialized=await request('initialize',{clientInfo:{name:'forge-universal-passive-acceptance',version:'1.0.0'},capabilities:{experimentalApi:true}});
    assert.ok(initialized.userAgent);child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    const status=await request('mcpServerStatus/list',{});assert.equal(status.nextCursor,null);assert.equal(status.data.length,1,'One plugin installation must load one MCP server');
    const server=status.data[0];assert.equal(server.name,'fm1-forge');assert.equal(server.pluginId,installed.pluginId);assert.equal(server.serverInfo.name,expectedName);assert.equal(server.serverInfo.version,manifest.version);assert.equal(server.toolsError,null);assert.equal(Object.keys(server.tools).length,25);
    assert.ok(server.tools.open_fm1_library,'Codex must load native Forge tools');
    return {version:codexVersion,marketplace:'fm1-forge',pluginId:installed.pluginId,installedPlugins:listed.installed.length,serverName:server.name,serverInfo:server.serverInfo.name,selectedTarget:target,tools:Object.keys(server.tools).length,commonManifestLauncher:true,isolatedHome:true,modelRequested:false,deviceOpened:false};
  }finally{
    lines.close();child.stdin.end();
    if(child.exitCode===null&&child.signalCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},5000);timer.unref();})]);
    rejectPending(new Error('Passive acceptance finished'));
  }
}
const codexInstallation=await codexStatus();
await verifyFiles(installedRoot);await verifyFiles(root);
const receipt={format:'fm1-forge-universal-verification-v1',version:manifest.version,platform:process.platform,arch:process.arch,selectedTarget:target,verifiedFiles:manifest.files.length+1,posixModesVerified:process.platform==='darwin',runtimeArchivesVerified:manifest.runtimeArchives.length,runtimeExtractionVerified:process.platform==='darwin',nativeAddon,checks,codexInstallation,enumeratedPorts:false,deviceOpened:false,firmwareWritten:false,physicalAcceptance:'pending'};
await fs.writeFile(path.join(marketplace,`UNIVERSAL-VERIFICATION-${target}.json`),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(receipt,null,2));
