import { StockError, identityQuery, parseIdentity } from './protocol.mjs';
import { candidatePairs } from './selection.mjs';
export const grantedInventory = access => ({
  inputs: Array.from(access.inputs.values()).filter(port => port.state === 'connected').map(port => ({ id: port.id, name: port.name })),
  outputs: Array.from(access.outputs.values()).filter(port => port.state === 'connected').map(port => ({ id: port.id, name: port.name })),
});
export function makeWebMidiBackend(access, { onDeviceState = () => {} } = {}) {
  const links = new Set();
  let lastPair = null;
  const inventory = () => grantedInventory(access);
  const stateChanged = event => { try { onDeviceState(event?.port ?? null); } catch {} };
  access.addEventListener('statechange', stateChanged);
  return {
    get lastPair() { return lastPair; },
    async enumerate() { return inventory(); },
    async open(pair) {
      const confirmed = candidatePairs(inventory()).find(current => current.inputId === pair.inputId && current.outputId === pair.outputId &&
        current.inputName === pair.inputName && current.outputName === pair.outputName);
      if (!confirmed) throw new StockError('endpoint_unavailable', 'The selected FM-1 MIDI pair changed.');
      const input = access.inputs.get(pair.inputId), output = access.outputs.get(pair.outputId);
      let closed = false, failure = null, pending = null;
      const queue = [];
      const receive = event => {
        if (closed || !event.data?.length || event.data[0] !== 0xf0) return;
        if (event.data.length > 605 || event.data.at(-1) !== 0xf7 || queue.length >= 128) {
          failure = new StockError('invalid_frame', 'FM-1 SysEx receive framing exceeded its bounds.');
          if (pending) { pending.reject(failure); pending = null; }
          return;
        }
        const packet = Uint8Array.from(event.data);
        if (pending) { const waiting = pending; pending = null; waiting.resolve(packet); } else queue.push(packet);
      };
      const lost = () => {
        if (input.state !== 'connected' || output.state !== 'connected') {
          failure = new StockError('disconnected', 'The FM-1 MIDI connection was lost.');
          if (pending) { pending.reject(failure); pending = null; }
        }
      };
      try {
        input.addEventListener('midimessage', receive); access.addEventListener('statechange', lost);
        await input.open(); await output.open();
        if (input.state !== 'connected' || output.state !== 'connected') throw new Error('disconnected');
      } catch {
        input.removeEventListener('midimessage', receive); access.removeEventListener('statechange', lost);
        try { await input.close(); } catch {} try { await output.close(); } catch {}
        throw new StockError('endpoint_unavailable', 'The selected FM-1 MIDI endpoints could not be opened.');
      }
      lastPair = { ...confirmed };
      const link = {
        async send(packet) {
          if (closed || failure) throw failure ?? new StockError('disconnected', 'The FM-1 MIDI connection is closed.');
          try { output.send(Uint8Array.from(packet)); return true; }
          catch { throw new StockError('send_failed', 'Web MIDI could not send the stock update packet.'); }
        },
        async read(timeout) {
          if (failure) throw failure;
          if (queue.length) return queue.shift();
          if (closed) return null;
          if (pending) throw new StockError('concurrent_read', 'Concurrent FM-1 MIDI reads are not allowed.');
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pending = null; resolve(null); }, Math.max(1, Math.ceil(timeout)));
            pending = { resolve: packet => { clearTimeout(timer); resolve(packet); }, reject: error => { clearTimeout(timer); reject(error); } };
          });
        },
        async drain() { if (failure) throw failure; queue.length = 0; },
        async isConnected() { return input.state === 'connected' && output.state === 'connected'; },
        async close() {
          if (closed) return; closed = true; links.delete(link);
          if (pending) { pending.resolve(null); pending = null; }
          queue.length = 0; input.removeEventListener('midimessage', receive); access.removeEventListener('statechange', lost);
          const results = await Promise.allSettled([input.close(), output.close()]);
          if (results.some(result => result.status === 'rejected')) throw new StockError('close_failed', 'FM-1 MIDI endpoint close failed.');
        },
      };
      links.add(link); return link;
    },
    async close() {
      access.removeEventListener('statechange', stateChanged);
      const results = await Promise.allSettled(Array.from(links, link => link.close()));
      if (results.some(result => result.status === 'rejected')) throw new StockError('close_failed', 'FM-1 MIDI endpoint cleanup failed.');
    },
  };
}
export async function identifyPair(backend, pair, { clock, timing }) {
  const link = await backend.open(pair);
  try {
    await clock.sleep(timing.open); await link.drain(); await link.send(identityQuery());
    const packet = await link.read(timing.handshake);
    if (packet === null) throw new StockError('identity_timeout', 'The selected FM-1 did not answer its identity query.');
    return parseIdentity(packet);
  } finally { await link.close(); }
}
