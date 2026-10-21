import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { STOCK, StockError } from '../../tools/jieli-wl82/stock-sysex/protocol.mjs';
import { absolutePath, checkPath, inspectPackage, atomicJson, readJson } from '../../tools/jieli-wl82/stock-sysex/files.mjs';
import { AttemptJournal, requestIdentity } from '../../tools/jieli-wl82/stock-sysex/journal.mjs';
import { assertOtherFamilyResolved } from '../../tools/jieli-wl82/stock-sysex/custom-journal.mjs';
import { runUpdate } from '../../tools/jieli-wl82/stock-sysex/updater.mjs';

export const RAW_PACKAGE_BYTES = STOCK.rawBytes;
export const MAX_CHUNK_BYTES = 65536;
const REVIEW_MS = 120000, ID = /^[a-f0-9]{32}$/;
const clone = value => value === null ? null : JSON.parse(JSON.stringify(value));
const fail = (code, message) => new StockError(code, message);
const id = () => randomBytes(16).toString('hex');
const exact = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const metadataValid = value => value?.product === STOCK.product && value.sha256 === STOCK.sha256 && value.raw_bytes === STOCK.rawBytes && value.logical_bytes === STOCK.logicalBytes;
const codeOf = caught => /^[a-z][a-z0-9_]{0,63}$/.test(caught?.code ?? '') ? caught.code : 'stock_update_failed';
const blocked = record => record && ['active', 'unknown'].includes(record.state);
function publicAttempt(record, { recovered = false, progress = 0 } = {}) {
  if (!record) return null;
  const succeeded = record.state === 'succeeded' && record.transfer_finished === true && record.boot_identity_verified === true;
  const state = recovered && record.state === 'active' ? 'unknown' : record.state;
  return { job_id: record.jobId, state, phase: record.phase, progress: succeeded ? 1 : Math.min(0.99, Math.max(0, progress)),
    transfer_finished: record.transfer_finished === true, boot_identity_verified: succeeded, readback_verified: false,
    recovery_required: state === 'unknown' || state === 'active', ...(record.error_code ? { error_code: record.error_code } : {}) };
}

