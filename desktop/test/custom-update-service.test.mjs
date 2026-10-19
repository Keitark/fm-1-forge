import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createCustomUpdateService, MAX_RAW_PACKAGE_BYTES, MAX_CHUNK_BYTES } from '../lib/custom-update-service.mjs';
import { createStockUpdateService } from '../lib/stock-update-service.mjs';
import { CustomAttemptJournal, customRequestIdentity } from '../../tools/jieli-wl82/stock-sysex/custom-journal.mjs';
import { AttemptJournal, requestIdentity } from '../../tools/jieli-wl82/stock-sysex/journal.mjs';
import { STOCK, StockError } from '../../tools/jieli-wl82/stock-sysex/protocol.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const bytes = Buffer.alloc(623156, 42), image = new Uint8Array(623136), target = 'c'.repeat(64);
const manifest = { schemaVersion: 1, policy_version: 'customfwsc-v1', package_sha256: sha(bytes), logical_sha256: sha(image), raw_bytes: bytes.length, logical_bytes: image.length,
  target_build_sha256: target, expected_boot_identity: 'FM1_FORGE_001', family: 8, profile: 'forge-diag', source_stock_sha256: STOCK.sha256,
  ota_sha256: 'ef1f2db89b011fa53e71df363f0122de0ea896618c53fb53e8da676322004541', application_sha256: '1'.repeat(64), application_bytes: 32,
  preservation: 'public-v15-fixed-layout-app-only', hardware_qualified: false, stock_tail_proof: { block_bytes: 32, mutable_blocks: 1, boundary_prefix_hex: '', prefix_hashes: ['1'.repeat(64)] } };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
async function inspector(raw, input) {
  if (!(raw instanceof Uint8Array) || raw.length !== bytes.length || sha(raw) !== input.package_sha256 || !raw.every(value => value === 42)) throw new StockError('invalid_custom_package', 'Fake custom package rejected.');
  return { metadata: { product: 'FM1_FORGE_001', sha256: input.package_sha256, raw_bytes: raw.length, logical_bytes: image.length, logical_sha256: input.logical_sha256,
    target_build_sha256: input.target_build_sha256, expected_boot_identity: 'FM1_FORGE_001', family: 8 }, image: Uint8Array.from(image) };
}
async function success(config, { journal, onEvent }) {
  assert.equal(config.reviewedSha256, manifest.package_sha256); assert.equal(config.targetBuildSha256, target); assert.equal(config.logicalBytes, image.length);
  await journal.transition('entering_write', { state: 'active' }); await journal.transition('writing'); onEvent({ progress: 1 });
  await journal.transition('waiting_reboot', { transfer_finished: true });
  await journal.transition('done', { state: 'succeeded', boot_identity_verified: true, boot_build_verified: true, final_identity: 'FM1_FORGE_001', final_build_sha256: target });
}
async function fixture(t, options = {}) {
  const directory = options.directory ?? await fs.mkdtemp(path.join(os.tmpdir(), 'forge-custom-service-'));
  if (!options.directory) t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let generation = 0, mode = 'FM-1_015', calls = [], acquired = 0, released = 0;
  const deviceService = options.deviceService ?? {
    async reviewStockEndpoint({ loader = false } = {}) {
      calls.push('review'); const actualLoader = mode.startsWith('ota-');
      if (loader !== actualLoader) throw new StockError('resume_requires_loader', 'Fresh explicit stock mode required.');
      const name = actualLoader ? 'ota-FM-1' : 'FM-1 Midi';
      return { token: String(generation), input_name: name, output_name: name, identity: mode, loader: actualLoader, expectedStockPair: { inputName: name, outputName: name } };
    },
    async acquireStockWriter(endpoint) { calls.push('acquire'); if (endpoint.token !== String(generation)) throw new StockError('device_changed', 'Connection changed.'); acquired++; return { backend: {}, async release() { released++; } }; },
  };
  const service = await createCustomUpdateService({ directory, deviceService, packageInspector: inspector, runner: success, ...options });
  t.after(() => service.close());
  return { service, deviceService, directory, calls, setMode: value => { mode = value; generation++; }, changeDevice: () => { generation++; }, get acquired() { return acquired; }, get released() { return released; } };
}
async function upload(service, data = bytes, inputManifest = manifest) {
  const begun = await service.beginUpload({ raw_bytes: data.length, manifest: inputManifest });
  for (let offset = 0; offset < data.length; offset += MAX_CHUNK_BYTES) await service.appendUpload({ upload_id: begun.upload_id, offset, data_base64: data.subarray(offset, offset + MAX_CHUNK_BYTES).toString('base64') });
  return begun.upload_id;
}
async function reviewed(f) { return (await f.service.review({ upload_id: await upload(f.service) })).review; }
async function idle(service) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { const result = await service.status(); if (!result.writing) return result; await new Promise(resolve => setTimeout(resolve, 3)); }
  assert.fail('fake custom writer did not settle');
}
async function stockActive(directory, { state = 'unknown' } = {}) {
  const journal = await AttemptJournal.open(path.join(directory, 'stock-update/attempt'), requestIdentity({ jobId: 'stock-peer', endpointReviewId: 'stock-review', reviewedSha256: STOCK.sha256, expectedStockPair: { inputName: 'FM-1 Midi', outputName: 'FM-1 Midi' } }));
  await journal.transition('entering_write', { state }); await journal.close();
}

