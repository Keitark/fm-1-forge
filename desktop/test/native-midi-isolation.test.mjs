import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createNativeMidiBackend } from '../lib/native-midi.mjs';
import { serveMidiWorker } from '../lib/midi-worker.mjs';

const pair = { inputName: 'FM-1 Midi 0', outputName: 'FM-1 Midi 1' };
const packet = [0xf0, 0x01, 0x02, 0xf7];
const inventory = () => ({ inputs: [{ name: pair.inputName, physical: null }], outputs: [{ name: pair.outputName, physical: null }] });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await tick(); }
  assert.fail('The fake MIDI worker did not reach its expected state.');
}
function fixture({ handler, requestTimeoutMs = 1000, closeTimeoutMs = 40, autoKillExit = true, sendCallbackError } = {}) {
  const children = [], starts = [];
  class Child extends EventEmitter {
    constructor() { super(); this.connected = true; this.stderr = new EventEmitter(); this.requests = []; this.kills = []; this.exited = false; }
    send(message, callback) {
      this.requests.push(structuredClone(message)); callback?.(sendCallbackError?.(message, this) ?? null);
      queueMicrotask(() => {
        if (handler?.(message, this) === true) return;
        const result = message.op === 'enumerate' ? inventory() : message.op === 'send' || message.op === 'isConnected' ? true : null;
        this.reply(message, result);
        if (message.op === 'close') this.exit();
      });
      return true;
    }
    reply(message, result) { this.emit('message', { id: message.id, ok: true, result }); }
    exit(code = 0, signal = null) {
      if (this.exited) return;
      this.exited = true; this.connected = false; this.emit('exit', code, signal); this.emit('close', code, signal);
    }
    kill(signal = 'SIGTERM') { this.kills.push(signal); if (autoKillExit) queueMicrotask(() => this.exit(null, signal)); return true; }
  }
  const workerFactory = (file, args, options) => { const child = new Child(); starts.push({ file, args, options }); children.push(child); return child; };
  return { children, starts, create: () => createNativeMidiBackend({ workerFactory, requestTimeoutMs, closeTimeoutMs }) };
}

test('default MIDI isolation starts one hidden owned IPC worker lazily with the bundled Node runtime', async () => {
  const f = fixture(), backend = await f.create();
  assert.equal(f.children.length, 0);
  assert.deepEqual(await backend.enumerate(), inventory()); assert.equal(f.children.length, 1);
  const started = f.starts[0]; assert.match(String(started.file), /midi-worker\.mjs$/);
  assert.deepEqual(started.args, []); assert.equal(started.options.execPath, process.execPath);
  assert.equal(started.options.windowsHide, true); assert.deepEqual(started.options.execArgv, []);
  assert.ok(started.options.stdio.includes('ipc')); assert.equal(started.options.shell, undefined);
  const link = await backend.open(pair);
  assert.equal(f.children.length, 1); assert.equal(await link.send(Uint8Array.from(packet)), true);
  assert.equal(await link.isConnected(), true); assert.equal(await link.read(10), null); await link.drain();
  assert.ok(f.children[0].requests.every(message => Number.isSafeInteger(message.id) && message.id > 0));
  assert.equal(new Set(f.children[0].requests.map(message => message.id)).size, f.children[0].requests.length);
  await link.close(); await backend.close(); assert.equal(f.children[0].exited, true);
});

test('updater routing kinds are stripped from the closed IPC endpoint tuple without mutating the approved snapshot', async () => {
  for (const kind of ['normal', 'loader', 'generic']) {
    const selected = Object.freeze({ ...pair, kind }), snapshot = structuredClone(selected);
    const f = fixture(), backend = await f.create(), link = await backend.open(selected);
    const opening = f.children[0].requests.find(message => message.op === 'open');
    assert.deepEqual(opening.args, { pair }); assert.equal(Object.hasOwn(opening.args.pair, 'kind'), false);
    assert.deepEqual(selected, snapshot); await link.close(); await backend.close();
  }
  const f = fixture(), backend = await f.create();
  for (const kind of ['unknown', '', null, true, 1, {}]) {
    const selected = { ...pair, kind }, snapshot = structuredClone(selected);
    await assert.rejects(backend.open(selected), { code: 'invalid_endpoint' }); assert.deepEqual(selected, snapshot);
  }
  assert.equal(f.children.length, 0); await backend.close();
});

