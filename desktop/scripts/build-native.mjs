import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveDesktopPlatform } from '../lib/platform.mjs';

export const PACKAGE_VERSION = '3.4.0-alpha.14';
export const WINDOWS_MCP_SERVER_NAME = 'fm1-forge-windows';
export const MACOS_MCP_SERVER_NAME = 'fm1-forge-macos';
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

export function getPackageTarget(platform = 'win32', arch = 'x64') {
  const desktop = resolveDesktopPlatform({ platform, arch });
  return Object.freeze({ ...desktop,
    serverName: platform === 'win32' ? WINDOWS_MCP_SERVER_NAME : MACOS_MCP_SERVER_NAME,
    runtimeRelative: `runtime/${platform}-${arch}/${platform === 'win32' ? 'node.exe' : 'node'}`,
    skillOverrides: platform === 'win32' ? 'desktop/plugin/skills' : 'desktop/plugin-macos/skills',
    format: platform === 'win32' ? 'fm1-forge-windows-package-v1' : 'fm1-forge-macos-package-v1',
  });
}

function checkedTarget(target) {
  if (!target || typeof target !== 'object') throw new Error('Choose a supported native package target');
  const expected = getPackageTarget(target.platform, target.arch);
  for (const field of ['serverName', 'runtimeRelative', 'skillOverrides', 'format', 'name', 'label', 'uiExport']) {
    if (target[field] !== expected[field]) throw new Error('Native package target metadata changed');
  }
  return expected;
}

export function nativeMcpConfiguration(target, serverName = target?.serverName) {
  target = checkedTarget(target);
  if (serverName !== target.serverName) throw new Error(`${target.label} MCP server key must remain ${target.serverName}`);
  return { $schema: schema, mcpServers: { [serverName]: {
    type: 'stdio', command: `./${target.runtimeRelative}`,
    args: ['${PLUGIN_ROOT}/server/index.mjs'], cwd: '${PLUGIN_ROOT}',
  } } };
}

export function windowsMcpConfiguration(serverName = WINDOWS_MCP_SERVER_NAME) {
  return nativeMcpConfiguration(getPackageTarget(), serverName);
}

export function stageManifest(source, legacy = false, target = getPackageTarget()) {
  target = checkedTarget(target);
  const staged = structuredClone(source);
  if (staged.name !== 'fm1-app-library') throw new Error('Unexpected source plugin identity');
  staged.version = PACKAGE_VERSION;
  staged.description = `Native ${target.label} MIDI, reviewed stock and custom FWSC SysEx updates, and local firmware-project configuration. USB serial and UBOOT writes remain unavailable.`;
  const presentation = legacy ? staged.interface : staged.extensions?.['com.openai']?.interface;
  if (!presentation || typeof presentation !== 'object') throw new Error('Missing source plugin interface');
  presentation.displayName = target.name;
  presentation.shortDescription = `${target.label} MIDI and FWSC updates`;
  presentation.longDescription = `A self-contained ${target.label} ${target.arch} preview with a bundled runtime and native MIDI component. Connect FM-1 through native MIDI, review the official V15 package or a validated custom FWSC with its target build, then explicitly confirm the SysEx update. Durable original-attempt recovery prevents automatic retries after an uncertain transfer. Configure and save firmware-project drafts and settings locally. Codex starts the packaged server; no separately started helper is needed. Custom FWSC starts from stock V15 and verifies the exact profile identity and build after reboot (Forge MIDI, or tracker CDC on Windows); subsequent common-firmware self-updates remain disabled. Raw MIDI commands, USB serial, UBOOT writes and compiler setup remain unavailable. Physical update acceptance is pending.`;
  return staged;
}

export function assertRuntimeDescription(description, target = getPackageTarget()) {
  target = checkedTarget(target);
  if (description?.version !== NODE_VERSION || description?.platform !== target.platform || description?.arch !== target.arch) {
    throw new Error(`The package requires the reviewed Node v22.22.2 ${target.label} ${target.arch} runtime; cross-building is not supported`);
  }
}

export function requireAbsoluteInput(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`${label} must be an explicit absolute path`);
  return path.resolve(value);
}

