import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PACKAGE_VERSION = '3.4.0-alpha.7';
export const WINDOWS_MCP_SERVER_NAME = 'fm1-forge-windows';
export const NODE_VERSION = 'v22.22.2';
export const NODE_LICENSE_SHA256 = 'c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4';
export const PINNED_BUILD_DEPENDENCIES = Object.freeze({
  '@modelcontextprotocol/server': '2.3.1', '@openai/mcp-extensions': '0.2.0',
  '@cfworker/json-schema': '4.1.1', zod: '4.2.0', esbuild: '0.28.0',
});
export const DEPENDENCY_LICENSE_OVERRIDES = Object.freeze({
  '@cfworker/json-schema@4.1.1': Object.freeze({
    file: 'cfworker-json-schema-4.1.1-LICENSE.md',
    sha256: '376944252ab78ca6b41aee44ddea8894927ee67891e77e61eb9d59af63e35094',
    source: 'https://raw.githubusercontent.com/cfworker/cfworker/%40cfworker%2Fjson-schema%404.1.1/LICENSE.md',
  }),
});
const NATIVE_PACKAGE = '@julusian/midi';
const NATIVE_VERSION = '3.8.1';
const scriptPath = fileURLToPath(import.meta.url);
const checkoutRoot = path.resolve(path.dirname(scriptPath), '../..');
const schema = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const safePackageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const prohibitedName = /^(?:\.env(?:\..*)?|\.npmrc|\.git|\.svn|credentials?|tokens?|session\.json|state\.json|launch\.json)$/i;
const licenseName = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.split(path.sep).join('/');
const json = value => JSON.stringify(value, null, 2) + '\n';
const isContained = (parent, child) => child === parent || (!path.relative(parent, child).startsWith('..' + path.sep) && path.relative(parent, child) !== '..' && !path.isAbsolute(path.relative(parent, child)));

export function windowsMcpConfiguration(serverName = WINDOWS_MCP_SERVER_NAME) {
  if (serverName !== WINDOWS_MCP_SERVER_NAME) throw new Error('Windows MCP server key must remain fm1-forge-windows');
  return { $schema: schema, mcpServers: { [serverName]: {
    type: 'stdio', command: './runtime/win32-x64/node.exe',
    args: ['${PLUGIN_ROOT}/server/index.mjs'], cwd: '${PLUGIN_ROOT}',
  } } };
}

export function stageManifest(source, legacy = false) {
  const staged = structuredClone(source);
  if (staged.name !== 'fm1-app-library') throw new Error('Unexpected source plugin identity');
  staged.version = PACKAGE_VERSION;
  staged.description = 'Native Windows MIDI, reviewed stock and custom FWSC SysEx updates, and local firmware-project configuration. USB serial and UBOOT writes remain unavailable.';
  const presentation = legacy ? staged.interface : staged.extensions?.['com.openai']?.interface;
  if (!presentation || typeof presentation !== 'object') throw new Error('Missing source plugin interface');
  presentation.displayName = 'FM-1 Forge Windows';
  presentation.shortDescription = 'Windows MIDI and FWSC updates';
  presentation.longDescription = 'A self-contained Windows x64 preview with a bundled runtime and native MIDI component. Connect FM-1 through native MIDI, review the official V15 package or a validated custom FWSC with its target build, then explicitly confirm the SysEx update. Durable original-attempt recovery prevents automatic retries after an uncertain transfer. Configure and save firmware-project drafts and settings locally. Codex starts the packaged server; no separately started helper is needed. Custom FWSC starts from stock V15 and verifies the exact Forge identity and build after reboot; subsequent common-firmware self-updates remain disabled. Raw MIDI commands, USB serial, UBOOT writes and compiler setup remain unavailable. Physical update acceptance is pending.';
  return staged;
}

export function assertRuntimeDescription(description) {
  if (description?.version !== NODE_VERSION || description?.platform !== 'win32' || description?.arch !== 'x64') {
    throw new Error('The package requires the reviewed Node v22.22.2 Windows x64 runtime');
  }
}

export function requireAbsoluteInput(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`${label} must be an explicit absolute path`);
  return path.resolve(value);
}

