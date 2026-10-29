import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StockError } from '../../tools/jieli-wl82/stock-sysex/protocol.mjs';

const fail = (code, message = 'The isolated native MIDI connection failed.') => new StockError(code, message);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const name = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);
const timeout = (value, max) => Number.isSafeInteger(value) && value >= 1 && value <= max;
const bytes = value => Array.isArray(value) && value.length >= 2 && value.length <= 605 && value[0] === 0xf0 && value.at(-1) === 0xf7 &&
  value.every((byte, index) => Number.isInteger(byte) && byte >= 0 && byte <= (index === 0 || index === value.length - 1 ? 255 : 127));
function validPhysical(value) {
  return object(value) && Object.keys(value).every(key => ['vid', 'pid', 'mi', 'instanceHash', 'correlated', 'userSelected'].includes(key)) &&
    ['vid', 'pid', 'mi', 'instanceHash'].every(key => typeof value[key] === 'string') &&
    ['correlated', 'userSelected'].every(key => value[key] === undefined || typeof value[key] === 'boolean') &&
    /^[a-f0-9]{4}$/.test(value.vid) && /^[a-f0-9]{4}$/.test(value.pid) &&
    /^[a-f0-9]{2}$/.test(value.mi) && /^[a-f0-9]{64}$/.test(value.instanceHash);
}
const pair = value => object(value) && Object.keys(value).every(key => ['inputName', 'outputName', 'physical'].includes(key)) &&
  name(value.inputName) && name(value.outputName) && (value.physical === undefined || validPhysical(value.physical));
const codes = new Set(['invalid_endpoint', 'endpoint_unavailable', 'ambiguous_device', 'midi_runtime_unavailable',
  'midi_inventory_unavailable', 'send_failed', 'disconnected', 'invalid_frame', 'concurrent_read',
  'physical_correlation_failed', 'service_closed', 'device_busy', 'native_midi_failed', 'native_worker_protocol']);
export const midiWorkerErrorCode = value => codes.has(value) ? value : 'native_midi_failed';

export function validateMidiRequest(value) {
  if (!exact(value, ['id', 'op', 'args']) || !Number.isSafeInteger(value.id) || value.id < 1 || !object(value.args)) throw fail('native_worker_protocol');
  const args = value.args;
  const valid = value.op === 'enumerate' ? exact(args, ['timeoutMs']) && timeout(args.timeoutMs, 10000) :
    value.op === 'open' ? exact(args, ['pair']) && pair(args.pair) :
    value.op === 'send' ? exact(args, ['packet']) && bytes(args.packet) :
    value.op === 'read' ? exact(args, ['timeoutMs']) && timeout(args.timeoutMs, 180000) :
    ['drain', 'isConnected', 'close'].includes(value.op) && exact(args, []);
  if (!valid) throw fail('native_worker_protocol');
  return value;
}
function inventory(value) {
  return exact(value, ['inputs', 'outputs']) && ['inputs', 'outputs'].every(key => Array.isArray(value[key]) && value[key].length <= 256 &&
    value[key].every(port => exact(port, ['name', 'physical']) && name(port.name) && (port.physical === null || validPhysical(port.physical))));
}
export function validateMidiReply(value, op) {
  if (!object(value) || !Number.isSafeInteger(value.id) || value.id < 1 || typeof value.ok !== 'boolean') throw fail('native_worker_protocol');
  if (!value.ok) {
    if (!exact(value, ['id', 'ok', 'error']) || !exact(value.error, ['code']) || !codes.has(value.error.code)) throw fail('native_worker_protocol');
    return value;
  }
  if (!exact(value, ['id', 'ok', 'result'])) throw fail('native_worker_protocol');
  const result = value.result;
  const valid = op === 'enumerate' ? inventory(result) : op === 'read' ? result === null || bytes(result) :
    ['send', 'isConnected'].includes(op) ? typeof result === 'boolean' : ['open', 'drain', 'close'].includes(op) && result === null;
  if (!valid) throw fail('native_worker_protocol');
  return value;
}

