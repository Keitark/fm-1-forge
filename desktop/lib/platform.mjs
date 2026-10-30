import path from 'node:path';
import os from 'node:os';

/** The installed native edition is selected from the actual OS and CPU at startup. */
export function resolveDesktopPlatform({ platform = process.platform, arch = process.arch } = {}) {
  if (platform === 'win32' && arch === 'x64') return Object.freeze({ platform, arch, label: 'Windows', name: 'FM-1 Forge Windows', resourceUri: 'ui://fm1/forge-windows-v8.html', uiExport: 'WINDOWS_UI_HTML' });
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) return Object.freeze({ platform, arch, label: 'macOS', name: 'FM-1 Forge macOS', resourceUri: 'ui://fm1/forge-macos-v1.html', uiExport: 'MACOS_UI_HTML' });
  throw Object.assign(new Error('FM-1 Forge requires Windows x64 or macOS Apple Silicon / Intel.'), { code: 'unsupported_desktop_platform' });
}

export function desktopDataDirectory({ platform = process.platform, arch = process.arch, env = process.env, home = os.homedir() } = {}) {
  const edition = resolveDesktopPlatform({ platform, arch });
  if (env.PLUGIN_DATA !== undefined) return env.PLUGIN_DATA;
  return edition.platform === 'darwin'
    ? path.posix.join(home, 'Library', 'Application Support', 'FM1Forge', 'macOS')
    : path.win32.join(env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local'), 'FM1Forge', 'Windows');
}
