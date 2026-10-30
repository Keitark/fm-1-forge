import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createNativeMidiCore } from './native-midi-core.mjs';
import { validateMidiRequest, validateMidiReply, midiWorkerErrorCode } from './native-midi.mjs';

// No listener, network endpoint, filesystem command, or arbitrary module input.
// The private IPC channel belongs solely to the parent native coordinator.
export function serveMidiWorker({ channel = process, backendFactory = createNativeMidiCore, exit = code => process.exit(code) } = {}) {
  let backendPromise = null, link = null, opening = null, closing = false, ended = false;
  const ids = new Set(); let highestId = 0;
  const backend = () => backendPromise ??= Promise.resolve().then(() => backendFactory());
  const finish = code => { if (!ended) { ended = true; exit(code); } };
  const send = value => {
    if (!ended && channel.connected !== false) try { channel.send(value, error => { if (error) finish(1); }); } catch { finish(1); }
  };
  async function close() {
    if (closing) return;
    closing = true;
    if (opening) try { await opening; } catch {}
    try { await link?.close(); } finally { link = null; }
    if (backendPromise) await (await backendPromise).close?.();
  }
  async function execute(request) {
    const { op, args } = request;
    if (op === 'close') { await close(); return null; }
    if (closing) throw { code: 'service_closed' };
    const core = await backend();
    if (closing) throw { code: 'service_closed' };
    if (op === 'enumerate') return core.enumerate(args.timeoutMs);
    if (op === 'open') {
      if (link || opening) throw { code: 'device_busy' };
      opening = core.open(args.pair);
      try { link = await opening; } finally { opening = null; }
      return null;
    }
    if (!link) throw { code: 'disconnected' };
    if (op === 'send') return link.send(Uint8Array.from(args.packet));
    if (op === 'read') { const result = await link.read(args.timeoutMs); return result === null ? null : Array.from(result); }
    if (op === 'drain') { await link.drain(); return null; }
    if (op === 'isConnected') return link.isConnected();
    throw { code: 'native_worker_protocol' };
  }
  const receive = request => {
    try {
      validateMidiRequest(request);
      if (request.id <= highestId || ids.size >= 32) throw new Error('protocol');
      highestId = request.id; ids.add(request.id);
    } catch { finish(1); return; }
    // Reads wait asynchronously; they must not block a close/shutdown command.
    void execute(request).then(result => {
      const reply = { id: request.id, ok: true, result };
      try { validateMidiReply(reply, request.op); } catch { throw { code: 'native_worker_protocol' }; }
      send(reply);
    }).catch(error => send({ id: request.id, ok: false, error: { code: midiWorkerErrorCode(error?.code) } }))
      .finally(() => { ids.delete(request.id); if (request.op === 'close') finish(0); });
  };
  const disconnect = () => { void close().catch(() => {}).finally(() => finish(0)); };
  channel.on('message', receive); channel.once('disconnect', disconnect);
  return { close: disconnect };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.send) process.exitCode = 1; else serveMidiWorker();
}
