import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { app, baseline, BUILD, APP_CAPACITY } from './fixtures.mjs';
test('privileged sector engine injected transport lifecycle and failures',{skip:process.platform!=='win32'},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fm1-flash-engine-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const original=app(),next=app(8192,31),maximum=app(APP_CAPACITY,57);
 for(const [name,bytes]of[['baseline',baseline(original)],['original',original],['next',next],['maximum',maximum]])await fs.writeFile(path.join(dir,name+'.bin'),bytes);
 const script=path.join(dir,'test.ps1');await fs.writeFile(script,`param([string]$Sources,[string]$Root,[string]$Build)
$ErrorActionPreference='Stop'
Add-Type -Path @((Join-Path $Sources 'FlashPolicy.cs'),(Join-Path $Sources 'FlashEngine.cs'),(Join-Path $Sources 'test/FlashEngineTests.cs'))
[FlashEngineTests]::Run([IO.File]::ReadAllBytes((Join-Path $Root 'baseline.bin')),[IO.File]::ReadAllBytes((Join-Path $Root 'original.bin')),[IO.File]::ReadAllBytes((Join-Path $Root 'next.bin')),[IO.File]::ReadAllBytes((Join-Path $Root 'maximum.bin')),$Build)
`);
 const out=execFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-Sources',fileURLToPath(new URL('..',import.meta.url)),'-Root',dir,'-Build',BUILD],{encoding:'utf8',timeout:45000,windowsHide:true});
 const result=JSON.parse(out.replace(/^\uFEFF/,''));assert.ok(result.cases>=15);assert.ok(result.assertions>=80);assert.equal(result.hardware_io,false);t.diagnostic(JSON.stringify(result));
});
