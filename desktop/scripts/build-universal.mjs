import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFreshOutput, getPackageTarget, NODE_LICENSE_SHA256, NODE_VERSION, PACKAGE_VERSION, PINNED_BUILD_DEPENDENCIES, packageFileHashes, requireAbsoluteInput } from './build-native.mjs';

export const UNIVERSAL_MCP_SERVER_NAME = 'fm1-forge';
export const UNIVERSAL_TARGETS = Object.freeze(['win32-x64', 'darwin-arm64', 'darwin-x64']);
const scriptPath = fileURLToPath(import.meta.url);
const defaultCheckout = path.resolve(path.dirname(scriptPath), '../..');
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha256 = /^[a-f0-9]{64}$/;
const privateName = /^(?:\.env(?:\..*)?|\.npmrc|\.git|\.svn|credentials?|tokens?|session\.json|state\.json|launch\.json)$/i;
const contained = (root, filename) => !path.relative(root, filename).split(path.sep).includes('..') && !path.isAbsolute(path.relative(root, filename));
const sorted = entries => [...entries].sort((a, b) => a.path.localeCompare(b.path));

export function checkedPackagePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || /[\u0000-\u001f\u007f:]/.test(value) || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..' || privateName.test(part))) throw new Error('Unsafe or private package path');
  return value;
}

function targetDescription(id) {
  if (!UNIVERSAL_TARGETS.includes(id)) throw new Error('Unsupported universal package target');
  const [platform, arch] = id.split('-');
  return getPackageTarget(platform, arch);
}

async function checkedRoot(directory) {
  const absolute = requireAbsoluteInput(directory, 'Package directory');
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Package directory must be a real directory');
  return realpath(absolute);
}

async function treeFiles(directory, relative = '') {
  const results = [];
  for (const entry of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = checkedPackagePath(relative ? `${relative}/${entry.name}` : entry.name);
    const filename = path.join(directory, name);
    const info = await lstat(filename);
    if (info.isSymbolicLink()) throw new Error('Package contains a symlink');
    if (info.isDirectory()) results.push(...await treeFiles(directory, name));
    else if (info.isFile()) results.push({ path: name, filename, stat: info });
    else throw new Error('Package contains a special file');
  }
  const insensitive = new Set();
  for (const entry of results) {
    const key = entry.path.toLowerCase();
    if (insensitive.has(key)) throw new Error('Package contains colliding file paths');
    insensitive.add(key);
  }
  return results;
}

function recordsByPath(records, label, { files = false } = {}) {
  if (!Array.isArray(records) || !records.length) throw new Error(`Missing ${label}`);
  const result = new Map(), insensitive = new Set();
  for (const record of records) {
    const key = checkedPackagePath(record?.path);
    if (result.has(key) || insensitive.has(key.toLowerCase()) || !sha256.test(record.sha256) || (files && (!Number.isSafeInteger(record.bytes) || record.bytes < 0))) throw new Error(`Invalid or duplicate ${label}`);
    result.set(key, record); insensitive.add(key.toLowerCase());
  }
  return result;
}

