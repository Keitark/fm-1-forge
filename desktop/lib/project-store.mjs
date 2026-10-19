import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {normalizeProjectConfig,projectConfig} from '../../site/lib/fm1-forge-project.mjs';
import {PRESETS,PATTERNS} from '../../site/lib/fm1-appearance.mjs';

const FILE='forge-store.json',LOCK='.forge-store.lock',MAX_BYTES=131072,MAX_PROJECTS=24,LOCK_TIMEOUT_MS=1500,MAX_LOCK_WAIT_MS=10000;
const ID=/^[a-f0-9]{32}$/;
const DEFAULTS=Object.freeze({palette:'forge-black',pattern:'solid',entry_method:'auto',default_module:'diagnostics',default_usb_audio:true});
const SETTINGS=Object.keys(DEFAULTS);
const clone=value=>JSON.parse(JSON.stringify(value));
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
class StoreError extends Error{constructor(code,message){super(message);this.name='ProjectStoreError';this.code=code;}}
const unsafe=()=>new StoreError('unsafe_storage_path','Forge storage must use regular files and directories without symbolic links or redirected paths.');
const corrupt=()=>new StoreError('storage_corrupt','The local Forge settings or project data is invalid. Preserve it for recovery before saving again.');
const samePath=(left,right)=>process.platform==='win32'?path.normalize(left).toLowerCase()===path.normalize(right).toLowerCase():path.normalize(left)===path.normalize(right);
const sameFile=(left,right)=>left.dev===right.dev&&left.ino===right.ino;
function settings(value,{partial=false}={}){
  if(!object(value)||(!partial&&!exact(value,SETTINGS))||partial&&(!Object.keys(value).length||Object.keys(value).some(key=>!SETTINGS.includes(key))))throw new StoreError('invalid_arguments','Choose only supported Forge settings.');
  for(const [key,item] of Object.entries(value)){
    const valid=key==='palette'?PRESETS.some(preset=>preset.id===item):key==='pattern'?PATTERNS.some(pattern=>pattern.id===item):key==='entry_method'?['auto','serial','already_uboot'].includes(item):key==='default_module'?['diagnostics','user'].includes(item):key==='default_usb_audio'&&typeof item==='boolean';
    if(!valid)throw new StoreError('invalid_arguments','A Forge setting has an invalid value.');
  }
  return {...value};
}
function validatedConfig(config,optIn){
  const value=normalizeProjectConfig(config);
  return projectConfig({slug:value.project.slug,displayName:value.project.displayName,clockPreset:value.clockPreset,clockOptIn:optIn===true,lcdPreset:value.lcdPreset,module:value.module,usbAudio:value.usb.uac,usbAudioCapture:value.usb.uacCapture,usbVideo:value.usb.uvc,usbMidiUpdate:value.usb.midiUpdate,hal:value.hal});
}
function storedState(value){
  try{
    if(!exact(value,['schemaVersion','settings','projects'])||value.schemaVersion!==1||!Array.isArray(value.projects)||value.projects.length>MAX_PROJECTS)throw corrupt();
    const selected=settings(value.settings),ids=new Set(),projects=value.projects.map(item=>{
      if(!exact(item,['id','title','slug','config','resource_uri','created','updated','state'])||!ID.test(item.id)||ids.has(item.id)||!Number.isSafeInteger(item.created)||item.created<1||!Number.isSafeInteger(item.updated)||item.updated<item.created||item.resource_uri!=='fm1-forge://projects/'+item.id||item.state!=='configuration_draft')throw corrupt();
      ids.add(item.id);const config=normalizeProjectConfig(item.config);
      if(item.title!==config.project.displayName||item.slug!==config.project.slug)throw corrupt();
      return {...item,config};
    });
    return {schemaVersion:1,settings:selected,projects};
  }catch{throw corrupt();}
}

