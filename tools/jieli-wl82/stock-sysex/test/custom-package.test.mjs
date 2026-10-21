import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildCustomFwsc, inspectCustomFwsc, validateCustomManifest, customPackageFormat as format,
  CUSTOM_APPLICATION_MAX_BYTES, CUSTOM_IDENTITY, MAX_CUSTOM_FWSC_BYTES } from '../custom-package.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const put16 = (bytes, at, n) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(at, n, true);
const put32 = (bytes, at, n) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(at, n, true);
const digest = '1'.repeat(64);
function manifestFixture() {
  return { schemaVersion:1, policy_version:'customfwsc-v1', package_sha256:digest, logical_sha256:digest,
    raw_bytes:623156, logical_bytes:623136, target_build_sha256:digest, expected_boot_identity:CUSTOM_IDENTITY,
    family:8, profile:'forge-diag', source_stock_sha256:'db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a',
    ota_sha256:'ef1f2db89b011fa53e71df363f0122de0ea896618c53fb53e8da676322004541',
    application_sha256:digest, application_bytes:32, preservation:'public-v15-fixed-layout-app-only', hardware_qualified:false,
    stock_tail_proof:{block_bytes:32,mutable_blocks:1,boundary_prefix_hex:'',prefix_hashes:[digest]} };
}
const synthetic = () => format.makeUfw(Uint8Array.from({length:97},(_,i)=>i), Uint8Array.from({length:71},(_,i)=>255-i));
function rewriteHeaders(image, mutateHeader, mutateRecords) {
  const out = Uint8Array.from(image), head = format.cipher(out.subarray(0,64));
  if (mutateRecords) {
    for (let i=0;i<2;i++) {
      const record = format.cipher(out.subarray(64+i*80,144+i*80));
      mutateRecords(record,i); out.set(format.cipher(record),64+i*80);
    }
    put16(head,2,format.crc16(out.subarray(64,224)));
  }
  if (mutateHeader) mutateHeader(head);
  put16(head,0,format.crc16(head.subarray(2))); out.set(format.cipher(head)); return out;
}

