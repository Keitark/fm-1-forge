import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { handleFm1Request } from '../lib/fm1-server.mjs';
import { RESOURCE_URI } from '../lib/fm1-contract.mjs';
import { database, connect, cacheInventory, digest } from './d1.mjs';

for(const [era,revision] of [['modern','2026-07-28'],['legacy','2025-11-25']]){
  test('real SDK '+era+' client discovers and uses the same private FM1 plugin',async()=>{
    const env=database(),requests=[];
    const client=new Client({name:'FM1 compatibility test',version:'2.0.0'},{capabilities:{},
      versionNegotiation:{mode:era==='modern'?{pin:revision}:'legacy'},supportedProtocolVersions:[revision]});
    const transport=new StreamableHTTPClientTransport(new URL('https://fm1.test/mcp'),{
      requestInit:{headers:{'oai-authenticated-user-id':'alice'}},
      fetch:async(input,init)=>{const request=new Request(input,init);if(request.method==='POST')requests.push(await request.clone().json());return handleFm1Request(request,env);},
    });
    try{
      await client.connect(transport);
      assert.equal(client.getProtocolEra(),era);
      assert.equal(client.getNegotiatedProtocolVersion(),revision);
      const tools=await client.listTools();
      assert.equal(tools.tools.length,19);
      const panel=tools.tools.find(tool=>tool.name==='open_fm1_library');
      assert.equal(RESOURCE_URI,'ui://fm1/forge-panel-v8.html');
      assert.equal(panel._meta.ui.resourceUri,RESOURCE_URI);
      const boundTools=tools.tools.filter(tool=>tool._meta?.ui?.resourceUri);
      assert.deepEqual(boundTools.map(tool=>tool.name).sort(),['configure_fm1_project','open_fm1_library','open_fm1_project']);
      assert.ok(boundTools.every(tool=>tool._meta.ui.resourceUri===RESOURCE_URI));
      assert.deepEqual(panel._meta['openai/ui'].entrypoints.map(item=>item.type),['global','thread']);
      assert.equal(panel._meta['openai/ui'].entrypoints[0].quickAction.target.name,'configure_fm1_project');
      assert.deepEqual(tools.tools.find(tool=>tool.name==='confirm_fm1_switch')._meta.ui.visibility,['app']);
      assert.deepEqual(tools.tools.find(tool=>tool.name==='confirm_fm1_official_update')._meta.ui.visibility,['app']);
      const localImport=tools.tools.find(tool=>tool.name==='open_fm1_local_import');
      assert.deepEqual(localImport._meta.ui.visibility,['app']);
      assert.equal(localImport.annotations.readOnlyHint,false);
      assert.equal(localImport.annotations.destructiveHint,false);
      assert.deepEqual(localImport.inputSchema.properties,{});
      const resource=await client.readResource({uri:RESOURCE_URI});
      assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');
      assert.match(resource.contents[0].text,/FM1PluginHost/);
      for(const uri of ['ui://fm1/forge-panel-v7.html','ui://fm1/forge-panel-v6.html','ui://fm1/forge-panel-v5.html','ui://fm1/forge-panel-v4.html','ui://fm1/forge-panel-v3.html','ui://fm1/forge-panel-v2.html','ui://fm1/forge-panel-v1.html','ui://fm1/app-library-v1.html','ui://fm1/device-panel-v2.html','ui://fm1/device-panel-v3.html','ui://fm1/device-panel-v4.html','ui://fm1/device-panel-v5.html','ui://fm1/device-panel-v6.html']){
        const previous=await client.readResource({uri});
        assert.deepEqual(previous.contents,[{...resource.contents[0],uri}]);
      }
      const library=await client.callTool({name:'open_fm1_library',arguments:{}});
      assert.equal(library.structuredContent.profiles.length,6);
      assert.equal(library.structuredContent.relay.connected,false);
      assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM relay_tasks').get().n,0);
      const invalid=await client.callTool({name:'plan_fm1_app',arguments:{catalog_id:'../bad'}});
      assert.equal(invalid.isError,true);
      assert.equal(env.DB.sqlite.prepare('SELECT count(*) AS n FROM relay_tasks').get().n,0);
      assert.equal(requests.some(r=>r.method==='server/discover'),era==='modern');
      assert.equal(requests.some(r=>r.method==='initialize'),era==='legacy');
      connect(env,false,true);
      const importer=await client.callTool({name:'open_fm1_local_import',arguments:{}});
      assert.match(importer.structuredContent.request_id,/^[a-f0-9]{32}$/);
      assert.equal(importer.structuredContent.delivery,'pending');
      assert.equal(importer.structuredContent.job_id,undefined);
      const launch=env.DB.sqlite.prepare("SELECT * FROM relay_tasks WHERE operation='open_local_import'").get();
      assert.equal(launch.id,importer.structuredContent.request_id);
      assert.equal(launch.arguments,'{}');
      const unsafeImporter=await client.callTool({name:'open_fm1_local_import',arguments:{path:'F:\\private'}});
      assert.equal(unsafeImporter.isError,true);
      assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='open_local_import'").get().n,1);
      cacheInventory(env,'alice',{device:{official_update:{configured:true,available:true,sha256:digest},
        update_mode:{mode:'sysex',app_entry_method:null,official_available:true}}});
      const review=await client.callTool({name:'prepare_fm1_official_update',arguments:{}});
      assert.match(review._meta.approval_id,/^[a-f0-9]{32}$/);
      assert.equal(review.structuredContent.review.sha256,digest);
      assert.ok(!JSON.stringify(review.content).includes(review._meta.approval_id));
      assert.ok(!JSON.stringify(review.structuredContent).includes(review._meta.approval_id));
      assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM relay_tasks WHERE operation='official_updater'").get().n,0);
    }finally{await client.close();}
  });
}

const meta=(revision='2026-07-28')=>({
  'io.modelcontextprotocol/protocolVersion':revision,
  'io.modelcontextprotocol/clientCapabilities':{},
  'io.modelcontextprotocol/clientInfo':{name:'FM1 wire test',version:'2.0.0'},
});
async function modern(method,params={},extraHeaders={}){
  const response=await handleFm1Request(new Request('https://fm1.test/mcp',{method:'POST',
    headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',
      'MCP-Protocol-Version':params._meta?.['io.modelcontextprotocol/protocolVersion']||'2026-07-28',
      'Mcp-Method':method,...(params.name?{'Mcp-Name':params.name}:{}),...extraHeaders},
    body:JSON.stringify({jsonrpc:'2.0',id:8,method,params}),
  }),database());
  return {status:response.status,value:await response.json(),headers:response.headers};
}
test('modern discovery has typed result, identity and private cache semantics',async()=>{
  const {status,value}=await modern('server/discover',{_meta:meta()});
  assert.equal(status,200);assert.equal(value.result.resultType,'complete');
  assert.ok(value.result.supportedVersions.includes('2026-07-28'));
  assert.equal(value.result._meta['io.modelcontextprotocol/serverInfo'].version,'3.1.4');
  assert.equal(value.result.ttlMs,0);assert.equal(value.result.cacheScope,'private');
});
test('modern missing envelope, unsupported revision and mismatched routing header reject before work',async()=>{
  const missing=await modern('server/discover',{});assert.equal(missing.status,400);assert.equal(missing.value.error.code,-32602);
  const version=await modern('server/discover',{_meta:meta('2099-01-01')});assert.equal(version.status,400);assert.equal(version.value.error.code,-32022);
  const route=await modern('server/discover',{_meta:meta()},{'Mcp-Method':'tools/list'});assert.equal(route.status,400);assert.equal(route.value.error.code,-32020);
});
