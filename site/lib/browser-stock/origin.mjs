// Classify the actual location.origin without translating the native scheme to HTTPS.
// Electron may register this as a standard scheme and normalize URL.href with a
// trailing slash. The exact native origin grammar is independent of that parser.
const NATIVE_ORIGIN = /^codex-sandbox:\/\/mcp-app-[a-f0-9]{48}\.web-sandbox\.oaiusercontent\.com$/;
export function stockOriginKind(origin) {
  if (typeof origin !== 'string' || origin === 'null') return null;
  if (NATIVE_ORIGIN.test(origin)) return 'native';
  let url;
  try { url = new URL(origin); } catch { return null; }
  if (['http:', 'https:'].includes(url.protocol) && url.origin === origin) return 'web';
  return null;
}
export function usableStockOrigin(origin, secureContext) {
  const kind = stockOriginKind(origin);
  return kind === 'web' || kind === 'native' && secureContext === true;
}
