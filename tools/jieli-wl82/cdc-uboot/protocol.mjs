// SPDX-License-Identifier: MIT
// Closed WL82 command vectors derived from the pinned jl-uboot-tool (MIT).
import { createHash } from 'node:crypto';
import { crc16, FLASH_BYTES, SECTOR_BYTES, PAGE_BYTES } from './policy.mjs';
export const HELPER_BYTES = 24064, HELPER_ADDRESS = 0x1c02000, HELPER_CHUNK_BYTES = 512;
export const HELPER_SHA256 = 'd41da6126760c9d66660bcc0cac8d27d221806c5e369a8036921efe68dca5376';
const need = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { code: 'invalid_wl82_operation' }); };
const integer = n => Number.isSafeInteger(n) && n >= 0;
const be32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = n => [(n >>> 8) & 255, n & 255];
function command(code, args = [], dataOut = null, dataInLength = 16) {
  const cdb = new Uint8Array(16).fill(255); cdb.set([...be16(code), ...args]);
  return { cdb, dataOut: dataOut === null ? null : Uint8Array.from(dataOut), dataInLength };
}
export function inquiryCommand() { return { cdb: Uint8Array.from([0x12, 0, 0, 0, 36, 0]), dataOut: null, dataInLength: 36 }; }
export function statusCommand() { return command(0xfc03); }
export function onlineCommand() { return command(0xfc0a); }
export function readCommand(address, length = PAGE_BYTES) {
  need(integer(address) && address % PAGE_BYTES === 0 && length === PAGE_BYTES && address + length <= FLASH_BYTES, 'Read must be one aligned flash page.');
  return command(0xfd05, [...be32(address), ...be16(length)], null, length);
}
function sector(address) { need(integer(address) && address % SECTOR_BYTES === 0 && address >= 0x4000 && address < 0x93000, 'Erase outside V15 application sectors.'); }
export function eraseCommand(address) { sector(address); return command(0xfb01, be32(address)); }
export function programCommand(address, data) {
  need(integer(address) && address % PAGE_BYTES === 0 && address >= 0x4000 && address + PAGE_BYTES <= 0x93000 && data instanceof Uint8Array && data.length === PAGE_BYTES, 'Program outside one V15 application sector page.');
  const bytes = Uint8Array.from(data), crc = crc16(bytes);
  return command(0xfb04, [...be32(address), ...be16(bytes.length), 0, crc & 255, crc >>> 8], bytes, 0);
}
export function validateHelper(helper) {
  need(helper instanceof Uint8Array && helper.length === HELPER_BYTES && createHash('sha256').update(helper).digest('hex') === HELPER_SHA256, 'Pinned WL82 helper differs.'); return true;
}
export function helperChunkCommand(helper, index) {
  validateHelper(helper); need(integer(index) && index < HELPER_BYTES / HELPER_CHUNK_BYTES, 'Invalid helper chunk.');
  // The pinned blob already contains the per-512-byte MengLi encoding.
  const bytes = helper.subarray(index * HELPER_CHUNK_BYTES, (index + 1) * HELPER_CHUNK_BYTES), crc = crc16(bytes);
  return command(0xfb06, [...be32(HELPER_ADDRESS + index * HELPER_CHUNK_BYTES), ...be16(HELPER_CHUNK_BYTES), 0, crc & 255, crc >>> 8], bytes, 0);
}
export function helperJumpCommand() { return command(0xfb08, [...be32(HELPER_ADDRESS), ...be16(1)]); }
export function resetCommand() { return command(0xfc0c, be32(1)); }
export function checkedReply(code, data) {
  need([0xfc03, 0xfc0a, 0xfb01, 0xfb08, 0xfc0c].includes(code) && data instanceof Uint8Array && data.length === 16 && data[0] === (code >>> 8) && data[1] === (code & 255), 'Incomplete or mismatched loader response.');
  const payload = data.slice(2);
  if (code === 0xfb01) need(payload[0] === 0, 'Sector erase failed.');
  if (code === 0xfc0a) need(payload[0] === 3 && new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(2, true) === 0x856014, 'Unexpected flash identity.');
  return payload;
}
export function checkedInquiry(data) {
  need(data instanceof Uint8Array && data.length === 36, 'Incomplete inquiry.');
  need(data.subarray(8, 36).every(byte => byte >= 32 && byte <= 126), 'Inquiry identity must be exact printable ASCII.');
  const field = (begin, end) => Buffer.from(data.subarray(begin, end)).toString('ascii').trim();
  need(field(8, 16) === 'WL82' && field(16, 32) === 'UBOOT1.00' && field(32, 36) === '1.00', 'Unexpected inquiry identity.');
  return true;
}
