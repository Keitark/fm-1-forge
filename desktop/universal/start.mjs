import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PAYLOADS = Object.freeze({
  'win32:x64': 'win32-x64',
  'darwin:arm64': 'darwin-arm64',
  'darwin:x64': 'darwin-x64',
});

export function selectDesktopPayload({ platform = process.platform, arch = process.arch } = {}) {
  const key = `${platform}:${arch}`;
  if (!Object.hasOwn(PAYLOADS, key)) throw new Error('Unsupported FM-1 Forge desktop platform.');
  return PAYLOADS[key];
}

export async function startUniversalStdio() {
  if (process.argv.length !== 2) throw new Error('FM-1 Forge does not accept launcher arguments.');
  const target = selectDesktopPayload();
  const server = await import(new URL(`./payloads/${target}/server/index.mjs`, import.meta.url));
  if (typeof server.startStdio !== 'function') throw new Error('The FM-1 Forge desktop payload is unavailable.');
  return await server.startStdio();
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  startUniversalStdio().catch(() => {
    process.stderr.write('FM-1 Forge could not start. Verify the installed desktop package.\n');
    process.exitCode = 1;
  });
}
