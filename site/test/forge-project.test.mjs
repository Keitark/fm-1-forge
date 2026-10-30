import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { HAL_KEYS, projectConfig, normalizeProjectConfig, projectPrompt, forgeProjectRuntime } from '../lib/fm1-forge-project.mjs';

const fields={slug:'pad-lab',displayName:'Pad Lab',clockPreset:'sdk-default',clockOptIn:false,lcdPreset:'stock-dma',module:'user',usbAudio:true};
const allHal={buttons:true,encoders:true,volume:true,lcd:true,audio:true};
function legacy(config,version=1){const {hal,...value}=config,{uvc,midiUpdate,uacCapture,...usb}=config.usb;return {...value,schemaVersion:version,usb:{...usb,...(version===3?{uvc}:{})},...(version>=2?{hal:{...hal}}:{})};}

test('new projects enable each selectable user HAL and protect USB recovery by default',()=>{
  const config=projectConfig(fields);
  assert.equal(config.schemaVersion,4);assert.deepEqual(config.hal,allHal);assert.deepEqual(config.usb,{cdc:true,uac:true,uacCapture:true,uvc:false,midiUpdate:true,uboot:true});
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

test('strict legacy v1 configurations migrate to v4 with all HALs enabled without changing their input',()=>{
  const before=legacy(projectConfig({...fields,usbAudio:false})),serialized=JSON.stringify(before),normalized=normalizeProjectConfig(before);
  assert.equal(normalized.schemaVersion,4);assert.deepEqual(normalized.hal,allHal);assert.equal(normalized.usb.uac,false);assert.equal(normalized.usb.midiUpdate,false);
  assert.equal(JSON.stringify(before),serialized);assert.notEqual(normalized.project,before.project);assert.notEqual(normalized.usb,before.usb);
  assert.match(projectPrompt(before),/"schemaVersion": 4/);
});

test('strict v2 imports retain HAL selections and disable UVC without mutating caller data',()=>{
  const expected=projectConfig({...fields,usbAudio:false,usbMidiUpdate:false,hal:{...allHal,lcd:false,audio:false}}),before=legacy(expected,2),serialized=JSON.stringify(before);
  assert.deepEqual(normalizeProjectConfig(before),expected);assert.equal(JSON.stringify(before),serialized);
  assert.equal(normalizeProjectConfig(before).usb.uvc,false);assert.notEqual(normalizeProjectConfig(before).hal,before.hal);
  assert.throws(()=>normalizeProjectConfig({...before,usb:{...before.usb,uvc:false}}),/Invalid Forge/);
});

test('optional UVC defaults off for old field callers and round trips explicit true and false',()=>{
  assert.equal(projectConfig(fields).usb.uvc,false);
  for(const usbVideo of [true,false]){
    const before={...fields,usbVideo,usbMidiUpdate:false,hal:{...allHal,lcd:false}},serialized=JSON.stringify(before),config=projectConfig(before);
    assert.equal(config.usb.uvc,usbVideo);assert.deepEqual(normalizeProjectConfig(JSON.parse(JSON.stringify(config))),config);
    assert.equal(JSON.stringify(before),serialized);assert.equal(config.usb.cdc,true);assert.equal(config.usb.uboot,true);
    assert.match(projectPrompt(config),usbVideo?/selected; validate USB enumeration and capture/:/disabled; do not enable it implicitly/);
  }
  for(const usbVideo of [null,undefined,0,1,'true',{},[]])assert.throws(()=>projectConfig({...fields,usbVideo}),/USB video/);
  const config=projectConfig(fields),{uvc,...missing}=config.usb;
  for(const usb of [missing,{...config.usb,uvc:1},{...config.usb,uvc:null},{...config.usb,uvc:'false'},{...config.usb,extra:false}])assert.throws(()=>normalizeProjectConfig({...config,usb}));
  assert.throws(()=>normalizeProjectConfig({...legacy(config),usb:config.usb}),/Invalid Forge/);
});

test('unknown versions, misplaced HALs and malformed selection values cannot become configurations',()=>{
  const config=projectConfig(fields),v1=legacy(config);
  for(const hal of [null,[],{}, {...allHal,audio:1},{...allHal,lcd:'false'},{...allHal,midi:true},Object.fromEntries(Object.entries(allHal).filter(([key])=>key!=='volume'))]){
    assert.throws(()=>projectConfig({...fields,hal}),/HAL/);assert.throws(()=>normalizeProjectConfig({...config,hal}),/HAL/);
  }
  const {hal,...missing}=config;
  for(const malformed of [{...missing},{...v1,hal:allHal},{...config,schemaVersion:5},{...config,profile:'other'},{...config,usb:{...config.usb,uboot:false}},{...config,extra:true},{...config,project:{...config.project,displayName:' Pad Lab '}}])assert.throws(()=>normalizeProjectConfig(malformed),/Invalid Forge/);
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


test('firmware MIDI receiver defaults on for new projects and explicit selections round trip with UVC',()=>{
  assert.equal(projectConfig(fields).usb.midiUpdate,true);
  for(const usbMidiUpdate of [true,false])for(const usbVideo of [true,false]){
    const input={...fields,usbMidiUpdate,usbVideo,usbAudioCapture:false},serialized=JSON.stringify(input),config=projectConfig(input);
    assert.equal(config.usb.midiUpdate,usbMidiUpdate);assert.equal(config.usb.uvc,usbVideo);
    assert.deepEqual(normalizeProjectConfig(JSON.parse(JSON.stringify(config))),config);assert.equal(JSON.stringify(input),serialized);
    const prompt=projectPrompt(config);assert.deepEqual(JSON.parse(prompt.split('Forge configuration:\n')[1]),config);
    assert.match(prompt,usbMidiUpdate?/experimental USB MIDI \+ SysEx receiver in the composite device/:/do not enable the USB MIDI \+ SysEx receiver implicitly/);
    if(usbMidiUpdate)assert.match(prompt,/does not qualify a loader installation or enable device installation; retain the existing installation gate/);
  }
  for(const usbMidiUpdate of [null,undefined,0,1,'true',{},[]])assert.throws(()=>projectConfig({...fields,usbMidiUpdate}),/firmware MIDI update/);
});

test('all legacy schema versions migrate without enabling the new firmware MIDI receiver',()=>{
  const selected=projectConfig({...fields,usbVideo:true,usbMidiUpdate:false,hal:{...allHal,lcd:false}});
  for(const version of [1,2,3]){
    const before=legacy(selected,version),serialized=JSON.stringify(before),normalized=normalizeProjectConfig(before);
    assert.equal(normalized.schemaVersion,4);assert.equal(normalized.usb.midiUpdate,false);
    assert.equal(normalized.usb.uvc,version===3);assert.equal(normalized.hal.lcd,version===1);
    assert.equal(JSON.stringify(before),serialized);assert.match(projectPrompt(before),/do not enable the USB MIDI \+ SysEx receiver implicitly/);
    assert.throws(()=>normalizeProjectConfig({...before,usb:{...before.usb,midiUpdate:false}}),/Invalid Forge/);
  }
});

test('canonical MIDI receiver values require the exact schema v4 USB fields and booleans',()=>{
  const config=projectConfig(fields),{midiUpdate,...missing}=config.usb;
  for(const usb of [missing,...[undefined,null,0,1,'false',{},[]].map(midiUpdate=>({...config.usb,midiUpdate})),{...config.usb,extra:true}])assert.throws(()=>normalizeProjectConfig({...config,usb}));
});


test('explicit capture controls the audio profile and all legal endpoint choices round trip',()=>{
  for(const usbAudio of [true,false])for(const usbAudioCapture of [true,false])for(const usbMidiUpdate of [true,false])for(const usbVideo of [true,false]){
    const input={...fields,usbAudio,usbAudioCapture,usbMidiUpdate,usbVideo},serialized=JSON.stringify(input),capture=usbAudio&&usbAudioCapture,count=2+Number(capture)+Number(usbMidiUpdate)+Number(usbVideo);
    if(count>4){assert.throws(()=>projectConfig(input),/USB IN endpoint budget exceeded \(5\/4\).*Disable audio capture, MIDI or video/);assert.equal(JSON.stringify(input),serialized);continue;}
    const config=projectConfig(input),prompt=projectPrompt(config);assert.equal(config.usb.uacCapture,capture);
    assert.deepEqual(normalizeProjectConfig(config),config);assert.equal(JSON.stringify(input),serialized);
    assert.match(prompt,!usbAudio?/USB audio profile is disabled/:capture?/USB audio profile is duplex/:/USB audio profile is playback-only; USB audio capture is explicitly disabled/);
    assert.match(prompt,/do not disable a selected module automatically/);
    assert.deepEqual(JSON.parse(prompt.split('Forge configuration:\n')[1]),config);assert.deepEqual(Object.keys(config.usb),['cdc','uac','uacCapture','uvc','midiUpdate','uboot']);
  }
  assert.equal(projectConfig(fields).usb.uacCapture,true);assert.equal(projectConfig({...fields,usbAudio:false}).usb.uacCapture,false);
  for(const usbAudioCapture of [null,undefined,'false',0,1,{},[]])assert.throws(()=>projectConfig({...fields,usbAudioCapture}),/USB audio capture/);
});

test('canonical audio capture is required and must be boolean, budgeted and dependent on UAC',()=>{
  const config=projectConfig(fields),{uacCapture,...missing}=config.usb;
  for(const usb of [missing,...[undefined,null,0,1,'false',{},[]].map(uacCapture=>({...config.usb,uacCapture})),{...config.usb,uac:false,uacCapture:true},{...config.usb,uvc:true}])assert.throws(()=>normalizeProjectConfig({...config,usb}));
  for(const version of [1,2,3])for(const usbAudio of [true,false]){
    const old=legacy(projectConfig({...fields,usbAudio}),version),serialized=JSON.stringify(old);
    assert.equal(normalizeProjectConfig(old).usb.uacCapture,usbAudio);assert.equal(JSON.stringify(old),serialized);
    assert.throws(()=>normalizeProjectConfig({...old,usb:{...old.usb,uacCapture:false}}));
  }
});
