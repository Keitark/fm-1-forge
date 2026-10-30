// Builds an installable local marketplace around a verified macOS package.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const [arg,...extra]=process.argv.slice(2);assert.ok(arg&&path.isAbsolute(arg)&&extra.length===0,'Pass the absolute marketplace root');
const root=await fs.realpath(arg),plugin=path.join(root,'fm1-app-library');
const manifest=JSON.parse(await fs.readFile(path.join(plugin,'BUILD-MANIFEST.json'),'utf8'));
assert.equal(manifest.platform,'darwin');assert.ok(['arm64','x64'].includes(manifest.arch));
const config=JSON.parse(await fs.readFile(path.join(plugin,'mcp.json'),'utf8'));assert.deepEqual(Object.keys(config.mcpServers),['fm1-forge-macos']);
const folder=path.join(root,'.agents','plugins');await fs.mkdir(folder,{recursive:true});
const catalog={name:'fm1-forge-macos',interface:{displayName:'FM-1 Forge macOS'},plugins:[{name:'fm1-app-library',source:{source:'local',path:'./fm1-app-library'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]};
await fs.writeFile(path.join(folder,'marketplace.json'),JSON.stringify(catalog,null,2)+'\n',{flag:'wx'});