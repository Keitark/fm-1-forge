import { randomUUID } from 'node:crypto';
import { createDeviceOwner } from './device-owner.mjs';
import { desktopDataDirectory } from './platform.mjs';
import { createNativeMidiBackend } from './native-midi.mjs';
import { identityQuery as stockIdentityQuery, parseIdentity as parseStockIdentity, StockError } from '../../tools/jieli-wl82/stock-sysex/protocol.mjs';
import { canonicalName, candidatePairs } from '../../tools/jieli-wl82/stock-sysex/selection.mjs';
import { WIRE, identityQuery as firmwareIdentityQuery, capabilityQuery, parseIdentity as parseFirmwareIdentity, parseCapabilities, decodeFrame } from '../../site/lib/browser-common/protocol.mjs';

const TRANSPORTS = Object.freeze(['stock-midi', 'firmware-midi']);
const NAMES = new Set(['fm-1', 'fm-1 midi', 'fm-1 forge', 'fm1_forge_001', 'ota-fm-1']);
const realClock = { now: () => performance.now(), sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) };
const error = (code, message) => new StockError(code, message);
const samePair = (first, second) => first.inputName === second.inputName && first.outputName === second.outputName &&
  ['vid','pid','mi','instanceHash','correlated','userSelected'].every(key => first.physical?.[key] === second.physical?.[key]);

function selectedPair(inventory) {
  if (!inventory || !Array.isArray(inventory.inputs) || !Array.isArray(inventory.outputs) || inventory.inputs.length > 256 || inventory.outputs.length > 256) {
    throw error('invalid_inventory', 'Native MIDI inventory exceeds its bounds.');
  }
  const names = values => values.map(port => canonicalName(typeof port === 'string' ? port : port?.name));
  const inputs = names(inventory.inputs), outputs = names(inventory.outputs), pairs = [];
  for (let index = 0; index < inputs.length; index++) {
    const name = inputs[index];
    if (!NAMES.has(name)) continue;
    const matchingInputs = inputs.filter(value => value === name), matchingOutputs = outputs.filter(value => value === name);
    if (matchingInputs.length !== 1 || matchingOutputs.length > 1) throw error('ambiguous_device', 'Several indistinguishable FM-1 MIDI endpoints are connected.');
    if (matchingOutputs.length === 1) {
      const input = inventory.inputs[index], output = inventory.outputs[outputs.indexOf(name)];
      pairs.push({ inputName: typeof input === 'string' ? input : input.name, outputName: typeof output === 'string' ? output : output.name });
    }
  }
  for (const loader of candidatePairs(inventory).filter(value => value.kind === 'loader' && value.physical)) {
    const { kind, ...pair } = loader; pairs.push(pair);
  }
  if (pairs.length > 1) throw error('ambiguous_device', 'Connect only the intended FM-1 MIDI pair.');
  if (!pairs.length) throw error('endpoint_unavailable', 'No unique FM-1 MIDI input/output pair is available.');
  return pairs[0];
}

function safeError(caught) {
  const allowed = new Set(['identity_timeout', 'capability_timeout', 'wrong_model', 'invalid_identity', 'invalid_frame', 'unsupported_capabilities', 'device_error', 'invalid_capabilities', 'send_failed', 'disconnected', 'midi_inventory_unavailable', 'endpoint_unavailable', 'ambiguous_device', 'midi_runtime_unavailable', 'service_closed', 'device_busy']);
  const code = allowed.has(caught?.code) ? caught.code : 'native_connection_failed';
  const message = code.endsWith('_timeout') ? 'FM-1 did not answer its read-only identity check.' : code === 'service_closed' ? 'The native FM-1 service is closed.' : code === 'wrong_model' ? 'The selected MIDI firmware does not match this connection mode.' : code === 'disconnected' ? 'FM-1 was disconnected.' : 'The native FM-1 connection could not be verified.';
  return { code, message };
}

