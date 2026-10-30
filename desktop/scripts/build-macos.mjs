import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNativePackage, getPackageTarget, assertRuntimeDescription, includeNativePackageFile, nativeMcpConfiguration, parseArguments, stageManifest } from './build-native.mjs';
export { PACKAGE_VERSION, MACOS_MCP_SERVER_NAME, NODE_VERSION, NODE_LICENSE_SHA256 } from './build-native.mjs';

function requireMacosArch(arch) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error('macOS package architecture must be arm64 or x64');
  return arch;
}

export function macosMcpConfiguration(arch, serverName) {
  requireMacosArch(arch);
  return nativeMcpConfiguration(getPackageTarget('darwin', arch), serverName);
}
export function stageMacosManifest(source, legacy = false, arch = 'arm64') {
  return stageManifest(source, legacy, getPackageTarget('darwin', arch));
}
export function assertMacosRuntimeDescription(description, arch) {
  return assertRuntimeDescription(description, getPackageTarget('darwin', requireMacosArch(arch)));
}
export function includeMacosNativePackageFile(packageName, relative, arch) {
  return includeNativePackageFile(packageName, relative, getPackageTarget('darwin', requireMacosArch(arch)));
}
export function parseMacosArguments(args) {
  return parseArguments(args, { macos: true });
}
export function buildMacosPackage(options) {
  requireMacosArch(options?.arch);
  return buildNativePackage(options, getPackageTarget('darwin', options.arch));
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try { console.log(JSON.stringify(await buildMacosPackage(parseMacosArguments(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(`macOS package build stopped: ${error.message}`); process.exitCode = 1; }
}