export function includeNativePackageFile(packageName, relative) {
  return packageName !== NATIVE_PACKAGE || !relative.startsWith('prebuilds/') || relative === 'prebuilds/midi-win32-x64' || relative.startsWith('prebuilds/midi-win32-x64/');
}

export async function assertFreshOutput(outputDirectory, temporaryRoot) {
  const output = requireAbsoluteInput(outputDirectory, 'Output directory');
  const allowed = await realpath(requireAbsoluteInput(temporaryRoot, 'Temporary root'));
  const parent = await realpath(path.dirname(output));
  if (!isContained(allowed, parent) || output === allowed) throw new Error('Output must be a new directory inside the checkout tmp directory');
  try {
    await lstat(output);
    throw new Error('Output path already exists; choose a fresh output directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return output;
}

async function regularFile(filename) {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular file: ${path.basename(filename)}`);
}

async function copyTree(source, destination, filter = () => true, relative = '') {
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Symlink cannot be packaged: ${relative || path.basename(source)}`);
  if (prohibitedName.test(path.basename(source))) throw new Error(`Private/state file cannot be packaged: ${relative}`);
  if (!filter(relative, stat)) return;
  if (stat.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of (await readdir(source)).sort()) {
      await copyTree(path.join(source, entry), path.join(destination, entry), filter, relative ? `${relative}/${entry}` : entry);
    }
  } else if (stat.isFile()) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  } else throw new Error(`Unsupported package entry: ${relative}`);
}

export async function collectNativeClosure(nodeModulesDirectory) {
  const root = await realpath(requireAbsoluteInput(nodeModulesDirectory, 'Native node_modules directory'));
  const queue = [NATIVE_PACKAGE];
  const packages = new Map();
  for (let index = 0; index < queue.length; index++) {
    const name = queue[index];
    if (!safePackageName.test(name)) throw new Error('Invalid native dependency name');
    if (packages.has(name)) continue;
    const packageRoot = path.join(root, name);
    if (!isContained(root, await realpath(packageRoot))) throw new Error('Native dependency escapes its reviewed directory');
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    if (manifest.name !== name || typeof manifest.version !== 'string') throw new Error('Invalid native dependency manifest');
    if (name === NATIVE_PACKAGE && manifest.version !== NATIVE_VERSION) throw new Error('Native MIDI dependency must be 3.8.1');
    packages.set(name, { name, version: manifest.version, license: manifest.license ?? 'UNSPECIFIED', root: packageRoot });
    // A flat, already-installed closure is intentional: never run npm or fetch packages at build/startup.
    for (const dependency of Object.keys(manifest.dependencies ?? {})) queue.push(dependency);
  }
  return [...packages.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function licenseFiles(root, depth = 0) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('A dependency license path is a symlink');
    if (entry.isFile() && licenseName.test(entry.name)) result.push(path.join(root, entry.name));
    else if (entry.isDirectory() && depth < 2 && /^(?:license|licenses|vendor|rtmidi)$/i.test(entry.name)) result.push(...await licenseFiles(path.join(root, entry.name), depth + 1));
  }
  return result.sort();
}

