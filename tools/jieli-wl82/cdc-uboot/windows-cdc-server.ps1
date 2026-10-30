# SPDX-License-Identifier: MIT
# Loaded only from the exact hash-frozen UAC payload, never directly launched.
function Start-Fm1ProtectedServer($Config) {
    $ErrorActionPreference='Stop'
    $system32=[Environment]::SystemDirectory
    $windows=[IO.Path]::GetDirectoryName($system32)
    $env:PATH=$system32+';'+$windows
    $env:PSModulePath=[IO.Path]::Combine($system32,'WindowsPowerShell\v1.0\Modules')
    [Environment]::CurrentDirectory=$system32
    Set-Location -LiteralPath $system32
    $who=[Security.Principal.WindowsIdentity]::GetCurrent()
    if ($who.User.Value -cne $Config.owner_sid -or -not ([Security.Principal.WindowsPrincipal]::new($who)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {throw 'same_account_elevation_required'}
    $root=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) ('FM1ForgeCdc-'+$Config.id)
    if ($Config.id -cnotmatch '^[0-9a-f]{32}$' -or (Test-Path -LiteralPath $root)) {throw 'snapshot_exists'}
    $acl=[Security.AccessControl.DirectorySecurity]::new()
    $acl.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
    $null=[IO.Directory]::CreateDirectory($root,$acl)
    if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'unsafe_snapshot'}
    $audit=Get-Acl -LiteralPath $root
    if ($audit.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544' -or -not $audit.AreAccessRulesProtected) {throw 'unsafe_snapshot'}
    # CodeDOM/Add-Type must not create elevated compiler inputs or outputs in
    # the requesting user's writable temporary directory.
    $env:TEMP=$root
    $env:TMP=$root
    $fileAcl=[Security.AccessControl.FileSecurity]::new()
    $fileAcl.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)')
    function Write-Protected([string]$Name,[byte[]]$Bytes) {
        $s=[IO.FileStream]::new((Join-Path $root $Name),[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,$fileAcl)
        try {$s.Write($Bytes,0,$Bytes.Length);$s.Flush($true)} finally {$s.Dispose()}
    }
    $app=[Convert]::FromBase64String($Config.application)
    if ($app.Length -gt 581564 -or $app.Length -lt 1024 -or (Get-Fm1Hash $app) -cne $Config.application_sha256 -or $Config.target -cnotmatch '^[0-9a-f]{64}$') {throw 'application_changed'}
    $helper=[Convert]::FromBase64String($Config.helper)
    if ($helper.Length -ne 24064 -or (Get-Fm1Hash $helper) -cne 'd41da6126760c9d66660bcc0cac8d27d221806c5e369a8036921efe68dca5376') {throw 'helper_changed'}
    $sourceHashes=@{helper_sha256=(Get-Fm1Hash $helper)}
    foreach($sourceFile in @(@('FlashPolicy.cs','policy_code'),@('FlashEngine.cs','engine_code'),@('windows-cdc-link.ps1','link_code'),@('windows-cdc-server.ps1','server_code'))) {
        $sourceBytes=[Text.UTF8Encoding]::new($false).GetBytes([string]$Config.($sourceFile[1]))
        if($sourceBytes.Length -lt 1 -or $sourceBytes.Length -gt 200000){throw 'source_snapshot_invalid'}
        Write-Protected $sourceFile[0] $sourceBytes
        $sourceHashes[$sourceFile[0]]=(Get-Fm1Hash $sourceBytes)
    }
    Write-Protected 'source-digests.json' ([Text.Encoding]::UTF8.GetBytes(($sourceHashes|ConvertTo-Json -Compress)))
    Write-Protected 'wl82loader.bin' $helper
    Write-Protected 'application.bin' $app
    Write-Protected 'session.json' ([Text.Encoding]::UTF8.GetBytes(($Config | Select-Object id,owner_sid,client_pid,client_start_ticks,target,application_sha256,source | ConvertTo-Json -Depth 8)))
    $code=$Config.policy_code+"`n"+$Config.engine_code
    $imports=@([regex]::Matches($code,'(?m)^using [^\r\n]+;\s*$') | ForEach-Object {$_.Value.Trim()} | Select-Object -Unique)
    $code=($imports -join "`n")+"`n"+[regex]::Replace($code,'(?m)^using [^\r\n]+;\s*$','')
    Add-Type -TypeDefinition $code -Language CSharp
    Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.IO.Pipes;
public static class Fm1PipePeer {
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeClientProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle h,out uint p);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeServerProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle h,out uint p);
 public static void Client(NamedPipeServerStream s,int expected){uint p;if(!GetNamedPipeClientProcessId(s.SafePipeHandle,out p)||p!=expected)throw new Exception("pipe_peer_changed");}
 public static void Server(NamedPipeClientStream s,int expected){uint p;if(!GetNamedPipeServerProcessId(s.SafePipeHandle,out p)||p!=expected)throw new Exception("pipe_peer_changed");}
}
'@
    $security=[IO.Pipes.PipeSecurity]::new()
    $security.SetSecurityDescriptorSddlForm("D:P(D;;GA;;;NU)(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;$($Config.owner_sid))")
    $pipe=[IO.Pipes.NamedPipeServerStream]::new(('fm1-forge-cdc-'+$Config.id),[IO.Pipes.PipeDirection]::InOut,1,[IO.Pipes.PipeTransmissionMode]::Byte,[IO.Pipes.PipeOptions]::Asynchronous,4096,4096,$security)
    $engine=$null;$journal=$null;$disk=$null;$finished=$false;$plan=$null;$prepConsumed=$false
    function Assert-Fm1Client {
        [Fm1PipePeer]::Client($pipe,[int]$Config.client_pid)
        $client=[Diagnostics.Process]::GetProcessById([int]$Config.client_pid)
        try {if($client.StartTime.ToUniversalTime().Ticks -ne $Config.client_start_ticks){throw 'owner_process_changed'}}
        finally {$client.Dispose()}
    }
    function Read-PipeLine {
        $bytes=[Collections.Generic.List[byte]]::new();$single=[byte[]]::new(1)
        $deadline=[Diagnostics.Stopwatch]::StartNew()
        while ($deadline.ElapsedMilliseconds -lt 600000) {
            $t=$pipe.ReadAsync($single,0,1)
            if (-not $t.Wait([Math]::Max(1,600000-[int]$deadline.ElapsedMilliseconds)) -or $t.Result -ne 1) {throw 'pipe_disconnected'}
            if ($single[0] -eq 10) {return [Text.Encoding]::UTF8.GetString($bytes.ToArray())}
            $bytes.Add($single[0]);if($bytes.Count -gt 1024){throw 'pipe_request_bound'}
        }
        throw 'pipe_timeout'
    }
    function Send-Answer($Value) {
        $b=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 8 -Compress)+"`n")
        if($b.Length -gt 1500000){throw 'pipe_response_bound'}
        if(-not $pipe.WriteAsync($b,0,$b.Length).Wait(15000)){throw 'pipe_timeout'}
    }
    try {
        if(-not $pipe.WaitForConnectionAsync().Wait(60000)){throw 'pipe_connection_timeout'}
        Assert-Fm1Client
        Send-Answer @{ok=$true;data=@{ready=$true;session_id=$Config.id}}
        while(-not $finished) {
            $request=(Read-PipeLine)|ConvertFrom-Json
            Assert-Fm1Client
            if($request.token -cne $Config.token -or @($request.PSObject.Properties).Count -ne 3 -or $request.op -notin @('prepare','install','recover','reset','close')){throw 'pipe_request_rejected'}
            try {
                switch($request.op) {
                    'prepare' {
                        if($prepConsumed -or $null -ne $engine -or $request.candidate_sha256 -ne ''){throw 'prepare_consumed'}
                        $prepConsumed=$true
                        Write-Protected 'preparation-intent.json' ([Text.Encoding]::UTF8.GetBytes('{"operation":"cdc-stop-uboot-helper","automatic_retry":false}'))
                        Assert-Fm1Client
                        $disk=Enter-Fm1Loader $Config.source
                        $journal=[IO.FileStream]::new((Join-Path $root 'operations.jsonl'),[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::Read,4096,[IO.FileOptions]::WriteThrough,$fileAcl)
                        $log=[Action[string]]{param($s) $b=[Text.Encoding]::UTF8.GetBytes($s+"`n");$journal.Write($b,0,$b.Length);$journal.Flush($true)}
                        $check=[Action]{
                            Assert-Fm1Client
                            $now=Get-Fm1Loader
                            if($null -eq $now -or $now.path -cne $disk.path -or $now.instance -cne $disk.instance -or $now.location_sha256 -cne $Config.source.location_sha256){throw 'device_changed'}
                        }
                        $protocol=[Fm1ScsiProtocol]::new($disk.path)
                        $engine=[Fm1FlashEngine]::new($protocol,$app,$Config.target,$log,$check)
                        $plan=$engine.Prepare($helper)
                        $baseline=$engine.Baseline()
                        Write-Protected 'baseline.bin' $baseline
                        Write-Protected 'candidate.bin' $plan.Candidate
                        $receipt=@{schema=1;session_id=$Config.id;baseline_sha256=$plan.BaselineSha256;candidate_sha256=$plan.CandidateSha256;application_sha256=$Config.application_sha256;target_build_sha256=$Config.target;sectors=@($plan.Sectors);source_sha256=$sourceHashes}
                        $receiptBytes=[Text.Encoding]::UTF8.GetBytes(($receipt|ConvertTo-Json -Depth 6 -Compress))
                        Write-Protected 'plan.json' $receiptBytes
                        Send-Answer @{ok=$true;data=@{baseline_base64=[Convert]::ToBase64String($baseline);baseline_sha256=$plan.BaselineSha256;candidate_sha256=$plan.CandidateSha256;worker_receipt_sha256=(Get-Fm1Hash $receiptBytes);sectors=@($plan.Sectors)}}
                    }
                    {$_ -in @('install','recover')} {
                        if($null -eq $engine -or $null -eq $plan -or $request.candidate_sha256 -cne $plan.CandidateSha256){throw 'review_changed'}
                        $p=$engine.Install($request.candidate_sha256,($request.op -eq 'recover'))
                        Send-Answer @{ok=$true;data=@{candidate_sha256=$p.CandidateSha256;readback_verified=$true;mutation_attempts=$engine.MutationAttempts}}
                    }
                    'reset' {
                        if($request.candidate_sha256 -cne $plan.CandidateSha256){throw 'review_changed'}
                        $engine.Reset();Send-Answer @{ok=$true;data=@{reset_requested=$true}};$finished=$true
                    }
                    'close' {Send-Answer @{ok=$true;data=@{closed=$true}};$finished=$true}
                }
            } catch {
                # No fallback or reset; only a later explicit original-session
                # recovery can act again. Never serialize arbitrary exceptions.
                Send-Answer @{ok=$false;code='cdc_operation_stopped';data=@{recovery_required=$true}}
            }
        }
    } finally {if($null -ne $engine){$engine.Dispose()};if($null -ne $journal){$journal.Dispose()};$pipe.Dispose()}
}
