// SPDX-License-Identifier: Apache-2.0
// Synthetic host-only cross-engine journals. No vendor firmware or devices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountBrowserDevicesUi } from '../lib/fm1-browser-devices-ui.mjs';
import { createCommonUpdater } from '../lib/browser-common/index.mjs';
import { AttemptStore } from '../lib/browser-common/journal.mjs';
import { DEFAULT_TIMING as COMMON_TIMING } from '../lib/browser-common/updater.mjs';
import { unhex } from '../lib/browser-common/protocol.mjs';
import { createBrowserStockUpdater, STOCK } from '../lib/browser-stock/index.mjs';
import { DEFAULT_TIMING as STOCK_TIMING } from '../lib/browser-stock/updater.mjs';
import { openJournalDatabase, ensureStorageScope, BrowserAttemptJournal } from '../lib/browser-stock/journal.mjs';
import { packageFixture, cryptoFixture, fakeIndexedDB, fakeLocks, fakeMidi } from './browser-common-fixture.mjs';
const origin='https://native-panel.test',user={isTrusted:true},attemptId='a'.repeat(32),reviewId='b'.repeat(32);
const timing={open:0,start:0,reply:0,terminal:0,handshake:20,arm:20,poll:2,idleCheck:10,idleWrite:10,loader:20,reboot:20,enumerate:1,total:1000};
const capabilities={secureContext:true,midi:{apiAvailable:true,policy:'allowed'},serial:{apiAvailable:true,policy:'allowed'}};
function stockPackage(){
  const data=new Uint8Array(STOCK.rawBytes);
  for(let n=0;n<20;n++)data[n*48+47]=n<STOCK.product.length?STOCK.product.charCodeAt(n)+n+1:125;
  return data;
}
async function setup(){
  const commonPackage=await packageFixture(),stockBytes=stockPackage(),databases=new Map(),locks=fakeLocks();
  const crypto={...cryptoFixture,subtle:{async digest(algorithm,input){
    // Explicit test-only hash facade for the synthetic stock-size byte array.
    if(input.byteLength===STOCK.rawBytes)return unhex(STOCK.sha256).buffer;
    return cryptoFixture.subtle.digest(algorithm,input);
  }}};
  const indexedDB={open(name){if(!databases.has(name))databases.set(name,fakeIndexedDB());return databases.get(name).indexedDB.open();}};
  const file=(name,bytes)=>({name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer});
  const commonFile=file('custom.fwsc',commonPackage.bytes),stockFile=file('official.fwsc',stockBytes),manifestFile={name:'custom.json',size:2000,text:async()=>JSON.stringify(commonPackage.manifest)};
  const panel=async()=>{
    const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,hidden:true,open:false,style:{},dataset:{},files:[],removeAttribute(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(){}});return nodes.get(id);};
    const stockOptions={identity:'FM-1_014',name:'FM-1'},commonOptions={};
    const stockMidi=fakeMidi(stockOptions),commonMidi=fakeMidi(commonOptions);let stock,common;
    class Serial{getState(){return {connected:false};}async close(){}async dispose(){}async connect(){throw new Error('No serial IO in this fixture');}}
    const runtime={navigator:{},crypto,indexedDB,isSecureContext:true,location:{origin},document:{hidden:false},addEventListener(){}};
    const controller=mountBrowserDevicesUi({el,runtime,SerialClass:Serial,capabilityReport:capabilities,
      stockFactory:options=>(stock=createBrowserStockUpdater({...options,navigator:stockMidi.navigator,indexedDB,crypto,locks,location:{origin},secureContext:true,timing:{...STOCK_TIMING,...timing}})),
      commonFactory:options=>(common=createCommonUpdater({...options,navigator:commonMidi.navigator,indexedDB,crypto,locks,location:{origin},secureContext:true,timing:{...COMMON_TIMING,...timing}}))});
    await controller.ready;
    return {controller,el,stock,common,stockMidi,commonMidi,stockOptions,commonOptions,
      async reviewCommon(){await controller.common.selectManifest(manifestFile);await controller.common.selectPackage(commonFile);controller.common.stage(user);},
      async reviewStock(){await controller.selectPackage(stockFile);controller.stage(user);}};
  };
  const first=await panel(),second=await panel();
  return {first,second,databases,locks,indexedDB,crypto,commonPackage,stockBytes,stockFile,commonFile};
}
const record=(s,name)=>s.databases.get(name)?.records.get('current');
const COMMON_DB='fm1-common-sysex-v1',STOCK_DB='fm1-forge-stock-sysex-v1';
async function seedCommon(s,state){
  const store=new AttemptStore({indexedDB:s.indexedDB,crypto:s.crypto,origin,secureContext:true});await store.initialize();
  const journal=await store.prepare({attemptId,reviewId,pair:{inputId:'normal-input',outputId:'normal-output',inputName:'FM-1 Forge',outputName:'FM-1 Forge'},manifest:s.commonPackage.manifest});
  if(state!=='prepared')await journal.transition('entering_check',{state});
  return journal;
}
async function seedStock(s,state){
  const db=await openJournalDatabase(s.indexedDB),scope=await ensureStorageScope(db,origin,s.crypto);
  const journal=await BrowserAttemptJournal.prepare(db,{jobId:attemptId,reviewId,pair:{inputId:'normal-input',outputId:'normal-output',inputName:'FM-1',outputName:'FM-1'},scope},s.crypto);
  if(state!=='prepared')await journal.transition('entering_check',{state});
  return journal;
}
test('two initially clean native panels: fresh common unknown blocks a cached stock writer before prepare/upgrade',async()=>{
  const s=await setup();await s.first.controller.connectCommon(user);await s.second.controller.connectMidi(user);
  assert.equal(s.second.common.status().recoveryRequired,false);s.first.commonOptions.failTrigger=true;await s.first.reviewCommon();
  await assert.rejects(s.first.controller.common.confirm(user));assert.equal(record(s,COMMON_DB).state,'unknown');
  assert.equal(s.second.common.status().recoveryRequired,false);await s.second.reviewStock();assert.ok(s.second.controller.state().review);
  const evidence=JSON.stringify(record(s,COMMON_DB));await assert.rejects(s.second.controller.confirm(user),{code:'opposite_recovery_required'});
  assert.equal(record(s,STOCK_DB),undefined);assert.equal(s.second.stockMidi.calls.triggers,0);assert.equal(JSON.stringify(record(s,COMMON_DB)),evidence);
});
test('two initially clean native panels: fresh stock unknown blocks cached common writer before prepare/ARM/trigger',async()=>{
  const s=await setup();await s.first.controller.connectMidi(user);await s.second.controller.connectCommon(user);
  assert.equal(s.second.stock.status().recoveryRequired,false);s.first.stockOptions.failTrigger=true;await s.first.reviewStock();
  await assert.rejects(s.first.controller.confirm(user));assert.equal(record(s,STOCK_DB).state,'unknown');
  assert.equal(s.second.stock.status().recoveryRequired,false);await s.second.reviewCommon();assert.ok(s.second.controller.common.snapshot().review);
  const evidence=JSON.stringify(record(s,STOCK_DB));await assert.rejects(s.second.controller.common.confirm(user),{code:'opposite_recovery_required'});
  assert.equal(record(s,COMMON_DB),undefined);assert.equal(s.second.commonMidi.calls.arms,0);assert.equal(s.second.commonMidi.calls.triggers,0);assert.equal(JSON.stringify(record(s,STOCK_DB)),evidence);
});
test('prepared/active opposite records are freshly rejected in both directions despite clean cached UI state',async()=>{
  for(const state of ['prepared','active']){
    let s=await setup();await s.second.controller.connectMidi(user);await seedCommon(s,state);await s.second.reviewStock();
    await assert.rejects(s.second.controller.confirm(user),{code:'opposite_recovery_required'});assert.equal(record(s,STOCK_DB),undefined);assert.equal(s.second.stockMidi.calls.triggers,0);
    s=await setup();await s.second.controller.connectCommon(user);await seedStock(s,state);await s.second.reviewCommon();
    await assert.rejects(s.second.controller.common.confirm(user),{code:'opposite_recovery_required'});assert.equal(record(s,COMMON_DB),undefined);assert.equal(s.second.commonMidi.calls.arms,0);
  }
});
test('stock resume also reads the fresh common journal inside its held lock and preserves both original attempts',async()=>{
  const s=await setup();await seedStock(s,'unknown');await seedCommon(s,'unknown');s.second.stockMidi.replace('loader');await s.second.stock.connect();
  const stockBefore=JSON.stringify(record(s,STOCK_DB)),commonBefore=JSON.stringify(record(s,COMMON_DB));
  await assert.rejects(s.second.stock.resume({jobId:attemptId,reviewId,packageBytes:s.stockBytes}),{code:'opposite_recovery_required'});
  assert.equal(s.second.stockMidi.calls.triggers,0);assert.equal(JSON.stringify(record(s,STOCK_DB)),stockBefore);assert.equal(JSON.stringify(record(s,COMMON_DB)),commonBefore);
});
test('opposite journal scope/read failures block both engines without preparing or replacing evidence',async()=>{
  let s=await setup();await s.second.controller.connectMidi(user);s.databases.get(COMMON_DB).records.get('scope').sentinel=s.crypto.randomUUID();
  const commonBefore=JSON.stringify([...s.databases.get(COMMON_DB).records]);await s.second.reviewStock();
  await assert.rejects(s.second.controller.confirm(user),{code:'opposite_storage_unavailable'});assert.equal(record(s,STOCK_DB),undefined);assert.equal(s.second.stockMidi.calls.triggers,0);assert.equal(JSON.stringify([...s.databases.get(COMMON_DB).records]),commonBefore);
  s=await setup();await s.second.controller.connectCommon(user);s.databases.get(STOCK_DB).records.get('scope').sentinel=s.crypto.randomUUID();
  const stockBefore=JSON.stringify([...s.databases.get(STOCK_DB).records]);await s.second.reviewCommon();
  await assert.rejects(s.second.controller.common.confirm(user),{code:'opposite_storage_unavailable'});assert.equal(record(s,COMMON_DB),undefined);assert.equal(s.second.commonMidi.calls.arms,0);assert.equal(JSON.stringify([...s.databases.get(STOCK_DB).records]),stockBefore);
});
