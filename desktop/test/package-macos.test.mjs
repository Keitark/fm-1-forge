import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertMacosRuntimeDescription, buildMacosPackage, includeMacosNativePackageFile, macosMcpConfiguration, parseMacosArguments, stageMacosManifest, PACKAGE_VERSION, MACOS_MCP_SERVER_NAME } from '../scripts/build-macos.mjs';
import { copyRuntimeExecutable, getPackageTarget, nativeMcpConfiguration, packageFileHashes, WINDOWS_MCP_SERVER_NAME } from '../scripts/build-native.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(process.env.FM1_PACKAGE_TEST_TMP ?? os.tmpdir(), 'fm1-macos-package-test-'));
  const original = await realpath(directory);
  t.after(async () => {
    assert.equal(await realpath(directory), original);
    assert.ok(path.basename(original).startsWith('fm1-macos-package-test-'));
    await rm(original, { recursive: true });
  });
  return directory;
}

for (const arch of ['arm64', 'x64']) {
  test(`macOS ${arch} MCP launch uses a distinct identity and contained bundled Node`, () => {
    const config = macosMcpConfiguration(arch);
    assert.equal(MACOS_MCP_SERVER_NAME, 'fm1-forge-macos');
    assert.notEqual(MACOS_MCP_SERVER_NAME, WINDOWS_MCP_SERVER_NAME);
    assert.deepEqual(Object.keys(config.mcpServers), [MACOS_MCP_SERVER_NAME]);
    assert.deepEqual(config.mcpServers[MACOS_MCP_SERVER_NAME], { type: 'stdio', command: `./runtime/darwin-${arch}/node`, args: ['${PLUGIN_ROOT}/server/index.mjs'], cwd: '${PLUGIN_ROOT}' });
    assert.throws(() => macosMcpConfiguration(arch, WINDOWS_MCP_SERVER_NAME), /macOS MCP server key/);
  });

  test(`macOS ${arch} metadata preserves portable and compatibility plugin identities`, async () => {
    for (const legacy of [false, true]) {
      const filename = legacy ? '../../plugin/fm1-app-library/.codex-plugin/plugin.json' : '../../plugin/fm1-app-library/plugin.json';
      const source = JSON.parse(await readFile(new URL(filename, import.meta.url), 'utf8'));
      const before = structuredClone(source);
      const staged = stageMacosManifest(source, legacy, arch);
      const actual = legacy ? staged.interface : staged.extensions['com.openai'].interface;
      const previous = legacy ? source.interface : source.extensions['com.openai'].interface;
      assert.equal(staged.name, 'fm1-app-library');
      assert.equal(staged.version, PACKAGE_VERSION);
      assert.equal(actual.displayName, 'FM-1 Forge macOS');
      assert.equal(actual.shortDescription, 'macOS MIDI and FWSC updates');
      assert.match(actual.longDescription, new RegExp(`self-contained macOS ${arch}`));
      assert.match(actual.longDescription, /explicitly confirm the SysEx update/);
      assert.match(actual.longDescription, /subsequent common-firmware self-updates remain disabled/);
      assert.match(actual.longDescription, /Physical update acceptance is pending/);
      assert.match(staged.description, /USB serial and UBOOT writes remain unavailable/);
      assert.deepEqual(actual.defaultPrompt, previous.defaultPrompt);
      assert.equal(actual.logo, previous.logo);
      assert.deepEqual(staged.author, source.author);
      assert.deepEqual(source, before);
    }
  });

  test(`macOS ${arch} runtime checks reject Windows, other architecture and Node versions`, () => {
    const expected = { version: 'v22.22.2', platform: 'darwin', arch };
    assert.doesNotThrow(() => assertMacosRuntimeDescription(expected, arch));
    for (const variant of [{ version: 'v22.22.1' }, { platform: 'win32' }, { platform: 'linux' }, { arch: arch === 'x64' ? 'arm64' : 'x64' }]) {
      assert.throws(() => assertMacosRuntimeDescription({ ...expected, ...variant }, arch), /cross-building is not supported/);
    }
  });

  test(`macOS ${arch} native closure retains only the matching MIDI prebuild`, () => {
    for (const relative of ['', 'prebuilds', 'LICENSE', `prebuilds/midi-darwin-${arch}`, `prebuilds/midi-darwin-${arch}/node-napi-v7.node`]) {
      assert.equal(includeMacosNativePackageFile('@julusian/midi', relative, arch), true);
    }
    for (const other of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64']) {
      if (other === `darwin-${arch}`) continue;
      assert.equal(includeMacosNativePackageFile('@julusian/midi', `prebuilds/midi-${other}`, arch), false);
      assert.equal(includeMacosNativePackageFile('@julusian/midi', `prebuilds/midi-${other}/node-napi-v7.node`, arch), false);
    }
    assert.equal(includeMacosNativePackageFile('pkg-prebuilds', 'prebuilds/example', arch), true);
  });
}