export function validateNativeReceipt(manifest, id) {
  const target = targetDescription(id);
  if (manifest?.format !== target.format || manifest.version !== PACKAGE_VERSION || manifest.platform !== target.platform || manifest.arch !== target.arch) throw new Error('Native package target or version mismatch');
  const runtime = manifest.runtime, load = manifest.nativeLoadCheck;
  for (const description of [runtime, load]) {
    if (description?.version !== NODE_VERSION || description.platform !== target.platform || description.arch !== target.arch) throw new Error('Native runtime receipt mismatch');
  }
  if (!sha256.test(runtime.sha256) || runtime.licenseSha256 !== NODE_LICENSE_SHA256 || runtime.distributionReference !== 'https://nodejs.org/dist/v22.22.2/' || runtime.licenseReference !== 'https://github.com/nodejs/node/blob/v22.22.2/LICENSE') throw new Error('Native runtime pin or license mismatch');
  if (load.loaded !== true || load.enumeratedPorts !== false || load.openedDevice !== false || !Number.isInteger(Number(load.napi)) || Number(load.napi) < 7) throw new Error('Native load must be verified without enumerating or opening a device');
  const files = recordsByPath(manifest.files, 'file records', { files: true });
  if (files.has('BUILD-MANIFEST.json')) throw new Error('Native manifest cannot include itself');
  const runtimeFile = files.get(target.runtimeRelative);
  if (!runtimeFile || runtimeFile.sha256 !== runtime.sha256 || files.get('LICENSES/Node.js-LICENSE')?.sha256 !== NODE_LICENSE_SHA256 || !sha256.test(manifest.panelSha256) || files.get('server/panel.html')?.sha256 !== manifest.panelSha256) throw new Error('Native runtime, license or panel file receipt mismatch');
  if (target.platform === 'darwin') {
    for (const file of files.values()) if (!Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) throw new Error('Missing or invalid macOS file mode');
    if (runtimeFile.mode !== 0o755) throw new Error('macOS runtime mode must be 0755');
  }
  recordsByPath(manifest.sources, 'source records');
  if (!Array.isArray(manifest.dependencies) || !manifest.dependencies.length) throw new Error('Missing dependency licenses');
  const dependencies = new Map();
  for (const dependency of manifest.dependencies) {
    if (typeof dependency.name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(dependency.name) || typeof dependency.version !== 'string' || !dependency.version || typeof dependency.license !== 'string' || !dependency.license || dependency.license === 'UNSPECIFIED' || !Array.isArray(dependency.files) || !dependency.files.length) throw new Error('Invalid dependency license receipt');
    const key = `${dependency.name}@${dependency.version}`;
    if (dependencies.has(key)) throw new Error('Duplicate dependency license receipt');
    const licensePaths = new Set();
    for (const file of dependency.files) {
      checkedPackagePath(file);
      if (!file.startsWith('LICENSES/') || !files.get(file)?.bytes || licensePaths.has(file)) throw new Error('Missing or duplicate dependency license file');
      licensePaths.add(file);
    }
    dependencies.set(key, dependency);
  }
  for (const [name, version] of Object.entries({ ...PINNED_BUILD_DEPENDENCIES, '@julusian/midi': '3.8.1' })) {
    if (name !== 'esbuild' && !dependencies.has(`${name}@${version}`)) throw new Error('Pinned dependency license is missing');
  }
  if (dependencies.get('fm1-common-updater@source')?.license !== 'Apache-2.0' || !['LICENSES/fm1-common-updater/LICENSE', 'LICENSES/fm1-common-updater/NOTICE'].every(file => dependencies.get('fm1-common-updater@source').files.includes(file))) throw new Error('Common updater Apache license and NOTICE must be retained');
  return { target, files, dependencies };
}

export async function validatePackageFiles(directory, records, { checkModes = false } = {}) {
  const root = await checkedRoot(directory), entries = await treeFiles(root);
  const files = recordsByPath(records, 'file records', { files: true });
  if (files.has('BUILD-MANIFEST.json')) throw new Error('Manifest cannot include itself');
  const expected = new Set([...files.keys(), 'BUILD-MANIFEST.json']);
  if (entries.length !== expected.size || entries.some(entry => !expected.has(entry.path))) throw new Error('Native package full file set differs from its manifest');
  for (const entry of entries) {
    if (entry.path === 'BUILD-MANIFEST.json') continue;
    const record = files.get(entry.path);
    if (entry.stat.size !== record.bytes || digest(await readFile(entry.filename)) !== record.sha256) throw new Error(`Native package file hash or size mismatch: ${entry.path}`);
    if (checkModes && (entry.stat.mode & 0o777) !== record.mode) throw new Error(`macOS file mode mismatch: ${entry.path}`);
  }
  return entries;
}

