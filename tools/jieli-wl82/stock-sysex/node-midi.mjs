import { StockError } from './protocol.mjs';
import { canonicalName, pairKind } from './selection.mjs';
import { readWindowsMetadata } from './windows-metadata.mjs';
import { correlateInventory, assertPhysicalPair } from './physical.mjs';

// No native dependency is imported by package inspection or pure-JS host tests.
export async function createNodeMidiBackend() {
  let midi;
  try { midi = await import('@julusian/midi'); }
  catch { throw new StockError('midi_runtime_unavailable', 'The pinned Node MIDI runtime is unavailable.'); }
  const enumerate = async (timeoutMs = 10000) => {
    try {
      const inventory = { inputs: midi.Input.getPortNames(), outputs: midi.Output.getPortNames() };
      return correlateInventory(inventory, await readWindowsMetadata(timeoutMs));
    }
    catch { throw new StockError('midi_inventory_unavailable', 'Windows MIDI inventory is unavailable.'); }
  };
  return {
    enumerate,
    async open(pair) {
      const inventory = await enumerate();
      const inputs = inventory.inputs.map(port => port.name), outputs = inventory.outputs.map(port => port.name);
      if (!inputs.includes(pair.inputName) || !outputs.includes(pair.outputName) ||
          inputs.filter(name => canonicalName(name) === canonicalName(pair.inputName)).length !== 1 ||
          outputs.filter(name => canonicalName(name) === canonicalName(pair.outputName)).length !== 1) throw new StockError('endpoint_unavailable', 'The reviewed MIDI endpoints changed.');
      if (!pairKind(pair.inputName)) assertPhysicalPair(inventory, pair);
      const input = new midi.Input(), output = new midi.Output();
      let closed = false, failure = null, pending = null;
      const queue = [];
      const receive = (_deltaTime, message) => {
        if (closed || !message.length || message[0] !== 0xf0) return;
        if (message.length > 605 || message.at(-1) !== 0xf7 || queue.length >= 128) {
          failure = new StockError('invalid_frame', 'MIDI input exceeded bounded SysEx framing.');
          if (pending) { pending.reject(failure); pending = null; }
          return;
        }
        const packet = Uint8Array.from(message);
        if (pending) { const waiting = pending; pending = null; waiting.resolve(packet); } else queue.push(packet);
      };
      try {
        input.ignoreTypes(false, true, true); input.setBufferSize(1024, 4); input.on('message', receive);
        input.openPortByName(pair.inputName); output.openPortByName(pair.outputName);
        if (!input.isPortOpen() || !output.isPortOpen()) throw new Error('not_open');
      } catch {
        input.removeAllListeners(); try { input.destroy(); } catch {} try { output.destroy(); } catch {}
        throw new StockError('endpoint_unavailable', 'The reviewed FM-1 MIDI pair could not be opened.');
      }
      return {
        async send(packet) {
          if (closed || failure) throw failure ?? new StockError('disconnected', 'MIDI connection is closed.');
          try { output.sendMessage(Array.from(packet)); return true; }
          catch { throw new StockError('send_failed', 'Windows MIDI send failed.'); }
        },
        async read(timeout) {
          if (failure) throw failure;
          if (queue.length) return queue.shift();
          if (closed) return null;
          if (pending) throw new StockError('concurrent_read', 'Concurrent MIDI reads are not allowed.');
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pending = null; resolve(null); }, Math.max(1, Math.ceil(timeout)));
            pending = { resolve: packet => { clearTimeout(timer); resolve(packet); }, reject: error => { clearTimeout(timer); reject(error); } };
          });
        },
        async drain() { if (failure) throw failure; queue.length = 0; },
        async isConnected() { const current = await enumerate(); return current.inputs.some(port => port.name === pair.inputName) && current.outputs.some(port => port.name === pair.outputName); },
        async close() {
          if (closed) return; closed = true;
          if (pending) { pending.resolve(null); pending = null; }
          input.removeAllListeners(); queue.length = 0;
          try { input.destroy(); } catch {} try { output.destroy(); } catch {}
        },
      };
    },
  };
}