test('custom construction and passive status never connect, enumerate or send MIDI', async t => {
  const f = await fixture(t); assert.deepEqual(await f.service.status(), { supported: true, writing: false, attempt: null, review: null }); assert.deepEqual(f.calls, []);
  assert.equal(MAX_RAW_PACKAGE_BYTES, 2097152); assert.equal(MAX_CHUNK_BYTES, 65536);
});

test('strict manifest and raw bounds reject unsupported input before allocation or endpoint access', async t => {
  const f = await fixture(t);
  for (const input of [{ raw_bytes: 2097153, manifest }, { raw_bytes: 1, manifest }, { raw_bytes: bytes.length, manifest, path: 'C:/anything' }, { raw_bytes: bytes.length, manifest: { ...manifest, arbitrary: true } }, { raw_bytes: bytes.length - 1, manifest }]) await assert.rejects(f.service.beginUpload(input));
  assert.deepEqual(f.calls, []);
});

test('bounded chunks are canonical and sequential; abandoned uploads can safely be replaced', async t => {
  const f = await fixture(t), old = await f.service.beginUpload({ raw_bytes: bytes.length, manifest }), begun = await f.service.beginUpload({ raw_bytes: bytes.length, manifest });
  assert.notEqual(old.upload_id, begun.upload_id);
  for (const input of [{ upload_id: old.upload_id, offset: 0, data_base64: 'Kg==' }, { upload_id: begun.upload_id, offset: 1, data_base64: 'Kg==' }, { upload_id: begun.upload_id, offset: 0, data_base64: 'Kh==' }, { upload_id: begun.upload_id, offset: 0, data_base64: Buffer.alloc(65537).toString('base64') }]) await assert.rejects(f.service.appendUpload(input), { code: 'invalid_upload' });
  await f.service.appendUpload({ upload_id: begun.upload_id, offset: 0, data_base64: 'Kg==' });
  await assert.rejects(f.service.appendUpload({ upload_id: begun.upload_id, offset: 0, data_base64: 'Kg==' }), { code: 'invalid_upload' });
  await assert.rejects(f.service.review({ upload_id: begun.upload_id }), { code: 'invalid_upload' }); assert.deepEqual(f.calls, []);
});

test('production package inspector rejects fake bytes without opening endpoints', async t => {
  const f = await fixture(t, { packageInspector: undefined }); await assert.rejects(f.service.review({ upload_id: await upload(f.service) }), { code: 'invalid_custom_package' }); assert.deepEqual(f.calls, []);
});

test('review binds raw, logical, target and manifest hashes to exact V15 endpoints and expires once', async t => {
  let now = 100000; const f = await fixture(t, { now: () => now }), review = await reviewed(f);
  assert.equal(review.kind, 'custom-fwsc'); assert.equal(review.sha256, manifest.package_sha256); assert.equal(review.logical_sha256, manifest.logical_sha256); assert.equal(review.target_build_sha256, target);
  assert.equal(review.expected_boot_identity, 'FM1_FORGE_001'); assert.equal(review.identity, 'FM-1_015'); assert.match(review.manifest_sha256, /^[a-f0-9]{64}$/);
  assert.equal(Date.parse(review.expires_at), now + 120000);
  await assert.rejects(f.service.start({ review_id: review.review_id, confirmed: false }), { code: 'review_required' });
  now += 120001; await assert.rejects(f.service.start({ review_id: review.review_id, confirmed: true }), { code: 'review_expired' }); assert.equal(f.acquired, 0);
});

