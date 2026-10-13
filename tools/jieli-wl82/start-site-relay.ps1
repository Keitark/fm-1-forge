# Launch only the outbound relay. Existing bridge/protected-session state is read only.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SiteUrl,
    [string]$BridgeUrl = 'http://127.0.0.1:9770',
    [string]$Python = 'C:\Python311\python.exe',
    [string]$StateRoot,
    [string]$RelayTokenFile,
    [string]$SitesTokenFile,
    [string]$BridgeTokenFile,
    [switch]$AllowSwitch,
    [switch]$AllowOfficialUpdate,
    [switch]$AllowStockUpdate,
    [switch]$PrepareOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This launcher requires Windows.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run the relay in normal, non-administrator PowerShell.'
}
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$runtime = (Resolve-Path -LiteralPath $Python).Path
$relay = Join-Path $PSScriptRoot 'site_relay.py'
$privateBase = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'FM1SiteRelay')).TrimEnd('\')
if (-not $StateRoot) { $StateRoot = $privateBase }
$state = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\')
if ($state -ne $privateBase -and -not $state.StartsWith($privateBase + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'StateRoot must be FM1SiteRelay or a dedicated subdirectory beneath it in LOCALAPPDATA.'
}
function Assert-NoReparse([string]$Path) {
    $candidate = [IO.Path]::GetFullPath($Path)
    while ($candidate) {
        if (Test-Path -LiteralPath $candidate) {
            if ((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Private relay paths must not contain a reparse point.'
            }
        }
        $parent = Split-Path -Path $candidate -Parent
        if ($parent -eq $candidate) { break }
        $candidate = $parent
    }
}
Assert-NoReparse $state
$null = New-Item -ItemType Directory -Path $state -Force
if (-not ('FM1RelayDacl' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class FM1RelayDacl {
    [DllImport("advapi32.dll", SetLastError=true)]
    static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr dacl, out bool defaulted);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, EntryPoint="SetNamedSecurityInfoW")]
    static extern uint SetNamedSecurityInfo(string path, uint objectType, uint sections, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    public static void Apply(string path, byte[] descriptor) {
        GCHandle pin = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
        try {
            bool present, defaulted; IntPtr dacl;
            if (!GetSecurityDescriptorDacl(pin.AddrOfPinnedObject(), out present, out dacl, out defaulted) || !present)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            uint error = SetNamedSecurityInfo(path, 1, 0x80000004, IntPtr.Zero, IntPtr.Zero, dacl, IntPtr.Zero);
            if (error != 0) throw new Win32Exception((int)error);
        } finally { pin.Free(); }
    }
}
'@
}
$permittedSids = @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')
$todo = [Collections.Generic.Stack[IO.FileSystemInfo]]::new()
$todo.Push((Get-Item -LiteralPath $state -Force))
while ($todo.Count) {
    $item = $todo.Pop()
    Assert-NoReparse $item.FullName
    $acl = Get-Acl -LiteralPath $item.FullName
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $permittedSids) {
        throw 'Relay state has an unexpected owner; no existing service was changed.'
    }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $null = $acl.RemoveAccessRuleAll($rule) }
    $inheritance = if ($item.PSIsContainer) {
        [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
    } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($sidText in $permittedSids) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($sidText),
            [Security.AccessControl.FileSystemRights]::FullControl, $inheritance,
            [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    }
    [FM1RelayDacl]::Apply($item.FullName, $acl.GetSecurityDescriptorBinaryForm())
    if ($item.PSIsContainer) {
        foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) { $todo.Push($child) }
    }
}
function Assert-PrivateTokenFile([string]$Path) {
    Assert-NoReparse $Path
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw 'A credential file is unavailable.' }
    $acl = Get-Acl -LiteralPath $resolved
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            $rule.IdentityReference.Value -notin $permittedSids) {
            throw 'A credential file allows another principal; protect it locally before launch.'
        }
    }
    return $resolved
}
$arguments = @('-u', $relay, '--site-url', $SiteUrl, '--bridge-url', $BridgeUrl, '--state-dir', $state)
foreach ($item in @(
    @{Path=$RelayTokenFile;Flag='--relay-token-file';Env='FM1_RELAY_TOKEN'},
    @{Path=$SitesTokenFile;Flag='--sites-token-file';Env='FM1_SITES_SERVICE_TOKEN'},
    @{Path=$BridgeTokenFile;Flag='--bridge-token-file';Env='FM1_BRIDGE_TOKEN'})) {
    if ($item.Path) {
        $arguments += @($item.Flag, (Assert-PrivateTokenFile $item.Path))
    } elseif (-not [Environment]::GetEnvironmentVariable($item.Env)) {
        throw "Provide a private credential file or set $($item.Env) locally. No token is generated or printed."
    }
}
if ($AllowSwitch) { $arguments += '--allow-switch' }
if ($AllowOfficialUpdate) { $arguments += '--allow-official-update' }
if ($AllowStockUpdate) { $arguments += '--allow-stock-update' }
# Validate origins locally without making HTTP requests or loading USB support.
& $runtime -c 'import sys; sys.path.insert(0,sys.argv[3]); import site_relay as r; assert sys.version_info >= (3,11); r.normalize_origin(sys.argv[1],site=True); r.normalize_origin(sys.argv[2],site=False)' $SiteUrl $BridgeUrl $PSScriptRoot
if ($LASTEXITCODE -ne 0) { throw 'Relay runtime or origin validation failed.' }
if ($PrepareOnly) {
    Write-Output 'Private relay state prepared. No relay, bridge, protected helper, tunnel, or device operation was started.'
    return
}
$pidFile = Join-Path $state 'relay.pid'
if (Test-Path -LiteralPath $pidFile) {
    $pidText = [IO.File]::ReadAllText($pidFile).Trim()
    if ($pidText -match '^[0-9]+$') {
        $running = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
        if ($running) { throw 'Recorded relay PID is alive. Inspect it locally; no process was stopped or duplicate launched.' }
    }
}
function Quote-Argument([string]$Argument) {
    if ($Argument.Contains('"') -or $Argument.EndsWith('\')) { throw 'Unsupported quote or trailing slash in a launch argument.' }
    return '"' + $Argument + '"'
}
$tag = [Guid]::NewGuid().ToString('N')
$stdout = Join-Path $state "relay-$tag.out.log"
$stderr = Join-Path $state "relay-$tag.err.log"
$process = Start-Process -FilePath $runtime -ArgumentList (($arguments | ForEach-Object { Quote-Argument $_ }) -join ' ') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
[IO.File]::WriteAllText($pidFile, [string]$process.Id, [Text.UTF8Encoding]::new($false))
Start-Sleep -Milliseconds 500
$process.Refresh()
if ($process.HasExited) { throw 'Relay exited during launch. Inspect private relay logs; existing services were not changed.' }
Write-Output "Outbound relay process started, PID $($process.Id). Check the private Site for authenticated connection status."
Write-Output ('App switching enabled: ' + [bool]$AllowSwitch)
Write-Output ('Official updater handoff enabled: ' + [bool]$AllowOfficialUpdate)
Write-Output ('Native stock SysEx update enabled: ' + [bool]$AllowStockUpdate)
