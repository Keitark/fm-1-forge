# Restore passive Forge inventory; preserve verified services and bench sessions.
[CmdletBinding()]
param(
    [string]$SiteUrl = 'https://fm1-app-library.keitark.chatgpt.site',
    [string]$Python = 'C:\Python311\python.exe',
    [switch]$PrepareOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Forge services require Windows.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run Forge services in normal, non-administrator PowerShell.'
}
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$runtime = (Resolve-Path -LiteralPath $Python).Path
$bridgeState = Join-Path $env:LOCALAPPDATA 'FM1RemoteBridge'
$relayState = Join-Path $env:LOCALAPPDATA 'FM1SiteRelay\fm1-app-library'
$credentials = Join-Path $env:LOCALAPPDATA 'FM1SiteClients\fm1-app-library'
$bridgeTokenFile = Join-Path $bridgeState 'token.txt'
$relayTokenFile = Join-Path $credentials 'site-relay-token.txt'
$sitesTokenFile = Join-Path $credentials 'sites-service-token.txt'
$bridgeScript = Join-Path $PSScriptRoot 'remote_bridge.py'
$relayScript = Join-Path $PSScriptRoot 'site_relay.py'
$bridgeUrl = 'http://127.0.0.1:9770'

function Assert-PlainPath([string]$Path, [switch]$File) {
    $candidate = [IO.Path]::GetFullPath($Path)
    if ($candidate.StartsWith('\\')) { throw 'Forge requires local paths.' }
    if ($File -and -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw 'A required Forge runtime, script, or private file is unavailable.'
    }
    while ($candidate) {
        if (Test-Path -LiteralPath $candidate) {
            if ((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Forge paths must not contain reparse points.'
            }
        }
        $parent = Split-Path -Path $candidate -Parent
        if ($parent -eq $candidate) { break }
        $candidate = $parent
    }
}
function Assert-PrivateFile([string]$Path) {
    Assert-PlainPath $Path -File
    $acl = Get-Acl -LiteralPath $Path
    $permitted = @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $permitted) {
            throw 'A Forge private file allows another account; fix its access locally.'
        }
    }
}
function Read-PrivateJson([string]$Path) {
    Assert-PrivateFile $Path
    try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch {
        throw 'Forge launch metadata is invalid; no service was started.'
    }
}
function Same-Path([string]$Left, [string]$Right) {
    if (-not $Left -or -not $Right) { return $false }
    return [IO.Path]::GetFullPath($Left).TrimEnd('\').Equals(
        [IO.Path]::GetFullPath($Right).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
}
if (-not ('FM1ForgeCommandLine' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FM1ForgeCommandLine {
    [DllImport("shell32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    static extern IntPtr CommandLineToArgvW(string command, out int count);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    public static string[] Split(string command) {
        int count; IntPtr memory = CommandLineToArgvW(command, out count);
        if (memory == IntPtr.Zero) throw new InvalidOperationException("Cannot verify service arguments");
        try {
            string[] result = new string[count];
            for (int i = 0; i < count; i++) result[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, i * IntPtr.Size));
            return result;
        } finally { LocalFree(memory); }
    }
}
'@
}
function Service-Arguments($Process, [string]$Script, [string[]]$ValueFlags, [string[]]$SwitchFlags) {
    if (-not $Process.ExecutablePath -or -not (Same-Path $Process.ExecutablePath $runtime) -or
        -not $Process.CommandLine) { throw 'Recorded service PID is unverified; no process was stopped or duplicated.' }
    $argv = [FM1ForgeCommandLine]::Split($Process.CommandLine)
    if ($argv.Count -lt 3 -or $argv[1] -ne '-u' -or -not (Same-Path $argv[2] $Script)) {
        throw 'Recorded service command is unverified; no process was stopped or duplicated.'
    }
    $flags = @{}
    for ($i = 3; $i -lt $argv.Count; $i++) {
        $flag = $argv[$i]
        if ($flags.ContainsKey($flag)) { throw 'Recorded service arguments contain duplicates.' }
        if ($flag -in $ValueFlags) {
            $i++
            if ($i -ge $argv.Count -or -not $argv[$i]) { throw 'Recorded service argument is missing.' }
            $flags[$flag] = $argv[$i]
        } elseif ($flag -in $SwitchFlags) { $flags[$flag] = $true } else {
            throw 'Recorded service arguments are unrecognized; no process was stopped or duplicated.'
        }
    }
    return $flags
}
function Recorded-Process([string]$State, [string]$PidName) {
    $path = Join-Path $State $PidName
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    Assert-PrivateFile $path
    $text = [IO.File]::ReadAllText($path).Trim()
    $servicePid = 0
    if (-not [int]::TryParse($text, [ref]$servicePid) -or $servicePid -le 0) {
        throw 'Recorded service PID is invalid; inspect private state before starting.'
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$servicePid" -ErrorAction Stop
    return $process
}
function Bridge-Health {
    $token = [IO.File]::ReadAllText($bridgeTokenFile).Trim()
    if ($token.Length -lt 32 -or $token.Length -gt 4096 -or $token -notmatch '^[\x21-\x7e]+$') {
        throw 'Existing bridge credential is invalid; it was not replaced.'
    }
    try {
        $answer = Invoke-RestMethod -Uri ($bridgeUrl + '/v1/status') -Headers @{Authorization=('Bearer ' + $token)} -TimeoutSec 20 -MaximumRedirection 0
        return ($answer.ok -eq $true -and $null -ne $answer.data)
    } catch { return $false } finally { $token = $null }
}

foreach ($path in @($repo, $bridgeState, $relayState, $credentials)) { Assert-PlainPath $path }
foreach ($path in @($runtime, $bridgeScript, $relayScript)) { Assert-PlainPath $path -File }
foreach ($path in @($bridgeTokenFile, $relayTokenFile, $sitesTokenFile)) { Assert-PrivateFile $path }
# Read-only dependency/origin/credential validation. -B avoids bytecode writes.
& $runtime -B -c 'import sys,pathlib,yaml,tqdm,crcmod,colorama,serial; sys.path.insert(0,sys.argv[2]); import site_relay as r; assert sys.version_info >= (3,11); r.normalize_origin(sys.argv[1],site=True); [r.load_token(str(),pathlib.Path(p)) for p in sys.argv[3:]]' $SiteUrl $PSScriptRoot $bridgeTokenFile $relayTokenFile $sitesTokenFile
if ($LASTEXITCODE -ne 0) { throw 'Forge runtime, origins, or private credentials failed validation.' }

# Verify both recorded processes before making any service change.
$bridge = Recorded-Process $bridgeState 'bridge.pid'
$relay = Recorded-Process $relayState 'relay.pid'
if ($bridge) {
    $config = Read-PrivateJson (Join-Path $bridgeState 'launch.json')
    $flags = Service-Arguments $bridge $bridgeScript @('--repo','--state-dir','--token-file','--port','--session','--official-updater','--official-updater-sha256') @()
    if ($config.pid -ne $bridge.ProcessId -or $config.port -ne 9770 -or
        -not (Same-Path $config.python $runtime) -or -not (Same-Path $config.repo $repo) -or
        -not (Same-Path $flags['--repo'] $repo) -or -not (Same-Path $flags['--state-dir'] $bridgeState) -or
        -not (Same-Path $flags['--token-file'] $bridgeTokenFile) -or $flags['--port'] -ne '9770' -or
        ([bool]$config.session -ne [bool]$flags['--session']) -or
        ($config.session -and -not (Same-Path $config.session $flags['--session']))) {
        throw 'Recorded bridge launch settings are unverified; no process was stopped or duplicated.'
    }
    if ([bool]$config.official_updater -ne [bool]$flags['--official-updater'] -or
        [bool]$config.official_updater_sha256 -ne [bool]$flags['--official-updater-sha256'] -or
        ($config.official_updater -and -not (Same-Path $config.official_updater $flags['--official-updater'])) -or
        ($config.official_updater_sha256 -and $config.official_updater_sha256 -ne $flags['--official-updater-sha256'])) {
        throw 'Recorded bridge updater settings are unverified; no process was stopped or duplicated.'
    }
}
if ($relay) {
    $flags = Service-Arguments $relay $relayScript @('--site-url','--bridge-url','--state-dir','--relay-token-file','--sites-token-file','--bridge-token-file','--poll-seconds') @('--allow-switch','--allow-official-update')
    foreach ($required in @('--site-url','--bridge-url','--state-dir','--relay-token-file','--sites-token-file','--bridge-token-file')) {
        if (-not $flags.ContainsKey($required)) { throw 'Recorded relay launch settings are incomplete; no duplicate was launched.' }
    }
    if ($flags['--site-url'].TrimEnd('/') -ne $SiteUrl.TrimEnd('/') -or $flags['--bridge-url'].TrimEnd('/') -ne $bridgeUrl -or
        -not (Same-Path $flags['--state-dir'] $relayState) -or
        -not (Same-Path $flags['--relay-token-file'] $relayTokenFile) -or
        -not (Same-Path $flags['--sites-token-file'] $sitesTokenFile) -or
        -not (Same-Path $flags['--bridge-token-file'] $bridgeTokenFile)) {
        throw 'Recorded relay launch settings are unverified; no process was stopped or duplicated.'
    }
}
if ($PrepareOnly) {
    Write-Output ('Bridge metadata: ' + $(if ($bridge) { 'verified running' } else { 'not running' }))
    Write-Output ('Relay metadata: ' + $(if ($relay) { 'verified running' } else { 'not running' }))
    Write-Output 'Private files and runtime validated. No HTTP request, service launch, elevation, or device operation.'
    return
}
if ($bridge) {
    if (-not (Bridge-Health)) { throw 'Recorded bridge is alive but authenticated inventory is unavailable; no duplicate was launched.' }
    Write-Output "Preserved healthy bridge PID $($bridge.ProcessId) and its attached bench session."
} else {
    # Explicit empty session prevents restoring an old dead protected helper.
    & (Join-Path $PSScriptRoot 'start-remote-bridge.ps1') -RepoRoot $repo -Python $runtime -StateRoot $bridgeState -SessionRoot '' -Port 9770
}
if ($relay) {
    Write-Output "Preserved verified relay PID $($relay.ProcessId) and its existing permissions."
} else {
    & (Join-Path $PSScriptRoot 'start-site-relay.ps1') -SiteUrl $SiteUrl -BridgeUrl $bridgeUrl -Python $runtime -StateRoot $relayState -RelayTokenFile $relayTokenFile -SitesTokenFile $sitesTokenFile -BridgeTokenFile $bridgeTokenFile
}
Write-Output 'Forge inventory services are running. Check Bench connected for Site authentication. No firmware operation was requested.'
