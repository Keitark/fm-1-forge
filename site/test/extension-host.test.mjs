import test from 'node:test';
import assert from 'node:assert/strict';
import { FM1PluginHost } from '../lib/fm1-app-host.mjs';
import {parseForgeRoute,validateLocalPath,decodeResourceContent,createResourceEditor,RESOURCE_TEXT_LIMIT} from '../lib/fm1-extension-host.mjs';
import {projectConfig,projectPrompt} from '../lib/fm1-forge-project.mjs';

const config=projectConfig({slug:'test-project',displayName:'Test Project',clockPreset:'sdk-default',clockOptIn:false,lcdPreset:'stock-dma',module:'user',usbAudio:true});
const text=JSON.stringify(config),uri='host-resource:opaque-file-id';
const content=(value=text,extra={})=>({contents:[{uri,text:value,mimeType:'application/json',openaiMetadata:{etag:'a',writable:true},...extra}]});
function host(capabilities={},context={}){const value=new FM1PluginHost();value.app.getHostCapabilities=()=>capabilities;value.app.getHostContext=()=>context;value.app.close=async()=>{};return value;}
function resourceFixture(){let update;const calls=[],resources={addUpdateHandler(fn){update=fn;return ()=>calls.push({operation:'remove'});},async read(params){calls.push({operation:'read',...params});return content();},async subscribe(params){calls.push({operation:'subscribe',...params});return {};},async unsubscribe(params){calls.push({operation:'unsubscribe',...params});return {};},async write(uri,data){calls.push({operation:'write',uri,...data});return {outcome:'saved',etag:'b'};}};return {resources,calls,async update(uri){await update({method:'notifications/resources/updated',params:{uri}});}};}

