import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';
import { compressDarwinRuntime, assertGitFileSizes, checkedPackagePath, parseUniversalArguments, stageUniversalManifest, universalMcpConfiguration, UNIVERSAL_MCP_SERVER_NAME, UNIVERSAL_TARGETS, validateNativeInputs, validateNativeReceipt, validatePackageFiles, buildUniversalPackage } from '../scripts/build-universal.mjs';
import { getPackageTarget, NODE_LICENSE_SHA256, NODE_VERSION, PACKAGE_VERSION, PINNED_BUILD_DEPENDENCIES } from '../scripts/build-native.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const record = (name, body = name, mode = 0o644) => ({ path: name, sha256: digest(body), bytes: Buffer.byteLength(body), mode });
function receipt(id) {
  const [platform, arch] = id.split('-'), target = getPackageTarget(platform, arch);
  const files = [record(target.runtimeRelative, 'runtime', platform === 'darwin' ? 0o755 : 0o644), { ...record('LICENSES/Node.js-LICENSE'), sha256: NODE_LICENSE_SHA256 }, record('server/panel.html')];
  const dependencies = Object.entries({ ...PINNED_BUILD_DEPENDENCIES, '@julusian/midi': '3.8.1' }).filter(([name]) => name !== 'esbuild').map(([name, version]) => {
    const filename = `LICENSES/${name.replaceAll('/', '__')}@${version}/LICENSE`;
    files.push(record(filename));
    return { name, version, license: 'MIT', files: [filename] };
  });
  for (const name of ['LICENSE', 'NOTICE']) files.push(record(`LICENSES/fm1-common-updater/${name}`));
  dependencies.push({ name: 'fm1-common-updater', version: 'source', license: 'Apache-2.0', files: ['LICENSES/fm1-common-updater/LICENSE', 'LICENSES/fm1-common-updater/NOTICE'] });
  return { format: target.format, version: PACKAGE_VERSION, platform, arch,
    runtime: { version: NODE_VERSION, platform, arch, sha256: digest('runtime'), licenseSha256: NODE_LICENSE_SHA256, distributionReference: 'https://nodejs.org/dist/v22.22.2/', licenseReference: 'https://github.com/nodejs/node/blob/v22.22.2/LICENSE' },
    nativeLoadCheck: { loaded: true, version: NODE_VERSION, platform, arch, napi: '10', enumeratedPorts: false, openedDevice: false },
    files, dependencies, panelSha256: digest('server/panel.html'),
    sources: [{ path: 'desktop/server.mjs', sha256: digest('shared server') }, { path: `desktop/plugin${platform === 'darwin' ? '-macos' : ''}/skills/setup/SKILL.md`, sha256: digest(platform) }] };
}
const inputs = () => UNIVERSAL_TARGETS.map(id => ({ id, manifest: receipt(id) }));
async function fixture(t) {
  const directory = await mkdtemp(path.join(process.env.FM1_PACKAGE_TEST_TMP ?? os.tmpdir(), 'fm1-universal-package-test-'));
  const root = await realpath(directory);
  t.after(async () => { assert.equal(await realpath(root), root); assert.ok(path.basename(root).startsWith('fm1-universal-package-test-')); await rm(root, { recursive: true }); });
  return root;
}
async function fileFixture(t) {
  const root = await fixture(t);
  await writeFile(path.join(root, 'BUILD-MANIFEST.json'), '{}');
  await mkdir(path.join(root, 'server'));
  await writeFile(path.join(root, 'server/index.mjs'), 'export const safe = true;');
  await chmod(path.join(root, 'server/index.mjs'), 0o644);
  const entry = record('server/index.mjs', 'export const safe = true;', (await lstat(path.join(root, 'server/index.mjs'))).mode & 0o777);
  return { root, entry };
}

test('universal launcher has one stable MCP key and a contained extensionless command', () => {
  assert.equal(UNIVERSAL_MCP_SERVER_NAME, 'fm1-forge');
  assert.deepEqual(UNIVERSAL_TARGETS, ['win32-x64', 'darwin-arm64', 'darwin-x64']);
  assert.ok(Object.isFrozen(UNIVERSAL_TARGETS));
  const config = universalMcpConfiguration();
  assert.deepEqual(Object.keys(config.mcpServers), ['fm1-forge']);
  assert.deepEqual(config.mcpServers['fm1-forge'], { type: 'stdio', command: './runtime/node', args: ['${PLUGIN_ROOT}/start.mjs'], cwd: '${PLUGIN_ROOT}' });
});

