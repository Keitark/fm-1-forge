import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CustomAttemptJournal, customRequestIdentity, validateCustomJournal, assertOtherFamilyResolved } from '../custom-journal.mjs';
import { AttemptJournal, requestIdentity } from '../journal.mjs';
import { STOCK } from '../protocol.mjs';
const config = overrides => ({ kind: 'custom-fwsc', jobId: 'job-custom-1', product: 'FM1_FORGE_001', sha256: 'a'.repeat(64), logicalSha256: 'b'.repeat(64),
  targetBuildSha256: 'c'.repeat(64), manifestSha256: 'd'.repeat(64), rawBytes: 623156, logicalBytes: 623136, endpointReviewId: 'review-custom-1',
  expectedStockPair: { inputName: 'FM-1 Midi', outputName: 'FM-1 Midi' }, ...overrides });
async function fixture(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-custom-journal-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory; }

test('tracker profile is bound to the original request and cannot pass with a diagnostic identity', async t => {
  const directory = await fixture(t), base = customRequestIdentity(config()), tracker = customRequestIdentity(config({ profile: 'protracker' }));
  assert.notEqual(base.digest, tracker.digest); assert.equal(tracker.request.profile, 'protracker');
  assert.throws(() => customRequestIdentity(config({ profile: 'anything' })));
  const journal = await CustomAttemptJournal.open(directory, tracker);
  await journal.transition('waiting_reboot', { state: 'active', transfer_finished: true });
  await assert.rejects(journal.transition('done', { state: 'succeeded', boot_identity_verified: true, boot_build_verified: true, final_identity: 'FM1_FORGE_001', final_build_sha256: tracker.request.targetBuildSha256 }), { code: 'corrupt_journal' });
  await journal.transition('done', { state: 'succeeded', boot_identity_verified: true, boot_build_verified: true, final_identity: 'MOD-EDITOR/1', final_build_sha256: tracker.request.targetBuildSha256 });
  const changed = structuredClone(journal.record); delete changed.request.profile; assert.throws(() => validateCustomJournal(changed), { code: 'corrupt_journal' });
  await journal.close();
});

test('custom journal binds every package, manifest, target and endpoint field without stock whitelist changes', () => {
  const base = customRequestIdentity(config());
  for (const [key, value] of Object.entries({ sha256: '1'.repeat(64), logicalSha256: '2'.repeat(64), targetBuildSha256: '3'.repeat(64), manifestSha256: '4'.repeat(64), rawBytes: 623220, logicalBytes: 623200, endpointReviewId: 'review-other', jobId: 'job-other' })) {
    const overrides = key === 'rawBytes' || key === 'logicalBytes' ? { rawBytes: 623220, logicalBytes: 623200 } : { [key]: value };
    assert.notEqual(customRequestIdentity(config(overrides)).digest, base.digest);
  }
  for (const bad of [{ kind: 'stock' }, { product: 'FM-1_015' }, { sha256: '../bad' }, { rawBytes: 2097153 }, { expectedStockPair: { inputName: 'other', outputName: 'other' } }]) assert.throws(() => customRequestIdentity(config(bad)));
  assert.throws(() => requestIdentity({ ...config(), reviewedSha256: 'a'.repeat(64) }), { code: 'unreviewed_request' });
});

test('fsynced custom transitions survive reopen and unresolved attempts cannot be replaced', async t => {
  const directory = await fixture(t), identity = customRequestIdentity(config());
  const journal = await CustomAttemptJournal.open(directory, identity);
  assert.equal(journal.record.state, 'prepared'); await journal.transition('entering_check', { state: 'active' }); await journal.close();
  const persisted = validateCustomJournal(JSON.parse(await fs.readFile(path.join(directory, 'attempt.json'), 'utf8')));
  assert.equal(persisted.request.targetBuildSha256, 'c'.repeat(64)); assert.equal(persisted.state, 'active');
  await assert.rejects(CustomAttemptJournal.open(directory, customRequestIdentity(config({ jobId: 'other' }))), { code: 'recovery_required' });
  const resumed = await CustomAttemptJournal.open(directory, identity, { resume: true }); assert.equal(resumed.record.state, 'unknown'); await resumed.close();
});

test('resume requires the identical custom package, target, manifest, endpoints and original job', async t => {
  const directory = await fixture(t), identity = customRequestIdentity(config()), journal = await CustomAttemptJournal.open(directory, identity);
  await journal.transition('entering_write', { state: 'unknown' }); await journal.close();
  for (const overrides of [{ sha256: 'e'.repeat(64) }, { targetBuildSha256: 'f'.repeat(64) }, { manifestSha256: '0'.repeat(64) }, { jobId: 'job-other' }, { expectedStockPair: { inputName: 'FM-1', outputName: 'FM-1' } }]) {
    await assert.rejects(CustomAttemptJournal.open(directory, customRequestIdentity(config(overrides)), { resume: true }), { code: 'resume_rejected' });
  }
  const resumed = await CustomAttemptJournal.open(directory, identity, { resume: true }); await resumed.close();
});

