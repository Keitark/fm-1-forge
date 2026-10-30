import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

test('frozen privileged bootstrap sanitizes module search and working directory before loading any payload cmdlet',async()=>{
 const relay=await fs.readFile(new URL('../windows-cdc-relay.ps1',import.meta.url),'utf8');
 const bootstrap=/\$verifier=@'\r?\n([\s\S]*?)\r?\n'@/.exec(relay)?.[1];assert.ok(bootstrap);
 for(const source of [bootstrap,await fs.readFile(new URL('../windows-cdc-server.ps1',import.meta.url),'utf8')]){
  const system=source.indexOf('$system32=[Environment]::SystemDirectory'),env=source.indexOf('$env:PATH='),modules=source.indexOf('$env:PSModulePath='),cwd=source.indexOf('[Environment]::CurrentDirectory='),location=source.indexOf('Set-Location -LiteralPath $system32');
  assert.ok(system>=0&&env>system&&modules>env&&cwd>modules&&location>cwd);
  assert.ok(!source.includes('$env:SystemRoot'));
 }
 assert.match(relay,/\$exe=\[IO\.Path\]::Combine\(\[Environment\]::SystemDirectory,'WindowsPowerShell\\v1\.0\\powershell\.exe'\)/);
 assert.ok(bootstrap.indexOf('Set-Location')<bootstrap.indexOf('& ([scriptblock]::Create($s))'));
 for(const marker of ['frozen_length_changed','frozen_hash_changed','[IO.FileShare]::Read',"$s.Length -gt 2000000"])assert.ok(bootstrap.includes(marker));
});

test('privileged compiler temp is inside the newly audited administrator-owned snapshot',async()=>{
 const source=await fs.readFile(new URL('../windows-cdc-server.ps1',import.meta.url),'utf8');
 const created=source.indexOf('[IO.Directory]::CreateDirectory($root,$acl)'),audited=source.indexOf('if ($audit.GetOwner('),temp=source.indexOf('$env:TEMP=$root'),tmp=source.indexOf('$env:TMP=$root'),compile=source.indexOf('Add-Type -TypeDefinition $code');
 assert.ok(created>=0&&audited>created&&temp>audited&&tmp>temp&&compile>tmp);
 assert.ok(source.indexOf('ReparsePoint')<temp);assert.ok(source.includes('AreAccessRulesProtected'));
 assert.ok(!source.includes('Invoke-Expression'));assert.ok(!source.includes('READ_KEY'));assert.ok(!source.includes('WRITE_KEY'));
 assert.match(source,/\$request\.op -notin @\('prepare','install','recover','reset','close'\)/);
});

test('pipe identity includes process creation time before handshake every request and CDC transition',async()=>{
 const source=await fs.readFile(new URL('../windows-cdc-server.ps1',import.meta.url),'utf8');
 const guard=/function Assert-Fm1Client \{([\s\S]*?)\r?\n    \}/.exec(source)?.[1];assert.ok(guard);
 assert.ok(guard.includes('[Fm1PipePeer]::Client($pipe,[int]$Config.client_pid)'));
 assert.ok(guard.includes('GetProcessById([int]$Config.client_pid)'));assert.ok(guard.includes('StartTime.ToUniversalTime().Ticks -ne $Config.client_start_ticks'));assert.ok(guard.includes('$client.Dispose()'));
 assert.match(source,/WaitForConnectionAsync\(\)\.Wait\(60000\)[\s\S]*?Assert-Fm1Client\s+Send-Answer/);
 assert.match(source,/\$request=\(Read-PipeLine\)\|ConvertFrom-Json\s+Assert-Fm1Client/);
 assert.match(source,/Assert-Fm1Client\s+\$disk=Enter-Fm1Loader/);
 assert.match(source,/\$check=\[Action\]\{\s+Assert-Fm1Client/);
});

test('protected original plan receipt commits the retained executable source and helper digests',async()=>{
 const relay=await fs.readFile(new URL('../windows-cdc-relay.ps1',import.meta.url),'utf8'),server=await fs.readFile(new URL('../windows-cdc-server.ps1',import.meta.url),'utf8');
 assert.ok(relay.indexOf("$server=[IO.File]::ReadAllText")<relay.indexOf('$config=@{'));assert.ok(relay.indexOf("$link=[IO.File]::ReadAllText")<relay.indexOf('$config=@{'));
 assert.match(relay,/link_code=\$link;server_code=\$server/);
 for(const [name,key]of[['FlashPolicy.cs','policy_code'],['FlashEngine.cs','engine_code'],['windows-cdc-link.ps1','link_code'],['windows-cdc-server.ps1','server_code']])assert.ok(server.includes("@('"+name+"','"+key+"')"));
 assert.ok(server.includes('Write-Protected $sourceFile[0] $sourceBytes'));assert.ok(server.includes('$sourceHashes[$sourceFile[0]]=(Get-Fm1Hash $sourceBytes)'));
 assert.ok(server.includes("Write-Protected 'wl82loader.bin' $helper"));assert.ok(server.includes("Write-Protected 'source-digests.json'"));assert.ok(server.includes('source_sha256=$sourceHashes'));
 assert.ok(server.includes('worker_receipt_sha256=(Get-Fm1Hash $receiptBytes)'));
});

test('actual Windows PowerShell 5.1 parses sidecars and compiles their exact merged native sources',{skip:process.platform!=='win32'},async t=>{
 const tmp=path.resolve(os.tmpdir()),dir=await fs.mkdtemp(path.join(tmp,'fm1-bootstrap-check-'));
 t.after(()=>{assert.ok(path.resolve(dir).startsWith(tmp+path.sep));return fs.rm(dir,{recursive:true,force:true});});
 const script=path.join(dir,'check.ps1');await fs.writeFile(script,`param([string]$Root)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'native_51_required'}
$system32=[Environment]::SystemDirectory;$env:PATH=$system32+';'+[IO.Path]::GetDirectoryName($system32);$env:PSModulePath=[IO.Path]::Combine($system32,'WindowsPowerShell\\v1.0\\Modules');[Environment]::CurrentDirectory=$system32;Set-Location -LiteralPath $system32
foreach($name in @('windows-cdc-relay.ps1','windows-cdc-server.ps1','windows-cdc-link.ps1')){
 $tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile((Join-Path $Root $name),[ref]$tokens,[ref]$errors);if($errors.Count){throw 'sidecar_parse_failed'}
}
$nl=[Environment]::NewLine
$code=[IO.File]::ReadAllText((Join-Path $Root 'FlashPolicy.cs'))+$nl+[IO.File]::ReadAllText((Join-Path $Root 'FlashEngine.cs'))
$imports=@([regex]::Matches($code,'(?m)^using [^\\r\\n]+;\\s*$')|ForEach-Object {$_.Value.Trim()}|Select-Object -Unique)
$code=($imports -join $nl)+$nl+[regex]::Replace($code,'(?m)^using [^\\r\\n]+;\\s*$','')
Add-Type -TypeDefinition $code -Language CSharp
@{version=$PSVersionTable.PSVersion.ToString();edition=$PSVersionTable.PSEdition;parsed=3;compiled=$true;device_io=$false}|ConvertTo-Json -Compress
`);
 const output=execFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-Root',fileURLToPath(new URL('..',import.meta.url))],{encoding:'utf8',timeout:30000,windowsHide:true});
 const receipt=JSON.parse(output.replace(/^\uFEFF/,''));assert.match(receipt.version,/^5\.1\./);assert.equal(receipt.edition,'Desktop');assert.equal(receipt.parsed,3);assert.equal(receipt.compiled,true);assert.equal(receipt.device_io,false);
});
