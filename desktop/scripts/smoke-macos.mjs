// Passive package acceptance only: never enumerate, open or write a MIDI device.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from '../../site/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import {StdioClientTransport} from '../../site/node_modules/@modelcontextprotocol/client/dist/stdio.mjs';

const [rootArg,arch,...extra]=process.argv.slice(2);
assert.ok(rootArg&&path.isAbsolute(rootArg)&&['arm64','x64'].includes(arch)&&extra.length===0,'Pass an absolute macOS package root and architecture');
assert.equal(process.platform,'darwin');assert.equal(process.arch,arch);
const root=await fs.realpath(rootArg), sha=data=>createHash('sha256').update(data).digest('hex');
const manifest=JSON.parse(await fs.readFile(path.join(root,'BUILD-MANIFEST.json'),'utf8'));
assert.equal(manifest.platform,'darwin');assert.equal(manifest.arch,arch);
for(const file of manifest.files){
  const name=path.resolve(root,file.path);assert.ok(name.startsWith(root+path.sep));
  const data=await fs.readFile(name);assert.equal(sha(data),file.sha256);assert.equal(data.length,file.bytes);if(Number.isInteger(file.mode))assert.equal((await fs.stat(name)).mode&0o777,file.mode);
}
const node=path.join(root,'runtime',`darwin-${arch}`,'node');
assert.ok((await fs.stat(node)).mode&0o111,'Bundled Node must remain executable');
const temp=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'forge-macos-smoke-'));
const checks=[];
for(const revision of ['2026-07-28','2025-11-25','2024-11-05']){
  const data=path.join(temp,revision);await fs.mkdir(data);
  const transport=new StdioClientTransport({command:node,args:[path.join(root,'server/index.mjs')],cwd:root,env:{PATH:'',HOME:os.homedir(),PLUGIN_DATA:data,TMPDIR:data,TEMP:data,TMP:data},stderr:'pipe'});
  const client=new Client({name:'Forge macOS passive acceptance',version:'1'},{capabilities:{},supportedProtocolVersions:[revision],versionNegotiation:{mode:revision==='2026-07-28'?{pin:revision}:'legacy'}});
  try{
    await client.connect(transport);assert.equal(client.getServerVersion().name,'FM-1 Forge macOS');assert.equal(client.getServerVersion().version,manifest.version);
    const tools=(await client.listTools()).tools;assert.equal(tools.length,24);
    for(const name of ['start_fm1_stock_update','start_fm1_custom_update']){const tool=tools.find(item=>item.name===name);assert.deepEqual(tool._meta.ui.visibility,['app']);assert.equal(tool.annotations.destructiveHint,true);}
    const opened=await client.callTool({name:'open_fm1_library',arguments:{}});assert.ok(!opened.isError,JSON.stringify(opened));
    assert.equal(opened.structuredContent.desktop.platform,'darwin');assert.equal(opened.structuredContent.desktop.customUpdateAvailable,true);assert.equal(opened.structuredContent.desktop.installationAvailable,false);
    for(const name of ['get_fm1_stock_update_status','get_fm1_custom_update_status']){const status=await client.callTool({name,arguments:{}});assert.deepEqual(status.structuredContent,{supported:true,writing:false,attempt:null,review:null});}
    const panel=await client.readResource({uri:'ui://fm1/forge-macos-v1.html'});const markup=panel.contents[0].text.split('<script>')[0];
    assert.ok(panel.contents[0].text.includes("const desktopPlatform='darwin';"));assert.ok(panel.contents[0].text.includes('const desktopMode=true;'));assert.ok(markup.includes('Custom firmware update · SysEx'));assert.ok(!/id="direct-common(?:-|\")/.test(markup));
    checks.push({revision,tools:tools.length,passive:true,emptyPath:true});
  }finally{await client.close();}
}
const receipt={version:manifest.version,platform:process.platform,arch,verifiedFiles:manifest.files.length+1,checks,deviceOpened:false,firmwareWritten:false,physicalAcceptance:'pending'};
await fs.writeFile(path.join(root,'..','MACOS-VERIFICATION.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(receipt,null,2));