// SPDX-License-Identifier: Apache-2.0
// Synthetic permission rejections only. No hardware access or firmware writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommonUpdater } from '../lib/browser-common/updater.mjs';
import { cryptoFixture, fakeIndexedDB, fakeLocks, fakeMidi } from './browser-common-fixture.mjs';

function setup(native, synchronous = false) {
  const storage = fakeIndexedDB(), midi = fakeMidi();
  midi.navigator.requestMIDIAccess = options => {
    assert.deepEqual(options, { sysex: true }); midi.calls.permissions++;
    if (synchronous) throw native;
    return Promise.reject(native);
  };
  const updater = createCommonUpdater({ navigator: midi.navigator, indexedDB: storage.indexedDB, crypto: cryptoFixture, locks: fakeLocks(), location: { origin: 'https://permission.test' }, secureContext: true });
  return { updater, midi, storage };
}

test('common MIDI reports native permission/service rejection names before opening or arming a device', async () => {
  for (const name of ['SecurityError', 'NotAllowedError', 'NotSupportedError']) for (const synchronous of [true, false]) {
    const c = setup(new DOMException('PRIVATE_HOST_DETAIL' + String.fromCharCode(0, 10, 0x202e) + 'x'.repeat(10000), name), synchronous);
    await assert.rejects(c.updater.connect(), error => {
      assert.equal(error.code, 'midi_denied'); assert.match(error.message, /access request failed/); assert.ok(error.message.includes('(' + name + ')'));
      assert.ok(error.message.length < 256); assert.doesNotMatch(error.message, /PRIVATE_HOST_DETAIL/);
      assert.equal([...error.message].some(character => character.codePointAt(0) < 32 || character.codePointAt(0) === 0x202e), false); return true;
    });
    assert.equal(c.updater.status().connected, false); assert.equal(c.updater.status().installAvailable, false); assert.equal(c.updater.status().lastError, 'midi_denied');
    assert.equal(c.midi.calls.permissions, 1); assert.equal(c.midi.calls.opens, 0); assert.equal(c.midi.calls.arms, 0); assert.equal(c.midi.calls.triggers, 0); assert.equal(c.midi.calls.sends.length, 0); assert.equal(c.storage.records.get('current'), undefined);
  }
});

test('common MIDI never displays arbitrary messages, oversized names or throwing exception getters', async () => {
  const getterFailure = Object.defineProperty({}, 'name', { get() { throw new Error('PRIVATE_GETTER'); } });
  for (const native of [new Error('PRIVATE_MESSAGE'), { name: 'SecurityError' + String.fromCharCode(10) + 'PRIVATE_NAME', message: 'PRIVATE_MESSAGE' }, { name: 'PRIVATE_NAME'.repeat(10000), message: 'PRIVATE_MESSAGE' }, getterFailure]) {
    const c = setup(native);
    await assert.rejects(c.updater.connect(), error => {
      assert.equal(error.code, 'midi_denied'); assert.ok(error.message.length < 256); assert.doesNotMatch(error.message, /PRIVATE/);
      assert.equal([...error.message].some(character => character.codePointAt(0) < 32), false); return true;
    });
    assert.equal(c.midi.calls.permissions, 1); assert.equal(c.midi.calls.opens, 0); assert.equal(c.midi.calls.arms, 0); assert.equal(c.midi.calls.triggers, 0); assert.equal(c.midi.calls.sends.length, 0);
  }
});
