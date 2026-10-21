import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStockUpdateService, RAW_PACKAGE_BYTES, MAX_CHUNK_BYTES } from '../lib/stock-update-service.mjs';
import { STOCK, StockError } from '../../tools/jieli-wl82/stock-sysex/protocol.mjs';
import { AttemptJournal } from '../../tools/jieli-wl82/stock-sysex/journal.mjs';
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const metadata = { product: STOCK.product, sha256: STOCK.sha256, raw_bytes: STOCK.rawBytes, logical_bytes: STOCK.logicalBytes };
const bytes = Buffer.alloc(RAW_PACKAGE_BYTES, 42);
async function inspector(file) {
  const data = await fs.readFile(file);
  if (data.length !== RAW_PACKAGE_BYTES || !data.every(value => value === 42)) throw new StockError('invalid_package', 'Fake pinned package rejected.');
  return { metadata, image: new Uint8Array(STOCK.logicalBytes) };
}
async function success(_request, { journal, onEvent }) {
  await journal.transition('entering_write', { state: 'active' }); await journal.transition('writing'); onEvent({ progress: 1 });
  await journal.transition('waiting_reboot', { transfer_finished: true });
  await journal.transition('done', { state: 'succeeded', boot_identity_verified: true });
}
async function fixture(t, options = {}) {
  const directory = options.directory ?? await fs.mkdtemp(path.join(os.tmpdir(), 'forge-write-'));
  if (!options.directory) t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let generation = 0, loader = false, released = 0, started = 0;
  const calls = [];
  const deviceService = options.deviceService ?? {
    async reviewStockEndpoint({ loader: expected = false } = {}) {
      calls.push('review-endpoint'); if (loader !== expected) throw new StockError('resume_requires_loader', 'Explicit loader required.');
      const name = loader ? 'ota-FM-1' : 'FM-1 Midi';
      return { token: String(generation), input_name: name, output_name: name, identity: loader ? 'ota-FM-1_015' : 'FM-1_015', loader, expectedStockPair: { inputName: name, outputName: name } };
    },
    async acquireStockWriter(endpoint) {
      calls.push('acquire'); if (endpoint.token !== String(generation)) throw new StockError('device_changed', 'Reviewed generation changed.');
      started++; return { backend: {}, async release() { released++; } };
    },
  };
  const service = await createStockUpdateService({ directory, deviceService, packageInspector: inspector, runner: success, ...options });
  t.after(() => service.close());
  return { service, directory, calls, changeDevice: () => { generation++; }, setLoader: value => { loader = value; generation++; }, get released() { return released; }, get started() { return started; } };
}
async function upload(service, data = bytes) {
  const begun = await service.beginUpload({ raw_bytes: RAW_PACKAGE_BYTES }); assert.equal(begun.max_chunk_bytes, MAX_CHUNK_BYTES);
  for (let offset = 0; offset < data.length; offset += MAX_CHUNK_BYTES) await service.appendUpload({ upload_id: begun.upload_id, offset, data_base64: data.subarray(offset, offset + MAX_CHUNK_BYTES).toString('base64') });
  return begun.upload_id;
}
async function reviewed(f) { const upload_id = await upload(f.service); return (await f.service.review({ upload_id })).review; }
async function idle(service) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { const current = await service.status(); if (!current.writing) return current; await new Promise(resolve => setTimeout(resolve, 3)); }
  assert.fail('fake transfer did not settle');
}

test('construction and passive status do not touch devices or load native MIDI', async t => {
  const f = await fixture(t); assert.deepEqual(f.calls, []);
  assert.deepEqual(await f.service.status(), { supported: true, writing: false, attempt: null, review: null }); assert.deepEqual(f.calls, []);
});

