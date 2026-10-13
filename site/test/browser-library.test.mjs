import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {createBrowserLibrary,BROWSER_LIBRARY_LIMITS} from '../lib/fm1-browser-library.mjs';

const IMAGE=Buffer.alloc(0x100000),SHA=createHash('sha256').update(IMAGE).digest('hex'),BASE64=IMAGE.toString('base64');
const clone=value=>structuredClone(value);
function bundle(id='local-nes',overrides={}){return {id,profile:'nes',title:'My NES',description:'Offline exported catalog bundle',variant:'Local demo',request:{op:'plan',image:BASE64,sha256:SHA,baseline_sha256:'a'.repeat(64)},...overrides};}
function file(value,name='bundle.json',relative=''){
  const valueFile=new File([typeof value==='string'?value:JSON.stringify(value)],name,{type:'application/json'});
  if(relative)Object.defineProperty(valueFile,'webkitRelativePath',{value:relative});return valueFile;
}
function fakeIndexedDB({denied=false,blocked=false,failAdd=null}={}){
  const stores=new Map();let opens=0,commits=0;
  function transaction(names,mode){
    const selected=new Map(names.map(name=>[name,new Map([...stores.get(name)].map(([id,value])=>[id,clone(value)]))]));
    let pending=0,aborted=false,completed=false;
    const tx={oncomplete:null,onerror:null,onabort:null,abort(){if(aborted||completed)return;aborted=true;queueMicrotask(()=>tx.onabort?.());},objectStore(name){
      if(!selected.has(name))throw new Error('Store not selected');
      const values=selected.get(name);
      function request(fn){
        const req={result:undefined,error:null,onsuccess:null,onerror:null};pending++;
        queueMicrotask(()=>{
          if(aborted){pending--;return;}
          try{req.result=fn();req.onsuccess?.({target:req});}
          catch(error){req.error=error;req.onerror?.({target:req});tx.onerror?.({target:tx});tx.abort();}
          finally{pending--;finish();}
        });return req;
      }
      return {get:id=>request(()=>clone(values.get(id))),getAll:()=>request(()=>[...values.values()].map(clone)),add:value=>request(()=>{
        if(mode!=='readwrite'||values.has(value.id)||failAdd===name)throw new Error('Injected storage failure');values.set(value.id,clone(value));return value.id;
      }),delete:id=>request(()=>{if(mode!=='readwrite')throw new Error('Read only');values.delete(id);})};
    }};
    function finish(){queueMicrotask(()=>{if(pending||aborted||completed)return;completed=true;if(mode==='readwrite'){for(const [name,values]of selected)stores.set(name,values);commits++;}tx.oncomplete?.();});}
    finish();return tx;
  }
  return {stores,get opens(){return opens;},get commits(){return commits;},open(){
    opens++;const req={result:null,error:null,onupgradeneeded:null,onblocked:null,onerror:null,onsuccess:null};
    queueMicrotask(()=>{
      if(denied){req.onerror?.();return;}if(blocked){req.onblocked?.();return;}
      let closed=false;
      req.result={objectStoreNames:{contains:name=>stores.has(name)},createObjectStore(name){stores.set(name,new Map());},transaction(names,mode){if(closed)throw new Error('Closed database');return transaction(names,mode);},close(){closed=true;},onversionchange:null};
      req.onupgradeneeded?.();req.onsuccess?.();
    });return req;
  }};
}
function fixture(options={}){const indexedDB=fakeIndexedDB(options),library=createBrowserLibrary({indexedDB,crypto:webcrypto,now:()=>Date.UTC(2026,9,13,12)});return {indexedDB,library};}

