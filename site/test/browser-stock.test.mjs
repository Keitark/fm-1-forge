import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { createBrowserStockUpdater, STOCK } from '../lib/browser-stock/index.mjs';
import { pack7, unpack7, decodeFrame, response, identityQuery, upgradeCommand, CHECK_FINISH, WRITE_FINISH, parseRequest } from '../lib/browser-stock/protocol.mjs';
import { openJournalDatabase, BrowserAttemptJournal, readCurrent, ensureStorageScope } from '../lib/browser-stock/journal.mjs';
import { candidatePairs } from '../lib/browser-stock/selection.mjs';
import { DEFAULT_TIMING } from '../lib/browser-stock/updater.mjs';
import { stockOriginKind, usableStockOrigin } from '../lib/browser-stock/origin.mjs';

const fixturePath = process.env.FM1_STOCK_V15_FIXTURE ?? 'F:/dev/fm1/references/originals/FM-1-v15-original.fwsc';
const rawFixture = await fs.readFile(fixturePath).then(bytes => Uint8Array.from(bytes), () => null);
const jobId = '1'.repeat(32), reviewId = '2'.repeat(32);
const nativeOrigin = 'codex-sandbox://mcp-app-2f68a70ae18f23cf2f2421450332afffe3bf3107ab7512b6.web-sandbox.oaiusercontent.com';
const fastTiming = { ...DEFAULT_TIMING, open: 0, start: 0, terminal: 0, reply: 0, handshake: 30, poll: 3,
  idleCheck: 8, idleWrite: 8, loader: 40, reboot: 40, enumerate: 2 };
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const equal = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);
function wire(raw) { return Uint8Array.from([240, ...pack7(raw), 247]); }
function request(address, length, flags = 0) {
  const raw = [0, 0x59, 0x30, 8, 0, 0, flags, address & 255, address >>> 8 & 255, address >>> 16 & 255, address >>> 24 & 255,
    length & 255, length >>> 8 & 255, length >>> 16 & 255]; raw.push(~raw.slice(6).reduce((sum, n) => sum + n, 0) & 255); return wire(raw);
}
function identity(text) {
  const raw = Array(34).fill(0); raw.splice(0, 6, 0, 0x59, 0x11, 27, 0, 0);
  [...text].forEach((c, i) => { raw[i + 6] = c.charCodeAt(0); }); raw[33] = ~raw.slice(6, 33).reduce((sum, n) => sum + n, 0) & 255; return wire(raw);
}
function fakeIndexedDB({ durability = 'strict', failOpen = false, failWrite = false, commitDelay = 0 } = {}) {
  const records = new Map(), commits = [];
  const database = { objectStoreNames: { contains: name => name === 'attempts' }, createObjectStore() {}, close() {},
    transaction(_store, mode, options) {
      const snapshot = new Map(Array.from(records, ([key, value]) => [key, clone(value)]));
      let pending = 0, stopped = false, timer;
      const tx = { durability: mode === 'readwrite' ? durability : 'default', abort() { if (stopped) return; stopped = true; clearTimeout(timer); queueMicrotask(() => tx.onabort?.()); } };
      const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (stopped || pending) return; stopped = true;
          if (mode === 'readwrite' && failWrite) { tx.onabort?.(); return; }
          if (mode === 'readwrite') { records.clear(); for (const [key, value] of snapshot) records.set(key, clone(value)); commits.push(clone(snapshot.get('current'))); }
          tx.oncomplete?.();
        }, commitDelay);
      };
      const makeRequest = action => {
        const result = {}; pending++; clearTimeout(timer);
        queueMicrotask(() => {
          if (stopped) return;
          try { result.result = action(); result.onsuccess?.(); }
          catch { result.onerror?.(); tx.abort(); }
          pending--; schedule();
        }); return result;
      };
      tx.objectStore = () => ({ get: key => makeRequest(() => clone(snapshot.get(key))),
        put: value => makeRequest(() => { snapshot.set(value.key, clone(value)); return value.key; }),
        add: value => makeRequest(() => { if (snapshot.has(value.key)) throw new Error('duplicate'); snapshot.set(value.key, clone(value)); return value.key; }) });
      schedule(); return tx;
    },
  };
  const indexedDB = { open() { const request = {}; queueMicrotask(() => {
    if (failOpen) { request.onerror?.(); return; } request.result = database; request.onupgradeneeded?.(); request.onsuccess?.();
  }); return request; } };
  return { indexedDB, database, records, commits };
}
function fakeLocks() {
  let owned = false;
  return { get owned() { return owned; }, async request(_name, options, action) {
    assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true });
    if (owned) return action(null); owned = true;
    try { return await action({ name: 'fm1-forge-stock-v15-device' }); } finally { owned = false; }
  } };
}
function fakeMidi({ initialIdentity = 'FM-1_014', loaderIdentity = 'ota-FM-1_009', bootIdentity = 'FM-1_015', resume = false,
  checkRequests = [request(0, 47, 5), request(CHECK_FINISH, 8)], writeRequests = [request(512, 512), request(0, 47), request(512, 512), request(WRITE_FINISH, 8)],
  failUpgrade = false, missingLoader = false, missingReboot = false, onUpgrade = () => {}, noIdentity = false } = {}) {
  const calls = { permissions: 0, opens: 0, closes: 0, sends: [], upgrades: 0 };
  let stage = resume ? 'loader' : 'normal', sequence = [], position = 0;
  const access = new EventTarget(); access.sysexEnabled = true; access.inputs = new Map(); access.outputs = new Map();
  const emit = (target, type, data) => { const event = new Event(type); Object.assign(event, data); target.dispatchEvent(event); };
  const replace = next => {
    for (const port of [...access.inputs.values(), ...access.outputs.values()]) { port.state = 'disconnected'; emit(access, 'statechange', { port }); }
    access.inputs.clear(); access.outputs.clear(); stage = next;
    if (next === 'loader' && missingLoader || next === 'boot' && missingReboot) return;
    const name = next === 'loader' ? 'ota-FM-1' : 'FM-1 Midi';
    const input = new EventTarget(); Object.assign(input, { id: `${next}-in`, name, state: 'connected', open: async () => { calls.opens++; return input; }, close: async () => { calls.closes++; return input; } });
    const nextPacket = () => { if (position < sequence.length) queueMicrotask(() => emit(input, 'midimessage', { data: sequence[position++] })); };
    const output = { id: `${next}-out`, name, state: 'connected', open: async () => { calls.opens++; return output; }, close: async () => { calls.closes++; return output; },
      send(packet) {
        calls.sends.push(Uint8Array.from(packet));
        if (equal(packet, identityQuery())) { if (!noIdentity) queueMicrotask(() => emit(input, 'midimessage', { data: identity(stage === 'loader' ? loaderIdentity : stage === 'boot' ? bootIdentity : initialIdentity) })); return; }
        if (equal(packet, upgradeCommand())) {
          calls.upgrades++; onUpgrade(); if (failUpgrade) throw new Error('ambiguous send');
          sequence = stage === 'loader' ? writeRequests : checkRequests; position = 0; nextPacket(); return;
        }
        const decoded = decodeFrame(packet), address = decoded[7] + decoded[8] * 256 + decoded[9] * 65536 + decoded[10] * 16777216;
        if (address === CHECK_FINISH) replace('loader'); else if (address === WRITE_FINISH) replace('boot'); else nextPacket();
      },
    };
    access.inputs.set(input.id, input); access.outputs.set(output.id, output);
  };
  replace(stage);
  const navigator = { userActivation: { isActive: true }, requestMIDIAccess: async options => { assert.deepEqual(options, { sysex: true }); calls.permissions++; return access; } };
  return { navigator, access, calls, replace, disconnect: () => { for (const port of [...access.inputs.values(), ...access.outputs.values()]) { port.state = 'disconnected'; emit(access, 'statechange', { port }); } } };
}
function setup(options = {}) {
  const store = fakeIndexedDB(options.storage), locks = options.locks ?? fakeLocks(), midi = fakeMidi(options.midi), states = [], events = [];
  const updater = createBrowserStockUpdater({ navigator: midi.navigator, indexedDB: store.indexedDB, locks, crypto: webcrypto, timing: fastTiming,
    location: { origin: options.origin ?? 'https://fm1-forge.test' }, secureContext: options.secureContext,
    onState: state => states.push(state), onEvent: event => events.push(event) });
  return { updater, store, midi, locks, states, events };
}
const args = () => ({ jobId, reviewId, packageBytes: rawFixture });

