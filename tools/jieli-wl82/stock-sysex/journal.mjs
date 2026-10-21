import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { StockError, STOCK } from './protocol.mjs';
import { absolutePath, checkPath, atomicJson, readJson } from './files.mjs';

const jobPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const blocked = new Set(['active', 'unknown']);
const phases = new Set(['prepared', 'entering_check', 'checking', 'waiting_loader', 'entering_write', 'writing', 'waiting_reboot', 'done', 'failed']);
export function requestIdentity(config) {
  if (!jobPattern.test(config.jobId ?? '') || config.reviewedSha256 !== STOCK.sha256 || typeof config.endpointReviewId !== 'string' || !jobPattern.test(config.endpointReviewId)) {
    throw new StockError('unreviewed_request', 'A reviewed stock package, endpoint review ID and job ID are required.');
  }
  const request = { jobId: config.jobId, sha256: config.reviewedSha256, product: STOCK.product,
    endpointReviewId: config.endpointReviewId, expectedStockPair: config.expectedStockPair };
  return { request, digest: createHash('sha256').update(JSON.stringify(request)).digest('hex') };
}
function validate(record) {
  if (!record || record.schema !== 1 || !jobPattern.test(record.jobId ?? '') || typeof record.requestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.requestDigest) ||
      !record.request || record.request.jobId !== record.jobId || record.request.sha256 !== STOCK.sha256 || record.request.product !== STOCK.product ||
      createHash('sha256').update(JSON.stringify(record.request)).digest('hex') !== record.requestDigest ||
      !['prepared', 'active', 'unknown', 'succeeded', 'failed'].includes(record.state) || !phases.has(record.phase) ||
      typeof record.transfer_finished !== 'boolean' || typeof record.boot_identity_verified !== 'boolean' ||
      (record.boot_identity_verified && (!record.transfer_finished || record.state !== 'succeeded')) ||
      (record.state === 'succeeded' && (!record.transfer_finished || !record.boot_identity_verified || record.phase !== 'done'))) {
    throw new StockError('corrupt_journal', 'Attempt journal failed integrity validation.');
  }
  return record;
}
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

