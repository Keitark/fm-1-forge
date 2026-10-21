// SPDX-License-Identifier: MIT
// Offline packaging only. Never imports a MIDI implementation or opens a device.
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { absolutePath, checkPath } from './files.mjs';
import { buildCustomFwsc, CUSTOM_APPLICATION_MAX_BYTES } from './custom-package.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
const require = (condition, message) => { if (!condition) throw new Error(message); };
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
  const contract = build.usb_midi_update_contract, audit = build.static_audit;
  require(build.status === 'LINKED_USB_DIAGNOSTIC_UNTESTED' && build.flashable === false && build.factory_diag === true &&
    build.usb_midi_update === true && build.device_operations_performed === false &&
    build.application_bytes === application.length && build.application_sha256 === sha(application), 'Build manifest does not describe this unflashed Forge application.');
  require(contract !== null && typeof contract === 'object' && contract.family === 8 &&
    typeof contract.build_id === 'string' && /^[0-9a-f]{64}$/.test(contract.build_id) && contract.build_id !== '0'.repeat(64) &&
    contract.loader_compatible === false && contract.installation_enabled === false && contract.hardware_accepted === false,
  'Firmware MIDI contract is absent or its installation guard changed.');
  require(audit !== null && typeof audit === 'object' && audit.static_audit === 'passed' && audit.factory_diag === true &&
    audit.usb_midi_update === true && audit.usb_midi_installation_enabled === false && audit.usb_bootloader_entry === true &&
    audit.hardware_boot_verified === false && audit.flashable === false && audit.application_bytes === application.length &&
    audit.application_sha256 === sha(application) && audit.entry === '0x2000120', 'Linked application audit is absent or inconsistent.');
  // The source-closure digest is emitted as the 32-byte firmware build identity.
  // Never substitute the JSON file's digest for this wire-protocol identity.
  require(Buffer.from(application).includes(Buffer.from(contract.build_id, 'hex')), 'The firmware does not contain its declared MIDI build identity.');
  for (const name of ['source_sha256', 'archive_sha256']) {
    const sources = build[name];
    require(sources !== null && typeof sources === 'object' && !Array.isArray(sources) && Object.keys(sources).length > 0 && Object.keys(sources).length <= 4096,
      'Build source closure is absent.');
    for (const [file, digest] of Object.entries(sources)) {
      require(typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest), 'Build source digest is invalid.');
      const data = await readSource(file, 64 * 1024 * 1024);
      require(sha(data) === digest, 'Build source or linked archive changed; rebuild and audit before packaging.');
    }
  }
  return contract.build_id;
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
  const {raw,manifest} = await buildCustomFwsc({stockPackage:stock,application,targetBuildSha256:buildId});
  const output = options['--out']; await checkPath(path.dirname(output)); await checkPath(output,true);
  // A new directory is mandatory. No existing candidate is replaced or removed.
  await fs.mkdir(output, {recursive:false,mode:0o700});
  await fs.writeFile(path.join(output,'firmware.fwsc'),raw,{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(output,'firmware.json'),`${JSON.stringify(manifest,null,2)}\n`,{flag:'wx',mode:0o600});
  const receipt={schemaVersion:1,package_sha256:manifest.package_sha256,application_sha256:manifest.application_sha256,
    target_build_sha256:buildId,build_manifest_sha256:sha(buildBytes),source_stock_sha256:manifest.source_stock_sha256,
    public_template:true,device_operations_performed:false,hardware_qualified:false,
    note:'Offline custom candidate. Source-closure checks passed. No device was opened or firmware installed.'};
  await fs.writeFile(path.join(output,'packaging-receipt.json'),`${JSON.stringify(receipt,null,2)}\n`,{flag:'wx',mode:0o600});
  return {output,raw_bytes:raw.length,...receipt};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  packageCustom(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.error(error.message);process.exitCode=1;
  });
}
