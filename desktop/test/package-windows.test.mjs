import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { assertFreshOutput, assertRuntimeDescription, collectNativeClosure, copyCommonUpdaterNotices, copyCdcUbootSidecars, CDC_UBOOT_SIDECARS, includeNativePackageFile, packageFileHashes, parseArguments, requireAbsoluteInput, resolveDependencyLicenseFiles, stageManifest, windowsMcpConfiguration, PACKAGE_VERSION, WINDOWS_MCP_SERVER_NAME } from '../scripts/build-windows.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(process.env.FM1_PACKAGE_TEST_TMP ?? os.tmpdir(), 'fm1-windows-package-test-'));
  const original = await realpath(directory);
  t.after(async () => {
    assert.equal(await realpath(directory), original);
    assert.ok(path.basename(original).startsWith('fm1-windows-package-test-'));
    await rm(original, { recursive: true });
  });
  return directory;
}

test('Windows launch uses the contained bundled executable and explicit plugin-root paths', () => {
  const server = windowsMcpConfiguration().mcpServers[WINDOWS_MCP_SERVER_NAME];
  assert.equal(server.type, 'stdio');
  assert.equal(server.command, './runtime/win32-x64/node.exe');
  assert.deepEqual(server.args, ['${PLUGIN_ROOT}/server/index.mjs']);
  assert.equal(server.cwd, '${PLUGIN_ROOT}');
  assert.equal(server.env, undefined);
  assert.equal(server.url, undefined);
  assert.throws(() => windowsMcpConfiguration('../other'), /Windows MCP server key/);
});

test('Windows server key is distinct from the actual hosted source without changing plugin identity', async () => {
  const hosted = JSON.parse(await readFile(new URL('../../plugin/fm1-app-library/mcp.json', import.meta.url), 'utf8'));
  const hostedManifest = JSON.parse(await readFile(new URL('../../plugin/fm1-app-library/plugin.json', import.meta.url), 'utf8'));
  assert.equal(WINDOWS_MCP_SERVER_NAME, 'fm1-forge-windows');
  assert.deepEqual(Object.keys(windowsMcpConfiguration().mcpServers), [WINDOWS_MCP_SERVER_NAME]);
  assert.ok(!Object.hasOwn(hosted.mcpServers, WINDOWS_MCP_SERVER_NAME));
  for (const name of Object.keys(hosted.mcpServers)) assert.throws(() => windowsMcpConfiguration(name), /Windows MCP server key/);
  const staged = stageManifest(hostedManifest);
  assert.equal(staged.name, hostedManifest.name);
  assert.deepEqual(staged.extensions['com.openai'].interface.defaultPrompt, hostedManifest.extensions['com.openai'].interface.defaultPrompt);
});

test('staged edition retains identity, prompt, author and unrelated settings', () => {
  const original = { name: 'fm1-app-library', version: '3.3.0', description: 'Browser MIDI and stock updates', author: { name: 'Publisher' }, extensions: { 'com.openai': { interface: { displayName: 'FM-1 Forge', defaultPrompt: ['Exact prompt', 'Order retained'], logo: './assets/icon.png', shortDescription: 'Build and test', longDescription: 'Browser MIDI, serial and stock updates' }, onboardingSkill: './skills/setup/SKILL.md' } } };
  const staged = stageManifest(original);
  assert.equal(staged.name, original.name);
  assert.equal(staged.version, PACKAGE_VERSION);
  assert.equal(staged.extensions['com.openai'].interface.displayName, 'FM-1 Forge Windows');
  assert.deepEqual(staged.extensions['com.openai'].interface.defaultPrompt, original.extensions['com.openai'].interface.defaultPrompt);
  const restored = structuredClone(staged);
  restored.version = original.version;
  restored.description = original.description;
  restored.extensions['com.openai'].interface.displayName = 'FM-1 Forge';
  restored.extensions['com.openai'].interface.shortDescription = original.extensions['com.openai'].interface.shortDescription;
  restored.extensions['com.openai'].interface.longDescription = original.extensions['com.openai'].interface.longDescription;
  assert.deepEqual(restored, original);
  assert.equal(original.version, '3.3.0');
});

