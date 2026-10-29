// Offline package acceptance: never enumerate, open or write a device.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { Client } from '../../site/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import { StdioClientTransport } from '../../site/node_modules/@modelcontextprotocol/client/dist/stdio.mjs';

const [root, ...extra] = process.argv.slice(2);
assert.ok(root && path.isAbsolute(root) && extra.length === 0);
const manifest = JSON.parse(await fs.readFile(path.join(root, 'BUILD-MANIFEST.json'), 'utf8'));
assert.equal(manifest.format, 'fm1-forge-windows-package-v1');
assert.equal(manifest.platform, 'win32'); assert.equal(manifest.arch, 'x64');
for (const record of manifest.files) {
  assert.ok(!path.isAbsolute(record.path) && !record.path.split(/[\\/]/).includes('..'));
  const bytes = await fs.readFile(path.join(root, record.path));
  assert.equal(bytes.length, record.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
}
assert.ok(manifest.files.some(file => file.path === 'server/windows-tracker-cdc.ps1'));
assert.ok(manifest.files.some(file => file.path === 'server/midi-worker.mjs'));
// Exercise the real packaged IPC entrypoint without creating its lazy MIDI
// backend: a close-only request must acknowledge and exit with no device I/O.
await new Promise((resolve, reject) => {
  let acknowledged = false;
  const child = fork(path.join(root, 'server/midi-worker.mjs'), [], { execPath: path.join(root, 'runtime/win32-x64/node.exe'), windowsHide: true,
    execArgv: [], stdio: ['ignore','ignore','ignore','ipc'], env: { PATH: '', SystemRoot: process.env.SystemRoot } });
  const timer = setTimeout(() => { child.kill(); reject(new Error('Packaged MIDI worker did not exit.')); }, 5000);
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('message', reply => { try { assert.deepEqual(reply, { id: 1, ok: true, result: null }); acknowledged = true; } catch (error) { child.kill(); reject(error); } });
  child.on('exit', code => { clearTimeout(timer); if (code === 0 && acknowledged) resolve(); else reject(new Error('Packaged MIDI IPC close failed.')); });
  child.send({ id: 1, op: 'close', args: {} });
});
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fm1-windows-passive-'));
const checks = [];
for (const revision of ['2026-07-28', '2025-11-25', '2024-11-05']) {
  const data = path.join(temp, revision); await fs.mkdir(data);
  const transport = new StdioClientTransport({ command: path.join(root, 'runtime/win32-x64/node.exe'), args: [path.join(root, 'server/index.mjs')], cwd: root,
    env: { PATH: '', SystemRoot: process.env.SystemRoot, USERPROFILE: os.homedir(), PLUGIN_DATA: data, TEMP: data, TMP: data }, stderr: 'pipe' });
  const client = new Client({ name: 'FM1 Windows passive package check', version: '1' }, { capabilities: {}, supportedProtocolVersions: [revision], versionNegotiation: { mode: revision === '2026-07-28' ? { pin: revision } : 'legacy' } });
  try {
    await client.connect(transport); assert.equal(client.getServerVersion().version, manifest.version);
    assert.equal(client.getServerVersion().name, 'FM-1 Forge Windows');
    const tools = (await client.listTools()).tools; assert.equal(tools.length, 26);
    for (const name of ['start_fm1_custom_update', 'verify_fm1_custom_boot']) assert.deepEqual(tools.find(tool => tool.name === name)._meta.ui.visibility, ['app']);
    const opened = await client.callTool({ name: 'open_fm1_library', arguments: {} }); assert.ok(!opened.isError); assert.equal(opened.structuredContent.desktop.platform, 'win32');
    for (const name of ['get_fm1_stock_update_status', 'get_fm1_custom_update_status']) {
      const status = await client.callTool({ name, arguments: {} }); assert.deepEqual(status.structuredContent, { supported: true, writing: false, attempt: null, review: null });
    }
    const panel = await client.readResource({ uri: 'ui://fm1/forge-windows-v7.html' });
    assert.ok(panel.contents[0].text.includes('Verify tracker boot'));
    checks.push({ revision, tools: tools.length, emptyPath: true, passive: true });
  } finally { await client.close(); }
}
console.log(JSON.stringify({ version: manifest.version, verifiedFiles: manifest.files.length + 1, checks, deviceOpened: false, firmwareWritten: false }));
