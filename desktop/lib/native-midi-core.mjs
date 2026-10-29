import { StockError } from '../../tools/jieli-wl82/stock-sysex/protocol.mjs';
import { canonicalName, validateSelectedPair } from '../../tools/jieli-wl82/stock-sysex/selection.mjs';
import { readWindowsMetadata } from '../../tools/jieli-wl82/stock-sysex/windows-metadata.mjs';
import { correlateInventory, assertPhysicalPair } from '../../tools/jieli-wl82/stock-sysex/physical.mjs';

const accepted = new Set(['fm-1', 'fm-1 midi', 'fm-1 forge', 'fm1_forge_001', 'ota-fm-1', 'usb-midi']);
const fail = (code, message) => new StockError(code, message);

// Loaded only by an explicit native connection. No renderer permission request,
// HTTP listener, Python runtime or independently running service is involved.
export async function createNativeMidiCore({ midiModule, metadataReader = readWindowsMetadata, platform = process.platform } = {}) {
  let midi;
  try { midi = midiModule ?? await import('@julusian/midi'); }
  catch { throw fail('midi_runtime_unavailable', 'The packaged native MIDI runtime is unavailable.'); }
  const enumerate = async (timeoutMs = 10000) => {
    try {
      return correlateInventory({ inputs: midi.Input.getPortNames(), outputs: midi.Output.getPortNames() }, platform === 'win32' ? await metadataReader(timeoutMs) : null);
    } catch { throw fail('midi_inventory_unavailable', 'Native MIDI inventory is unavailable.'); }
  };
  return {
    enumerate,
    async open(pair) {
      if (!pair || !accepted.has(canonicalName(pair.inputName)) || canonicalName(pair.inputName) !== canonicalName(pair.outputName)) {
        throw fail('invalid_endpoint', 'An exact FM-1 input/output pair is required.');
      }
      const current = await enumerate(), canonical = canonicalName(pair.inputName);
      if (canonical === 'usb-midi') {
        validateSelectedPair({ inputName: pair.inputName, outputName: pair.outputName, physical: pair.physical });
        assertPhysicalPair(current, pair);
      }
      const inputs = current.inputs.filter(port => canonicalName(port.name) === canonical);
      const outputs = current.outputs.filter(port => canonicalName(port.name) === canonical);
      if (inputs.length !== 1 || outputs.length !== 1 || inputs[0].name !== pair.inputName || outputs[0].name !== pair.outputName) {
        throw fail('endpoint_unavailable', 'The selected FM-1 MIDI endpoints changed.');
      }
      let input = null, output = null;
      let closed = false, failure = null, pending = null;
      const queue = [];
      const receive = (_delta, message) => {
        if (closed || failure || !message.length || message[0] !== 0xf0) return;
        if (message.length > 605 || message.at(-1) !== 0xf7 || queue.length >= 128) {
          failure = fail('invalid_frame', 'MIDI input exceeded its bounded SysEx framing.');
          if (pending) { const waiter = pending; pending = null; waiter.reject(failure); }
          return;
        }
        const packet = Uint8Array.from(message);
        if (pending) { const waiter = pending; pending = null; waiter.resolve(packet); } else queue.push(packet);
      };
      try {
        // Construct inside the same ownership guard as port opening: a native
        // Output allocation failure must still release an already-created Input.
        input = new midi.Input(); output = new midi.Output();
        input.ignoreTypes(false, true, true); input.setBufferSize(1024, 4); input.on('message', receive);
        input.openPortByName(pair.inputName); output.openPortByName(pair.outputName);
        if (!input.isPortOpen() || !output.isPortOpen()) throw new Error('not_open');
      } catch {
        input?.removeAllListeners(); try { input?.destroy(); } catch {} try { output?.destroy(); } catch {}
        throw fail('endpoint_unavailable', 'The selected FM-1 MIDI pair could not be opened.');
      }
      return {
        async send(packet) {
          if (closed || failure) throw failure ?? fail('disconnected', 'The MIDI connection is closed.');
          try { output.sendMessage(Array.from(packet)); return true; }
          catch { throw fail('send_failed', 'Native MIDI delivery failed.'); }
        },
        async read(milliseconds) {
          if (failure) throw failure;
          if (queue.length) return queue.shift();
          if (closed) return null;
          if (pending) throw fail('concurrent_read', 'Concurrent MIDI reads are not allowed.');
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pending = null; resolve(null); }, Math.max(1, Math.ceil(milliseconds)));
            pending = { resolve: packet => { clearTimeout(timer); resolve(packet); }, reject: error => { clearTimeout(timer); reject(error); } };
          });
        },
        async drain() { if (failure) throw failure; queue.length = 0; },
        async isConnected() {
          if (closed) return false;
          const inventory = await enumerate();
          if (canonical === 'usb-midi') {
            try { assertPhysicalPair(inventory, pair); } catch { return false; }
          }
          const matchingInputs = inventory.inputs.filter(port => canonicalName(port.name) === canonical);
          const matchingOutputs = inventory.outputs.filter(port => canonicalName(port.name) === canonical);
          return matchingInputs.length === 1 && matchingOutputs.length === 1 && matchingInputs[0].name === pair.inputName && matchingOutputs[0].name === pair.outputName;
        },
        async close() {
          if (closed) return; closed = true;
          if (pending) { const waiter = pending; pending = null; waiter.resolve(null); }
          input.removeAllListeners(); queue.length = 0;
          try { input.destroy(); } catch {} try { output.destroy(); } catch {}
        },
      };
    },
  };
}