test('live custom workers and unresolved acquisition guards are never automatically stolen', async t => {
  const directory = await fixture(t), identity = customRequestIdentity(config()), journal = await CustomAttemptJournal.open(directory, identity);
  await journal.transition('entering_write', { state: 'active' });
  await assert.rejects(CustomAttemptJournal.open(directory, identity, { resume: true }), { code: 'worker_busy' }); await journal.close();
  await fs.writeFile(path.join(directory, 'worker-acquire.lock'), '{}');
  await assert.rejects(CustomAttemptJournal.open(directory, identity, { resume: true }), { code: 'worker_busy' });
});

test('custom journal rejects false verified success and archives successful receipts against replay', async t => {
  const directory = await fixture(t), identity = customRequestIdentity(config()), journal = await CustomAttemptJournal.open(directory, identity);
  await assert.rejects(journal.transition('done', { state: 'succeeded', boot_identity_verified: true }), { code: 'corrupt_journal' });
  await journal.transition('waiting_reboot', { state: 'active', transfer_finished: true }); await journal.transition('done', { state: 'succeeded', boot_identity_verified: true, boot_build_verified: true, final_identity: 'FM1_FORGE_001', final_build_sha256: 'c'.repeat(64) }); await journal.close();
  await assert.rejects(CustomAttemptJournal.open(directory, identity), { code: 'duplicate_attempt' });
  const next = await CustomAttemptJournal.open(directory, customRequestIdentity(config({ jobId: 'job-next' }))); await next.close();
  await assert.rejects(CustomAttemptJournal.open(directory, identity), { code: 'duplicate_attempt' });
  const receipt = validateCustomJournal(JSON.parse(await fs.readFile(path.join(directory, 'receipts/job-custom-1.json'), 'utf8'))); assert.equal(receipt.state, 'succeeded');
});

test('either active or unknown family blocks new writes in the other family; corrupt journals fail closed', async t => {
  const directory = await fixture(t), customRoot = path.join(directory, 'custom-update/attempt'), stockRoot = path.join(directory, 'stock-update/attempt');
  await assertOtherFamilyResolved(directory, 'custom-fwsc'); await assertOtherFamilyResolved(directory, 'stock');
  const custom = await CustomAttemptJournal.open(customRoot, customRequestIdentity(config())); await custom.transition('entering_write', { state: 'unknown' }); await custom.close();
  await assert.rejects(assertOtherFamilyResolved(directory, 'stock'), { code: 'recovery_required' });
  const stock = await AttemptJournal.open(stockRoot, requestIdentity({ jobId: 'stock-job', endpointReviewId: 'stock-review', reviewedSha256: STOCK.sha256, expectedStockPair: { inputName: 'FM-1 Midi', outputName: 'FM-1 Midi' } }));
  await stock.transition('entering_write', { state: 'active' }); await stock.close();
  await assert.rejects(assertOtherFamilyResolved(directory, 'custom-fwsc'), { code: 'recovery_required' });
  const file = path.join(stockRoot, 'attempt.json'), prior = JSON.parse(await fs.readFile(file, 'utf8')); prior.request.sha256 = '0'.repeat(64); await fs.writeFile(file, JSON.stringify(prior));
  await assert.rejects(assertOtherFamilyResolved(directory, 'custom-fwsc'), { code: 'corrupt_journal' });
});

test('a dead custom owner is reclaimable only by explicit resume with the exact digest', async t => {
  const directory = await fixture(t), identity = customRequestIdentity(config()), journal = await CustomAttemptJournal.open(directory, identity);
  await journal.transition('entering_write', { state: 'active' }); await journal.close();
  await fs.writeFile(path.join(directory, 'worker.lock'), JSON.stringify({ schema: 1, pid: 2147483647, jobId: identity.request.jobId, ownerId: 'dead' }));
  await assert.rejects(CustomAttemptJournal.open(directory, customRequestIdentity(config({ jobId: 'other' }))), { code: 'worker_busy' });
  const resumed = await CustomAttemptJournal.open(directory, identity, { resume: true }); assert.equal(resumed.record.state, 'unknown'); await resumed.close();
});

test('missing other-family receipt with surviving worker evidence fails closed', async t => {
  const directory = await fixture(t), root = path.join(directory, 'stock-update/attempt'); await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'worker.lock'), JSON.stringify({ pid: process.pid, jobId: 'stock-job' }));
  await assert.rejects(assertOtherFamilyResolved(directory, 'custom-fwsc'), { code: 'corrupt_journal' });
});
