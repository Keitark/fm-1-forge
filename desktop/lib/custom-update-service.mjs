import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { StockError } from '../../tools/jieli-wl82/stock-sysex/protocol.mjs';
import { absolutePath, checkPath, atomicJson, readJson } from '../../tools/jieli-wl82/stock-sysex/files.mjs';
import { CustomAttemptJournal, customRequestIdentity, validateCustomJournal, assertOtherFamilyResolved } from '../../tools/jieli-wl82/stock-sysex/custom-journal.mjs';
import { inspectCustomFwsc, validateCustomManifest, MAX_CUSTOM_FWSC_BYTES, customProfilePolicy } from '../../tools/jieli-wl82/stock-sysex/custom-package.mjs';
import { runCustomUpdate } from '../../tools/jieli-wl82/stock-sysex/custom-updater.mjs';

export const MAX_RAW_PACKAGE_BYTES = MAX_CUSTOM_FWSC_BYTES;
export const MAX_CHUNK_BYTES = 65536;
const REVIEW_MS = 120000, ID = /^[a-f0-9]{32}$/;
const clone = value => value === null ? null : JSON.parse(JSON.stringify(value));
const fail = (code, message) => new StockError(code, message);
const id = () => randomBytes(16).toString('hex');
const exact = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const manifestDigest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const metadataValid = (value, manifest) => value?.product === 'FM1_FORGE_001' && value.sha256 === manifest.package_sha256 &&
  value.raw_bytes === manifest.raw_bytes && value.logical_bytes === manifest.logical_bytes && value.logical_sha256 === manifest.logical_sha256 &&
  value.target_build_sha256 === manifest.target_build_sha256 && value.expected_boot_identity === manifest.expected_boot_identity && value.family === manifest.family &&
  (manifest.profile !== 'protracker' || (value.profile === 'protracker' && value.verification_transport === 'cdc'));

const codeOf = caught => /^[a-z][a-z0-9_]{0,63}$/.test(caught?.code ?? '') ? caught.code : 'custom_update_failed';
const blocked = record => record && ['active', 'unknown'].includes(record.state);
function publicAttempt(record, { recovered = false, progress = 0 } = {}) {
  if (!record) return null;
  const profile = customProfilePolicy(record.request.profile ?? 'forge-diag');
  const succeeded = record.state === 'succeeded' && record.transfer_finished === true && record.boot_identity_verified === true && record.boot_build_verified === true && record.final_identity === profile.expected_boot_identity && record.final_build_sha256 === record.request.targetBuildSha256;
  const state = recovered && record.state === 'active' ? 'unknown' : record.state;
  return { kind: 'custom-fwsc', expected_boot_identity: profile.expected_boot_identity, ...(profile.profile === 'protracker' ? { profile: profile.profile, verification_transport: 'cdc' } : {}), target_build_sha256: record.request.targetBuildSha256, job_id: record.jobId, state, phase: record.phase, progress: succeeded ? 1 : Math.min(0.99, Math.max(0, progress)),
    transfer_finished: record.transfer_finished === true, boot_identity_verified: succeeded, boot_build_verified: succeeded,
    observed_boot_identity: record.final_identity ?? null, observed_build_sha256: record.final_build_sha256 ?? null, readback_verified: false,
    recovery_required: state === 'unknown' || state === 'active', ...(record.error_code ? { error_code: record.error_code } : {}) };
}