test('universal portable and compatibility metadata preserve identity and audience', () => {
  for (const legacy of [false, true]) {
    const presentation = { displayName: 'FM-1 Forge Windows', defaultPrompt: ['Keep prompt'], logo: './assets/icon.png' };
    const source = { name: 'fm1-app-library', author: { name: 'Publisher' }, version: 'old', ...(legacy ? { interface: presentation } : { extensions: { 'com.openai': { interface: presentation } } }) };
    const before = structuredClone(source), result = stageUniversalManifest(source, legacy);
    const actual = legacy ? result.interface : result.extensions['com.openai'].interface;
    assert.equal(result.name, 'fm1-app-library'); assert.equal(result.version, PACKAGE_VERSION);
    assert.equal(actual.displayName, 'FM-1 Forge'); assert.deepEqual(actual.defaultPrompt, presentation.defaultPrompt);
    assert.equal(actual.logo, presentation.logo); assert.deepEqual(result.author, source.author);
    assert.match(actual.longDescription, /Windows x64 and macOS Apple Silicon or Intel/);
    assert.match(actual.longDescription, /explicitly confirm each SysEx update/);
    assert.match(actual.longDescription, /USB serial and UBOOT writes remain unavailable/);
    assert.match(actual.longDescription, /Physical update acceptance is pending/);
    assert.equal(legacy ? result.requires_local_executor : result.extensions['com.openai'].requires_local_executor, true);
    assert.deepEqual(source, before);
  }
  assert.throws(() => stageUniversalManifest({ name: 'other' }), /identity/);
});

for (const id of UNIVERSAL_TARGETS) test(`${id} native receipt retains matching runtime, license, pins and passive load`, () => {
  assert.equal(validateNativeReceipt(receipt(id), id).target.platform, id.split('-')[0]);
});

test('universal input set requires each target exactly once', () => {
  for (const cases of [[], inputs().slice(0, 2), [...inputs(), inputs()[0]], [inputs()[0], inputs()[0], inputs()[2]]]) assert.throws(() => validateNativeInputs(cases), /Exactly one/);
  const wrong = inputs(); wrong[0].id = 'linux-x64'; assert.throws(() => validateNativeInputs(wrong), /Exactly one/);
});

test('universal closure permits only platform skill differences and hashes every shared source', () => {
  const source = validateNativeInputs(inputs());
  assert.deepEqual(source.map(entry => entry.path), ['desktop/plugin-macos/skills/setup/SKILL.md', 'desktop/plugin/skills/setup/SKILL.md', 'desktop/server.mjs'].sort((a, b) => a.localeCompare(b)));
  const changed = inputs(); changed[1].manifest.sources[0].sha256 = digest('changed'); assert.throws(() => validateNativeInputs(changed), /source closure mismatch/);
  const extra = inputs(); extra[1].manifest.sources.push({ path: 'desktop/unexpected.mjs', sha256: digest('extra') }); assert.throws(() => validateNativeInputs(extra), /source closure mismatch/);
  const wrongSkills = inputs(); wrongSkills[0].manifest.sources[1].path = 'desktop/plugin-macos/skills/setup/SKILL.md'; assert.throws(() => validateNativeInputs(wrongSkills), /Unexpected platform skill/);
  const changedMacSkills = inputs(); changedMacSkills[2].manifest.sources[1].sha256 = digest('different mac skill'); assert.throws(() => validateNativeInputs(changedMacSkills), /shared source hash mismatch/);
});

test('native receipt rejects version/platform/CPU/runtime and device-touch mismatches', () => {
  for (const [field, value] of [['version', 'old'], ['platform', 'linux'], ['arch', 'arm64'], ['format', 'other']]) {
    const manifest = receipt('win32-x64'); manifest[field] = value; assert.throws(() => validateNativeReceipt(manifest, 'win32-x64'), /target or version/);
  }
  for (const field of ['enumeratedPorts', 'openedDevice']) { const manifest = receipt('win32-x64'); manifest.nativeLoadCheck[field] = true; assert.throws(() => validateNativeReceipt(manifest, 'win32-x64'), /without enumerating/); }
  for (const field of ['runtime', 'nativeLoadCheck']) { const manifest = receipt('win32-x64'); manifest[field].version = 'v20.0.0'; assert.throws(() => validateNativeReceipt(manifest, 'win32-x64'), /runtime receipt/); }
  const invalidLoad = receipt('win32-x64'); invalidLoad.nativeLoadCheck.loaded = false; assert.throws(() => validateNativeReceipt(invalidLoad, 'win32-x64'), /Native load/);
});