test('pinned generic loader physical metadata crosses IPC unchanged with userSelected false', async () => {
  const physical = Object.freeze({ vid: '4d4a', pid: '4155', mi: '00', instanceHash: 'a'.repeat(64), correlated: true, userSelected: false });
  const selected = Object.freeze({ inputName: 'USB-Midi 0', outputName: 'USB-Midi 1', physical, kind: 'loader' });
  const snapshot = structuredClone(selected), f = fixture(), backend = await f.create(), link = await backend.open(selected);
  const opening = f.children[0].requests.find(message => message.op === 'open');
  assert.deepEqual(opening.args, { pair: { inputName: selected.inputName, outputName: selected.outputName, physical } });
  assert.equal(opening.args.pair.physical.userSelected, false); assert.equal(Object.hasOwn(opening.args.pair, 'kind'), false);
  assert.deepEqual(selected, snapshot); await link.close(); await backend.close();
});

test('a native crash during explicit link close is contained and close waits for actual child exit', async () => {
  const f = fixture({ handler: message => message.op === 'close' }), backend = await f.create(), link = await backend.open(pair);
  let closed = false; const closing = link.close().then(() => { closed = true; });
  await until(() => f.children[0].requests.some(message => message.op === 'close'));
  await tick(); assert.equal(closed, false);
  f.children[0].exit(3221225477, null); await closing; assert.equal(closed, true);
  assert.equal(f.children.length, 1); await link.close();
  assert.deepEqual(await backend.enumerate(), inventory()); assert.equal(f.children.length, 2);
  await backend.close();
});

test('expected-close child errors, disconnects and send callback failures do not block a fresh loader worker after exit', async () => {
  for (const fault of ['error', 'disconnect', 'send callback']) {
    const f = fixture({
      sendCallbackError: message => fault === 'send callback' && message.op === 'close' ? new Error('private IPC shutdown detail') : null,
      handler: (message, child) => {
        if (message.op !== 'close') return;
        if (fault === 'error') child.emit('error', new Error('private worker shutdown detail'));
        if (fault === 'disconnect') { child.connected = false; child.emit('disconnect'); }
        child.exit(3221225477); return true;
      },
    });
    const backend = await f.create(), link = await backend.open(pair);
    await link.close(); assert.equal(f.children[0].exited, true); assert.equal(f.children[0].kills.length, 0);
    assert.deepEqual(await backend.enumerate(), inventory()); assert.equal(f.children.length, 2);
    await backend.close();
  }
});

test('intentional hung close cancels pending read deadlines until the owned kill and permits a fresh worker', async () => {
  const f = fixture({ closeTimeoutMs: 1050, handler: (message, child) =>
    message.op === 'read' || message.op === 'close' && child === f.children[0] });
  const backend = await f.create(), link = await backend.open(pair), reading = link.read(1);
  const result = Promise.allSettled([reading]);
  await until(() => f.children[0].requests.some(message => message.op === 'read'));
  await link.close();
  assert.deepEqual(await result, [{ status: 'fulfilled', value: null }]);
  assert.equal(f.children[0].kills.length, 1); assert.equal(f.children[0].exited, true);
  assert.deepEqual(await backend.enumerate(), inventory()); assert.equal(f.children.length, 2); await backend.close();
});

test('unexpected IPC disconnect rejects the pending operation and latches the backend without replay', async () => {
  const f = fixture({ handler: message => message.op === 'read' }), backend = await f.create(), link = await backend.open(pair);
  const reading = assert.rejects(link.read(500), { code: 'native_worker_exited' });
  await until(() => f.children[0].requests.some(message => message.op === 'read'));
  f.children[0].connected = false; f.children[0].emit('disconnect'); await reading;
  await until(() => f.children[0].exited); assert.equal(f.children[0].kills.length, 1);
  await assert.rejects(backend.enumerate()); assert.equal(f.children.length, 1);
  assert.equal(f.children[0].requests.filter(message => message.op === 'read').length, 1); await backend.close();
});

