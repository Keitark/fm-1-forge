import { STOCK, StockError } from './protocol.mjs';
import { sha256 } from './package.mjs';
import { stockOriginKind } from './origin.mjs';
const ids = /^[a-f0-9]{32}$/;
const phases = new Set(['prepared', 'entering_check', 'checking', 'waiting_loader', 'entering_write', 'writing', 'waiting_reboot', 'done', 'failed']);
const blocked = state => state === 'active' || state === 'unknown';
const copy = value => JSON.parse(JSON.stringify(value));
const requestValue = request => new TextEncoder().encode(JSON.stringify(request));
function validate(record) {
  if (!record || record.key !== 'current' || record.schema !== 1 || !ids.test(record.jobId ?? '') || !record.request ||
      record.request.jobId !== record.jobId || !ids.test(record.request.reviewId ?? '') || record.request.sha256 !== STOCK.sha256 || record.request.product !== STOCK.product ||
      !/^[a-f0-9]{64}$/.test(record.requestDigest ?? '') || !['prepared', 'active', 'unknown', 'failed', 'succeeded'].includes(record.state) ||
      !phases.has(record.phase) || typeof record.transfer_finished !== 'boolean' || typeof record.boot_identity_verified !== 'boolean' ||
      (record.boot_identity_verified && (record.state !== 'succeeded' || !record.transfer_finished)) ||
      (record.state === 'succeeded' && (record.phase !== 'done' || !record.boot_identity_verified || !record.transfer_finished))) throw new StockError('corrupt_journal', 'Stock update journal is inconsistent.');
  if (!record.request.storageScope || !stockOriginKind(record.request.storageScope.origin) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.request.storageScope.sentinel ?? '')) throw new StockError('corrupt_journal', 'Stock update request scope is inconsistent.');
  return record;
}
function requestPromise(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new StockError('storage_failed', 'IndexedDB request failed.')); });
}
export async function openJournalDatabase(indexedDB) {
  if (typeof indexedDB?.open !== 'function') throw new StockError('storage_unavailable', 'Durable IndexedDB storage is required.');
  return new Promise((resolve, reject) => {
    let request;
    try { request = indexedDB.open('fm1-forge-stock-sysex-v1', 1); }
    catch { reject(new StockError('storage_unavailable', 'IndexedDB is unavailable.')); return; }
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('attempts')) request.result.createObjectStore('attempts', { keyPath: 'key' }); };
    request.onerror = request.onblocked = () => reject(new StockError('storage_unavailable', 'IndexedDB could not be opened.'));
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('attempts')) { database.close(); reject(new StockError('corrupt_journal', 'IndexedDB journal store is missing.')); return; }
      database.onversionchange = () => database.close(); resolve(database);
    };
  });
}
async function transaction(database, mode, run) {
  let tx;
  try { tx = database.transaction('attempts', mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); }
  catch { throw new StockError('storage_unavailable', 'Durable IndexedDB transaction is unavailable.'); }
  if (mode === 'readwrite' && tx.durability !== 'strict') { try { tx.abort(); } catch {} throw new StockError('storage_unavailable', 'Strict IndexedDB durability is required.'); }
  const completed = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new StockError('storage_failed', 'IndexedDB transaction did not commit.'));
  });
  completed.catch(() => {});
  try { const value = await run(tx.objectStore('attempts')); await completed; return value; }
  catch (error) { try { tx.abort(); } catch {} await completed.catch(() => {}); throw error; }
}
export const checkJournalDurability = database => transaction(database, 'readwrite', store => requestPromise(store.get('current')));
function validateScope(scope, origin) {
  if (!stockOriginKind(origin) ||
      !scope || scope.key !== 'scope' || scope.schema !== 1 || scope.origin !== origin ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(scope.sentinel ?? '') ||
      Object.keys(scope).some(key => !['key', 'schema', 'origin', 'sentinel'].includes(key))) throw new StockError('storage_scope_changed', 'The durable stock update storage scope is inconsistent.');
  return scope;
}
export async function ensureStorageScope(database, origin, crypto) {
  if (typeof crypto?.randomUUID !== 'function') throw new StockError('crypto_unavailable', 'A secure storage scope identifier is required.');
  const candidate = { key: 'scope', schema: 1, origin, sentinel: crypto.randomUUID() };
  return transaction(database, 'readwrite', async store => {
    const existing = await requestPromise(store.get('scope'));
    if (existing !== undefined) return validateScope(existing, origin);
    await requestPromise(store.add(candidate)); return validateScope(candidate, origin);
  });
}
export async function readStorageScope(database, origin) {
  const scope = await transaction(database, 'readonly', store => requestPromise(store.get('scope')));
  return scope === undefined ? null : validateScope(scope, origin);
}
export async function readCurrent(database, crypto) {
  const record = await transaction(database, 'readonly', store => requestPromise(store.get('current')));
  if (record === undefined) return null;
  validate(record);
  if (await sha256(requestValue(record.request), crypto) !== record.requestDigest) throw new StockError('corrupt_journal', 'Stock update request digest is inconsistent.');
  return record;
}
export class BrowserAttemptJournal {
  static async prepare(database, { jobId, reviewId, pair, scope }, crypto, { resume = false } = {}) {
    if (!ids.test(jobId ?? '') || !ids.test(reviewId ?? '')) throw new StockError('unreviewed_request', 'A stock package review and job ID are required.');
    const expectedScope = { origin: scope?.origin, sentinel: scope?.sentinel };
    validateScope({ key: 'scope', schema: 1, ...expectedScope }, expectedScope.origin);
    const prior = await readCurrent(database, crypto);
    let request;
    if (resume) {
      if (!prior || !blocked(prior.state) || prior.jobId !== jobId || prior.request.reviewId !== reviewId) {
        const error = new StockError('resume_rejected', 'Explicit resume requires the identical unresolved stock update.'); error.recovery_required = Boolean(prior && blocked(prior.state)); throw error;
      }
      request = prior.request;
      if (request.storageScope.origin !== expectedScope.origin || request.storageScope.sentinel !== expectedScope.sentinel) throw new StockError('storage_scope_changed', 'The unresolved stock update belongs to another storage scope.');
    } else {
      if (prior && blocked(prior.state)) { const error = new StockError('recovery_required', 'An unresolved stock update requires explicit recovery.'); error.recovery_required = true; throw error; }
      if (!pair) throw new StockError('unreviewed_request', 'A confirmed FM-1 endpoint pair is required.');
      request = { jobId, reviewId, product: STOCK.product, sha256: STOCK.sha256, pair: copy(pair), storageScope: expectedScope };
    }
    const digest = await sha256(requestValue(request), crypto);
    const record = resume ? { ...prior, state: 'unknown' } : { key: 'current', schema: 1, jobId, request, requestDigest: digest,
      state: 'prepared', phase: 'prepared', transfer_finished: false, boot_identity_verified: false, startedAt: new Date().toISOString() };
    await transaction(database, 'readwrite', async store => {
      const currentScope = validateScope(await requestPromise(store.get('scope')), expectedScope.origin);
      if (currentScope.sentinel !== expectedScope.sentinel) throw new StockError('storage_scope_changed', 'The stock update storage scope changed during preparation.');
      const current = await requestPromise(store.get('current'));
      if (JSON.stringify(current ?? null) !== JSON.stringify(prior)) throw new StockError('journal_changed', 'Stock update journal changed during review.');
      if (!resume) {
        if (prior?.jobId === jobId || await requestPromise(store.get(`receipt:${jobId}`)) !== undefined) throw new StockError('duplicate_attempt', 'This stock update job already has a receipt.');
        if (prior) {
          const key = `receipt:${prior.jobId}`, existing = await requestPromise(store.get(key));
          const receipt = { ...prior, key };
          if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(receipt)) throw new StockError('corrupt_journal', 'Saved stock update receipt is inconsistent.');
          if (existing === undefined) await requestPromise(store.add(receipt));
        }
      }
      await requestPromise(store.put(record));
    });
    return new BrowserAttemptJournal(database, record);
  }
  constructor(database, record) { this.database = database; this.record = record; this.requestJson = JSON.stringify(record.request); }
  async transition(phase, extra = {}) {
    const next = { ...this.record, ...extra, phase, updatedAt: new Date().toISOString() }; validate(next);
    await transaction(this.database, 'readwrite', async store => {
      const currentScope = validateScope(await requestPromise(store.get('scope')), this.record.request.storageScope.origin);
      if (currentScope.sentinel !== this.record.request.storageScope.sentinel) throw new StockError('storage_scope_changed', 'The stock update storage scope changed during the transfer.');
      const current = await requestPromise(store.get('current')); validate(current);
      if (current.requestDigest !== this.record.requestDigest || JSON.stringify(current.request) !== this.requestJson || JSON.stringify(current) !== JSON.stringify(this.record)) throw new StockError('journal_changed', 'Stock update journal owner changed.');
      await requestPromise(store.put(next));
    });
    // Resolve only after oncomplete, never merely after IDBRequest.onsuccess.
    this.record = next;
  }
}
