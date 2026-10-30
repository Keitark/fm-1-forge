import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createTrackerVerifier, trackerCdcProof } from '../tracker-cdc.mjs';

const build = 'a'.repeat(64), nonce = 'b'.repeat(32);
const proof = changes => ({ identity: 'MOD-EDITOR/1', transport: 'cdc', vid: '3654', pid: '5155', port: 'COM4', build_sha256: build, nonce, ...changes });

test('fixed Windows verifier opens the tracker CDC session with DTR and keeps its command and port scope closed', async () => {
  const source = await fs.readFile(new URL('../windows-tracker-cdc.ps1', import.meta.url), 'utf8');
  assert.match(source, /\$port\.RtsEnable\s*=\s*\$false/);
  const sequence = ['$port.DtrEnable = $false', '$port.Open()', '$port.DtrEnable = $true', 'if (($TimeoutMs - $watch.ElapsedMilliseconds) -le 300) { break }', 'Start-Sleep -Milliseconds 300', 'if ($watch.ElapsedMilliseconds -ge $TimeoutMs) { break }', '$port.Write("FWINFO $Nonce`n")'];
  const positions = sequence.map(step => source.indexOf(step));
  assert.ok(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])), 'CDC must open, assert DTR, settle within deadline, then send the fixed challenge');
  assert.doesNotMatch(source, /Discard(?:In|Out)Buffer/);
  assert.match(source, /\$queryStart\) -lt 2500/);
  const parameters = /param\(([\s\S]*?)\)\s*\$ErrorActionPreference/.exec(source)?.[1];
  assert.ok(parameters);
  assert.deepEqual([...parameters.matchAll(/\]\s*\$(\w+)/g)].map(match => match[1]), ['BuildSha256', 'Nonce', 'TimeoutMs']);
  assert.deepEqual([...source.matchAll(/\$port\.Write\(([^\r\n]*)\)/g)].map(match => match[1]), ['"FWINFO $Nonce`n"']);
  assert.match(source, /VID_3654&PID_5155/);
  assert.match(source, /\$ports\.Count -gt 1/);
  assert.match(source, /FM1FW\/1 MOD-EDITOR\/1/);
});
test('CDC proof requires exact tracker identity, fresh nonce, build and USB identity', () => {
  assert.deepEqual(trackerCdcProof(proof(), build, nonce), { text: 'MOD-EDITOR/1', buildSha256: build, transport: 'cdc', nonceVerified: true });
  for (const value of [null, proof({ identity: 'FM1_FORGE_001' }), proof({ nonce: 'c'.repeat(32) }), proof({ vid: '4c4a' }), proof({ pid: 'c755' }), proof({ port: 'COM4;other' }), proof({ transport: 'midi' })]) assert.throws(() => trackerCdcProof(value, build, nonce), { code: 'boot_identity_mismatch' });
  assert.throws(() => trackerCdcProof(proof({ build_sha256: 'c'.repeat(64) }), build, nonce), { code: 'boot_build_mismatch' });
});
test('packaged verifier sends only fixed bounded hidden CDC challenge and validates returned proof', async () => {
  let called = 0;
  const verify = createTrackerVerifier({ platform: 'win32', random: () => Buffer.from(nonce, 'hex'), run: async (executable, args, options) => {
    called++; assert.match(executable, /WindowsPowerShell.*powershell\.exe$/);
    assert.deepEqual(args.slice(-6), ['-BuildSha256', build, '-Nonce', nonce, '-TimeoutMs', '2000']);
    assert.equal(options.windowsHide, true); assert.equal(options.shell, false); assert.equal(options.timeout, 5000); assert.equal(options.maxBuffer, 8192);
    return { stdout: JSON.stringify(proof()) };
  } });
  assert.equal((await verify({ buildSha256: build, timeoutMs: 2000 })).nonceVerified, true); assert.equal(called, 1);
  for (const value of [{ buildSha256: build, timeoutMs: 40001 }, { buildSha256: build, timeoutMs: 0 }, { buildSha256: '0'.repeat(64) }, { buildSha256: `${build};command` }]) await assert.rejects(verify(value), { code: 'invalid_package' });
  assert.equal(called, 1); assert.equal(createTrackerVerifier({ platform: 'darwin' }), null);
});
test('missing, malformed, ambiguous, stale and wrong-build CDC evidence cannot pass', async () => {
  for (const output of ['', '{', ' '.repeat(4097), JSON.stringify(proof({ nonce: 'c'.repeat(32) })), JSON.stringify(proof({ build_sha256: 'c'.repeat(64) }))]) {
    const verify = createTrackerVerifier({ platform: 'win32', random: () => Buffer.from(nonce, 'hex'), run: async () => ({ stdout: output }) });
    await assert.rejects(verify({ buildSha256: build }));
  }
  for (const code of ['ambiguous_device', 'boot_build_mismatch', 'cdc_busy', 'reboot_timeout']) {
    const verify = createTrackerVerifier({ platform: 'win32', run: async () => { throw Object.assign(new Error('untrusted local detail'), { stderr: code }); } });
    await assert.rejects(verify({ buildSha256: build }), error => error.code === code && !error.message.includes('untrusted'));
  }
});