export class AttemptJournal {
  static async open(stateRoot, identity, { resume = false } = {}) {
    const root = absolutePath(stateRoot);
    await checkPath(root, true); await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const rootStat = await checkPath(root);
    if (!rootStat.isDirectory()) throw new StockError('unsafe_path', 'Attempt state root must be a directory.');
    const journal = new AttemptJournal(root, identity);
    await journal.acquire(resume);
    try { await journal.prepare(resume); return journal; } catch (error) { await journal.close(); throw error; }
  }
  constructor(root, identity) {
    this.root = root; this.identity = identity;
    this.file = path.join(root, 'attempt.json'); this.lockFile = path.join(root, 'worker.lock'); this.lock = null; this.record = null;
    this.acquireFile = path.join(root, 'worker-acquire.lock'); this.ownerId = randomUUID();
  }
  async acquire(resume) {
    // Every acquisition, including dead-owner takeover, is serialized. Without this
    // guard, two resumptions could both observe the old owner and one could unlink
    // the replacement lock acquired by the other.
    await checkPath(this.acquireFile, true);
    let guard;
    try { guard = await fs.open(this.acquireFile, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new StockError('worker_busy', 'Another acquisition or an unresolved acquisition guard owns this device.');
      throw error;
    }
    let guardWritten = false;
    try {
      await guard.writeFile(`${JSON.stringify({ schema: 1, pid: process.pid, ownerId: this.ownerId })}\n`); await guard.sync(); guardWritten = true;
      await checkPath(this.lockFile, true);
      try { this.lock = await fs.open(this.lockFile, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const owner = await readJson(this.lockFile);
        const prior = validate(await readJson(this.file));
        if (!resume || !blocked.has(prior.state) || prior.requestDigest !== this.identity.digest || owner.jobId !== this.identity.request.jobId || alive(owner.pid)) {
          throw new StockError('worker_busy', 'Another worker or an unresolved attempt owns this device.');
        }
        // All peer acquisitions hold the same guard before reading/unlinking this
        // file, so a replacement cannot be removed by a concurrent resumption.
        await checkPath(this.lockFile); await fs.unlink(this.lockFile);
        try { this.lock = await fs.open(this.lockFile, 'wx', 0o600); }
        catch { throw new StockError('worker_busy', 'Another worker acquired the device.'); }
      }
      await this.lock.writeFile(`${JSON.stringify({ schema: 1, pid: process.pid, jobId: this.identity.request.jobId, ownerId: this.ownerId })}\n`); await this.lock.sync();
    } finally {
      await guard.close();
      // A crashed/partially written guard is deliberately never reclaimed here.
      // Trusted recovery must establish that its owner is dead before removing it.
      if (guardWritten) {
        await checkPath(this.acquireFile);
        const owner = await readJson(this.acquireFile);
        if (owner.pid !== process.pid || owner.ownerId !== this.ownerId) throw new StockError('corrupt_journal', 'Acquisition guard owner changed.');
        await fs.unlink(this.acquireFile);
      }
    }
  }
  async prepare(resume) {
    const priorRaw = await readJson(this.file, true), prior = priorRaw && validate(priorRaw);
    if (resume) {
      if (!prior || !blocked.has(prior.state) || prior.requestDigest !== this.identity.digest) throw new StockError('resume_rejected', 'Explicit resume requires the identical unresolved stock attempt.');
      this.record = { ...prior, state: 'unknown' };
    } else {
      if (prior && blocked.has(prior.state)) {
        const error = new StockError('recovery_required', 'A prior active or unknown update must be resolved explicitly.');
        error.recovery_required = true; throw error;
      }
      if (prior?.jobId === this.identity.request.jobId) throw new StockError('duplicate_attempt', 'This job already has a receipt; it will not run again.');
      // Archive the old immutable receipt before installing a new attempt journal.
      if (prior) {
        const receipts = path.join(this.root, 'receipts'); await checkPath(receipts, true); await fs.mkdir(receipts, { recursive: true, mode: 0o700 });
        if (!(await checkPath(receipts)).isDirectory()) throw new StockError('unsafe_path', 'Receipt directory is invalid.');
        const receipt = path.join(receipts, `${prior.jobId}.json`);
        await checkPath(receipt, true);
        try { const handle = await fs.open(receipt, 'wx', 0o600); try { await handle.writeFile(`${JSON.stringify(prior)}\n`); await handle.sync(); } finally { await handle.close(); } }
        catch (error) { if (error.code !== 'EEXIST' || JSON.stringify(validate(await readJson(receipt))) !== JSON.stringify(prior)) throw new StockError('corrupt_journal', 'Saved receipt is inconsistent.'); }
      }
      const oldReceipt = path.join(this.root, 'receipts', `${this.identity.request.jobId}.json`);
      if (await readJson(oldReceipt, true)) throw new StockError('duplicate_attempt', 'This job already has an immutable receipt.');
      this.record = { schema: 1, jobId: this.identity.request.jobId, request: this.identity.request, requestDigest: this.identity.digest,
        state: 'prepared', phase: 'prepared', transfer_finished: false, boot_identity_verified: false, startedAt: new Date().toISOString() };
    }
    await atomicJson(this.file, this.record);
  }
  async transition(phase, extra = {}) {
    if (!phases.has(phase)) throw new StockError('invalid_phase', 'Invalid journal phase.');
    const next = { ...this.record, ...extra, phase, updatedAt: new Date().toISOString() };
    validate(next); await atomicJson(this.file, next); this.record = next;
  }
  async close() {
    if (!this.lock) return;
    await this.lock.close(); this.lock = null;
    await checkPath(this.lockFile);
    const owner = await readJson(this.lockFile);
    if (owner.pid !== process.pid || owner.jobId !== this.identity.request.jobId || owner.ownerId !== this.ownerId) throw new StockError('corrupt_journal', 'Worker lock owner changed.');
    await fs.unlink(this.lockFile);
  }
}
