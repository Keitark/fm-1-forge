// SPDX-License-Identifier: MIT
// Closed Windows CDC/UBOOT adapter, privately owned by the Forge coordinator.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { StockError } from '../stock-sysex/protocol.mjs';
import { planApplication } from './policy.mjs';

const exec = promisify(execFile);
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const fail = (code, message = 'The CDC/UBOOT operation stopped. Preserve the original job and recovery evidence.') => new StockError(code, message);
const sidecar = name => {
  const local = fileURLToPath(new URL(`./${name}`, import.meta.url));
  return existsSync(local) ? local : fileURLToPath(new URL(`./cdc-uboot/${name}`, import.meta.url));
};
const powershell = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
export function validateCdcSource(source) {
  if (!source || source.identity !== 'MOD-EDITOR/1' || source.transport !== 'cdc' || source.nonceVerified !== true ||
      !['build_sha256', 'location_sha256', 'instance_sha256'].every(key => hex(source[key])) || source.build_sha256 === '0'.repeat(64)) throw fail('cdc_identity_mismatch');
  return Object.freeze(Object.fromEntries(['identity','transport','build_sha256','location_sha256','instance_sha256','nonceVerified'].map(key => [key, source[key]])));
}
export async function inspectTrackerCdc({ platform = process.platform, run = exec, random = randomBytes, signal, timeoutMs = 20000 } = {}) {
  if (platform !== 'win32') throw fail('unsupported_transport', 'The native CDC updater is available on Windows only.');
  const nonce = Buffer.from(random(16)).toString('hex');
  if (!/^[0-9a-f]{32}$/.test(nonce)) throw fail('invalid_challenge');
  let value;
  try {
    const result = await run(powershell(), ['-NoLogo','-NoProfile','-NonInteractive','-File',sidecar('windows-cdc-link.ps1'),'-Inspect','-Nonce',nonce], {windowsHide:true,shell:false,timeout:Math.max(1,Math.min(20000,timeoutMs)),maxBuffer:8192,encoding:'utf8',signal});
    if (typeof result.stdout !== 'string' || result.stdout.length > 4096) throw fail('cdc_identity_mismatch');
    value = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
  } catch { throw fail('cdc_inspection_failed', 'No unique tracker USB serial connection answered the fixed identity challenge.'); }
  if (value?.nonce !== nonce) throw fail('cdc_identity_mismatch');
  return validateCdcSource(value);
}

export function createCdcBootVerifier({platform = process.platform, inspect = inspectTrackerCdc, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve,ms))} = {}) {
  if (platform !== 'win32') return null;
  return async ({buildSha256,source,timeoutMs = 40000,signal} = {}) => {
    source = validateCdcSource(source);
    if (!hex(buildSha256) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 40000) throw fail('invalid_package');
    const deadline = now() + timeoutMs;
    while (!signal?.aborted && now() < deadline) {
      let proof;
      try { proof = await inspect({platform,signal,timeoutMs:Math.min(20000,deadline-now())}); }
      catch (error) { if (signal?.aborted || now() >= deadline) throw fail('reboot_timeout'); await sleep(Math.min(250,Math.max(1,deadline-now()))); continue; }
      proof = validateCdcSource(proof);
      if (now() >= deadline || signal?.aborted) throw fail('reboot_timeout');
      if (proof.location_sha256 !== source.location_sha256) throw fail('device_changed');
      if (proof.build_sha256 !== buildSha256) throw fail('boot_build_mismatch');
      return Object.freeze({text:'MOD-EDITOR/1',buildSha256,transport:'cdc',nonceVerified:true});
    }
    throw fail('reboot_timeout');
  };
}

