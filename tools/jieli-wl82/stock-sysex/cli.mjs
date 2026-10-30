#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { STOCK, StockError } from './protocol.mjs';
import { inspectPackage, absolutePath } from './files.mjs';
import { AttemptJournal, requestIdentity } from './journal.mjs';
import { candidatePairs, selectPair, validateSelectedPair } from './selection.mjs';
import { createNodeMidiBackend } from './node-midi.mjs';
import { runUpdate } from './updater.mjs';

const operations = new Set(['inspect_package', 'probe', 'update', 'resume']);
export function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || !operations.has(config.operation) ||
      Object.keys(config).some(key => !['operation', 'localPackagePath', 'reviewedSha256', 'jobId', 'stateRoot', 'expectedStockPair', 'endpointReviewId'].includes(key))) throw new StockError('invalid_config', 'Invalid worker operation or configuration.');
  const clean = JSON.parse(JSON.stringify(config));
  if (clean.expectedStockPair !== undefined) clean.expectedStockPair = validateSelectedPair(clean.expectedStockPair);
  if (clean.operation === 'inspect_package' || clean.operation === 'update' || clean.operation === 'resume') clean.localPackagePath = absolutePath(clean.localPackagePath);
  if (clean.operation === 'update' || clean.operation === 'resume') {
    clean.stateRoot = absolutePath(clean.stateRoot);
    if (!clean.expectedStockPair) throw new StockError('unreviewed_request', 'Explicit reviewed MIDI pair is required.');
    requestIdentity(clean);
  }
  return clean;
}
const knownMessage = Object.freeze({
  invalid_config: 'Invalid worker operation or configuration.', invalid_package: 'Only the pinned, unmodified official V15 package is supported.',
  unsafe_path: 'Unsafe local path.', unavailable_path: 'Required local file is unavailable.', unreviewed_request: 'A reviewed stock package and MIDI endpoint are required.',
});
export function errorResult(error, operation) {
  // Never emit OS exception strings: those can contain paths or private context.
  const trusted = error instanceof StockError;
  const code = trusted ? error.code : 'worker_failed';
  const uncertain = error.recovery_required === true || error.destructive_started === true;
  return { type: 'error', ok: false, operation: operations.has(operation) ? operation : null,
    error: { code, message: knownMessage[code] ?? (trusted ? error.message : 'The stock updater worker failed.'), state: uncertain ? 'unknown' : 'failed',
      recovery_required: uncertain, destructive_started: error.destructive_started === true,
      transfer_finished: error.transfer_finished === true, boot_identity_verified: false } };
}
export async function execute(input, { backendFactory = createNodeMidiBackend, emit = () => {} } = {}) {
  let config, journal, result;
  try {
    config = validateConfig(input);
    if (config.operation === 'inspect_package') {
      const artifact = await inspectPackage(config.localPackagePath);
      return { type: 'result', ok: true, operation: config.operation, data: artifact.metadata };
    }
    if (config.operation === 'probe') {
      const backend = await backendFactory(), inventory = await backend.enumerate();
      const pairs = candidatePairs(inventory, config.expectedStockPair);
      return { type: 'result', ok: true, operation: config.operation, data: { pairs,
        selectedPair: selectPair(inventory, config.expectedStockPair), identity_verified: false } };
    }
    // Package and exact request validation finish before importing native MIDI or opening handles.
    const artifact = await inspectPackage(config.localPackagePath);
    if (artifact.metadata.sha256 !== config.reviewedSha256 || config.reviewedSha256 !== STOCK.sha256) throw new StockError('unreviewed_request', 'Reviewed digest differs from the validated stock package.');
    journal = await AttemptJournal.open(config.stateRoot, requestIdentity(config), { resume: config.operation === 'resume' });
    const backend = await backendFactory();
    const data = await runUpdate(config, { image: artifact.image, backend, journal, onEvent: event => emit({ type: 'event', event }) });
    result = { type: 'result', ok: true, operation: config.operation, data };
  } catch (error) {
    // Runtime failure before UPGRADE can leave a prepared receipt but cannot start a new writer.
    if (journal?.record.state === 'prepared') {
      try { await journal.transition('failed', { state: 'failed', error_code: error.code ?? 'worker_failed' }); }
      catch { error.recovery_required = true; }
    }
    if (journal && ['active', 'unknown'].includes(journal.record.state)) error.recovery_required = true;
    result = errorResult(error, config?.operation ?? input?.operation);
  }
  if (journal) {
    try { await journal.close(); }
    catch (error) {
      error.recovery_required = ['active', 'unknown', 'succeeded'].includes(journal.record.state);
      error.destructive_started = journal.record.phase !== 'prepared' && journal.record.phase !== 'failed';
      error.transfer_finished = journal.record.transfer_finished;
      result = errorResult(error, config.operation);
    }
  }
  return result;
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new StockError('runtime_version', 'The stock updater requires the reviewed Node 22 runtime.');
  if (process.argv.length !== 2) throw new StockError('invalid_config', 'Worker accepts one bounded JSON object on stdin only.');
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk.toString('utf8');
    if (Buffer.byteLength(text) > 16384) throw new StockError('invalid_config', 'Worker request exceeds size limit.');
  }
  let config;
  try { config = JSON.parse(text); } catch { throw new StockError('invalid_config', 'Worker input must be one JSON object.'); }
  const print = data => process.stdout.write(`${JSON.stringify(data)}\n`);
  const result = await execute(config, { emit: print }); print(result); process.exitCode = result.ok ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stdout.write(`${JSON.stringify(errorResult(error, null))}\n`); process.exitCode = 1; });
}