test('native licenses must retain pins, Apache NOTICE and matching bytes across targets', () => {
  const missing = receipt('win32-x64'); missing.dependencies = missing.dependencies.filter(dependency => dependency.name !== '@julusian/midi'); assert.throws(() => validateNativeReceipt(missing, 'win32-x64'), /Pinned dependency/);
  const unlicensed = receipt('win32-x64'); unlicensed.dependencies[0].license = 'UNSPECIFIED'; assert.throws(() => validateNativeReceipt(unlicensed, 'win32-x64'), /license receipt/);
  const noNotice = receipt('win32-x64'); noNotice.dependencies.at(-1).files.pop(); assert.throws(() => validateNativeReceipt(noNotice, 'win32-x64'), /Apache license and NOTICE/);
  const noFile = receipt('win32-x64'); noFile.dependencies[0].files = ['LICENSES/not-there']; assert.throws(() => validateNativeReceipt(noFile, 'win32-x64'), /license file/);
  const changed = inputs(); changed[1].manifest.files.find(file => file.path === changed[1].manifest.dependencies[0].files[0]).sha256 = digest('new license'); assert.throws(() => validateNativeInputs(changed), /licenses differ/);
  const runtime = receipt('win32-x64'); runtime.runtime.licenseSha256 = digest('shortened license'); assert.throws(() => validateNativeReceipt(runtime, 'win32-x64'), /license mismatch/);
});

test('native Mac receipt requires all file modes and executable Node', () => {
  for (const id of ['darwin-arm64', 'darwin-x64']) {
    const missing = receipt(id); delete missing.files[2].mode; assert.throws(() => validateNativeReceipt(missing, id), /file mode/);
    const noExec = receipt(id); noExec.files[0].mode = 0o644; assert.throws(() => validateNativeReceipt(noExec, id), /0755/);
    const badMode = receipt(id); badMode.files[2].mode = 0o4777; assert.throws(() => validateNativeReceipt(badMode, id), /file mode/);
  }
});

test('package paths reject traversal, absolute paths, private inputs and alternate streams', () => {
  for (const name of ['', '../a', '/tmp/a', 'a/../b', 'a//b', './a', 'a\\b', 'C:/a', 'a:stream', 'a\u0000b', '.env', 'secret/.npmrc', 'a/session.json', '.git/config']) assert.throws(() => checkedPackagePath(name), /package path/);
  assert.equal(checkedPackagePath('node_modules/@julusian/midi/LICENSE'), 'node_modules/@julusian/midi/LICENSE');
  const duplicate = receipt('win32-x64'); duplicate.files.push(duplicate.files[0]); assert.throws(() => validateNativeReceipt(duplicate, 'win32-x64'), /duplicate file/);
  const self = receipt('win32-x64'); self.files.push(record('BUILD-MANIFEST.json')); assert.throws(() => validateNativeReceipt(self, 'win32-x64'), /include itself/);
});

test('full file validation detects same-size tampering and retains manifest exclusion', async t => {
  const { root, entry } = await fileFixture(t);
  const before = await readFile(path.join(root, 'BUILD-MANIFEST.json'));
  assert.equal((await validatePackageFiles(root, [entry])).length, 2);
  await writeFile(path.join(root, entry.path), 'export const safe = null;');
  await assert.rejects(validatePackageFiles(root, [entry]), /hash or size/);
  assert.deepEqual(await readFile(path.join(root, 'BUILD-MANIFEST.json')), before);
});

test('full file validation rejects extra, missing and private files', async t => {
  const { root, entry } = await fileFixture(t);
  await writeFile(path.join(root, 'extra.txt'), 'unrecorded'); await assert.rejects(validatePackageFiles(root, [entry]), /full file set/); await rm(path.join(root, 'extra.txt'));
  await assert.rejects(validatePackageFiles(root, [entry, record('missing')]), /full file set/);
  await writeFile(path.join(root, '.env'), 'private'); await assert.rejects(validatePackageFiles(root, [entry]), /private package path/);
});

test('full file validation detects executable mode loss', { skip: process.platform === 'win32' }, async t => {
  const { root, entry } = await fileFixture(t);
  await validatePackageFiles(root, [entry], { checkModes: true });
  await chmod(path.join(root, entry.path), 0o755); await assert.rejects(validatePackageFiles(root, [entry], { checkModes: true }), /mode mismatch/);
});

test('full file validation refuses symlinks and path roots that are links', { skip: process.platform === 'win32' }, async t => {
  const { root, entry } = await fileFixture(t);
  await symlink(path.join(root, entry.path), path.join(root, 'link')); await assert.rejects(validatePackageFiles(root, [entry]), /symlink/);
  await rm(path.join(root, 'link')); await mkdir(path.join(root, 'container')); await symlink(path.join(root, 'server'), path.join(root, 'container', 'root'));
  await assert.rejects(validatePackageFiles(path.join(root, 'container', 'root'), []), /real directory/);
});