/** Reviewed preserved-layout Forge FWSC through the stock MIDI OTA loader. */
export async function createCustomUpdateService({ directory, deviceService, packageInspector = inspectCustomFwsc, runner = runCustomUpdate, trackerVerifier = null,
  journalFactory = (root, identity, options) => CustomAttemptJournal.open(root, identity, options), now = Date.now } = {}) {
  if (!deviceService?.reviewStockEndpoint || !deviceService?.acquireStockWriter) throw fail('invalid_service', 'A reviewed native stock connection service is required.');
  const root = path.join(absolutePath(directory), 'custom-update'), packageRoot = path.join(root, 'packages'), requestsRoot = path.join(root, 'requests'), journalRoot = path.join(root, 'attempt');
  for (const folder of [root, packageRoot, requestsRoot, journalRoot]) {
    await checkPath(folder, true); await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    if (!(await checkPath(folder)).isDirectory()) throw fail('unsafe_path', 'Custom update storage is invalid.');
  }
  const journalPath = path.join(journalRoot, 'attempt.json');
  let queue = Promise.resolve(), closed = false, upload = null, currentReview = null, writing = false, active = null;
  let stored = await readJson(journalPath, true), attempt = null;
  const validateRecord = record => record ? validateCustomJournal(record) : null;
  stored = validateRecord(stored); attempt = publicAttempt(stored, { recovered: true });
  const ensureOpen = () => { if (closed) throw fail('service_closed', 'The custom update service is closed.'); };
  const serial = action => { const result = queue.then(() => { ensureOpen(); return action(); }); queue = result.catch(() => {}); return result; };
  const requireIdle = () => { if (writing) throw fail('update_busy', 'A custom firmware transfer is already running.'); };
  const loadRecord = async () => { stored = validateRecord(await readJson(journalPath, true)); return stored; };
  const requireResolved = async () => { await assertOtherFamilyResolved(directory, 'custom-fwsc'); if (blocked(await loadRecord())) throw fail('recovery_required', 'The original unresolved custom FWSC attempt requires explicit loader recovery.'); };
  const checkImage = (approved, manifest) => {
    if (!metadataValid(approved?.metadata, manifest) || !(approved.image instanceof Uint8Array) || approved.image.length !== manifest.logical_bytes) throw fail('invalid_package', 'The custom FWSC bytes and manifest do not identify the same reviewed Forge build.');
    return approved;
  };
  const checkedRaw = async (file, size) => {
    const stat = await checkPath(file);
    if (!stat.isFile() || stat.size !== size || size > MAX_CUSTOM_FWSC_BYTES) throw fail('invalid_package', 'The saved custom package has changed.');
    const handle = await fs.open(file, 'r');
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== size) throw fail('invalid_package', 'The saved custom package has changed.');
      const raw = await handle.readFile(), after = await handle.stat();
      if (raw.length !== size || after.size !== size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw fail('invalid_package', 'The saved custom package changed while reading.');
      return raw;
    } finally { await handle.close(); }
  };
  const approvedSnapshot = async request => {
    const manifest = validateCustomManifest(await readJson(path.join(packageRoot, request.manifestSha256 + '.json')));
    if (manifestDigest(manifest) !== request.manifestSha256 || manifest.package_sha256 !== request.sha256 || manifest.logical_sha256 !== request.logicalSha256 ||
        manifest.target_build_sha256 !== request.targetBuildSha256 || manifest.profile !== (request.profile ?? 'forge-diag') || manifest.raw_bytes !== request.rawBytes || manifest.logical_bytes !== request.logicalBytes) throw fail('invalid_package', 'The saved custom manifest no longer matches the original reviewed job.');
    const raw = await checkedRaw(path.join(packageRoot, request.sha256 + '.fwsc'), request.rawBytes);
    return { ...checkImage(await packageInspector(raw, manifest), manifest), manifest };
  };
  const saveSnapshot = async (bytes, manifest) => {
    const approved = checkImage(await packageInspector(Uint8Array.from(bytes), manifest), manifest);
    const snapshotPath = path.join(packageRoot, manifest.package_sha256 + '.fwsc'), manifestPath = path.join(packageRoot, manifestDigest(manifest) + '.json');
    const temporary = path.join(packageRoot, '.' + randomUUID() + '.upload'); let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      await checkPath(snapshotPath, true);
      try { await fs.link(temporary, snapshotPath); } catch (caught) { if (caught.code !== 'EEXIST') throw caught; }
      await checkPath(manifestPath, true);
      const prior = await readJson(manifestPath, true);
      if (prior && manifestDigest(validateCustomManifest(prior)) !== manifestDigest(manifest)) throw fail('invalid_package', 'The saved custom manifest is inconsistent.');
      if (!prior) await atomicJson(manifestPath, manifest);
      checkImage(await packageInspector(await checkedRaw(snapshotPath, manifest.raw_bytes), manifest), manifest);
      return approved;
    } finally { if (handle) await handle.close(); try { await fs.unlink(temporary); } catch (caught) { if (caught.code !== 'ENOENT') throw caught; } }
  };
  const reviewFields = (request, endpoint, operation) => ({ kind: 'custom-fwsc', review_id: id(), job_id: request.jobId, operation, product: request.product, sha256: request.sha256,
    raw_bytes: request.rawBytes, logical_bytes: request.logicalBytes, logical_sha256: request.logicalSha256, target_build_sha256: request.targetBuildSha256,
    manifest_sha256: request.manifestSha256, expected_boot_identity: customProfilePolicy(request.profile ?? 'forge-diag').expected_boot_identity,
    ...(request.profile === 'protracker' ? { profile: 'protracker', verification_transport: 'cdc' } : {}), input_name: endpoint.input_name, output_name: endpoint.output_name,
    identity: endpoint.identity, expires_at: new Date(now() + REVIEW_MS).toISOString() });
  const beginUpload = input => serial(async () => {
    requireIdle(); await requireResolved();
    if (!exact(input, ['raw_bytes', 'manifest']) || !Number.isSafeInteger(input.raw_bytes) || input.raw_bytes < 21 || input.raw_bytes > MAX_CUSTOM_FWSC_BYTES) throw fail('invalid_package', 'Choose a bounded custom FWSC package with its build manifest.');
    const manifest = validateCustomManifest(input.manifest);
    if (manifest.profile === 'protracker' && typeof trackerVerifier !== 'function') throw fail('cdc_unavailable', 'Tracker installation requires the Windows CDC verification component.');
    if (manifest.raw_bytes !== input.raw_bytes) throw fail('invalid_package', 'The package length does not match its manifest.');
    // A new explicit file selection safely replaces an abandoned partial upload.
    if (upload) upload.bytes.fill(0);
    currentReview = null; upload = { id: id(), bytes: Buffer.alloc(input.raw_bytes), manifest: clone(manifest), received: 0 };
    return { upload_id: upload.id, max_chunk_bytes: MAX_CHUNK_BYTES };
  });
  const appendUpload = input => serial(async () => {
    requireIdle();
    if (!exact(input, ['upload_id', 'offset', 'data_base64']) || !upload || input.upload_id !== upload.id || !Number.isSafeInteger(input.offset) || input.offset !== upload.received ||
        typeof input.data_base64 !== 'string' || input.data_base64.length === 0 || input.data_base64.length > Math.ceil(MAX_CHUNK_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data_base64)) throw fail('invalid_upload', 'Custom FWSC package chunks must be canonical, bounded and sequential.');
    const bytes = Buffer.from(input.data_base64, 'base64');
    if (!bytes.length || bytes.length > MAX_CHUNK_BYTES || bytes.toString('base64') !== input.data_base64 || upload.received + bytes.length > upload.bytes.length) throw fail('invalid_upload', 'Custom FWSC package chunk exceeds its approved bounds.');
    bytes.copy(upload.bytes, upload.received); upload.received += bytes.length;
    return { upload_id: upload.id, received_bytes: upload.received };
  });
  const review = input => serial(async () => {
    requireIdle(); await requireResolved();
    if (!exact(input, ['upload_id']) || !upload || input.upload_id !== upload.id || upload.received !== upload.bytes.length) throw fail('invalid_upload', 'Finish uploading the complete custom FWSC package before review.');
    const completed = upload; upload = null; currentReview = null;
    try {
      await saveSnapshot(completed.bytes, completed.manifest);
      const endpoint = await deviceService.reviewStockEndpoint();
      if (endpoint.identity !== 'FM-1_015' || endpoint.loader !== false) throw fail('wrong_model', 'Custom FWSC installation requires freshly identified stock FM-1 V15.');
      const manifest = completed.manifest;
      const request = { kind: 'custom-fwsc', product: 'FM1_FORGE_001', jobId: id(), sha256: manifest.package_sha256, logicalSha256: manifest.logical_sha256,
        targetBuildSha256: manifest.target_build_sha256, manifestSha256: manifestDigest(manifest), rawBytes: manifest.raw_bytes, logicalBytes: manifest.logical_bytes,
        endpointReviewId: id(), expectedStockPair: endpoint.expectedStockPair, operation: 'install', ...(manifest.profile === 'protracker' ? { profile: 'protracker' } : {}) };
      const identity = customRequestIdentity(request);
      await atomicJson(path.join(requestsRoot, request.jobId + '.json'), { schema: 1, ...identity });
      const fields = reviewFields(request, endpoint, 'install'); currentReview = { fields, request, endpoint };
      return { review: clone(fields) };
    } finally { completed.bytes.fill(0); }
  });
  const reviewResume = input => serial(async () => {
    requireIdle(); await assertOtherFamilyResolved(directory, 'custom-fwsc');
    if (!exact(input, ['job_id']) || !ID.test(input.job_id ?? '')) throw fail('resume_rejected', 'Choose the original unresolved custom FWSC job.');
    const record = await loadRecord();
    if (!blocked(record) || record.jobId !== input.job_id) throw fail('resume_rejected', 'Only the identical unresolved custom FWSC attempt can resume.');
    if (record.request.profile === 'protracker' && record.transfer_finished) throw fail('verification_required', 'The tracker transfer finished. Verify its CDC boot without sending firmware again.');
    const saved = await readJson(path.join(requestsRoot, input.job_id + '.json'));
    if (saved?.schema !== 1 || saved.digest !== record.requestDigest || JSON.stringify(saved.request) !== JSON.stringify(record.request)) throw fail('resume_rejected', 'The original reviewed custom FWSC request is unavailable.');
    await approvedSnapshot(record.request);
    const endpoint = await deviceService.reviewStockEndpoint({ loader: true });
    if (endpoint.identity !== 'ota-FM-1_015' || endpoint.loader !== true) throw fail('wrong_model', 'Custom FWSC recovery requires the pinned stock V15 OTA loader.');
    const request = { ...saved.request, operation: 'resume' };
    const fields = reviewFields(request, endpoint, 'resume'); currentReview = { fields, request, endpoint }; upload = null;
    return { review: clone(fields) };
  });
  const start = input => serial(async () => {
    requireIdle(); await assertOtherFamilyResolved(directory, 'custom-fwsc');
    if (!exact(input, ['review_id', 'confirmed']) || input.confirmed !== true || !currentReview || input.review_id !== currentReview.fields.review_id) throw fail('review_required', 'Explicitly confirm the current custom FWSC package and endpoint review.');
    if (now() >= Date.parse(currentReview.fields.expires_at)) { currentReview = null; throw fail('review_expired', 'Review the custom FWSC package and connection again.'); }
    const approved = currentReview; currentReview = null;
    const controller = new AbortController();
    const image = Uint8Array.from((await approvedSnapshot(approved.request)).image);
    const journal = await journalFactory(journalRoot, customRequestIdentity(approved.request), { resume: approved.request.operation === 'resume' });
    let session;
    try { session = await deviceService.acquireStockWriter(approved.endpoint); await assertOtherFamilyResolved(directory, 'custom-fwsc'); }
    catch (caught) { try { await session?.release(); } finally { await journal.close(); } throw caught; }
    writing = true;
    attempt = publicAttempt(journal.record); let stopped = false, journalQueue = Promise.resolve(), journalClosePromise = null;
    const closeJournal = () => journalClosePromise ??= journal.close();
    const journalAction = action => { const result = journalQueue.then(action); journalQueue = result.catch(() => {}); return result; };
    const journalView = { transition: async (phase, extra) => {
      await journalAction(async () => {
        if (stopped) throw fail('service_closed', 'The custom writer was interrupted.');
        await journal.transition(phase, extra); attempt = publicAttempt(journal.record, { progress: attempt?.progress ?? 0 });
      });
    } };
    const transaction = { journal, session, async stop() {
      if (stopped) return; stopped = true; controller.abort();
      // Conservatively preserve interruption as unknown before releasing handles.
      try {
        await journalAction(async () => { await journal.transition(journal.record.phase, { state: 'unknown', boot_identity_verified: false, boot_build_verified: false, error_code: 'service_closed' }); });
        attempt = publicAttempt(journal.record);
      } finally { await session.release(); await closeJournal(); writing = false; }
    } };
    active = transaction;
    // Transfer outlives the short MCP request; status never drives or retries it.
    void Promise.resolve().then(async () => {
      try {
        await runner({ ...approved.request, reviewedSha256: approved.request.sha256, expectedInitialIdentity: approved.endpoint.identity }, { image, backend: session.backend, journal: journalView, verifyTracker: trackerVerifier, signal: controller.signal, onEvent: event => {
          if (!stopped && Number.isFinite(event.progress)) attempt.progress = Math.min(0.99, Math.max(attempt.progress, event.progress));
        } });
        if (!stopped) attempt = publicAttempt(journal.record);
      } catch (caught) {
        if (!stopped) {
          const uncertain = journal.record.state === 'active' || journal.record.state === 'unknown' || caught.recovery_required === true || approved.request.operation === 'resume';
          try { await journalAction(() => journal.transition(journal.record.phase, { state: uncertain ? 'unknown' : 'failed', boot_identity_verified: false, boot_build_verified: false, error_code: codeOf(caught) })); }
          catch { attempt = { ...attempt, state: 'unknown', recovery_required: true, boot_identity_verified: false, boot_build_verified: false, progress: Math.min(0.99, attempt.progress), error_code: 'journal_write_failed' }; }
          if (journal.record.error_code === codeOf(caught)) attempt = publicAttempt(journal.record, { progress: attempt.progress });
        }
      } finally {
        image.fill(0);
        if (!stopped) {
          try { await session.release(); await closeJournal(); }
          catch {
            try { await journalAction(() => journal.transition(journal.record.phase, { state: 'unknown', boot_identity_verified: false, boot_build_verified: false, error_code: 'close_failed' })); } catch { /* Existing active evidence remains unresolved. */ }
            attempt = { ...attempt, state: 'unknown', recovery_required: true, boot_identity_verified: false, boot_build_verified: false, progress: Math.min(0.99, attempt.progress), error_code: 'close_failed' };
          }
        }
        if (active === transaction) { active = null; writing = false; }
      }
    });
    return { writing: true, attempt: clone(attempt), review: null };
  });
  // An explicit observation of a completed original transfer is never a rewrite.
  const verifyBoot = input => serial(async () => {
    requireIdle(); await assertOtherFamilyResolved(directory, 'custom-fwsc');
    if (!exact(input, ['job_id']) || !ID.test(input.job_id ?? '') || typeof trackerVerifier !== 'function') throw fail('verification_required', 'Choose the original completed tracker transfer for CDC verification.');
    const record = await loadRecord();
    if (!blocked(record) || record.jobId !== input.job_id || record.request.profile !== 'protracker' || !record.transfer_finished) throw fail('verification_required', 'Only a completed unresolved tracker transfer can be verified without rewriting.');
    await approvedSnapshot(record.request);
    const journal = await journalFactory(journalRoot, customRequestIdentity(record.request), { resume: true });
    const controller = new AbortController(); let stopped = false, journalQueue = Promise.resolve(), closing = null;
    const closeJournal = () => closing ??= journal.close();
    const change = (phase, extra) => {
      const result = journalQueue.then(async () => { if (stopped) throw fail('service_closed', 'Verification stopped.'); await journal.transition(phase, extra); });
      journalQueue = result.catch(() => {}); return result;
    };
    writing = true; currentReview = null; attempt = publicAttempt(journal.record);
    const transaction = { async stop() {
      if (stopped) return; stopped = true; controller.abort();
      try {
        await journalQueue;
        await journal.transition('waiting_reboot', { state: 'unknown', boot_identity_verified: false, boot_build_verified: false, error_code: 'service_closed' });
        attempt = publicAttempt(journal.record);
      } finally { await closeJournal(); writing = false; }
    } };
    active = transaction;
    void Promise.resolve().then(async () => {
      try {
        const proof = await trackerVerifier({ buildSha256: record.request.targetBuildSha256, timeoutMs: 40000, signal: controller.signal });
        if (stopped) return;
        if (proof?.text !== 'MOD-EDITOR/1' || proof.buildSha256 !== record.request.targetBuildSha256 || proof.transport !== 'cdc' || proof.nonceVerified !== true) throw fail('boot_build_mismatch', 'The tracker boot proof differs from the original reviewed build.');
        await change('done', { state: 'succeeded', boot_identity_verified: true, boot_build_verified: true, final_identity: proof.text, final_build_sha256: proof.buildSha256, error_code: null });
        attempt = publicAttempt(journal.record);
      } catch (error) {
        if (!stopped) {
          try { await change('waiting_reboot', { state: 'unknown', boot_identity_verified: false, boot_build_verified: false, error_code: codeOf(error) }); attempt = publicAttempt(journal.record); }
          catch { attempt = { ...attempt, state: 'unknown', recovery_required: true, progress: 0, boot_identity_verified: false, boot_build_verified: false, error_code: 'journal_write_failed' }; }
        }
      } finally {
        if (!stopped) {
          try { await closeJournal(); } catch {
            try { await journal.transition('waiting_reboot', { state: 'unknown', boot_identity_verified: false, boot_build_verified: false, error_code: 'close_failed' }); } catch { /* Preserve original ownership evidence. */ }
            attempt = { ...attempt, state: 'unknown', recovery_required: true, progress: 0, boot_identity_verified: false, boot_build_verified: false, error_code: 'close_failed' };
          }
        }
        if (active === transaction) { active = null; writing = false; }
      }
    });
    return { writing: true, attempt: clone(attempt), review: null };
  });
  const status = () => serial(async () => {
    if (!writing) { const record = await loadRecord(); if (record) attempt = publicAttempt(record, { recovered: true, progress: attempt?.job_id === record.jobId ? attempt.progress : 0 }); }
    if (currentReview && now() >= Date.parse(currentReview.fields.expires_at)) currentReview = null;
    return { supported: true, writing, attempt: clone(attempt), review: clone(currentReview?.fields ?? null) };
  });
  const close = async () => {
    if (closed) return; closed = true;
    await queue;
    if (upload) upload.bytes.fill(0); upload = null; currentReview = null;
    if (active) await active.stop();
  };
  return Object.freeze({ beginUpload, appendUpload, review, reviewResume, start, verifyBoot, status, close });
}