export async function createCdcUbootTransport({ application, targetBuildSha256, source, onProgress = () => {}, platform = process.platform, spawnChild = spawn, timeoutMs = 600000 } = {}) {
  if (platform !== 'win32') throw fail('unsupported_transport');
  source = validateCdcSource(source);
  if (!(application instanceof Uint8Array) || application.length < 1024 || application.length > 581564 || !hex(targetBuildSha256) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw fail('invalid_package');
  const frozenApp = Uint8Array.from(application);
  const child = spawnChild(powershell(), ['-NoLogo','-NoProfile','-NonInteractive','-File',sidecar('windows-cdc-relay.ps1')], {windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  let pending = null, buffered = '', broken = false, stopped = false, expectedPlan = null, ready = false, queue = Promise.resolve(), closePromise = null;
  const rejectPending = error => { if (pending) { const p = pending; pending = null; clearTimeout(p.timer); p.reject(error); } };
  const poison = () => { broken = true; rejectPending(fail('cdc_worker_lost')); child.kill(); };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    if (broken) return;
    buffered += chunk;
    if (buffered.length > 1500000) { poison(); return; }
    for (;;) {
      const newline = buffered.indexOf('\n'); if (newline < 0) break;
      const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
      let answer; try { answer = JSON.parse(line.replace(/^\uFEFF/, '')); } catch { poison(); return; }
      if (!pending || !answer || typeof answer.ok !== 'boolean') { poison(); return; }
      const p = pending; pending = null; clearTimeout(p.timer);
      if (answer.ok) p.resolve(answer.data);
      else p.reject(fail(answer.code === 'cdc_operation_stopped' ? answer.code : 'cdc_worker_unavailable'));
    }
  });
  // Never forward arbitrary privileged stderr, device identifiers or dumps.
  child.stderr.on('data', () => {});
  child.on('error', poison);
  child.on('exit', () => { if (!stopped) { broken = true; rejectPending(fail('cdc_worker_lost')); } });
  const waitAnswer = () => new Promise((resolve, reject) => {
    if (broken || pending) { reject(fail('cdc_worker_lost')); return; }
    const timer = setTimeout(poison, timeoutMs); pending = {resolve,reject,timer};
  });
  const send = async value => {
    if (broken || stopped) throw fail('cdc_worker_lost');
    const response = waitAnswer();
    child.stdin.write(`${JSON.stringify(value)}\n`, error => { if (error) poison(); });
    return response;
  };
  const serialized = action => { const result = queue.then(action); queue = result.catch(() => {}); return result; };
  try {
    onProgress({phase:'elevation'});
    const response = await send({application:Buffer.from(frozenApp).toString('base64'),target:targetBuildSha256,source});
    if (response?.ready !== true || !/^[0-9a-f]{32}$/.test(response.session_id ?? '')) throw fail('worker_handshake_invalid');
    ready = true;
  } catch (error) { child.kill(); throw error; }
  const request = (op, candidate = '') => send({op,candidate_sha256:candidate});
  const close = () => {
    if (closePromise) return closePromise;
    closePromise = serialized(async () => {
      if (stopped) return;
      if (!ready || broken) throw fail('worker_shutdown_unproven');
      const result = await request('close');
      if (result?.closed !== true || result.worker_stopped !== true) throw fail('worker_shutdown_unproven');
      stopped = true; child.stdin.end();
    });
    return closePromise;
  };
  return Object.freeze({
    prepare: () => serialized(async () => {
      if (expectedPlan) throw fail('prepare_consumed');
      onProgress({phase:'reading_baseline'});
      const response = await request('prepare');
      if (typeof response?.baseline_base64 !== 'string' || response.baseline_base64.length !== 1398104 || !/^[A-Za-z0-9+/]+={0,2}$/.test(response.baseline_base64) || !hex(response.worker_receipt_sha256)) throw fail('worker_receipt_invalid');
      const baseline = Uint8Array.from(Buffer.from(response.baseline_base64, 'base64'));
      if (baseline.length !== 1048576) throw fail('worker_receipt_invalid');
      expectedPlan = planApplication(baseline, frozenApp, targetBuildSha256);
      if (response.baseline_sha256 !== expectedPlan.baseline_sha256 || response.candidate_sha256 !== expectedPlan.candidate_sha256 || JSON.stringify(response.sectors) !== JSON.stringify(expectedPlan.sectors)) throw fail('worker_plan_mismatch');
      return {baseline,baseline_sha256:response.baseline_sha256,candidate_sha256:response.candidate_sha256,sectors:[...response.sectors],worker_receipt_sha256:response.worker_receipt_sha256};
    }),
    install: ({plan,recover = false} = {}) => serialized(async () => {
      if (!expectedPlan || typeof recover !== 'boolean' || plan?.candidate_sha256 !== expectedPlan.candidate_sha256 || plan.baseline_sha256 !== expectedPlan.baseline_sha256 || JSON.stringify(plan.sectors) !== JSON.stringify(expectedPlan.sectors)) throw fail('review_changed');
      onProgress({phase:recover?'recovering':'writing'});
      const result = await request(recover?'recover':'install',expectedPlan.candidate_sha256);
      if (result?.readback_verified !== true || result.candidate_sha256 !== expectedPlan.candidate_sha256 || !Number.isSafeInteger(result.mutation_attempts) || result.mutation_attempts < 0) throw fail('worker_receipt_invalid');
      return result;
    }),
    resetVerified: () => serialized(async () => {
      if (!expectedPlan) throw fail('not_prepared');
      const result = await request('reset',expectedPlan.candidate_sha256);
      if (result?.reset_requested !== true || result.worker_stopped !== true) throw fail('worker_shutdown_unproven');
      stopped = true; child.stdin.end(); return result;
    }),
    close,
  });
}
