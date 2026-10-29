import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateCustomBuild } from '../package-custom.mjs';
import { buildCustomFwsc, inspectCustomFwsc, validateCustomManifest, customProfilePolicy,
  customPackageFormat as format, CUSTOM_IDENTITY } from '../custom-package.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const buildId = '3'.repeat(64), digest = '1'.repeat(64);
function application() {
  const app = new Uint8Array(2009);
  app.set(Buffer.from(buildId, 'hex'), 100);
  app.set(Buffer.from('FM1FW/1 MOD-EDITOR/1 '), 150);
  return app;
}
function trackerBuild(app) {
  return {
    status: 'LINKED_USB_DIAGNOSTIC_UNTESTED', flashable: false, device_operations_performed: false,
    mod: true, factory_diag: false, usb_midi_update: false, nes_smb1: false, mdx: false,
    mod_usb_audio: true, mod_uvc: true, usb_audio: true, usb_video: true,
    application_bytes: app.length, application_sha256: sha(app),
    tracker_cdc_contract: { profile: 'protracker', identity: 'MOD-EDITOR/1', build_id: buildId,
      query: 'FWINFO', nonce_bytes: 16, vid: '3654', pid: '5155', installation_enabled: false, hardware_accepted: false },
    static_audit: { static_audit: 'passed', usb_mod: true, factory_diag: false, usb_midi_update: false,
      usb_audio: true, usb_video: true, usb_bootloader_entry: true, hardware_boot_verified: false,
      flashable: false, application_bytes: app.length, application_sha256: sha(app), entry: '0x2000120',
      tracker_cdc_identity: { symbol: 'fm1_tracker_build_id', build_id: buildId, nonce_bytes: 16, read_only: true } },
    source_sha256: { 'source.c': sha(Buffer.from('source')) },
    archive_sha256: { 'library.a': sha(Buffer.from('archive')) },
    vendor_overlay_sources: { 'generated-usb.c': sha(Buffer.from('overlay')) },
  };
}
const sourceData = new Map([['source.c', 'source'], ['library.a', 'archive'], ['generated-usb.c', 'overlay']]);
const readSource = async name => Buffer.from(sourceData.get(name) ?? 'unexpected');
function manifestFixture(profile = 'protracker') {
  const policy = customProfilePolicy(profile);
  return { schemaVersion: 1, policy_version: 'customfwsc-v1', package_sha256: digest, logical_sha256: digest,
    raw_bytes: 623156, logical_bytes: 623136, target_build_sha256: buildId,
    expected_boot_identity: policy.expected_boot_identity, family: policy.family, profile,
    source_stock_sha256: 'db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a',
    ota_sha256: 'ef1f2db89b011fa53e71df363f0122de0ea896618c53fb53e8da676322004541',
    application_sha256: digest, application_bytes: 32, preservation: 'public-v15-fixed-layout-app-only',
    hardware_qualified: false, stock_tail_proof: { block_bytes: 32, mutable_blocks: 1, boundary_prefix_hex: '', prefix_hashes: [digest] } };
}

test('tracker and diagnostics select closed, immutable identity/transport tuples', () => {
  assert.deepEqual(customProfilePolicy('protracker'), { profile: 'protracker', expected_boot_identity: 'MOD-EDITOR/1', family: 9, verification_transport: 'cdc' });
  assert.deepEqual(customProfilePolicy('forge-diag'), { profile: 'forge-diag', expected_boot_identity: CUSTOM_IDENTITY, family: 8, verification_transport: 'midi' });
  assert.ok(Object.isFrozen(customProfilePolicy('protracker')));
  for (const invalid of [undefined, null, true, 9, 'tracker', 'PROTRACKER', '__proto__', {}, []]) {
    assert.throws(() => customProfilePolicy(invalid), /profile/);
  }
  validateCustomManifest(manifestFixture());
  validateCustomManifest(manifestFixture('forge-diag'));
  for (const change of [m => m.family = 8, m => m.expected_boot_identity = CUSTOM_IDENTITY,
    m => m.profile = 'forge-diag', m => m.verification_transport = 'midi', m => m.family = '9',
    m => m.hardware_qualified = true]) {
    const bad = manifestFixture(); change(bad); assert.throws(() => validateCustomManifest(bad));
  }
});

test('tracker build validates the exact read-only CDC ABI and all source/overlay digests', async () => {
  const app = application(), build = trackerBuild(app), reads = [];
  assert.equal(await validateCustomBuild(app, build, { readSource: async name => { reads.push(name); return readSource(name); } }), buildId);
  assert.deepEqual(reads.sort(), [...sourceData.keys()].sort());
  assert.equal(build.usb_midi_update, false);
  assert.equal(build.factory_diag, false);
});

test('tracker flags cannot be missing, coerced or relabelled as diagnostics/MIDI', async () => {
  const app = application();
  const expected = { mod: true, factory_diag: false, usb_midi_update: false, nes_smb1: false,
    mdx: false, mod_usb_audio: true, mod_uvc: true, usb_audio: true, usb_video: true };
  for (const [flag, value] of Object.entries(expected)) {
    for (const wrong of [undefined, !value, Number(value), String(value), null]) {
      const build = trackerBuild(app);
      if (wrong === undefined) delete build[flag]; else build[flag] = wrong;
      await assert.rejects(validateCustomBuild(app, build, { readSource }), undefined, `${flag} must be explicit ${value}`);
    }
  }
  for (const [flag, wrong] of Object.entries({ usb_mod: false, factory_diag: true, usb_midi_update: true, usb_audio: false, usb_video: false })) {
    const build = trackerBuild(app); build.static_audit[flag] = wrong;
    await assert.rejects(validateCustomBuild(app, build, { readSource }));
  }
});

