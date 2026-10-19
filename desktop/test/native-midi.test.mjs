import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createNativeMidiBackend } from '../lib/native-midi.mjs';

const pair = { inputName: 'FM-1 Midi 0', outputName: 'FM-1 Midi 1' };
function nativeFixture({ inputConstructorError = false, outputConstructorError = false, openError = false } = {}) {
  const calls = [];
  class Input extends EventEmitter {
    static getPortNames() { return [pair.inputName]; }
    constructor() { super(); calls.push('input:construct'); if (inputConstructorError) throw new Error('private native allocation detail'); }
    ignoreTypes() { calls.push('input:ignore'); }
    setBufferSize() { calls.push('input:buffer'); }
    openPortByName() { calls.push('input:open'); if (openError) throw new Error('private native open detail'); }
    isPortOpen() { return true; }
    destroy() { calls.push('input:destroy'); }
  }
  class Output {
    static getPortNames() { return [pair.outputName]; }
    constructor() { calls.push('output:construct'); if (outputConstructorError) throw new Error('private native allocation detail'); }
    openPortByName() { calls.push('output:open'); }
    isPortOpen() { return true; }
    destroy() { calls.push('output:destroy'); }
  }
  return { calls, backend: () => createNativeMidiBackend({ midiModule: { Input, Output }, metadataReader: async () => null }) };
}

test('Output constructor failure destroys an already-allocated native Input without opening ports', async () => {
  const f = nativeFixture({ outputConstructorError: true }), backend = await f.backend();
  await assert.rejects(backend.open(pair), { code: 'endpoint_unavailable', message: 'The selected FM-1 MIDI pair could not be opened.' });
  assert.deepEqual(f.calls, ['input:construct', 'output:construct', 'input:destroy']);
});

test('Input constructor failure does not allocate Output or expose native exception details', async () => {
  const f = nativeFixture({ inputConstructorError: true }), backend = await f.backend();
  await assert.rejects(backend.open(pair), error => error.code === 'endpoint_unavailable' && !error.message.includes('private native'));
  assert.deepEqual(f.calls, ['input:construct']);
});

test('port-open failure destroys both successfully constructed native objects', async () => {
  const f = nativeFixture({ openError: true }), backend = await f.backend();
  await assert.rejects(backend.open(pair), { code: 'endpoint_unavailable' });
  assert.equal(f.calls.filter(call => call === 'input:destroy').length, 1);
  assert.equal(f.calls.filter(call => call === 'output:destroy').length, 1);
  assert.equal(f.calls.includes('output:open'), false);
});

test('successful native open keeps both objects owned until one idempotent close', async () => {
  const f = nativeFixture(), backend = await f.backend(), link = await backend.open(pair);
  assert.equal(f.calls.some(call => call.endsWith(':destroy')), false);
  await link.close(); await link.close();
  assert.equal(f.calls.filter(call => call === 'input:destroy').length, 1);
  assert.equal(f.calls.filter(call => call === 'output:destroy').length, 1);
});
