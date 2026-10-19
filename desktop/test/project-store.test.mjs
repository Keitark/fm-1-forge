import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createProjectStore} from '../lib/project-store.mjs';
import {projectConfig} from '../../site/lib/fm1-forge-project.mjs';

const execute=promisify(execFile);
const defaultSettings={palette:'forge-black',pattern:'solid',entry_method:'auto',default_module:'diagnostics',default_usb_audio:true};
const config=()=>projectConfig({slug:'my-instrument',displayName:'My instrument',clockPreset:'sdk-default',clockOptIn:false,lcdPreset:'stock-dma',module:'user',usbAudio:true});
function legacy(value,version){const {hal,...other}=value,{uacCapture,midiUpdate,uvc,...usb}=value.usb;return {...other,schemaVersion:version,usb:{...usb,...(version===3?{uvc}:{})},...(version>1?{hal}:{})};}
async function fixture(t){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'fm1-project-store-')),directory=path.join(base,'data');
  t.after(async()=>{assert.ok(path.basename(base).startsWith('fm1-project-store-'));assert.equal(path.dirname(base),os.tmpdir());await fs.rm(base,{recursive:true,force:true});});
  return {base,directory,store:createProjectStore({directory}),file:path.join(directory,'forge-store.json'),lock:path.join(directory,'.forge-store.lock')};
}

test('settings survive fresh store instances and omitted independent values remain intact',async t=>{
  const f=await fixture(t);assert.deepEqual(await f.store.readSettings(),defaultSettings);assert.deepEqual(await f.store.listProjects(),[]);
  await f.store.updateSettings({palette:'fm1-mint',default_usb_audio:false});
  const second=createProjectStore({directory:f.directory});assert.equal((await second.readSettings()).default_usb_audio,false);
  await second.updateSettings({pattern:'dots'});assert.deepEqual(await f.store.readSettings(),{...defaultSettings,palette:'fm1-mint',pattern:'dots',default_usb_audio:false});
  assert.deepEqual((await fs.readdir(f.directory)).filter(name=>name.endsWith('.tmp')||name.endsWith('.lock')),[]);
});

test('drafts persist with strong IDs, schema v4 and independent return values without creating project folders',async t=>{
  const f=await fixture(t),selected=config(),saved=await f.store.saveProject({config:selected});
  assert.match(saved.id,/^[a-f0-9]{32}$/);assert.equal(saved.state,'configuration_draft');assert.equal(saved.resource_uri,'fm1-forge://projects/'+saved.id);assert.deepEqual(saved.config,selected);
  saved.config.usb.midiUpdate=false;selected.project.displayName='Mutated caller';
  const reopened=createProjectStore({directory:f.directory}),read=await reopened.getProject(saved.id);assert.equal(read.config.usb.midiUpdate,true);assert.equal(read.title,'My instrument');assert.equal(read.config.schemaVersion,4);
  const changed=config();changed.project.displayName='Updated title';const updated=await reopened.saveProject({config:changed,project_id:saved.id});
  assert.equal(updated.created,read.created);assert.ok(updated.updated>=read.updated);assert.equal((await f.store.listProjects()).length,1);assert.equal((await f.store.getProject(saved.id)).title,'Updated title');
  assert.deepEqual(await fs.readdir(f.directory),['forge-store.json']);
});

test('parallel independent processes preserve partial settings and cannot lose one another drafts',async t=>{
  const f=await fixture(t),moduleUrl=new URL('../lib/project-store.mjs',import.meta.url).href;
  const code="import {createProjectStore} from "+JSON.stringify(moduleUrl)+"; const store=createProjectStore({directory:process.argv[1]}); const input=JSON.parse(process.argv[2]); await store.updateSettings(input.settings); console.log(JSON.stringify(await store.saveProject({config:input.config})));";
  const inputs=[{settings:{palette:'signal-red'},config:config()},{settings:{pattern:'dots'},config:config()},{settings:{default_module:'user',default_usb_audio:false},config:config()}];
  const settled=await Promise.allSettled(inputs.map(input=>execute(process.execPath,['--input-type=module','-e',code,f.directory,JSON.stringify(input)],{windowsHide:true,timeout:10000})));
  for(const result of settled)if(result.status==='rejected')throw result.reason;const results=settled.map(result=>result.value);
  const ids=results.map(result=>JSON.parse(result.stdout).id);assert.equal(new Set(ids).size,3);assert.equal((await f.store.listProjects()).length,3);
  assert.deepEqual(await f.store.readSettings(),{...defaultSettings,palette:'signal-red',pattern:'dots',default_module:'user',default_usb_audio:false});
});

test('simultaneous readers and writers share committed snapshots without partial JSON',async t=>{
  const f=await fixture(t),other=createProjectStore({directory:f.directory});await f.store.saveProject({config:config()});
  await Promise.all(Array.from({length:10},(_,index)=>index%2?other.updateSettings({pattern:index%3?'solid':'dots'}):f.store.listProjects().then(items=>{assert.equal(items.length,1);assert.equal(items[0].config.usb.uacCapture,true);})));
  assert.ok(['solid','dots'].includes((await f.store.readSettings()).pattern));
});