export function includeNativePackageFile(packageName, relative, target = getPackageTarget()) {
  target = checkedTarget(target);
  const prebuild = `prebuilds/midi-${target.platform}-${target.arch}`;
  return packageName !== NATIVE_PACKAGE || !relative.startsWith('prebuilds/') || relative === prebuild || relative.startsWith(`${prebuild}/`);
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

export async function packageFileHashes(directory, relative = '', { includeModes = false } = {}) {
  const result = [];
  for (const entry of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Package must not contain a symlink: ${name}`);
    if (prohibitedName.test(entry.name)) throw new Error(`Package contains private/state material: ${name}`);
    if (entry.isDirectory()) result.push(...await packageFileHashes(directory, name, { includeModes }));
    else if (entry.isFile()) {
      const bytes = await readFile(path.join(directory, name));
      if (/\.(?:json|mjs|js|md|html|ps1|txt|svg)$/i.test(name)) {
        const text = bytes.toString('utf8');
        if (/(?:[A-Z]:[\\/]+(?:Users|dev)[\\/]+)|(?:ghp_[A-Za-z0-9]{30,})|(?:sk-(?:proj-)?[A-Za-z0-9_-]{35,})/.test(text) || /\/(?:Users|home)\/[^/\s"'\\]+[\/]/.test(text)) {
          throw new Error(`Package contains a local path or credential-shaped value: ${name}`);
        }
      }
      result.push({ path: name, bytes: bytes.length, sha256: hash(bytes), ...(includeModes ? { mode: (await lstat(path.join(directory, name))).mode & 0o777 } : {}) });
    } else throw new Error(`Package contains a special file: ${name}`);
  }
  return result;
}

function cleanRuntimeEnvironment() {
  return Object.fromEntries(Object.entries({ TMPDIR: process.env.TMPDIR, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: '' }).filter(([, value]) => value != null));
}

function runNode(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true, shell: false, env: cleanRuntimeEnvironment(), timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Reviewed runtime check failed: ${result.error?.message ?? result.stderr.trim()}`);
  return JSON.parse(result.stdout.trim());
}

export async function buildNativePackage(options, target) {
  target = checkedTarget(target);
  const root = options.checkoutRoot ?? checkoutRoot;
  const output = await assertFreshOutput(options.outputDirectory, path.join(root, 'tmp'));
  const nodeExecutable = requireAbsoluteInput(options.nodeExecutable, 'Node executable');
  const nodeLicense = requireAbsoluteInput(options.nodeLicensePath, 'Node license');
  const siteModules = requireAbsoluteInput(options.siteNodeModules ?? path.join(root, 'site/node_modules'), 'Site node_modules');
  const nativeModules = requireAbsoluteInput(options.nativeNodeModules ?? path.join(root, 'tools/jieli-wl82/stock-sysex/node_modules'), 'Native node_modules');
  await Promise.all([regularFile(nodeExecutable), regularFile(nodeLicense), regularFile(path.join(root, 'desktop/server.mjs'))]);
  const runtime = runNode(nodeExecutable, ['-p', 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'], root);
  assertRuntimeDescription(runtime, target);
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
  if (names.includes(target.serverName)) throw new Error(`${target.label} MCP server key must be distinct from the hosted source server`);
  // The generated SDK IIFE also contains the device controllers. Rebuild it
  // before rendering HTML, then use a fresh process to avoid ESM module caches.
  const panelGenerator = path.join(root, 'site/scripts/build-fm1-panel.mjs');
  const generated = spawnSync(nodeExecutable, [panelGenerator], { cwd: root, encoding: 'utf8', windowsHide: true, shell: false, env: cleanRuntimeEnvironment(), timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (generated.error || generated.status !== 0) throw new Error(`Panel runtime generation failed: ${generated.error?.message ?? generated.stderr.trim()}`);
  const UI_HTML = runNode(nodeExecutable, ['--input-type=module', '-e', `const ui=await import(${JSON.stringify(pathToFileURL(path.join(root, 'site/lib/fm1-ui.mjs')).href)});process.stdout.write(JSON.stringify(ui[${JSON.stringify(target.uiExport)}]));`], root);
  if (typeof UI_HTML !== 'string' || UI_HTML.length < 1000 || !UI_HTML.includes('const desktopMode=true;')) throw new Error(`${target.label} panel HTML is unavailable`);
  // Atomic ownership claim: never delete/reuse a pre-existing output, including a partial earlier build.
  await mkdir(output);
  await mkdir(path.join(output, 'server'));
  await mkdir(path.dirname(path.join(output, target.runtimeRelative)), { recursive: true });
  await mkdir(path.join(output, 'LICENSES'));
  for (const name of ['assets', 'skills']) await copyTree(path.join(sourcePlugin, name), path.join(output, name));
  // The hosted skills are retained; override only this native edition's instructions.
  const skillOverrides = path.join(root, target.skillOverrides);
  for (const skill of await readdir(skillOverrides)) {
    await regularFile(path.join(skillOverrides, skill, 'SKILL.md'));
    await writeFile(path.join(output, 'skills', skill, 'SKILL.md'), await readFile(path.join(skillOverrides, skill, 'SKILL.md')));
  }
  await writeFile(path.join(output, 'plugin.json'), json(stageManifest(manifest, false, target)), { flag: 'wx' });
  await mkdir(path.join(output, '.codex-plugin'));
  const legacy = JSON.parse(await readFile(path.join(sourcePlugin, '.codex-plugin/plugin.json'), 'utf8'));
  await writeFile(path.join(output, '.codex-plugin/plugin.json'), json(stageManifest(legacy, true, target)), { flag: 'wx' });
  const mcp = json(nativeMcpConfiguration(target));
  await writeFile(path.join(output, 'mcp.json'), mcp, { flag: 'wx' });
  await writeFile(path.join(output, '.mcp.json'), mcp, { flag: 'wx' });
  await writeFile(path.join(output, 'server/panel.html'), UI_HTML, { flag: 'wx' });
  if (target.platform === 'win32') for (const name of ['windows-midi-inventory.ps1', 'windows-tracker-cdc.ps1']) await copyFile(path.join(root, 'tools/jieli-wl82/stock-sysex', name), path.join(output, 'server', name), constants.COPYFILE_EXCL);
  await copyRuntimeExecutable(nodeExecutable, path.join(output, target.runtimeRelative), target);
  await copyFile(nodeLicense, path.join(output, 'LICENSES/Node.js-LICENSE'), constants.COPYFILE_EXCL);
  const commonUpdaterNotice = await copyCommonUpdaterNotices(root, output);
  for (const dependency of nativePackages) {
    await copyTree(dependency.root, path.join(output, 'node_modules', dependency.name), relative => includeNativePackageFile(dependency.name, relative, target));
  }
  const bundled = await build({
    absWorkingDir: root, entryPoints: ['desktop/server.mjs'], outfile: path.join(output, 'server/index.mjs'),
    bundle: true, format: 'esm', platform: 'node', target: 'node22.22',
    nodePaths: [siteModules, nativeModules], external: [NATIVE_PACKAGE], metafile: true,
    legalComments: 'linked', banner: { js: "import { createRequire as __fm1CreateRequire } from 'node:module'; const require = __fm1CreateRequire(import.meta.url);" },
    logLevel: 'silent',
  });
  const workerBundle = await build({
    absWorkingDir: root, entryPoints: ['desktop/lib/midi-worker.mjs'], outfile: path.join(output, 'server/midi-worker.mjs'),
    bundle: true, format: 'esm', platform: 'node', target: 'node22.22',
    nodePaths: [siteModules, nativeModules], external: [NATIVE_PACKAGE], metafile: true,
    legalComments: 'linked', banner: { js: "import { createRequire as __fm1CreateRequire } from 'node:module'; const require = __fm1CreateRequire(import.meta.url);" },
    logLevel: 'silent',
  });
  const dependencies = new Map();
  for (const dependency of [...await bundledPackages(bundled.metafile, root), ...await bundledPackages(workerBundle.metafile, root), ...nativePackages]) dependencies.set(`${dependency.name}@${dependency.version}`, dependency);
  const notices = await writeDependencyNotices([...dependencies.values()], output, path.join(root, 'desktop/licenses'), [commonUpdaterNotice]);
  const packagedNode = path.join(output, target.runtimeRelative);
  const loaded = runNode(packagedNode, ['--input-type=module', '-e', "const m=await import('@julusian/midi');const a=m.default??m;if(typeof a.Input!=='function'||typeof a.Output!=='function')throw Error('MIDI native addon failed to load');console.log(JSON.stringify({loaded:true,version:process.version,platform:process.platform,arch:process.arch,napi:process.versions.napi}));"], output);
  assertRuntimeDescription(loaded, target);
  if (loaded.loaded !== true || Number(loaded.napi) < 7) throw new Error('Native MIDI N-API verification failed');
  const panelInputs = await build({ absWorkingDir: root, entryPoints: ['site/lib/fm1-ui.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' });
  const sourceFiles = Object.keys({ ...bundled.metafile.inputs, ...workerBundle.metafile.inputs, ...panelInputs.metafile.inputs }).filter(input => !slash(input).includes('node_modules/')).map(input => path.resolve(root, input));
  sourceFiles.push(path.join(root, 'site/lib/fm1-ui.mjs'), scriptPath, ...['build-windows.mjs', 'build-macos.mjs'].map(name => path.join(root, 'desktop/scripts', name)), path.join(root, 'desktop/package.json'));
  sourceFiles.push(...await sourceTreeFiles(path.join(sourcePlugin, 'assets')), ...await sourceTreeFiles(path.join(sourcePlugin, 'skills')), ...await sourceTreeFiles(skillOverrides));
  sourceFiles.push(...['plugin.json', '.codex-plugin/plugin.json', 'mcp.json'].map(name => path.join(sourcePlugin, name)));
  sourceFiles.push(...Object.values(DEPENDENCY_LICENSE_OVERRIDES).map(override => path.join(root, 'desktop/licenses', override.file)));
  sourceFiles.push(...['LICENSE', 'NOTICE'].map(name => path.join(root, 'site/lib/browser-common', name)));
  sourceFiles.push(panelGenerator);
  if (target.platform === 'win32') sourceFiles.push(...['windows-midi-inventory.ps1', 'windows-tracker-cdc.ps1'].map(name => path.join(root, 'tools/jieli-wl82/stock-sysex', name)));
  const sources = [];
  for (const filename of [...new Set(sourceFiles)].sort()) {
    if (!isContained(root, filename)) throw new Error('Source path is outside the source checkout');
    sources.push({ path: slash(path.relative(root, filename)), sha256: hash(await readFile(filename)) });
  }
  const report = {
    format: target.format, version: PACKAGE_VERSION,
    platform: target.platform, arch: target.arch, runtime: { ...runtime, sha256: hash(await readFile(nodeExecutable)), licenseSha256: hash(await readFile(nodeLicense)),
      distributionReference: 'https://nodejs.org/dist/v22.22.2/', licenseReference: 'https://github.com/nodejs/node/blob/v22.22.2/LICENSE' },
    nativeLoadCheck: { ...loaded, enumeratedPorts: false, openedDevice: false },
    dependencies: notices, sources, panelSha256: hash(UI_HTML),
    files: await packageFileHashes(output, '', { includeModes: target.platform === 'darwin' }),
    fileHashScope: 'Every packaged file except BUILD-MANIFEST.json itself.',
    ...(target.platform === 'darwin' ? { fileModeScope: 'POSIX permission mode for every file; bundled Node must remain executable with mode 0755.' } : {}),
  };
  await writeFile(path.join(output, 'BUILD-MANIFEST.json'), json(report), { flag: 'wx' });
  return { outputDirectory: output, version: PACKAGE_VERSION, files: report.files.length + 1, runtime: runtime.version, nativeAddonLoaded: true, deviceOpened: false };
}

export async function copyRuntimeExecutable(source, destination, target = getPackageTarget()) {
  target = checkedTarget(target);
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  if (target.platform === 'darwin') {
    await chmod(destination, 0o755);
    if (((await lstat(destination)).mode & 0o777) !== 0o755) throw new Error('The macOS bundled Node executable must retain mode 0755');
  }
}

async function sourceTreeFiles(directory) {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('A packaged source input cannot be a symlink');
    if (entry.isDirectory()) result.push(...await sourceTreeFiles(filename));
    else if (entry.isFile()) result.push(filename);
    else throw new Error('A packaged source input must be a regular file');
  }
  return result;
}

export function parseArguments(args, { macos = false } = {}) {
  const result = {};
  const fields = { '--out': 'outputDirectory', '--node': 'nodeExecutable', '--node-license': 'nodeLicensePath', '--site-node-modules': 'siteNodeModules', '--native-node-modules': 'nativeNodeModules', ...(macos ? { '--arch': 'arch' } : {}) };
  const usage = `Use ${macos ? '--arch arm64|x64 ' : ''}--out ABSOLUTE_NEW_TMP_DIR --node ABSOLUTE_NODE_EXE --node-license ABSOLUTE_NODE_LICENSE`;
  for (let index = 0; index < args.length; index++) {
    const field = fields[args[index]];
    if (!field || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(usage);
    if (result[field]) throw new Error('Duplicate build argument');
    result[field] = args[++index];
  }
  if (macos && !['arm64', 'x64'].includes(result.arch)) throw new Error(usage);
  for (const field of ['outputDirectory', 'nodeExecutable', 'nodeLicensePath']) requireAbsoluteInput(result[field], field);
  return result;
}
