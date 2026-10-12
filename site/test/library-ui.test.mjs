import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {librarySets,filterLibrary,libraryController,libraryRuntime,libraryHtml} from '../lib/fm1-library-ui.mjs';

const sha='a'.repeat(64),id='f'.repeat(32);
const catalog={apps:[{profile:'nes',variants:[{id:'nes-one',sha256:sha},{id:'nes-two',sha256:'b'.repeat(64)}]},{profile:'mdx',variants:[]}],sets:[{id:'set-one',name:'My local set',members:[{id:'nes-one',sha256:sha}]}]};
test('saved set filter requires exact catalog identities and digests',()=>{
  assert.equal(librarySets(catalog).length,1);
  const filtered=filterLibrary(catalog,'set-one');
  assert.deepEqual(filtered.map(app=>app.profile),['nes']);
  assert.deepEqual(filtered[0].variants.map(v=>v.id),['nes-one']);
  assert.equal(catalog.apps[0].variants.length,2);
  assert.equal(filterLibrary(catalog,'missing'),catalog.apps);
  for(const members of [[{id:'invented',sha256:sha}],[{id:'nes-one',sha256:'b'.repeat(64)}],[{id:'nes-one',sha256:sha},{id:'nes-one',sha256:sha}]])assert.equal(librarySets({...catalog,sets:[{...catalog.sets[0],members}]}).length,0);
});
test('standalone browser runtime retains helper bindings',()=>{
  const context={window:{}};vm.runInNewContext(libraryRuntime,context);
  assert.equal(context.window.FM1Library.librarySets(catalog).length,1);
  assert.equal(context.window.FM1Library.filterLibrary(catalog,'set-one')[0].variants.length,1);
  assert.match(libraryHtml,/Add local set/);
});

function setup(responses) {
  const nodes=new Map(),requests=[],pending=[],controller=new AbortController();let snapshots=0;
  const el=name=>{if(!nodes.has(name))nodes.set(name,{value:'',textContent:'',innerHTML:'',querySelectorAll(){return [];}});return nodes.get(name);};
  const call=async(name,args)=>{requests.push({name,args});return responses(name,args);};
  const ui=libraryController({el,call,snapshot:async()=>{snapshots++;},getState:()=>({relay:{connected:true},catalog}),render(){},signal:controller.signal,pause:async(ms)=>{if(ms===5000)return false;return true;}});
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  return {ui,el,requests,pending,tick,snapshots:()=>snapshots};
}
test('importer request resumes its exact ID without reopening and never submits device work',async()=>{
  let pending=true;
  const p=setup(name=>name==='open_fm1_local_import'?{request_id:id}:{state:pending?'pending':'succeeded',data:{opened:true,device_io:false}});
  p.el('library-add').onclick();await p.tick();
  assert.match(p.el('library-status').textContent,/saved request/);
  assert.equal(p.el('library-add').textContent,'Check saved importer request');
  pending=false;p.el('library-add').onclick();await p.tick();
  assert.equal(p.requests.filter(r=>r.name==='open_fm1_local_import').length,1);
  assert.ok(p.requests.filter(r=>r.name==='get_fm1_request').every(r=>r.args.request_id===id));
  assert.match(p.el('library-status').textContent,/Choose a folder/);
  assert.ok(!p.requests.some(r=>/switch|confirm|job|plan/.test(r.name)));
  p.ui.close();
});
test('catalog refresh is single flight and resumes metadata only without touching active work',async()=>{
  let pending=true;
  const p=setup(name=>name==='list_fm1_apps'?{request_id:id}:{state:pending?'pending':'succeeded',data:{apps:catalog.apps}});
  p.el('library-refresh').onclick();p.el('library-refresh').onclick();await p.tick();
  assert.equal(p.requests.filter(r=>r.name==='list_fm1_apps').length,1);
  pending=false;p.el('library-refresh').onclick();await p.tick();
  assert.equal(p.requests.filter(r=>r.name==='list_fm1_apps').length,1);
  assert.equal(p.snapshots(),1);
  p.ui.close();
});
test('unavailable host tools produce an actionable error without fallback mutation',async()=>{
  const p=setup(()=>{throw new Error('Unknown tool');});
  p.el('library-add').onclick();await p.tick();
  assert.match(p.el('library-status').textContent,/Reconnect FM1 Forge/);
  assert.deepEqual(p.requests.map(r=>r.name),['open_fm1_local_import']);
  p.ui.close();
});