async function bundledPackages(metafile, root) {
  const result = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const filename = path.resolve(root, input);
    if (!slash(filename).includes('/node_modules/')) continue;
    for (let directory = path.dirname(filename); directory !== path.dirname(directory); directory = path.dirname(directory)) {
      try {
        const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
        if (manifest.name && manifest.version) {
          result.set(`${manifest.name}@${manifest.version}`, { name: manifest.name, version: manifest.version, license: manifest.license ?? 'UNSPECIFIED', root: directory });
          break;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return [...result.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function resolveDependencyLicenseFiles(dependency, overridesDirectory) {
  const files = await licenseFiles(dependency.root);
  if (files.length) return files.map(filename => ({ filename, relative: slash(path.relative(dependency.root, filename)) }));
  const override = DEPENDENCY_LICENSE_OVERRIDES[`${dependency.name}@${dependency.version}`];
  if (!override) throw new Error(`Missing redistributable license for ${dependency.name}`);
  const filename = path.join(overridesDirectory, override.file);
  await regularFile(filename);
  if (hash(await readFile(filename)) !== override.sha256) throw new Error(`Reviewed dependency license changed for ${dependency.name}`);
  return [{ filename, relative: override.file, source: override.source, sha256: override.sha256 }];
}

export async function copyCommonUpdaterNotices(root, output) {
  const sources = ['LICENSE', 'NOTICE'].map(name => ({ source: path.join(root, 'site/lib/browser-common', name), target: `LICENSES/fm1-common-updater/${name}` }));
  await Promise.all(sources.map(({ source }) => regularFile(source)));
  await mkdir(path.join(output, 'LICENSES/fm1-common-updater'), { recursive: true });
  for (const { source, target } of sources) await copyFile(source, path.join(output, target), constants.COPYFILE_EXCL);
  return { name: 'fm1-common-updater', version: 'source', license: 'Apache-2.0', files: sources.map(({ target }) => target),
    sourceFiles: sources.map(({ source }) => slash(path.relative(root, source))) };
}

async function writeDependencyNotices(packages, output, overridesDirectory, additionalNotices = []) {
  const notices = [...additionalNotices];
  for (const dependency of packages) {
    const files = await resolveDependencyLicenseFiles(dependency, overridesDirectory);
    const targets = [];
    for (const { filename, relative } of files) {
      const target = path.join('LICENSES', `${dependency.name.replaceAll('/', '__')}@${dependency.version}`, relative);
      await mkdir(path.dirname(path.join(output, target)), { recursive: true });
      await copyFile(filename, path.join(output, target), constants.COPYFILE_EXCL);
      targets.push(slash(target));
    }
    notices.push({ name: dependency.name, version: dependency.version, license: dependency.license, files: targets,
      ...files.some(file => file.source) ? { upstreamLicenseSources: files.filter(file => file.source).map(({ source, sha256 }) => ({ source, sha256 })) } : {} });
  }
  await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.json'), json(notices), { flag: 'wx' });
  return notices;
}

export async function packageFileHashes(directory, relative = '') {
  const result = [];
  for (const entry of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Package must not contain a symlink: ${name}`);
    if (prohibitedName.test(entry.name)) throw new Error(`Package contains private/state material: ${name}`);
    if (entry.isDirectory()) result.push(...await packageFileHashes(directory, name));
    else if (entry.isFile()) {
      const bytes = await readFile(path.join(directory, name));
      if (/\.(?:json|mjs|js|md|html|ps1|txt|svg)$/i.test(name)) {
        const text = bytes.toString('utf8');
        if (/(?:[A-Z]:[\\/]+(?:Users|dev)[\\/]+)|(?:ghp_[A-Za-z0-9]{30,})|(?:sk-(?:proj-)?[A-Za-z0-9_-]{35,})/.test(text)) {
          throw new Error(`Package contains a local path or credential-shaped value: ${name}`);
        }
      }
      result.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
    } else throw new Error(`Package contains a special file: ${name}`);
  }
  return result;
}

function cleanRuntimeEnvironment() {
  return Object.fromEntries(Object.entries({ SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: '' }).filter(([, value]) => value != null));
}

function runNode(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true, shell: false, env: cleanRuntimeEnvironment(), timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Reviewed runtime check failed: ${result.error?.message ?? result.stderr.trim()}`);
  return JSON.parse(result.stdout.trim());
}

export async function buildWindowsPackage(options) {
  const root = options.checkoutRoot ?? checkoutRoot;
  const output = await assertFreshOutput(options.outputDirectory, path.join(root, 'tmp'));
  const nodeExecutable = requireAbsoluteInput(options.nodeExecutable, 'Node executable');
  const nodeLicense = requireAbsoluteInput(options.nodeLicensePath, 'Node license');
  const siteModules = requireAbsoluteInput(options.siteNodeModules ?? path.join(root, 'site/node_modules'), 'Site node_modules');
  const nativeModules = requireAbsoluteInput(options.nativeNodeModules ?? path.join(root, 'tools/jieli-wl82/stock-sysex/node_modules'), 'Native node_modules');
  await Promise.all([regularFile(nodeExecutable), regularFile(nodeLicense), regularFile(path.join(root, 'desktop/server.mjs'))]);
  const runtime = runNode(nodeExecutable, ['-p', 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'], root);
  assertRuntimeDescription(runtime);
  const licenseText = await readFile(nodeLicense, 'utf8');
  if (hash(licenseText) !== NODE_LICENSE_SHA256) throw new Error('Provide the complete reviewed Node.js v22.22.2 license without changing its bytes');
  for (const [name, version] of Object.entries(PINNED_BUILD_DEPENDENCIES)) {
    const actual = JSON.parse(await readFile(path.join(siteModules, name, 'package.json'), 'utf8'));
    if (actual.version !== version) throw new Error(`Build input ${name} must be pinned to ${version}`);
  }
  const nativePackages = await collectNativeClosure(nativeModules);
  const require = createRequire(path.join(siteModules, '../package.json'));
  const { build } = require('esbuild');
  const sourcePlugin = path.join(root, 'plugin/fm1-app-library');
  const manifest = JSON.parse(await readFile(path.join(sourcePlugin, 'plugin.json'), 'utf8'));
  const sourceMcp = JSON.parse(await readFile(path.join(sourcePlugin, 'mcp.json'), 'utf8'));
  const names = Object.keys(sourceMcp.mcpServers ?? {});
  if (names.length !== 1) throw new Error('Source plugin must declare one reviewed MCP server');
  if (names.includes(WINDOWS_MCP_SERVER_NAME)) throw new Error('Windows MCP server key must be distinct from the hosted source server');
  const { WINDOWS_UI_HTML: UI_HTML } = await import(pathToFileURL(path.join(root, 'site/lib/fm1-ui.mjs')).href);
  if (typeof UI_HTML !== 'string' || UI_HTML.length < 1000 || !UI_HTML.includes('const desktopMode=true;')) throw new Error('Windows panel HTML is unavailable');
  // Atomic ownership claim: never delete/reuse a pre-existing output, including a partial earlier build.
  await mkdir(output);
  await mkdir(path.join(output, 'server'));
  await mkdir(path.join(output, 'runtime/win32-x64'), { recursive: true });
  await mkdir(path.join(output, 'LICENSES'));
  for (const name of ['assets', 'skills']) await copyTree(path.join(sourcePlugin, name), path.join(output, name));
  // The source skills are retained; override their instructions only in this Windows edition.
  const skillOverrides = path.join(root, 'desktop/plugin/skills');
  for (const skill of await readdir(skillOverrides)) {
    await regularFile(path.join(skillOverrides, skill, 'SKILL.md'));
    await writeFile(path.join(output, 'skills', skill, 'SKILL.md'), await readFile(path.join(skillOverrides, skill, 'SKILL.md')));
  }
  await writeFile(path.join(output, 'plugin.json'), json(stageManifest(manifest)), { flag: 'wx' });
  await mkdir(path.join(output, '.codex-plugin'));
  const legacy = JSON.parse(await readFile(path.join(sourcePlugin, '.codex-plugin/plugin.json'), 'utf8'));
  await writeFile(path.join(output, '.codex-plugin/plugin.json'), json(stageManifest(legacy, true)), { flag: 'wx' });
  const mcp = json(windowsMcpConfiguration());
  await writeFile(path.join(output, 'mcp.json'), mcp, { flag: 'wx' });
  await writeFile(path.join(output, '.mcp.json'), mcp, { flag: 'wx' });
  await writeFile(path.join(output, 'server/panel.html'), UI_HTML, { flag: 'wx' });
  await copyFile(path.join(root, 'tools/jieli-wl82/stock-sysex/windows-midi-inventory.ps1'), path.join(output, 'server/windows-midi-inventory.ps1'), constants.COPYFILE_EXCL);
  await copyFile(nodeExecutable, path.join(output, 'runtime/win32-x64/node.exe'), constants.COPYFILE_EXCL);
  await copyFile(nodeLicense, path.join(output, 'LICENSES/Node.js-LICENSE'), constants.COPYFILE_EXCL);
  const commonUpdaterNotice = await copyCommonUpdaterNotices(root, output);
  for (const dependency of nativePackages) {
    await copyTree(dependency.root, path.join(output, 'node_modules', dependency.name), relative => includeNativePackageFile(dependency.name, relative));
  }
  const bundled = await build({
    absWorkingDir: root, entryPoints: ['desktop/server.mjs'], outfile: path.join(output, 'server/index.mjs'),
    bundle: true, format: 'esm', platform: 'node', target: 'node22.22',
    nodePaths: [siteModules, nativeModules], external: [NATIVE_PACKAGE], metafile: true,
    legalComments: 'linked', banner: { js: "import { createRequire as __fm1CreateRequire } from 'node:module'; const require = __fm1CreateRequire(import.meta.url);" },
    logLevel: 'silent',
  });
  const dependencies = new Map();
  for (const dependency of [...await bundledPackages(bundled.metafile, root), ...nativePackages]) dependencies.set(`${dependency.name}@${dependency.version}`, dependency);
  const notices = await writeDependencyNotices([...dependencies.values()], output, path.join(root, 'desktop/licenses'), [commonUpdaterNotice]);
  const packagedNode = path.join(output, 'runtime/win32-x64/node.exe');
  const loaded = runNode(packagedNode, ['--input-type=module', '-e', "const m=await import('@julusian/midi');const a=m.default??m;if(typeof a.Input!=='function'||typeof a.Output!=='function')throw Error('MIDI native addon failed to load');console.log(JSON.stringify({loaded:true,version:process.version,platform:process.platform,arch:process.arch,napi:process.versions.napi}));"], output);
  assertRuntimeDescription(loaded);
  if (loaded.loaded !== true || Number(loaded.napi) < 7) throw new Error('Native MIDI N-API verification failed');
  const sourceFiles = Object.keys(bundled.metafile.inputs).filter(input => !slash(input).includes('node_modules/')).map(input => path.resolve(root, input));
  sourceFiles.push(path.join(root, 'site/lib/fm1-ui.mjs'), scriptPath, path.join(root, 'desktop/package.json'));
  sourceFiles.push(...Object.values(DEPENDENCY_LICENSE_OVERRIDES).map(override => path.join(root, 'desktop/licenses', override.file)));
  sourceFiles.push(...['LICENSE', 'NOTICE'].map(name => path.join(root, 'site/lib/browser-common', name)));
  const sources = [];
  for (const filename of [...new Set(sourceFiles)].sort()) {
    if (!isContained(root, filename)) throw new Error('Source path is outside the source checkout');
    sources.push({ path: slash(path.relative(root, filename)), sha256: hash(await readFile(filename)) });
  }
  const report = {
    format: 'fm1-forge-windows-package-v1', version: PACKAGE_VERSION,
    platform: 'win32', arch: 'x64', runtime: { ...runtime, sha256: hash(await readFile(nodeExecutable)), licenseSha256: hash(await readFile(nodeLicense)),
      distributionReference: 'https://nodejs.org/dist/v22.22.2/', licenseReference: 'https://github.com/nodejs/node/blob/v22.22.2/LICENSE' },
    nativeLoadCheck: { ...loaded, enumeratedPorts: false, openedDevice: false },
    dependencies: notices, sources, panelSha256: hash(UI_HTML),
    files: await packageFileHashes(output),
    fileHashScope: 'Every packaged file except BUILD-MANIFEST.json itself.',
  };
  await writeFile(path.join(output, 'BUILD-MANIFEST.json'), json(report), { flag: 'wx' });
  return { outputDirectory: output, version: PACKAGE_VERSION, files: report.files.length + 1, runtime: runtime.version, nativeAddonLoaded: true, deviceOpened: false };
}

export function parseArguments(args) {
  const result = {};
  const fields = { '--out': 'outputDirectory', '--node': 'nodeExecutable', '--node-license': 'nodeLicensePath', '--site-node-modules': 'siteNodeModules', '--native-node-modules': 'nativeNodeModules' };
  for (let index = 0; index < args.length; index++) {
    const field = fields[args[index]];
    if (!field || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Use --out ABSOLUTE_NEW_TMP_DIR --node ABSOLUTE_NODE_EXE --node-license ABSOLUTE_NODE_LICENSE');
    if (result[field]) throw new Error('Duplicate build argument');
    result[field] = args[++index];
  }
  for (const field of ['outputDirectory', 'nodeExecutable', 'nodeLicensePath']) requireAbsoluteInput(result[field], field);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try { console.log(json(await buildWindowsPackage(parseArguments(process.argv.slice(2)))).trim()); }
  catch (error) { console.error(`Windows package build stopped: ${error.message}`); process.exitCode = 1; }
}
