import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { STOCK } from '../protocol.mjs';
import { inspectPackage, readJson, atomicJson } from '../files.mjs';
import { AttemptJournal, requestIdentity } from '../journal.mjs';
import { execute, validateConfig, errorResult } from '../cli.mjs';
import { standardPair } from './helpers.mjs';

const fixturePath = process.env.FM1_STOCK_V15_FIXTURE ?? 'F:/dev/fm1/references/originals/FM-1-v15-original.fwsc';
const hasFixture = await fs.access(fixturePath).then(() => true, () => false);
const config = (stateRoot, changes = {}) => ({ operation: 'update', jobId: 'job-1', endpointReviewId: 'review-1',
  stateRoot, localPackagePath: fixturePath, reviewedSha256: STOCK.sha256, expectedStockPair: standardPair, ...changes });
async function temporary(testContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fm1-stock-test-'));
  testContext.after(async () => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('fm1-stock-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return root;
}
test('actual official package is byte-pinned and inspected without MIDI', { skip: !hasFixture }, async () => {
  const result = await inspectPackage(fixturePath);
  assert.deepEqual(result.metadata, { product: STOCK.product, sha256: STOCK.sha256, raw_bytes: 699956, logical_bytes: 699936 });
  assert.equal(result.image.length, 699936);
  let calls = 0;
  const receipt = await execute({ operation: 'inspect_package', localPackagePath: fixturePath }, { backendFactory: () => { calls++; throw new Error(); } });
  assert.equal(receipt.ok, true); assert.equal(calls, 0); assert.equal('image' in receipt.data, false);
});
test('single byte mutation and wrong raw length cannot import native MIDI', { skip: !hasFixture }, async context => {
  const root = await temporary(context), raw = await fs.readFile(fixturePath); raw[10000] ^= 1;
  const changed = path.join(root, 'mutated.fwsc'); await fs.writeFile(changed, raw);
  let calls = 0;
  const result = await execute(config(path.join(root, 'state'), { localPackagePath: changed }), { backendFactory: () => { calls++; } });
  assert.equal(result.ok, false); assert.equal(result.error.code, 'invalid_package'); assert.equal(result.error.destructive_started, false); assert.equal(calls, 0);
  await fs.writeFile(changed, raw.subarray(1)); await assert.rejects(inspectPackage(changed), { code: 'invalid_package' });
});
test('unreviewed digest, arbitrary commands and unsafe paths are preflight failures', async () => {
  let calls = 0;
  const backendFactory = () => { calls++; throw new Error(); };
  for (const input of [config(os.tmpdir(), { reviewedSha256: '0'.repeat(64) }), config(os.tmpdir(), { message: [240, 247] }),
    config(os.tmpdir(), { localPackagePath: 'relative.fwsc' }), config(os.tmpdir(), { jobId: '../write' }), config(os.tmpdir(), { endpointReviewId: undefined })]) {
    const result = await execute(input, { backendFactory }); assert.equal(result.ok, false); assert.equal(result.error.state, 'failed');
  }
  assert.equal(calls, 0); assert.throws(() => validateConfig({ operation: 'force' }));
});
test('probe is passive enumeration and never opens/sends to MIDI', async () => {
  let opens = 0;
  const result = await execute({ operation: 'probe', expectedStockPair: standardPair }, { backendFactory: async () => ({
    enumerate: async () => ({ inputs: [standardPair.inputName], outputs: [standardPair.outputName] }), open: async () => { opens++; },
  }) });
  assert.equal(result.ok, true); assert.equal(result.data.identity_verified, false); assert.equal(opens, 0);
});
test('runtime failure before upgrade records failed and suppresses private OS strings', { skip: !hasFixture }, async context => {
  const root = await temporary(context), stateRoot = path.join(root, 'state');
  const result = await execute(config(stateRoot), { backendFactory: async () => { throw new Error('secret path/token'); } });
  assert.equal(result.error.state, 'failed'); assert.equal(result.error.destructive_started, false);
  assert.equal(JSON.stringify(result).includes('secret'), false); assert.equal((await readJson(path.join(stateRoot, 'attempt.json'))).state, 'failed');
  await assert.rejects(fs.access(path.join(stateRoot, 'worker.lock')));
});
test('prepared journal persists exact reviewed identity and rejects competing owner', async context => {
  const root = await temporary(context), identity = requestIdentity(config(root));
  const journal = await AttemptJournal.open(root, identity);
  const saved = await readJson(path.join(root, 'attempt.json'));
  assert.equal(saved.requestDigest, identity.digest); assert.deepEqual(saved.request, JSON.parse(JSON.stringify(identity.request))); assert.equal(saved.state, 'prepared');
  await assert.rejects(AttemptJournal.open(root, requestIdentity(config(root, { jobId: 'job-2' }))), { code: 'worker_busy' });
  await journal.close();
});
test('active/unknown latch survives restart, permits only same-package explicit resume', async context => {
  const root = await temporary(context), identity = requestIdentity(config(root));
  let journal = await AttemptJournal.open(root, identity);
  await journal.transition('entering_check', { state: 'active' }); await journal.close();
  await assert.rejects(AttemptJournal.open(root, requestIdentity(config(root, { jobId: 'job-2' }))), { code: 'recovery_required' });
  await assert.rejects(AttemptJournal.open(root, requestIdentity(config(root, { endpointReviewId: 'review-2' })), { resume: true }), { code: 'resume_rejected' });
  journal = await AttemptJournal.open(root, identity, { resume: true });
  assert.equal(journal.record.state, 'unknown'); await journal.close();
});
test('completed job receipts cannot run twice or be replaced after another job', async context => {
  const root = await temporary(context), identity = requestIdentity(config(root));
  let journal = await AttemptJournal.open(root, identity); await journal.transition('done', { state: 'succeeded', transfer_finished: true, boot_identity_verified: true }); await journal.close();
  await assert.rejects(AttemptJournal.open(root, identity), { code: 'duplicate_attempt' });
  journal = await AttemptJournal.open(root, requestIdentity(config(root, { jobId: 'job-2' }))); await journal.transition('failed', { state: 'failed' }); await journal.close();
  assert.equal((await readJson(path.join(root, 'receipts', 'job-1.json'))).state, 'succeeded');
  await assert.rejects(AttemptJournal.open(root, identity), { code: 'duplicate_attempt' });
});
test('corrupt request digest and inconsistent success are fail closed', async context => {
  const root = await temporary(context), identity = requestIdentity(config(root));
  let journal = await AttemptJournal.open(root, identity); await journal.close();
  const file = path.join(root, 'attempt.json'), record = await readJson(file);
  await atomicJson(file, { ...record, request: { ...record.request, sha256: '0'.repeat(64) } });
  await assert.rejects(AttemptJournal.open(root, identity), { code: 'corrupt_journal' });
  await atomicJson(file, { ...record, state: 'succeeded', phase: 'done' });
  await assert.rejects(AttemptJournal.open(root, identity), { code: 'corrupt_journal' });
});
test('symlink package, state ancestor and journal are never trusted', async context => {
  const root = await temporary(context), target = path.join(root, 'target'), linked = path.join(root, 'linked');
  await fs.mkdir(target);
  await fs.symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(AttemptJournal.open(path.join(linked, 'state'), requestIdentity(config(path.join(linked, 'state')))), { code: 'unsafe_path' });
  const identity = requestIdentity(config(target)); let journal = await AttemptJournal.open(target, identity); await journal.close();
  const original = path.join(root, 'original.json'); await fs.rename(path.join(target, 'attempt.json'), original);
  try { await fs.symlink(original, path.join(target, 'attempt.json')); }
  catch (error) { if (error.code === 'EPERM') return; throw error; }
  await assert.rejects(AttemptJournal.open(target, identity), { code: 'unsafe_path' });
});
test('errors never promote boot verification from a transfer finish', () => {
  const error = new Error('native handle lost'); error.destructive_started = true; error.transfer_finished = true;
  const receipt = errorResult(error, 'update'); assert.equal(receipt.error.state, 'unknown'); assert.equal(receipt.error.boot_identity_verified, false); assert.equal(receipt.error.transfer_finished, true);
});
test('dead owner lock may be reclaimed only by explicit resume of identical unresolved attempt', async context => {
  const root = await temporary(context), identity = requestIdentity(config(root));
  let journal = await AttemptJournal.open(root, identity); await journal.transition('entering_write', { state: 'active' }); await journal.close();
  const lock = path.join(root, 'worker.lock'); await atomicJson(lock, { schema: 1, pid: 2147483647, jobId: 'job-1' });
  await assert.rejects(AttemptJournal.open(root, identity), { code: 'worker_busy' });
  journal = await AttemptJournal.open(root, identity, { resume: true }); assert.equal(journal.record.state, 'unknown'); await journal.close();
});
test('resume native-runtime failure remains unknown and does not clear recovery latch', { skip: !hasFixture }, async context => {
  const root = await temporary(context), identity = requestIdentity(config(root));
  const journal = await AttemptJournal.open(root, identity); await journal.transition('entering_write', { state: 'unknown' }); await journal.close();
  const result = await execute(config(root, { operation: 'resume' }), { backendFactory: async () => { throw new Error('not installed'); } });
  assert.equal(result.error.state, 'unknown'); assert.equal(result.error.recovery_required, true); assert.equal(result.error.destructive_started, false);
  assert.equal((await readJson(path.join(root, 'attempt.json'))).state, 'unknown');
});
test('concurrent explicit resumes cannot unlink a replacement worker lock', async context => {
  const root = await temporary(context), identity = requestIdentity(config(root));
  let journal = await AttemptJournal.open(root, identity); await journal.transition('entering_write', { state: 'active' }); await journal.close();
  const lock = path.join(root, 'worker.lock'); await atomicJson(lock, { schema: 1, pid: 2147483647, jobId: 'job-1' });
  const originalUnlink = fs.unlink.bind(fs);
  let entered, release, lockDeletes = 0;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const releasePromise = new Promise(resolve => { release = resolve; });
  context.mock.method(fs, 'unlink', async file => {
    if (file === lock && ++lockDeletes === 1) { entered(); await releasePromise; }
    return originalUnlink(file);
  });
  const first = AttemptJournal.open(root, identity, { resume: true });
  await enteredPromise;
  let second, winner;
  try {
    second = await AttemptJournal.open(root, identity, { resume: true }).then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
  } finally { release(); }
  try {
    winner = await first;
    assert.equal(second.status, 'rejected'); assert.equal(second.reason.code, 'worker_busy');
    assert.equal(lockDeletes, 1);
    const owner = await readJson(lock); assert.equal(owner.ownerId, winner.ownerId);
    assert.equal(winner.record.state, 'unknown');
  } finally {
    if (winner) await winner.close();
    if (second?.status === 'fulfilled') await second.value.close();
  }
});
test('a stale acquisition guard fails closed without automatic guard takeover', async context => {
  const root = await temporary(context), identity = requestIdentity(config(root));
  const journal = await AttemptJournal.open(root, identity); await journal.transition('entering_write', { state: 'unknown' }); await journal.close();
  const guard = path.join(root, 'worker-acquire.lock');
  await atomicJson(guard, { schema: 1, pid: 2147483647, ownerId: 'dead-owner' });
  await assert.rejects(AttemptJournal.open(root, identity, { resume: true }), { code: 'worker_busy' });
  assert.equal((await readJson(guard)).ownerId, 'dead-owner');
});
test('same-process/same-job close cannot remove a different lock owner nonce', async context => {
  const root = await temporary(context), identity = requestIdentity(config(root));
  const journal = await AttemptJournal.open(root, identity), lock = path.join(root, 'worker.lock');
  const owner = await readJson(lock), originalClose = journal.lock.close.bind(journal.lock);
  journal.lock.close = async () => { await originalClose(); await atomicJson(lock, { ...owner, ownerId: 'replacement-owner' }); };
  await assert.rejects(journal.close(), { code: 'corrupt_journal' });
  assert.equal((await readJson(lock)).ownerId, 'replacement-owner');
});
test('CLI recovery-required rejection reports unknown and preserves prior latch', { skip: !hasFixture }, async context => {
  const root = await temporary(context), identity = requestIdentity(config(root));
  const journal = await AttemptJournal.open(root, identity); await journal.transition('entering_write', { state: 'unknown' }); await journal.close();
  const prior = await fs.readFile(path.join(root, 'attempt.json'), 'utf8');
  let midiCalls = 0;
  const result = await execute(config(root, { jobId: 'different-job' }), { backendFactory: async () => { midiCalls++; } });
  assert.equal(result.error.code, 'recovery_required'); assert.equal(result.error.state, 'unknown');
  assert.equal(result.error.recovery_required, true); assert.equal(result.error.destructive_started, false); assert.equal(midiCalls, 0);
  assert.equal(await fs.readFile(path.join(root, 'attempt.json'), 'utf8'), prior);
});
