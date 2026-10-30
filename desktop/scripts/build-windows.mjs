import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNativePackage, getPackageTarget, parseArguments } from './build-native.mjs';
export * from './build-native.mjs';

export function buildWindowsPackage(options) {
  return buildNativePackage(options, getPackageTarget());
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try { console.log(JSON.stringify(await buildWindowsPackage(parseArguments(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(`Windows package build stopped: ${error.message}`); process.exitCode = 1; }
}