test('custom transfer status remains passive and terminal success requires independent exact build proof', async t => {
  const gate = deferred(); let running = false;
  const f = await fixture(t, { runner: async (config, ctx) => { assert.equal(config.expectedInitialIdentity, 'FM-1_015'); await ctx.journal.transition('entering_write', { state: 'active' }); ctx.onEvent({ progress: 1 }); running = true; await gate.promise; await success(config, ctx); } });
  const review = await reviewed(f); assert.equal((await f.service.start({ review_id: review.review_id, confirmed: true })).writing, true);
  while (!running) await new Promise(resolve => setImmediate(resolve));
  const count = f.calls.length, pending = await f.service.status(); assert.equal(pending.attempt.progress, 0.99); assert.equal(pending.attempt.boot_build_verified, false); assert.equal(pending.attempt.observed_build_sha256, null); assert.equal(f.calls.length, count);
  await assert.rejects(f.service.start({ review_id: review.review_id, confirmed: true }), { code: 'update_busy' });
  gate.resolve(); const done = await idle(f.service); assert.equal(done.attempt.state, 'succeeded'); assert.equal(done.attempt.progress, 1); assert.equal(done.attempt.boot_build_verified, true); assert.equal(done.attempt.observed_boot_identity, 'FM1_FORGE_001'); assert.equal(done.attempt.observed_build_sha256, target); assert.equal(done.attempt.readback_verified, false); assert.equal(f.released, 1);
  await assert.rejects(f.service.start({ review_id: review.review_id, confirmed: true }), { code: 'review_required' });
});

test('wrong or absent build proof cannot become a successful receipt', async t => {
  const f = await fixture(t, { runner: async (_config, { journal }) => { await journal.transition('entering_write', { state: 'active' }); await journal.transition('done', { state: 'succeeded', transfer_finished: true, boot_identity_verified: true, boot_build_verified: true, final_identity: 'FM1_FORGE_001', final_build_sha256: 'f'.repeat(64) }); } });
  const review = await reviewed(f); await f.service.start({ review_id: review.review_id, confirmed: true }); const failed = await idle(f.service);
  assert.equal(failed.attempt.state, 'unknown'); assert.equal(failed.attempt.boot_build_verified, false); assert.equal(failed.attempt.recovery_required, true); assert.ok(failed.attempt.progress < 1);
});

test('changed connections and changed durable bytes invalidate approved starts', async t => {
  const f = await fixture(t), review = await reviewed(f); f.changeDevice(); await assert.rejects(f.service.start({ review_id: review.review_id, confirmed: true }), { code: 'device_changed' }); assert.equal(f.acquired, 0);
  const second = await reviewed(f); await fs.writeFile(path.join(f.directory, 'custom-update/packages', second.sha256 + '.fwsc'), Buffer.alloc(bytes.length));
  await assert.rejects(f.service.start({ review_id: second.review_id, confirmed: true }), { code: 'invalid_custom_package' }); assert.equal(f.acquired, 0);
});

test('unknown custom jobs block stock updates and resume only the same stored build in pinned OTA015', async t => {
  const f = await fixture(t, { runner: async (_config, { journal }) => { await journal.transition('entering_write', { state: 'active' }); throw new StockError('disconnected', 'Fake cable loss.'); } });
  const review = await reviewed(f); await f.service.start({ review_id: review.review_id, confirmed: true }); assert.equal((await idle(f.service)).attempt.state, 'unknown');
  const stock = await createStockUpdateService({ directory: f.directory, deviceService: f.deviceService }); t.after(() => stock.close());
  await assert.rejects(stock.beginUpload({ raw_bytes: STOCK.rawBytes }), { code: 'recovery_required' });
  await f.service.close(); const recovered = await fixture(t, { directory: f.directory }); recovered.setMode('ota-FM-1_009');
  await assert.rejects(recovered.service.reviewResume({ job_id: review.job_id }), { code: 'wrong_model' });
  recovered.setMode('ota-FM-1_015'); await assert.rejects(recovered.service.reviewResume({ job_id: '0'.repeat(32) }), { code: 'resume_rejected' });
  const resume = (await recovered.service.reviewResume({ job_id: review.job_id })).review; assert.equal(resume.job_id, review.job_id); assert.equal(resume.sha256, review.sha256); assert.equal(resume.manifest_sha256, review.manifest_sha256); assert.equal(resume.target_build_sha256, target); assert.equal(resume.operation, 'resume');
  await recovered.service.start({ review_id: resume.review_id, confirmed: true }); assert.equal((await idle(recovered.service)).attempt.state, 'succeeded');
});

test('active stock job and corrupt other-family journal block the custom route', async t => {
  const f = await fixture(t); await stockActive(f.directory, { state: 'active' }); await assert.rejects(f.service.beginUpload({ raw_bytes: bytes.length, manifest }), { code: 'recovery_required' });
  await fs.writeFile(path.join(f.directory, 'stock-update/attempt/attempt.json'), '{}'); await assert.rejects(f.service.beginUpload({ raw_bytes: bytes.length, manifest }), { code: 'corrupt_journal' }); assert.deepEqual(f.calls, []);
});

test('a cross-family unresolved attempt appearing during handoff is checked before runner starts', async t => {
  let invoked = false, released = false;
  const f = await fixture(t, { runner: async () => { invoked = true; } }); const review = await reviewed(f);
  f.deviceService.acquireStockWriter = async () => { await stockActive(f.directory); return { backend: {}, async release() { released = true; } }; };
  await assert.rejects(f.service.start({ review_id: review.review_id, confirmed: true }), { code: 'recovery_required' }); assert.equal(invoked, false); assert.equal(released, true);
});

