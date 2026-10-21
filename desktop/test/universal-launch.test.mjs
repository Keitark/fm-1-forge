import assert from 'node:assert/strict';
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { selectDesktopPayload } from '../universal/start.mjs';

const launcherSource = new URL('../universal/start.mjs', import.meta.url);
const shellSource = new URL('../universal/runtime/node', import.meta.url);
const supportedHost = process.platform === 'win32' && process.arch === 'x64' ||
  process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch);

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(process.env.FM1_PACKAGE_TEST_TMP ?? os.tmpdir(), 'fm1-universal-launch-test-with spaces-')));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.match(path.basename(root), /^fm1-universal-launch-test-/);
    await rm(root, { recursive: true });
  });
  return root;
}

async function runtimeAlias(source, destination) {
  try { await link(source, destination); }
  catch (error) {
    if (!['EPERM', 'EACCES', 'EXDEV', 'ENOTSUP'].includes(error.code)) throw error;
    await copyFile(source, destination);
  }
}

let packedRuntime;
async function compressedRuntime() {
  packedRuntime ??= readFile(process.execPath).then(raw => ({ gzip: gzipSync(raw), sha256: createHash('sha256').update(raw).digest('hex') }));
  return packedRuntime;
}

async function packageFixture(t, { payload = true, payloadSource } = {}) {
  const root = await fixture(t), target = selectDesktopPayload();
  await mkdir(path.join(root, 'runtime'));
  await copyFile(launcherSource, path.join(root, 'start.mjs'));
  await copyFile(shellSource, path.join(root, 'runtime/node'));
  await chmod(path.join(root, 'runtime/node'), 0o755);
  if (process.platform === 'win32') {
    await runtimeAlias(process.execPath, path.join(root, 'runtime/node.exe'));
  } else {
    const runtime = path.join(root, 'payloads', target, 'runtime', target);
    await mkdir(runtime, { recursive: true });
    const packed = await compressedRuntime();
    await writeFile(path.join(runtime, 'node.gz'), packed.gzip);
    await writeFile(path.join(runtime, 'node.sha256'), packed.sha256 + '\n');
  }
  if (payload) {
    const server = path.join(root, 'payloads', target, 'server');
    await mkdir(server, { recursive: true });
    await writeFile(path.join(server, 'index.mjs'), payloadSource ??
      'export async function startStdio(){process.stdout.write(JSON.stringify({target:' +
      JSON.stringify(target) + ',platform:process.platform,arch:process.arch,data:process.env.PLUGIN_DATA,args:process.argv.slice(2)}));}');
  }
  return root;
}

function invoke(root, args = [], { input } = {}) {
  return spawnSync(path.join(root, 'runtime/node'), [path.join(root, 'start.mjs'), ...args], {
    cwd: root, encoding: 'utf8', timeout: 20000, windowsHide: true, input,
    env: { ...process.env, PATH: '', TMPDIR: root, PLUGIN_DATA: 'preserved-user-data', FM1_TARGET: 'linux-x64', FM1_PLATFORM: 'linux', FM1_ARCH: 'arm64' },
  });
}

test('universal payload selection is a fixed Windows and macOS allowlist', () => {
  for (const [platform, arch, expected] of [['win32', 'x64', 'win32-x64'], ['darwin', 'arm64', 'darwin-arm64'], ['darwin', 'x64', 'darwin-x64']]) {
    assert.equal(selectDesktopPayload({ platform, arch }), expected);
  }
  for (const [platform, arch] of [['linux', 'x64'], ['win32', 'arm64'], ['darwin', 'ia32'], ['__proto__', 'x64'], ['darwin/../win32', 'x64']]) {
    assert.throws(() => selectDesktopPayload({ platform, arch }), /Unsupported/);
  }
});

test('universal launcher import performs no startup and does not accept target paths', async () => {
  const source = await readFile(launcherSource, 'utf8');
  assert.match(source, /selectDesktopPayload\(\)/);
  assert.match(source, /process\.argv\.length !== 2/);
  assert.doesNotMatch(source, /process\.env|fetch\(|child_process|execSync/);
});

test('POSIX dispatcher uses fixed system utilities and bundled Darwin runtimes', async () => {
  const shell = await readFile(shellSource, 'utf8');
  assert.ok(shell.startsWith('#!/bin/sh\n'));
  assert.match(shell, /\/usr\/bin\/uname -s/);
  assert.match(shell, /\/usr\/bin\/uname -m/);
  assert.match(shell, /arm64\) target=darwin-arm64/);
  assert.match(shell, /x86_64\) target=darwin-x64/);
  assert.match(shell, /"\$cache\/node" "\$@" <&0 &/);
  assert.match(shell, /umask 077/);
  assert.match(shell, /\/usr\/bin\/gzip -dc/);
  assert.match(shell, /\/usr\/bin\/shasum -a 256/);
  assert.match(shell, /\/bin\/chmod 0500/);
  assert.doesNotMatch(shell, /rm -rf|rm -r /);
  assert.doesNotMatch(shell, /curl|wget|python|command -v|\/usr\/bin\/env|eval/);
});

