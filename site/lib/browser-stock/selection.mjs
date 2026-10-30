import { StockError } from './protocol.mjs';
const validName = name => typeof name === 'string' && name.length > 0 && name.length <= 128 && !/[\x00-\x1f\x7f]/.test(name);
export const canonicalName = name => {
  if (!validName(name)) throw new StockError('invalid_endpoint', 'Invalid MIDI endpoint name.');
  return name.replace(/ \d+$/, '').toLowerCase();
};
export function pairKind(name) {
  const base = canonicalName(name);
  if (base === 'fm-1' || base === 'fm-1 midi') return 'normal';
  if (base === 'ota-fm-1') return 'loader';
  return null;
}
export function candidatePairs(inventory) {
  const pairs = [];
  if (!inventory || !Array.isArray(inventory.inputs) || !Array.isArray(inventory.outputs) || inventory.inputs.length > 256 || inventory.outputs.length > 256) throw new StockError('invalid_inventory', 'MIDI inventory exceeds bounds.');
  for (const input of inventory.inputs) {
    const kind = pairKind(input.name);
    if (!kind) continue;
    const base = canonicalName(input.name);
    const inputs = inventory.inputs.filter(port => canonicalName(port.name) === base);
    const outputs = inventory.outputs.filter(port => canonicalName(port.name) === base);
    if (inputs.length > 1 || outputs.length > 1) throw new StockError('ambiguous_device', 'Multiple indistinguishable FM-1 MIDI endpoints are present.');
    if (outputs.length === 1) pairs.push({ inputName: input.name, outputName: outputs[0].name,
      inputId: input.id, outputId: outputs[0].id, kind });
  }
  return pairs;
}
export function selectPair(inventory, selected, mode) {
  let pairs = candidatePairs(inventory);
  if (mode) pairs = pairs.filter(pair => pair.kind === mode);
  else if (selected) pairs = pairs.filter(pair => pair.inputName === selected.inputName && pair.outputName === selected.outputName &&
    (selected.inputId === undefined || pair.inputId === selected.inputId) && (selected.outputId === undefined || pair.outputId === selected.outputId));
  if (pairs.length > 1) throw new StockError('ambiguous_device', 'Select one exact FM-1 input/output pair.');
  return pairs[0] ?? null;
}
