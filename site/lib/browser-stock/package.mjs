import { STOCK, StockError, logicalImage, productOf } from './protocol.mjs';
export async function sha256(input, crypto = globalThis.crypto) {
  if (typeof crypto?.subtle?.digest !== 'function') throw new StockError('crypto_unavailable', 'WebCrypto SHA-256 is required.');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input)), value => value.toString(16).padStart(2, '0')).join('');
}
export async function inspectStockPackage(input, crypto = globalThis.crypto) {
  let raw;
  if (input instanceof Uint8Array) raw = Uint8Array.from(input);
  else if (input instanceof ArrayBuffer) raw = new Uint8Array(input.slice(0));
  else if (input && typeof input.arrayBuffer === 'function' && input.size === STOCK.rawBytes) raw = Uint8Array.from(new Uint8Array(await input.arrayBuffer()));
  else throw new StockError('invalid_package', 'Select the unmodified official V15 package.');
  if (raw.length !== STOCK.rawBytes || productOf(raw) !== STOCK.product) throw new StockError('invalid_package', 'Only the exact official V15 package is supported.');
  const digest = await sha256(raw, crypto);
  if (digest !== STOCK.sha256) throw new StockError('invalid_package', 'The stock V15 package SHA-256 does not match.');
  return { metadata: Object.freeze({ product: STOCK.product, sha256: digest, raw_bytes: STOCK.rawBytes, logical_bytes: STOCK.logicalBytes }), image: logicalImage(raw) };
}