test('public CRC16 vector and involutive header/SFC codec', () => {
  assert.equal(format.crc16(Buffer.from('123456789')), 0x31c3);
  for (const seed of [65535,0x980f,0]) {
    const vector=Uint8Array.from({length:80},(_,i)=>i*17&255);
    assert.deepEqual(format.cipher(format.cipher(vector,seed),seed),vector);
  }
});
test('synthetic two-entry UFW and all twenty product markers round trip', () => {
  const image=synthetic(), parsed=format.parseUfw(image), raw=format.wrapFwsc(image,CUSTOM_IDENTITY);
  assert.deepEqual(parsed.entries.map(e=>[e.type,e.name,e.size,e.stored]),[[0,'flash.bin',97,128],[100,'ota.bin',71,96]]);
  assert.deepEqual(format.unwrapFwsc(raw,CUSTOM_IDENTITY),image);
  for (let i=0;i<20;i++) {
    const tampered=Uint8Array.from(raw);tampered[i*48+47]^=1;
    assert.throws(()=>format.unwrapFwsc(tampered,CUSTOM_IDENTITY),/marker/);
  }
});
test('rejects header CRC, directory CRC, file CRC and alternate chip', () => {
  for (const at of [0,64,1024]) {
    const image=synthetic();image[at]^=1;assert.throws(()=>format.parseUfw(image),/CRC|header/);
  }
  assert.throws(()=>format.parseUfw(rewriteHeaders(synthetic(),h=>{h[16]=0x58;})),/header|chip/);
});
test('rejects overlapping/outside file ranges and malformed directory names', () => {
  assert.throws(()=>format.parseUfw(rewriteHeaders(synthetic(),null,(r,i)=>{if(i===1)put32(r,8,1024);})),/overlapping/);
  assert.throws(()=>format.parseUfw(rewriteHeaders(synthetic(),null,(r,i)=>{if(i===1)put32(r,12,0x7fffffff);})),/range/);
  assert.throws(()=>format.parseUfw(rewriteHeaders(synthetic(),null,(r,i)=>{if(i===0)r[79]=1;})),/name/);
});
test('Merkle proof authenticates every untouched byte, including a partial boundary block', () => {
  const original=Uint8Array.from({length:5003},(_,i)=>(i*71+i%13)&255);
  for (const length of [1,31,32,33,4095,4096,4999,5003]) {
    const proof=format.makeTailProof(original,length), baseline=format.tailDigest(proof,original);
    assert.ok(proof.prefix_hashes.length<=15);
    const candidate=Uint8Array.from(original);candidate.fill(0,0,length);
    assert.equal(format.tailDigest(proof,candidate),baseline);
    if(length<original.length){candidate[length]^=1;assert.notEqual(format.tailDigest(proof,candidate),baseline);}
    if(proof.prefix_hashes.length){
      const bad=structuredClone(proof);bad.prefix_hashes[0]='0'.repeat(64);
      assert.notEqual(format.tailDigest(bad,original),baseline);
    }
    if(proof.boundary_prefix_hex.length){
      const bad=structuredClone(proof), first=Number.parseInt(bad.boundary_prefix_hex.slice(0,2),16)^1;
      bad.boundary_prefix_hex=first.toString(16).padStart(2,'0')+bad.boundary_prefix_hex.slice(2);
      assert.notEqual(format.tailDigest(bad,original),baseline);
    }
  }
});
test('strict bounded manifest rejects unknown fields, altered pins, identity and proof shape', () => {
  const good=validateCustomManifest(manifestFixture()); assert.ok(Object.isFrozen(good.stock_tail_proof.prefix_hashes));
  for(const length of [1,31,32,33]){
    const m=manifestFixture();m.application_bytes=length;
    m.stock_tail_proof={block_bytes:32,mutable_blocks:Math.ceil(length/32),boundary_prefix_hex:'ab'.repeat(length%32),prefix_hashes:Math.floor(length/32)?[digest]:[]};
    validateCustomManifest(m);
    if(length%32){const wrong=structuredClone(m);wrong.stock_tail_proof.boundary_prefix_hex=wrong.stock_tail_proof.boundary_prefix_hex.toUpperCase();assert.throws(()=>validateCustomManifest(wrong),/proof/);}
  }
  for (const change of [m=>m.extra=true,m=>m.hardware_qualified=true,m=>m.raw_bytes=MAX_CUSTOM_FWSC_BYTES+1,
    m=>m.application_bytes=0,m=>m.application_bytes=CUSTOM_APPLICATION_MAX_BYTES+1,m=>m.source_stock_sha256=digest,
    m=>m.ota_sha256=digest,m=>m.expected_boot_identity='FM-1_015',m=>m.target_build_sha256='0'.repeat(64),
    m=>m.stock_tail_proof.mutable_blocks=2,m=>m.stock_tail_proof.prefix_hashes.push(digest),m=>m.stock_tail_proof.block_bytes=64,
    m=>m.stock_tail_proof.boundary_prefix_hex='00',m=>delete m.stock_tail_proof.boundary_prefix_hex]) {
    const bad=manifestFixture();change(bad);assert.throws(()=>validateCustomManifest(bad),/manifest|proof|size|digest|policy|fields|sha256/i);
  }
});
test('build rejects unpinned stock template and inspector never trusts a manifest digest alone', async () => {
  await assert.rejects(buildCustomFwsc({stockPackage:new Uint8Array(699956),application:new Uint8Array(64),targetBuildSha256:digest}),/pinned/);
  const raw=new Uint8Array(623156), manifest=manifestFixture();manifest.package_sha256=sha(raw);
  await assert.rejects(inspectCustomFwsc(raw,manifest),/marker/);
  await assert.rejects(inspectCustomFwsc(new Uint8Array(MAX_CUSTOM_FWSC_BYTES+1),manifest),/bounded/);
});