/** Validation is read-only; complete assembly additionally requires a POSIX host. */
export async function validateNativePackage(directory, id, { checkModes = process.platform !== 'win32' } = {}) {
  const root = await checkedRoot(directory);
  const manifestBytes = await readFile(path.join(root, 'BUILD-MANIFEST.json'));
  if (manifestBytes.length > 8 * 1024 * 1024) throw new Error('Native manifest is too large');
  const manifest = JSON.parse(manifestBytes);
  const { target, files } = validateNativeReceipt(manifest, id);
  const entries = await validatePackageFiles(root, manifest.files, { checkModes: target.platform === 'darwin' && checkModes });
  const portable = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  const legacy = JSON.parse(await readFile(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
  for (const plugin of [portable, legacy]) if (plugin.name !== 'fm1-app-library' || plugin.version !== PACKAGE_VERSION) throw new Error('Native plugin identity or version mismatch');
  for (const filename of ['mcp.json', '.mcp.json']) {
    const mcp = JSON.parse(await readFile(path.join(root, filename), 'utf8'));
    assert.deepEqual(Object.keys(mcp.mcpServers ?? {}), [target.serverName], 'Native MCP key mismatch');
    assert.deepEqual(mcp.mcpServers[target.serverName], { type: 'stdio', command: `./${target.runtimeRelative}`, args: ['${PLUGIN_ROOT}/server/index.mjs'], cwd: '${PLUGIN_ROOT}' }, 'Native MCP launch mismatch');
  }
  const nativePrebuilds = entries.filter(entry => entry.path.startsWith('node_modules/@julusian/midi/prebuilds/'));
  const prebuildPrefix = `node_modules/@julusian/midi/prebuilds/midi-${id}/`;
  if (!nativePrebuilds.some(entry => entry.path === `${prebuildPrefix}node-napi-v7.node`) || nativePrebuilds.some(entry => !entry.path.startsWith(prebuildPrefix))) throw new Error('Native MIDI prebuild target mismatch');
  return { id, root, manifest, manifestSha256: digest(manifestBytes), entries };
}

export function validateNativeInputs(inputs) {
  if (!Array.isArray(inputs) || inputs.length !== UNIVERSAL_TARGETS.length || new Set(inputs.map(input => input.id)).size !== UNIVERSAL_TARGETS.length || UNIVERSAL_TARGETS.some(id => !inputs.some(input => input.id === id))) throw new Error('Exactly one package for every universal target is required');
  const union = new Map();
  let commonSources, dependencies;
  for (const input of inputs) {
    validateNativeReceipt(input.manifest, input.id);
    const overridePrefix = input.id === 'win32-x64' ? 'desktop/plugin/skills/' : 'desktop/plugin-macos/skills/';
    if (input.manifest.sources.some(source => /^desktop\/plugin(?:-macos)?\/skills\//.test(source.path) && !source.path.startsWith(overridePrefix))) throw new Error('Unexpected platform skill source');
    const common = sorted(input.manifest.sources.filter(source => !source.path.startsWith(overridePrefix)));
    const notices = input.manifest.dependencies.map(item => ({ name: item.name, version: item.version, license: item.license, files: [...item.files].sort().map(filename => ({path:filename,sha256:input.manifest.files.find(file=>file.path===filename).sha256})) })).sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
    if (commonSources && JSON.stringify(commonSources) !== JSON.stringify(common)) throw new Error('Native source closure mismatch');
    if (dependencies && JSON.stringify(dependencies) !== JSON.stringify(notices)) throw new Error('Native dependency pins or licenses differ');
    commonSources = common; dependencies = notices;
    for (const source of input.manifest.sources) {
      if (union.has(source.path) && union.get(source.path).sha256 !== source.sha256) throw new Error('Native shared source hash mismatch');
      union.set(source.path, source);
    }
  }
  return sorted(union.values());
}

export function universalMcpConfiguration() {
  return { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { [UNIVERSAL_MCP_SERVER_NAME]: { type: 'stdio', command: './runtime/node', args: ['${PLUGIN_ROOT}/start.mjs'], cwd: '${PLUGIN_ROOT}' } } };
}

export function stageUniversalManifest(source, legacy = false) {
  if (source?.name !== 'fm1-app-library') throw new Error('Unexpected source plugin identity');
  const staged = structuredClone(source), presentation = legacy ? staged.interface : staged.extensions?.['com.openai']?.interface;
  if (!presentation || typeof presentation !== 'object') throw new Error('Missing source plugin interface');
  staged.version = PACKAGE_VERSION;
  if (legacy) staged.requires_local_executor = true;
  else (staged.extensions ??= {})['com.openai'] = { ...staged.extensions['com.openai'], requires_local_executor: true };
  staged.description = 'Native Windows and macOS MIDI, reviewed stock and custom FWSC SysEx updates, and local firmware-project configuration. USB serial and UBOOT writes remain unavailable.';
  presentation.displayName = 'FM-1 Forge';
  presentation.shortDescription = 'Native MIDI and FWSC updates';
  presentation.longDescription = 'One self-contained plugin for Windows x64 and macOS Apple Silicon or Intel. Codex starts the matching bundled runtime and native MIDI component automatically, without a separate runtime installation or helper service. Review the exact stock V15 package or validated custom FWSC and explicitly confirm each SysEx update. Preserve durable recovery evidence after an uncertain transfer. Common-firmware self-updates, USB serial and UBOOT writes remain unavailable. Physical update acceptance is pending.';
  return staged;
}

async function copyVerifiedTree(input, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of input.entries) {
    const output = path.join(destination, entry.path);
    await mkdir(path.dirname(output), { recursive: true });
    await copyFile(entry.filename, output, constants.COPYFILE_EXCL);
    const record = input.manifest.files.find(file => file.path === entry.path);
    await chmod(output, input.id.startsWith('darwin-') && record ? record.mode : 0o644);
  }
}

async function copySourceTree(source, destination) {
  const root = await checkedRoot(source);
  const entries = await treeFiles(root);
  for (const entry of entries) {
    const output = path.join(destination, entry.path);
    await mkdir(path.dirname(output), { recursive: true });
    await copyFile(entry.filename, output, constants.COPYFILE_EXCL);
    await chmod(output, 0o644);
  }
  return entries;
}

async function sourceHash(root, relative) {
  checkedPackagePath(relative);
  const filename = path.join(root, relative), info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || !contained(root, await realpath(filename))) throw new Error('Universal source input escapes its checkout');
  return { path: relative, sha256: digest(await readFile(filename)) };
}

export async function buildUniversalPackage(options) {
  if (options.sourceRevision !== undefined && !/^[a-f0-9]{40}$/i.test(options.sourceRevision)) throw new Error('Source revision must be a complete 40-hex commit');
  if (process.platform === 'win32') throw new Error('Universal assembly requires a POSIX host to preserve macOS executable modes');
  const root = await checkedRoot(options.checkoutRoot ?? defaultCheckout);
  const output = await assertFreshOutput(options.outputDirectory, path.join(root, 'tmp'));
  const inputs = [];
  for (const [id, field] of [['win32-x64', 'windowsDirectory'], ['darwin-arm64', 'macosArm64Directory'], ['darwin-x64', 'macosX64Directory']]) inputs.push(await validateNativePackage(requireAbsoluteInput(options[field], field), id));
  if (new Set(inputs.map(input => input.root)).size !== UNIVERSAL_TARGETS.length || inputs.some(input => contained(input.root, output) || contained(output, input.root)) || inputs.some((input, index) => inputs.some((other, otherIndex) => index !== otherIndex && contained(input.root, other.root)))) throw new Error('Native package inputs and output must be distinct non-overlapping directories');
  const sources = validateNativeInputs(inputs);
  for (const source of sources) if ((await sourceHash(root, source.path)).sha256 !== source.sha256) throw new Error(`Native source no longer matches checkout: ${source.path}`);
  const sourcePlugin = path.join(root, 'plugin/fm1-app-library');
  const portable = stageUniversalManifest(JSON.parse(await readFile(path.join(sourcePlugin, 'plugin.json'), 'utf8')));
  const legacy = stageUniversalManifest(JSON.parse(await readFile(path.join(sourcePlugin, '.codex-plugin/plugin.json'), 'utf8')), true);
  const launcherSources = ['desktop/universal/start.mjs', 'desktop/universal/runtime/node', 'desktop/scripts/build-universal.mjs'];
  for (const relative of launcherSources) await sourceHash(root, relative);
  await mkdir(output);
  for (const input of inputs) await copyVerifiedTree(input, path.join(output, 'payloads', input.id));
  await writeFile(path.join(output, '.gitattributes'), '* -text\n', { flag: 'wx' });
  await mkdir(path.join(output, '.codex-plugin'));
  await writeFile(path.join(output, 'plugin.json'), json(portable), { flag: 'wx' });
  await writeFile(path.join(output, '.codex-plugin/plugin.json'), json(legacy), { flag: 'wx' });
  for (const filename of ['mcp.json', '.mcp.json']) await writeFile(path.join(output, filename), json(universalMcpConfiguration()), { flag: 'wx' });
  const assets = await copySourceTree(path.join(sourcePlugin, 'assets'), path.join(output, 'assets'));
  const skills = await copySourceTree(path.join(root, 'desktop/universal/skills'), path.join(output, 'skills'));
  await copyFile(path.join(root, 'desktop/universal/start.mjs'), path.join(output, 'start.mjs'), constants.COPYFILE_EXCL);
  await mkdir(path.join(output, 'runtime'));
  await copyFile(path.join(root, 'desktop/universal/runtime/node'), path.join(output, 'runtime/node'), constants.COPYFILE_EXCL);
  await chmod(path.join(output, 'runtime/node'), 0o755);
  const windowsRuntime = path.join(inputs.find(input => input.id === 'win32-x64').root, 'runtime/win32-x64/node.exe');
  await copyFile(windowsRuntime, path.join(output, 'runtime/node.exe'), constants.COPYFILE_EXCL);
  await chmod(path.join(output, 'runtime/node.exe'), 0o644);
  for (const relative of [...launcherSources, 'plugin/fm1-app-library/plugin.json', 'plugin/fm1-app-library/.codex-plugin/plugin.json', ...assets.map(entry => `plugin/fm1-app-library/assets/${entry.path}`), ...skills.map(entry => `desktop/universal/skills/${entry.path}`)]) {
    const source = await sourceHash(root, relative);
    const previous = sources.find(item => item.path === source.path);
    if (previous && previous.sha256 !== source.sha256) throw new Error('Universal source closure changed during assembly');
    if (!previous) sources.push(source);
  }
  // Revalidate the copied payloads; this detects changes during copy and mode loss.
  for (const input of inputs) {
    const copied = await validateNativePackage(path.join(output, 'payloads', input.id), input.id);
    if (copied.manifestSha256 !== input.manifestSha256) throw new Error('Native manifest changed during assembly');
  }
  const files = await packageFileHashes(output, '', { includeModes: true });
  const report = { format: 'fm1-forge-universal-package-v1', version: PACKAGE_VERSION, targets: [...UNIVERSAL_TARGETS], expectedTargets: [...UNIVERSAL_TARGETS],
    ...(options.sourceRevision ? { sourceRevision: options.sourceRevision.toLowerCase() } : {}),
    nativeInputs: inputs.map(input => ({ target: input.id, path: `payloads/${input.id}`, manifestSha256: input.manifestSha256, version: input.manifest.version, sourceCount: input.manifest.sources.length, runtimeSha256: input.manifest.runtime.sha256 })),
    runtime: { version: NODE_VERSION, licenseSha256: NODE_LICENSE_SHA256 }, sources: sorted(sources), files,
    fileHashScope: 'Every packaged file except this outer BUILD-MANIFEST.json. Native payload manifests are retained byte for byte.',
    fileModeScope: 'POSIX permission mode for every file; macOS runtime modes are preserved and runtime/node is 0755.',
    verification: { assembledOn: process.platform, enumeratedPorts: false, openedDevice: false, nativeAcceptance: 'See each immutable native payload BUILD-MANIFEST.json and matching native CI smoke receipt.' } };
  await writeFile(path.join(output, 'BUILD-MANIFEST.json'), json(report), { flag: 'wx' });
  return { outputDirectory: output, version: PACKAGE_VERSION, targets: [...UNIVERSAL_TARGETS], files: files.length + 1, deviceOpened: false };
}

export function parseUniversalArguments(args) {
  const fields = { '--out': 'outputDirectory', '--windows': 'windowsDirectory', '--macos-arm64': 'macosArm64Directory', '--macos-x64': 'macosX64Directory', '--source-revision': 'sourceRevision' }, options = {};
  for (let index = 0; index < args.length; index++) {
    const field = fields[args[index]], value = args[index + 1];
    if (!field || !value || value.startsWith('--')) throw new Error('Use --out ABS --windows ABS --macos-arm64 ABS --macos-x64 ABS');
    if (options[field]) throw new Error('Duplicate universal build argument');
    if (field === 'sourceRevision' && !/^[a-f0-9]{40}$/i.test(value)) throw new Error('Source revision must be a complete 40-hex commit');
    options[field] = field === 'sourceRevision' ? value.toLowerCase() : requireAbsoluteInput(value, field); index++;
  }
  for (const field of Object.values(fields).filter(field => field !== 'sourceRevision')) requireAbsoluteInput(options[field], field);
  return options;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await buildUniversalPackage(parseUniversalArguments(process.argv.slice(2))), null, 2)); }
  catch (error) { process.stderr.write(`Universal package build failed: ${error.message}\n`); process.exitCode = 1; }
}