test('unexpected worker exit rejects pending reads and sends without reconnecting or replaying writes', async () => {
  const f = fixture({ handler: message => ['read', 'send'].includes(message.op) }), backend = await f.create(), link = await backend.open(pair);
  const sending = assert.rejects(link.send(packet), { code: 'native_worker_exited' });
  const reading = assert.rejects(link.read(500), { code: 'native_worker_exited' });
  await until(() => f.children[0].requests.some(message => message.op === 'read'));
  f.children[0].exit(3221225477, null); await Promise.all([sending, reading]);
  await assert.rejects(link.send(packet)); await assert.rejects(backend.enumerate());
  assert.equal(f.children.length, 1); assert.equal(f.children[0].requests.filter(message => message.op === 'send').length, 1);
  await backend.close();
});

test('valid out-of-order replies are matched to their original request IDs', async () => {
  const held = [];
  const f = fixture({ handler: (message, child) => { if (['read', 'isConnected'].includes(message.op)) { held.push({ message, child }); return true; } } });
  const backend = await f.create(), link = await backend.open(pair), reading = link.read(500), presence = link.isConnected();
  await until(() => held.length === 2);
  const presenceCall = held.find(call => call.message.op === 'isConnected'), readCall = held.find(call => call.message.op === 'read');
  presenceCall.child.reply(presenceCall.message, false); readCall.child.reply(readCall.message, packet);
  assert.equal(await presence, false); assert.deepEqual(Array.from(await reading), packet);
  await link.close(); await backend.close();
});

test('a reply from an exited worker cannot settle a fresh loader worker request', async () => {
  let hold = false, fresh;
  const f = fixture({ handler: (message, child) => { if (hold && message.op === 'enumerate') { fresh = { message, child }; return true; } } });
  const backend = await f.create(), link = await backend.open(pair), old = f.children[0];
  await link.close(); hold = true; let settled = false;
  const enumeration = backend.enumerate().then(value => { settled = true; return value; });
  await until(() => fresh);
  old.emit('message', { id: fresh.message.id, ok: true, result: inventory() });
  await tick(); assert.equal(settled, false);
  fresh.child.reply(fresh.message, inventory()); assert.deepEqual(await enumeration, inventory());
  assert.equal(f.children.length, 2); assert.equal(fresh.child.kills.length, 0); await backend.close();
});

test('wrong IDs and malformed worker envelopes fail closed and terminate only the owned worker', async () => {
  for (const bad of [message => ({ id: message.id + 1, ok: true, result: inventory() }),
    message => ({ id: message.id, ok: 'true', result: inventory() }),
    message => ({ id: message.id, ok: true, result: inventory(), extra: true }),
    () => null]) {
    const f = fixture({ handler: (message, child) => { child.emit('message', bad(message)); return true; } }), backend = await f.create();
    await assert.rejects(backend.enumerate(), { code: 'native_worker_protocol' });
    await until(() => f.children[0].exited); assert.equal(f.children[0].kills.length, 1);
    assert.equal(f.children.length, 1); await backend.close();
  }
});

test('duplicate replies cannot be reused for a later operation', async () => {
  let completed;
  const f = fixture({ handler: (message, child) => {
    if (message.op === 'enumerate') completed = message;
    if (message.op === 'open') { child.reply(completed, inventory()); return true; }
  } }), backend = await f.create();
  await backend.enumerate(); await assert.rejects(backend.open(pair), { code: 'native_worker_protocol' });
  await until(() => f.children[0].exited); assert.equal(f.children.length, 1); await backend.close();
});