test('official SDK message supports all current/new send/draft choices with exact metadata',async()=>{
  const h=host({experimental:{'openai/message':{}}}),messages=[];h.app.sendMessage=async params=>{messages.push(params);return {};};
  for(const target of ['active','new'])for(const send of [true,false])await h.message('Reviewed project brief',undefined,{target,send});
  assert.equal(messages.length,4);assert.deepEqual(messages.map(m=>m._meta['openai/message']),[{target:'active',send:true},{target:'active',send:false},{target:'new',send:true},{target:'new',send:false}]);h.close();
});
test('core message capability only supports active send and never silently downgrades drafts or new chats',async()=>{
  const h=host({message:{text:{}}}),messages=[];h.app.sendMessage=async params=>{messages.push(params);return {};};await h.message('text');
  for(const params of [{target:'new',send:true},{target:'new',send:false},{target:'active',send:false}])await assert.rejects(h.message('text',undefined,params),/does not support/);
  assert.equal(messages.length,1);assert.ok(!messages[0]._meta);h.close();
});
test('unsupported host does not receive a message, file request, context update, or resource read',async()=>{
  const h=host();h.app.sendMessage=()=>assert.fail('Must not send');h.app.updateModelContext=()=>assert.fail('Must not update');
  await assert.rejects(h.message('text'),/does not support/);await assert.rejects(h.openFile('C:\\project\\forge.json'),/does not support/);await assert.rejects(h.modelContext({}),/does not support/);assert.throws(()=>h.resourceEditor(),/does not support/);h.close();
});
test('host message rejection is visible and closed host blocks subsequent actions',async()=>{
  const h=host({experimental:{'openai/message':{}}});h.app.sendMessage=async()=>({isError:true});await assert.rejects(h.message('text'),/rejected/);h.close();await assert.rejects(h.message('text'),/closed/);assert.throws(()=>h.call('anything',{}),/closed/);
});
test('model context distinguishes unsupported, explicitly cleared, and valid host context metadata',async()=>{
  const ctx={},h=host({experimental:{'openai/modelContext':{}}},ctx);assert.equal(h.state().modelContext,undefined);ctx['openai/modelContext']=null;assert.equal(h.state().modelContext,null);
  ctx['openai/modelContext']={updateId:'context-1',structuredContent:{fm1Forge:{version:1,config}}};assert.equal(h.state().modelContext.updateId,'context-1');
  let sent;h.app.updateModelContext=async params=>{sent=params;return {_meta:{'openai/modelContext':{updateId:'context-2'}}};};const result=await h.modelContext({structuredContent:{fm1Forge:{version:1,config}}});assert.equal(result.updateId,'context-2');assert.deepEqual(sent.structuredContent.fm1Forge.config,config);h.close();
});
test('file entrypoint uses official schema and resource URI remains opaque',()=>{
  const h=host();assert.deepEqual(h.fileInput({file:{name:'test.fm1-forge.json',resourceUri:uri}}),{file:{name:'test.fm1-forge.json',resourceUri:uri}});assert.throws(()=>h.fileInput({file:{name:'test',resourceUri:''}}));assert.throws(()=>h.fileInput({file:{name:'test'}}));h.close();
});
test('local files require user supplied absolute host paths',()=>{
  for(const path of ['C:\\Projects\\forge.json','F:/dev/my-fw/user.c','/workspace/forge.json','\\\\server\\share\\forge.json'])assert.equal(validateLocalPath(path),path);
  for(const path of ['forge.json','file:///C:/forge.json','https://site/forge.json','fm1-forge://projects/id','C:forge.json','C:\\bad\u0000file','//site/path'])assert.throws(()=>validateLocalPath(path),/absolute/);
});
test('deep links allow bounded known project/catalog/job/section routes only',()=>{
  const id='a'.repeat(32);assert.deepEqual(parseForgeRoute('/'),{section:'home'});assert.deepEqual(parseForgeRoute('/projects/'+id),{section:'project',id});assert.deepEqual(parseForgeRoute('/jobs/'+id),{section:'job',id});assert.deepEqual(parseForgeRoute('/catalog/factory-diag'),{section:'catalog',id:'factory-diag'});assert.deepEqual(parseForgeRoute('/section/settings'),{section:'settings'});assert.equal(parseForgeRoute(undefined),undefined);
  for(const value of ['//evil/project/'+id,'https://evil/project/'+id,'/project/wrong','/settings?write=1','/section/flash','/job/'+id+'#run','/catalog/%3Cscript%3E','/../settings','/project/'+id+'/extra'])assert.equal(parseForgeRoute(value),null,value);
});
test('bounded UTF-8 base64 resources decode correctly and binary/overlarge content never reaches editor',()=>{
  const blob=Buffer.from(text+'\n').toString('base64');assert.equal(decodeResourceContent({uri,blob,openaiMetadata:{etag:'x',writable:true}}).text,text+'\n');
  assert.throws(()=>decodeResourceContent({uri,blob:'/w=='}),/binary/);assert.throws(()=>decodeResourceContent({uri,blob:'invalid'}),/invalid base64/);assert.throws(()=>decodeResourceContent({uri,text:'x'.repeat(RESOURCE_TEXT_LIMIT+1)}),/128 KiB/);assert.throws(()=>decodeResourceContent({uri,text:'\u0000'}),/binary/);
});
test('resource session reads exact selected URI, subscribes, uses ETag, and cleans up on close',async()=>{
  const f=resourceFixture(),states=[],editor=createResourceEditor(f.resources,state=>states.push(state));await editor.open(uri,'test.fm1-forge.json');editor.edit(text+'\n');await editor.save(value=>projectPrompt(JSON.parse(value)));assert.equal(editor.state.dirty,false);assert.equal(editor.state.etag,'b');assert.deepEqual(f.calls.find(c=>c.operation==='write'),{operation:'write',uri,text:text+'\n',ifMatch:'a'});editor.close();await Promise.resolve();assert.ok(f.calls.some(c=>c.operation==='unsubscribe'&&c.uri===uri));assert.ok(f.calls.some(c=>c.operation==='remove'));
});
test('resource update reloads clean buffers and preserves dirty buffers without extra read',async()=>{
  const f=resourceFixture(),editor=createResourceEditor(f.resources);await editor.open(uri);await f.update(uri);const cleanReads=f.calls.filter(c=>c.operation==='read').length;editor.edit('my edits');await f.update(uri);assert.equal(editor.state.text,'my edits');assert.equal(editor.state.stale,true);assert.equal(f.calls.filter(c=>c.operation==='read').length,cleanReads);await editor.reload();assert.equal(editor.state.text,text);assert.equal(editor.state.dirty,false);editor.close();
});
test('resource conflicts and host size refusals preserve edited text and original ETag',async()=>{
  for(const outcome of [{outcome:'conflict',etag:'other'},{outcome:'too-large',maxBytes:64}]){const f=resourceFixture();f.resources.write=async()=>outcome;const editor=createResourceEditor(f.resources);await editor.open(uri);editor.edit(text+'\n');assert.deepEqual(await editor.save(()=>{}),outcome);assert.equal(editor.state.text,text+'\n');assert.equal(editor.state.dirty,true);assert.equal(editor.state.etag,'a');assert.ok(editor.state.error);editor.close();}
});
test('read-only or missing ETag resources cannot be overwritten',async()=>{
  for(const metadata of [{writable:false,etag:'a'},{writable:true}]){const f=resourceFixture();f.resources.read=async()=>content(text,{openaiMetadata:metadata});const editor=createResourceEditor(f.resources);await editor.open(uri);editor.edit(text);await assert.rejects(editor.save(()=>{}),/ETag/);assert.ok(!f.calls.some(c=>c.operation==='write'));editor.close();}
});
test('invalid Forge configuration cannot write a host file',async()=>{
  const f=resourceFixture(),editor=createResourceEditor(f.resources);await editor.open(uri);editor.edit('{"usb":{"uboot":false}}');await assert.rejects(editor.save(value=>projectPrompt(JSON.parse(value))),/Invalid Forge/);assert.ok(!f.calls.some(c=>c.operation==='write'));editor.close();
});
test('selection race cannot replace the current resource with an old response',async()=>{
  const f=resourceFixture();let firstResolve;f.resources.read=async ({uri:requested})=>requested===uri?new Promise(resolve=>{firstResolve=resolve;}):{contents:[{uri:requested,text:'new selection'}]};const editor=createResourceEditor(f.resources),first=editor.open(uri);await editor.open('host-resource:second');firstResolve(content());await first;assert.equal(editor.state.uri,'host-resource:second');assert.equal(editor.state.text,'new selection');editor.close();
});
test('subscription race cleans up a resource subscribed after teardown',async()=>{
  const f=resourceFixture();let finish;f.resources.subscribe=()=>new Promise(resolve=>{finish=resolve;});const editor=createResourceEditor(f.resources),pending=editor.open(uri);await new Promise(resolve=>setTimeout(resolve,0));editor.close();finish({});await pending;assert.equal(editor.state,null);assert.ok(f.calls.some(c=>c.operation==='unsubscribe'&&c.uri===uri));
});
test('edits made while save is pending remain dirty after earlier text is saved',async()=>{
  const f=resourceFixture();let finish;f.resources.write=()=>new Promise(resolve=>{finish=resolve;});const editor=createResourceEditor(f.resources);await editor.open(uri);editor.edit('first');const pending=editor.save(()=>{});editor.edit('second');finish({outcome:'saved',etag:'b'});await pending;assert.equal(editor.state.text,'second');assert.equal(editor.state.dirty,true);assert.equal(editor.state.etag,'b');editor.close();
});
