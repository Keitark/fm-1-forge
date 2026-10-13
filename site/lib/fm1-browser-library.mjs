/** Browser-local catalog exports. No chooser, network, process or device access.
 * Accept the existing remote_catalog.py export format, not loose firmware/source.
 * IndexedDB belongs to the current browser origin/profile; the host controls its
 * retention. An unavailable store never falls back to a pretend durable library.
 */
export const BROWSER_LIBRARY_LIMITS=Object.freeze({bundleBytes:1500000,setBytes:12*1024*1024,members:8,selectedFiles:512,imageBytes:0x100000});
const DATABASE='fm1-forge-browser-library-v1',VERSION=1;
const PROFILES=new Set(['diagnostics','nes','doom','mdx','buddha','protracker']);
const BUNDLE_KEYS=['id','profile','title','description','variant','request'];
const REQUEST_KEYS=['op','image','sha256','baseline_sha256'];
const MEMBER_KEYS=['id','profile','title','description','variant','sha256','baseline_sha256','size_bytes','ready','verification','transfer','image_hash_verified','device_baseline_verified'];
const SET_KEYS=['schemaVersion','id','name','members','imported','device_io','ready','verification','transfer','storage','persistence'];
const PACKAGE_KEYS=['schemaVersion','id','member','image'];
const hex=/^[a-f0-9]{64}$/,ident=/^[a-z0-9][a-z0-9_-]{0,63}$/,setIdent=/^[a-f0-9]{32}$/;
const base64Alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const base64Values=new Uint8Array(128).fill(255);
for(let index=0;index<base64Alphabet.length;index++)base64Values[base64Alphabet.charCodeAt(index)]=index;

export class BrowserLibraryError extends Error{
  constructor(code,message){super(message);this.name='BrowserLibraryError';this.code=code;}
}
const fail=(code,message)=>new BrowserLibraryError(code,message);
const safeGlobal=key=>{try{return globalThis[key];}catch{return undefined;}};
const exactKeys=(value,expected)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
const textValid=(value,limit)=>typeof value==='string'&&[...value].length>=1&&[...value].length<=limit&&!/[\x00-\x1f\x7f]/.test(value)&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
const canonical=value=>JSON.stringify(value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])));
function requireName(name){if(!textValid(name,80)||name!==name.trim())throw fail('invalid_set_name','Use a set name of 1–80 characters without control characters or surrounding spaces.');return name;}
function validPathPart(part){
  if(!part||part==='.'||part==='..'||/[\\/:\x00-\x1f\x7f]/.test(part))return false;
  let decoded=part;try{decoded=decodeURIComponent(part);}catch{/* A literal percent in a filename is not a URL. */}
  return decoded!=='.'&&decoded!=='..'&&!/[\\/:\x00-\x1f\x7f]/.test(decoded);
}
function filePath(file){
  if(typeof file?.name!=='string'||file.name.length>255||!validPathPart(file.name))throw fail('invalid_file_path','Selected files must have safe relative filenames.');
  const path=file.webkitRelativePath||file.name;
  if(typeof path!=='string'||path.length>2048||path.split('/').length>32||!path.split('/').every(validPathPart)||path.split('/').at(-1)!==file.name)throw fail('invalid_file_path','Selected files must have safe relative paths.');
  return path;
}
function validateDisplay(value){
  if(!ident.test(value?.id)||typeof value.id!=='string'||!PROFILES.has(value.profile))throw fail('invalid_bundle','Choose exported FM1 catalog bundle JSON files.');
  for(const [name,limit] of [['title',80],['description',500],['variant',120]])if(!textValid(value[name],limit))throw fail('invalid_metadata','An FM1 bundle contains invalid display metadata.');
}
function decodeImage(encoded){
  if(typeof encoded!=='string'||encoded.length!==1398104||!/^([A-Za-z0-9+/]+)==$/.test(encoded)||
     (base64Values[encoded.charCodeAt(encoded.length-3)]&15)!==0)throw fail('invalid_image','An FM1 bundle must contain a canonical base64 1 MiB firmware image.');
  const bytes=new Uint8Array(BROWSER_LIBRARY_LIMITS.imageBytes);let output=0;
  for(let offset=0;offset<encoded.length;offset+=4){
    const a=base64Values[encoded.charCodeAt(offset)],b=base64Values[encoded.charCodeAt(offset+1)];
    const c=encoded[offset+2]==='='?0:base64Values[encoded.charCodeAt(offset+2)],d=encoded[offset+3]==='='?0:base64Values[encoded.charCodeAt(offset+3)];
    bytes[output++]=(a<<2)|(b>>4);
    if(output<bytes.length)bytes[output++]=(b<<4)|(c>>2);
    if(output<bytes.length)bytes[output++]=(c<<6)|d;
  }
  if(output!==bytes.length)throw fail('invalid_image','An FM1 bundle has an invalid firmware image size.');
  return bytes;
}
function makeMember(bundle){return {id:bundle.id,profile:bundle.profile,title:bundle.title,description:bundle.description,variant:bundle.variant,sha256:bundle.request.sha256,baseline_sha256:bundle.request.baseline_sha256,size_bytes:BROWSER_LIBRARY_LIMITS.imageBytes,ready:false,verification:'imported_unverified',transfer:'manual_uboot',image_hash_verified:true,device_baseline_verified:false};}
function validMember(member){
  try{if(!exactKeys(member,MEMBER_KEYS))return false;validateDisplay(member);}catch{return false;}
  return typeof member.sha256==='string'&&hex.test(member.sha256)&&typeof member.baseline_sha256==='string'&&hex.test(member.baseline_sha256)&&member.size_bytes===BROWSER_LIBRARY_LIMITS.imageBytes&&member.ready===false&&member.verification==='imported_unverified'&&member.transfer==='manual_uboot'&&member.image_hash_verified===true&&member.device_baseline_verified===false;
}
function validSet(value){
  if(!exactKeys(value,SET_KEYS)||value.schemaVersion!==1||typeof value.id!=='string'||!setIdent.test(value.id)||!textValid(value.name,80)||value.name!==value.name.trim()||!Array.isArray(value.members)||value.members.length<1||value.members.length>BROWSER_LIBRARY_LIMITS.members||!value.members.every(validMember)||new Set(value.members.map(member=>member.id)).size!==value.members.length||typeof value.imported!=='string'||!Number.isFinite(Date.parse(value.imported)))return false;
  return value.device_io===false&&value.ready===false&&value.verification==='imported_unverified'&&value.transfer==='manual_uboot'&&value.storage==='indexeddb'&&value.persistence==='browser-origin';
}
function validPackage(value){return exactKeys(value,PACKAGE_KEYS)&&value.schemaVersion===1&&value.id===value.member?.id&&validMember(value.member)&&value.image?.size===BROWSER_LIBRARY_LIMITS.imageBytes&&typeof value.image.arrayBuffer==='function';}
function copySet(value){return {...value,members:value.members.map(member=>({...member}))};}
const identity=value=>canonical({name:value.name,members:value.members});

