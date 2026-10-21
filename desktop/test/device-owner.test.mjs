import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDeviceOwner } from '../lib/device-owner.mjs';

async function fixture(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-owner-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory; }
test('independent owners sharing plugin data cannot hold the device at the same time', async t => {
  const directory = await fixture(t), first = createDeviceOwner({ directory }), second = createDeviceOwner({ directory });
  await first.acquire(); await first.acquire(); await assert.rejects(second.acquire(), { code: 'device_busy' });
  await first.release(); await second.acquire(); await second.release();
});
test('known dead owners can be reclaimed under acquisition guard but live owners cannot', async t => {
  const directory = await fixture(t), file = path.join(directory, 'fm1-device-owner.lock');
  await fs.writeFile(file, JSON.stringify({ schema: 1, pid: 987654321, ownerId: 'dead' }));
  const guarded = createDeviceOwner({ directory, isAlive: () => true }); await assert.rejects(guarded.acquire(), { code: 'device_busy' });
  const recovery = createDeviceOwner({ directory, isAlive: () => false }); await recovery.acquire(); await recovery.release();
});
test('unresolved acquisition guard is never automatically removed', async t => {
  const directory = await fixture(t); await fs.writeFile(path.join(directory, 'fm1-device-acquire.lock'), '{}');
  await assert.rejects(createDeviceOwner({ directory }).acquire(), { code: 'device_busy' });
  assert.equal(await fs.readFile(path.join(directory, 'fm1-device-acquire.lock'), 'utf8'), '{}');
});
test('owner mismatch prevents releasing a peer lock', async t => {
  const directory = await fixture(t), owner = createDeviceOwner({ directory }); await owner.acquire();
  const original = await fs.readFile(path.join(directory, 'fm1-device-owner.lock'));
  await fs.writeFile(path.join(directory, 'fm1-device-owner.lock'), JSON.stringify({ schema: 1, pid: process.pid, ownerId: 'peer' }));
  await assert.rejects(owner.release(), { code: 'device_busy' });
  await fs.writeFile(path.join(directory, 'fm1-device-owner.lock'), original); await owner.release();
});
