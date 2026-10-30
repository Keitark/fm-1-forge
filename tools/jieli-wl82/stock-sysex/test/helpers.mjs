import { pack7, CHECK_FINISH, WRITE_FINISH, identityQuery, upgradeCommand, STOCK } from '../protocol.mjs';
export function makeFrame(raw) { return Uint8Array.from([0xf0, ...pack7(Uint8Array.from(raw)), 0xf7]); }
export function request(address, length, flags = 0) {
  const raw = [0, 0x59, 0x30, 8, 0, 0, flags, address & 255, (address >>> 8) & 255, (address >>> 16) & 255, (address >>> 24) & 255,
    length & 255, (length >>> 8) & 255, (length >>> 16) & 255];
  raw.push((~raw.slice(6).reduce((sum, n) => sum + n, 0)) & 255); return makeFrame(raw);
}
export function identity(text = 'FM-1_014') {
  const raw = Array(34).fill(0); raw.splice(0, 6, 0, 0x59, 0x11, 27, 0, 0);
  for (let index = 0; index < text.length; index++) raw[index + 6] = text.charCodeAt(index);
  raw[33] = (~raw.slice(6, 33).reduce((sum, n) => sum + n, 0)) & 255;
  return makeFrame(raw);
}
export const equalBytes = (left, right) => left.length === right.length && left.every((n, i) => n === right[i]);
export const standardPair = Object.freeze({ inputName: 'FM-1 Midi 1', outputName: 'FM-1 Midi 2' });
export function mockUpdater({ checkRequests = [request(0, 47), request(CHECK_FINISH, 8)], writeRequests = [request(512, 512), request(0, 47), request(512, 512), request(WRITE_FINISH, 8)],
  initialIdentity = 'FM-1_014', loaderIdentity = 'ota-FM-1_009', bootIdentity = 'FM-1_015', failSendAt = -1,
  disconnectPhase = null, loaderDelay = 0, rebootDelay = 0, resume = false, throwSendAt = -1 } = {}) {
  let now = 0, stage = resume ? 'loader' : 'normal', opens = 0, sends = 0, closed = 0;
  let stageChangedAt = 0;
  const sent = [], transitions = [], events = [], initial = standardPair;
  const pairFor = () => stage === 'loader' ? { inputName: 'ota-FM-1 1', outputName: 'ota-FM-1 2' } : initial;
  const clock = { now: () => now, sleep: async ms => { now += ms; } };
  const backend = {
    async enumerate() {
      if (stage === 'loader' && now - stageChangedAt < loaderDelay || stage === 'boot' && now - stageChangedAt < rebootDelay) return { inputs: [], outputs: [] };
      const pair = pairFor(); return { inputs: [pair.inputName], outputs: [pair.outputName] };
    },
    async open(pair) {
      opens++; let queue = [], upgraded = false; const atOpen = stage;
      return {
        async send(packet) {
          sent.push(Uint8Array.from(packet)); sends++;
          if (sends === throwSendAt) throw new Error('lost native send');
          if (sends === failSendAt) return false;
          if (equalBytes(packet, identityQuery())) {
            queue.push(identity(atOpen === 'loader' ? loaderIdentity : atOpen === 'boot' ? bootIdentity : initialIdentity));
          } else if (equalBytes(packet, upgradeCommand())) { upgraded = true; queue.push(...(atOpen === 'loader' ? writeRequests : checkRequests)); }
          return true;
        },
        async read(ms) { if (queue.length) return queue.shift(); now += ms; return null; },
        async drain() { queue = []; },
        async isConnected() { return atOpen !== disconnectPhase; },
        async close() { closed++; if (upgraded) { stage = atOpen === 'loader' ? 'boot' : 'loader'; stageChangedAt = now; } },
      };
    },
  };
  const journal = { record: { state: resume ? 'unknown' : 'prepared' }, async transition(phase, extra = {}) { transitions.push({ phase, ...extra }); this.record = { ...this.record, phase, ...extra }; } };
  const image = new Uint8Array(STOCK.logicalBytes); image.forEach((_, index) => { image[index] = index % 251; });
  return { clock, backend, journal, image, events, transitions, sent, get opens() { return opens; }, get closed() { return closed; },
    config: { operation: resume ? 'resume' : 'update', expectedStockPair: resume ? { inputName: 'ota-FM-1 1', outputName: 'ota-FM-1 2' } : standardPair, jobId: 'job-1' },
    options: { image, backend, journal, clock, onEvent: event => events.push(event) },
  };
}