export function createBrowserLibrary({indexedDB=safeGlobal('indexedDB'),crypto=safeGlobal('crypto'),now=()=>Date.now()}={}){
  let database=null,opening=null;
  const availability=()=>({available:typeof indexedDB?.open==='function'&&typeof crypto?.subtle?.digest==='function',storage:'indexeddb',persistence:'browser-origin',reason:typeof indexedDB?.open!=='function'?'storage_unavailable':typeof crypto?.subtle?.digest!=='function'?'crypto_unavailable':null});
  function requireAvailable(){const status=availability();if(status.reason)throw fail(status.reason,status.reason==='storage_unavailable'?'This panel host does not allow a saved browser library. No files were imported.':'This panel host does not provide firmware hash verification. No files were imported.');}
  async function sha256(bytes){
    try{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');}
    catch{throw fail('hash_unavailable','The panel could not verify the selected firmware hash. No files were imported.');}
  }
  async function setDigest(receipt){return (await sha256(new TextEncoder().encode(identity(receipt)))).slice(0,32);}
  async function open(){
    requireAvailable();if(database)return database;if(opening)return opening;
    opening=new Promise((resolve,reject)=>{
      let request;try{request=indexedDB.open(DATABASE,VERSION);}catch{reject(fail('storage_unavailable','This panel host denied saved browser library access.'));return;}
      let failed=false;
      request.onupgradeneeded=()=>{
        try{for(const name of ['sets','packages'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});}
        catch{failed=true;try{request.transaction?.abort();}catch{}}
      };
      request.onblocked=()=>{failed=true;reject(fail('storage_blocked','Another panel is blocking this browser library. Close the older panel and try again.'));};
      request.onerror=()=>{failed=true;reject(fail('storage_unavailable','The saved browser library is unavailable. No in-memory library was substituted.'));};
      request.onsuccess=()=>{
        const db=request.result;
        if(failed){db.close();return;}
        database=db;db.onversionchange=()=>{db.close();if(database===db)database=null;};resolve(db);
      };
    });
    try{return await opening;}finally{opening=null;}
  }
  async function snapshot(){
    const db=await open();
    return new Promise((resolve,reject)=>{
      let tx;try{tx=db.transaction(['sets','packages'],'readonly');}catch{reject(fail('storage_read_failed','The saved browser library could not be read.'));return;}
      const sets=tx.objectStore('sets').getAll(),packages=tx.objectStore('packages').getAll();
      tx.oncomplete=()=>resolve({sets:sets.result,packages:packages.result});
      tx.onabort=tx.onerror=()=>reject(fail('storage_read_failed','The saved browser library could not be read.'));
    });
  }
  async function verifiedPackage(value){
    if(!validPackage(value))return false;
    try{const bytes=await value.image.arrayBuffer();return bytes.byteLength===BROWSER_LIBRARY_LIMITS.imageBytes&&await sha256(bytes)===value.member.sha256;}catch{return false;}
  }
  async function listSets(){
    const stored=await snapshot(),packages=new Map(stored.packages.filter(record=>record&&typeof record==='object').map(record=>[record.id,record])),checked=new Map(),result=[];
    for(const receipt of stored.sets){
      if(!validSet(receipt)||await setDigest(receipt)!==receipt.id)continue;
      let complete=true;
      for(const member of receipt.members){
        const record=packages.get(member.id);
        if(!validPackage(record)||canonical(record.member)!==canonical(member)){complete=false;break;}
        if(!checked.has(member.id))checked.set(member.id,await verifiedPackage(record));
        if(!checked.get(member.id)){complete=false;break;}
      }
      if(complete)result.push(copySet(receipt));
    }
    return result.sort((a,b)=>b.imported.localeCompare(a.imported)||a.id.localeCompare(b.id));
  }
  async function importFiles(selection,{name}={}){
    requireAvailable();let selected;
    try{selected=Array.from(selection??[]);}catch{throw fail('invalid_selection','Choose 1–8 exported FM1 catalog bundle JSON files.');}
    if(selected.length>BROWSER_LIBRARY_LIMITS.selectedFiles)throw fail('selection_too_large','Choose an exported app bundle folder rather than a large source folder.');
    selected.forEach(filePath);const files=selected.filter(file=>/\.json$/i.test(file.name));
    if(files.length<1||files.length>BROWSER_LIBRARY_LIMITS.members)throw fail('invalid_selection','Choose 1–8 exported FM1 catalog bundle JSON files.');
    const jsonPaths=files.map(filePath);
    if(new Set(jsonPaths.map(path=>path.toLowerCase())).size!==jsonPaths.length)throw fail('duplicate_path','The selected app bundles have duplicate file paths.');
    if(files.some(file=>!Number.isSafeInteger(file.size)||file.size<1||file.size>BROWSER_LIBRARY_LIMITS.bundleBytes||typeof file.arrayBuffer!=='function')||files.reduce((sum,file)=>sum+file.size,0)>BROWSER_LIBRARY_LIMITS.setBytes)throw fail('bundle_size_limit','Choose bundle JSON files up to 1.5 MB each and 12 MiB per set.');
    const roots=files.map(file=>file.webkitRelativePath?.split('/')[0]).filter(Boolean);
    const inferred=roots.length===files.length&&new Set(roots).size===1?[...roots[0]].slice(0,80).join(''):'My FM1 apps';
    name=requireName(name===undefined?inferred:name);
    const staged=[],ids=new Set();
    for(const file of files){
      let raw,bundle;
      try{raw=await file.arrayBuffer();}catch{throw fail('file_read_failed','A selected bundle could not be read. No files were imported.');}
      if(raw.byteLength!==file.size||raw.byteLength>BROWSER_LIBRARY_LIMITS.bundleBytes)throw fail('bundle_size_limit','A selected bundle changed size or exceeds the import limit.');
      try{bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw).replace(/^\uFEFF/,''));}catch{throw fail('invalid_json','A selected bundle is not valid UTF-8 JSON.');}
      if(!exactKeys(bundle,BUNDLE_KEYS))throw fail('invalid_bundle','Choose exported FM1 catalog bundle JSON files.');validateDisplay(bundle);
      const request=bundle.request;
      if(!exactKeys(request,REQUEST_KEYS)||request.op!=='plan'||typeof request.sha256!=='string'||!hex.test(request.sha256)||typeof request.baseline_sha256!=='string'||!hex.test(request.baseline_sha256))throw fail('invalid_request','An FM1 bundle has invalid offline plan metadata.');
      if(ids.has(bundle.id))throw fail('duplicate_package','The selected bundles contain duplicate package IDs.');ids.add(bundle.id);
      const image=decodeImage(request.image);
      if(await sha256(image)!==request.sha256)throw fail('image_hash_mismatch','A selected FM1 bundle failed its firmware SHA256 check. No files were imported.');
      staged.push({schemaVersion:1,id:bundle.id,member:makeMember(bundle),image:new Blob([image],{type:'application/octet-stream'})});
    }
    // Validation of the complete selected set happens before any package writes.
    const members=staged.map(record=>record.member).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const receipt={schemaVersion:1,id:'',name,members,imported:new Date(now()).toISOString(),device_io:false,ready:false,verification:'imported_unverified',transfer:'manual_uboot',storage:'indexeddb',persistence:'browser-origin'};
    receipt.id=await setDigest(receipt);
    const previous=await snapshot(),priorPackages=new Map(previous.packages.map(record=>[record.id,record]));
    for(const record of staged){
      const prior=priorPackages.get(record.id);
      if(prior&&(!validPackage(prior)||canonical(prior.member)!==canonical(record.member)||!await verifiedPackage(prior)))throw fail('immutable_package_collision','A saved package uses this ID with different or invalid content. Export the new variant with a new ID.');
    }
    const db=await open();
    return new Promise((resolve,reject)=>{
      let tx;try{tx=db.transaction(['sets','packages'],'readwrite');}catch{reject(fail('storage_write_failed','The browser could not save this app set.'));return;}
      let error=null,result=receipt;
      const stop=problem=>{error=problem;try{tx.abort();}catch{}};
      const sets=tx.objectStore('sets'),packages=tx.objectStore('packages');
      for(const record of staged){
        const request=packages.get(record.id);request.onsuccess=()=>{
          if(error)return;
          if(request.result){if(!validPackage(request.result)||canonical(request.result.member)!==canonical(record.member))stop(fail('immutable_package_collision','A saved package uses this ID with different content. Export the new variant with a new ID.'));}
          else packages.add(record);
        };
      }
      const priorSet=sets.get(receipt.id);priorSet.onsuccess=()=>{
        if(error)return;
        if(priorSet.result){
          if(!validSet(priorSet.result)||identity(priorSet.result)!==identity(receipt))stop(fail('set_collision','An existing browser app set does not match this import.'));
          else result=priorSet.result;
        }else sets.add(receipt);
      };
      tx.oncomplete=()=>resolve(copySet(result));
      tx.onabort=tx.onerror=()=>reject(error??fail('storage_write_failed','The browser could not save the complete app set. No partial set was saved.'));
    });
  }
  async function removeSet(id){
    if(typeof id!=='string'||!setIdent.test(id))throw fail('invalid_set_id','Choose a saved browser app set to remove.');
    const db=await open();
    return new Promise((resolve,reject)=>{
      let tx;try{tx=db.transaction(['sets','packages'],'readwrite');}catch{reject(fail('storage_write_failed','The browser could not remove this saved app set.'));return;}
      let removed=false;const sets=tx.objectStore('sets'),packages=tx.objectStore('packages'),request=sets.getAll();
      request.onsuccess=()=>{
        const target=request.result.find(record=>record.id===id);if(!target)return;
        removed=true;sets.delete(id);
        const remaining=new Set(request.result.filter(record=>record.id!==id).flatMap(record=>Array.isArray(record.members)?record.members.map(member=>member?.id):[]));
        for(const member of Array.isArray(target.members)?target.members:[])if(typeof member?.id==='string'&&ident.test(member.id)&&!remaining.has(member.id))packages.delete(member.id);
      };
      tx.oncomplete=()=>resolve({id,removed,device_io:false,source_files_changed:false});
      tx.onabort=tx.onerror=()=>reject(fail('storage_write_failed','The browser could not remove this saved app set.'));
    });
  }
  const close=()=>{database?.close();database=null;};
  return {availability,importFiles,listSets,removeSet,close};
}
if(typeof window!=='undefined')window.FM1BrowserLibrary={createBrowserLibrary};
