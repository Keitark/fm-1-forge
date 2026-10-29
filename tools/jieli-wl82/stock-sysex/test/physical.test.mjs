import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { correlateInventory, assertPhysicalPair } from '../physical.mjs';
import { selectPair } from '../selection.mjs';
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

const ota = { vid: '4d4a', pid: '4155', mi: '00', instanceHash: 'b'.repeat(64) };
const unindexedInventory = () => ({ inputs: ['Steinberg UR242-1', 'USB-Midi'], outputs: ['Microsoft GS Wavetable Synth', 'Steinberg UR242-1', 'USB-Midi'] });
const unindexedRows = () => [
  { direction: 'in', index: 0, name: 'Steinberg UR242-1', interfaceQueryOk: false },
  { direction: 'in', index: 1, name: 'USB-Midi', interfaceQueryOk: true, ...ota },
  { direction: 'out', index: 0, name: 'Microsoft GS Wavetable Synth', interfaceQueryOk: false },
  { direction: 'out', index: 1, name: 'Steinberg UR242-1', interfaceQueryOk: false },
  { direction: 'out', index: 2, name: 'USB-Midi', interfaceQueryOk: true, ...ota },
];

test('exact unindexed WinMM names correlate OTA at different input/output indices among unrelated ports', () => {
  const inventory = correlateInventory(unindexedInventory(), unindexedRows());
  const selected = selectPair(inventory, { inputName: 'FM-1 Midi', outputName: 'FM-1 Midi' }, 'loader');
  assert.deepEqual(selected, { inputName: 'USB-Midi', outputName: 'USB-Midi', physical: { ...ota, correlated: true, userSelected: false }, kind: 'loader' });
  assert.doesNotThrow(() => assertPhysicalPair(inventory, selected));
  assert.equal(inventory.inputs[0].physical, null); assert.equal(inventory.outputs[0].physical, null); assert.equal(inventory.outputs[1].physical, null);
  assert.deepEqual(inventory.inputs.map(port => port.name), unindexedInventory().inputs);
  assert.deepEqual(inventory.outputs.map(port => port.name), unindexedInventory().outputs);
});

test('unindexed OTA metadata still rejects changed full names indices counts and physical tuples', () => {
  const pair = { inputName: 'USB-Midi', outputName: 'USB-Midi', physical: { ...ota, correlated: true, userSelected: false } };
  for (const mutate of [
    rows => { rows[1].name = 'USB-Midi 1'; },
    rows => { rows[4].name = 'USB-Midi 2'; },
    rows => { rows[0].name = 'Steinberg UR242'; },
    rows => { rows[1].index = 0; },
    rows => { rows[4].index = 1; },
    rows => { rows.pop(); },
    rows => { rows.push({ ...rows[4] }); },
    rows => { rows[4].instanceHash = 'c'.repeat(64); },
    rows => { rows[4].vid = '4c4a'; },
    rows => { rows[4].pid = 'c755'; },
    rows => { rows[4].mi = '01'; },
    rows => { rows[4].interfaceQueryOk = false; },
  ]) {
    const rows = unindexedRows(); mutate(rows);
    assert.throws(() => assertPhysicalPair(correlateInventory(unindexedInventory(), rows), pair), { code: 'physical_correlation_failed' });
  }
});

test('Windows metadata helper exports caps display name without synthesizing an index suffix', async () => {
  const source = await fs.readFile(new URL('../windows-midi-inventory.ps1', import.meta.url), 'utf8');
  assert.match(source, /new Endpoint\{direction=input\?"in":"out",index=id,name=name,interfaceQueryOk=false\}/);
  assert.doesNotMatch(source, /name\s*=\s*name\s*\+/);
});
