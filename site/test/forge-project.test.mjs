import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { HAL_KEYS, projectConfig, normalizeProjectConfig, projectPrompt, forgeProjectRuntime } from '../lib/fm1-forge-project.mjs';

const fields={slug:'pad-lab',displayName:'Pad Lab',clockPreset:'sdk-default',clockOptIn:false,lcdPreset:'stock-dma',module:'user',usbAudio:true};
const allHal={buttons:true,encoders:true,volume:true,lcd:true,audio:true};
function legacy(config){const {hal,...value}=config;return {...value,schemaVersion:1};}

test('new projects enable each selectable user HAL and protect USB recovery by default',()=>{
  const config=projectConfig(fields);
  assert.equal(config.schemaVersion,2);assert.deepEqual(config.hal,allHal);assert.deepEqual(config.usb,{cdc:true,uac:true,uboot:true});
  config.hal.buttons=false;assert.equal(projectConfig(fields).hal.buttons,true);
});

test('every HAL can be deselected independently and survives canonical JSON round trips',()=>{
  for(const key of HAL_KEYS){
    const hal={...allHal,[key]:false},config=projectConfig({...fields,hal});
    assert.deepEqual(config.hal,hal);assert.deepEqual(normalizeProjectConfig(JSON.parse(JSON.stringify(config))),config);
    assert.notEqual(config.hal,hal);
  }
  const config=projectConfig({...fields,hal:Object.fromEntries(HAL_KEYS.map(key=>[key,false]))});
  assert.match(projectPrompt(config),/user module: none/);assert.equal(config.usb.uac,true);
});

test('strict legacy v1 configurations migrate to v2 with all HALs enabled without changing their input',()=>{
  const before=legacy(projectConfig({...fields,usbAudio:false})),serialized=JSON.stringify(before),normalized=normalizeProjectConfig(before);
  assert.equal(normalized.schemaVersion,2);assert.deepEqual(normalized.hal,allHal);assert.equal(normalized.usb.uac,false);
  assert.equal(JSON.stringify(before),serialized);assert.notEqual(normalized.project,before.project);assert.notEqual(normalized.usb,before.usb);
  assert.match(projectPrompt(before),/"schemaVersion": 2/);
});

test('unknown versions, misplaced HALs and malformed selection values cannot become configurations',()=>{
  const config=projectConfig(fields),v1=legacy(config);
  for(const hal of [null,[],{}, {...allHal,audio:1},{...allHal,lcd:'false'},{...allHal,midi:true},Object.fromEntries(Object.entries(allHal).filter(([key])=>key!=='volume'))]){
    assert.throws(()=>projectConfig({...fields,hal}),/HAL/);assert.throws(()=>normalizeProjectConfig({...config,hal}),/HAL/);
  }
  const {hal,...missing}=config;
  for(const malformed of [{...missing},{...v1,hal:allHal},{...config,schemaVersion:3},{...config,profile:'other'},{...config,usb:{...config.usb,uboot:false}},{...config,extra:true},{...config,project:{...config.project,displayName:' Pad Lab '}}])assert.throws(()=>normalizeProjectConfig(malformed),/Invalid Forge/);
  assert.throws(()=>projectConfig({...fields,hal:allHal,extra:true}),/supported fields/);
});

test('selected HAL prompt describes user access while preserving fixed drivers and recovery',()=>{
  const config=projectConfig({...fields,hal:{...allHal,lcd:false,audio:false}}),prompt=projectPrompt(config,'Build a USB instrument.');
  assert.match(prompt,/user module: buttons, encoders, volume\./);assert.match(prompt,/do not power down fixed hardware drivers/);
  assert.match(prompt,/CDC serial, UBOOT recovery, USB audio mixing and the physical master-volume gain/);assert.match(prompt,/Do not flash/);
  assert.deepEqual(JSON.parse(prompt.split('Forge configuration:\n')[1]),config);
});

test('injected portable engine exposes the same strict normalizer as the server module',()=>{
  const window={},context=vm.createContext({window});vm.runInContext(forgeProjectRuntime,context);
  const selected=projectConfig({...fields,hal:{...allHal,encoders:false}});
  assert.deepEqual(JSON.parse(JSON.stringify(window.FM1Forge.normalizeProjectConfig(selected))),selected);
  assert.deepEqual(JSON.parse(JSON.stringify(window.FM1Forge.normalizeProjectConfig(legacy(selected)))).hal,allHal);
});
