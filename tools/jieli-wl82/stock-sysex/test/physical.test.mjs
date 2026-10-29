import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateInventory, assertPhysicalPair } from '../physical.mjs';
const stock = { vid: '4c4a', pid: 'c755', mi: '00', instanceHash: 'a'.repeat(64) };
const pair = { inputName: 'USB Composite Device 0', outputName: 'USB Composite Device 1', physical: { ...stock, correlated: true, userSelected: true } };
const raw = { inputs: [pair.inputName], outputs: [pair.outputName] };
const rows = () => [{ direction: 'in', index: 0, name: pair.inputName, interfaceQueryOk: true, ...stock },
  { direction: 'out', index: 0, name: pair.outputName, interfaceQueryOk: true, ...stock }];
test('physical correlation requires exact WinMM index/name and same USB instance/interface', () => {
  assert.doesNotThrow(() => assertPhysicalPair(correlateInventory(raw, rows()), pair));
  for (const key of ['vid', 'pid', 'mi', 'instanceHash']) {
    const changed = rows(); changed[1][key] = key === 'instanceHash' ? 'b'.repeat(64) : 'ff';
    assert.throws(() => assertPhysicalPair(correlateInventory(raw, changed), pair), { code: 'physical_correlation_failed' });
  }
});
test('stale ordering, caps names, missing metadata and failed system query cannot correlate', () => {
  for (const mutate of [data => data.pop(), data => data[0].index++, data => data[0].name = 'Other device 0', data => data[0].interfaceQueryOk = false]) {
    const metadata = rows(); mutate(metadata);
    assert.throws(() => assertPhysicalPair(correlateInventory(raw, metadata), pair));
  }
  assert.throws(() => assertPhysicalPair(correlateInventory(raw, null), pair));
});
test('caller-correlated boolean is insufficient without actual local identity metadata', () => {
  const inventory = correlateInventory(raw, rows());
  assert.throws(() => assertPhysicalPair(inventory, { ...pair, physical: { ...pair.physical, instanceHash: 'b'.repeat(64) } }));
  assert.throws(() => assertPhysicalPair({ inputs: [{ name: pair.inputName }], outputs: [{ name: pair.outputName }] }, pair));
});

test('pinned USB-Midi loader never borrows normal stock or unrelated USB metadata', () => {
  const physical = { vid: '4d4a', pid: '4155', mi: '00', instanceHash: 'a'.repeat(64) };
  const pair = { inputName: 'USB-Midi 0', outputName: 'USB-Midi 1', physical: { ...physical, correlated: true, userSelected: false } };
  const inventory = { inputs: [{ name: pair.inputName, physical }], outputs: [{ name: pair.outputName, physical }] };
  assert.doesNotThrow(() => assertPhysicalPair(inventory, pair));
  for (const changes of [{ pid: 'c755' }, { mi: '01' }, { userSelected: true }, { correlated: false }]) assert.throws(() => assertPhysicalPair(inventory, { ...pair, physical: { ...pair.physical, ...changes } }));
  assert.throws(() => assertPhysicalPair(inventory, { ...pair, inputName: 'Other synth' }));
});
