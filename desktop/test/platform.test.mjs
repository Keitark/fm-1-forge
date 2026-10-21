import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDesktopPlatform, desktopDataDirectory } from '../lib/platform.mjs';

test('native targets retain the Windows edition and explicitly select both macOS CPUs', () => {
  assert.deepEqual(resolveDesktopPlatform({ platform: 'win32', arch: 'x64' }), { platform: 'win32', arch: 'x64', label: 'Windows', name: 'FM-1 Forge Windows', resourceUri: 'ui://fm1/forge-windows-v4.html', uiExport: 'WINDOWS_UI_HTML' });
  for (const arch of ['arm64', 'x64']) {
    const edition = resolveDesktopPlatform({ platform: 'darwin', arch });
    assert.equal(edition.platform, 'darwin'); assert.equal(edition.arch, arch);
    assert.equal(edition.name, 'FM-1 Forge macOS'); assert.equal(edition.resourceUri, 'ui://fm1/forge-macos-v1.html'); assert.equal(edition.uiExport, 'MACOS_UI_HTML'); assert.equal(Object.isFrozen(edition), true);
  }
});

test('unsupported native platforms and architectures fail closed', () => {
  for (const [platform, arch] of [['linux', 'x64'], ['linux', 'arm64'], ['win32', 'arm64'], ['darwin', 'ia32'], ['freebsd', 'x64']]) assert.throws(() => resolveDesktopPlatform({ platform, arch }), { code: 'unsupported_desktop_platform' });
});

test('macOS metadata uses Application Support while Windows retains its existing path', () => {
  assert.equal(desktopDataDirectory({ platform: 'darwin', arch: 'arm64', env: {}, home: '/Users/test-user' }), '/Users/test-user/Library/Application Support/FM1Forge/macOS');
  assert.equal(desktopDataDirectory({ platform: 'darwin', arch: 'x64', env: { LOCALAPPDATA: 'ignored' }, home: '/Users/test-user' }), '/Users/test-user/Library/Application Support/FM1Forge/macOS');
  assert.equal(desktopDataDirectory({ platform: 'win32', arch: 'x64', env: { LOCALAPPDATA: 'C:\\Users\\test-user\\AppData\\Local' }, home: 'ignored' }), 'C:\\Users\\test-user\\AppData\\Local\\FM1Forge\\Windows');
  assert.equal(desktopDataDirectory({ platform: 'win32', arch: 'x64', env: {}, home: 'C:\\Users\\test-user' }), 'C:\\Users\\test-user\\AppData\\Local\\FM1Forge\\Windows');
});

test('host-provided PLUGIN_DATA remains authoritative for each supported edition', () => {
  for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'arm64'], ['darwin', 'x64']]) assert.equal(desktopDataDirectory({ platform, arch, env: { PLUGIN_DATA: '/host/opaque-data' }, home: '/unused' }), '/host/opaque-data');
  assert.throws(() => desktopDataDirectory({ platform: 'linux', arch: 'x64', env: { PLUGIN_DATA: '/not-an-opt-in' } }), { code: 'unsupported_desktop_platform' });
});
