// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mountBrowserDevicesUi, directDevicesHtml } from '../lib/fm1-browser-devices-ui.mjs';
import { STOCK } from '../lib/browser-stock/index.mjs';
import { WIRE } from '../lib/browser-common/index.mjs';

const user={isTrusted:true},synthetic={isTrusted:false},tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const manifest={schemaVersion:1,model:'FM-1',family:8,layout:'stock-single-v1',packageBytes:17460,packageSha256:'11'.repeat(32),
  imageBytes:17440,imageSha256:'22'.repeat(32),targetBuildSha256:'33'.repeat(32),targetIdentity:WIRE.commonIdentity,
  loaderSha256:WIRE.loaderSha256,baselineSha256:'44'.repeat(32),preservation:'unit-baseline-app-only',hardwareQualified:false};
const file={name:'my-firmware.fwsc',size:manifest.packageBytes},manifestFile={name:'my-firmware.json',size:2000,text:async()=>JSON.stringify(manifest)};
const pair={inputId:'common-in',outputId:'common-out',inputName:'FM-1 Forge',outputName:'FM-1 Forge'};
const scope={origin:'https://native-panel.test',sentinel:'scope',durableReady:true,locksAvailable:true};
const caps={secureContext:true,midi:{apiAvailable:true,policy:'allowed'},serial:{apiAvailable:true,policy:'allowed'}};
function fixture(options={}){
  const nodes=new Map(),calls=[],events=new Map(),changes=[];let serialPublish,stockPublish,commonPublish,stockSaved=options.stockSaved??null,commonSaved=options.commonSaved??null;
  const el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,hidden:true,open:false,value:'',files:[],style:{},dataset:{},attributes:new Map(),
    removeAttribute(key){this.attributes.delete(key);},setAttribute(key,value){this.attributes.set(key,value);},showModal(){this.open=true;},close(){this.open=false;},addEventListener(key,fn){this[key]=fn;}});return nodes.get(id);};
  let serialState={connected:false,profile:null},stockState={connected:false,identityVerified:false,storageScope:scope,updating:false,recoveryRequired:Boolean(stockSaved)},
    commonState={connected:false,durableReady:true,installAvailable:false,updating:false,recoveryRequired:Boolean(commonSaved),capabilities:null};
  class Serial{
    constructor({onState}){serialPublish=value=>{serialState={...serialState,...value};onState({...serialState});};}
    getState(){return {...serialState};}async connect(){calls.push('serial.connect');serialPublish({connected:true,profile:'MOD-EDITOR/1'});}
    async readStatus(){calls.push('serial.status');}async close(){calls.push('serial.close');serialPublish({connected:false});}async dispose(){calls.push('serial.dispose');}
  }
  const stockFactory=callbacks=>{
    stockPublish=value=>{stockState={...stockState,...value};callbacks.onState({...stockState});};
    return {status:()=>({...stockState}),async initialize(){calls.push('stock.storage');},async savedAttempt(){calls.push('stock.saved');return stockSaved;},
      async connect(){calls.push('stock.connect');stockPublish({connected:true,identityVerified:true,identity:'FM-1_014',pair:{inputId:'stock-in',outputId:'stock-out',inputName:'FM-1',outputName:'FM-1'}});},
      async disconnect(){calls.push('stock.disconnect');stockPublish({connected:false});},async probe(){calls.push('stock.probe');},
      async inspectPackage(input){calls.push({stockInspect:input});return {product:STOCK.product,raw_bytes:STOCK.rawBytes,sha256:STOCK.sha256};},
      async update(input){await callbacks.beforeWrite?.({operation:'update'});calls.push({stockUpdate:input});stockPublish({updating:true});if(options.stockPending)await options.stockPending;stockPublish({updating:false});return {jobId:input.jobId,sha256:STOCK.sha256,identity:STOCK.product,transfer_finished:true,boot_identity_verified:true,readback_verified:false};},
      async resume(){throw new Error('Resume must never be called by common UI');}};
  };
  const commonFactory=callbacks=>{
    commonPublish=value=>{commonState={...commonState,...value};callbacks.onState({...commonState});};
    return {status:()=>({...commonState}),async initialize(){calls.push('common.storage');if(options.storageError)throw new Error('Common storage unavailable');return commonSaved;},
      async savedAttempt(){calls.push('common.saved');return commonSaved;},async peekSavedAttempt(){return commonSaved;},
      async connect(){calls.push('common.connect');commonPublish({connected:true,identity:WIRE.commonIdentity,pair:{...pair},capabilities:{buildSha256:'55'.repeat(32),loader:options.loader??0,state:0,error:options.loader?0:3,installAvailable:options.loader===1},installAvailable:options.loader===1,...options.commonConnected});},
      async disconnect(){calls.push('common.disconnect');commonPublish({connected:false});},
      async probe(){calls.push('common.probe');if(options.probeError){commonPublish({connected:false});throw options.probeError;}return {...commonState};},
      async inspectPackage(input,value){calls.push({commonInspect:input,manifest:value});if(options.inspectPending)await options.inspectPending;return {manifest:{...value},details:{flashBytes:16384}};},
      async update(input){await callbacks.beforeWrite?.({operation:'update'});calls.push({commonUpdate:input});commonSaved={attemptId:input.attemptId,state:'active',phase:'entering_check'};commonPublish({updating:true});callbacks.onEvent({phase:'writing',progress:0.5});
        if(options.commonPending)await options.commonPending;
        if(options.commonError){commonSaved={...commonSaved,state:'unknown',phase:'writing'};commonPublish({updating:false,connected:false,recoveryRequired:true});throw options.commonError;}
        commonSaved={...commonSaved,state:'succeeded',phase:'done',transferFinished:true,bootIdentityVerified:true};commonPublish({updating:false,connected:true,capabilities:{...commonState.capabilities,buildSha256:manifest.targetBuildSha256}});
        return {attemptId:input.attemptId,packageSha256:manifest.packageSha256,identity:WIRE.commonIdentity,buildSha256:manifest.targetBuildSha256,
          transferFinished:true,bootIdentityVerified:true,readbackVerified:false,hardwareQualified:false,...options.result};}
    };
  };
  let identifiers=0;const runtime={navigator:{serial:{}},document:{hidden:false},isSecureContext:true,location:{origin:'https://native-panel.test'},crypto:{randomUUID:()=>String(++identifiers).padStart(32,'0')},addEventListener:(name,fn)=>events.set(name,fn)};
  const controller=mountBrowserDevicesUi({el,runtime,SerialClass:Serial,stockFactory,commonFactory,capabilityReport:caps,onChange:value=>changes.push(value)});
  const select=async()=>{await controller.common.selectManifest(manifestFile);await controller.common.selectPackage(file);};
  return {controller,el,calls,events,changes,select,stockPublish:value=>stockPublish(value),commonPublish:value=>commonPublish(value),serialPublish:value=>serialPublish(value)};
}
test('native Forge markup contains separate common connection/files/dialog and leaves stock markup intact',()=>{
  for(const id of ['direct-connect-common','direct-common-manifest','direct-common-file','direct-common-dialog','direct-common-progress','direct-stock-file','direct-stock-dialog'])assert.ok(directDevicesHtml.includes('id="'+id+'"'));
  assert.match(directDevicesHtml,/Connect firmware MIDI/);assert.match(directDevicesHtml,/Stock firmware · V15 SysEx update/);assert.doesNotMatch(directDevicesHtml,/<iframe|hardware.activity|job.ID.inspector/i);
});
test('mount reads both local journals in sequence and never connects or resumes automatically',async()=>{
  const f=fixture();await f.controller.ready;assert.deepEqual(f.calls,['stock.storage','stock.saved','common.storage']);assert.equal(f.el('device-heading').textContent,'FM-1 disconnected');
  assert.equal(f.el('direct-common-review').disabled,true);await f.controller.connectCommon(synthetic);assert.ok(!f.calls.includes('common.connect'));f.controller.dispose();
});
test('common storage failure settles initialization and leaves a visible disabled state',async()=>{
  const f=fixture({storageError:true});await f.controller.ready;assert.equal(f.controller.common.snapshot().restoring,false);
  assert.equal(f.controller.common.snapshot().durableReady,false);assert.match(f.el('direct-common-note').textContent,/Common storage unavailable/);
  assert.doesNotMatch(f.el('direct-common-note').textContent,/Checking local recovery storage/);assert.equal(f.el('direct-common-review').disabled,true);assert.ok(!f.calls.includes('common.connect'));f.controller.dispose();
});
test('blocked common MIDI identity is shown as connected/install unavailable; refresh keeps status stable and only blinks circle',async()=>{
  const f=fixture();await f.controller.ready;await f.controller.connectCommon(user);assert.match(f.el('device-heading').textContent,/FM-1 via firmware MIDI/);assert.match(f.el('device-summary').textContent,/installation unavailable/);
  assert.equal(f.el('connection-label').textContent,'Device connected');assert.match(f.el('update-mode').textContent,/install unavailable/);await f.select();f.controller.common.stage(user);await f.controller.common.confirm(user);
  assert.equal(f.el('direct-common-review').disabled,true);assert.ok(!f.calls.some(row=>row?.commonUpdate));
  const stable=f.el('device-heading').textContent,count=f.calls.length,refresh=f.controller.refresh();assert.equal(f.el('device-heading').textContent,stable);assert.equal(f.el('connection-check').hidden,false);await refresh;
  assert.equal(f.el('device-heading').textContent,stable);assert.equal(f.el('connection-check').hidden,true);assert.deepEqual(f.calls.slice(count),['common.probe']);f.controller.dispose();
});
test('real common disconnect and failed refresh cannot retain identity-confirmed success notices',async()=>{
  let f=fixture({loader:1});await f.controller.ready;await f.controller.connectCommon(user);
  assert.match(f.el('direct-device-note').textContent,/confirmed/);f.commonPublish({connected:false});
  assert.equal(f.el('device-heading').textContent,'FM-1 disconnected');assert.doesNotMatch(f.el('direct-device-note').textContent,/connected\.|identity.*confirmed/i);assert.doesNotMatch(f.el('direct-common-note').textContent,/identity confirmed/i);f.controller.dispose();
  f=fixture({loader:1,probeError:new Error('Firmware MIDI reply timed out')});await f.controller.ready;await f.controller.connectCommon(user);await assert.rejects(f.controller.refresh(),/reply timed out/);
  assert.equal(f.el('device-heading').textContent,'FM-1 disconnected');assert.match(f.el('direct-device-note').textContent,/reply timed out/);assert.match(f.el('direct-common-note').textContent,/reply timed out/);assert.equal(f.el('connection-check').hidden,true);f.controller.dispose();
});
test('common review has independent trusted cancel/confirm, exact files and one update on double click',async()=>{
  const f=fixture({loader:1});await f.controller.ready;await f.controller.connectCommon(user);await f.select();f.controller.common.stage(synthetic);assert.equal(f.el('direct-common-dialog').open,false);
  f.controller.common.stage(user);assert.equal(f.el('direct-common-dialog').open,true);assert.match(f.el('direct-common-review-text').textContent,new RegExp(manifest.packageSha256));
  await f.controller.common.confirm(synthetic);assert.ok(!f.calls.some(row=>row?.commonUpdate));f.controller.common.cancel();await f.controller.common.confirm(user);assert.ok(!f.calls.some(row=>row?.commonUpdate));
  f.controller.common.stage(user);const first=f.controller.common.confirm(user);await f.controller.common.confirm(user);await first;
  const updates=f.calls.filter(row=>row?.commonUpdate);assert.equal(updates.length,1);assert.equal(updates[0].commonUpdate.packageBytes,file);assert.equal(updates[0].commonUpdate.manifest.packageSha256,manifest.packageSha256);
  assert.match(f.el('direct-common-transfer-status').textContent,/identity and build digest verified.*qualification pending/);assert.ok(!f.calls.some(row=>row?.stockUpdate));f.controller.dispose();
});
test('common transfer blocks serial/stock changes, disconnect, file replacement and teardown',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});const f=fixture({loader:1,commonPending:pending});await f.controller.ready;await f.controller.connectCommon(user);await f.select();f.controller.common.stage(user);
  const active=f.controller.common.confirm(user);assert.equal(f.el('direct-disconnect').disabled,true);assert.equal(f.el('direct-connect-serial').disabled,true);assert.equal(f.el('direct-connect-midi').disabled,true);assert.equal(f.el('direct-common-file').disabled,true);
  await f.controller.connectSerial(user);await f.controller.connectMidi(user);await f.controller.disconnect(user);await f.controller.common.selectPackage({name:'replacement.fwsc'});
  assert.ok(!f.calls.includes('serial.connect'));assert.ok(!f.calls.includes('stock.connect'));assert.ok(!f.calls.includes('common.disconnect'));
  const before={preventDefault(){this.prevented=true;}};f.events.get('beforeunload')(before);assert.equal(before.prevented,true);
  f.controller.dispose();assert.ok(!f.calls.includes('serial.dispose'));assert.ok(!f.calls.includes('common.disconnect'));release();await active;assert.equal(f.calls.filter(row=>row?.commonUpdate).length,1);
});
test('stock transfer blocks common connect and its separate review action',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});const f=fixture({loader:1,stockPending:pending});await f.controller.ready;await f.controller.connectMidi(user);await f.controller.selectPackage({name:'official.fwsc'});f.controller.stage(user);
  const active=f.controller.confirm(user);await f.controller.connectCommon(user);f.controller.common.stage(user);assert.ok(!f.calls.includes('common.connect'));assert.ok(!f.calls.some(row=>row?.commonUpdate));release();await active;f.controller.dispose();
});
test('unknown common attempt survives panel mount and blocks new stock/common writes while allowing read-only connection',async()=>{
  const saved={attemptId:'a'.repeat(32),state:'unknown',phase:'writing'},f=fixture({loader:1,commonSaved:saved});await f.controller.ready;assert.match(f.el('direct-common-note').textContent,/original custom update is unresolved/);
  assert.ok(!f.calls.includes('common.connect'));assert.match(f.el('direct-common-phase').textContent,new RegExp(saved.attemptId));await f.controller.connectCommon(user);await f.select();f.controller.common.stage(user);assert.equal(f.el('direct-common-dialog').open,false);
  await f.controller.connectMidi(user);await f.controller.selectPackage({name:'official.fwsc'});f.controller.stage(user);await f.controller.confirm(user);assert.equal(f.el('direct-stock-review').disabled,true);assert.ok(!f.calls.some(row=>row?.stockUpdate));f.controller.dispose();
});
test('unknown stock attempt blocks a new common review without modifying its original recovery data',async()=>{
  const saved={jobId:'b'.repeat(32),reviewId:'c'.repeat(32),state:'unknown',sha256:STOCK.sha256},f=fixture({loader:1,stockSaved:saved});await f.controller.ready;await f.controller.connectCommon(user);await f.select();f.controller.common.stage(user);
  assert.equal(f.el('direct-common-review').disabled,true);assert.equal(f.controller.state().attempt.jobId,saved.jobId);assert.ok(!f.calls.some(row=>row?.commonUpdate));f.controller.dispose();
});
test('failed common transfer retains original uncertain attempt and never automatically replays it',async()=>{
  const error=Object.assign(new Error('Lost common reply'),{recoveryRequired:true}),f=fixture({loader:1,commonError:error});await f.controller.ready;await f.controller.connectCommon(user);await f.select();f.controller.common.stage(user);
  const original=f.controller.common.snapshot().review;await assert.rejects(f.controller.common.confirm(user),/Lost common reply/);assert.equal(f.controller.common.snapshot().attempt.attemptId,original.attemptId);assert.equal(f.controller.common.snapshot().attempt.state,'unknown');
  await f.controller.connectCommon(user);f.controller.common.stage(user);await f.controller.common.confirm(user);assert.equal(f.calls.filter(row=>row?.commonUpdate).length,1);f.controller.dispose();
});
test('file/identity changes invalidate common review and stale manifest reads cannot replace the latest selection',async()=>{
  const f=fixture({loader:1});await f.controller.ready;await f.controller.connectCommon(user);await f.select();f.controller.common.stage(user);
  f.commonPublish({capabilities:{buildSha256:'66'.repeat(32),loader:1,state:0},installAvailable:true});assert.equal(f.el('direct-common-dialog').open,false);await f.controller.common.confirm(user);assert.ok(!f.calls.some(row=>row?.commonUpdate));
  f.controller.common.stage(user);await f.controller.common.selectPackage(file);await f.controller.common.confirm(user);assert.ok(!f.calls.some(row=>row?.commonUpdate));
  let resolveOld;const old=f.controller.common.selectManifest({name:'old.json',size:2000,text:()=>new Promise(resolve=>{resolveOld=resolve;})});
  const latest={...manifest,targetBuildSha256:'77'.repeat(32)};await f.controller.common.selectManifest({name:'latest.json',size:2000,text:async()=>JSON.stringify(latest)});resolveOld(JSON.stringify(manifest));await old;
  assert.equal(f.calls.filter(row=>row?.commonInspect).at(-1).manifest.targetBuildSha256,latest.targetBuildSha256);f.controller.dispose();
});
test('core reuse remains Apache-scoped and has no helper/cloud firmware/device fallback',async()=>{
  const path=new URL('../lib/browser-common/',import.meta.url);
  for(const file of ['index','journal','package','protocol','updater','web-midi']){const text=await fs.readFile(new URL(file+'.mjs',path),'utf8');assert.match(text,/SPDX-License-Identifier: Apache-2\.0/);assert.doesNotMatch(text,/child_process|(?:from\s*|import\s*\()["'](?:node:|\.\.\/)|fetch\s*\(|WebSocket/);}
  assert.match(await fs.readFile(new URL('LICENSE',path),'utf8'),/Apache License/);assert.match(await fs.readFile(new URL('NOTICE',path),'utf8'),/Copyright 2026 Keitarou Kondou/);
});
