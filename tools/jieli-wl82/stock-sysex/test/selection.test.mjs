import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalName, candidatePairs, selectPair, validateSelectedPair } from '../selection.mjs';
import { standardPair } from './helpers.mjs';
const inventory = (inputs, outputs = inputs) => ({ inputs, outputs });

test('only matched stock endpoint names and WinMM numeric suffixes auto-select', () => {
  assert.equal(canonicalName('FM-1 Midi 2'), 'fm-1 midi');
  assert.deepEqual(selectPair(inventory(['FM-1 Midi 1'], ['FM-1 Midi 2'])), { ...standardPair, kind: 'normal' });
  for (const name of ['FM-1', 'ota-FM-1', 'FM-1 Midi']) assert.equal(candidatePairs(inventory([name])).length, 1);
  for (const name of ['Other synth', 'Felucca', 'FM-1 port', 'Sinco', 'USB-MIDI', 'USB Composite Device']) assert.equal(candidatePairs(inventory([name])).length, 0);
  assert.equal(selectPair(inventory(['FM-1'], ['Other synth'])), null);
  assert.equal(selectPair(inventory(['FM-1'], ['FM-1 Midi'])), null);
});
test('ambiguous duplicated units and simultaneous FM-1 pairs reject selection', () => {
  assert.throws(() => candidatePairs(inventory(['FM-1 1', 'FM-1 2'])), { code: 'ambiguous_device' });
  assert.throws(() => candidatePairs(inventory(['FM-1'], ['FM-1 1', 'FM-1 2'])), { code: 'ambiguous_device' });
  assert.throws(() => selectPair(inventory(['FM-1', 'ota-FM-1'])), { code: 'ambiguous_device' });
});
test('generic stock port requires caller physical correlation AND user selection', () => {
  const generic = { inputName: 'USB Composite Device 1', outputName: 'USB Composite Device 2', physical: { vid: '4c4a', pid: 'c755', mi: '00', instanceHash: 'a'.repeat(64), correlated: true, userSelected: true } };
  const physicallyVerified = inventory([{ name: generic.inputName, physical: generic.physical }], [{ name: generic.outputName, physical: generic.physical }]);
  assert.equal(selectPair(physicallyVerified, generic).kind, 'generic');
  assert.throws(() => selectPair(inventory([generic.inputName], [generic.outputName]), generic), { code: 'physical_correlation_failed' });
  for (const physical of [undefined, { ...generic.physical, correlated: false }, { ...generic.physical, userSelected: false }, { ...generic.physical, pid: '0000' }]) {
    assert.throws(() => validateSelectedPair({ ...generic, physical }), { code: 'invalid_endpoint' });
  }
  assert.throws(() => validateSelectedPair({ ...generic, inputName: 'Other synth', outputName: 'Other synth' }));
});
test('explicit selection is exact and does not fall back to sole unrelated output', () => {
  assert.equal(selectPair(inventory(['FM-1'], ['Other']), { inputName: 'FM-1', outputName: 'FM-1' }), null);
  assert.equal(selectPair(inventory(['FM-1 Midi 3'], ['FM-1 Midi 4']), standardPair), null);
  assert.throws(() => validateSelectedPair({ inputName: 'FM-1\n', outputName: 'FM-1' }));
  assert.throws(() => validateSelectedPair({ ...standardPair, message: [240, 247] }));
});

const loaderPhysical = { vid: '4d4a', pid: '4155', mi: '00', instanceHash: 'a'.repeat(64) };
const loaderInventory = (input = loaderPhysical, output = loaderPhysical) => inventory([{ name: 'USB-Midi 0', physical: input }], [{ name: 'USB-Midi 1', physical: output }]);
test('generic OTA loader requires exact correlated USB identity and remains loader-only', () => {
  const selected = selectPair(loaderInventory(), standardPair, 'loader');
  assert.equal(selected.kind, 'loader'); assert.equal(selected.inputName, 'USB-Midi 0'); assert.equal(selected.physical.userSelected, false);
  assert.doesNotThrow(() => validateSelectedPair({ inputName: selected.inputName, outputName: selected.outputName, physical: selected.physical }));
  assert.equal(selectPair(loaderInventory(), standardPair, 'normal'), null);
  assert.equal(selectPair(loaderInventory(), standardPair), null);
  for (const changes of [{ vid: '1234' }, { pid: 'c755' }, { mi: '01' }, { instanceHash: 'bad' }]) assert.equal(selectPair(loaderInventory({ ...loaderPhysical, ...changes }), standardPair, 'loader'), null);
  for (const changes of [{ vid: '1234' }, { pid: 'c755' }, { mi: '01' }, { instanceHash: 'b'.repeat(64) }]) assert.throws(() => selectPair(loaderInventory(loaderPhysical, { ...loaderPhysical, ...changes }), standardPair, 'loader'), { code: 'physical_correlation_failed' });
  assert.equal(selectPair(inventory(['USB-Midi 0'], ['USB-Midi 1']), standardPair, 'loader'), null);
});
test('multiple loader endpoints or mixed named and generic loaders remain ambiguous', () => {
  const duplicate = loaderInventory(); duplicate.inputs.push({ name: 'USB-Midi 2', physical: loaderPhysical });
  assert.throws(() => selectPair(duplicate, standardPair, 'loader'), { code: 'ambiguous_device' });
  const mixed = loaderInventory(); mixed.inputs.push('ota-FM-1'); mixed.outputs.push('ota-FM-1');
  assert.throws(() => selectPair(mixed, standardPair, 'loader'), { code: 'ambiguous_device' });
  assert.throws(() => validateSelectedPair({ inputName: 'USB-Midi', outputName: 'USB-Midi', physical: { ...loaderPhysical, correlated: true, userSelected: true } }), { code: 'invalid_endpoint' });
});