test('browser core is portable and preserves wire vectors/partial lengths', async () => {
  assert.deepEqual([...pack7([255, 128, 85])], [127, 1, 86, 2]); assert.deepEqual([...unpack7([127, 1, 86, 2])], [255, 128, 85]);
  assert.equal(decodeFrame(response(0, new Uint8Array(481))).length, 496);
  assert.throws(() => parseRequest(request(0, 0))); assert.throws(() => parseRequest(request(0, 513))); assert.throws(() => parseRequest(request(STOCK.logicalBytes - 1, 2)));
  const sourceFiles = ['index', 'protocol', 'updater', 'selection', 'package', 'journal', 'web-midi', 'origin'];
  for (const file of sourceFiles) { const source = await fs.readFile(new URL(`../lib/browser-stock/${file}.mjs`, import.meta.url), 'utf8'); assert.doesNotMatch(source, /(?:from\s*|import\s*\()["']node:|\.\.\/|localStorage|fetch\(/); }
});
test('startup, status and probe never request permission/open/send', async () => {
  const { updater, midi } = setup(); assert.equal(updater.status().connected, false);
  assert.deepEqual((await updater.probe()).pairs, []); assert.equal(await updater.savedAttempt(), null);
  assert.equal(midi.calls.permissions, 0); assert.equal(midi.calls.opens, 0); assert.equal(midi.calls.sends.length, 0);
});
test('connect requires explicit activation, verifies identity and closes idle endpoints', async () => {
  const { updater, midi, states } = setup(); midi.navigator.userActivation.isActive = false;
  await assert.rejects(updater.connect(), { code: 'user_gesture_required' }); assert.equal(midi.calls.permissions, 0);
  midi.navigator.userActivation.isActive = true;
  const result = await updater.connect(); assert.equal(result.identity, 'FM-1_014'); assert.equal(result.identityVerified, true);
  assert.equal(midi.calls.upgrades, 0); assert.equal(midi.calls.opens, 2); assert.equal(midi.calls.closes, 2);
  assert.equal(updater.status().connected, true); assert.equal(states.at(-1).identity, 'FM-1_014');
});
test('wrong identity, missing reply and denied SysEx close selected endpoints', async () => {
  for (const settings of [{ initialIdentity: 'Other_014' }, { noIdentity: true }]) {
    const { updater, midi } = setup({ midi: settings }); await assert.rejects(updater.connect());
    assert.equal(updater.status().connected, false); assert.equal(midi.calls.upgrades, 0); assert.equal(midi.calls.closes, 2);
    assert.equal((await updater.probe()).granted, true);
  }
  const { updater, midi } = setup(); midi.access.sysexEnabled = false;
  await assert.rejects(updater.connect(), { code: 'sysex_denied' }); assert.equal(midi.calls.opens, 0);
});
test('missing Web Locks/IndexedDB and nonstrict storage never open MIDI', async () => {
  for (const overrides of [{ locks: null }, { indexedDB: null }]) {
    const midi = fakeMidi(), updater = createBrowserStockUpdater({ navigator: midi.navigator, indexedDB: fakeIndexedDB().indexedDB, crypto: webcrypto, locks: fakeLocks(), location: { origin: 'https://fm1-forge.test' }, ...overrides });
    await assert.rejects(updater.connect()); assert.equal(midi.calls.permissions, 0); assert.equal(midi.calls.opens, 0);
  }
  for (const storage of [{ failOpen: true }, { durability: 'relaxed' }, { failWrite: true }]) {
    const { updater, midi } = setup({ storage }); await assert.rejects(updater.connect()); assert.equal(midi.calls.opens, 0); assert.equal(midi.calls.upgrades, 0);
  }
});
test('exact names only, ambiguous units and unrelated sole output never auto-select', () => {
  const ports = name => [{ name, id: name }];
  for (const name of ['USB Composite Device', 'Other synth', 'Felucca', 'FM-1 port']) assert.deepEqual(candidatePairs({ inputs: ports(name), outputs: ports(name) }), []);
  assert.deepEqual(candidatePairs({ inputs: ports('FM-1'), outputs: ports('Other') }), []);
  assert.throws(() => candidatePairs({ inputs: [{ name: 'FM-1 1', id: 'a' }, { name: 'FM-1 2', id: 'b' }], outputs: ports('FM-1') }), { code: 'ambiguous_device' });
});
test('passive unplug invalidates cached identity without additional device queries', async () => {
  const { updater, midi } = setup(); await updater.connect(); const before = midi.calls.sends.length;
  midi.disconnect(); assert.equal(updater.status().connected, false); assert.equal(updater.status().identityVerified, false);
  await updater.probe(); assert.equal(midi.calls.sends.length, before);
});
test('actual official package pin uses WebCrypto without changing caller bytes', { skip: !rawFixture }, async () => {
  const { updater, midi } = setup(), before = Uint8Array.from(rawFixture);
  assert.deepEqual(await updater.inspectPackage(rawFixture), { product: STOCK.product, sha256: STOCK.sha256, raw_bytes: 699956, logical_bytes: 699936 });
  assert.deepEqual(rawFixture, before); assert.equal(midi.calls.permissions, 0);
  const changed = Uint8Array.from(rawFixture); changed[10000] ^= 1; await assert.rejects(updater.inspectPackage(changed), { code: 'invalid_package' });
  await assert.rejects(updater.inspectPackage(new Uint8Array(699955)), { code: 'invalid_package' });
});
test('two-phase helper-free update has committed journal before both upgrades and exact reboot', { skip: !rawFixture }, async () => {
  const context = setup({ midi: { onUpgrade: () => { assert.equal(context.store.records.get('current').state, 'active'); assert.ok(context.store.commits.some(record => record?.state === 'active')); } }, storage: { commitDelay: 2 } });
  await context.updater.connect(); const result = await context.updater.update(args());
  assert.equal(result.state, 'succeeded'); assert.equal(result.identity, 'FM-1_015'); assert.equal(result.readback_verified, false);
  assert.equal(result.transfer_finished, true); assert.equal(result.boot_identity_verified, true); assert.equal(context.midi.calls.upgrades, 2);
  assert.equal(context.updater.status().connected, true); assert.equal((await context.updater.savedAttempt()).state, 'succeeded');
  assert.ok(context.events.some(event => event.progress === 1)); assert.ok(context.events.every(event => event.progress === undefined || event.progress >= 0 && event.progress <= 1));
});
test('preflight failures cannot send upgrade or create attempt', { skip: !rawFixture }, async () => {
  const { updater, midi, store } = setup(); await updater.connect();
  for (const changes of [{ packageBytes: new Uint8Array(8) }, { jobId: 'bad-id' }, { reviewId: undefined }]) {
    await assert.rejects(updater.update({ ...args(), ...changes })); assert.equal(midi.calls.upgrades, 0); assert.equal(store.records.has('current'), false);
  }
  midi.navigator.userActivation.isActive = false;
  await assert.rejects(updater.update(args()), { code: 'user_gesture_required' }); assert.equal(midi.calls.upgrades, 0);
});
test('wrong-phase terminal, malformed request, timeout and lost upgrade become unknown', { skip: !rawFixture }, async () => {
  for (const midi of [{ checkRequests: [request(WRITE_FINISH, 8)] }, { checkRequests: [Uint8Array.from([240, 1, 247])] }, { checkRequests: [] }, { failUpgrade: true }]) {
    const context = setup({ midi }); await context.updater.connect();
    await assert.rejects(context.updater.update(args()), error => error.recovery_required === true);
    const saved = await context.updater.savedAttempt(); assert.equal(saved.state, 'unknown'); assert.equal(saved.boot_identity_verified, false);
    assert.equal(context.updater.status().recoveryRequired, true); assert.equal(context.midi.calls.upgrades, 1);
  }
});
test('loader/reboot deadlines and wrong reboot never establish boot verification', { skip: !rawFixture }, async () => {
  for (const midi of [{ missingLoader: true }, { missingReboot: true }, { bootIdentity: 'FM-1_014' }, { loaderIdentity: 'ota-Other_009' }]) {
    const context = setup({ midi }); await context.updater.connect(); await assert.rejects(context.updater.update(args()));
    const saved = await context.updater.savedAttempt(); assert.equal(saved.state, 'unknown'); assert.equal(saved.boot_identity_verified, false);
    assert.equal(saved.transfer_finished, Boolean(midi.missingReboot || midi.bootIdentity));
  }
});
test('saved recovery is passive and explicit resume preserves original IDs', { skip: !rawFixture }, async () => {
  const store = fakeIndexedDB(), database = await openJournalDatabase(store.indexedDB);
  const scope = await ensureStorageScope(database, 'https://fm1-forge.test', webcrypto);
  let journal = await BrowserAttemptJournal.prepare(database, { jobId, reviewId, pair: { inputName: 'FM-1 Midi', outputName: 'FM-1 Midi', inputId: 'normal-in', outputId: 'normal-out' }, scope }, webcrypto);
  await journal.transition('entering_write', { state: 'unknown' });
  const midi = fakeMidi({ resume: true }), updater = createBrowserStockUpdater({ navigator: midi.navigator, indexedDB: store.indexedDB, locks: fakeLocks(), crypto: webcrypto, timing: fastTiming, location: { origin: 'https://fm1-forge.test' } });
  const saved = await updater.savedAttempt(); assert.equal(saved.jobId, jobId); assert.equal(saved.reviewId, reviewId); assert.equal(midi.calls.permissions, 0); assert.equal(midi.calls.opens, 0);
  await updater.connect();
  await assert.rejects(updater.resume({ ...args(), reviewId: '3'.repeat(32) }), { code: 'resume_rejected' }); assert.equal(midi.calls.upgrades, 0);
  const result = await updater.resume(args()); assert.equal(result.boot_identity_verified, true); assert.equal(midi.calls.upgrades, 1);
  assert.equal((await readCurrent(database, webcrypto)).request.reviewId, reviewId);
});
test('unknown latch rejects new update, completed job cannot run twice', { skip: !rawFixture }, async () => {
  let context = setup({ midi: { failUpgrade: true } }); await context.updater.connect(); await assert.rejects(context.updater.update(args()));
  await context.updater.connect(); await assert.rejects(context.updater.update({ ...args(), jobId: '3'.repeat(32) }), { code: 'recovery_required' }); assert.equal(context.midi.calls.upgrades, 1);
  context = setup(); await context.updater.connect(); await context.updater.update(args());
  await assert.rejects(context.updater.update(args()), { code: 'duplicate_attempt' }); assert.equal(context.midi.calls.upgrades, 2);
});
test('Web Lock blocks another panel connect/query/open during active update', { skip: !rawFixture }, async () => {
  const locks = fakeLocks(), first = setup({ locks }), second = setup({ locks }); await first.updater.connect();
  const updating = first.updater.update(args()); await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(second.updater.connect(), { code: 'worker_busy' }); assert.equal(second.midi.calls.permissions, 0); assert.equal(second.midi.calls.opens, 0);
  await assert.rejects(first.updater.connect(), { code: 'worker_busy' }); await assert.rejects(first.updater.disconnect(), { code: 'worker_busy' });
  assert.equal((await updating).boot_identity_verified, true);
});
test('corrupt IndexedDB request digest fails closed before opening MIDI', { skip: !rawFixture }, async () => {
  const context = setup(); await context.updater.connect(); await context.updater.update(args());
  const prior = context.store.records.get('current'); prior.request.sha256 = '0'.repeat(64); context.store.records.set('current', prior);
  const sends = context.midi.calls.sends.length; await assert.rejects(context.updater.savedAttempt(), { code: 'corrupt_journal' });
  await assert.rejects(context.updater.connect(), { code: 'corrupt_journal' }); assert.equal(context.midi.calls.sends.length, sends);
});
test('passive initialize reports real scope sentinel and shared storage across panels/reopen', async () => {
  const store = fakeIndexedDB(), locks = fakeLocks(), midi = fakeMidi();
  const make = () => createBrowserStockUpdater({ navigator: midi.navigator, indexedDB: store.indexedDB, locks, crypto: webcrypto, location: { origin: 'https://fm1-forge.test' } });
  const first = make(), second = make();
  assert.equal(first.status().storageScope.durableReady, false);
  const one = await first.initialize(), two = await second.ready();
  assert.equal(one.storageScope.origin, 'https://fm1-forge.test'); assert.match(one.storageScope.sentinel, /^[a-f0-9-]{36}$/);
  assert.equal(one.storageScope.sentinel, two.storageScope.sentinel); assert.equal(one.storageScope.durableReady, true); assert.equal(one.storageScope.locksAvailable, true);
  assert.equal((await make().initialize()).storageScope.sentinel, one.storageScope.sentinel);
  assert.equal(midi.calls.permissions, 0); assert.equal(midi.calls.opens, 0); assert.equal(midi.calls.sends.length, 0);
});
test('opaque origin, changed origin/sentinel and separate partitions fail or remain distinguishable', async () => {
  const store = fakeIndexedDB(), midi = fakeMidi(), locks = fakeLocks();
  const make = (origin, indexedDB = store.indexedDB) => createBrowserStockUpdater({ navigator: midi.navigator, indexedDB, locks, crypto: webcrypto, location: { origin } });
  for (const origin of ['null', undefined, 'file://', 'data:text/html,foo']) {
    const updater = make(origin); await assert.rejects(updater.initialize(), { code: 'opaque_origin' }); await assert.rejects(updater.connect(), { code: 'opaque_origin' });
  }
  const first = make('https://fm1-forge.test'); await first.initialize();
  await assert.rejects(make('https://different.test').initialize(), { code: 'storage_scope_changed' });
  const different = make('https://fm1-forge.test', fakeIndexedDB().indexedDB); await different.initialize();
  assert.notEqual(first.status().storageScope.sentinel, different.status().storageScope.sentinel);
  const scope = store.records.get('scope'); scope.sentinel = 'bad'; store.records.set('scope', scope);
  await assert.rejects(first.initialize(), { code: 'storage_scope_changed' }); assert.equal(first.status().storageScope.durableReady, false);
  assert.equal(midi.calls.permissions, 0); assert.equal(midi.calls.opens, 0);
});
test('an observed valid sentinel replacement or deletion is never adopted silently', async () => {
  for (const replacement of ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', null]) {
    const context = setup(); await context.updater.initialize(); const sentinel = context.updater.status().storageScope.sentinel;
    if (replacement) context.store.records.set('scope', { ...context.store.records.get('scope'), sentinel: replacement }); else context.store.records.delete('scope');
    await assert.rejects(context.updater.savedAttempt(), { code: 'storage_scope_changed' });
    await assert.rejects(context.updater.initialize(), { code: 'storage_scope_changed' });
    assert.equal(context.updater.status().storageScope.sentinel, sentinel); assert.equal(context.updater.status().storageScope.durableReady, false);
    assert.equal(context.midi.calls.permissions, 0); assert.equal(context.midi.calls.opens, 0);
  }
});
test('scope replacement after attempted upgrade aborts later journal transition as unknown', { skip: !rawFixture }, async () => {
  const context = setup({ midi: { onUpgrade: () => { context.store.records.set('scope', { ...context.store.records.get('scope'), sentinel: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }); } } });
  await context.updater.connect(); await assert.rejects(context.updater.update(args()), error => error.recovery_required === true);
  assert.equal(context.updater.status().recoveryRequired, true); assert.equal(context.midi.calls.upgrades, 1);
  assert.equal(context.store.records.get('current').state, 'active');
});
test('secure native origin is preserved in durable scope across panel instances', async () => {
  const store = fakeIndexedDB(), locks = fakeLocks(), midi = fakeMidi();
  const make = origin => createBrowserStockUpdater({ navigator: midi.navigator, indexedDB: store.indexedDB, locks,
    crypto: webcrypto, location: { origin }, secureContext: true });
  const first = make(nativeOrigin), second = make(nativeOrigin);
  const initialized = await first.initialize();
  assert.equal(stockOriginKind(nativeOrigin), 'native');
  assert.equal(initialized.storageScope.origin, nativeOrigin);
  assert.equal(initialized.storageScope.originKind, 'native'); assert.equal(initialized.storageScope.secureContext, true);
  assert.equal(initialized.storageScope.durableReady, true);
  assert.equal(store.records.get('scope').origin, nativeOrigin);
  assert.equal((await second.initialize()).storageScope.sentinel, initialized.storageScope.sentinel);
  assert.equal((await make(nativeOrigin).initialize()).storageScope.sentinel, initialized.storageScope.sentinel);
  const changed = nativeOrigin.replace('2f68a70a', 'aaaaaaaa');
  await assert.rejects(make(changed).initialize(), { code: 'storage_scope_changed' });
  assert.equal(midi.calls.permissions, 0); assert.equal(midi.calls.opens, 0); assert.equal(midi.calls.sends.length, 0);
});
test('native initialization and device actions reject nonsecure or unknown secure-context values', async () => {
  for (const secureContext of [false, undefined, 'true', 1]) {
    const context = setup({ origin: nativeOrigin, secureContext });
    assert.equal(context.updater.status().storageScope.originKind, 'native');
    assert.equal(context.updater.status().storageScope.secureContext, typeof secureContext === 'boolean' ? secureContext : null);
    await assert.rejects(context.updater.initialize(), { code: 'opaque_origin' });
    await assert.rejects(context.updater.connect(), { code: 'opaque_origin' });
    await assert.rejects(context.updater.update(args()), { code: 'opaque_origin' });
    assert.equal(context.store.records.size, 0); assert.equal(context.midi.calls.permissions, 0);
    assert.equal(context.midi.calls.opens, 0); assert.equal(context.midi.calls.sends.length, 0);
  }
});
test('origin validation rejects custom, opaque and altered native origins without URL translation', async () => {
  const invalid = ['null', 'file:///fm1', 'blob:https://fm1-forge.test/id', 'data:text/html,foo',
    'custom://mcp-app-' + 'a'.repeat(48) + '.web-sandbox.oaiusercontent.com',
    nativeOrigin + '/', nativeOrigin + '/panel', nativeOrigin + '?panel=1', nativeOrigin + '#panel', nativeOrigin + ':443',
    nativeOrigin.replace('://', '://user@'), nativeOrigin.replace('://', '://user:password@'),
    nativeOrigin.replace('.web-sandbox.', '.other.'), nativeOrigin.replace('mcp-app-', 'app-'),
    nativeOrigin.replace('2f68a70a', '2f68a70'), nativeOrigin.replace('2f68a70a', '2f68a70aa'),
    nativeOrigin.replace('codex-sandbox:', 'CODEX-SANDBOX:'), nativeOrigin.replace('2f68a70a', '2F68A70A')];
  for (const origin of invalid) {
    assert.equal(stockOriginKind(origin), null);
    const context = setup({ origin, secureContext: true });
    await assert.rejects(context.updater.initialize(), { code: 'opaque_origin' });
    await assert.rejects(context.updater.connect(), { code: 'opaque_origin' });
    assert.equal(context.store.records.size, 0); assert.equal(context.midi.calls.permissions, 0); assert.equal(context.midi.calls.opens, 0);
  }
  for (const origin of ['https://fm1-forge.test', 'http://localhost:3000']) assert.equal(usableStockOrigin(origin, false), true);
  for (const origin of ['https://fm1-forge.test/', 'https://user@fm1-forge.test', 'https://fm1-forge.test?x=1']) assert.equal(stockOriginKind(origin), null);
});
test('native journal retains the exact origin and sentinel during a complete stock update', { skip: !rawFixture }, async () => {
  const context = setup({ origin: nativeOrigin, secureContext: true });
  await context.updater.connect();
  const sentinel = context.updater.status().storageScope.sentinel;
  assert.equal((await context.updater.update(args())).boot_identity_verified, true);
  const request = context.store.records.get('current').request;
  assert.deepEqual(request.storageScope, { origin: nativeOrigin, sentinel });
  assert.equal(context.midi.calls.upgrades, 2);
  context.store.records.set('scope', { ...context.store.records.get('scope'), sentinel: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  await assert.rejects(context.updater.savedAttempt(), { code: 'storage_scope_changed' });
  assert.equal(context.updater.status().storageScope.durableReady, false);
});
test('native classification ignores Electron standard-scheme URL trailing-slash normalization', async context => {
  const WebURL = globalThis.URL; let nativeParses = 0;
  context.mock.method(globalThis, 'URL', class extends WebURL {
    constructor(input, ...rest) {
      super(input, ...rest);
      if (input === nativeOrigin) {
        nativeParses++;
        Object.defineProperties(this, { href: { value: nativeOrigin + '/' }, pathname: { value: '/' }, origin: { value: nativeOrigin } });
      }
    }
  });
  assert.equal(stockOriginKind(nativeOrigin), 'native');
  assert.equal(usableStockOrigin(nativeOrigin, true), true);
  const updater = setup({ origin: nativeOrigin, secureContext: true });
  assert.equal((await updater.updater.initialize()).storageScope.origin, nativeOrigin);
  assert.equal(nativeParses, 0);
  assert.equal(stockOriginKind('https://fm1-forge.test'), 'web');
  assert.equal(updater.midi.calls.permissions, 0); assert.equal(updater.midi.calls.opens, 0);
});


test('native MIDI request rejection identifies its public cause before device selection without exposing host internals', async () => {
  for (const name of ['SecurityError', 'NotAllowedError', 'NotSupportedError']) for (const synchronous of [true, false]) {
    const native = new DOMException('PRIVATE_HOST_DETAIL' + String.fromCharCode(0, 10, 0x202e) + 'x'.repeat(10000), name), c = setup();
    c.midi.navigator.requestMIDIAccess = options => {
      assert.deepEqual(options, { sysex: true }); c.midi.calls.permissions++;
      if (synchronous) throw native;
      return Promise.reject(native);
    };
    await assert.rejects(c.updater.connect(), error => {
      assert.equal(error.code, 'midi_permission_denied'); assert.match(error.message, /access request failed/);
      assert.ok(error.message.includes('(' + name + ')')); assert.ok(error.message.length < 256); assert.doesNotMatch(error.message, /PRIVATE_HOST_DETAIL/);
      assert.equal([...error.message].some(character => character.codePointAt(0) < 32 || character.codePointAt(0) === 0x202e), false); return true;
    });
    assert.equal(c.midi.calls.permissions, 1); assert.equal(c.midi.calls.opens, 0); assert.equal(c.midi.calls.upgrades, 0); assert.equal(c.midi.calls.sends.length, 0);
    assert.equal(c.updater.status().connected, false); assert.equal(c.updater.status().lastError.code, 'midi_permission_denied'); assert.equal(c.store.records.get('current'), undefined);
  }
});

test('unrecognized or hostile MIDI exceptions stay bounded and do not become raw panel text', async () => {
  const getterFailure = Object.defineProperty({}, 'name', { get() { throw new Error('PRIVATE_GETTER'); } });
  for (const native of [new Error('PRIVATE_MESSAGE'), { name: 'SecurityError' + String.fromCharCode(10) + 'PRIVATE_NAME', message: 'PRIVATE_MESSAGE' }, { name: 'PRIVATE_NAME'.repeat(10000), message: 'PRIVATE_MESSAGE' }, getterFailure]) {
    const c = setup(); c.midi.navigator.requestMIDIAccess = () => { c.midi.calls.permissions++; return Promise.reject(native); };
    await assert.rejects(c.updater.connect(), error => {
      assert.equal(error.code, 'midi_permission_denied'); assert.ok(error.message.length < 256); assert.doesNotMatch(error.message, /PRIVATE/);
      assert.equal([...error.message].some(character => character.codePointAt(0) < 32), false); return true;
    });
    assert.equal(c.midi.calls.permissions, 1); assert.equal(c.midi.calls.opens, 0); assert.equal(c.midi.calls.sends.length, 0);
  }
});