test('tracker CDC contract and linked symbol proof reject changed ABI, digest or qualification claims', async () => {
  const app = application();
  const changes = [
    b => delete b.tracker_cdc_contract, b => b.tracker_cdc_contract.profile = 'forge-diag',
    b => b.tracker_cdc_contract.identity = CUSTOM_IDENTITY, b => b.tracker_cdc_contract.query = 'HELLO',
    b => b.tracker_cdc_contract.nonce_bytes = 8, b => b.tracker_cdc_contract.nonce_bytes = '16',
    b => b.tracker_cdc_contract.vid = 0x3654, b => b.tracker_cdc_contract.pid = '0000',
    b => b.tracker_cdc_contract.installation_enabled = true, b => b.tracker_cdc_contract.hardware_accepted = true,
    b => b.tracker_cdc_contract.extra = true, b => b.tracker_cdc_contract.build_id = '0'.repeat(64),
    b => b.tracker_cdc_contract.build_id = 'A'.repeat(64), b => b.tracker_cdc_contract.build_id = '4'.repeat(64),
    b => delete b.static_audit.tracker_cdc_identity, b => b.static_audit.tracker_cdc_identity.symbol = 'other_build_id',
    b => b.static_audit.tracker_cdc_identity.build_id = '4'.repeat(64), b => b.static_audit.tracker_cdc_identity.nonce_bytes = 8,
    b => b.static_audit.tracker_cdc_identity.read_only = false, b => b.static_audit.tracker_cdc_identity.extra = true,
    b => b.static_audit.static_audit = 'failed', b => b.static_audit.hardware_boot_verified = true,
    b => b.static_audit.usb_bootloader_entry = false, b => b.static_audit.application_sha256 = digest,
    b => b.application_sha256 = digest, b => b.device_operations_performed = true,
  ];
  for (const change of changes) {
    const build = trackerBuild(app); change(build);
    await assert.rejects(validateCustomBuild(app, build, { readSource }));
  }
  const absent = new Uint8Array(app.length), build = trackerBuild(absent);
  await assert.rejects(validateCustomBuild(absent, build, { readSource }), /declared build identity/);
});

test('tracker packaging refuses stale or malformed vendor overlay closure', async () => {
  const app = application();
  for (const overlay of [undefined, {}, [], { 'generated-usb.c': {} }, { 'generated-usb.c': digest }]) {
    const build = trackerBuild(app); build.vendor_overlay_sources = overlay;
    await assert.rejects(validateCustomBuild(app, build, { readSource }), /source|closure|digest|archive/i);
  }
  const build = trackerBuild(app);
  await assert.rejects(validateCustomBuild(app, build, { readSource: async name => name === 'generated-usb.c' ? Buffer.from('changed overlay') : readSource(name) }), /changed/);
});

test('tracker stock fixture retains wrapper identity, preserved bytes and CDC metadata', { skip: !process.env.FM1_PUBLIC_V15_FWSC }, async () => {
  const stock = await fs.readFile(process.env.FM1_PUBLIC_V15_FWSC);
  const app = process.env.FM1_TRACKER_APP_BIN ? await fs.readFile(process.env.FM1_TRACKER_APP_BIN) : application();
  const target = process.env.FM1_TRACKER_BUILD_ID ?? buildId;
  const stockBefore = sha(stock), appBefore = sha(app);
  const { raw, manifest } = await buildCustomFwsc({ stockPackage: stock, application: app, targetBuildSha256: target, profile: 'protracker' });
  const inspected = await inspectCustomFwsc(raw, manifest);
  assert.equal(manifest.profile, 'protracker'); assert.equal(manifest.expected_boot_identity, 'MOD-EDITOR/1'); assert.equal(manifest.family, 9);
  assert.equal(inspected.metadata.product, CUSTOM_IDENTITY); assert.equal(inspected.metadata.expected_boot_identity, 'MOD-EDITOR/1');
  assert.equal(inspected.metadata.profile, 'protracker'); assert.equal(inspected.metadata.family, 9); assert.equal(inspected.metadata.verification_transport, 'cdc');
  assert.equal(inspected.metadata.application_sha256, appBefore);
  assert.equal(sha(stock), stockBefore); assert.equal(sha(app), appBefore);
  assert.doesNotThrow(() => format.unwrapFwsc(raw, CUSTOM_IDENTITY));
  assert.throws(() => format.unwrapFwsc(raw, 'MOD-EDITOR/1'));
  const original = format.parseUfw(format.unwrapFwsc(stock, 'FM-1_015'), { verifyPayloadCrc: false }).entries[0].data;
  const entries = format.parseUfw(inspected.image).entries, flash = entries[0].data;
  for (const [begin, end] of [[0, 0x4000], [0x4040, 0x4120], [0x4120 + app.length, original.length]]) {
    assert.ok(Buffer.from(flash.subarray(begin, end)).equals(Buffer.from(original.subarray(begin, end))), 'Non-application bytes changed');
  }
  const altered = Uint8Array.from(flash); altered[0x100] ^= 1;
  const image = format.makeUfw(altered, entries[1].data), corrupted = format.wrapFwsc(image, CUSTOM_IDENTITY);
  await assert.rejects(inspectCustomFwsc(corrupted, { ...manifest, package_sha256: sha(corrupted), logical_sha256: sha(image) }), /boot\/config\/reserved/);
});
