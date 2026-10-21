import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function readWindowsMetadata(timeoutMs = 10000) {
  if (process.platform !== 'win32') return null;
  const script = fileURLToPath(new URL('./windows-midi-inventory.ps1', import.meta.url));
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    const { stdout } = await exec(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, timeout: Math.max(1, Math.min(10000, Math.floor(timeoutMs))), maxBuffer: 262144 });
    const records = JSON.parse(stdout.trim());
    if (!Array.isArray(records) || records.length > 512) return null;
    return records;
  } catch { return null; }
}