test('strict settings and arguments reject paths, unknown properties and malformed selections before saving',async t=>{
  const f=await fixture(t);await f.store.updateSettings({palette:'fm1-mint'});const before=await fs.readFile(f.file);
  for(const set of [{},{palette:'unknown'},{default_usb_audio:'false'},{entry_method:'sysex'},{path:'C:/private'},{pattern:null},[],null])await assert.rejects(f.store.updateSettings(set));
  for(const input of [{config:config(),path:'C:/private'},{config:config(),firmwareBytes:'not-metadata'},{config:config(),clock_opt_in:'yes'},{config:config(),project_id:'../escape'},{config:{...config(),extra:true}}])await assert.rejects(f.store.saveProject(input));
  const invalid=config();invalid.usb.uvc=true;await assert.rejects(f.store.saveProject({config:invalid}),/endpoint budget/);assert.deepEqual(await fs.readFile(f.file),before);
});

test('unknown saved IDs cannot create projects or overwrite a different draft',async t=>{
  const f=await fixture(t),saved=await f.store.saveProject({config:config()}),before=await fs.readFile(f.file);
  await assert.rejects(f.store.getProject('a'.repeat(32)),{code:'not_found'});await assert.rejects(f.store.saveProject({config:config(),project_id:'b'.repeat(32)}),{code:'not_found'});
  for(const id of ['',null,42,'../escape'])await assert.rejects(f.store.getProject(id));
  assert.deepEqual(await fs.readFile(f.file),before);assert.equal((await f.store.getProject(saved.id)).title,'My instrument');
});

test('legacy configs preserve intent and imported experimental clocks still require explicit confirmation',async t=>{
  const f=await fixture(t);
  for(const version of [1,2,3]){const old=legacy(config(),version),before=JSON.stringify(old),saved=await f.store.saveProject({config:old});assert.equal(saved.config.schemaVersion,4);assert.equal(saved.config.usb.midiUpdate,false);assert.equal(saved.config.usb.uacCapture,true);assert.equal(JSON.stringify(old),before);}
  const experimental=config();experimental.clockPreset='sdk-320';await assert.rejects(f.store.saveProject({config:experimental}),/Confirm the experimental CPU clock/);
  assert.equal((await f.store.saveProject({config:experimental,clock_opt_in:true})).config.clockPreset,'sdk-320');
  experimental.lcdPreset='spi30-rgb444';await assert.rejects(f.store.saveProject({config:experimental,clock_opt_in:true}),/incompatible/);
});

test('24-project quota is preserved while an existing project can still be updated',async t=>{
  const f=await fixture(t),saved=[];for(let index=0;index<24;index++)saved.push(await f.store.saveProject({config:config()}));
  await assert.rejects(f.store.saveProject({config:config()}),{code:'project_limit'});assert.equal((await f.store.listProjects()).length,24);
  await f.store.saveProject({config:config(),project_id:saved[0].id});assert.equal((await f.store.listProjects()).length,24);assert.equal(new Set(saved.map(item=>item.id)).size,24);
});

test('corrupt, oversized or tampered files never become a successful save and remain unchanged',async t=>{
  const f=await fixture(t);await f.store.saveProject({config:config()});const valid=JSON.parse(await fs.readFile(f.file,'utf8'));
  const duplicate=structuredClone(valid);duplicate.projects.push(duplicate.projects[0]);const badTitle=structuredClone(valid);badTitle.projects[0].title='Forged';
  for(const text of ['{unfinished',JSON.stringify({...valid,extra:true}),JSON.stringify(duplicate),JSON.stringify(badTitle),'x'.repeat(150000)]){
    await fs.writeFile(f.file,text);await assert.rejects(f.store.listProjects(),{code:'storage_corrupt'});await assert.rejects(f.store.updateSettings({pattern:'dots'}),{code:'storage_corrupt'});assert.equal(await fs.readFile(f.file,'utf8'),text);
  }
});

test('an existing stale lock is bounded, preserved and never stolen or replaced',async t=>{
  const f=await fixture(t);await f.store.updateSettings({palette:'fm1-mint'});const before=await fs.readFile(f.file);await fs.writeFile(f.lock,'foreign owner');await fs.utimes(f.lock,1,1);const stat=await fs.stat(f.lock),started=Date.now();
  await assert.rejects(f.store.updateSettings({pattern:'dots'}),{code:'storage_busy'});assert.ok(Date.now()-started<6000);assert.equal(await fs.readFile(f.lock,'utf8'),'foreign owner');assert.equal((await fs.stat(f.lock)).mtimeMs,stat.mtimeMs);assert.deepEqual(await fs.readFile(f.file),before);
});

test('relative, traversing and filesystem-root store paths are rejected',()=>{
  for(const directory of ['',null,'relative-store',path.parse(process.cwd()).root,path.join(os.tmpdir(),'safe')+path.sep+'..'+path.sep+'escape',os.tmpdir()+String.fromCharCode(0)+'bad'])assert.throws(()=>createProjectStore({directory}));
});

test('redirected directories and linked state files cannot write outside the chosen store',async t=>{
  const f=await fixture(t),outside=path.join(f.base,'outside'),redirect=path.join(f.base,'redirect');await fs.mkdir(outside);await fs.symlink(outside,redirect,process.platform==='win32'?'junction':'dir');
  await assert.rejects(createProjectStore({directory:path.join(redirect,'data')}).updateSettings({pattern:'dots'}),{code:'unsafe_storage_path'});assert.deepEqual(await fs.readdir(outside),[]);
  await f.store.updateSettings({palette:'fm1-mint'});const original=await fs.readFile(f.file),target=path.join(outside,'target.json');await fs.writeFile(target,original);await fs.unlink(f.file);
  if(process.platform==='win32')await fs.link(target,f.file);else await fs.symlink(target,f.file);
  await assert.rejects(f.store.updateSettings({pattern:'dots'}),{code:'unsafe_storage_path'});assert.deepEqual(await fs.readFile(target),original);
});
