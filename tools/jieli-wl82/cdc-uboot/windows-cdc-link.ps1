# SPDX-License-Identifier: MIT
param([switch]$Inspect,[ValidatePattern('^[0-9a-f]{32}$')][string]$Nonce)
$ErrorActionPreference = 'Stop'
function Get-Fm1Hash([byte[]]$Bytes) {
    $h=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($h.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $h.Dispose() }
}
function Get-Fm1Location([string]$Instance) {
    $id=$Instance
    for ($i=0;$i -lt 8;$i++) {
        if ($id -match '^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}\\') {
            # Windows commonly supplies PCI and ACPI aliases for one port.
            # Bind the unique PCI route consistently across both USB identities.
            $paths=@((Get-PnpDeviceProperty -InstanceId $id -KeyName DEVPKEY_Device_LocationPaths -ErrorAction Stop).Data | Where-Object {$_ -cmatch '^PCIROOT\('} | Select-Object -Unique)
            if ($paths.Count -ne 1 -or $paths[0].Length -gt 1024) { throw 'physical_binding_unavailable' }
            return Get-Fm1Hash ([Text.Encoding]::UTF8.GetBytes($paths[0].ToUpperInvariant()))
        }
        $id=[string](Get-PnpDeviceProperty -InstanceId $id -KeyName DEVPKEY_Device_Parent -ErrorAction Stop).Data
    }
    throw 'physical_binding_unavailable'
}
function Get-Fm1Serial {
    $ports=@(Get-CimInstance Win32_SerialPort | Where-Object {
        $_.ConfigManagerErrorCode -eq 0 -and $_.PNPDeviceID -match '^USB\\VID_3654&PID_5155(?:&REV_[0-9A-F]{4})?&MI_00\\' -and $_.DeviceID -cmatch '^COM[1-9][0-9]{0,4}$'
    })
    if ($ports.Count -gt 1) { throw 'ambiguous_device' }
    if ($ports.Count -ne 1) { throw 'cdc_unavailable' }
    $p=$ports[0]
    return @{port=$p.DeviceID;location_sha256=(Get-Fm1Location $p.PNPDeviceID);instance_sha256=(Get-Fm1Hash ([Text.Encoding]::UTF8.GetBytes($p.PNPDeviceID.ToUpperInvariant())))}
}
function Open-Fm1Serial($Evidence) {
    $p=[IO.Ports.SerialPort]::new($Evidence.port,115200,[IO.Ports.Parity]::None,8,[IO.Ports.StopBits]::One)
    $p.DtrEnable=$false;$p.RtsEnable=$false;$p.ReadTimeout=100;$p.WriteTimeout=500
    try {$p.Open();$p.DtrEnable=$true;Start-Sleep -Milliseconds 300;return $p} catch {$p.Dispose();throw 'cdc_busy'}
}
function Read-Fm1Until($Port,[string]$Pattern,[int]$TimeoutMs) {
    $watch=[Diagnostics.Stopwatch]::StartNew();$line='';$count=0
    while ($watch.ElapsedMilliseconds -lt $TimeoutMs) {
        try {$b=$Port.ReadByte()} catch [TimeoutException] {continue}
        $count++;if ($count -gt 8192) {throw 'serial_response_invalid'}
        if ($b -eq 10) {
            if ($line -cmatch $Pattern) {return $line};$line=''
        } elseif ($b -ge 32 -and $b -le 126 -and $line.Length -lt 512) {$line += [char]$b} else {$line='!' * 512}
    }
    throw 'serial_timeout'
}
function Get-Fm1Proof($Port,$Evidence,[string]$Challenge) {
    $line=$null
    # Host-open control transfers can settle after the first query. Repeating
    # this read-only fresh challenge is bounded; STOP/UBOOT/writes never retry.
    for($attempt=0;$attempt -lt 2;$attempt++) {
        $Port.Write("FWINFO $Challenge`n")
        try {$line=Read-Fm1Until $Port ('^FM1FW/1 MOD-EDITOR/1 [0-9a-f]{64} '+$Challenge+'$') 3000;break}
        catch {if($_.Exception.Message -ne 'serial_timeout' -or $attempt -eq 1){throw};Start-Sleep -Milliseconds 250}
    }
    $parts=$line.Split(' ')
    return @{identity='MOD-EDITOR/1';transport='cdc';build_sha256=$parts[2];location_sha256=$Evidence.location_sha256;instance_sha256=$Evidence.instance_sha256;nonce=$Challenge;nonceVerified=$true}
}
function Get-Fm1Loader {
    $disks=@(Get-CimInstance Win32_DiskDrive | Where-Object {$_.Model -ceq 'WL82 UBOOT1.00 USB Device'})
    if ($disks.Count -gt 1) {throw 'ambiguous_device'}
    if ($disks.Count -eq 0) {return $null}
    $d=$disks[0];$id=$d.PNPDeviceID;$matched=$false
    for ($i=0;$i -lt 8;$i++) {
        if ($id -match '^USB\\VID_4C4A&PID_8057\\') {$matched=$true;break}
        $id=[string](Get-PnpDeviceProperty -InstanceId $id -KeyName DEVPKEY_Device_Parent -ErrorAction Stop).Data
    }
    if (-not $matched -or $d.DeviceID -cnotmatch '^\\\\\.\\PHYSICALDRIVE[0-9]{1,3}$') {throw 'loader_identity_mismatch'}
    return @{path=$d.DeviceID;instance=$d.PNPDeviceID;location_sha256=(Get-Fm1Location $id)}
}
function Enter-Fm1Loader($Source) {
    # Reject an existing recovery unit; only this freshly challenged transition
    # can authorize uploading the RAM helper in this process.
    if ($null -ne (Get-Fm1Loader)) {throw 'existing_loader_rejected'}
    $e=Get-Fm1Serial
    if ($e.location_sha256 -cne $Source.location_sha256 -or $e.instance_sha256 -cne $Source.instance_sha256) {throw 'device_changed'}
    $port=Open-Fm1Serial $e
    try {
        $nonce=[Guid]::NewGuid().ToString('N');$proof=Get-Fm1Proof $port $e $nonce
        if ($proof.build_sha256 -cne $Source.build_sha256) {throw 'device_changed'}
        $port.Write("MOD STOP`n");Start-Sleep -Milliseconds 150
        $port.Write("MOD STATUS`n");$null=Read-Fm1Until $port '^MOD status ready=1 running=0\b.*$' 3000
        $port.Write("UBOOT`n");$null=Read-Fm1Until $port '^OK UBOOT ARMED CONFIRM-WITHIN-5000MS$' 2500
        $port.Write("UBOOT CONFIRM`n")
    } finally {if ($port.IsOpen) {$port.Close()};$port.Dispose()}
    $watch=[Diagnostics.Stopwatch]::StartNew()
    while ($watch.ElapsedMilliseconds -lt 30000) {
        $d=Get-Fm1Loader
        if ($null -ne $d) {
            if ($d.location_sha256 -cne $Source.location_sha256) {throw 'device_changed'}
            return $d
        }
        Start-Sleep -Milliseconds 250
    }
    throw 'loader_timeout'
}
if ($Inspect) {
    try {
        if ($Nonce -cnotmatch '^[0-9a-f]{32}$') {throw 'invalid_challenge'}
        $e=Get-Fm1Serial;$p=Open-Fm1Serial $e
        try {Get-Fm1Proof $p $e $Nonce | ConvertTo-Json -Compress} finally {if($p.IsOpen){$p.Close()};$p.Dispose()}
    } catch {[Console]::Error.WriteLine('cdc_inspection_failed');exit 1}
}
