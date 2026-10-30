// SPDX-License-Identifier: Apache-2.0
/*! @license FM-1 common USB-MIDI native panel integration.
 * Copyright 2026 Keitarou Kondou. Apache-2.0.
 * The accompanying browser-common/LICENSE and NOTICE retain the source terms
 * and factual interoperability attribution. No vendor OTA binary is included.
 */
// Native Forge panel adapter for the independently authored common updater.
import { createCommonUpdater, validateManifest, WIRE } from './browser-common/index.mjs';

export const commonDevicesHtml = String.raw`<details class="direct-stock direct-common" id="direct-common"><summary>Custom firmware · common SysEx update</summary><p class="note">Experimental · physical update qualification is pending. Connect firmware MIDI to read the installed firmware's capability. Its install backend defaults to unavailable; selecting files cannot enable it.</p><label class="note" for="direct-common-manifest">Build manifest (.json)</label><input type="file" id="direct-common-manifest" accept=".json,application/json" aria-label="Common firmware build manifest"><label class="note" for="direct-common-file">Matching firmware package (.fwsc)</label><input type="file" id="direct-common-file" accept=".fwsc" aria-label="Common firmware package"><p class="digest" id="direct-common-summary">Select the manifest and matching package. Files stay in this panel.</p><div class="direct-buttons direct-stock-review"><button class="secondary" id="direct-common-review" type="button" disabled>Review firmware update</button></div><p class="note" id="direct-common-note" role="status" aria-live="polite">No device permission is requested automatically.</p><section class="direct-device-transfer" id="direct-common-transfer" hidden aria-label="Current custom firmware transfer"><h2>Custom firmware transfer</h2><p id="direct-common-transfer-status" role="status" aria-live="polite"></p><progress id="direct-common-progress" max="1" aria-label="Custom firmware transfer progress"></progress><p class="note" id="direct-common-phase"></p></section></details>`;
export const commonDialogHtml = String.raw`<dialog id="direct-common-dialog"><h2>Review custom firmware update</h2><pre class="direct-review-text" id="direct-common-review-text"></pre><p class="note">Before arming, firmware must compare its complete current flash digest with the reviewed baseline. A mismatch stops the update. The loader installation and preservation path still needs bench qualification. Keep USB connected.</p><p class="note">Completion checks the expected firmware identity and reported build digest. Full flash readback and physical hardware qualification are separate.</p><div class="actions"><button class="secondary" id="direct-common-cancel" type="button">Cancel</button><button class="primary" id="direct-common-confirm" type="button" disabled>Install reviewed firmware</button></div></dialog>`;
const trusted = event => event?.isTrusted === true;
const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const pairKey = pair => pair ? JSON.stringify([pair.inputId, pair.outputId, pair.inputName, pair.outputName]) : null;
const errorText = error => typeof error?.message === 'string' ? error.message : 'The common firmware operation could not be completed.';
const attemptSummary = record => record ? { attemptId: record.attemptId, state: record.state, phase: record.phase,
  transferFinished: record.transferFinished === true, bootIdentityVerified: record.bootIdentityVerified === true } : null;

