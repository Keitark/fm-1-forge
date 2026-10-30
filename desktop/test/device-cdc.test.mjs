import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceService } from '../lib/device-service.mjs';

const proof = changes => ({identity:'MOD-EDITOR/1',transport:'cdc',build_sha256:'1'.repeat(64),location_sha256:'2'.repeat(64),instance_sha256:'3'.repeat(64),nonceVerified:true,...changes});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture({inspector,platform='win32'}={}) {
  let value=proof(),reads=0,acquired=0,released=0;
  const service=createDeviceService({platform,cdcInspector:async()=>{reads++;return inspector?inspector():value;},backendFactory:async()=>assert.fail('CDC must not start a MIDI backend'),ownerFactory:()=>({async acquire(){acquired++;},async release(){released++;}})});
  return {service,set:value2=>{value=value2;},get reads(){return reads;},get acquired(){return acquired;},get released(){return released;}};
}
test('CDC connect is a fixed fresh proof only and publishes build/generation without COM or physical identifiers',async()=>{
  const f=fixture();assert.equal((await f.service.getStatus()).connected,false);assert.equal(f.reads,0);
  const status=await f.service.connect({transport:'usb-serial'});assert.equal(status.identity,'MOD-EDITOR/1');assert.equal(status.buildSha256,'1'.repeat(64));assert.equal(status.transport,'usb-serial');assert.equal(Number.isInteger(status.generation),true);
  assert.equal(/COM|location_sha256|instance_sha256/.test(JSON.stringify(status)),false);assert.equal(f.reads,1);
  await f.service.getStatus();assert.equal(f.reads,2);await f.service.close();
});
test('malformed or unavailable CDC proof never leaves a connected source',async()=>{
  for(const change of [{identity:'OTHER'},{nonceVerified:false},{transport:'serial'},{build_sha256:'0'.repeat(64)},{location_sha256:null},{instance_sha256:'unsafe'}]){
    const f=fixture();f.set(proof(change));await assert.rejects(f.service.connect({transport:'usb-serial'}));assert.equal((await f.service.getStatus()).connected,false);assert.equal(f.released>0,true);await f.service.close();
  }
  const mac=fixture({platform:'darwin'});await assert.rejects(mac.service.connect({transport:'usb-serial'}),{code:'unsupported_transport'});assert.equal(mac.reads,0);await mac.service.close();
});
test('CDC source build/instance/location changes invalidate refresh or reviewed writer handoff',async()=>{
  for(const field of ['build_sha256','location_sha256','instance_sha256']){
    const f=fixture();await f.service.connect({transport:'usb-serial'});const reviewed=await f.service.reviewCdcEndpoint();f.set(proof({[field]:'4'.repeat(64)}));
    await assert.rejects(f.service.acquireCdcWriter(reviewed),{code:'device_changed'});const refreshed=await f.service.getStatus();assert.equal(refreshed.connected,false);await f.service.close();
  }
});
test('one CDC lease survives personality changes and blocks all connection operations until release',async()=>{
  const f=fixture();await f.service.connect({transport:'usb-serial'});const reviewed=await f.service.reviewCdcEndpoint();const lease=await f.service.acquireCdcWriter(reviewed);
  f.set(null);const before=f.reads;assert.equal((await f.service.getStatus()).connected,true);assert.equal(f.reads,before);
  await assert.rejects(f.service.disconnect(),{code:'device_busy'});await assert.rejects(f.service.connect({transport:'stock-midi'}),{code:'device_busy'});
  await lease.release();await lease.release();assert.equal((await f.service.getStatus()).connected,false);await f.service.close();
});
test('a retained uncertain protected worker prevents a later device shutdown from releasing its lease',async()=>{
  const f=fixture();await f.service.connect({transport:'usb-serial'});const lease=await f.service.acquireCdcWriter(await f.service.reviewCdcEndpoint());const before=f.released;
  lease.retain();await assert.rejects(lease.release(),{code:'close_failed'});await assert.rejects(f.service.close(),{code:'close_failed'});assert.equal(f.released,before);
});
test('fixed boot observations share the same device lease without pretending to identify a CDC source',async()=>{
  const f=fixture();const lease=await f.service.acquireCdcObservation();assert.equal(f.reads,0);assert.equal(f.acquired,1);
  await assert.rejects(f.service.connect({transport:'usb-serial'}),{code:'device_busy'});await lease.release();await f.service.close();
});
test('shutdown rejects a late CDC identity without committing a fresh connection',async()=>{
  const gate=deferred(),f=fixture({inspector:()=>gate.promise});const connecting=f.service.connect({transport:'usb-serial'});
  await new Promise(done=>setImmediate(done));const closing=f.service.close();gate.resolve(proof());await assert.rejects(connecting,{code:'service_closed'});await closing;
});