test('bounded sequential uploads reject arbitrary sizes, extra paths, invalid base64 and replay', async t => {
  const f = await fixture(t);
  for (const args of [{ raw_bytes: 1 }, { raw_bytes: RAW_PACKAGE_BYTES, path: 'C:/secret' }]) await assert.rejects(f.service.beginUpload(args), { code: 'invalid_package' });
  let begun = await f.service.beginUpload({ raw_bytes: RAW_PACKAGE_BYTES });
  const abandoned = begun; begun = await f.service.beginUpload({ raw_bytes: RAW_PACKAGE_BYTES });
  assert.notEqual(begun.upload_id, abandoned.upload_id);
  await assert.rejects(f.service.appendUpload({ upload_id: abandoned.upload_id, offset: 0, data_base64: 'Kg==' }), { code: 'invalid_upload' });
  for (const args of [
    { upload_id: begun.upload_id, offset: 1, data_base64: 'Kg==' },
    { upload_id: begun.upload_id, offset: 0, data_base64: 'Kh==' },
    { upload_id: begun.upload_id, offset: 0, data_base64: '!!!' },
    { upload_id: begun.upload_id, offset: 0, data_base64: Buffer.alloc(MAX_CHUNK_BYTES + 1).toString('base64') },
  ]) await assert.rejects(f.service.appendUpload(args), { code: 'invalid_upload' });
  await f.service.appendUpload({ upload_id: begun.upload_id, offset: 0, data_base64: 'Kg==' });
  await assert.rejects(f.service.appendUpload({ upload_id: begun.upload_id, offset: 0, data_base64: 'Kg==' }), { code: 'invalid_upload' });
  await assert.rejects(f.service.review({ upload_id: begun.upload_id }), { code: 'invalid_upload' }); assert.deepEqual(f.calls, []);
});

test('default package inspector rejects unapproved bytes before any endpoint access', async t => {
  const f = await fixture(t, { packageInspector: undefined }), upload_id = await upload(f.service);
  await assert.rejects(f.service.review({ upload_id }), { code: 'invalid_package' }); assert.deepEqual(f.calls, []);
});

test('review includes exact package and endpoint evidence and expires without an implicit transfer', async t => {
  let now = 100000; const f = await fixture(t, { now: () => now }), review = await reviewed(f);
  assert.match(review.review_id, /^[a-f0-9]{32}$/); assert.match(review.job_id, /^[a-f0-9]{32}$/);
  assert.deepEqual({ ...review, review_id: 0, job_id: 0, expires_at: 0 }, { review_id: 0, job_id: 0, operation: 'install', ...metadata, input_name: 'FM-1 Midi', output_name: 'FM-1 Midi', identity: 'FM-1_015', expires_at: 0 });
  assert.equal(Date.parse(review.expires_at), now + 120000);
  await assert.rejects(f.service.start({ review_id: review.review_id, confirmed: false }), { code: 'review_required' });
  now += 120001; await assert.rejects(f.service.start({ review_id: review.review_id, confirmed: true }), { code: 'review_expired' }); assert.equal(f.started, 0);
});

test('confirmed stock transfer is asynchronous, consumes review, and success requires boot identity', async t => {
  const gate = deferred(); let during;
  const f = await fixture(t, { runner: async (request, ctx) => {
    await ctx.journal.transition('entering_write', { state: 'active' }); await ctx.journal.transition('writing'); ctx.onEvent({ progress: 1 });
    during = true; await gate.promise; await success(request, ctx);
  } });
  const review = await reviewed(f), started = await f.service.start({ review_id: review.review_id, confirmed: true });
  assert.equal(started.writing, true); assert.equal(started.review, null);
  while (!during) await new Promise(resolve => setImmediate(resolve));
  const calls = f.calls.length, status = await f.service.status(); assert.equal(status.writing, true); assert.equal(status.attempt.progress, 0.99); assert.equal(status.attempt.boot_identity_verified, false); assert.equal(f.calls.length, calls);
  await assert.rejects(f.service.start({ review_id: review.review_id, confirmed: true }), { code: 'update_busy' });
  gate.resolve(); const done = await idle(f.service);
  assert.equal(done.attempt.state, 'succeeded'); assert.equal(done.attempt.progress, 1); assert.equal(done.attempt.boot_identity_verified, true); assert.equal(done.attempt.readback_verified, false); assert.equal(f.released, 1);
  await assert.rejects(f.service.start({ review_id: review.review_id, confirmed: true }), { code: 'review_required' });
});

