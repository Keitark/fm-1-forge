import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runCustomUpdate } from '../custom-updater.mjs';
import { upgradeCommand } from '../protocol.mjs';
import { capabilityQuery, encodeFrame } from '../../../../site/lib/browser-common/protocol.mjs';
import { mockUpdater, equalBytes } from './helpers.mjs';

const target='b'.repeat(64), sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function capabilities({build=target,state=0,loader=0,error=3,family=8}={}){
  const p=new Uint8Array(47);p.set([70,77,67,49,1,family,state,loader,0,2,0,0,16,0]);p.set(Buffer.from(build,'hex'),14);p[46]=error;return encodeFrame(0x31,p);
}
function fixture({resume=false,identity='FM1_FORGE_001',caps={},noCaps=false,ambiguous=false,...settings}={}){
  const m=mockUpdater({resume,initialIdentity:'FM-1_015',loaderIdentity:'ota-FM-1_015',bootIdentity:identity,...settings});
  const image=m.image.slice(0,623136),config={...m.config,operation:resume?'resume':'install',expectedInitialIdentity:resume?'ota-FM-1_015':'FM-1_015',logicalBytes:image.length,logicalSha256:sha(image),reviewedSha256:'a'.repeat(64),targetBuildSha256:target};
  let reboot=false,queries=0;
  const enumerate=m.backend.enumerate.bind(m.backend),open=m.backend.open.bind(m.backend),transition=m.journal.transition.bind(m.journal);
  m.journal.transition=async(phase,extra)=>{if(phase==='waiting_reboot')reboot=true;return transition(phase,extra);};
  m.backend.enumerate=async(...args)=>{const inventory=await enumerate(...args);if(!reboot)return inventory;return {inputs:ambiguous?['FM-1 Forge 1','FM-1 Forge 2']:['FM-1 Forge 1'],outputs:ambiguous?['FM-1 Forge 3','FM-1 Forge 4']:['FM-1 Forge 2']};};
  m.backend.open=async pair=>{const link=await open(pair),pending=[],send=link.send.bind(link),read=link.read.bind(link);link.send=async packet=>{const result=await send(packet);if(equalBytes(packet,capabilityQuery())){queries++;if(!noCaps)pending.push(capabilities(caps));}return result;};link.read=ms=>pending.length?Promise.resolve(pending.shift()):read(ms);return link;};
  return {...m,config,options:{...m.options,image,backend:m.backend,journal:m.journal},image,get capabilityQueries(){return queries;},get opens(){return m.opens;},get closed(){return m.closed;}};
}
const upgrades=m=>m.sent.filter(packet=>equalBytes(packet,upgradeCommand())).length;

test('custom two-phase transfer verifies common identity and exact idle build with installation disabled',async()=>{
  const m=fixture(),result=await runCustomUpdate(m.config,m.options);
  assert.equal(result.state,'succeeded');assert.equal(result.identity,'FM1_FORGE_001');assert.equal(result.build_sha256,target);assert.equal(result.boot_build_verified,true);assert.equal(result.boot_identity_verified,true);assert.equal(result.readback_verified,false);
  assert.equal(m.capabilityQueries,1);assert.equal(upgrades(m),2);assert.equal(m.journal.record.final_build_sha256,target);assert.equal(m.journal.record.boot_build_verified,true);
});

test('custom explicit resume uses the original OTA phase and exact pinned loader',async()=>{
  const m=fixture({resume:true});assert.equal((await runCustomUpdate(m.config,m.options)).state,'succeeded');assert.equal(upgrades(m),1);assert.equal(m.transitions.some(step=>step.phase==='checking'),false);
  const changed=fixture({resume:true,loaderIdentity:'ota-FM-1_009'});await assert.rejects(runCustomUpdate(changed.config,changed.options),error=>error.code==='device_changed'&&error.state==='unknown');assert.equal(upgrades(changed),0);
});

