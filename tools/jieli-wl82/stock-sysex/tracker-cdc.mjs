// SPDX-License-Identifier: MIT
// Fixed read-only tracker boot proof. No arbitrary serial commands or port input.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { StockError } from './protocol.mjs';

const exec = promisify(execFile);
const hex = (value, size) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${size}}$`).test(value);
export function trackerCdcProof(value, buildSha256, nonce) {
  if (!value || value.identity !== 'MOD-EDITOR/1' || value.transport !== 'cdc' ||
      value.vid !== '3654' || value.pid !== '5155' || !/^COM[1-9][0-9]{0,4}$/.test(value.port ?? '') ||
      !hex(buildSha256, 64) || !hex(nonce, 32) || value.nonce !== nonce) {
    throw new StockError('boot_identity_mismatch', 'The tracker CDC challenge did not match the intended firmware.');
  }
  if (value.build_sha256 !== buildSha256) throw new StockError('boot_build_mismatch', 'The running tracker differs from the reviewed build.');
  return Object.freeze({ text: value.identity, buildSha256, transport: 'cdc', nonceVerified: true });
}

export function createTrackerVerifier({ platform = process.platform, run = exec, random = randomBytes,
  script = fileURLToPath(new URL('./windows-tracker-cdc.ps1', import.meta.url)), systemRoot = process.env.SystemRoot ?? 'C:\\Windows' } = {}) {
  if (platform !== 'win32') return null;
  return async ({ buildSha256, timeoutMs = 40000, signal } = {}) => {
    if (!hex(buildSha256, 64) || buildSha256 === '0'.repeat(64) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 40000) {
      throw new StockError('invalid_package', 'A reviewed tracker build is required for CDC verification.');
    }
    const nonce = Buffer.from(random(16)).toString('hex');
    if (!hex(nonce, 32)) throw new StockError('boot_identity_mismatch', 'A fresh tracker challenge could not be created.');
    let result;
    try {
      result = await run(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-BuildSha256', buildSha256, '-Nonce', nonce, '-TimeoutMs', String(timeoutMs)],
        { windowsHide: true, shell: false, timeout: timeoutMs + 3000, maxBuffer: 8192, encoding: 'utf8', signal });
    } catch (error) {
      const code = /\b(ambiguous_device|boot_build_mismatch|cdc_busy|reboot_timeout)\b/.exec(String(error.stderr ?? ''))?.[1];
      throw new StockError(code ?? 'cdc_verification_failed', 'Tracker CDC boot verification did not complete. Keep the original attempt for verification or recovery.');
    }
    if (typeof result?.stdout !== 'string' || result.stdout.length > 4096) throw new StockError('boot_identity_mismatch', 'Invalid tracker CDC proof.');
    let value; try { value = JSON.parse(result.stdout.replace(/^\uFEFF/, '')); } catch { throw new StockError('boot_identity_mismatch', 'Invalid tracker CDC proof.'); }
    return trackerCdcProof(value, buildSha256, nonce);
  };
}
