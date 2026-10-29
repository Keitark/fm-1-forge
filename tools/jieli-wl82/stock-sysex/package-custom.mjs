// SPDX-License-Identifier: MIT
// Offline packaging only. Never imports a MIDI implementation or opens a device.
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { absolutePath, checkPath } from './files.mjs';
import { buildCustomFwsc, customProfilePolicy, CUSTOM_APPLICATION_MAX_BYTES } from './custom-package.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
const require = (condition, message) => { if (!condition) throw new Error(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const buildDigest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) && value !== '0'.repeat(64);
function buildProfile(build) {
  if (build.factory_diag === true && build.mod !== true) return 'forge-diag';
  require(build.mod === true && build.factory_diag === false, 'Build does not select one supported custom firmware profile.');
  return 'protracker';
}
async function readLocal(file, limit) {
  const resolved = absolutePath(file), stat = await checkPath(resolved);
  require(stat.isFile() && stat.size > 0 && stat.size <= limit, 'Input must be a bounded regular local file.');
  const handle = await fs.open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat(), data = await handle.readFile(), after = await handle.stat();
    require(before.isFile() && data.length === before.size && data.length <= limit && after.size === before.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'Input changed while it was read.');
    return data;
  } finally { await handle.close(); }
}
export async function validateCustomBuild(application, build, { readSource = readLocal } = {}) {
  require(build !== null && typeof build === 'object' && !Array.isArray(build), 'Invalid build manifest.');
  const profile = buildProfile(build), audit = build.static_audit;
  require(build.status === 'LINKED_USB_DIAGNOSTIC_UNTESTED' && build.flashable === false && build.device_operations_performed === false &&
    build.application_bytes === application.length && build.application_sha256 === sha(application), 'Build manifest does not describe this unflashed custom application.');
  require(record(audit) && audit.static_audit === 'passed' && audit.usb_bootloader_entry === true &&
    audit.hardware_boot_verified === false && audit.flashable === false && audit.application_bytes === application.length &&
    audit.application_sha256 === sha(application) && audit.entry === '0x2000120', 'Linked application audit is absent or inconsistent.');
  let buildId;
  if (profile === 'forge-diag') {
    const contract = build.usb_midi_update_contract;
    require(build.usb_midi_update === true && audit.factory_diag === true && audit.usb_midi_update === true && audit.usb_midi_installation_enabled === false,
      'Forge diagnostics require the unchanged guarded MIDI profile.');
    require(record(contract) && contract.family === 8 && buildDigest(contract.build_id) &&
      contract.loader_compatible === false && contract.installation_enabled === false && contract.hardware_accepted === false,
      'Firmware MIDI contract is absent or its installation guard changed.');
    buildId = contract.build_id;
  } else {
    const contract = build.tracker_cdc_contract, identity = audit.tracker_cdc_identity;
    require(build.usb_midi_update === false && build.mod_usb_audio === true && build.mod_uvc === true &&
      build.usb_audio === true && build.usb_video === true && build.nes_smb1 === false && build.mdx === false &&
      audit.usb_mod === true && audit.factory_diag === false && audit.usb_midi_update === false &&
      audit.usb_audio === true && audit.usb_video === true, 'Tracker requires the explicit CDC/UAC/UVC profile with MIDI update disabled.');
    require(exact(contract, ['profile','identity','build_id','query','nonce_bytes','vid','pid','installation_enabled','hardware_accepted']) &&
      contract.profile === 'protracker' && contract.identity === 'MOD-EDITOR/1' && buildDigest(contract.build_id) &&
      contract.query === 'FWINFO' && contract.nonce_bytes === 16 && contract.vid === '3654' && contract.pid === '5155' &&
      contract.installation_enabled === false && contract.hardware_accepted === false,
      'Tracker CDC contract is absent or its read-only identity guard changed.');
    require(exact(identity, ['symbol','build_id','nonce_bytes','read_only']) && identity.symbol === 'fm1_tracker_build_id' &&
      identity.build_id === contract.build_id && identity.nonce_bytes === 16 && identity.read_only === true,
      'Linked tracker CDC identity audit is absent or inconsistent.');
    buildId = contract.build_id;
  }
  // The source-closure digest is emitted as the 32-byte firmware build identity.
  // Never substitute the JSON file's digest for this wire-protocol identity.
  require(Buffer.from(application).includes(Buffer.from(buildId, 'hex')), 'The firmware does not contain its declared build identity.');
  for (const name of profile === 'protracker' ? ['source_sha256', 'archive_sha256', 'vendor_overlay_sources'] : ['source_sha256', 'archive_sha256']) {
    const sources = build[name];
    require(sources !== null && typeof sources === 'object' && !Array.isArray(sources) && Object.keys(sources).length > 0 && Object.keys(sources).length <= 4096,
      'Build source closure is absent.');
    for (const [file, digest] of Object.entries(sources)) {
      require(typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest), 'Build source digest is invalid.');
      const data = await readSource(file, 64 * 1024 * 1024);
      require(sha(data) === digest, 'Build source or linked archive changed; rebuild and audit before packaging.');
    }
  }
  return buildId;
}
export async function packageCustom(argv) {
  const names = ['--stock','--application','--build-manifest','--out'], options = {};
  require(argv.length === names.length * 2, 'Usage: node package-custom.mjs --stock ABS_V15_FWSC --application ABS_APP_BIN --build-manifest ABS_BUILD_JSON --out ABS_FRESH_DIRECTORY');
  for (let i=0;i<argv.length;i+=2) {
    require(names.includes(argv[i]) && !Object.hasOwn(options,argv[i]), 'Unknown or duplicate argument.');
    options[argv[i]] = absolutePath(argv[i+1]);
  }
  require(names.every(name => options[name]), 'All four named paths are required.');
  const stock = await readLocal(options['--stock'], 2*1024*1024), application = await readLocal(options['--application'], CUSTOM_APPLICATION_MAX_BYTES);
  const buildBytes = await readLocal(options['--build-manifest'], 2*1024*1024);
  let build; try { build = JSON.parse(buildBytes.toString('utf8')); } catch { throw new Error('Build manifest is not valid JSON.'); }
  const buildId = await validateCustomBuild(application, build);
  const profile = buildProfile(build), profilePolicy = customProfilePolicy(profile);
  const {raw,manifest} = await buildCustomFwsc({stockPackage:stock,application,targetBuildSha256:buildId,profile});
  const output = options['--out']; await checkPath(path.dirname(output)); await checkPath(output,true);
  // A new directory is mandatory. No existing candidate is replaced or removed.
  await fs.mkdir(output, {recursive:false,mode:0o700});
  await fs.writeFile(path.join(output,'firmware.fwsc'),raw,{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(output,'firmware.json'),`${JSON.stringify(manifest,null,2)}\n`,{flag:'wx',mode:0o600});
  const receipt={schemaVersion:1,package_sha256:manifest.package_sha256,application_sha256:manifest.application_sha256,
    target_build_sha256:buildId,build_manifest_sha256:sha(buildBytes),source_stock_sha256:manifest.source_stock_sha256,
    public_template:true,device_operations_performed:false,hardware_qualified:false,
    ...(profile === 'protracker' ? { profile, expected_boot_identity: profilePolicy.expected_boot_identity,
      family: profilePolicy.family, verification_transport: profilePolicy.verification_transport } : {}),
    note:'Offline custom candidate. Source-closure checks passed. No device was opened or firmware installed.'};
  await fs.writeFile(path.join(output,'packaging-receipt.json'),`${JSON.stringify(receipt,null,2)}\n`,{flag:'wx',mode:0o600});
  return {output,raw_bytes:raw.length,...receipt};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  packageCustom(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.error(error.message);process.exitCode=1;
  });
}
