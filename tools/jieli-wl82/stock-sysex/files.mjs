import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { STOCK, StockError, productOf, logicalImage } from './protocol.mjs';

export function absolutePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') ||
      value.split(/[\\/]/).some(part => part === '..') || (process.platform === 'win32' && value.slice(2).includes(':'))) {
    throw new StockError('unsafe_path', 'An absolute local path without traversal is required.');
  }
  return path.resolve(value);
}
export async function checkPath(value, allowMissing = false) {
  const resolved = absolutePath(value), root = path.parse(resolved).root;
  let cursor = root, leaf;
  for (const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try { leaf = await fs.lstat(cursor); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') continue; throw new StockError('unavailable_path', 'Required local file or directory is unavailable.'); }
    if (leaf.isSymbolicLink()) throw new StockError('unsafe_path', 'Symbolic links and junctions are not allowed.');
    if (cursor !== resolved && !leaf.isDirectory()) throw new StockError('unsafe_path', 'Path ancestor is not a directory.');
  }
  return leaf;
}
export async function inspectPackage(localPackagePath) {
  const resolved = absolutePath(localPackagePath), stat = await checkPath(resolved);
  if (!stat?.isFile() || stat.size !== STOCK.rawBytes) throw new StockError('invalid_package', 'Only the exact stock V15 package is supported.');
  const handle = await fs.open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let raw;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== STOCK.rawBytes) throw new StockError('invalid_package', 'Stock package changed during validation.');
    raw = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new StockError('invalid_package', 'Stock package changed during validation.');
  } finally { await handle.close(); }
  const sha256 = createHash('sha256').update(raw).digest('hex');
  if (sha256 !== STOCK.sha256 || raw.length !== STOCK.rawBytes || productOf(raw) !== STOCK.product) throw new StockError('invalid_package', 'The package is not the pinned, unmodified official V15.');
  return { metadata: Object.freeze({ product: STOCK.product, sha256, raw_bytes: raw.length, logical_bytes: STOCK.logicalBytes }), image: logicalImage(raw) };
}

export async function atomicJson(file, data) {
  await checkPath(path.dirname(file)); await checkPath(file, true);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(data)}\n`); await handle.sync(); await handle.close(); handle = null;
    await checkPath(file, true); await fs.rename(temporary, file);
    // Windows does not allow opening a directory for fsync. The file itself was synced before rename.
    if (process.platform !== 'win32') { const directory = await fs.open(path.dirname(file), 'r'); try { await directory.sync(); } finally { await directory.close(); } }
  } finally {
    if (handle) await handle.close();
    try { await fs.unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
export async function readJson(file, missing = false) {
  let stat;
  try { stat = await checkPath(file); }
  catch (error) { if (missing && error.code === 'unavailable_path') { try { await fs.lstat(file); } catch (io) { if (io.code === 'ENOENT') return null; } } throw error; }
  if (!stat.isFile() || stat.size > 65536) throw new StockError('corrupt_journal', 'Attempt journal is invalid.');
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { throw new StockError('corrupt_journal', 'Attempt journal is invalid.'); }
}
