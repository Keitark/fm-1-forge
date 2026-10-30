export const RESOURCE_TEXT_LIMIT=131072;
export function validateLocalPath(value){
  if(typeof value!=='string'||value.length>4096||/[\u0000-\u001f\u007f]/.test(value)||!(/^[A-Za-z]:[\\/]/.test(value)||/^\/(?!\/)/.test(value)||/^\\\\[^\\]+\\[^\\]+/.test(value)))throw new Error('Enter the absolute path of a local file on this host.');return value;
}
export function parseForgeRoute(value){
  if(value===undefined)return undefined;
  if(typeof value!=='string'||value.length>1024||!value.startsWith('/')||value.startsWith('//')||/[\u0000-\u0020\\]/.test(value))return null;
  let url;try{url=new URL(value,'https://fm1.invalid');}catch{return null;}
  if(url.origin!=='https://fm1.invalid'||url.search||url.hash||url.pathname!==value||value.includes('//'))return null;
  if(value==='/')return {section:'home'};
  const parts=url.pathname.split('/').filter(Boolean);
  if(parts.length===1&&['projects','catalog','settings','appearance'].includes(parts[0]))return {section:parts[0]};
  if(parts.length===2&&['project','projects','job','jobs'].includes(parts[0])&&/^[a-f0-9]{32}$/.test(parts[1]))return {section:parts[0].startsWith('project')?'project':'job',id:parts[1]};
  if(parts.length===2&&parts[0]==='catalog'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(parts[1]))return {section:'catalog',id:parts[1]};
  if(parts.length===2&&parts[0]==='section'&&['projects','catalog','settings','appearance','designer'].includes(parts[1]))return {section:parts[1]};return null;
}
export function decodeResourceContent(content){
  if(!content||typeof content.uri!=='string')throw new Error('The host did not return the selected resource.');let bytes,text;
  if(typeof content.text==='string'){text=content.text;bytes=new TextEncoder().encode(text);}
  else if(typeof content.blob==='string'){
    if(content.blob.length>Math.ceil(RESOURCE_TEXT_LIMIT/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content.blob))throw new Error('Resource is too large or has invalid base64.');
    const binary=atob(content.blob);bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('This resource is binary. Open it in the native file viewer.');}
  }else throw new Error('The host returned no text or binary content.');
  if(bytes.length>RESOURCE_TEXT_LIMIT)throw new Error('Resource exceeds the 128 KiB configuration limit.');
  if(/\u0000/.test(text))throw new Error('This resource is binary. Open it in the native file viewer.');
  return {text,mimeType:content.mimeType||'text/plain',etag:content.openaiMetadata?.etag,writable:content.openaiMetadata?.writable===true};
}
/** Preserve dirty edits and conditional writes across notifications and selection races. */
export function createResourceEditor(resources,onChange=()=>{}){
  let selection=null,closed=false,generation=0;const notify=()=>{if(!closed)onChange(selection?{...selection}:null);};
  const remove=resources.addUpdateHandler(async notification=>{
    if(closed||notification.params?.uri!==selection?.uri)return;
    if(selection.dirty||selection.saving){selection.stale=true;notify();return;}
    try{await reload();}catch(error){if(selection){selection.error=error.message;notify();}}
  });
  async function reload(){
    if(closed||!selection)return;const current=selection,token=generation,result=await resources.read({uri:current.uri,representation:'text'});
    if(closed||generation!==token||selection!==current)return;
    const data=decodeResourceContent(result.contents.find(item=>item.uri===current.uri));
    if(current.dirty||current.saving){current.stale=true;notify();return;}Object.assign(current,data,{dirty:false,stale:false,error:null});notify();
  }
  async function open(uri,name='Configuration'){
    if(closed)throw new Error('Resource editor is closed.');
    if(typeof uri!=='string'||!uri.trim()||uri.length>4096||/[\u0000-\u001f\u007f]/.test(uri))throw new Error('The selected file has an invalid resource URI.');
    const previous=selection;generation++;selection={uri,name,text:'',dirty:false,stale:false,writable:false,loading:true};const current=selection;notify();
    if(previous?.subscribed)void resources.unsubscribe({uri:previous.uri}).catch(()=>{});
    try{await reload();if(closed||selection!==current)return;await resources.subscribe({uri});if(closed||selection!==current){void resources.unsubscribe({uri}).catch(()=>{});return;}current.subscribed=true;}
    catch(error){if(!closed&&selection===current){current.error=error.message;notify();}throw error;}
    finally{if(!closed&&selection===current){current.loading=false;notify();}}
  }
  function edit(text){if(closed||!selection)throw new Error('Select a resource first.');selection.text=text;selection.dirty=true;notify();}
  async function save(validate){
    const current=selection,token=generation;
    if(closed||!current||!current.writable||!current.etag)throw new Error('The host must provide writable resource metadata and an ETag before saving.');
    if(current.saving)throw new Error('A save is already in progress.');const text=current.text;
    if(new TextEncoder().encode(text).length>RESOURCE_TEXT_LIMIT)throw new Error('Configuration exceeds 128 KiB.');validate(text);current.saving=true;notify();
    try{const result=await resources.write(current.uri,{text,ifMatch:current.etag});if(closed||generation!==token||selection!==current)return result;
      if(result.outcome==='saved'){current.etag=result.etag;current.dirty=current.text!==text;current.error=null;}
      else if(result.outcome==='conflict'){current.stale=true;current.error='The file changed elsewhere. Your edits are preserved. Reload explicitly to discard them.';}
      else if(result.outcome==='too-large')current.error='The host refused this file: maximum '+result.maxBytes+' bytes. Your edits are preserved.';
      else throw new Error('The host returned an unknown save outcome.');return result;
    }finally{if(!closed&&selection===current){current.saving=false;notify();}}
  }
  async function discardAndReload(){if(closed||!selection)return;selection.dirty=false;await reload();}
  function close(){if(closed)return;closed=true;generation++;remove();if(selection?.subscribed)void resources.unsubscribe({uri:selection.uri}).catch(()=>{});selection=null;}
  return {open,edit,save,reload:discardAndReload,close,get state(){return selection?{...selection}:null;}};
}
