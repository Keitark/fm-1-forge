import test from 'node:test';
import assert from 'node:assert/strict';
import { pack7, unpack7, parseRequest, parseIdentity, response, decodeFrame, CHECK_FINISH, WRITE_FINISH,
  successPayload, identityQuery, upgradeCommand, STOCK, logicalImage, productOf } from '../protocol.mjs';
import { request, identity, makeFrame } from './helpers.mjs';

test('continuous LSB 8-to-7 known vectors and fresh command buffers', () => {
  assert.deepEqual([...pack7([0xff, 0x80, 0x55])], [127, 1, 86, 2]);
  assert.deepEqual([...unpack7([127, 1, 86, 2])], [255, 128, 85]);
  assert.deepEqual([...identityQuery()], [240, 0, 50, 69, 0, 0, 0, 64, 127, 247]);
  assert.deepEqual([...upgradeCommand()], [240, 34, 36, 53, 127, 247]);
  const changed = upgradeCommand(); changed[1] = 0; assert.equal(upgradeCommand()[1], 34);
});
test('roundtrip every byte and unaligned lengths', () => {
  for (const length of [0, 1, 2, 3, 7, 8, 47, 481, 512, 527]) {
    const raw = Uint8Array.from({ length }, (_, i) => i & 255);
    assert.deepEqual(unpack7(pack7(raw)), raw);
  }
});
test('reject noncanonical padding, oversized and internal status bytes', () => {
  for (const data of [[128], [1], [0], [127, 127]]) assert.throws(() => unpack7(data));
  assert.throws(() => decodeFrame([240, ...Array(700).fill(0), 247]));
  assert.throws(() => decodeFrame([240, 0, 240, 247]));
  assert.throws(() => decodeFrame([240, 0, 0]));
});
test('ordinary pulls preserve flags and boundary exactness', () => {
  assert.deepEqual(parseRequest(request(699935, 1, 129)), { address: 699935, length: 1, flags: 129, terminal: false });
  assert.equal(parseRequest(request(0, 512)).length, 512);
  for (const [address, length] of [[0, 0], [0, 513], [699935, 2], [699936, 1], [0xffffffff, 1]]) assert.throws(() => parseRequest(request(address, length)));
});
test('strict body length, checksum, header and decoded length', () => {
  const raw = decodeFrame(request(0, 47));
  for (const index of [0, 2, 3, 6, 14]) {
    const corrupt = Uint8Array.from(raw); corrupt[index] ^= 1; assert.throws(() => parseRequest(makeFrame(corrupt)));
  }
  assert.throws(() => parseRequest(makeFrame(raw.subarray(0, 14))));
});
test('terminal addresses retain all bits and reject wrong phase/length', () => {
  assert.equal(parseRequest(request(CHECK_FINISH, 8), STOCK.logicalBytes, CHECK_FINISH).address, CHECK_FINISH);
  assert.equal(parseRequest(request(WRITE_FINISH, 8), STOCK.logicalBytes, WRITE_FINISH).address, WRITE_FINISH);
  assert.throws(() => parseRequest(request(WRITE_FINISH, 8), STOCK.logicalBytes, CHECK_FINISH));
  assert.throws(() => parseRequest(request(CHECK_FINISH, 7)));
});
test('responses have exact partial block lengths and complement checksum', () => {
  for (const length of [1, 47, 481, 512]) {
    const data = Uint8Array.from({ length }, (_, i) => i % 256);
    const raw = decodeFrame(response(0x10203040, data, 7));
    assert.equal(raw.length, length + 15); assert.equal(raw[3] + raw[4] * 256, length + 8);
    assert.deepEqual([...raw.subarray(7, 11)], [64, 48, 32, 16]); assert.equal(raw[6], 7);
    assert.deepEqual(raw.subarray(14, -1), data);
    assert.equal((raw.subarray(6).reduce((sum, n) => sum + n, 0)) & 255, 255);
  }
  assert.deepEqual(decodeFrame(response(WRITE_FINISH, successPayload())).subarray(14, -1), successPayload());
  assert.throws(() => response(WRITE_FINISH, successPayload(), 1));
  assert.throws(() => response(0, new Uint8Array(513)));
});
test('only exact null-terminated stock model identities are accepted', () => {
  assert.equal(parseIdentity(identity()).text, 'FM-1_014');
  assert.equal(parseIdentity(identity('ota-FM-1_009')).loader, true);
  for (const text of ['Felucca_001', 'ota-Other_009', 'FM-1_015 extra', 'fm-1_015', 'FM-1_', 'FM-1_15\u001b']) assert.throws(() => parseIdentity(identity(text)));
  const raw = decodeFrame(identity()); raw[33] ^= 1; assert.throws(() => parseIdentity(makeFrame(raw)));
});
test('package marker stripping copies input and preserves raw offsets', () => {
  const raw = new Uint8Array(STOCK.rawBytes); raw.fill(0x7d);
  [...STOCK.product].forEach((character, index) => { raw[index * 48 + 47] = (character.charCodeAt(0) + index + 1) & 255; });
  const before = Uint8Array.from(raw); const image = logicalImage(raw);
  assert.equal(productOf(raw), STOCK.product); assert.equal(image.length, STOCK.logicalBytes);
  assert.deepEqual(raw, before); image[0] ^= 255; assert.deepEqual(raw, before);
  raw[47] ^= 1; assert.throws(() => logicalImage(raw));
});
