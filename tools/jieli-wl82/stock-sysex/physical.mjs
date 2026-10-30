import { StockError } from './protocol.mjs';
export const isPinnedLoaderPhysical = value => value?.vid === '4d4a' && value.pid === '4155' && value.mi === '00' && /^[a-f0-9]{64}$/.test(value.instanceHash ?? '');
export function correlateInventory(inventory, records) {
  const result = { inputs: inventory.inputs.map(name => ({ name, physical: null })), outputs: inventory.outputs.map(name => ({ name, physical: null })) };
  if (!Array.isArray(records)) return result;
  for (const [direction, endpoints] of [['in', result.inputs], ['out', result.outputs]]) {
    const matches = records.filter(record => record.direction === direction);
    if (matches.length !== endpoints.length) return result;
    for (let index = 0; index < endpoints.length; index++) {
      const row = matches.find(record => record.index === index);
      if (!row || row.name !== endpoints[index].name) return result;
    }
  }
  for (const [direction, endpoints] of [['in', result.inputs], ['out', result.outputs]]) {
    for (let index = 0; index < endpoints.length; index++) {
      const row = records.find(record => record.direction === direction && record.index === index);
      if (row.interfaceQueryOk === true && /^[a-f0-9]{4}$/.test(row.vid ?? '') && /^[a-f0-9]{4}$/.test(row.pid ?? '') &&
          /^[a-f0-9]{2}$/.test(row.mi ?? '') && /^[a-f0-9]{64}$/.test(row.instanceHash ?? '')) {
        endpoints[index].physical = { vid: row.vid, pid: row.pid, mi: row.mi, instanceHash: row.instanceHash };
      }
    }
  }
  return result;
}
export function assertPhysicalPair(inventory, pair) {
  const input = inventory.inputs.find(port => port.name === pair.inputName)?.physical;
  const output = inventory.outputs.find(port => port.name === pair.outputName)?.physical;
  const approved = pair.physical;
  const loader = isPinnedLoaderPhysical(approved) && approved.correlated === true && approved.userSelected === false &&
    /^usb-midi(?: \d+)?$/i.test(pair.inputName) && /^usb-midi(?: \d+)?$/i.test(pair.outputName);
  if (!input || !output || !approved || !(loader ? isPinnedLoaderPhysical(input) : input.vid === '4c4a' && input.pid === 'c755') ||
      ['vid', 'pid', 'mi', 'instanceHash'].some(key => input[key] !== output[key] || input[key] !== approved[key])) {
    throw new StockError('physical_correlation_failed', 'Selected generic MIDI endpoints do not belong to the reviewed FM-1 USB instance.');
  }
}