/** Local metadata only. File paths, firmware bytes and device operations are not stored. */
export function createProjectStore({directory}={}){
  if(typeof directory!=='string'||!directory||!path.isAbsolute(directory)||Array.from(directory).some(character=>character.codePointAt(0)<32)||process.platform==='win32'&&directory.startsWith(String.fromCharCode(92,92)))throw unsafe();
  const root=path.resolve(directory),volume=path.parse(root).root,parts=directory.slice(path.parse(directory).root.length).split(process.platform==='win32'?/[\\/]/:/\//).filter(Boolean);
  if(root===volume||parts.some(part=>part==='.'||part==='..'||process.platform==='win32'&&(/[<>:"|?*]/.test(part)||part.endsWith('.')||part.endsWith(' '))))throw unsafe();
  const file=path.join(root,FILE),lockPath=path.join(root,LOCK);
  async function checkedRoot(create=true){
    let cursor=volume;
    for(const part of path.relative(volume,root).split(path.sep)){
      cursor=path.join(cursor,part);let stat;
      try{stat=await fs.lstat(cursor);}
      catch(error){if(error.code!=='ENOENT'||!create)throw error;try{await fs.mkdir(cursor,{mode:0o700});}catch(other){if(other.code!=='EEXIST')throw other;}stat=await fs.lstat(cursor);}
      if(stat.isSymbolicLink()||!stat.isDirectory()||!samePath(await fs.realpath(cursor),cursor))throw unsafe();
    }
  }
  async function checkedFile(filename,{optional=false,contendedLock=false}={}){
    let stat;
    try{stat=await fs.lstat(filename,{bigint:true});}catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
    if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1n)throw unsafe();
    if(!samePath(await fs.realpath(filename),filename)){
      if(contendedLock){
        // Windows can resolve an unlinked peer lock to its NTFS tombstone.
        // Only a waiter may retry a proven release or regular-file handoff;
        // ownership checks must still reject every redirected path.
        let current;
        try{current=await fs.lstat(filename,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}
        if(!sameFile(stat,current)&&current.isFile()&&!current.isSymbolicLink()&&current.nlink===1n)return null;
      }
      throw unsafe();
    }
    return stat;
  }
  async function read(){
    await checkedRoot();const before=await checkedFile(file,{optional:true});
    if(!before)return {schemaVersion:1,settings:{...DEFAULTS},projects:[]};
    if(before.size>BigInt(MAX_BYTES))throw corrupt();
    const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try{
      const opened=await handle.stat({bigint:true}),current=await checkedFile(file);
      if(!sameFile(before,opened)||!sameFile(opened,current)||!opened.isFile()||opened.size>BigInt(MAX_BYTES))throw unsafe();
      const text=await handle.readFile('utf8');if(Buffer.byteLength(text)>MAX_BYTES)throw corrupt();
      let value;try{value=JSON.parse(text);}catch{throw corrupt();}return storedState(value);
    }finally{await handle.close();}
  }
  async function assertLock(handle){
    await checkedRoot(false);const [opened,current]=await Promise.all([handle.stat({bigint:true}),checkedFile(lockPath)]);
    if(!sameFile(opened,current))throw unsafe();
  }
  async function exclusive(operation){
    await checkedRoot();const started=Date.now(),limit=started+MAX_LOCK_WAIT_MS;let deadline=started+LOCK_TIMEOUT_MS,handle,waitingFor;
    const progressed=current=>{if(!current||!waitingFor||!sameFile(waitingFor,current))deadline=Date.now()+LOCK_TIMEOUT_MS;waitingFor=current;};
    while(!handle){
      if(Date.now()>=deadline||Date.now()>=limit)throw new StoreError('storage_busy','Another Forge settings operation owns local storage. Try again after it finishes.');
      try{handle=await fs.open(lockPath,'wx',0o600);}
      catch(error){
        if(error.code!=='EEXIST')throw error;
        await checkedRoot(false);
        // The owner may release between CreateNew reporting EEXIST and this
        // inspection. A disappeared lock is a normal handoff, never a lease.
        // Active owners can hand the lock to a queue for longer than one lease.
        // Renew only on observed progress, retaining an absolute waiting bound.
        try{const current=await checkedFile(lockPath,{contendedLock:true});progressed(current);if(!current)continue;}catch(checkError){if(checkError.code==='ENOENT'){progressed(null);continue;}throw checkError;}
        await delay(20);
      }
    }
    try{return await operation(handle);}
    finally{
      let handleClosed=false;
      try{
        await assertLock(handle);const owner=await handle.stat({bigint:true});await handle.close();handleClosed=true;
        await checkedRoot(false);if(!sameFile(owner,await checkedFile(lockPath)))throw unsafe();await fs.unlink(lockPath);
      }finally{if(!handleClosed)await handle.close();}
    }
  }
  async function mutate(operation){
    return exclusive(async handle=>{
      await assertLock(handle);const value=await read(),answer=await operation(value);await assertLock(handle);
      const text=JSON.stringify(storedState(value),null,2)+'\n';if(Buffer.byteLength(text)>MAX_BYTES)throw corrupt();
      const temporary=path.join(root,'.forge-store-'+randomBytes(16).toString('hex')+'.tmp');let temporaryHandle,temporaryStat;
      try{
        temporaryHandle=await fs.open(temporary,'wx',0o600);temporaryStat=await temporaryHandle.stat({bigint:true});
        if(!temporaryStat.isFile()||temporaryStat.nlink!==1n)throw unsafe();
        await temporaryHandle.writeFile(text,'utf8');await temporaryHandle.sync();await temporaryHandle.close();temporaryHandle=null;
        await assertLock(handle);await checkedFile(file,{optional:true});
        if(!sameFile(temporaryStat,await checkedFile(temporary)))throw unsafe();
        await fs.rename(temporary,file);
        if(process.platform!=='win32'){const directoryHandle=await fs.open(root,'r');try{await directoryHandle.sync();}finally{await directoryHandle.close();}}
      }finally{
        await temporaryHandle?.close();
        try{await checkedRoot(false);const leftover=await checkedFile(temporary,{optional:true});if(leftover&&temporaryStat&&sameFile(leftover,temporaryStat))await fs.unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
      }
      return clone(answer);
    });
  }
  const wrap=operation=>async(...args)=>{try{return await operation(...args);}catch(error){if(error instanceof StoreError||!error.code)throw error;throw new StoreError('storage_unavailable','Local Forge storage is unavailable. No successful save was recorded.');}};
  return Object.freeze({
    readSettings:wrap(async()=>exclusive(async()=>({...((await read()).settings)}))),
    updateSettings:wrap(async set=>{const change=settings(set,{partial:true});return mutate(value=>{value.settings={...value.settings,...change};return value.settings;});}),
    listProjects:wrap(async()=>exclusive(async()=>clone((await read()).projects.sort((left,right)=>right.updated-left.updated||left.id.localeCompare(right.id))))),
    saveProject:wrap(async input=>{
      if(!object(input)||!Object.hasOwn(input,'config')||Object.keys(input).some(key=>!['config','project_id','clock_opt_in'].includes(key))||Object.hasOwn(input,'project_id')&&(typeof input.project_id!=='string'||!ID.test(input.project_id))||Object.hasOwn(input,'clock_opt_in')&&typeof input.clock_opt_in!=='boolean')throw new StoreError('invalid_arguments','Use a Forge configuration and an optional saved project ID and clock confirmation.');
      const config=validatedConfig(input.config,input.clock_opt_in);
      return mutate(value=>{
        const existing=input.project_id?value.projects.find(item=>item.id===input.project_id):null;
        if(input.project_id&&!existing)throw new StoreError('not_found','The saved Forge project was not found.');
        if(!existing&&value.projects.length>=MAX_PROJECTS)throw new StoreError('project_limit','The local Forge project limit of 24 has been reached.');
        let id=existing?.id;while(!id||!existing&&value.projects.some(item=>item.id===id))id=randomBytes(16).toString('hex');
        const now=Math.floor(Date.now()/1000),project={id,title:config.project.displayName,slug:config.project.slug,config,resource_uri:'fm1-forge://projects/'+id,created:existing?.created??now,updated:Math.max(now,existing?.updated??0),state:'configuration_draft'};
        if(existing)value.projects[value.projects.indexOf(existing)]=project;else value.projects.push(project);return project;
      });
    }),
    getProject:wrap(async id=>{if(typeof id!=='string'||!ID.test(id))throw new StoreError('invalid_arguments','Use the original 32-character Forge project ID.');return exclusive(async()=>{const project=(await read()).projects.find(item=>item.id===id);if(!project)throw new StoreError('not_found','The saved Forge project was not found.');return clone(project);});}),
  });
}