test('universal CLI requires all explicit absolute inputs and complete optional commit', () => {
  const args = ['--out', path.resolve('tmp/output'), '--windows', path.resolve('tmp/windows'), '--macos-arm64', path.resolve('tmp/arm64'), '--macos-x64', path.resolve('tmp/x64')];
  assert.equal(parseUniversalArguments(args).windowsDirectory, path.resolve('tmp/windows'));
  assert.equal(parseUniversalArguments([...args, '--source-revision', 'A'.repeat(40)]).sourceRevision, 'a'.repeat(40));
  assert.throws(() => parseUniversalArguments(args.slice(0, -2)), /absolute path/);
  assert.throws(() => parseUniversalArguments([...args, '--windows', path.resolve('tmp/other')]), /Duplicate/);
  assert.throws(() => parseUniversalArguments(['--out', 'relative', ...args.slice(2)]), /absolute path/);
  assert.throws(() => parseUniversalArguments([...args, '--source-revision', 'abc']), /40-hex/);
  assert.throws(() => parseUniversalArguments([...args, '--unknown', 'value']), /Use --out/);
});

test('Windows refuses full assembly before creating an output with lost POSIX modes', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t), output = path.join(root, 'unclaimed');
  await assert.rejects(buildUniversalPackage({ outputDirectory: output }), /POSIX host/);
  await assert.rejects(lstat(output), /ENOENT/);
});

async function runtimeFixture(t, id = 'darwin-arm64') {
  const root = await fixture(t), manifest = receipt(id), runtime = manifest.files[0];
  const bytes = Buffer.from('A native runtime fixture\n'.repeat(4096));
  runtime.sha256 = digest(bytes); runtime.bytes = bytes.length; manifest.runtime.sha256 = runtime.sha256;
  const filename = path.join(root, runtime.path);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, bytes); await chmod(filename, 0o755);
  await writeFile(path.join(root, 'BUILD-MANIFEST.json'), JSON.stringify(manifest));
  return { root, manifest, bytes, filename };
}

test('Darwin runtime archive preserves exact raw bytes and immutable native manifest', async t => {
  for (const id of ['darwin-arm64', 'darwin-x64']) {
    const item = await runtimeFixture(t, id), before = await readFile(path.join(item.root, 'BUILD-MANIFEST.json'));
    const archived = await compressDarwinRuntime(item.root, id), compressed = await readFile(`${item.filename}.gz`);
    assert.equal(archived.target, id);
    assert.equal(archived.path, `payloads/${id}/runtime/${id}/node.gz`);
    assert.equal(archived.bytes, compressed.length); assert.equal(archived.sha256, digest(compressed));
    assert.equal(archived.rawBytes, item.bytes.length); assert.equal(archived.rawSha256, digest(item.bytes));
    assert.deepEqual(gunzipSync(compressed), item.bytes);
    assert.equal(await readFile(`${item.filename}.sha256`, 'utf8'), `${digest(item.bytes)}\n`);
    assert.deepEqual(await readFile(path.join(item.root, 'BUILD-MANIFEST.json')), before);
    await assert.rejects(lstat(item.filename), /ENOENT/);
    if (process.platform !== 'win32') {
      assert.equal((await lstat(`${item.filename}.gz`)).mode & 0o777, 0o644);
      assert.equal((await lstat(`${item.filename}.sha256`)).mode & 0o777, 0o644);
    }
  }
});

test('Darwin gzip output is deterministic and refuses tampered raw input or existing archive', async t => {
  const one = await runtimeFixture(t), two = await runtimeFixture(t);
  const first = await compressDarwinRuntime(one.root, 'darwin-arm64'), second = await compressDarwinRuntime(two.root, 'darwin-arm64');
  assert.equal(first.sha256, second.sha256);
  const tampered = await runtimeFixture(t); await writeFile(tampered.filename, 'changed runtime');
  await assert.rejects(compressDarwinRuntime(tampered.root, 'darwin-arm64'), /differs from its native manifest/);
  await assert.rejects(lstat(`${tampered.filename}.gz`), /ENOENT/);
  assert.equal(await readFile(tampered.filename, 'utf8'), 'changed runtime');
  const existing = await runtimeFixture(t); await writeFile(`${existing.filename}.gz`, 'preserve previous');
  await assert.rejects(compressDarwinRuntime(existing.root, 'darwin-arm64'), /already exists/);
  assert.deepEqual(await readFile(existing.filename), existing.bytes);
  assert.equal(await readFile(`${existing.filename}.gz`, 'utf8'), 'preserve previous');
  await assert.rejects(compressDarwinRuntime(existing.root, 'win32-x64'), /Only Darwin/);
});

test('Git distribution rejects any individual file at the 100 MiB limit', () => {
  assert.doesNotThrow(() => assertGitFileSizes([{ path: 'runtime/node.exe', bytes: 87_074_816 }, { path: 'node.gz', bytes: 100 * 1024 * 1024 - 1 }]));
  for (const bytes of [100 * 1024 * 1024, 100 * 1024 * 1024 + 1, -1, NaN]) assert.throws(() => assertGitFileSizes([{ path: 'oversized', bytes }]), /100 MiB/);
});