/** Pinned official stock V15 only. No user path, arbitrary MIDI or custom installer is exposed. */
export async function createStockUpdateService({ directory, deviceService, packageInspector = inspectPackage, runner = runUpdate,
  journalFactory = (root, identity, options) => AttemptJournal.open(root, identity, options), now = Date.now } = {}) {
  if (!deviceService?.reviewStockEndpoint || !deviceService?.acquireStockWriter) throw fail('invalid_service', 'A reviewed native stock connection service is required.');
  const root = path.join(absolutePath(directory), 'stock-update'), packageRoot = path.join(root, 'packages'), requestsRoot = path.join(root, 'requests'), journalRoot = path.join(root, 'attempt');
  for (const folder of [root, packageRoot, requestsRoot, journalRoot]) {
    await checkPath(folder, true); await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    if (!(await checkPath(folder)).isDirectory()) throw fail('unsafe_path', 'Stock update storage is invalid.');
  }
  const snapshotPath = path.join(packageRoot, STOCK.sha256 + '.bin');
  const journalPath = path.join(journalRoot, 'attempt.json');
  let queue = Promise.resolve(), closed = false, upload = null, currentReview = null, writing = false, active = null;
  let stored = await readJson(journalPath, true), attempt = null;
  // requestIdentity checks the durable request digest without changing unresolved evidence.
  const validateRecord = record => {
    if (!record) return null;
    const request = record.request;
    if (!request || record.schema !== 1 || !ID.test(record.jobId ?? '') || !['prepared', 'active', 'unknown', 'succeeded', 'failed'].includes(record.state) ||
        !['prepared', 'entering_check', 'checking', 'waiting_loader', 'entering_write', 'writing', 'waiting_reboot', 'done', 'failed'].includes(record.phase) ||
        request.jobId !== record.jobId || request.sha256 !== STOCK.sha256 || request.product !== STOCK.product ||
        requestIdentity({ jobId: request.jobId, endpointReviewId: request.endpointReviewId, reviewedSha256: request.sha256, expectedStockPair: request.expectedStockPair }).digest !== record.requestDigest ||
        typeof record.transfer_finished !== 'boolean' || typeof record.boot_identity_verified !== 'boolean' ||
        (record.boot_identity_verified && (record.state !== 'succeeded' || !record.transfer_finished || record.phase !== 'done')) ||
        (record.state === 'succeeded' && (!record.boot_identity_verified || !record.transfer_finished || record.phase !== 'done'))) throw fail('corrupt_journal', 'Preserve the invalid stock attempt journal before recovery.');
    return record;
  };
  stored = validateRecord(stored); attempt = publicAttempt(stored, { recovered: true });
  const ensureOpen = () => { if (closed) throw fail('service_closed', 'The stock update service is closed.'); };
  const serial = action => { const result = queue.then(() => { ensureOpen(); return action(); }); queue = result.catch(() => {}); return result; };
  const requireIdle = () => { if (writing) throw fail('update_busy', 'A stock firmware transfer is already running.'); };
  const loadRecord = async () => { stored = validateRecord(await readJson(journalPath, true)); return stored; };
  const requireResolved = async () => { await assertOtherFamilyResolved(directory, 'stock'); if (blocked(await loadRecord())) throw fail('recovery_required', 'The original unresolved stock attempt requires explicit loader recovery.'); };
  const checkImage = approved => {
    if (!metadataValid(approved?.metadata) || !(approved.image instanceof Uint8Array) || approved.image.length !== STOCK.logicalBytes) throw fail('invalid_package', 'Only the pinned, unmodified official V15 package is supported.');
    return approved;
  };
  const approvedSnapshot = async () => checkImage(await packageInspector(snapshotPath));
  const saveSnapshot = async bytes => {
    const temporary = path.join(packageRoot, '.' + randomUUID() + '.upload');
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      const approved = checkImage(await packageInspector(temporary));
      await checkPath(snapshotPath, true);
      // Link is create-if-absent; concurrent instances cannot replace approved bytes.
      try { await fs.link(temporary, snapshotPath); } catch (caught) { if (caught.code !== 'EEXIST') throw caught; }
      await checkPath(snapshotPath); await approvedSnapshot(); return approved;
    } finally { if (handle) await handle.close(); try { await fs.unlink(temporary); } catch (caught) { if (caught.code !== 'ENOENT') throw caught; } }
  };
  const reviewFields = (request, endpoint, operation) => ({ review_id: id(), job_id: request.jobId, operation, product: STOCK.product, sha256: STOCK.sha256,
    raw_bytes: STOCK.rawBytes, logical_bytes: STOCK.logicalBytes, input_name: endpoint.input_name, output_name: endpoint.output_name,
    identity: endpoint.identity, expires_at: new Date(now() + REVIEW_MS).toISOString() });
  const beginUpload = input => serial(async () => {
    requireIdle(); await requireResolved();
    if (!exact(input, ['raw_bytes']) || input.raw_bytes !== STOCK.rawBytes) throw fail('invalid_package', 'Choose the exact 699956-byte official V15 package.');
    // A new explicit file selection safely replaces an abandoned partial upload.
    if (upload) upload.bytes.fill(0);
    currentReview = null; upload = { id: id(), bytes: Buffer.alloc(STOCK.rawBytes), received: 0 };
    return { upload_id: upload.id, max_chunk_bytes: MAX_CHUNK_BYTES };
  });
  const appendUpload = input => serial(async () => {
    requireIdle();
    if (!exact(input, ['upload_id', 'offset', 'data_base64']) || !upload || input.upload_id !== upload.id || !Number.isSafeInteger(input.offset) || input.offset !== upload.received ||
        typeof input.data_base64 !== 'string' || input.data_base64.length === 0 || input.data_base64.length > Math.ceil(MAX_CHUNK_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data_base64)) throw fail('invalid_upload', 'Stock package chunks must be canonical, bounded and sequential.');
    const bytes = Buffer.from(input.data_base64, 'base64');
    if (!bytes.length || bytes.length > MAX_CHUNK_BYTES || bytes.toString('base64') !== input.data_base64 || upload.received + bytes.length > upload.bytes.length) throw fail('invalid_upload', 'Stock package chunk exceeds its approved bounds.');
    bytes.copy(upload.bytes, upload.received); upload.received += bytes.length;
    return { upload_id: upload.id, received_bytes: upload.received };
  });
  const review = input => serial(async () => {
    requireIdle(); await requireResolved();
    if (!exact(input, ['upload_id']) || !upload || input.upload_id !== upload.id || upload.received !== STOCK.rawBytes) throw fail('invalid_upload', 'Finish uploading the complete stock package before review.');
    const completed = upload; upload = null; currentReview = null;
    try {
      await saveSnapshot(completed.bytes);
      const endpoint = await deviceService.reviewStockEndpoint();
      const request = { jobId: id(), reviewedSha256: STOCK.sha256, endpointReviewId: id(), expectedStockPair: endpoint.expectedStockPair, operation: 'install' };
      const identity = requestIdentity(request);
      await atomicJson(path.join(requestsRoot, request.jobId + '.json'), { schema: 1, ...identity });
      const fields = reviewFields(request, endpoint, 'install'); currentReview = { fields, request, endpoint };
      return { review: clone(fields) };
    } finally { completed.bytes.fill(0); }
  });
  const reviewResume = input => serial(async () => {
    requireIdle(); await assertOtherFamilyResolved(directory, 'stock');
    if (!exact(input, ['job_id']) || !ID.test(input.job_id ?? '')) throw fail('resume_rejected', 'Choose the original unresolved stock job.');
    const record = await loadRecord();
    if (!blocked(record) || record.jobId !== input.job_id) throw fail('resume_rejected', 'Only the identical unresolved stock attempt can resume.');
    const saved = await readJson(path.join(requestsRoot, input.job_id + '.json'));
    if (saved?.schema !== 1 || saved.digest !== record.requestDigest || JSON.stringify(saved.request) !== JSON.stringify(record.request)) throw fail('resume_rejected', 'The original reviewed stock request is unavailable.');
    await approvedSnapshot();
    const endpoint = await deviceService.reviewStockEndpoint({ loader: true });
    const request = { jobId: saved.request.jobId, reviewedSha256: saved.request.sha256, endpointReviewId: saved.request.endpointReviewId, expectedStockPair: saved.request.expectedStockPair, operation: 'resume' };
    const fields = reviewFields(request, endpoint, 'resume'); currentReview = { fields, request, endpoint }; upload = null;
    return { review: clone(fields) };
  });
  const start = input => serial(async () => {
    requireIdle(); await assertOtherFamilyResolved(directory, 'stock');
    if (!exact(input, ['review_id', 'confirmed']) || input.confirmed !== true || !currentReview || input.review_id !== currentReview.fields.review_id) throw fail('review_required', 'Explicitly confirm the current stock package and endpoint review.');
    if (now() >= Date.parse(currentReview.fields.expires_at)) { currentReview = null; throw fail('review_expired', 'Review the stock package and connection again.'); }
    const approved = currentReview; currentReview = null;
    const image = Uint8Array.from((await approvedSnapshot()).image);
    const journal = await journalFactory(journalRoot, requestIdentity(approved.request), { resume: approved.request.operation === 'resume' });
    let session;
    try { session = await deviceService.acquireStockWriter(approved.endpoint); await assertOtherFamilyResolved(directory, 'stock'); }
    catch (caught) { try { await session?.release(); } finally { await journal.close(); } throw caught; }
    writing = true;
    attempt = publicAttempt(journal.record); let stopped = false, journalQueue = Promise.resolve(), journalClosePromise = null;
    const closeJournal = () => journalClosePromise ??= journal.close();
    const journalAction = action => { const result = journalQueue.then(action); journalQueue = result.catch(() => {}); return result; };
    const journalView = { transition: async (phase, extra) => {
      await journalAction(async () => {
        if (stopped) throw fail('service_closed', 'The stock writer was interrupted.');
        await journal.transition(phase, extra); attempt = publicAttempt(journal.record, { progress: attempt?.progress ?? 0 });
      });
    } };
    const transaction = { journal, session, async stop() {
      if (stopped) return; stopped = true;
      // Conservatively preserve interruption as unknown before releasing handles.
      try {
        await journalAction(async () => { await journal.transition(journal.record.phase, { state: 'unknown', boot_identity_verified: false, error_code: 'service_closed' }); });
        attempt = publicAttempt(journal.record);
      } finally { await session.release(); await closeJournal(); writing = false; }
    } };
    active = transaction;
    // Transfer outlives the short MCP request; status never drives or retries it.
    void Promise.resolve().then(async () => {
      try {
        await runner({ ...approved.request, expectedInitialIdentity: approved.endpoint.identity }, { image, backend: session.backend, journal: journalView, onEvent: event => {
          if (!stopped && Number.isFinite(event.progress)) attempt.progress = Math.min(0.99, Math.max(attempt.progress, event.progress));
        } });
        if (!stopped) attempt = publicAttempt(journal.record);
      } catch (caught) {
        if (!stopped) {
          const uncertain = journal.record.state === 'active' || journal.record.state === 'unknown' || caught.recovery_required === true || approved.request.operation === 'resume';
          try { await journalAction(() => journal.transition(journal.record.phase, { state: uncertain ? 'unknown' : 'failed', boot_identity_verified: false, error_code: codeOf(caught) })); }
          catch { attempt = { ...attempt, state: 'unknown', recovery_required: true, boot_identity_verified: false, progress: Math.min(0.99, attempt.progress), error_code: 'journal_write_failed' }; }
          if (journal.record.error_code === codeOf(caught)) attempt = publicAttempt(journal.record, { progress: attempt.progress });
        }
      } finally {
        image.fill(0);
        if (!stopped) {
          try { await session.release(); await closeJournal(); }
          catch {
            try { await journalAction(() => journal.transition(journal.record.phase, { state: 'unknown', boot_identity_verified: false, error_code: 'close_failed' })); } catch { /* Existing active evidence remains unresolved. */ }
            attempt = { ...attempt, state: 'unknown', recovery_required: true, boot_identity_verified: false, progress: Math.min(0.99, attempt.progress), error_code: 'close_failed' };
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
  return Object.freeze({ beginUpload, appendUpload, review, reviewResume, start, status, close });
}