test('changed source identity or logical image never sends an upgrade command',async()=>{
  const changed=fixture({initialIdentity:'FM-1_014'});await assert.rejects(runCustomUpdate(changed.config,changed.options),error=>error.code==='device_changed'&&!error.destructive_started);assert.equal(upgrades(changed),0);
  for(const modify of [m=>m.config.logicalSha256='0'.repeat(64),m=>m.config.targetBuildSha256='',m=>m.config.logicalBytes++,m=>m.config.operation='update',m=>m.config.expectedInitialIdentity='FM-1_014']){
    const m=fixture();modify(m);await assert.rejects(runCustomUpdate(m.config,m.options),error=>error.code==='invalid_package');assert.equal(m.sent.length,0);assert.equal(m.transitions.length,0);
  }
});

test('a different loader after checking never enters custom write',async()=>{
  const m=fixture({loaderIdentity:'ota-FM-1_009'});await assert.rejects(runCustomUpdate(m.config,m.options),error=>error.code==='wrong_loader'&&error.state==='unknown');assert.equal(upgrades(m),1);assert.equal(m.transitions.some(step=>step.phase==='entering_write'),false);
});

test('wrong final identity, family, state or build cannot establish completion',async()=>{
  for(const settings of [{identity:'FM-1_015'},{caps:{build:'c'.repeat(64)}},{caps:{family:9}},{caps:{state:1,error:0}},{caps:{error:1}}]){
    const m=fixture(settings);await assert.rejects(runCustomUpdate(m.config,m.options),error=>error.state==='unknown'&&error.transfer_finished===true&&error.boot_identity_verified===false&&error.boot_build_verified===false);assert.notEqual(m.journal.record.state,'succeeded');assert.equal(m.journal.record.boot_build_verified,false);
  }
});

test('missing capability or ambiguous final endpoints preserves uncertain original transfer',async()=>{
  for(const settings of [{noCaps:true},{ambiguous:true}]){
    const m=fixture(settings);await assert.rejects(runCustomUpdate(m.config,m.options),error=>error.state==='unknown'&&error.recovery_required&&error.transfer_finished);assert.equal(upgrades(m),2);assert.notEqual(m.journal.record.state,'succeeded');
  }
});

test('durability failure before upgrade and send loss afterward retain their correct boundary',async()=>{
  const disk=fixture();disk.journal.transition=async()=>{throw new Error('full');};await assert.rejects(runCustomUpdate(disk.config,disk.options));assert.equal(upgrades(disk),0);
  const send=fixture({failSendAt:2});await assert.rejects(runCustomUpdate(send.config,send.options),error=>error.state==='unknown'&&error.recovery_required);assert.equal(upgrades(send),1);
});

test('tracker uses stock MIDI for both OTA phases then requires fresh exact CDC proof without postboot MIDI', async () => {
  const m = fixture(); m.config.profile = 'protracker'; let calls = 0;
  const result = await runCustomUpdate(m.config, { ...m.options, verifyTracker: async request => {
    calls++; assert.equal(m.closed, 2); assert.equal(request.buildSha256, target);
    return { text: 'MOD-EDITOR/1', buildSha256: target, transport: 'cdc', nonceVerified: true };
  } });
  assert.equal(result.identity, 'MOD-EDITOR/1'); assert.equal(result.boot_build_verified, true);
  assert.equal(calls, 1); assert.equal(m.capabilityQueries, 0); assert.equal(m.opens, 2); assert.equal(upgrades(m), 2);
});
test('tracker missing verifier rejects before update; failed or mismatched CDC preserves completed original transfer', async () => {
  const absent = fixture(); absent.config.profile = 'protracker';
  await assert.rejects(runCustomUpdate(absent.config, absent.options), { code: 'cdc_unavailable' }); assert.equal(upgrades(absent), 0);
  for (const proof of [null, { text: 'MOD-EDITOR/1', buildSha256: 'c'.repeat(64), transport: 'cdc', nonceVerified: true }, { text: 'MOD-EDITOR/1', buildSha256: target, transport: 'cdc', nonceVerified: false }]) {
    const m = fixture(); m.config.profile = 'protracker';
    await assert.rejects(runCustomUpdate(m.config, { ...m.options, verifyTracker: async () => proof }), error => error.state === 'unknown' && error.transfer_finished && error.recovery_required);
    assert.equal(upgrades(m), 2); assert.equal(m.capabilityQueries, 0); assert.notEqual(m.journal.record.state, 'succeeded');
  }
});