test('shutdown preserves unknown rather than accepting late success and restart reads the original target', async t => {
  const gate = deferred(); let running = false;
  const f = await fixture(t, { runner: async (_config, { journal }) => { await journal.transition('entering_write', { state: 'active' }); running = true; await gate.promise; await journal.transition('done', { state: 'succeeded', transfer_finished: true, boot_identity_verified: true, boot_build_verified: true, final_identity: 'FM1_FORGE_001', final_build_sha256: target }); } });
  const review = await reviewed(f); await f.service.start({ review_id: review.review_id, confirmed: true }); while (!running) await new Promise(resolve => setImmediate(resolve));
  await f.service.close(); assert.equal(f.released, 1); const recovered = await fixture(t, { directory: f.directory });
  const current = await recovered.service.status(); assert.equal(current.attempt.state, 'unknown'); assert.equal(current.attempt.job_id, review.job_id); assert.equal(current.attempt.target_build_sha256, target); assert.equal(current.attempt.boot_build_verified, false);
  gate.resolve(); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal((await recovered.service.status()).attempt.state, 'unknown');
});

test('corrupt original manifest cannot be swapped during explicit resume', async t => {
  const f = await fixture(t, { runner: async (_config, { journal }) => { await journal.transition('entering_write', { state: 'active' }); throw new StockError('disconnected', 'Fake loss.'); } });
  const review = await reviewed(f); await f.service.start({ review_id: review.review_id, confirmed: true }); await idle(f.service); f.setMode('ota-FM-1_015');
  await fs.writeFile(path.join(f.directory, 'custom-update/packages', review.manifest_sha256 + '.json'), JSON.stringify({ ...manifest, target_build_sha256: 'd'.repeat(64) }));
  await assert.rejects(f.service.reviewResume({ job_id: review.job_id }), { code: 'invalid_package' });
});

import { runCustomUpdate } from '../../tools/jieli-wl82/stock-sysex/custom-updater.mjs';
import { mockUpdater, equalBytes } from '../../tools/jieli-wl82/stock-sysex/test/helpers.mjs';
import { capabilityQuery, encodeFrame } from '../../site/lib/browser-common/protocol.mjs';

test('the production custom OTA engine establishes exact build proof through the durable native service', async t => {
  const mock = mockUpdater({ initialIdentity: 'FM-1_015', loaderIdentity: 'ota-FM-1_015', bootIdentity: 'FM1_FORGE_001' });
  const originalOpen = mock.backend.open.bind(mock.backend);
  mock.backend.open = async pair => {
    const link = await originalOpen(pair), pending = [], originalSend = link.send.bind(link), originalRead = link.read.bind(link);
    link.send = async packet => {
      const sent = await originalSend(packet);
      if (equalBytes(packet, capabilityQuery())) {
        const payload = new Uint8Array(47); payload.set([70, 77, 67, 49, 1, 8, 0, 0, 0, 2, 0, 0, 16, 0]); payload.set(Buffer.from(target, 'hex'), 14); payload[46] = 3;
        pending.push(encodeFrame(0x31, payload));
      }
      return sent;
    };
    link.read = ms => pending.length ? Promise.resolve(pending.shift()) : originalRead(ms); return link;
  };
  const pair = mock.config.expectedStockPair;
  const deviceService = { async reviewStockEndpoint() { return { token: 'reviewed', input_name: pair.inputName, output_name: pair.outputName, identity: 'FM-1_015', loader: false, expectedStockPair: pair }; },
    async acquireStockWriter() { return { backend: mock.backend, async release() {} }; } };
  const f = await fixture(t, { deviceService, runner: (request, context) => runCustomUpdate(request, { ...context, clock: mock.clock }) });
  const review = await reviewed(f); await f.service.start({ review_id: review.review_id, confirmed: true }); const done = await idle(f.service);
  assert.equal(done.attempt.state, 'succeeded'); assert.equal(done.attempt.boot_build_verified, true); assert.equal(done.attempt.observed_build_sha256, target); assert.equal(done.attempt.observed_boot_identity, 'FM1_FORGE_001'); assert.equal(done.attempt.progress, 1);
  assert.equal(mock.opens, 3); assert.equal(mock.closed, 3);
  const persisted = JSON.parse(await fs.readFile(path.join(f.directory, 'custom-update/attempt/attempt.json'), 'utf8'));
  assert.equal(persisted.request.sha256, manifest.package_sha256); assert.equal(persisted.request.logicalSha256, manifest.logical_sha256); assert.equal(persisted.final_build_sha256, target); assert.equal(persisted.boot_build_verified, true);
});
