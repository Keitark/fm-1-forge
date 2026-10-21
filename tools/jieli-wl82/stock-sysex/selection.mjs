import { StockError } from './protocol.mjs';
import { assertPhysicalPair } from './physical.mjs';

const portName = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);
export function canonicalName(name) {
  if (!portName(name)) throw new StockError('invalid_endpoint', 'Invalid MIDI endpoint name.');
  return name.replace(/ \d+$/, '').toLowerCase();
}
export function pairKind(name) {
  const canonical = canonicalName(name);
  if (canonical === 'fm-1' || canonical === 'fm-1 midi') return 'normal';
  if (canonical === 'ota-fm-1') return 'loader';
  return null;
}
export function validateSelectedPair(pair) {
  if (!pair || typeof pair !== 'object' || Array.isArray(pair) || Object.keys(pair).some(key => !['inputName', 'outputName', 'physical'].includes(key)) ||
      !portName(pair.inputName) || !portName(pair.outputName) || canonicalName(pair.inputName) !== canonicalName(pair.outputName)) {
    throw new StockError('invalid_endpoint', 'A matched FM-1 input/output pair is required.');
  }
  if (!pairKind(pair.inputName)) {
    const physical = pair.physical;
    if (!/^usb composite device(?: midi(?: \d+)?)?$/i.test(canonicalName(pair.inputName)) || !physical ||
        physical.vid !== '4c4a' || physical.pid !== 'c755' || !/^[a-f0-9]{2}$/.test(physical.mi ?? '') ||
        !/^[a-f0-9]{64}$/.test(physical.instanceHash ?? '') || physical.correlated !== true || physical.userSelected !== true ||
        Object.keys(physical).some(key => !['vid', 'pid', 'mi', 'instanceHash', 'correlated', 'userSelected'].includes(key))) {
      throw new StockError('invalid_endpoint', 'Generic MIDI endpoints require explicit FM-1 USB correlation and user selection.');
    }
  } else if (pair.physical !== undefined) {
    throw new StockError('invalid_endpoint', 'Physical correlation metadata is only accepted for a generic stock endpoint.');
  }
  return JSON.parse(JSON.stringify(pair));
}
export function candidatePairs(inventory, selectedPair) {
  if (!inventory || !Array.isArray(inventory.inputs) || !Array.isArray(inventory.outputs) || inventory.inputs.length > 1024 || inventory.outputs.length > 1024) throw new StockError('invalid_inventory', 'Invalid MIDI inventory.');
  const inputs = inventory.inputs.map(port => typeof port === 'string' ? port : port.name);
  const outputs = inventory.outputs.map(port => typeof port === 'string' ? port : port.name);
  if (inputs.some(name => !portName(name)) || outputs.some(name => !portName(name))) throw new StockError('invalid_inventory', 'Invalid MIDI endpoint metadata.');
  const pairs = [];
  for (const inputName of inputs) {
    const canonical = canonicalName(inputName), kind = pairKind(inputName);
    if (!kind) continue;
    const sameInputs = inputs.filter(name => canonicalName(name) === canonical);
    const sameOutputs = outputs.filter(name => canonicalName(name) === canonical);
    // Even an explicitly selected name does not make duplicate, indistinguishable units safe.
    if (sameInputs.length > 1 || sameOutputs.length > 1) throw new StockError('ambiguous_device', 'Multiple FM-1 endpoints cannot be correlated safely.');
    if (!sameOutputs.length) continue;
    pairs.push({ inputName, outputName: sameOutputs[0], kind });
  }
  if (selectedPair) {
    const chosen = validateSelectedPair(selectedPair);
    if (!pairKind(chosen.inputName)) {
      const sameInputs = inputs.filter(name => canonicalName(name) === canonicalName(chosen.inputName));
      const sameOutputs = outputs.filter(name => canonicalName(name) === canonicalName(chosen.outputName));
      if (sameInputs.length > 1 || sameOutputs.length > 1) throw new StockError('ambiguous_device', 'Generic MIDI endpoints are ambiguous.');
      if (inputs.includes(chosen.inputName) && outputs.includes(chosen.outputName)) {
        assertPhysicalPair(inventory, chosen);
        pairs.push({ ...chosen, kind: 'generic' });
      }
    }
  }
  return pairs;
}
export function selectPair(inventory, selectedPair, desiredMode) {
  let candidates = candidatePairs(inventory, selectedPair);
  if (desiredMode) candidates = candidates.filter(pair => pair.kind === desiredMode || pair.kind === 'generic');
  if (!desiredMode && selectedPair) candidates = candidates.filter(pair => pair.inputName === selectedPair.inputName && pair.outputName === selectedPair.outputName);
  if (candidates.length > 1) throw new StockError('ambiguous_device', 'More than one FM-1 pair is present.');
  return candidates[0] ?? null;
}