test('a changed generation invalidates a review before runner execution', async t => {
  const f = await fixture(t), review = await reviewed(f); f.changeDevice();
  await assert.rejects(f.service.start({ review_id: review.review_id, confirmed: true }), { code: 'device_changed' }); assert.equal(f.started, 0);
  assert.equal((await f.service.status()).writing, false);
});

test('existing approved snapshot never lets a subsequent invalid upload bypass inspection', async t => {
  const f = await fixture(t); await reviewed(f);
  const upload_id = await upload(f.service, Buffer.alloc(RAW_PACKAGE_BYTES, 1));
  await assert.rejects(f.service.review({ upload_id }), { code: 'invalid_package' });
  assert.equal(f.calls.filter(call => call === 'review-endpoint').length, 1);
});

test('destructive failure persists unknown and permits only explicit identical-job loader resume', async t => {
  const f = await fixture(t, { runner: async (_request, { journal }) => { await journal.transition('entering_write', { state: 'active' }); throw new StockError('disconnected', 'Fake loss.'); } });
  const review = await reviewed(f); await f.service.start({ review_id: review.review_id, confirmed: true });
  const unknown = await idle(f.service); assert.equal(unknown.attempt.state, 'unknown'); assert.equal(unknown.attempt.recovery_required, true); assert.equal(unknown.attempt.error_code, 'disconnected');
  await assert.rejects(f.service.beginUpload({ raw_bytes: RAW_PACKAGE_BYTES }), { code: 'recovery_required' });
  await assert.rejects(f.service.reviewResume({ job_id: '0'.repeat(32) }), { code: 'resume_rejected' });
  await assert.rejects(f.service.reviewResume({ job_id: review.job_id }), { code: 'resume_requires_loader' });
  await f.service.close();
  const recovered = await fixture(t, { directory: f.directory }); recovered.setLoader(true);
  assert.equal((await recovered.service.status()).attempt.job_id, review.job_id);
  const resume = (await recovered.service.reviewResume({ job_id: review.job_id })).review;
  assert.equal(resume.operation, 'resume'); assert.equal(resume.identity, 'ota-FM-1_015'); assert.equal(resume.job_id, review.job_id);
  await recovered.service.start({ review_id: resume.review_id, confirmed: true }); assert.equal((await idle(recovered.service)).attempt.state, 'succeeded');
});

test('close interrupts a running attempt, closes session promptly, and preserves unknown after restart', async t => {
  const gate = deferred(); let running = false;
  const f = await fixture(t, { runner: async (_request, { journal }) => { await journal.transition('entering_write', { state: 'active' }); running = true; await gate.promise; await journal.transition('done', { state: 'succeeded', transfer_finished: true, boot_identity_verified: true }); } });
  const review = await reviewed(f); await f.service.start({ review_id: review.review_id, confirmed: true });
  while (!running) await new Promise(resolve => setImmediate(resolve));
  await f.service.close(); assert.equal(f.released, 1);
  const persisted = JSON.parse(await fs.readFile(path.join(f.directory, 'stock-update/attempt/attempt.json'), 'utf8'));
  assert.equal(persisted.state, 'unknown'); assert.equal(persisted.boot_identity_verified, false);
  const recovered = await fixture(t, { directory: f.directory }); assert.equal((await recovered.service.status()).attempt.state, 'unknown');
  gate.resolve(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory, 'stock-update/attempt/attempt.json'), 'utf8')).state, 'unknown');
});

test('durable pre-destructive transition failure prevents a fake destructive action and records failure', async t => {
  let destructive = false;
  const f = await fixture(t, { journalFactory: async (...args) => {
    const journal = await AttemptJournal.open(...args), transition = journal.transition.bind(journal);
    journal.transition = async (phase, extra) => { if (phase === 'entering_write') throw new StockError('journal_write_failed', 'Fake disk failure.'); return transition(phase, extra); }; return journal;
  }, runner: async (_request, { journal }) => { await journal.transition('entering_write', { state: 'active' }); destructive = true; } });
  const review = await reviewed(f); await f.service.start({ review_id: review.review_id, confirmed: true });
  const failed = await idle(f.service); assert.equal(destructive, false); assert.equal(failed.attempt.state, 'failed'); assert.equal(failed.attempt.error_code, 'journal_write_failed');
});
import { runUpdate } from '../../tools/jieli-wl82/stock-sysex/updater.mjs';
import { mockUpdater } from '../../tools/jieli-wl82/stock-sysex/test/helpers.mjs';

