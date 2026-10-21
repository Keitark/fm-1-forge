/*!
SPDX-License-Identifier: MIT
Container/cipher format derived from m-vave/fm1_open sdk/Package.cs, commit
b178ac43c25f010c60a878056fb5331fe693fd62 (MIT), and its jl-misctools source.
Copyright (c) 2023 Andrey Grigoryev (kagaimiq), 2026 M-VAVE.
https://github.com/m-vave/fm1_open/blob/b178ac43c25f010c60a878056fb5331fe693fd62/sdk/Package.cs
Upstream MIT permission notice retained below (modified JavaScript port).
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
// This implementation deliberately preserves the public V15 flash layout;
// Package.Create/BuildFlash's movable reserved partitions are NOT used.
import { createHash } from 'node:crypto';
import { STOCK, StockError } from './protocol.mjs';

export const MAX_CUSTOM_FWSC_BYTES = 2 * 1024 * 1024;
export const CUSTOM_POLICY_VERSION = 'customfwsc-v1';
export const CUSTOM_IDENTITY = 'FM1_FORGE_001';
export const CUSTOM_APPLICATION_MAX_BYTES = 581564;
const FLASH_BYTES = 0x93000, AREA = 0x4000, APP = 0x4120;
const APP_END = 0x920dc, AREA_BYTES = 582235, PUBLIC_CODE = 0x980f;
const OTA_BYTES = 19969, LOGICAL_BYTES = 623136, RAW_BYTES = LOGICAL_BYTES + 20;
const OTA_SHA = 'ef1f2db89b011fa53e71df363f0122de0ea896618c53fb53e8da676322004541';
const STOCK_APP_SHA = '306e47065f35d7a7a05ada7f5dd092f6e770952054f33f0a86b75fd10ffe3203';
const PIN = Object.freeze({
  boot: 'd9f43191777656de01c7bed4f9e9ba2e34e94832c5d2ed02c3fc7ab7a6d9bd67',
  directory: 'b1b958082be71c8dc6ffb0f5f5b232ceba1d4910bfe956e1286edb2088ec4e6a',
  afterapp: 'ad33e0a1c44386a640251a6e4529691122a99ff8b1717abbd08f028729e4c903',
  areaFields: '390fd7ec13f3c1a41f46512b6b930833ed2c87a5c60dd276163b467ffcd6f801',
});
const fail = message => { throw new StockError('invalid_custom_package', message); };
const require = (condition, message) => { if (!condition) fail(message); };
const sha = data => createHash('sha256').update(data).digest('hex');
const hex = data => Buffer.from(data).toString('hex');
const bytes = input => {
  require(input instanceof Uint8Array && input.length <= MAX_CUSTOM_FWSC_BYTES, 'Expected bounded byte input.');
  return Uint8Array.from(input);
};
const round32 = n => Math.ceil(n / 32) * 32;
const view = data => new DataView(data.buffer, data.byteOffset, data.byteLength);
const u16 = (data, at) => view(data).getUint16(at, true);
const u32 = (data, at) => view(data).getUint32(at, true);
const put16 = (data, at, n) => view(data).setUint16(at, n, true);
const put32 = (data, at, n) => view(data).setUint32(at, n, true);
const ascii = text => Uint8Array.from(text, ch => ch.charCodeAt(0));
const equal = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);
function crc16(data) {
  let value = 0;
  for (const byte of data) {
    value ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) value = ((value << 1) ^ (value & 0x8000 ? 0x1021 : 0)) & 65535;
  }
  return value;
}
function cipher(input, state = 65535) {
  const out = Uint8Array.from(input);
  for (let i = 0; i < out.length; i++) {
    out[i] ^= state & 255;
    state = ((state << 1) ^ (state & 0x8000 ? 0x1021 : 0)) & 65535;
  }
  return out;
}
function unwrapFwsc(raw, identity) {
  require(raw.length >= 960 && raw.length <= MAX_CUSTOM_FWSC_BYTES, 'Invalid FWSC length.');
  const image = new Uint8Array(raw.length - 20);
  for (let i = 0; i < 20; i++) {
    const expected = i < identity.length ? identity.charCodeAt(i) + i + 1 : 125;
    require(raw[i * 48 + 47] === expected, 'Invalid or noncanonical FWSC product marker.');
    image.set(raw.subarray(i * 48, i * 48 + 47), i * 47);
  }
  image.set(raw.subarray(960), 940);
  return image;
}
function wrapFwsc(image, identity) {
  require(image.length >= 940 && image.length + 20 <= MAX_CUSTOM_FWSC_BYTES &&
    typeof identity === 'string' && identity.length <= 20, 'Invalid FWSC wrapper.');
  const raw = new Uint8Array(image.length + 20);
  for (let i = 0; i < 20; i++) {
    raw.set(image.subarray(i * 47, i * 47 + 47), i * 48);
    raw[i * 48 + 47] = i < identity.length ? identity.charCodeAt(i) + i + 1 : 125;
  }
  raw.set(image.subarray(940), 960); return raw;
}
function parseUfw(image, { verifyPayloadCrc = true } = {}) {
  require(image.length >= 1024 && image.length <= MAX_CUSTOM_FWSC_BYTES - 20, 'Invalid UFW size.');
  const head = cipher(image.subarray(0, 64)), count = u16(head, 8);
  require(u16(head, 0) === crc16(head.subarray(2)) && u32(head, 4) === image.length &&
    count > 0 && count <= 8 && u16(head, 10) === 4 && u32(head, 12) === 512 &&
    equal(head.subarray(16, 23), ascii('AC791N\0')) && head.subarray(23).every(n => n === 0), 'Invalid UFW header or chip.');
  const tableEnd = 64 + count * 80;
  require(u16(head, 2) === crc16(image.subarray(64, tableEnd)), 'UFW directory CRC mismatch.');
  const entries = [];
  let previousEnd = 1024;
  for (let i = 0; i < count; i++) {
    const record = cipher(image.subarray(64 + i * 80, 144 + i * 80));
    const offset = u32(record, 8), size = u32(record, 12), stored = u32(record, 16);
    const nameField = record.subarray(64), terminator = nameField.indexOf(0);
    require(u16(record, 2) === i && terminator > 0 && nameField.subarray(terminator).every(n => n === 0) &&
      offset >= previousEnd && offset % 32 === 0 && stored === round32(size) &&
      offset <= image.length && stored <= image.length - offset, 'Invalid UFW file range/name or overlapping entries.');
    const data = image.subarray(offset, offset + size);
    require(!verifyPayloadCrc || u16(record, 4) === crc16(data), 'UFW file CRC mismatch.');
    entries.push({ type: u16(record, 0), index: i, name: String.fromCharCode(...nameField.subarray(0, terminator)), offset, size, stored, data, record });
    previousEnd = offset + stored;
  }
  require(previousEnd === image.length, 'Unexpected trailing UFW data.');
  return { head, entries };
}
function makeUfw(flash, ota) {
  const otaAt = 1024 + round32(flash.length), total = otaAt + round32(ota.length);
  const image = new Uint8Array(total).fill(255), head = new Uint8Array(64);
  for (const [i, data] of [flash, ota].entries()) {
    const entry = new Uint8Array(80), at = i === 0 ? 1024 : otaAt;
    put16(entry, 0, i === 0 ? 0 : 100); put16(entry, 2, i); put16(entry, 4, crc16(data));
    put32(entry, 8, at); put32(entry, 12, data.length); put32(entry, 16, round32(data.length));
    entry.set(ascii(i === 0 ? 'flash.bin' : 'ota.bin'), 64);
    image.set(cipher(entry), 64 + 80 * i); image.set(data, at);
  }
  put16(head, 2, crc16(image.subarray(64, 224))); put32(head, 4, total);
  put16(head, 8, 2); put16(head, 10, 4); put32(head, 12, 512); head.set(ascii('AC791N'), 16);
  put16(head, 0, crc16(head.subarray(2))); image.set(cipher(head));
  return image;
}
function decodeFlash(flash) {
  const plain = Uint8Array.from(flash);
  for (let at = AREA; at < plain.length; at += 32) plain.set(cipher(flash.subarray(at, at + 32), PUBLIC_CODE ^ ((at - AREA) >>> 2)), at);
  return plain;
}
function checkFlash(flash) {
  require(flash.length === FLASH_BYTES && sha(flash.subarray(0, AREA)) === PIN.boot &&
    sha(flash.subarray(AREA + 64, APP)) === PIN.directory && sha(flash.subarray(APP_END)) === PIN.afterapp,
  'Public V15 boot/config/reserved bytes or fixed layout changed.');
  const plain = decodeFlash(flash), length = u32(plain, AREA + 40);
  require(length > 0 && length <= CUSTOM_APPLICATION_MAX_BYTES &&
    sha(plain.subarray(AREA + 4, AREA + 32)) === PIN.areaFields &&
    u32(plain, AREA + 36) === 0x120 && u16(plain, AREA + 44) === 0xff82 && u16(plain, AREA + 46) === 0 &&
    equal(plain.subarray(AREA + 48, AREA + 56), ascii('app.bin\0')) &&
    plain.subarray(AREA + 56, AREA + 64).every(n => n === 255), 'Invalid application directory shape.');
  for (let at = AREA; at <= AREA + 192; at += 32) require(u16(plain, at) === crc16(plain.subarray(at + 2, at + 32)), 'Flash directory header CRC mismatch.');
  require(u16(plain, AREA + 2) === crc16(plain.subarray(AREA + 32, AREA + AREA_BYTES)) &&
    u16(plain, AREA + 34) === crc16(plain.subarray(APP, APP + length)) &&
    u16(plain, AREA + 66) === crc16(plain.subarray(APP_END, APP_END + 383)), 'Flash payload CRC mismatch.');
  return { plain, application: plain.subarray(APP, APP + length), length };
}

// A standard SHA-256 Merkle range proof commits the preserved ciphertext
// suffix to the exact public V15 application slot. No vendor image is embedded.
// Every hash is domain separated; leaf index and actual length are committed.
const MERKLE_ROOT = 'c6cfa497bbe50e36fe5775f5bc3a4bfaa38985c004027982938c72d0b1b30a87';
const TREE_LEAVES = 32768, BLOCK_BYTES = 32;
const LEAF_DOMAIN = Buffer.from('fm1-customfwsc-v1:leaf\0');
const NODE_DOMAIN = Buffer.from('fm1-customfwsc-v1:node\0');
function leafHashPart(part, index) {
  const fields = new Uint8Array(8); put32(fields, 0, index); put32(fields, 4, part.length);
  return createHash('sha256').update(LEAF_DOMAIN).update(fields).update(part).digest();
}
function leafHash(slot, index) { return leafHashPart(slot.subarray(index * BLOCK_BYTES, (index + 1) * BLOCK_BYTES), index); }
function nodeHash(left, right) { return createHash('sha256').update(NODE_DOMAIN).update(left).update(right).digest(); }
function prefixCover(mutableBlocks, start = 0, count = TREE_LEAVES, result = []) {
  if (start >= mutableBlocks) return result;
  if (start + count <= mutableBlocks) { result.push({ start, count }); return result; }
  prefixCover(mutableBlocks, start, count / 2, result);
  prefixCover(mutableBlocks, start + count / 2, count / 2, result);
  return result;
}
function makeTailProof(originalSlot, newLength) {
  const layers = [Array.from({ length: TREE_LEAVES }, (_, i) => leafHash(originalSlot, i))];
  while (layers.at(-1).length > 1) {
    const layer = layers.at(-1), next = [];
    for (let i = 0; i < layer.length; i += 2) next.push(nodeHash(layer[i], layer[i+1]));
    layers.push(next);
  }
  const whole = Math.floor(newLength / BLOCK_BYTES), boundaryStart = whole * BLOCK_BYTES;
  return { block_bytes: BLOCK_BYTES, mutable_blocks: Math.ceil(newLength / BLOCK_BYTES),
    boundary_prefix_hex: hex(originalSlot.subarray(boundaryStart, newLength)),
    prefix_hashes: prefixCover(whole).map(({ start, count }) => hex(layers[Math.log2(count)][start / count])) };
}
function tailDigest(proof, candidateSlot) {
  const boundary = Buffer.from(proof.boundary_prefix_hex, 'hex');
  const whole = proof.mutable_blocks - (boundary.length > 0 ? 1 : 0);
  const covers = prefixCover(whole), known = new Map(covers.map((cover, i) => [`${cover.start}:${cover.count}`, Buffer.from(proof.prefix_hashes[i], 'hex')]));
  function subtree(start, count) {
    const saved = known.get(`${start}:${count}`); if (saved) return saved;
    if (count === 1) {
      if (boundary.length > 0 && start === whole) {
        // Authenticate the untouched bytes of the partial block as well. Its
        // overwritten original prefix is committed by the pinned Merkle root.
        const originalBlock = Uint8Array.from(candidateSlot.subarray(start * BLOCK_BYTES, (start + 1) * BLOCK_BYTES));
        originalBlock.set(boundary); return leafHashPart(originalBlock, start);
      }
      return leafHash(candidateSlot, start);
    }
    return nodeHash(subtree(start, count / 2), subtree(start + count / 2, count / 2));
  }
  return hex(subtree(0, TREE_LEAVES));
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exactKeys(value, keys) { return isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) && value !== '0'.repeat(64);
const MANIFEST_FIELDS = ['schemaVersion','policy_version','package_sha256','logical_sha256','raw_bytes','logical_bytes','target_build_sha256',
  'expected_boot_identity','family','profile','source_stock_sha256','ota_sha256','application_sha256','application_bytes','preservation','hardware_qualified','stock_tail_proof'];
export function validateCustomManifest(manifest) {
  require(exactKeys(manifest, MANIFEST_FIELDS), 'Custom manifest fields are invalid.');
  require(manifest.schemaVersion === 1 && manifest.policy_version === CUSTOM_POLICY_VERSION &&
    manifest.raw_bytes === RAW_BYTES && manifest.logical_bytes === LOGICAL_BYTES &&
    manifest.expected_boot_identity === CUSTOM_IDENTITY && manifest.family === 8 && manifest.profile === 'forge-diag' &&
    manifest.source_stock_sha256 === STOCK.sha256 && manifest.ota_sha256 === OTA_SHA &&
    manifest.preservation === 'public-v15-fixed-layout-app-only' && manifest.hardware_qualified === false,
  'Custom manifest policy or pinned source differs.');
  for (const key of ['package_sha256','logical_sha256','target_build_sha256','application_sha256']) require(digest(manifest[key]), `Invalid ${key}.`);
  const length = manifest.application_bytes, proof = manifest.stock_tail_proof;
  require(Number.isSafeInteger(length) && length > 0 && length <= CUSTOM_APPLICATION_MAX_BYTES &&
    exactKeys(proof, ['block_bytes','mutable_blocks','boundary_prefix_hex','prefix_hashes']) && proof.block_bytes === BLOCK_BYTES &&
    proof.mutable_blocks === Math.ceil(length / BLOCK_BYTES) &&
    typeof proof.boundary_prefix_hex === 'string' && /^[0-9a-f]*$/.test(proof.boundary_prefix_hex) &&
    proof.boundary_prefix_hex.length === (length % BLOCK_BYTES) * 2 && Array.isArray(proof.prefix_hashes) &&
    proof.prefix_hashes.length === prefixCover(Math.floor(length / BLOCK_BYTES)).length && proof.prefix_hashes.every(digest),
  'Invalid application size or preserved-tail proof.');
  return Object.freeze({ ...manifest, stock_tail_proof: Object.freeze({ ...proof, prefix_hashes: Object.freeze([...proof.prefix_hashes]) }) });
}
export async function buildCustomFwsc({ stockPackage, application, targetBuildSha256, profile = 'forge-diag' } = {}) {
  const stock = bytes(stockPackage), app = bytes(application);
  require(stock.length === STOCK.rawBytes && sha(stock) === STOCK.sha256, 'Only the pinned public V15 FWSC template is accepted.');
  require(app.length > 0 && app.length <= CUSTOM_APPLICATION_MAX_BYTES && digest(targetBuildSha256) && profile === 'forge-diag', 'Invalid custom application, build digest or profile.');
  require(Buffer.from(app).includes(Buffer.from(targetBuildSha256, 'hex')), 'Application does not contain the declared firmware MIDI build identity.');
  // Auxiliary stock entries use other encodings. Their exact bytes are pinned
  // by the package SHA; only the two retained raw resources need raw-data CRCs.
  const source = parseUfw(unwrapFwsc(stock, STOCK.product), { verifyPayloadCrc: false });
  const flash = source.entries.find(e => e.name === 'flash.bin' && e.type === 0)?.data;
  const ota = source.entries.find(e => e.name === 'ota.bin' && e.type === 100)?.data;
  require(flash?.length === FLASH_BYTES && ota?.length === OTA_BYTES && sha(ota) === OTA_SHA &&
    source.entries.filter(e => e.name === 'flash.bin' || e.name === 'ota.bin').every(e => u16(e.record, 4) === crc16(e.data)), 'Pinned public template resources differ.');
  const { plain, application: original } = checkFlash(flash);
  require(original.length === CUSTOM_APPLICATION_MAX_BYTES && sha(original) === STOCK_APP_SHA, 'Unexpected public V15 application.');
  const proof = makeTailProof(flash.subarray(APP, APP_END), app.length), candidate = Uint8Array.from(flash);
  plain.set(app, APP); put16(plain, AREA + 34, crc16(app)); put32(plain, AREA + 40, app.length);
  put16(plain, AREA + 32, crc16(plain.subarray(AREA + 34, AREA + 64)));
  put16(plain, AREA + 2, crc16(plain.subarray(AREA + 32, AREA + AREA_BYTES)));
  put16(plain, AREA, crc16(plain.subarray(AREA + 2, AREA + 32)));
  for (const [begin, end] of [[AREA, AREA + 64], [APP, round32(APP + app.length)]]) {
    for (let at = begin; at < end; at += 32) candidate.set(cipher(plain.subarray(at, at + 32), PUBLIC_CODE ^ ((at - AREA) >>> 2)), at);
  }
  const image = makeUfw(candidate, ota), raw = wrapFwsc(image, CUSTOM_IDENTITY);
  const manifest = {
    schemaVersion: 1, policy_version: CUSTOM_POLICY_VERSION, package_sha256: sha(raw), logical_sha256: sha(image), raw_bytes: raw.length, logical_bytes: image.length,
    target_build_sha256: targetBuildSha256, expected_boot_identity: CUSTOM_IDENTITY, family: 8, profile,
    source_stock_sha256: STOCK.sha256, ota_sha256: OTA_SHA, application_sha256: sha(app), application_bytes: app.length,
    preservation: 'public-v15-fixed-layout-app-only', hardware_qualified: false, stock_tail_proof: proof,
  };
  await inspectCustomFwsc(raw, manifest);
  return { raw, manifest: validateCustomManifest(manifest) };
}
export async function inspectCustomFwsc(input, inputManifest) {
  const manifest = validateCustomManifest(inputManifest), raw = bytes(input);
  require(raw.length === RAW_BYTES && sha(raw) === manifest.package_sha256, 'Custom package size or digest mismatch.');
  const image = unwrapFwsc(raw, CUSTOM_IDENTITY);
  require(sha(image) === manifest.logical_sha256, 'Custom logical-image digest mismatch.');
  const { entries } = parseUfw(image);
  require(entries.length === 2 && entries[0].type === 0 && entries[0].name === 'flash.bin' && entries[0].offset === 1024 && entries[0].size === FLASH_BYTES &&
    entries[1].type === 100 && entries[1].name === 'ota.bin' && entries[1].offset === 603136 && entries[1].size === OTA_BYTES &&
    image.subarray(224, 1024).every(n => n === 255) && image.subarray(623105).every(n => n === 255), 'Custom UFW must contain only canonical flash.bin and ota.bin.');
  // Rebuilding also rejects hidden fields and alternate padding in the entries.
  require(equal(makeUfw(entries[0].data, entries[1].data), image), 'Noncanonical custom UFW encoding.');
  require(sha(entries[1].data) === OTA_SHA, 'Only the pinned official OTA loader is accepted.');
  const { plain, application: app, length } = checkFlash(entries[0].data);
  require(length === manifest.application_bytes && sha(app) === manifest.application_sha256, 'Custom application does not match its manifest.');
  require(Buffer.from(app).includes(Buffer.from(manifest.target_build_sha256, 'hex')), 'Application does not contain the declared firmware MIDI build identity.');
  require(tailDigest(manifest.stock_tail_proof, entries[0].data.subarray(APP, APP_END)) === MERKLE_ROOT,
    'Unused public-stock application tail was changed.');
  const metadata = Object.freeze({ product: CUSTOM_IDENTITY, sha256: manifest.package_sha256, raw_bytes: raw.length, logical_bytes: image.length,
    logical_sha256: manifest.logical_sha256, target_build_sha256: manifest.target_build_sha256, expected_boot_identity: CUSTOM_IDENTITY,
    application_sha256: manifest.application_sha256, application_bytes: length, family: 8, policy_version: CUSTOM_POLICY_VERSION });
  const policy = Object.freeze({ version: CUSTOM_POLICY_VERSION, preservation: manifest.preservation, source_stock_sha256: STOCK.sha256,
    ota_sha256: OTA_SHA, hardware_qualified: false, installation_guard_changed: false });
  return { metadata, image, policy };
}

// Pure format primitives are exported for deterministic synthetic vectors. They
// cannot change the pins or relax buildCustomFwsc/inspectCustomFwsc policy.
export const customPackageFormat = Object.freeze({ crc16, cipher, unwrapFwsc, wrapFwsc, parseUfw, makeUfw, makeTailProof, tailDigest });
