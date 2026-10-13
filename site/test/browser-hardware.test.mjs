import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { browserHardwareCapabilities } from '../lib/fm1-browser-hardware.mjs';
import { FM1PluginHost } from '../lib/fm1-app-host.mjs';

const forbidden=()=>assert.fail('Passive capability detection must not request, enumerate, open or send to a device.');
const exposedNavigator=()=>({requestMIDIAccess:forbidden,serial:{requestPort:forbidden,getPorts:forbidden},usb:{requestDevice:forbidden,getDevices:forbidden}});
test('presence and actual document policy are separate, passive facts',()=>{
  const calls=[],policy={allowsFeature(feature){assert.equal(this,policy);calls.push(feature);return feature!=='serial';}};
  const report=browserHardwareCapabilities({isSecureContext:true,navigator:exposedNavigator(),document:{permissionsPolicy:policy}});
  assert.equal(report.secureContext,true);assert.equal(report.secureContextKnown,true);assert.equal(report.permissionPolicySource,'permissionsPolicy');
  assert.deepEqual(report.midi,{apiAvailable:true,apiStatus:'present',policy:'allowed'});
  assert.deepEqual(report.serial,{apiAvailable:true,apiStatus:'present',policy:'blocked'});
  assert.deepEqual(report.usb,{apiAvailable:true,apiStatus:'present',policy:'allowed'});
  assert.deepEqual(calls,['midi','serial','usb']);
});
test('insecure and absent runtimes do not claim access or permission denial',()=>{
  const report=browserHardwareCapabilities({isSecureContext:false,navigator:{},document:{}});
  assert.equal(report.secureContext,false);assert.equal(report.secureContextKnown,true);
  for(const name of ['midi','serial','usb'])assert.deepEqual(report[name],{apiAvailable:false,apiStatus:'absent',policy:'unknown'});
  const absent=browserHardwareCapabilities({});assert.equal(absent.secureContextKnown,false);assert.equal(absent.permissionPolicySource,'unavailable');
});
test('legacy featurePolicy is inspected when permissionsPolicy is absent',()=>{
  const report=browserHardwareCapabilities({navigator:exposedNavigator(),document:{featurePolicy:{allowsFeature:()=>false}}});
  assert.equal(report.permissionPolicySource,'featurePolicy');
  for(const name of ['midi','serial','usb'])assert.equal(report[name].policy,'blocked');
});
test('missing policy method, nonboolean answers and thrown policy checks remain unknown',()=>{
  for(const policy of [{}, {allowsFeature:()=>null}, {allowsFeature:()=>{throw new Error('Host policy query refused.');}}]){
    const report=browserHardwareCapabilities({navigator:exposedNavigator(),document:{permissionsPolicy:policy}});
    for(const name of ['midi','serial','usb'])assert.equal(report[name].policy,'unknown');
  }
});
test('unreadable runtime and API properties are distinguished from absent APIs',()=>{
  const navigatorValue=exposedNavigator();Object.defineProperty(navigatorValue,'serial',{get(){throw new Error('Not inspectable.');}});
  const report=browserHardwareCapabilities({navigator:navigatorValue,document:{}});
  assert.deepEqual(report.serial,{apiAvailable:false,apiStatus:'unknown',policy:'unknown'});assert.equal(report.midi.apiAvailable,true);
  const runtime={};for(const property of ['isSecureContext','navigator','document'])Object.defineProperty(runtime,property,{get(){throw new Error('Host property unavailable.');}});
  const unreadable=browserHardwareCapabilities(runtime);assert.equal(unreadable.secureContextKnown,false);
  for(const name of ['midi','serial','usb'])assert.deepEqual(unreadable[name],{apiAvailable:false,apiStatus:'unknown',policy:'unknown'});
});
test('a throwing permissionsPolicy getter never falls back to a different claimed permission',()=>{
  const documentValue={featurePolicy:{allowsFeature:()=>true}};Object.defineProperty(documentValue,'permissionsPolicy',{get(){throw new Error('No policy access.');}});
  const report=browserHardwareCapabilities({navigator:exposedNavigator(),document:documentValue});
  assert.equal(report.permissionPolicySource,'unavailable');for(const name of ['midi','serial','usb'])assert.equal(report[name].policy,'unknown');
});
test('the safe report is JSON serializable and contains no runtime objects or API methods',()=>{
  const report=browserHardwareCapabilities({isSecureContext:true,navigator:exposedNavigator(),document:{permissionsPolicy:{allowsFeature:()=>true}}});
  assert.deepEqual(JSON.parse(JSON.stringify(report)),report);assert.ok(JSON.stringify(report).length<600);assert.ok(!JSON.stringify(report).includes('requestMIDIAccess'));
});
test('real panel global function reads the document it executes in, without a tool evaluation facade',async()=>{
  const source=await readFile(new URL('../lib/fm1-browser-hardware.mjs',import.meta.url),'utf8');
  const context=vm.createContext({window:{},isSecureContext:true,navigator:exposedNavigator(),document:{permissionsPolicy:{allowsFeature:()=>false}}});
  vm.runInContext(source.replace('export function browserHardwareCapabilities','function browserHardwareCapabilities'),context);
  const actual=vm.runInContext('window.FM1BrowserHardwareCapabilities()',context);
  assert.equal(actual.secureContext,true);for(const name of ['midi','serial','usb'])assert.equal(actual[name].policy,'blocked');
});
test('native host exposes the detector directly without invoking MCP or extension capabilities',()=>{
  const host=new FM1PluginHost();host.app.getHostCapabilities=forbidden;host.app.callServerTool=forbidden;
  const report=host.browserHardware();assert.equal(report.schemaVersion,1);assert.equal(report.permissionPolicySource,'unavailable');
  host.app.close=async()=>{};host.close();
});