test('worker MIDI packets and inventories are validated before reaching the coordinator', async () => {
  const oversized = new Array(606).fill(1); oversized[0] = 0xf0; oversized[605] = 0xf7;
  for (const value of [oversized, [0xf0, 256, 0xf7], [0xf0, 1.5, 0xf7], [0xf0, 1, 2], 'not a packet']) {
    const f = fixture({ handler: (message, child) => { if (message.op === 'read') { child.reply(message, value); return true; } } });
    const backend = await f.create(), link = await backend.open(pair);
    await assert.rejects(link.read(10), { code: 'native_worker_protocol' }); await backend.close();
  }
  const f = fixture({ handler: (message, child) => { if (message.op === 'enumerate') { child.reply(message, { inputs: new Array(1025).fill({ name: pair.inputName, physical: null }), outputs: [] }); return true; } } });
  const backend = await f.create(); await assert.rejects(backend.enumerate(), { code: 'native_worker_protocol' }); await backend.close();
});

test('invalid caller packets are rejected before any worker send operation', async () => {
  const f = fixture(), backend = await f.create(), link = await backend.open(pair);
  for (const value of [null, 'packet', [], [0xf0], [0xf0, 256, 0xf7], [0xf0, 1.5, 0xf7], [0xf0, 1, 2], new Uint8Array(606)]) {
    await assert.rejects(link.send(value));
  }
  assert.equal(f.children[0].requests.filter(message => message.op === 'send').length, 0);
  await link.close(); await backend.close();
});

test('invalid caller endpoints and deadlines are rejected before child IPC', async () => {
  const f = fixture(), backend = await f.create();
  for (const value of [null, {}, { ...pair, inputName: 'FM-1\n' }, { ...pair, arbitrary: 'path or source' }]) await assert.rejects(backend.open(value));
  for (const value of [-1, Infinity, Number.MAX_SAFE_INTEGER]) await assert.rejects(backend.enumerate(value));
  assert.equal(f.children.length, 0);
  const link = await backend.open(pair), count = f.children[0].requests.length;
  for (const value of [-1, Infinity, Number.MAX_SAFE_INTEGER]) await assert.rejects(link.read(value));
  assert.equal(f.children[0].requests.length, count); await link.close(); await backend.close();
});

test('the maximum bounded SysEx frame survives both IPC directions without truncation', async () => {
  const maximum = new Array(605).fill(0); maximum[0] = 0xf0; maximum[604] = 0xf7;
  const f = fixture({ handler: (message, child) => { if (message.op === 'read') { child.reply(message, maximum); return true; } } });
  const backend = await f.create(), link = await backend.open(pair);
  assert.equal(await link.send(maximum), true); assert.deepEqual(Array.from(await link.read(10)), maximum);
  await link.close(); await backend.close();
});

test('loader enumeration accepts its remaining budget while bounding child metadata lookup to ten seconds', async () => {
  const f = fixture(), backend = await f.create();
  assert.deepEqual(await backend.enumerate(30000.5), inventory());
  const request = f.children[0].requests.find(message => message.op === 'enumerate');
  assert.deepEqual(request.args, { timeoutMs: 10000 }); await backend.close();
});

test('a hung request is bounded and kills its owned worker without retrying the request', async () => {
  const f = fixture({ requestTimeoutMs: 20, handler: message => message.op === 'send' });
  const backend = await f.create(), link = await backend.open(pair);
  await assert.rejects(link.send(packet)); await until(() => f.children[0].exited);
  assert.equal(f.children[0].kills.length, 1); assert.equal(f.children[0].requests.filter(message => message.op === 'send').length, 1);
  assert.equal(f.children.length, 1); await backend.close();
});

test('a hung explicit close kills only its owned child and still waits for actual exit', async () => {
  const f = fixture({ closeTimeoutMs: 20, autoKillExit: false, handler: message => message.op === 'close' });
  const backend = await f.create(), link = await backend.open(pair); let closed = false;
  const closing = link.close().then(() => { closed = true; });
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(f.children[0].kills.length, 1); assert.equal(closed, false);
  f.children[0].exit(null, 'SIGKILL'); await closing; assert.equal(closed, true); await backend.close();
});

