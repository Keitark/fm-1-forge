// Custom V15-to-Forge transfer. Package validation and review are owned by the native service.
import { STOCK, StockError, CHECK_FINISH, WRITE_FINISH, identityQuery, upgradeCommand, successPayload,
  parseIdentity, parseRequest, response } from './protocol.mjs';
import { selectPair, canonicalName } from './selection.mjs';
import { createHash } from 'node:crypto';
import { WIRE, identityQuery as commonIdentityQuery, capabilityQuery, parseIdentity as parseCommonIdentity, parseCapabilities, decodeFrame as decodeCommonFrame } from '../../../site/lib/browser-common/protocol.mjs';

export const DEFAULT_TIMING = Object.freeze({ open: 300, start: 2000, reply: 10, terminal: 3000, handshake: 1000,
  poll: 1000, idleCheck: 8000, idleWrite: 180000, loader: 30000, reboot: 40000, enumerate: 1000 });
export const realClock = Object.freeze({ now: () => performance.now(), sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) });

export async function runCustomUpdate(config, { image: packageImage, backend, journal, onEvent = () => {}, clock = realClock, timing = DEFAULT_TIMING }) {
  // Snapshot approved bytes; neither a transport callback nor caller mutation can change replies.
  const image = Uint8Array.from(packageImage);
  const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!Number.isSafeInteger(config.logicalBytes) || image.length !== config.logicalBytes || image.length < 1024 || image.length > 2 * 1024 * 1024 ||
      !hex64(config.reviewedSha256) || !hex64(config.logicalSha256) || !hex64(config.targetBuildSha256) ||
      createHash('sha256').update(image).digest('hex') !== config.logicalSha256 ||
      !['install', 'resume'].includes(config.operation) || config.expectedInitialIdentity !== (config.operation === 'resume' ? WIRE.loaderIdentity : STOCK.product)) {
    throw new StockError('invalid_package', 'A reviewed custom FWSC image, target build and source identity are required.');
  }
  let link = null, destructiveStarted = false, finished = false;
  const resume = config.operation === 'resume';
  let phase = 'prepared', eventCount = 0, lastEventAt = -Infinity;
  const emit = (details = {}, force = false) => {
    if (++eventCount > 100000) throw new StockError('too_many_requests', 'OTA request limit exceeded.');
    if (force || clock.now() - lastEventAt >= 100) {
      lastEventAt = clock.now(); onEvent(Object.freeze({ phase, ...details }));
    }
  };
  const change = async (next, extra = {}) => { phase = next; await journal.transition(next, extra); emit({}, true); };
  const closeLink = async () => { if (link) { const closing = link; link = null; await closing.close(); } };
  const send = async packet => { if (await link.send(packet) === false) throw new StockError('send_failed', 'MIDI send failed.'); };
  const finalPair = inventory => {
    if (!inventory || !Array.isArray(inventory.inputs) || !Array.isArray(inventory.outputs) || inventory.inputs.length > 256 || inventory.outputs.length > 256) throw new StockError('invalid_inventory', 'Custom firmware MIDI inventory is invalid.');
    const accepted = new Set(['fm-1', 'fm-1 midi', 'fm-1 forge', 'fm1_forge_001']);
    const nameOf = port => typeof port === 'string' ? port : port?.name;
    const inputs = inventory.inputs.map(nameOf), outputs = inventory.outputs.map(nameOf), pairs = [];
    for (const inputName of inputs) {
      const name = canonicalName(inputName);
      if (!accepted.has(name)) continue;
      const sameInputs = inputs.filter(value => canonicalName(value) === name), sameOutputs = outputs.filter(value => canonicalName(value) === name);
      if (sameInputs.length !== 1 || sameOutputs.length > 1) throw new StockError('ambiguous_device', 'Several custom firmware MIDI endpoints are indistinguishable.');
      if (sameOutputs.length === 1) pairs.push({ inputName, outputName: sameOutputs[0] });
    }
    if (pairs.length > 1) throw new StockError('ambiguous_device', 'Connect only the intended FM-1 MIDI pair.');
    return pairs[0] ?? null;
  };
  const commonBoot = async packet => {
    if (parseCommonIdentity(packet) !== WIRE.commonIdentity) throw new StockError('boot_identity_mismatch', 'The rebooted device did not identify as Forge firmware.');
    await link.drain(); await send(capabilityQuery());
    const deadline = clock.now() + timing.handshake;
    for (let count = 0; count < 64 && clock.now() < deadline; count++) {
      const reply = await link.read(Math.max(1, deadline - clock.now()));
      if (reply === null) break;
      let frame; try { frame = decodeCommonFrame(reply); } catch { continue; }
      if (frame.command !== 0x31) continue;
      const capabilities = parseCapabilities(reply);
      if (capabilities.family !== WIRE.family || capabilities.state !== 0 || capabilities.buildSha256 !== config.targetBuildSha256) throw new StockError('boot_build_mismatch', 'The rebooted firmware does not match the reviewed Forge build.');
      return { text: WIRE.commonIdentity, loader: false, buildSha256: capabilities.buildSha256, family: capabilities.family };
    }
    throw new StockError('boot_capability_timeout', 'The rebooted firmware did not provide its build identity.');
  };
  const handshake = async (pair, common = false) => {
    link = await backend.open(pair); await clock.sleep(timing.open); await link.drain();
    await send(common ? commonIdentityQuery() : identityQuery());
    const end = clock.now() + timing.handshake;
    let unrelated = 0;
    while (clock.now() < end) {
      const packet = await link.read(Math.max(1, end - clock.now()));
      if (packet === null) break;
      // Transport filters non-SysEx MIDI; do not accept an arbitrary identity from other gear.
      if (common) return commonBoot(packet);
      const identity = parseIdentity(packet);
      if (identity) return identity;
      if (++unrelated > 64) throw new StockError('invalid_identity', 'Identity response limit exceeded.');
    }
    throw new StockError('identity_timeout', 'FM-1 identity did not answer.');
  };
  const waitFor = async (mode, milliseconds) => {
    const end = clock.now() + milliseconds;
    while (clock.now() < end) {
      const inventory = await backend.enumerate(Math.max(1, end - clock.now()));
      const pair = mode === 'normal' ? finalPair(inventory) : selectPair(inventory, config.expectedStockPair, mode);
      if (pair) {
        try {
          const identity = await handshake(pair, mode === 'normal');
          if (mode === 'loader' && identity.text !== WIRE.loaderIdentity) throw new StockError('wrong_loader', 'The pinned FM-1 OTA loader identity is required.');
          if (mode === 'loader' ? identity.loader : !identity.loader) return identity;
          await closeLink();
        } catch (error) {
          await closeLink();
          if (!['identity_timeout', 'endpoint_unavailable'].includes(error.code)) throw error;
        }
      }
      await clock.sleep(Math.min(timing.enumerate, Math.max(0, end - clock.now())));
    }
    throw new StockError(mode === 'loader' ? 'loader_timeout' : 'reboot_timeout', mode === 'loader' ? 'FM-1 OTA loader did not appear.' : 'FM-1 did not return after the update.');
  };
  const serve = async (terminal, idle) => {
    let lastRequest = clock.now(), requests = 0, bytesServed = 0, uniqueBytes = 0;
    const covered = new Uint8Array(image.length);
    while (true) {
      const packet = await link.read(timing.poll);
      if (packet === null) {
        if (!await link.isConnected()) throw new StockError('disconnected', 'FM-1 MIDI connection was lost.');
        if (clock.now() - lastRequest >= idle) throw new StockError('request_timeout', 'FM-1 stopped requesting the approved image.');
        continue;
      }
      const request = parseRequest(packet, image.length, terminal);
      lastRequest = clock.now();
      if (request.terminal) {
        await send(response(request.address, successPayload()));
        emit({ requests, bytes_served: bytesServed, progress: terminal === WRITE_FINISH ? 1 : 0 }, true);
        // Stock verifier resets after this acknowledgement. Hold the handle for vendor timing.
        await clock.sleep(timing.terminal); return;
      }
      await clock.sleep(timing.reply);
      await send(response(request.address, image.subarray(request.address, request.address + request.length), request.flags));
      requests++; bytesServed += request.length;
      for (let index = request.address; index < request.address + request.length; index++) {
        if (!covered[index]) { covered[index] = 1; uniqueBytes++; }
      }
      emit({ requests, bytes_served: bytesServed, progress: terminal === WRITE_FINISH ? Math.min(0.99, uniqueBytes / image.length) : 0 });
    }
  };
  try {
    // Resume preserves the original approval metadata even though USB re-enumerated as OTA.
    const pair = selectPair(await backend.enumerate(), config.expectedStockPair, resume ? 'loader' : undefined);
    if (!pair) throw new StockError('endpoint_unavailable', 'The reviewed FM-1 MIDI pair is unavailable.');
    let identity = await handshake(pair);
    if (config.expectedInitialIdentity !== undefined && identity.text !== config.expectedInitialIdentity) throw new StockError('device_changed', 'The FM-1 identity changed after the reviewed connection.');
    if (resume && !identity.loader) throw new StockError('resume_requires_loader', 'Explicit resume is only supported in a freshly identified FM-1 OTA loader.');
    if (!resume && identity.loader) throw new StockError('recovery_required', 'An FM-1 already in OTA mode requires explicit resume of its unresolved attempt.');
    if (!resume) {
      // This fsynced record is committed before even attempting the first destructive command.
      await change('entering_check', { state: 'active', initial_identity: identity.text });
      destructiveStarted = true; await send(upgradeCommand());
      await change('checking'); await clock.sleep(timing.start); await serve(CHECK_FINISH, timing.idleCheck); await closeLink();
      await change('waiting_loader'); identity = await waitFor('loader', timing.loader);
    }
    if (!identity.loader || identity.text !== WIRE.loaderIdentity) throw new StockError('wrong_loader', 'The pinned FM-1 OTA loader identity is required.');
    await change('entering_write', { state: 'active', loader_identity: identity.text });
    destructiveStarted = true; await send(upgradeCommand());
    await change('writing'); await clock.sleep(timing.start); await serve(WRITE_FINISH, timing.idleWrite);
    finished = true;
    await change('waiting_reboot', { transfer_finished: true }); await closeLink();
    identity = await waitFor('normal', timing.reboot);
    if (identity.text !== WIRE.commonIdentity || identity.buildSha256 !== config.targetBuildSha256) throw new StockError('boot_build_mismatch', 'Reboot proof does not match the reviewed Forge build.');
    await closeLink();
    await change('done', { state: 'succeeded', boot_identity_verified: true, boot_build_verified: true, final_identity: identity.text, final_build_sha256: identity.buildSha256 });
    return Object.freeze({ jobId: config.jobId, state: 'succeeded', product: WIRE.commonIdentity, sha256: config.reviewedSha256, target_build_sha256: config.targetBuildSha256,
      transfer_finished: true, boot_identity_verified: true, boot_build_verified: true, identity: identity.text, build_sha256: identity.buildSha256, readback_verified: false });
  } catch (error) {
    const uncertain = destructiveStarted || resume;
    error.destructive_started = destructiveStarted; error.state = uncertain ? 'unknown' : 'failed';
    error.recovery_required = uncertain; error.transfer_finished = finished; error.boot_identity_verified = false; error.boot_build_verified = false;
    try { await journal.transition(phase === 'prepared' ? 'failed' : phase, { state: error.state, error_code: error.code ?? 'worker_failed', transfer_finished: finished, boot_identity_verified: false, boot_build_verified: false }); }
    catch { error.code = 'journal_write_failed'; error.state = 'unknown'; error.recovery_required = true; }
    throw error;
  } finally {
    try { await closeLink(); }
    catch (error) {
      error.destructive_started = destructiveStarted; error.recovery_required = destructiveStarted || resume;
      error.state = error.recovery_required ? 'unknown' : 'failed'; error.transfer_finished = finished; error.boot_identity_verified = false; error.boot_build_verified = false;
      try { await journal.transition(phase, { state: error.state, transfer_finished: finished, boot_identity_verified: false, boot_build_verified: false, error_code: 'close_failed' }); } catch { error.recovery_required = true; }
      throw error;
    }
  }
}
