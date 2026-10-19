import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { absolutePath, checkPath, readJson } from '../../tools/jieli-wl82/stock-sysex/files.mjs';
import { StockError } from '../../tools/jieli-wl82/stock-sysex/protocol.mjs';

const busy = () => new StockError('device_busy', 'Another Forge process owns the FM-1 connection.');
const alive = pid => { if (!Number.isSafeInteger(pid) || pid < 1) return true; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };

// One fixed local lease covers read-only handles and the complete OTA transaction,
// including intervals in which Windows temporarily has no MIDI endpoint.
export function createDeviceOwner({ directory, isAlive = alive } = {}) {
  const root = absolutePath(directory), file = path.join(root, 'fm1-device-owner.lock'), guardFile = path.join(root, 'fm1-device-acquire.lock');
  let handle = null, ownerId = null;
  const acquire = async () => {
    if (handle) return;
    await checkPath(root, true); await fs.mkdir(root, { recursive: true, mode: 0o700 });
    if (!(await checkPath(root)).isDirectory()) throw new StockError('unsafe_path', 'Forge device storage is invalid.');
    await checkPath(guardFile, true);
    let guard;
    try { guard = await fs.open(guardFile, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') throw busy(); throw error; }
    let guardWritten = false;
    const guardId = randomUUID();
    try {
      await guard.writeFile(JSON.stringify({ pid: process.pid, ownerId: guardId })); await guard.sync(); guardWritten = true;
      await checkPath(file, true);
      try { handle = await fs.open(file, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const prior = await readJson(file);
        // A live, invalid or unprovable owner is never stolen. Dead PID takeover
        // is serialized; the independent attempt journal still blocks new writes.
        if (!prior || prior.schema !== 1 || typeof prior.ownerId !== 'string' || isAlive(prior.pid)) throw busy();
        await fs.unlink(file);
        try { handle = await fs.open(file, 'wx', 0o600); } catch { throw busy(); }
      }
      ownerId = randomUUID();
      await handle.writeFile(JSON.stringify({ schema: 1, pid: process.pid, ownerId })); await handle.sync();
    } catch (error) {
      if (handle) { await handle.close(); handle = null; }
      throw error;
    } finally {
      await guard.close();
      if (guardWritten) {
        const owner = await readJson(guardFile);
        if (owner.pid !== process.pid || owner.ownerId !== guardId) throw busy();
        await fs.unlink(guardFile);
      }
    }
  };
  const release = async () => {
    if (!handle) return;
    const owner = await readJson(file);
    if (owner.pid !== process.pid || owner.ownerId !== ownerId) throw busy();
    await handle.close(); handle = null; ownerId = null; await fs.unlink(file);
  };
  return Object.freeze({ acquire, release });
}