test('common extensionless command starts the matching native payload with PATH empty', { skip: !supportedHost }, async t => {
  const root = await packageFixture(t), run = invoke(root);
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  assert.deepEqual(JSON.parse(run.stdout), { target: selectDesktopPayload(), platform: process.platform, arch: process.arch, data: 'preserved-user-data', args: [] });
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('fm1-forge-runtime.')), []);
});

test('launcher refuses additional target or runtime arguments before importing a payload', { skip: !supportedHost }, async t => {
  const root = await packageFixture(t);
  for (const args of [['--target', 'darwin-arm64'], ['../other.mjs'], ['--platform=linux']]) {
    const run = invoke(root, args);
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.equal(run.stderr, 'FM-1 Forge could not start. Verify the installed desktop package.\n');
    assert.ok(!run.stderr.includes(root));
  }
});

test('a missing selected payload exits safely without stdout or private paths', { skip: !supportedHost }, async t => {
  const root = await packageFixture(t, { payload: false }), run = invoke(root);
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.equal(run.stderr, 'FM-1 Forge could not start. Verify the installed desktop package.\n');
  assert.ok(!run.stderr.includes(root));
});

test('universal skills describe automatic selection and explicit programming review', async () => {
  for (const name of ['fm1-app-library', 'fm1-forge-setup']) {
    const skill = await readFile(new URL(`../universal/skills/${name}/SKILL.md`, import.meta.url), 'utf8');
    assert.match(skill, /Windows/);
    assert.match(skill, /macOS/);
    assert.match(skill, /automatic/);
    assert.match(skill, /explicit/);
    assert.match(skill, /UBOOT/);
    assert.match(skill, /PLUGIN_DATA/);
  }
});

test('macOS temporary runtime preserves all stdio, private modes and cleanup', { skip: process.platform !== 'darwin' }, async t => {
  const payloadSource = `import {statSync} from 'node:fs';import path from 'node:path';export async function startStdio(){let input='';for await(const chunk of process.stdin)input+=chunk;process.stderr.write('payload stderr\\n');process.stdout.write(JSON.stringify({input,nodeMode:statSync(process.execPath).mode&0o777,cacheMode:statSync(path.dirname(process.execPath)).mode&0o777,data:process.env.PLUGIN_DATA}));}`;
  const root = await packageFixture(t, { payloadSource }), run = invoke(root, [], { input: 'MCP stdin preserved\n' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, 'payload stderr\n');
  assert.deepEqual(JSON.parse(run.stdout), { input: 'MCP stdin preserved\n', nodeMode: 0o500, cacheMode: 0o700, data: 'preserved-user-data' });
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('fm1-forge-runtime.')), []);
});

test('macOS rejects a corrupt compressed runtime or digest and cleans partial extraction', { skip: process.platform !== 'darwin' }, async t => {
  const root = await packageFixture(t), target = selectDesktopPayload();
  const runtime = path.join(root, 'payloads', target, 'runtime', target), packed = await compressedRuntime();
  for (const [gzip, sha256] of [[packed.gzip, '0'.repeat(64) + '\n'], [packed.gzip, 'A'.repeat(64) + '\n'], [packed.gzip, packed.sha256 + '\nextra\n'], [packed.gzip, packed.sha256], [Buffer.from('invalid gzip'), packed.sha256 + '\n']]) {
    await writeFile(path.join(runtime, 'node.gz'), gzip);
    await writeFile(path.join(runtime, 'node.sha256'), sha256);
    const run = invoke(root);
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.equal(run.stderr, 'FM-1 Forge could not start. Verify the installed desktop package.\n');
    assert.deepEqual((await readdir(root)).filter(name => name.startsWith('fm1-forge-runtime.')), []);
  }
});

test('macOS supervisor forwards termination, preserves exit status and removes its runtime', { skip: process.platform !== 'darwin' }, async t => {
  const root = await packageFixture(t);
  const marker = path.join(root, 'signal-observed');
  const payloadSource = `import {writeFileSync} from 'node:fs';export async function startStdio(){process.on('SIGTERM',()=>{writeFileSync(${JSON.stringify(marker)},'TERM');process.exit(23);});setInterval(()=>{},1000);process.stdout.write('READY\\n');}`;
  await writeFile(path.join(root, 'payloads', selectDesktopPayload(), 'server/index.mjs'), payloadSource);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(path.join(root, 'runtime/node'), [path.join(root, 'start.mjs')], { cwd: root, env: { ...process.env, PATH: '', TMPDIR: root }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', signaled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Runtime signal forwarding timed out')); }, 20000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', data => { stdout += data; if (!signaled && stdout.includes('READY\n')) { signaled = true; child.kill('SIGTERM'); } });
    child.stderr.on('data', data => { stderr += data; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, signaled }); });
  });
  assert.deepEqual(result, { code: 23, signal: null, stdout: 'READY\n', stderr: '', signaled: true });
  assert.equal(await readFile(marker, 'utf8'), 'TERM');
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('fm1-forge-runtime.')), []);
});
