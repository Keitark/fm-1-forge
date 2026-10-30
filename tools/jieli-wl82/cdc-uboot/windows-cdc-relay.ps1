# SPDX-License-Identifier: MIT
# Private child of Forge. stdin/stdout carry bounded JSON; no listening service.
$ErrorActionPreference='Stop'
$relayRoot=$PSScriptRoot
function Hash-Frozen([byte[]]$b){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Read-BoundedLine($Reader,[int]$Maximum) {
    $s=[Text.StringBuilder]::new()
    while($true){$c=$Reader.Read();if($c -lt 0){throw 'coordinator_disconnected'};if($c -eq 10){return $s.ToString()};if($s.Length -ge $Maximum){throw 'request_too_large'};$null=$s.Append([char]$c)}
}
function Emit-Relay($Value){[Console]::Out.WriteLine(($Value|ConvertTo-Json -Compress -Depth 8));[Console]::Out.Flush()}
$pipe=$null;$elevated=$null;$snapshot=$null
try {
    $init=(Read-BoundedLine ([Console]::In) 900000)|ConvertFrom-Json
    if(@($init.PSObject.Properties).Count -ne 3 -or $init.target -cnotmatch '^[0-9a-f]{64}$' -or $init.source.identity -cne 'MOD-EDITOR/1' -or $init.source.transport -cne 'cdc' -or $init.source.nonceVerified -ne $true){throw 'initial_request_invalid'}
    foreach($key in @('build_sha256','location_sha256','instance_sha256')){if($init.source.$key -cnotmatch '^[0-9a-f]{64}$'){throw 'source_invalid'}}
    $app=[Convert]::FromBase64String($init.application)
    if($app.Length -lt 1024 -or $app.Length -gt 581564){throw 'application_invalid'}
    $id=[Guid]::NewGuid().ToString('N');$token=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
    $owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $server=[IO.File]::ReadAllText((Join-Path $relayRoot 'windows-cdc-server.ps1'))
    $link=[IO.File]::ReadAllText((Join-Path $relayRoot 'windows-cdc-link.ps1'))
    $config=@{id=$id;token=$token;owner_sid=$owner;client_pid=$PID;client_start_ticks=([Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().Ticks);source=$init.source;target=$init.target;application=$init.application;application_sha256=(Hash-Frozen $app);
        helper=[Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $relayRoot 'wl82loader.bin')));
        policy_code=[IO.File]::ReadAllText((Join-Path $relayRoot 'FlashPolicy.cs'));engine_code=[IO.File]::ReadAllText((Join-Path $relayRoot 'FlashEngine.cs'));
        link_code=$link;server_code=$server}
    $data=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($config|ConvertTo-Json -Depth 8 -Compress)))
    # Config is data, not an expandable script string. Every executable byte
    # and the reviewed application are frozen before the UAC prompt.
    $payload="$link`n$server`n"+'$c=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('+$([char]39)+$data+$([char]39)+'))|ConvertFrom-Json;Start-Fm1ProtectedServer $c'
    $memory=[IO.MemoryStream]::new()
    $zip=[IO.Compression.GZipStream]::new($memory,[IO.Compression.CompressionMode]::Compress,$true)
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes($payload);$zip.Write($bytes,0,$bytes.Length);$zip.Dispose();$frozen=$memory.ToArray();$memory.Dispose()
    if($frozen.Length -gt 900000){throw 'payload_bound'}
    $snapshot=Join-Path ([IO.Path]::GetTempPath()) ('fm1-forge-cdc-'+$id+'.gz')
    $f=[IO.FileStream]::new($snapshot,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$f.Write($frozen,0,$frozen.Length);$f.Flush($true)}finally{$f.Dispose()}
    $digest=Hash-Frozen $frozen
    $path64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($snapshot))
    $verifier=@'