const stockPath=process.env.FM1_PUBLIC_V15_FWSC;
test('local public V15 fixture: exact preservation, round trip and recertified tamper rejection', {skip:!stockPath}, async () => {
  // An explicitly supplied public-template path keeps vendor bytes out of tests.
  const stock=await fs.readFile(stockPath), stockHash=sha(stock);
  const application=process.env.FM1_CUSTOM_APP_BIN ? await fs.readFile(process.env.FM1_CUSTOM_APP_BIN) : Uint8Array.from({length:1009},(_,i)=>i*41&255);
  const buildId=process.env.FM1_CUSTOM_BUILD_ID ?? digest;
  if (!process.env.FM1_CUSTOM_APP_BIN) application.set(Buffer.from(buildId,'hex'),100);
  const appBefore=sha(application), {raw,manifest}=await buildCustomFwsc({stockPackage:stock,application,targetBuildSha256:buildId});
  assert.equal(raw.length,623156);assert.equal(sha(stock),stockHash);assert.equal(sha(application),appBefore);
  const inspected=await inspectCustomFwsc(raw,manifest);assert.equal(inspected.metadata.application_sha256,appBefore);
  const original=format.parseUfw(format.unwrapFwsc(stock,'FM-1_015'),{verifyPayloadCrc:false}).entries[0].data;
  const decoded=format.parseUfw(inspected.image), flash=decoded.entries[0].data, ota=decoded.entries[1].data;
  for(const [begin,end]of [[0,0x4000],[0x4040,0x4120],[0x4120+application.length,original.length]]) assert.deepEqual(flash.subarray(begin,end),original.subarray(begin,end));
  function repack(modifiedFlash,modifiedOta=ota){
    const image=format.makeUfw(modifiedFlash,modifiedOta), packaged=format.wrapFwsc(image,CUSTOM_IDENTITY);
    return {raw:packaged,manifest:{...manifest,package_sha256:sha(packaged),logical_sha256:sha(image)}};
  }
  const boot=Uint8Array.from(flash);boot[0x100]^=1;
  {const bad=repack(boot);await assert.rejects(inspectCustomFwsc(bad.raw,bad.manifest),/boot\/config\/reserved/);}
  const wrongOta=Uint8Array.from(ota);wrongOta[100]^=1;
  {const bad=repack(flash,wrongOta);await assert.rejects(inspectCustomFwsc(bad.raw,bad.manifest),/pinned official OTA/);}
  for(const tailAt of new Set([0x4120+application.length,0x4120+Math.ceil(application.length/32)*32])){
   if(tailAt>=0x920dc)continue;
    const altered=Uint8Array.from(flash),plain=Uint8Array.from(flash);
    for(let at=0x4000;at<plain.length;at+=32)plain.set(format.cipher(flash.subarray(at,at+32),0x980f^((at-0x4000)>>>2)),at);
    plain[tailAt]^=1;put16(plain,0x4002,format.crc16(plain.subarray(0x4020,0x4000+582235)));
    put16(plain,0x4000,format.crc16(plain.subarray(0x4002,0x4020)));
    for(const at of [0x4000,tailAt&~31])altered.set(format.cipher(plain.subarray(at,at+32),0x980f^((at-0x4000)>>>2)),at);
    const bad=repack(altered);await assert.rejects(inspectCustomFwsc(bad.raw,bad.manifest),/tail was changed/);
  }
  if(manifest.stock_tail_proof.boundary_prefix_hex.length){
    const badProof=structuredClone(manifest), first=Number.parseInt(badProof.stock_tail_proof.boundary_prefix_hex.slice(0,2),16)^1;
    badProof.stock_tail_proof.boundary_prefix_hex=first.toString(16).padStart(2,'0')+badProof.stock_tail_proof.boundary_prefix_hex.slice(2);
    await assert.rejects(inspectCustomFwsc(raw,badProof),/tail was changed/);
  }
  const wrongIdentity=structuredClone(manifest);wrongIdentity.target_build_sha256='2'.repeat(64);
  await assert.rejects(inspectCustomFwsc(raw,wrongIdentity),/declared firmware MIDI build identity/);
  await assert.rejects(buildCustomFwsc({stockPackage:stock,application,targetBuildSha256:'2'.repeat(64)}),/declared firmware MIDI build identity/);
  const wrongApp=structuredClone(manifest);wrongApp.application_sha256=digest;
  await assert.rejects(inspectCustomFwsc(raw,wrongApp),/application does not match/);
  const corrupted=Uint8Array.from(raw);corrupted[corrupted.length-1]^=1;
  await assert.rejects(inspectCustomFwsc(corrupted,manifest),/digest mismatch/);
  for(const length of [Math.floor(CUSTOM_APPLICATION_MAX_BYTES/32)*32,CUSTOM_APPLICATION_MAX_BYTES]){
    const maximum=new Uint8Array(length);maximum.set(Buffer.from(buildId,'hex'),100);
    const packaged=await buildCustomFwsc({stockPackage:stock,application:maximum,targetBuildSha256:buildId});
    assert.equal((await inspectCustomFwsc(packaged.raw,packaged.manifest)).metadata.application_bytes,length);
  }
});


test('offline CLI binds embedded protocol build identity and rechecks source closure', async () => {
  const { validateCustomBuild }=await import('../package-custom.mjs');
  const app=new Uint8Array(100);app.set(Buffer.from(digest,'hex'),9);
  const build={status:'LINKED_USB_DIAGNOSTIC_UNTESTED',flashable:false,factory_diag:true,usb_midi_update:true,serial_uboot:true,
    device_operations_performed:false,application_bytes:app.length,application_sha256:sha(app),
    usb_midi_update_contract:{family:8,build_id:digest,loader_compatible:false,installation_enabled:false,hardware_accepted:false},
    static_audit:{static_audit:'passed',factory_diag:true,usb_midi_update:true,usb_midi_installation_enabled:false,usb_bootloader_entry:true,
      hardware_boot_verified:false,flashable:false,application_bytes:app.length,application_sha256:sha(app),entry:'0x2000120'},
    source_sha256:{'source.c':sha(Buffer.from('source'))},archive_sha256:{'library.a':sha(Buffer.from('archive'))}};
  const readSource=async file=>Buffer.from(file==='source.c'?'source':'archive');
  assert.equal(await validateCustomBuild(app,build,{readSource}),digest);
  for(const change of [b=>b.usb_midi_update_contract.build_id='2'.repeat(64),b=>b.usb_midi_update_contract.build_id='A'.repeat(64),
    b=>b.usb_midi_update_contract.installation_enabled=true,b=>b.static_audit.static_audit='failed',b=>b.application_sha256='2'.repeat(64),
    b=>b.source_sha256['source.c']='2'.repeat(64),b=>b.archive_sha256={}]){
    const bad=structuredClone(build);change(bad);await assert.rejects(validateCustomBuild(app,bad,{readSource}));
  }
});