test('portable and compatibility metadata accurately scope reviewed stock writes and unsupported routes', () => {
  const presentation = { displayName: 'FM-1 Forge', defaultPrompt: 'Preserve this exact prompt.', logo: './assets/logo.png', longDescription: 'Use browser MIDI and USB serial for stock firmware updates', shortDescription: 'Firmware updater' };
  for (const legacy of [false, true]) {
    const original = { name: 'fm1-app-library', version: '3.3.0', description: 'Browser firmware updates', author: { name: 'Publisher' }, ...(legacy ? { interface: presentation } : { extensions: { 'com.openai': { interface: presentation } } }) };
    const staged = stageManifest(original, legacy);
    const actual = legacy ? staged.interface : staged.extensions['com.openai'].interface;
    assert.match(staged.description, /Native Windows MIDI/);
    assert.match(staged.description, /reviewed stock and custom FWSC SysEx updates/);
    assert.match(staged.description, /Tracker USB serial updates use a separately reviewed live UBOOT application-sector plan/);
    assert.match(actual.longDescription, /explicitly confirm the SysEx update/);
    assert.match(actual.longDescription, /Raw MIDI, arbitrary serial\/SCSI commands and compiler setup remain unavailable/);
    assert.match(actual.longDescription, /Physical update acceptance is pending/);
    assert.equal(actual.shortDescription, 'Windows MIDI and FWSC updates');
    assert.ok(actual.shortDescription.length <= 30);
    assert.equal(actual.defaultPrompt, presentation.defaultPrompt);
    assert.equal(actual.logo, presentation.logo);
    assert.deepEqual(staged.author, original.author);
    assert.equal(staged.name, original.name);
  }
});

test('runtime verification rejects another Node version, platform or architecture', () => {
  const expected = { version: 'v22.22.2', platform: 'win32', arch: 'x64' };
  assert.doesNotThrow(() => assertRuntimeDescription(expected));
  for (const variant of [{ version: 'v22.22.1' }, { platform: 'linux' }, { arch: 'arm64' }]) assert.throws(() => assertRuntimeDescription({ ...expected, ...variant }), /reviewed Node/);
  assert.throws(() => requireAbsoluteInput('node.exe', 'Node executable'), /absolute path/);
});

test('native prebuild selection retains the Windows x64 directory and excludes other architectures', () => {
  for (const relative of ['', 'prebuilds', 'prebuilds/midi-win32-x64', 'prebuilds/midi-win32-x64/node-napi-v7.node', 'LICENSE']) assert.equal(includeNativePackageFile('@julusian/midi', relative), true);
  for (const relative of ['prebuilds/midi-win32-arm64', 'prebuilds/midi-win32-ia32/node-napi-v7.node', 'prebuilds/midi-linux-x64/node-napi-v7.node']) assert.equal(includeNativePackageFile('@julusian/midi', relative), false);
});

test('explicit absolute inputs are required; there is no global Node fallback', () => {
  assert.throws(() => parseArguments(['--out', path.resolve('tmp/new')]), /absolute path/);
  assert.throws(() => parseArguments(['--out', path.resolve('tmp/new'), '--node', 'node', '--node-license', path.resolve('LICENSE')]), /absolute path/);
  assert.throws(() => parseArguments(['--unknown', 'value']), /Use --out/);
});

test('output must be a fresh path below the reviewed temporary root', async t => {
  const root = await fixture(t);
  const allowed = path.join(root, 'tmp');
  await mkdir(allowed);
  assert.equal(await assertFreshOutput(path.join(allowed, 'new'), allowed), path.join(allowed, 'new'));
  await mkdir(path.join(allowed, 'existing'));
  await assert.rejects(assertFreshOutput(path.join(allowed, 'existing'), allowed), /already exists/);
  await assert.rejects(assertFreshOutput(path.join(root, 'elsewhere'), allowed), /checkout tmp/);
});

test('native closure includes declared runtime dependencies and rejects unexpected MIDI version', async t => {
  const root = await fixture(t);
  for (const [name, manifest] of Object.entries({ '@julusian/midi': { name: '@julusian/midi', version: '3.8.1', dependencies: { 'pkg-prebuilds': '^1.1.0' } }, 'pkg-prebuilds': { name: 'pkg-prebuilds', version: '1.1.0' } })) {
    await mkdir(path.join(root, name), { recursive: true });
    await writeFile(path.join(root, name, 'package.json'), JSON.stringify(manifest));
  }
  assert.deepEqual((await collectNativeClosure(root)).map(entry => entry.name), ['@julusian/midi', 'pkg-prebuilds']);
  await writeFile(path.join(root, '@julusian/midi/package.json'), JSON.stringify({ name: '@julusian/midi', version: '9.0.0' }));
  await assert.rejects(collectNativeClosure(root), /must be 3.8.1/);
});

