// Independent implementation of the documented FM-1 stock OTA wire protocol.
// See README.md for protocol sources and the intentionally narrow package policy.
export const STOCK = Object.freeze({
  product: 'FM-1_015', rawBytes: 699956, logicalBytes: 699936,
  sha256: 'db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a',
});
export const CHECK_FINISH = 0xe0000000;
export const WRITE_FINISH = 0xf0000000;
export const MAX_PAYLOAD = 512;
const QUERY = [0xf0, 0x00, 0x32, 0x45, 0x00, 0x00, 0x00, 0x40, 0x7f, 0xf7];
const UPGRADE = [0xf0, 0x22, 0x24, 0x35, 0x7f, 0xf7];
const SUCCESS = [115, 117, 99, 99, 101, 115, 115, 0];
export const identityQuery = () => Uint8Array.from(QUERY);
export const upgradeCommand = () => Uint8Array.from(UPGRADE);
export const successPayload = () => Uint8Array.from(SUCCESS);

export class StockError extends Error {
  constructor(code, message) { super(message); this.name = 'StockError'; this.code = code; }
}
const fail = (code, message) => { throw new StockError(code, message); };
function bytes(input) {
  if (!(input instanceof Uint8Array) && !Array.isArray(input)) fail('invalid_bytes', 'Expected byte array.');
  if (Array.isArray(input) && input.some(n => !Number.isInteger(n) || n < 0 || n > 255)) fail('invalid_bytes', 'Invalid byte.');
  return Uint8Array.from(input);
}
export function pack7(input) {
  const data = bytes(input), output = new Uint8Array(Math.ceil(data.length * 8 / 7));
  let accumulator = 0, bits = 0, position = 0;
  for (const value of data) {
    accumulator |= value << bits; bits += 8;
    while (bits >= 7) { output[position++] = accumulator & 127; accumulator >>>= 7; bits -= 7; }
  }
  if (bits) output[position] = accumulator;
  return output;
}
export function unpack7(input) {
  const packed = bytes(input);
  if (packed.some(n => n > 127)) fail('noncanonical_frame', 'SysEx data must be seven bit.');
  const output = new Uint8Array(Math.floor(packed.length * 7 / 8));
  let accumulator = 0, bits = 0, position = 0;
  for (const value of packed) {
    accumulator |= value << bits; bits += 7;
    if (bits >= 8) { output[position++] = accumulator & 255; accumulator >>>= 8; bits -= 8; }
  }
  if (accumulator !== 0 || pack7(output).length !== packed.length ||
      pack7(output).some((n, i) => n !== packed[i])) fail('noncanonical_frame', 'Noncanonical SysEx padding.');
  return output;
}
export function decodeFrame(input, maxDecoded = 527) {
  const packet = bytes(input);
  if (packet.length < 3 || packet.length > Math.ceil(maxDecoded * 8 / 7) + 2 ||
      packet[0] !== 0xf0 || packet.at(-1) !== 0xf7) fail('invalid_frame', 'Invalid SysEx framing or length.');
  return unpack7(packet.subarray(1, -1));
}
function frame(decoded) {
  const packed = pack7(decoded), packet = new Uint8Array(packed.length + 2);
  packet[0] = 0xf0; packet.set(packed, 1); packet[packet.length - 1] = 0xf7; return packet;
}
const u24 = (data, offset) => data[offset] + data[offset + 1] * 256 + data[offset + 2] * 65536;
const u32 = (data, offset) => u24(data, offset) + data[offset + 3] * 16777216;
const put24 = (data, offset, value) => { data[offset] = value & 255; data[offset + 1] = (value >>> 8) & 255; data[offset + 2] = (value >>> 16) & 255; };
const complement = data => (~data.reduce((sum, value) => sum + value, 0)) & 255;

export function parseRequest(input, imageLength = STOCK.logicalBytes, expectedFinish) {
  const data = decodeFrame(input, 15);
  if (data.length !== 15 || data[0] !== 0 || data[1] !== 0x59 || data[2] !== 0x30 ||
      u24(data, 3) !== 8 || complement(data.subarray(6, 14)) !== data[14]) fail('invalid_request', 'Invalid OTA read request.');
  const address = u32(data, 7), length = u24(data, 11), flags = data[6];
  const terminal = address === CHECK_FINISH || address === WRITE_FINISH;
  if (terminal) {
    if (length !== 8 || (expectedFinish !== undefined && address !== expectedFinish)) fail('wrong_terminal', 'Unexpected OTA terminal phase or length.');
  } else if (length === 0 || length > MAX_PAYLOAD || address >= imageLength || length > imageLength - address) {
    fail('request_out_of_range', 'OTA request outside the approved image.');
  }
  return Object.freeze({ address, length, flags, terminal });
}

export function response(address, input, flags = 0) {
  const data = bytes(input);
  if (!Number.isInteger(address) || address < 0 || address > 0xffffffff ||
      !Number.isInteger(flags) || flags < 0 || flags > 255 || data.length === 0 || data.length > MAX_PAYLOAD) fail('invalid_response', 'Invalid OTA response.');
  if ((address === CHECK_FINISH || address === WRITE_FINISH) &&
      (flags !== 0 || data.length !== SUCCESS.length || data.some((n, i) => n !== SUCCESS[i]))) fail('invalid_response', 'Terminal response must acknowledge success.');
  const decoded = new Uint8Array(data.length + 15);
  decoded.set([0, 0x59, 0x30]); put24(decoded, 3, data.length + 8); decoded[6] = flags;
  put24(decoded, 7, address); decoded[10] = (address >>> 24) & 255; put24(decoded, 11, data.length);
  decoded.set(data, 14); decoded[decoded.length - 1] = complement(decoded.subarray(6, -1));
  return frame(decoded);
}

export function parseIdentity(input) {
  const data = decodeFrame(input, 34);
  if (data.length !== 34 || data[0] !== 0 || data[1] !== 0x59 || data[2] !== 0x11 || u24(data, 3) !== 27 ||
      complement(data.subarray(6, 33)) !== data[33]) fail('invalid_identity', 'Invalid FM-1 identity block.');
  const field = data.subarray(6, 33), zero = field.indexOf(0);
  if (zero < 0 || field.subarray(zero).some(n => n !== 0)) fail('invalid_identity', 'Identity must be null terminated with zero padding.');
  const text = String.fromCharCode(...field.subarray(0, zero));
  const match = /^(ota-)?FM-1_(\d+)$/.exec(text);
  if (!match) fail('wrong_model', 'MIDI device is not an FM-1 stock protocol identity.');
  return Object.freeze({ text, model: match[1] ? 'ota-FM-1' : 'FM-1', version: Number(match[2]), loader: Boolean(match[1]) });
}

export function productOf(input) {
  const raw = bytes(input);
  if (raw.length < 960) fail('invalid_package', 'Stock package header is truncated.');
  let product = '';
  for (let index = 0; index < 20; index++) {
    const marker = raw[index * 48 + 47];
    if (marker !== 0x7d) product += String.fromCharCode((marker - index - 1) & 255);
  }
  return product;
}
export function logicalImage(input) {
  const raw = bytes(input);
  if (raw.length !== STOCK.rawBytes || productOf(raw) !== STOCK.product) fail('invalid_package', 'Only the pinned stock V15 package is supported.');
  const image = new Uint8Array(STOCK.logicalBytes);
  for (let index = 0; index < 20; index++) image.set(raw.subarray(index * 48, index * 48 + 47), index * 47);
  image.set(raw.subarray(960), 940); return image;
}
