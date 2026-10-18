import { StockError } from './protocol.mjs';
import { inspectStockPackage } from './package.mjs';
import { candidatePairs, selectPair } from './selection.mjs';
import { openJournalDatabase, readCurrent, checkJournalDurability, ensureStorageScope, readStorageScope, BrowserAttemptJournal } from './journal.mjs';
import { makeWebMidiBackend, identifyPair, grantedInventory } from './web-midi.mjs';
import { runUpdate, realClock, DEFAULT_TIMING } from './updater.mjs';
import { stockOriginKind, usableStockOrigin } from './origin.mjs';
export { STOCK, StockError } from './protocol.mjs';

const LOCK = 'fm1-forge-stock-v15-device';
const clone = value => JSON.parse(JSON.stringify(value));
export function createBrowserStockUpdater({ navigator = globalThis.navigator, indexedDB = globalThis.indexedDB, crypto = globalThis.crypto,
  locks = navigator?.locks, location = globalThis.location, secureContext = globalThis.isSecureContext, clock = realClock, timing = DEFAULT_TIMING, onEvent = () => {}, onState = () => {}, beforeWrite = async () => {} } = {}) {
  let access = null, backend = null, database = null, selectedPair = null, identity = null, connected = false, updating = false;
  let recoveryRequired = false, lastError = null, localBusy = false;
  const origin = typeof location?.origin === 'string' ? location.origin : 'null';
  let storageScope = { origin, originKind: stockOriginKind(origin), secureContext: typeof secureContext === 'boolean' ? secureContext : null,
    sentinel: null, durableReady: false, locksAvailable: typeof locks?.request === 'function' };
  const status = () => Object.freeze({ granted: Boolean(access?.sysexEnabled), pair: selectedPair && clone(selectedPair), identity: identity?.text ?? null,
    loader: identity?.loader ?? false, identityVerified: Boolean(identity && connected), connected, updating, recoveryRequired,
    lastError: lastError && { ...lastError }, storageScope: { ...storageScope } });
  const notify = () => { try { onState(status()); } catch {} };
  const noteError = error => { lastError = { code: error instanceof StockError ? error.code : 'browser_failed',
    message: error instanceof StockError ? error.message : 'The browser stock update failed.' }; if (error.recovery_required) recoveryRequired = true;
    if (['storage_unavailable', 'storage_failed', 'storage_scope_changed', 'opaque_origin', 'corrupt_journal'].includes(error.code)) storageScope.durableReady = false; notify(); };
  const storageCapabilities = () => {
    if (!usableStockOrigin(storageScope.origin, secureContext)) throw new StockError('opaque_origin', 'A stable supported origin and a secure native context are required for durable stock update recovery.');
    if (typeof locks?.request !== 'function') throw new StockError('locks_unavailable', 'Web Locks are required for safe cross-tab stock updates.');
    if (typeof indexedDB?.open !== 'function') throw new StockError('storage_unavailable', 'Durable IndexedDB is required for stock updates.');
    if (typeof crypto?.subtle?.digest !== 'function') throw new StockError('crypto_unavailable', 'WebCrypto SHA-256 is required.');
  };
  const capabilities = () => {
    storageCapabilities();
    if (typeof navigator?.requestMIDIAccess !== 'function') throw new StockError('midi_unavailable', 'Web MIDI SysEx access is unavailable in this panel.');
  };
  const withLock = async operation => {
    storageCapabilities();
    if (localBusy) throw new StockError('worker_busy', 'Another operation is active in this panel.');
    localBusy = true;
    try {
      return await locks.request(LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) throw new StockError('worker_busy', 'Another panel owns the FM-1 device.');
        return operation();
      });
    } finally { localBusy = false; }
  };
  const observeScope = scope => {
    if (storageScope.sentinel !== null && (!scope || scope.sentinel !== storageScope.sentinel)) throw new StockError('storage_scope_changed', 'The previously observed stock update storage scope changed or disappeared.');
    if (scope) storageScope.sentinel = scope.sentinel;
  };
  const getDatabase = async () => {
    if (!database) database = await openJournalDatabase(indexedDB);
    observeScope(await readStorageScope(database, storageScope.origin));
    await checkJournalDurability(database);
    const scope = await ensureStorageScope(database, storageScope.origin, crypto);
    observeScope(scope); storageScope = { ...storageScope, durableReady: true };
    const prior = await readCurrent(database, crypto); recoveryRequired = Boolean(prior && (prior.state === 'active' || prior.state === 'unknown'));
    return database;
  };
  const savedAttempt = async () => {
    try {
      storageCapabilities();
      if (!database) database = await openJournalDatabase(indexedDB);
      const scope = await readStorageScope(database, storageScope.origin);
      observeScope(scope);
      const prior = await readCurrent(database, crypto);
      recoveryRequired = Boolean(prior && (prior.state === 'active' || prior.state === 'unknown')); notify();
      return prior ? Object.freeze({ jobId: prior.jobId, reviewId: prior.request.reviewId, state: prior.state, phase: prior.phase,
        sha256: prior.request.sha256, product: prior.request.product, pair: clone(prior.request.pair),
        transfer_finished: prior.transfer_finished, boot_identity_verified: prior.boot_identity_verified }) : null;
    } catch (error) { noteError(error); throw error; }
  };
  const initialize = async () => {
    try { return await withLock(async () => { await getDatabase(); lastError = null; notify(); return status(); }); }
    catch (error) { noteError(error); throw error; }
  };
  const deviceState = () => {
    if (!selectedPair || !access) return;
    if (access.inputs.get(selectedPair.inputId)?.state !== 'connected' || access.outputs.get(selectedPair.outputId)?.state !== 'connected') {
      connected = false; notify();
    }
  };
  const probe = async () => {
    if (!access?.sysexEnabled) return Object.freeze({ granted: false, pairs: [], selectedPair: null, identityVerified: false });
    const inventory = grantedInventory(access);
    return Object.freeze({ granted: true, pairs: candidatePairs(inventory), selectedPair: selectedPair && clone(selectedPair), identityVerified: Boolean(identity && connected) });
  };
  const connect = async ({ inputId, outputId } = {}) => {
    let ownsAttempt = false;
    try {
      capabilities();
      if (navigator.userActivation?.isActive !== true) throw new StockError('user_gesture_required', 'Use the Connect button to request MIDI SysEx access.');
      return await withLock(async () => {
        ownsAttempt = true;
        if (navigator.userActivation?.isActive !== true) throw new StockError('user_gesture_required', 'A current user gesture is required for MIDI permission.');
        // Request within the explicit Connect action before any asynchronous storage work.
        const permission = navigator.requestMIDIAccess({ sysex: true }).catch(() => { throw new StockError('midi_permission_denied', 'MIDI SysEx permission was denied or unavailable.'); });
        const [granted] = await Promise.all([permission, getDatabase()]);
        if (!granted?.sysexEnabled) throw new StockError('sysex_denied', 'MIDI SysEx permission was not granted.');
        if (backend) await backend.close();
        access = granted; backend = makeWebMidiBackend(access, { onDeviceState: deviceState });
        const inventory = await backend.enumerate();
        let pair;
        if (inputId !== undefined || outputId !== undefined) {
          if (typeof inputId !== 'string' || typeof outputId !== 'string') throw new StockError('invalid_endpoint', 'Select both FM-1 endpoints.');
          pair = candidatePairs(inventory).find(value => value.inputId === inputId && value.outputId === outputId);
        } else pair = selectPair(inventory);
        if (!pair) throw new StockError('endpoint_unavailable', 'No exact FM-1 MIDI input/output pair is available.');
        const found = await identifyPair(backend, pair, { clock, timing });
        selectedPair = pair; identity = found; connected = true; lastError = null; notify();
        return Object.freeze({ pair: clone(pair), identity: found.text, loader: found.loader, identityVerified: true });
      });
    } catch (error) {
      if (ownsAttempt) {
        connected = false; identity = null;
        if (backend) { try { await backend.close(); } catch {} backend = null; }
      }
      noteError(error); throw error;
    }
  };
  const inspectPackage = async packageBytes => (await inspectStockPackage(packageBytes, crypto)).metadata;
  const perform = async (operation, { jobId, reviewId, packageBytes } = {}) => {
    try {
      if (navigator?.userActivation?.isActive !== true) throw new StockError('user_gesture_required', 'Use the reviewed stock update or Resume button to start the transfer.');
      return await withLock(async () => {
        if (!access?.sysexEnabled || !backend || !selectedPair || !connected || !identity) throw new StockError('connect_required', 'Connect and confirm the FM-1 MIDI identity first.');
        const artifact = await inspectStockPackage(packageBytes, crypto);
        const db = await getDatabase();
        if (!storageScope.durableReady || !storageScope.locksAvailable) throw new StockError('storage_unavailable', 'Durable shared stock update storage is not ready.');
        // DEVICE_LOCK is held here. The native panel checks the other engine's
        // current journal before preparing either a new or resumed stock write.
        await beforeWrite(Object.freeze({ operation }));
        const journal = await BrowserAttemptJournal.prepare(db, { jobId, reviewId, pair: selectedPair, scope: storageScope }, crypto, { resume: operation === 'resume' });
        updating = true; lastError = null; notify();
        try {
          const result = await runUpdate({ operation, jobId, expectedStockPair: operation === 'resume' ? journal.record.request.pair : selectedPair },
            { image: artifact.image, backend, journal, clock, timing, onEvent: event => { try { onEvent(event); } catch {} } });
          selectedPair = backend.lastPair; identity = { text: result.identity, loader: false }; connected = true; recoveryRequired = false; lastError = null;
          return result;
        } catch (error) {
          connected = false;
          if (journal.record.state === 'active' || journal.record.state === 'unknown') error.recovery_required = true;
          throw error;
        } finally { updating = false; notify(); }
      });
    } catch (error) { noteError(error); throw error; }
  };
  const disconnect = async () => {
    try {
      return await withLock(async () => {
        if (backend) await backend.close(); backend = null; access = null; selectedPair = null; identity = null; connected = false; notify();
        return status();
      });
    } catch (error) { noteError(error); throw error; }
  };
  return Object.freeze({ initialize, ready: initialize, connect, probe, inspectPackage, savedAttempt, update: input => perform('update', input), resume: input => perform('resume', input), disconnect, status });
}