test('backend shutdown closes an enumeration-only worker and prevents later worker creation', async () => {
  const f = fixture(), backend = await f.create(); await backend.enumerate(); await backend.close(); await backend.close();
  assert.equal(f.children[0].exited, true); assert.equal(f.children[0].requests.filter(message => message.op === 'close').length, 1);
  await assert.rejects(backend.enumerate()); await assert.rejects(backend.open(pair)); assert.equal(f.children.length, 1);
});

test('backend shutdown can interrupt an outstanding read without leaving a child or promise behind', async () => {
  const f = fixture({ handler: message => message.op === 'read' }), backend = await f.create(), link = await backend.open(pair);
  const reading = Promise.allSettled([link.read(500)]); await until(() => f.children[0].requests.some(message => message.op === 'read'));
  await backend.close(); await reading; assert.equal(f.children[0].exited, true);
  assert.equal(f.children[0].requests.filter(message => message.op === 'close').length, 1);
});

test('untrusted worker errors never expose native exception details', async () => {
  const f = fixture({ handler: (message, child) => {
    child.emit('message', { id: message.id, ok: false, error: { code: 'private native path and payload' } }); return true;
  } }), backend = await f.create();
  await assert.rejects(backend.enumerate(), error => typeof error.code === 'string' && !error.message.includes('private') && !error.code.includes('private'));
  await backend.close();
});

test('native crash diagnostics on child stderr never become coordinator error details', async () => {
  const f = fixture({ handler: (_message, child) => {
    child.stderr.emit('data', Buffer.from('private device path and firmware payload'.repeat(80)));
    child.exit(3221225477); return true;
  } }), backend = await f.create();
  await assert.rejects(backend.enumerate(), error => !error.message.includes('private') && !error.message.includes('firmware payload'));
  await backend.close();
});

test('worker close runs alongside a waiting read and releases its injected core without native loading', async () => {
  const channel = new EventEmitter(), replies = [], exits = [], calls = [];
  channel.connected = true; channel.send = (reply, callback) => { replies.push(reply); callback?.(null); };
  let releaseRead;
  const link = { async read() { calls.push('read'); return new Promise(resolve => { releaseRead = resolve; }); },
    async close() { calls.push('link:close'); releaseRead?.(null); } };
  serveMidiWorker({ channel, backendFactory: async () => ({
    async open(selected) { assert.deepEqual(selected, pair); calls.push('open'); return link; },
    async close() { calls.push('backend:close'); },
  }), exit: code => exits.push(code) });
  assert.deepEqual(calls, []);
  channel.emit('message', { id: 1, op: 'open', args: { pair } }); await until(() => replies.some(reply => reply.id === 1));
  channel.emit('message', { id: 2, op: 'read', args: { timeoutMs: 500 } }); await until(() => releaseRead);
  channel.emit('message', { id: 3, op: 'close', args: {} }); await until(() => exits.length === 1);
  assert.deepEqual(exits, [0]); assert.deepEqual(calls, ['open', 'read', 'link:close', 'backend:close']);
  assert.deepEqual(replies.find(reply => reply.id === 2), { id: 2, ok: true, result: null });
});

test('worker protocol rejects malformed or repeated command IDs before invoking the core again', async () => {
  for (const bad of [{ id: 2, op: 'send', args: { packet: [0xf0, 999, 0xf7] } },
    { id: 1, op: 'enumerate', args: { timeoutMs: 10 } },
    { id: 2, op: 'evaluate', args: { source: 'untrusted source' } }]) {
    const channel = new EventEmitter(), replies = [], exits = []; let enumerations = 0;
    channel.connected = true; channel.send = (reply, callback) => { replies.push(reply); callback?.(null); };
    serveMidiWorker({ channel, backendFactory: async () => ({ async enumerate() { enumerations++; return inventory(); } }), exit: code => exits.push(code) });
    channel.emit('message', { id: 1, op: 'enumerate', args: { timeoutMs: 10 } }); await until(() => replies.length === 1);
    channel.emit('message', bad); await until(() => exits.length === 1);
    assert.deepEqual(exits, [1]); assert.equal(enumerations, 1); assert.equal(replies.length, 1);
  }
});