// Real native bindings live only in an owned process. Unit tests with an
// explicitly injected module retain the direct core implementation.
export async function createNativeMidiBackend({ midiModule, metadataReader, platform = process.platform,
  workerFactory = fork, requestTimeoutMs = 15000, closeTimeoutMs = 3000 } = {}) {
  if (midiModule) {
    const { createNativeMidiCore } = await import('./native-midi-core.mjs');
    return createNativeMidiCore({ midiModule, metadataReader, platform });
  }
  if (typeof workerFactory !== 'function' || !timeout(requestTimeoutMs, 30000) || !timeout(closeTimeoutMs, 10000)) throw fail('invalid_endpoint');
  let current = null, activeLink = null, stopped = false, latched = null, closePromise = null;
  function rejectPending(state, error) {
    for (const pending of state.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    state.pending.clear();
  }
  function fatal(state, code) {
    const error = fail(code);
    state.failure ??= error; latched ??= error;
    rejectPending(state, error);
    if (!state.exited) try { state.child.kill('SIGKILL'); } catch { /* The exit deadline still owns cleanup. */ }
  }
  function ensureWorker() {
    if (stopped) throw fail('service_closed');
    if (latched) throw latched;
    if (current) {
      if (current.expectedClose || current.exited) throw fail('disconnected');
      return current;
    }
    let child;
    try {
      child = workerFactory(fileURLToPath(new URL('./midi-worker.mjs', import.meta.url)), [], {
        execPath: process.execPath, execArgv: [], windowsHide: true, serialization: 'json',
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, NODE_OPTIONS: '' },
      });
    } catch { throw fail('midi_runtime_unavailable'); }
    const state = { child, pending: new Map(), nextId: 1, expectedClose: false, exited: false, failure: null, retiring: null, stderrBytes: 0 };
    state.exit = new Promise(resolve => { state.resolveExit = resolve; });
    current = state;
    // Never forward native stderr: RtMidi diagnostics may contain local details.
    // Drain it to avoid a blocked pipe, retaining only a saturated byte count.
    child.stderr?.on('data', chunk => { state.stderrBytes = Math.min(8192, state.stderrBytes + (chunk?.length ?? 0)); });
    child.on('message', value => {
      if (state.exited) return;
      const pending = state.pending.get(value?.id);
      if (!pending) { fatal(state, 'native_worker_protocol'); return; }
      try { validateMidiReply(value, pending.op); } catch { fatal(state, 'native_worker_protocol'); return; }
      clearTimeout(pending.timer); state.pending.delete(value.id);
      if (value.ok) pending.resolve(value.result); else pending.reject(fail(value.error.code));
    });
    child.on('error', () => { if (!state.expectedClose && !state.exited) fatal(state, 'native_worker_exited'); });
    child.on('disconnect', () => { if (!state.expectedClose && !state.exited) fatal(state, 'native_worker_exited'); });
    child.on('exit', () => {
      if (state.exited) return;
      state.exited = true;
      if (!state.expectedClose) { state.failure ??= fail('native_worker_exited'); latched ??= state.failure; }
      for (const pending of state.pending.values()) {
        clearTimeout(pending.timer);
        if (state.expectedClose && ['close', 'read'].includes(pending.op)) pending.resolve(null);
        else pending.reject(state.failure ?? fail('disconnected'));
      }
      state.pending.clear();
      if (current === state) current = null;
      state.resolveExit();
    });
    return state;
  }
  function request(state, op, args = {}) {
    if (state.exited || state.failure || state.expectedClose && op !== 'close') return Promise.reject(state.failure ?? fail('disconnected'));
    if (state.pending.size >= 32 || state.nextId >= Number.MAX_SAFE_INTEGER) return Promise.reject(fail('device_busy'));
    const value = { id: state.nextId++, op, args };
    try { validateMidiRequest(value); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const milliseconds = op === 'read' ? Math.min(181000, args.timeoutMs + 1000) : requestTimeoutMs;
      const timer = op === 'close' ? null : setTimeout(() => fatal(state, 'native_worker_timeout'), milliseconds);
      state.pending.set(value.id, { op, resolve, reject, timer });
      try { state.child.send(value, error => { if (error && !state.exited && !state.expectedClose) fatal(state, 'native_worker_exited'); }); }
      catch { if (!state.expectedClose) fatal(state, 'native_worker_exited'); }
    });
  }
  function retire(state) {
    if (!state || state.exited) return Promise.resolve();
    if (state.retiring) return state.retiring;
    state.expectedClose = true;
    // Existing reads/sends settle from their reply or the actual exit. Their
    // request timers must not turn an intentional shutdown into an unexpected
    // crash latch while the bounded close deadline owns process termination.
    for (const pending of state.pending.values()) clearTimeout(pending.timer);
    state.retiring = (async () => {
      // A native abort in destroy() is contained here. Cleanup is complete only
      // once the OS reports the owned process exited, never just on its reply.
      if (!state.failure) void request(state, 'close').catch(() => {});
      const kill = setTimeout(() => { if (!state.exited) try { state.child.kill('SIGKILL'); } catch {} }, closeTimeoutMs);
      let deadline;
      try {
        await Promise.race([state.exit, new Promise((_, reject) => {
          deadline = setTimeout(() => reject(fail('close_failed', 'The owned MIDI worker did not exit.')), closeTimeoutMs + 2000);
        })]);
      } finally { clearTimeout(kill); clearTimeout(deadline); }
    })();
    return state.retiring;
  }
  return {
    async enumerate(timeoutMs = 10000) {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 180000) throw fail('invalid_endpoint');
      return request(ensureWorker(), 'enumerate', { timeoutMs: Math.min(10000, Math.ceil(timeoutMs)) });
    },
    async open(selected) {
      if (!object(selected) || Object.keys(selected).some(key => !['inputName', 'outputName', 'physical', 'kind'].includes(key)) ||
          selected.kind !== undefined && !['normal', 'loader', 'generic'].includes(selected.kind)) throw fail('invalid_endpoint');
      // selectPair annotates the approved pair for the updater's local routing.
      // The worker receives only the endpoint/physical tuple, never that hint.
      const { kind, ...endpoints } = selected;
      if (!pair(endpoints)) throw fail('invalid_endpoint');
      if (activeLink) throw fail('device_busy');
      const state = ensureWorker(), marker = {}; activeLink = marker;
      try { await request(state, 'open', { pair: JSON.parse(JSON.stringify(endpoints)) }); }
      catch (error) { if (activeLink === marker) activeLink = null; throw error; }
      let closing = null;
      const available = () => { if (closing || stopped) throw fail('disconnected'); return state; };
      return {
        async send(packet) {
          if (!(packet instanceof Uint8Array || Array.isArray(packet)) || packet.length < 2 || packet.length > 605) throw fail('invalid_frame');
          return request(available(), 'send', { packet: Array.from(packet) });
        },
        async read(timeoutMs) {
          if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 180000) throw fail('invalid_endpoint');
          const value = await request(available(), 'read', { timeoutMs: Math.ceil(timeoutMs) });
          return value === null ? null : Uint8Array.from(value);
        },
        async drain() { return request(available(), 'drain'); },
        async isConnected() { if (closing || stopped || state.exited || state.failure) return false; return request(state, 'isConnected'); },
        close() {
          if (!closing) closing = retire(state).finally(() => { if (activeLink === marker) activeLink = null; });
          return closing;
        },
      };
    },
    close() {
      if (!closePromise) {
        stopped = true;
        closePromise = retire(current).catch(error => { closePromise = null; throw error; });
      }
      return closePromise;
    },
  };
}
