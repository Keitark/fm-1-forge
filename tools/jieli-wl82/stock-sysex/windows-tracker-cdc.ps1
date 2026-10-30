# SPDX-License-Identifier: MIT
# One-shot read-only boot verifier, owned by the packaged MCP process.
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{64}$')][string]$BuildSha256,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{32}$')][string]$Nonce,
    [ValidateRange(1,40000)][int]$TimeoutMs = 40000
)
$ErrorActionPreference = 'Stop'
$watch = [Diagnostics.Stopwatch]::StartNew()
try {
    while ($watch.ElapsedMilliseconds -lt $TimeoutMs) {
        $ports = @(Get-CimInstance -ClassName Win32_SerialPort | Where-Object {
            $_.ConfigManagerErrorCode -eq 0 -and $_.PNPDeviceID -match '^USB\\VID_3654&PID_5155(?:&REV_[0-9A-F]{4})?&MI_00\\' -and
            $_.DeviceID -cmatch '^COM[1-9][0-9]{0,4}$'
        })
        if ($ports.Count -gt 1) { throw 'ambiguous_device' }
        if ($ports.Count -eq 1) {
            $port = [IO.Ports.SerialPort]::new($ports[0].DeviceID,115200,[IO.Ports.Parity]::None,8,[IO.Ports.StopBits]::One)
            $port.DtrEnable = $false; $port.RtsEnable = $false
            $port.ReadTimeout = 150; $port.WriteTimeout = 500; $port.NewLine = "`n"
            try {
                try { $port.Open() } catch [UnauthorizedAccessException] { throw 'cdc_busy' }
                # Assert the virtual CDC host-open state after Open, then allow
                # its control request to settle. This is not a physical reset pin.
                $port.DtrEnable = $true
                if (($TimeoutMs - $watch.ElapsedMilliseconds) -le 300) { break }
                Start-Sleep -Milliseconds 300
                if ($watch.ElapsedMilliseconds -ge $TimeoutMs) { break }
                # Do not purge the live USB pipes. Fresh nonce matching and the
                # bounded line parser reject older bytes without a buffer reset.
                $port.Write("FWINFO $Nonce`n")
                $line = ''; $received = 0
                $queryStart = $watch.ElapsedMilliseconds
                while ($watch.ElapsedMilliseconds -lt $TimeoutMs -and ($watch.ElapsedMilliseconds - $queryStart) -lt 2500) {
                    try { $byte = $port.ReadByte() } catch [TimeoutException] { continue }
                    $received++
                    if ($received -gt 4096) { throw 'boot_identity_mismatch' }
                    if ($byte -eq 10) {
                        if ($line -cmatch '^FM1FW/1 MOD-EDITOR/1 ([0-9a-f]{64}) ([0-9a-f]{32})$') {
                            $observedBuild = $Matches[1]; $observedNonce = $Matches[2]
                            if ($observedNonce -ceq $Nonce) {
                                if ($observedBuild -cne $BuildSha256) { throw 'boot_build_mismatch' }
                                @{identity='MOD-EDITOR/1';transport='cdc';build_sha256=$observedBuild;nonce=$observedNonce;
                                  vid='3654';pid='5155';port=$ports[0].DeviceID} | ConvertTo-Json -Compress
                                exit 0
                            }
                        }
                        $line = ''
                    } elseif ($byte -ge 32 -and $byte -le 126 -and $line.Length -lt 256) {
                        $line += [char]$byte
                    } else { $line = '!' * 256 }
                }
            } finally { if ($port.IsOpen) { $port.Close() }; $port.Dispose() }
        }
        Start-Sleep -Milliseconds 250
    }
    throw 'reboot_timeout'
} catch {
    $code = [string]$_.Exception.Message
    if ($code -notmatch '^(ambiguous_device|boot_build_mismatch|cdc_busy|reboot_timeout)$') { $code = 'cdc_verification_failed' }
    [Console]::Error.WriteLine($code)
    exit 1
}