export function mountBrowserCommonUi({ el, runtime = globalThis, updaterFactory = createCommonUpdater,
  context = () => ({ active: true, busy: false, writing: false, recoveryOther: false }),
  runExclusive = operation => operation(), beforeWrite = async () => {}, onChange = () => {}, makeId = () => runtime.crypto.randomUUID().replaceAll('-', '') } = {}) {
  let closed = false, restoring = true, inspecting = false, manifest = null, packageFile = null, inspected = null, review = null,
    epoch = 0, manifestEpoch = 0, operationStatus = null, attempt = null, progress = null, notice = '', connectionNotice = '';
  let current = { connected: false, durableReady: false, installAvailable: false, updating: false, recoveryRequired: false };
  const updater = updaterFactory({ navigator: runtime.navigator, indexedDB: runtime.indexedDB, crypto: runtime.crypto,
    locks: runtime.navigator?.locks, location: runtime.location, secureContext: runtime.isSecureContext, beforeWrite,
    onState: value => {
      if (current.connected && !value.connected) { if (notice === connectionNotice) notice = ''; connectionNotice = ''; }
      current = value; if (review && reviewKey() !== review.deviceKey) clearReview(); notify();
    },
    onEvent: value => { progress = value; notify(); } });
  const recoverable = () => Boolean(current.recoveryRequired || attempt && ['prepared', 'active', 'unknown'].includes(attempt.state) || operationStatus === 'unknown');
  const isWriting = () => operationStatus === 'running' || current.updating === true;
  const reviewKey = () => JSON.stringify([pairKey(current.pair), current.identity, current.capabilities?.buildSha256, current.installAvailable]);
  const writable = () => !closed && !restoring && !inspecting && !context().busy && !context().writing && context().active === true &&
    !context().recoveryOther && current.connected === true && current.durableReady === true && current.installAvailable === true && !recoverable();
  const filesAllowed = () => !closed && !context().busy && !context().writing && !isWriting();
  function clearReview() { review = null; el('direct-common-dialog')?.close(); }
  function snapshot() { return { ...current, restoring, inspecting, writing: isWriting(), recoveryRequired: recoverable(),
    operationStatus, attempt: attempt && { ...attempt }, review: review && { ...review } }; }
  function notify() { if (closed) return; try { onChange(snapshot()); } catch {} paint(); }
  function paint() {
    if (closed) return;
    const writing = isWriting(), external = context(), canWrite = writable();
    el('direct-common-manifest').disabled = external.busy || external.writing || writing;
    el('direct-common-file').disabled = external.busy || external.writing || writing;
    el('direct-common-review').disabled = !canWrite || !inspected;
    el('direct-common-confirm').disabled = !canWrite || !review || review.epoch !== epoch || review.deviceKey !== reviewKey();
    el('direct-common-summary').textContent = inspecting ? 'Validating the selected build locally…' : inspected ? [inspected.manifest.targetIdentity,
      inspected.manifest.packageBytes + ' package bytes', 'Package SHA256 ' + inspected.manifest.packageSha256,
      'Target build ' + inspected.manifest.targetBuildSha256].join('\n') : 'Select the manifest and matching package. Files stay in this panel.';
    const blocked = current.connected && !current.installAvailable;
    el('direct-common-note').textContent = recoverable() ? 'The original custom update is unresolved. Keep its package and receipt for bench recovery; another update is blocked.' :
      restoring ? 'Checking local recovery storage…' : blocked ? 'Firmware MIDI is connected. Installation is unavailable in this firmware. Loader compatibility and physical update qualification are pending.' :
      external.recoveryOther ? 'Another firmware transfer is unresolved. Inspect that original attempt before reviewing a new update.' :
      !current.durableReady ? notice || 'Custom writing is disabled: durable storage and same-origin device locks must be available.' : notice ||
      (current.connected ? 'Firmware identity and capabilities are confirmed. Physical update qualification is pending.' : 'Use Connect firmware MIDI for a build with the common update interface.');
    el('direct-common-transfer').hidden = !operationStatus && !recoverable();
    if (operationStatus || recoverable()) {
      el('direct-common-transfer-status').textContent = operationStatus === 'running' ? 'Custom firmware transfer in progress' : operationStatus === 'succeeded' ?
        'Transfer finished · reboot identity and build digest verified · physical qualification pending' : recoverable() ?
        'Original transfer outcome uncertain · bench recovery required' : 'Stopped before transfer completion';
      const bar = el('direct-common-progress'); bar.hidden = !writing;
      if (Number.isFinite(progress?.progress) && progress.progress >= 0 && progress.progress <= 1) bar.value = progress.progress; else bar.removeAttribute('value');
      el('direct-common-phase').textContent = [progress?.phase ?? attempt?.phase, Number.isFinite(progress?.progress) ? Math.round(progress.progress * 100) + '% served' : null,
        attempt?.attemptId ? 'Original attempt ' + attempt.attemptId : null].filter(Boolean).join(' · ');
    }
  }
  async function initialize() {
    try { attempt = attemptSummary(await updater.initialize()); current = updater.status(); }
    catch (error) { current = { ...updater.status(), durableReady: false }; notice = errorText(error); }
    finally { restoring = false; notify(); }
  }
  async function connect() { clearReview(); await updater.connect(); current = updater.status();
    if (!current.connected) throw new Error('Firmware MIDI disconnected before its identity could be confirmed.');
    notice = current.installAvailable ?
    'Common firmware identity confirmed. Select the exact build files for review; physical qualification remains pending.' :
    'Common firmware identity confirmed; installation is unavailable in this build.'; connectionNotice = notice; notify(); }
  async function disconnect() { clearReview(); await updater.disconnect(); current = updater.status(); notify(); }
  async function refresh() {
    try { await updater.probe(); current = updater.status(); notify(); }
    catch (error) { current = updater.status(); notice = errorText(error); notify(); throw error; }
  }
  async function inspect() {
    const ticket = ++epoch; clearReview(); inspected = null;
    if (!manifest || !packageFile) { inspecting = false; notify(); return; }
    inspecting = true; notify();
    try {
      const result = await updater.inspectPackage(packageFile, manifest);
      if (closed || ticket !== epoch) return;
      const safeManifest = validateManifest(result?.manifest);
      if (JSON.stringify(safeManifest) !== JSON.stringify(manifest)) throw new Error('The common package manifest changed during validation.');
      inspected = { manifest: safeManifest }; notice = 'Common firmware package validated locally. No device write.';
    } catch (error) { if (ticket === epoch) notice = errorText(error); throw error; }
    finally { if (ticket === epoch) inspecting = false; notify(); }
  }
  async function selectManifest(file) {
    if (!filesAllowed()) return; const ticket = ++manifestEpoch; ++epoch; clearReview(); manifest = null; inspected = null; inspecting = false; notify();
    if (!file) return;
    try {
      if (typeof file.name !== 'string' || !file.name.toLowerCase().endsWith('.json') || !Number.isInteger(file.size) || file.size <= 0 || file.size > 16384 || typeof file.text !== 'function') throw new Error('Select a build manifest JSON file smaller than 16 KiB.');
      const value = validateManifest(JSON.parse(await file.text())); if (closed || ticket !== manifestEpoch) return;
      manifest = value; await inspect();
    } catch (error) { if (ticket === manifestEpoch) notice = errorText(error); notify(); throw error; }
  }
  async function selectPackage(file) {
    if (!filesAllowed()) return; ++epoch; clearReview(); packageFile = null; inspected = null; inspecting = false;
    if (file && (typeof file.name !== 'string' || !file.name.toLowerCase().endsWith('.fwsc'))) { notice = 'Select the matching common firmware .fwsc package.'; notify(); return; }
    packageFile = file ?? null; await inspect();
  }
  function stage(event) {
    if (!trusted(event) || !writable() || !inspected) return;
    const attemptId = makeId(), reviewId = makeId();
    if (!validId(attemptId) || !validId(reviewId)) throw new Error('Secure firmware transfer identifiers are unavailable.');
    review = { attemptId, reviewId, epoch, deviceKey: reviewKey() };
    el('direct-common-review-text').textContent = [inspected.manifest.targetIdentity, inspected.manifest.packageBytes + ' package bytes',
      'Package SHA256 ' + inspected.manifest.packageSha256, 'Target build ' + inspected.manifest.targetBuildSha256,
      'Required current baseline ' + inspected.manifest.baselineSha256, 'Current build ' + current.capabilities.buildSha256,
      'MIDI input: ' + current.pair.inputName, 'MIDI output: ' + current.pair.outputName, 'Original attempt ' + attemptId,
      'Loader and physical update qualification: pending'].join('\n');
    paint(); el('direct-common-dialog').showModal();
  }
  async function confirm(event) {
    if (!trusted(event) || !writable() || !review || !inspected || !packageFile || !manifest) return;
    const approved = review;
    if (approved.epoch !== epoch || approved.deviceKey !== reviewKey()) { clearReview(); paint(); throw new Error('The common firmware files or device changed. Review them again.'); }
    clearReview();
    return runExclusive(async () => {
      operationStatus = 'running'; progress = null; notice = ''; attempt = { attemptId: approved.attemptId, state: 'active', phase: 'prepared' }; notify();
      try {
        const result = await updater.update({ attemptId: approved.attemptId, reviewId: approved.reviewId, packageBytes: packageFile, manifest });
        if (result.attemptId !== approved.attemptId || result.packageSha256 !== inspected.manifest.packageSha256 || result.identity !== WIRE.commonIdentity ||
          result.buildSha256 !== inspected.manifest.targetBuildSha256 || result.transferFinished !== true || result.bootIdentityVerified !== true || result.readbackVerified !== false || result.hardwareQualified !== false)
          throw Object.assign(new Error('The common update completion proof is incomplete. Inspect its original attempt.'), { recoveryRequired: true });
        operationStatus = 'succeeded'; attempt = { ...attempt, state: 'succeeded', phase: 'done' }; notice = 'Reboot identity and build digest verified. Full flash readback and physical acceptance remain separate.';
      } catch (error) {
        current = updater.status(); const uncertain = error.recoveryRequired === true || current.recoveryRequired === true;
        operationStatus = uncertain ? 'unknown' : 'failed'; attempt = { ...attempt, state: uncertain ? 'unknown' : 'failed' }; notice = errorText(error); throw error;
      } finally {
        current = updater.status();
        try { const record = await updater.savedAttempt(); if (record) attempt = attemptSummary(record); } catch {}
        notify();
      }
    });
  }
  function cancel() { clearReview(); paint(); }
  const caught = fn => event => { if (trusted(event)) void Promise.resolve().then(() => fn(event)).catch(error => { notice = errorText(error); notify(); }); };
  el('direct-common-manifest').onchange = event => { if (trusted(event)) void selectManifest(el('direct-common-manifest').files?.[0]).catch(() => {}); };
  el('direct-common-file').onchange = event => { if (trusted(event)) void selectPackage(el('direct-common-file').files?.[0]).catch(() => {}); };
  el('direct-common-review').onclick = caught(stage);
  el('direct-common-confirm').onclick = event => { if (trusted(event)) void confirm(event).catch(() => {}); };
  el('direct-common-cancel').onclick = cancel; el('direct-common-dialog').addEventListener('cancel', cancel);
  const dispose = () => { if (closed || isWriting()) return; closed = true; clearReview(); void updater.disconnect().catch(() => {}); };
  return { initialize, connect, disconnect, refresh, paint, snapshot, selectManifest, selectPackage, stage, confirm, cancel, dispose, isWriting, recoverable,
    peekSavedAttempt: () => updater.peekSavedAttempt() };
}