test('package audit hashes bytes and rejects credentials and personal absolute paths', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'safe.json'), '{"safe":true}');
  const [entry] = await packageFileHashes(root);
  assert.equal(entry.path, 'safe.json');
  assert.equal(entry.bytes, (await readFile(path.join(root, 'safe.json'))).length);
  assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  await writeFile(path.join(root, 'unsafe.json'), JSON.stringify({ path: 'C:\\Users\\someone\\private' }));
  await assert.rejects(packageFileHashes(root), /local path/);
});

test('missing archive license uses only the pinned upstream release notice', async t => {
  const root = await fixture(t);
  const dependency = { name: '@cfworker/json-schema', version: '4.1.1', root };
  const reviewed = fileURLToPath(new URL('../licenses/', import.meta.url));
  const [license] = await resolveDependencyLicenseFiles(dependency, reviewed);
  assert.match(license.source, /json-schema%404\.1\.1\/LICENSE\.md$/);
  assert.match(license.sha256, /^[0-9a-f]{64}$/);
  await assert.rejects(resolveDependencyLicenseFiles({ ...dependency, version: '4.1.2' }, reviewed), /Missing redistributable/);
  const changed = path.join(root, 'changed');
  await mkdir(changed);
  await writeFile(path.join(changed, 'cfworker-json-schema-4.1.1-LICENSE.md'), 'Unreviewed replacement');
  await assert.rejects(resolveDependencyLicenseFiles(dependency, changed), /Reviewed dependency license changed/);
});

test('common updater Apache license and notice are both copied without changing their bytes', async t => {
  const root = await fixture(t), output = path.join(root, 'output');
  const source = path.join(root, 'site/lib/browser-common');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'LICENSE'), 'Apache License\nVersion 2.0\n');
  await writeFile(path.join(source, 'NOTICE'), 'Scoped common updater copyright and attribution\n');
  const notice = await copyCommonUpdaterNotices(root, output);
  assert.equal(notice.license, 'Apache-2.0');
  assert.deepEqual(notice.files, ['LICENSES/fm1-common-updater/LICENSE', 'LICENSES/fm1-common-updater/NOTICE']);
  for (const name of ['LICENSE', 'NOTICE']) assert.deepEqual(await readFile(path.join(output, 'LICENSES/fm1-common-updater', name)), await readFile(path.join(source, name)));
  await rm(path.join(source, 'NOTICE'));
  await assert.rejects(copyCommonUpdaterNotices(root, path.join(root, 'missing-notice')), /ENOENT/);
});

test('CDC sidecars use a closed source list and retain the exact pinned helper and notices',async t=>{
  const directory=await fixture(t),root=fileURLToPath(new URL('../../',import.meta.url)),output=path.join(directory,'output');await mkdir(output);
  const notice=await copyCdcUbootSidecars(root,output);
  assert.deepEqual(CDC_UBOOT_SIDECARS,['windows-cdc-link.ps1','windows-cdc-server.ps1','windows-cdc-relay.ps1','FlashPolicy.cs','FlashEngine.cs','wl82loader.bin','LICENSE.jl-uboot-tool','PROVENANCE.md']);
  for(const name of CDC_UBOOT_SIDECARS)assert.deepEqual(await readFile(path.join(output,'server/cdc-uboot',name)),await readFile(path.join(root,'tools/jieli-wl82/cdc-uboot',name)));
  assert.equal(notice.license,'MIT');assert.ok(notice.files.includes('server/cdc-uboot/LICENSE.jl-uboot-tool'));assert.equal(notice.sourceFiles.length,8);
  await assert.rejects(copyCdcUbootSidecars(root,output),{code:'EEXIST'});
});

test('changed CDC RAM helper is rejected before package copying',async t=>{
  const directory=await fixture(t),root=fileURLToPath(new URL('../../',import.meta.url)),source=path.join(directory,'tools/jieli-wl82/cdc-uboot'),output=path.join(directory,'output');await mkdir(source,{recursive:true});await mkdir(output);
  for(const name of CDC_UBOOT_SIDECARS)await copyFile(path.join(root,'tools/jieli-wl82/cdc-uboot',name),path.join(source,name));
  const helper=await readFile(path.join(source,'wl82loader.bin'));helper[0]^=1;await writeFile(path.join(source,'wl82loader.bin'),helper);
  await assert.rejects(copyCdcUbootSidecars(directory,output),/Pinned WL82 RAM helper changed/);
});