$ErrorActionPreference='Stop'
$system32=[Environment]::SystemDirectory
$windows=[IO.Path]::GetDirectoryName($system32)
$env:PATH=$system32+';'+$windows
$env:PSModulePath=[IO.Path]::Combine($system32,'WindowsPowerShell\v1.0\Modules')
[Environment]::CurrentDirectory=$system32
Set-Location -LiteralPath $system32
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PATH__'))
$f=[IO.FileStream]::new($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{if($f.Length -ne __SIZE__){throw 'frozen_length_changed'};$b=[byte[]]::new(__SIZE__);$o=0;while($o -lt $b.Length){$n=$f.Read($b,$o,$b.Length-$o);if($n -le 0){throw 'short_frozen_read'};$o+=$n}}finally{$f.Dispose()}
$h=[Security.Cryptography.SHA256]::Create();try{$d=([BitConverter]::ToString($h.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}
if($d -cne '__HASH__'){throw 'frozen_hash_changed'}
$m=[IO.MemoryStream]::new($b,$false);$g=[IO.Compression.GZipStream]::new($m,[IO.Compression.CompressionMode]::Decompress);$r=[IO.StreamReader]::new($g,[Text.UTF8Encoding]::new($false,$true))
try{$s=$r.ReadToEnd();if($s.Length -gt 2000000){throw 'payload_bound'}}finally{$r.Dispose()}
& ([scriptblock]::Create($s))
'@
    $verifier=$verifier.Replace('__PATH__',$path64).Replace('__SIZE__',[string]$frozen.Length).Replace('__HASH__',$digest)
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($verifier))
    $exe=[IO.Path]::Combine([Environment]::SystemDirectory,'WindowsPowerShell\v1.0\powershell.exe')
    $elevated=Start-Process -FilePath $exe -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',$encoded) -Verb RunAs -WindowStyle Hidden -PassThru
    Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.IO.Pipes;
public static class Fm1RelayPeer {
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeServerProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle h,out uint p);
 public static void Server(NamedPipeClientStream s,int expected){uint p;if(!GetNamedPipeServerProcessId(s.SafePipeHandle,out p)||p!=expected)throw new Exception("pipe_peer_changed");}
}
'@
    $pipe=[IO.Pipes.NamedPipeClientStream]::new('.','fm1-forge-cdc-'+$id,[IO.Pipes.PipeDirection]::InOut,[IO.Pipes.PipeOptions]::Asynchronous)
    $pipe.Connect(60000);[Fm1RelayPeer]::Server($pipe,$elevated.Id)
    $reader=[IO.StreamReader]::new($pipe,[Text.UTF8Encoding]::new($false,$true),$false,4096,$true)
    $writer=[IO.StreamWriter]::new($pipe,[Text.UTF8Encoding]::new($false),4096,$true);$writer.AutoFlush=$true
    $ready=(Read-BoundedLine $reader 1500000)|ConvertFrom-Json
    if(-not $ready.ok -or $ready.data.session_id -cne $id){throw 'worker_handshake_invalid'}
    Emit-Relay @{ok=$true;data=@{ready=$true;session_id=$id}}
    while($true){
        $r=(Read-BoundedLine ([Console]::In) 1024)|ConvertFrom-Json
        if(@($r.PSObject.Properties).Count -ne 2 -or $r.op -notin @('prepare','install','recover','reset','close') -or ($r.candidate_sha256 -ne '' -and $r.candidate_sha256 -cnotmatch '^[0-9a-f]{64}$')){throw 'request_rejected'}
        [Fm1RelayPeer]::Server($pipe,$elevated.Id)
        $writer.WriteLine((@{op=$r.op;candidate_sha256=$r.candidate_sha256;token=$token}|ConvertTo-Json -Compress))
        $answer=(Read-BoundedLine $reader 1500000)|ConvertFrom-Json
        if($r.op -in @('reset','close') -and $answer.ok){
            if(-not $elevated.WaitForExit(15000)){throw 'worker_shutdown_unproven'}
            $answer.data|Add-Member -NotePropertyName worker_stopped -NotePropertyValue $true
            Emit-Relay $answer;break
        }
        Emit-Relay $answer
    }
}catch{Emit-Relay @{ok=$false;code='cdc_worker_unavailable';data=@{recovery_required=$true}};exit 1}
finally{if($null -ne $pipe){$pipe.Dispose()};if($null -ne $snapshot -and [IO.File]::Exists($snapshot)){[IO.File]::Delete($snapshot)}}