test('library construction does not open storage, choose files or import anything',()=>{
  const f=fixture();assert.equal(f.indexedDB.opens,0);assert.deepEqual(f.library.availability(),{available:true,storage:'indexeddb',persistence:'browser-origin',reason:null});
});
test('the existing catalog export is hash-verified and stored as a local Blob with metadata only returned',async()=>{
  const f=fixture(),receipt=await f.library.importFiles([file(bundle())],{name:'My apps'});
  assert.equal(receipt.name,'My apps');assert.match(receipt.id,/^[a-f0-9]{32}$/);assert.equal(receipt.device_io,false);assert.equal(receipt.ready,false);assert.equal(receipt.transfer,'manual_uboot');assert.equal(receipt.verification,'imported_unverified');assert.equal(receipt.persistence,'browser-origin');
  assert.equal(receipt.members[0].sha256,SHA);assert.equal(receipt.members[0].image_hash_verified,true);assert.equal(receipt.members[0].device_baseline_verified,false);assert.equal(receipt.members[0].baseline_sha256,'a'.repeat(64));
  assert.equal(JSON.stringify(receipt).includes('request'),false);assert.equal(JSON.stringify(receipt).includes(BASE64),false);assert.equal(f.indexedDB.stores.get('packages').get('local-nes').image.size,0x100000);
  assert.deepEqual(await f.library.listSets(),[receipt]);assert.equal(f.indexedDB.commits,1);
});
test('saved sets survive a new library instance and identical reimport is stable',async()=>{
  const f=fixture(),first=await f.library.importFiles([file(bundle('b'),'b.json'),file(bundle('a'),'a.json')],{name:'Saved set'});f.library.close();
  const next=createBrowserLibrary({indexedDB:f.indexedDB,crypto:webcrypto,now:()=>Date.UTC(2027,0,1)});
  assert.deepEqual(await next.listSets(),[first]);const second=await next.importFiles([file(bundle('a'),'a.json'),file(bundle('b'),'b.json')],{name:'Saved set'});assert.deepEqual(second,first);assert.equal(f.indexedDB.stores.get('packages').size,2);assert.equal(f.indexedDB.stores.get('sets').size,1);
});
test('folder imports infer a set name, ignore loose non-JSON files and accept UTF8 BOM exports',async()=>{
  const f=fixture();const receipt=await f.library.importFiles([file('\uFEFF'+JSON.stringify(bundle()),'my-app.JSON','My export/my-app.JSON'),file('not firmware','README.txt','My export/README.txt')]);assert.equal(receipt.name,'My export');assert.equal(receipt.members.length,1);
});
test('Unicode limits follow the existing Python codepoint metadata contract',async()=>{
  const f=fixture(),input=bundle('unicode',{title:'🌿'.repeat(80),description:'🌿'.repeat(500),variant:'🌿'.repeat(120)});const receipt=await f.library.importFiles([file(input)],{name:'日本語 apps'});assert.equal([...receipt.members[0].title].length,80);
});
test('all eight supported bundle slots import together with stable ASCII ID ordering',async()=>{
  const f=fixture(),ids=['a_b','a-b','8','7','6','5','4','3'];
  const receipt=await f.library.importFiles(ids.map(id=>file(bundle(id),id+'.json')),{name:'Eight apps'});
  assert.deepEqual(receipt.members.map(member=>member.id),ids.slice().sort());assert.equal(f.indexedDB.stores.get('packages').size,8);assert.equal((await f.library.listSets())[0].members.length,8);
});
test('complete-set validation precedes every write and catches duplicate IDs',async()=>{
  for(const selected of [[file(bundle('a'),'a.json'),file({...bundle('b'),request:{...bundle().request,sha256:'0'.repeat(64)}},'b.json')],[file(bundle('a'),'a.json'),file(bundle('a'),'b.json')]]){
    const f=fixture();await assert.rejects(f.library.importFiles(selected),error=>['image_hash_mismatch','duplicate_package'].includes(error.code));assert.equal(f.indexedDB.opens,0);assert.equal(f.indexedDB.commits,0);
  }
});
test('IDs, unknown fields, unsupported profiles, plan operation and baseline format are strict',async()=>{
  for(const input of [bundle('../escape'),bundle('x',{path:'outside'}),bundle('x',{profile:'unknown'}),bundle('x',{request:{...bundle().request,op:'flash'}}),bundle('x',{request:{...bundle().request,baseline_sha256:'bad'}})]){
    const f=fixture();await assert.rejects(f.library.importFiles([file(input)]),error=>['invalid_bundle','invalid_request'].includes(error.code));assert.equal(f.indexedDB.commits,0);
  }
});
test('safe relative filenames reject traversal, absolute paths, backslashes and encoded traversal',async()=>{
  for(const [name,path] of [['bundle.json','../bundle.json'],['bundle.json','/folder/bundle.json'],['bundle.json','C:/folder/bundle.json'],['bundle.json','folder\\bundle.json'],['bundle.json','%2e%2e/bundle.json'],['bundle.json','folder/%2fbundle.json'],['../bundle.json',''],['bundle.json','folder/another.json']]){
    const f=fixture();await assert.rejects(f.library.importFiles([file(bundle(),name,path)]),{code:'invalid_file_path'});assert.equal(f.indexedDB.opens,0);
  }
  const f=fixture();await assert.rejects(f.library.importFiles([file(bundle(),'APP.json','folder/APP.json'),file(bundle('b'),'app.json','folder/app.json')]),{code:'duplicate_path'});
});
test('import limits reject oversized files and selections before reading their contents',async()=>{
  const f=fixture();let reads=0;const oversized={name:'huge.json',size:BROWSER_LIBRARY_LIMITS.bundleBytes+1,arrayBuffer(){reads++;throw Error('Should not read');}};
  await assert.rejects(f.library.importFiles([oversized]),{code:'bundle_size_limit'});assert.equal(reads,0);
  await assert.rejects(f.library.importFiles([]),{code:'invalid_selection'});await assert.rejects(f.library.importFiles(Array.from({length:9},(_,index)=>file(bundle(String(index)),index+'.json'))),{code:'invalid_selection'});
  await assert.rejects(f.library.importFiles(Array.from({length:513},(_,index)=>({name:index+'.txt'}))),{code:'selection_too_large'});assert.equal(f.indexedDB.opens,0);
});
test('set names and display controls cannot enter saved metadata',async()=>{
  for(const name of ['', ' ', ' surrounding ', 'x'.repeat(81),'bad\nname']){const f=fixture();await assert.rejects(f.library.importFiles([file(bundle())],{name}),{code:'invalid_set_name'});assert.equal(f.indexedDB.opens,0);}
  for(const title of ['bad\x00name','x'.repeat(81),'bad\ud800']){const f=fixture();await assert.rejects(f.library.importFiles([file(bundle('a',{title}))]),{code:'invalid_metadata'});assert.equal(f.indexedDB.opens,0);}
});
test('malformed JSON, UTF8 and noncanonical base64 are rejected with safe fixed messages',async()=>{
  const inputs=[file('{broken secret payload'),new File([new Uint8Array([0xff])],'bad.json'),file(bundle('x',{request:{...bundle().request,image:BASE64.slice(0,-3)+'B=='}})),file(bundle('x',{request:{...bundle().request,image:BASE64.slice(0,-2)+'AA'}}))];
  for(const input of inputs){const f=fixture();await assert.rejects(f.library.importFiles([input]),error=>['invalid_json','invalid_image'].includes(error.code)&&!error.message.includes('secret')&&!error.message.includes(BASE64));assert.equal(f.indexedDB.opens,0);}
});
test('immutable package collisions preserve saved sets and add no new package',async()=>{
  const f=fixture(),first=await f.library.importFiles([file(bundle('fixed'))],{name:'First'});
  await assert.rejects(f.library.importFiles([file(bundle('new'),'new.json'),file(bundle('fixed',{title:'Different title'}),'fixed.json')],{name:'Collision'}),{code:'immutable_package_collision'});
  assert.deepEqual(await f.library.listSets(),[first]);assert.equal(f.indexedDB.stores.get('packages').size,1);assert.equal(f.indexedDB.stores.get('packages').has('new'),false);
});
test('a storage failure aborts all set/package writes atomically',async()=>{
  const f=fixture({failAdd:'sets'});await assert.rejects(f.library.importFiles([file(bundle())]),{code:'storage_write_failed'});assert.equal(f.indexedDB.commits,0);assert.equal(f.indexedDB.stores.get('sets').size,0);assert.equal(f.indexedDB.stores.get('packages').size,0);
});
test('unavailable, denied and blocked IndexedDB never fall back to memory or falsely report saving',async()=>{
  const noStore=createBrowserLibrary({indexedDB:null,crypto:webcrypto});assert.equal(noStore.availability().available,false);await assert.rejects(noStore.importFiles([file(bundle())]),{code:'storage_unavailable'});
  const noCrypto=createBrowserLibrary({indexedDB:fakeIndexedDB(),crypto:null});await assert.rejects(noCrypto.importFiles([file(bundle())]),{code:'crypto_unavailable'});
  for(const [options,code] of [[{denied:true},'storage_unavailable'],[{blocked:true},'storage_blocked']]){const f=fixture(options);await assert.rejects(f.library.importFiles([file(bundle())]),{code});assert.equal(f.indexedDB.commits,0);}
});
test('listing rechecks persisted Blob hashes and omits tampered or missing packages/receipts',async()=>{
  const f=fixture(),receipt=await f.library.importFiles([file(bundle())]);
  const record=f.indexedDB.stores.get('packages').get('local-nes');record.image=new Blob([Buffer.alloc(0x100000,1)]);assert.deepEqual(await f.library.listSets(),[]);
  record.image=new Blob([IMAGE]);f.indexedDB.stores.get('sets').get(receipt.id).members[0].ready=true;assert.deepEqual(await f.library.listSets(),[]);
  f.indexedDB.stores.get('sets').set(receipt.id,receipt);f.indexedDB.stores.get('packages').delete('local-nes');assert.deepEqual(await f.library.listSets(),[]);
});
test('remove affects only browser copies, keeps shared packages and permits reimport from original files',async()=>{
  const f=fixture(),original=file(bundle()),first=await f.library.importFiles([original],{name:'First'}),second=await f.library.importFiles([original],{name:'Second'});
  assert.deepEqual(await f.library.removeSet(first.id),{id:first.id,removed:true,device_io:false,source_files_changed:false});assert.deepEqual(await f.library.listSets(),[second]);assert.equal(f.indexedDB.stores.get('packages').size,1);
  await f.library.removeSet(second.id);assert.equal(f.indexedDB.stores.get('packages').size,0);assert.deepEqual(await f.library.listSets(),[]);assert.equal((await f.library.importFiles([original],{name:'First'})).id,first.id);
  await assert.rejects(f.library.removeSet('../bad'),{code:'invalid_set_id'});assert.equal((await f.library.removeSet('0'.repeat(32))).removed,false);
});
test('returned receipts are isolated copies and cannot upgrade stored transfer permissions',async()=>{
  const f=fixture(),receipt=await f.library.importFiles([file(bundle())]);receipt.ready=true;receipt.members[0].title='Mutated';const listed=await f.library.listSets();assert.equal(listed[0].ready,false);assert.equal(listed[0].members[0].title,'My NES');listed[0].members[0].device_baseline_verified=true;assert.equal((await f.library.listSets())[0].members[0].device_baseline_verified,false);
});
test('malformed saved package metadata is omitted before recursive identity processing',async()=>{
  const f=fixture();await f.library.importFiles([file(bundle())]);const record=f.indexedDB.stores.get('packages').get('local-nes');record.member={self:null};record.member.self=record.member;assert.deepEqual(await f.library.listSets(),[]);
});
