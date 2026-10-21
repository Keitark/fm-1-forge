// One local/Git marketplace entry for the verified universal desktop plugin.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const [arg,...extra]=process.argv.slice(2);
assert.ok(arg&&path.isAbsolute(arg)&&extra.length===0,'Pass the absolute marketplace root');
const root=await fs.realpath(arg),plugin=path.join(root,'fm1-app-library');
const manifest=JSON.parse(await fs.readFile(path.join(plugin,'BUILD-MANIFEST.json'),'utf8'));
assert.equal(manifest.format,'fm1-forge-universal-package-v1');
assert.deepEqual([...manifest.expectedTargets].sort(),['darwin-arm64','darwin-x64','win32-x64']);
const config=JSON.parse(await fs.readFile(path.join(plugin,'mcp.json'),'utf8'));
assert.deepEqual(Object.keys(config.mcpServers),['fm1-forge']);
assert.equal(config.mcpServers['fm1-forge'].command,'./runtime/node');
const folder=path.join(root,'.agents','plugins');
await fs.mkdir(folder,{recursive:true});
const catalog={name:'fm1-forge',interface:{displayName:'FM-1 Forge'},plugins:[{name:'fm1-app-library',source:{source:'local',path:'./fm1-app-library'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]};
await fs.writeFile(path.join(folder,'marketplace.json'),JSON.stringify(catalog,null,2)+'\n',{flag:'wx'});
// Git clones on Windows must preserve hashes, including every bundled text file.
await fs.writeFile(path.join(root,'.gitattributes'),'* -text\n',{flag:'wx'});

await fs.writeFile(path.join(root,'README.md'),await fs.readFile(new URL('../../docs/DESKTOP.md',import.meta.url)),{flag:'wx'});
