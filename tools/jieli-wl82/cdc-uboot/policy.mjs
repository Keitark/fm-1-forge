// SPDX-License-Identifier: MIT
// Pure, unit-local V15 application replacement. No device APIs or key output.
import { createHash } from 'node:crypto';
export const FLASH_BYTES = 0x100000, APP_START = 0x4120, APP_END = 0x920dc, APP_CAPACITY = APP_END - APP_START;
export const SECTOR_BYTES = 4096, PAGE_BYTES = 256;
const AREA = 0x4000, AREA_BYTES = 582235, CFG_BYTES = 383;
const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_v15_candidate' }); };
const need = (ok, message) => { if (!ok) fail(message); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = (bytes, length) => { need(bytes instanceof Uint8Array && bytes.length === length, 'Exact bounded image bytes required.'); return Uint8Array.from(bytes); };
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u16 = (bytes, at) => view(bytes).getUint16(at, true), u32 = (bytes, at) => view(bytes).getUint32(at, true);
const put16 = (bytes, at, n) => view(bytes).setUint16(at, n, true), put32 = (bytes, at, n) => view(bytes).setUint32(at, n, true);
const equal = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);
export function crc16(bytes) { let n = 0; for (const b of bytes) { n ^= b << 8; for (let j = 0; j < 8; j++) n = ((n << 1) ^ (n & 0x8000 ? 0x1021 : 0)) & 65535; } return n; }
function crypt(input, key) { const bytes = Uint8Array.from(input); for (let i = 0; i < bytes.length; i++) { bytes[i] ^= key & 255; key = ((key << 1) ^ (key & 0x8000 ? 0x1021 : 0)) & 65535; } return bytes; }
function entry(bytes, at) {
  need(u16(bytes, at) === crc16(bytes.subarray(at + 2, at + 32)), 'Directory CRC mismatch.');
  const name = bytes.subarray(at + 16, at + 32), end = name.indexOf(0);
  need(end > 0 && name.subarray(0, end).every(b => b >= 32 && b <= 126), 'Directory name invalid.');
  return { name: String.fromCharCode(...name.subarray(0, end)), offset: u32(bytes, at + 4), size: u32(bytes, at + 8), flags: bytes[at + 12], reserved: bytes[at + 13], index: u16(bytes, at + 14) };
}
function shape(actual, expected) { for (const [key, value] of Object.entries(expected)) need(actual[key] === value, 'V15 directory layout differs.'); }
function decode(input) {
  const raw = copy(input, FLASH_BYTES), head = crypt(raw.subarray(0, 32), 65535);
  need(u16(head, 0) !== 0 && u16(head, 0) === crc16(head.subarray(2)), 'Flash header CRC mismatch.');
  const top = [];
  for (let at = 32; at <= 128; at += 32) top.push(entry(crypt(raw.subarray(at, at + 32), 65535), 0));
  const tops = [
    { name: 'uboot.boot', offset: 160, size: 14384, flags: 0, reserved: 0, index: 0 },
    { name: 'isd_config.ini', offset: 14544, size: 699, flags: 2, reserved: 128, index: 0 },
    { name: 'app_dir_head', offset: AREA, size: 0xffffffff, flags: 129, reserved: 255, index: 0 },
    { name: 'key_mac', offset: 0xff000, size: 4096, flags: 18, reserved: 1, index: 65535 },
  ];
  top.forEach((e, i) => shape(e, tops[i]));
  const config = raw.subarray(top[1].offset, top[1].offset + 32);
  need(crc16(config) === u16(raw, top[1].offset + 32), 'Encoding metadata CRC mismatch.');
  let threshold = config.subarray(0, 16).reduce((sum, b) => sum + b, 0) & 255;
  if (threshold >= 224) threshold = 170; else if (threshold <= 16) threshold = 85;
  let key = 0;
  for (let i = 0; i < 16; i++) if ((config[16 + i] ^ config[15 - i]) < threshold) key |= 1 << i;
  const plain = Uint8Array.from(raw);
  for (let at = AREA; at < Math.ceil((AREA + AREA_BYTES) / 32) * 32; at += 32) plain.set(crypt(raw.subarray(at, at + 32), key ^ ((at - AREA) >>> 2)), at);
  shape(entry(plain, AREA), { name: 'app_area_head', offset: 0x2000120, size: AREA_BYTES, flags: 131, reserved: 255, index: 0 });
  const app = entry(plain, AREA + 32);
  shape(app, { name: 'app.bin', offset: 0x120, flags: 130, reserved: 255, index: 0 });
  need(app.size > 0 && app.size <= APP_CAPACITY, 'Application exceeds the fixed V15 slot.');
  const expected = [
    { name: 'cfg_tool.bin', offset: APP_END - AREA, size: CFG_BYTES, flags: 130, reserved: 255, index: 0 },
    { name: 'VM', offset: 0x93000, size: 352256, flags: 18, reserved: 128, index: 0 },
    { name: 'PRCT', offset: 0, size: 602112, flags: 146, reserved: 130, index: 0 },
    { name: 'BTIF', offset: 0xe9000, size: 4096, flags: 146, reserved: 128, index: 0 },
    { name: 'USR', offset: 0xea000, size: 73728, flags: 146, reserved: 129, index: 1 },
  ];
  expected.forEach((e, i) => shape(entry(plain, AREA + 64 + i * 32), e));
  need(u16(plain, AREA + 2) === crc16(plain.subarray(AREA + 32, AREA + AREA_BYTES)), 'V15 area CRC mismatch.');
  need(u16(plain, AREA + 34) === crc16(plain.subarray(APP_START, APP_START + app.size)), 'Application CRC mismatch.');
  need(u16(plain, AREA + 66) === crc16(plain.subarray(APP_END, APP_END + CFG_BYTES)), 'Configuration CRC mismatch.');
  return { raw, plain, key, length: app.size };
}
function application(input, build) {
  need(input instanceof Uint8Array && input.length > 0 && input.length <= APP_CAPACITY, 'Application length invalid.');
  need(typeof build === 'string' && /^[a-f0-9]{64}$/.test(build) && build !== '0'.repeat(64), 'Target build identity invalid.');
  const app = Uint8Array.from(input);
  need(Buffer.from(app).includes(Buffer.from(build, 'hex')), 'Application lacks its target build identity.');
  return app;
}
export function inspectBaseline(input) {
  const data = decode(input);
  return Object.freeze({ baseline_sha256: sha(data.raw), application_sha256: sha(data.plain.subarray(APP_START, APP_START + data.length)), application_bytes: data.length,
    application_offset: APP_START, application_capacity: APP_CAPACITY, configuration_offset: APP_END, vm_offset: 0x93000 });
}
function buildCandidate(data, app) {
  const plain = data.plain, candidate = Uint8Array.from(data.raw);
  plain.set(app, APP_START); put16(plain, AREA + 34, crc16(app)); put32(plain, AREA + 40, app.length);
  put16(plain, AREA + 32, crc16(plain.subarray(AREA + 34, AREA + 64)));
  put16(plain, AREA + 2, crc16(plain.subarray(AREA + 32, AREA + AREA_BYTES)));
  put16(plain, AREA, crc16(plain.subarray(AREA + 2, AREA + 32)));
  for (const [begin, end] of [[AREA, AREA + 64], [APP_START, Math.ceil((APP_START + app.length) / 32) * 32]]) {
    for (let at = begin; at < end; at += 32) candidate.set(crypt(plain.subarray(at, at + 32), data.key ^ ((at - AREA) >>> 2)), at);
  }
  return candidate;
}
export function validateCandidate(baseline, candidate, input, targetBuildSha256) {
  const app = application(input, targetBuildSha256), data = decode(baseline), actual = copy(candidate, FLASH_BYTES), expected = buildCandidate(data, app);
  need(equal(actual, expected), 'Candidate differs from the exact baseline-derived application replacement.');
  const after = decode(actual);
  need(after.length === app.length && equal(after.plain.subarray(APP_START, APP_START + app.length), app), 'Candidate application round-trip mismatch.');
  return true;
}
export function planApplication(baseline, input, targetBuildSha256) {
  const app = application(input, targetBuildSha256), data = decode(baseline), candidate = buildCandidate(data, app), sectors = [];
  validateCandidate(baseline, candidate, app, targetBuildSha256);
  for (let at = AREA + SECTOR_BYTES; at < 0x93000; at += SECTOR_BYTES) if (!equal(data.raw.subarray(at, at + SECTOR_BYTES), candidate.subarray(at, at + SECTOR_BYTES))) sectors.push(at);
  if (!equal(data.raw.subarray(AREA, AREA + SECTOR_BYTES), candidate.subarray(AREA, AREA + SECTOR_BYTES))) sectors.push(AREA);
  return { candidate, baseline_sha256: sha(data.raw), candidate_sha256: sha(candidate), application_sha256: sha(app), target_build_sha256: targetBuildSha256, sectors, no_changes: sectors.length === 0 };
}