test('macOS CLI requires an explicit architecture and all absolute inputs', () => {
  const input = ['--arch', 'arm64', '--out', path.resolve('tmp/macos-new'), '--node', path.resolve('tmp/node'), '--node-license', path.resolve('tmp/LICENSE')];
  assert.equal(parseMacosArguments(input).arch, 'arm64');
  for (const value of ['x64']) assert.equal(parseMacosArguments(['--arch', value, ...input.slice(2)]).arch, value);
  assert.throws(() => parseMacosArguments(input.slice(2)), /--arch arm64\|x64/);
  assert.throws(() => parseMacosArguments(['--arch', 'universal', ...input.slice(2)]), /--arch arm64\|x64/);
  assert.throws(() => parseMacosArguments([...input, '--arch', 'x64']), /Duplicate/);
  assert.throws(() => parseMacosArguments(['--arch', 'arm64', '--out', 'relative', ...input.slice(4)]), /absolute path/);
  assert.throws(() => macosMcpConfiguration(), /architecture/);
  assert.throws(() => buildMacosPackage({ arch: 'universal' }), /architecture/);
});

test('native package targets cannot redirect executables or introduce unsupported platforms', () => {
  for (const arch of ['arm64', 'x64']) {
    const target = getPackageTarget('darwin', arch);
    assert.ok(Object.isFrozen(target));
    assert.equal(target.uiExport, 'MACOS_UI_HTML');
    assert.equal(target.skillOverrides, 'desktop/plugin-macos/skills');
    assert.equal(target.resourceUri, 'ui://fm1/forge-macos-v1.html');
    assert.throws(() => nativeMcpConfiguration({ ...target, runtimeRelative: '../node' }), /target metadata changed/);
    assert.throws(() => nativeMcpConfiguration({ ...target, serverName: 'other' }), /target metadata changed/);
  }
  for (const [platform, arch] of [['linux', 'x64'], ['darwin', 'ia32'], ['win32', 'arm64']]) assert.throws(() => getPackageTarget(platform, arch), /requires Windows x64 or macOS/);
});

test('macOS package file manifest includes file modes without changing Windows records', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'file.txt'), 'unchanged bytes');
  const [windows] = await packageFileHashes(root);
  const [macos] = await packageFileHashes(root, '', { includeModes: true });
  assert.equal(windows.mode, undefined);
  assert.equal(macos.mode, (await lstat(path.join(root, 'file.txt'))).mode & 0o777);
  assert.deepEqual({ path: macos.path, bytes: macos.bytes, sha256: macos.sha256 }, windows);
});

test('macOS runtime executable preserves required POSIX mode and refuses replacement', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t), source = path.join(root, 'input'), destination = path.join(root, 'node');
  await writeFile(source, 'test runtime');
  await chmod(source, 0o600);
  await copyRuntimeExecutable(source, destination, getPackageTarget('darwin', 'arm64'));
  assert.equal((await lstat(destination)).mode & 0o777, 0o755);
  assert.deepEqual(await readFile(destination), await readFile(source));
  await assert.rejects(copyRuntimeExecutable(source, destination, getPackageTarget('darwin', 'arm64')), /EEXIST/);
});

test('macOS override skills describe native CoreMIDI and preserve review requirements', async () => {
  for (const name of ['fm1-app-library', 'fm1-forge-setup']) {
    const text = await readFile(new URL(`../plugin-macos/skills/${name}/SKILL.md`, import.meta.url), 'utf8');
    assert.match(text, /macOS/);
    assert.doesNotMatch(text, /Windows/);
    assert.match(text, /explicit/);
    assert.match(text, /UBOOT/);
  }
});


test('cross-build is rejected before claiming any output directory', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'tmp'));
  await mkdir(path.join(root, 'desktop'));
  await writeFile(path.join(root, 'desktop/server.mjs'), '');
  await writeFile(path.join(root, 'LICENSE'), 'not yet read');
  const arch = process.platform === 'darwin' && process.arch === 'arm64' ? 'x64' : 'arm64';
  const output = path.join(root, 'tmp', 'not-created');
  await assert.rejects(buildMacosPackage({ arch, checkoutRoot: root, outputDirectory: output, nodeExecutable: process.execPath, nodeLicensePath: path.join(root, 'LICENSE') }), /reviewed Node.*cross-building/);
  await assert.rejects(lstat(output), /ENOENT/);
});

test('macOS package audit rejects personal POSIX filesystem paths', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'unsafe.json'), JSON.stringify({ path: '/Users/example/private/file' }));
  await assert.rejects(packageFileHashes(root), /local path/);
  await writeFile(path.join(root, 'unsafe.json'), JSON.stringify({ path: '/home/example/private/file' }));
  await assert.rejects(packageFileHashes(root), /local path/);
});