export function createDeviceService({ backendFactory = createNativeMidiBackend, clock = realClock, directory = desktopDataDirectory(), ownerFactory = createDeviceOwner } = {}) {
  const owner = ownerFactory({ directory });
  let generation = 0, writer = null, endpointReview = null;
  const requireIdle = () => { if (writer) throw error('device_busy', 'A reviewed stock update owns the FM-1 connection.'); };
  let queue = Promise.resolve(), shutdown = false, epoch = 0, backend = null, link = null, pair = null;
  let state = { connected: false, transport: null, identity: null, loader: false, installationAvailable: false, lastError: null };
  const snapshot = () => ({ ...state, lastError: state.lastError && { ...state.lastError }, supportedTransports: [...TRANSPORTS] });
  const current = expected => { if (shutdown || epoch !== expected) throw error('service_closed', 'The native FM-1 service is closed.'); };
  const serialized = action => {
    const result = queue.then(async () => { current(epoch); return action(epoch); });
    queue = result.catch(() => {}); return result;
  };
  const closeLink = async () => { const closing = link; link = null; if (closing) await closing.close(); };
  const closeBackend = async () => { const closing = backend; await closing?.close?.(); if (backend === closing) backend = null; };
  const clear = failure => { generation++; endpointReview = null; pair = null; backend = null; state = { connected: false, transport: null, identity: null, loader: false, installationAvailable: false, lastError: failure ?? null }; };
  const send = async (packet, expected) => { current(expected); if (await link.send(packet) === false) throw error('send_failed', 'MIDI query delivery failed.'); current(expected); };
  const receive = async (parse, command, expected, timeoutCode) => {
    const deadline = clock.now() + 1500;
    for (let count = 0; count < 64; count++) {
      current(expected);
      const remaining = deadline - clock.now();
      if (remaining <= 0) break;
      const packet = await link.read(Math.max(1, remaining)); current(expected);
      if (packet === null) break;
      // Other devices may broadcast unrelated SysEx. A structurally valid FM-1
      // identity with the wrong model must be rejected rather than skipped.
      let frame;
      try { frame = decodeFrame(packet); } catch { continue; }
      if (frame.command !== command) continue;
      return parse(packet);
    }
    throw error(timeoutCode, 'FM-1 did not answer its read-only query.');
  };
  const identify = async (transport, expected) => {
    await link.drain(); current(expected);
    await send(transport === 'stock-midi' ? stockIdentityQuery() : firmwareIdentityQuery(), expected);
    if (transport === 'stock-midi') {
      const found = await receive(parseStockIdentity, 0x11, expected, 'identity_timeout');
      if (!found.loader && found.text !== 'FM-1_015') throw error('wrong_model', 'Only stock FM-1 V15 is supported by this connection mode.');
      if (pair?.physical && canonicalName(pair.inputName) === 'usb-midi' && found.text !== 'ota-FM-1_015') throw error('wrong_model', 'The pinned USB-Midi loader must identify as stock V15 OTA.');
      return { identity: found.text, loader: found.loader };
    }
    const found = await receive(parseFirmwareIdentity, 0x11, expected, 'identity_timeout');
    if (found !== WIRE.commonIdentity) throw error('wrong_model', 'Common-update FM-1 firmware is required.');
    await link.drain(); current(expected); await send(capabilityQuery(), expected);
    // Qualification remains off in the desktop service even when firmware
    // advertises a loader. These tools expose no arm, trigger or write method.
    await receive(parseCapabilities, 0x31, expected, 'capability_timeout');
    return { identity: found, loader: false };
  };
  const connected = async expected => { const result = await link.isConnected(); current(expected); return result; };
  const connect = input => serialized(async expected => {
    requireIdle();
    if (!input || Object.keys(input).length !== 1 || !TRANSPORTS.includes(input.transport)) throw error('unsupported_transport', 'Choose stock MIDI or firmware MIDI. Native serial support is not available in this version.');
    await closeLink(); await closeBackend(); current(expected); clear();
    try {
      await owner.acquire(); current(expected);
      backend = await backendFactory(); current(expected);
      pair = selectedPair(await backend.enumerate()); current(expected);
      const opened = await backend.open(pair);
      if (shutdown || epoch !== expected) { await opened.close(); current(expected); }
      link = opened;
      await clock.sleep(300); current(expected);
      const evidence = await identify(input.transport, expected);
      if (!await connected(expected)) throw error('disconnected', 'FM-1 disconnected before its identity was committed.');
      current(expected); state = { connected: true, transport: input.transport, ...evidence, installationAvailable: false, lastError: null };
      return snapshot();
    } catch (caught) {
      try { await closeLink(); } finally { await closeBackend(); clear(safeError(caught)); await owner.release(); }
      current(expected); throw Object.assign(error(state.lastError.code, state.lastError.message), { status: snapshot() });
    }
  });
  const getStatus = ({ refresh = true } = {}) => serialized(async expected => {
    if (writer || !state.connected || !refresh) return snapshot();
    try {
      if (!await connected(expected)) { await closeLink(); await closeBackend(); current(expected); clear({ code: 'disconnected', message: 'FM-1 was disconnected.' }); await owner.release(); return snapshot(); }
      const evidence = await identify(state.transport, expected);
      if (!await connected(expected)) { await closeLink(); await closeBackend(); current(expected); clear({ code: 'disconnected', message: 'FM-1 was disconnected.' }); await owner.release(); return snapshot(); }
      current(expected); Object.assign(state, evidence, { lastError: null }); return snapshot();
    } catch (caught) {
      current(expected);
      if (['identity_timeout', 'capability_timeout'].includes(caught?.code)) {
        try {
          if (await connected(expected)) { state.lastError = safeError(caught); return snapshot(); }
        } catch { /* A failed physical check cannot retain connected evidence. */ }
      }
      try { await closeLink(); } finally { await closeBackend(); clear(safeError(caught)); await owner.release(); }
      current(expected); return snapshot();
    }
  });
  const disconnect = () => serialized(async expected => { requireIdle(); try { await closeLink(); } finally { await closeBackend(); clear(); await owner.release(); } current(expected); return snapshot(); });
  const reviewStockEndpoint = ({ loader = false } = {}) => serialized(async expected => {
    requireIdle();
    if (!state.connected || state.transport !== 'stock-midi' || state.loader !== loader) throw error(loader ? 'resume_requires_loader' : 'stock_connection_required', loader ? 'Connect the stock OTA MIDI loader before reviewing recovery.' : 'Connect and identify stock V15 MIDI before reviewing installation.');
    if (!await connected(expected)) throw error('device_changed', 'The reviewed FM-1 connection changed.');
    const evidence = await identify('stock-midi', expected);
    if (evidence.identity !== state.identity || evidence.loader !== loader || !await connected(expected)) throw error('device_changed', 'The reviewed FM-1 connection changed.');
    const selected = selectedPair(await backend.enumerate()); current(expected);
    if (!samePair(selected, pair)) throw error('device_changed', 'The reviewed FM-1 endpoints changed.');
    endpointReview = { token: randomUUID(), generation, input_name: pair.inputName, output_name: pair.outputName, identity: evidence.identity, loader, expectedStockPair: { ...pair } };
    return JSON.parse(JSON.stringify(endpointReview));
  });
  const acquireStockWriter = reviewed => serialized(async expected => {
    requireIdle();
    if (!reviewed || !endpointReview || reviewed.token !== endpointReview.token || endpointReview.generation !== generation || !state.connected || state.transport !== 'stock-midi' || state.identity !== endpointReview.identity) throw error('device_changed', 'Reconnect and review the intended stock FM-1 again.');
    if (!await connected(expected)) throw error('device_changed', 'The reviewed FM-1 was disconnected.');
    const evidence = await identify('stock-midi', expected);
    if (evidence.identity !== endpointReview.identity || evidence.loader !== endpointReview.loader || !await connected(expected)) throw error('device_changed', 'The reviewed FM-1 identity changed.');
    const selected = selectedPair(await backend.enumerate()); current(expected);
    if (!samePair(selected, pair)) throw error('device_changed', 'The reviewed FM-1 endpoints changed.');
    const ownedBackend = backend, links = new Set(), openings = new Set(); let released = false, releasePromise = null;
    const session = { backend: {
      async enumerate(...args) { if (released || shutdown) throw error('service_closed', 'The stock writer is closed.'); return ownedBackend.enumerate(...args); },
      async open(selectedPair) {
        if (released || shutdown) throw error('service_closed', 'The stock writer is closed.');
        const opening = (async () => {
          const opened = await ownedBackend.open(selectedPair);
          if (released || shutdown) {
            try { await opened.close(); } catch { throw error('close_failed', 'The late native MIDI handle could not be closed.'); }
            throw error('service_closed', 'The stock writer is closed.');
          }
          links.add(opened);
          return { ...opened, async close() { await opened.close(); links.delete(opened); } };
        })();
        openings.add(opening);
        try { return await opening; } finally { openings.delete(opening); }
      },
    }, release() {
      if (releasePromise) return releasePromise;
      released = true;
      releasePromise = (async () => {
        // All callers await the same cleanup, including concurrent shutdown.
        const late = await Promise.allSettled([...openings]);
        if (late.some(result => result.status === 'rejected' && result.reason?.code === 'close_failed')) throw error('close_failed', 'A late native MIDI handle could not be closed.');
        const results = await Promise.allSettled([...links].map(opened => opened.close()));
        if (results.some(result => result.status === 'rejected')) throw error('close_failed', 'The native writer could not release all MIDI handles.');
        links.clear();
        await ownedBackend.close?.();
        if (writer === session) { await owner.release(); writer = null; clear(); }
      })();
      return releasePromise;
    } };
    await closeLink(); current(expected); writer = session; endpointReview = null;
    return session;
  });
  const close = async () => {
    if (!shutdown) { shutdown = true; epoch++; }
    // Stop the owned process before waiting on an in-flight native open/read.
    // The worker exit releases its OS handles even when native teardown aborts.
    try { await closeBackend(); await writer?.release(); await closeLink(); await queue; } finally { if (!writer && backend === null) { clear(); await owner.release(); } }
  };
  const api = { connect, getStatus, disconnect, close };
  Object.defineProperties(api, { reviewStockEndpoint: { value: reviewStockEndpoint }, acquireStockWriter: { value: acquireStockWriter } });
  return Object.freeze(api);
}