test('the production stock engine completes all protocol phases against a fake MIDI device', async t => {
  const mock = mockUpdater({ initialIdentity: 'FM-1_015' });
  const pair = mock.config.expectedStockPair;
  const deviceService = { async reviewStockEndpoint() { return { token: 'fresh', input_name: pair.inputName, output_name: pair.outputName, identity: 'FM-1_015', loader: false, expectedStockPair: pair }; }, async acquireStockWriter() { return { backend: mock.backend, async release() {} }; } };
  const f = await fixture(t, { deviceService, runner: (request, context) => runUpdate(request, { ...context, clock: mock.clock }) });
  const review = await reviewed(f); await f.service.start({ review_id: review.review_id, confirmed: true });
  const done = await idle(f.service);
  assert.equal(done.attempt.phase, 'done'); assert.equal(done.attempt.state, 'succeeded'); assert.equal(done.attempt.transfer_finished, true); assert.equal(done.attempt.boot_identity_verified, true); assert.equal(done.attempt.progress, 1);
  assert.equal(mock.opens, 3); assert.equal(mock.closed, 3);
  const persisted = JSON.parse(await fs.readFile(path.join(f.directory, 'stock-update/attempt/attempt.json'), 'utf8'));
  assert.equal(persisted.initial_identity, 'FM-1_015'); assert.equal(persisted.loader_identity, 'ota-FM-1_009'); assert.equal(persisted.final_identity, 'FM-1_015');
});

test('the same durable attempt root blocks a competing service while its original write is active', async t => {
  const gate = deferred(); let running = false;
  const first = await fixture(t, { runner: async (_request, { journal }) => { await journal.transition('entering_write', { state: 'active' }); running = true; await gate.promise; throw new StockError('disconnected', 'Fake loss.'); } });
  const firstReview = await reviewed(first);
  const second = await fixture(t, { directory: first.directory }), secondReview = await reviewed(second);
  await first.service.start({ review_id: firstReview.review_id, confirmed: true });
  while (!running) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(second.service.start({ review_id: secondReview.review_id, confirmed: true }), { code: 'worker_busy' }); assert.equal(second.started, 0);
  gate.resolve(); assert.equal((await idle(first.service)).attempt.state, 'unknown');
  await assert.rejects(second.service.beginUpload({ raw_bytes: RAW_PACKAGE_BYTES }), { code: 'recovery_required' });
});

test('a crashed active journal is reported unknown and only its identical job can reclaim a dead worker lock', async t => {
  const original = await fixture(t), review = await reviewed(original); await original.service.close();
  const saved = JSON.parse(await fs.readFile(path.join(original.directory, 'stock-update/requests', review.job_id + '.json'), 'utf8'));
  const root = path.join(original.directory, 'stock-update/attempt'), journal = await AttemptJournal.open(root, saved);
  await journal.transition('entering_write', { state: 'active' }); await journal.close();
  await fs.writeFile(path.join(root, 'worker.lock'), JSON.stringify({ schema: 1, pid: 2147483647, jobId: review.job_id, ownerId: 'crashed-process' }));
  const recovered = await fixture(t, { directory: original.directory }); recovered.setLoader(true);
  const initial = await recovered.service.status(); assert.equal(initial.attempt.state, 'unknown'); assert.equal(recovered.started, 0);
  await assert.rejects(recovered.service.beginUpload({ raw_bytes: RAW_PACKAGE_BYTES }), { code: 'recovery_required' });
  const resume = (await recovered.service.reviewResume({ job_id: review.job_id })).review;
  await recovered.service.start({ review_id: resume.review_id, confirmed: true }); assert.equal((await idle(recovered.service)).attempt.state, 'succeeded');
});
