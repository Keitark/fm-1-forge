import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceService } from '../lib/device-service.mjs';
import { encodeFrame, identityQuery as commonQuery, capabilityQuery, put32 } from '../../site/lib/browser-common/protocol.mjs';
import { identityQuery as stockQuery } from '../../tools/jieli-wl82/stock-sysex/protocol.mjs';

const identity = text => { const bytes = new Uint8Array(27); bytes.set(new TextEncoder().encode(text)); return encodeFrame(0x11, bytes); };
function capabilities({ install = false } = {}) {
  const bytes = new Uint8Array(47); bytes.set([70, 77, 67, 49, 1, 8, 0, Number(install), 0, 2]);
  put32(bytes, 10, 1048576); bytes.fill(0x12, 14, 46); bytes[46] = install ? 0 : 3;
  return encodeFrame(0x31, bytes);
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture({ name = 'FM-1 Midi', packets = [identity('FM-1_015')], inventory, factoryDelay, openDelay } = {}) {
  const calls = [], sent = [], reads = [...packets]; let time = 0, present = true, closing = false, readGate = null, sendError = null;
  const backend = {
    async enumerate() { calls.push('enumerate'); return inventory ?? { inputs: [{ name }], outputs: [{ name }] }; },
    async open(pair) { calls.push({ open: pair }); if (openDelay) await openDelay.promise; return link; },
  };
  const link = {
    async drain() { calls.push('drain'); },
    async send(packet) { calls.push('send'); if (sendError) throw sendError; sent.push(Uint8Array.from(packet)); return true; },
    async read(milliseconds) { calls.push('read'); if (readGate) return readGate.promise; time += Math.min(milliseconds, 100); return reads.length ? reads.shift() : null; },
    async isConnected() { calls.push('presence'); return present; },
    async close() { if (closing) return; closing = true; calls.push('close'); if (readGate) readGate.resolve(null); },
  };
  const clock = { now: () => time, sleep: async milliseconds => { time += milliseconds; } };
  const service = createDeviceService({ backendFactory: async () => { calls.push('factory'); if (factoryDelay) await factoryDelay.promise; return backend; }, clock });
  return { service, calls, sent, reads, setPresent: value => { present = value; }, setSendError: value => { sendError = value; }, setReadGate: gate => { readGate = gate; }, link };
}

test('construction and initial status never import a MIDI backend or send a packet', async () => {
  const f = fixture(), status = await f.service.getStatus();
  assert.deepEqual(status, { connected: false, transport: null, identity: null, loader: false, installationAvailable: false, lastError: null, supportedTransports: ['stock-midi', 'firmware-midi'] });
  assert.deepEqual(f.calls, []); assert.deepEqual(Object.keys(f.service).sort(), ['close', 'connect', 'disconnect', 'getStatus']);
  await f.service.close();
});

test('explicit stock connection sends only the fixed identity query and retains its native link', async () => {
  const f = fixture(); const result = await f.service.connect({ transport: 'stock-midi' });
  assert.equal(result.connected, true); assert.equal(result.identity, 'FM-1_015'); assert.equal(result.installationAvailable, false);
  assert.deepEqual(f.sent, [stockQuery()]); assert.equal(f.calls.includes('close'), false);
  assert.equal((await f.service.getStatus({ refresh: false })).identity, result.identity);
  await f.service.close(); assert.equal(f.calls.filter(call => call === 'close').length, 1);
});

test('stock OTA loader identity is displayed without sending an upgrade command', async () => {
  const f = fixture({ name: 'ota-FM-1', packets: [identity('ota-FM-1_015')] });
  const result = await f.service.connect({ transport: 'stock-midi' });
  assert.equal(result.loader, true); assert.equal(result.identity, 'ota-FM-1_015'); assert.deepEqual(f.sent, [stockQuery()]);
  await f.service.close();
});

test('firmware MIDI checks common identity and capabilities while installation stays unavailable', async () => {
  const f = fixture({ name: 'FM-1 Forge', packets: [identity('FM1_FORGE_001'), capabilities({ install: true })] });
  const result = await f.service.connect({ transport: 'firmware-midi' });
  assert.equal(result.identity, 'FM1_FORGE_001'); assert.equal(result.connected, true); assert.equal(result.installationAvailable, false);
  assert.deepEqual(f.sent, [commonQuery(), capabilityQuery()]); await f.service.close();
});

test('unrelated SysEx frames are bounded and ignored while waiting for exact identity', async () => {
  const f = fixture({ packets: [Uint8Array.of(0xf0, 0x7e, 0xf7), encodeFrame(0x30), identity('FM-1_015')] });
  assert.equal((await f.service.connect({ transport: 'stock-midi' })).connected, true);
  assert.equal(f.calls.filter(call => call === 'read').length, 3); await f.service.close();
});

test('a sole unrelated MIDI device is never opened', async () => {
  const f = fixture({ name: 'Another synthesizer' });
  await assert.rejects(f.service.connect({ transport: 'stock-midi' }), { code: 'endpoint_unavailable' });
  assert.deepEqual(f.sent, []); assert.equal(f.calls.some(call => typeof call === 'object' && call.open), false); await f.service.close();
});

test('duplicate canonical names and multiple FM-1 pairs are rejected before open', async () => {
  for (const inventory of [
    { inputs: [{ name: 'FM-1 Midi 0' }, { name: 'FM-1 Midi 1' }], outputs: [{ name: 'FM-1 Midi 0' }] },
    { inputs: [{ name: 'FM-1 Midi' }, { name: 'FM-1 Forge' }], outputs: [{ name: 'FM-1 Midi' }, { name: 'FM-1 Forge' }] },
  ]) {
    const f = fixture({ inventory }); await assert.rejects(f.service.connect({ transport: 'stock-midi' }), { code: 'ambiguous_device' });
    assert.deepEqual(f.sent, []); assert.equal(f.calls.some(call => typeof call === 'object' && call.open), false); await f.service.close();
  }
});

test('stock V14 and common identity in stock mode are rejected and native ports close', async () => {
  for (const value of ['FM-1_014', 'FM1_FORGE_001']) {
    const f = fixture({ packets: [identity(value)] });
    await assert.rejects(f.service.connect({ transport: 'stock-midi' }), { code: 'wrong_model' });
    assert.equal(f.calls.filter(call => call === 'close').length, 1); assert.equal((await f.service.getStatus()).connected, false); await f.service.close();
  }
});

test('stock identity in common mode never causes a capability or upgrade request', async () => {
  const f = fixture(); await assert.rejects(f.service.connect({ transport: 'firmware-midi' }), { code: 'wrong_model' });
  assert.deepEqual(f.sent, [commonQuery()]); assert.equal(f.calls.filter(call => call === 'close').length, 1); await f.service.close();
});

test('unsupported serial and malformed selections fail without backend startup', async () => {
  const f = fixture();
  for (const input of [{ transport: 'serial' }, { transport: 'stock-midi', command: 'raw' }, null]) {
    await assert.rejects(f.service.connect(input), { code: 'unsupported_transport' });
  }
  assert.deepEqual(f.calls, []); await f.service.close();
});

test('a physically missing device clears confirmed identity and closes native handles', async () => {
  const f = fixture(); await f.service.connect({ transport: 'stock-midi' }); f.setPresent(false);
  const status = await f.service.getStatus();
  assert.equal(status.connected, false); assert.equal(status.identity, null); assert.equal(status.lastError.code, 'disconnected');
  assert.equal(f.sent.length, 1); assert.equal(f.calls.filter(call => call === 'close').length, 1); await f.service.close();
});

test('transient identity timeout keeps last confirmed status only while the same native pair is present', async () => {
  const f = fixture(); await f.service.connect({ transport: 'stock-midi' });
  const timeout = await f.service.getStatus();
  assert.equal(timeout.connected, true); assert.equal(timeout.identity, 'FM-1_015'); assert.equal(timeout.lastError.code, 'identity_timeout');
  assert.equal(f.calls.filter(call => typeof call === 'object' && call.open).length, 1); assert.equal(f.calls.includes('close'), false);
  f.reads.push(identity('FM-1_015')); assert.equal((await f.service.getStatus()).lastError, null); await f.service.close();
});

test('unusable transport errors clear status and require explicit Connect without implicit reopen', async () => {
  const f = fixture(); await f.service.connect({ transport: 'stock-midi' });
  f.setSendError(Object.assign(new Error('private OS path must not escape'), { code: 'send_failed' }));
  const failed = await f.service.getStatus(); assert.equal(failed.connected, false); assert.equal(failed.lastError.code, 'send_failed');
  assert.equal(JSON.stringify(failed).includes('private OS'), false); await f.service.getStatus();
  assert.equal(f.calls.filter(call => typeof call === 'object' && call.open).length, 1); await f.service.close();
});

test('connect, status and disconnect serialize without overlapping MIDI queries', async () => {
  const f = fixture({ packets: [identity('FM-1_015'), identity('FM-1_015')] });
  const [first, refreshed, disconnected] = await Promise.all([f.service.connect({ transport: 'stock-midi' }), f.service.getStatus(), f.service.disconnect()]);
  assert.equal(first.connected, true); assert.equal(refreshed.connected, true); assert.equal(disconnected.connected, false);
  assert.deepEqual(f.sent, [stockQuery(), stockQuery()]); assert.equal(f.calls.filter(call => call === 'close').length, 1); await f.service.close();
});

test('shutdown during a late open closes its returned native handle and never commits identity', async () => {
  const openDelay = deferred(), f = fixture({ openDelay });
  const connecting = f.service.connect({ transport: 'stock-midi' });
  while (!f.calls.some(call => typeof call === 'object' && call.open)) await new Promise(resolve => setImmediate(resolve));
  const closing = f.service.close(); openDelay.resolve();
  await assert.rejects(connecting, { code: 'service_closed' }); await closing;
  assert.deepEqual(f.sent, []); assert.equal(f.calls.filter(call => call === 'close').length, 1);
  await assert.rejects(f.service.getStatus(), { code: 'service_closed' });
});

test('shutdown cancels an in-flight read and rejects queued status without returning stale connection', async () => {
  const f = fixture(), gate = deferred(); f.setReadGate(gate);
  const connecting = f.service.connect({ transport: 'stock-midi' });
  const pendingStatus = f.service.getStatus();
  const checked = Promise.allSettled([connecting, pendingStatus]);
  while (!f.calls.includes('read')) await new Promise(resolve => setImmediate(resolve));
  await f.service.close(); const results = await checked;
  for (const result of results) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.code, 'service_closed'); }
  assert.equal(f.calls.filter(call => call === 'close').length, 1);
});

test('returned status snapshots cannot mutate internal device evidence', async () => {
  const f = fixture(), result = await f.service.connect({ transport: 'stock-midi' });
  result.identity = 'mutated'; result.supportedTransports.push('raw-sysex');
  const fresh = await f.service.getStatus({ refresh: false }); assert.equal(fresh.identity, 'FM-1_015'); assert.deepEqual(fresh.supportedTransports, ['stock-midi', 'firmware-midi']); await f.service.close();
});
