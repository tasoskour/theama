<#
.SYNOPSIS
  Installs, repairs or removes the Theama Windows service using NSSM.

.DESCRIPTION
  Runs elevated (the desktop app launches it with the UAC prompt). It accepts a
  fixed set of verbs and validated parameters only; it never evaluates caller
  supplied text. The outcome is written as JSON to -ResultFile because an
  elevated process cannot return output to its non-elevated parent.

  What "install" sets up:
    * data folders under -DataDir with a locked-down ACL (SYSTEM, Administrators
      and the installing user only; the API token lives in there)
    * the service, starting automatically (delayed) and restarting on crash
    * stdout/stderr capture with rotation into <DataDir>\logs
    * permission for the installing user to query/start/stop the service
      without elevation, so the app's Service menu works day to day
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('install', 'repair', 'uninstall')][string]$Action,
  [ValidateSet('current-user', 'local-system')][string]$Account = 'current-user',
  [string]$UserName,
  [string]$UserSid,
  [Parameter(Mandatory)][string]$NssmExe,
  [string]$NodeExe,
  [string]$ServerEntry,
  # Optional: where ffprobe.exe is; the service uses it to read duration, resolution and codecs.
  [string]$FfprobeExe,
  [Parameter(Mandatory)][string]$DataDir,
  [Parameter(Mandatory)][string]$ResultFile,
  [int]$Port = 47890
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'Theama'

function Write-Result([bool]$Ok, [string]$Message) {
  @{ ok = $Ok; message = $Message } | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultFile -Encoding UTF8
}

function Invoke-Nssm {
  param([Parameter(ValueFromRemainingArguments)][string[]]$NssmArgs)
  & $NssmExe @NssmArgs | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "nssm $($NssmArgs[0..1] -join ' ') failed with exit code $LASTEXITCODE" }
}

function Test-ServiceExists { [bool](Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) }

function Stop-TheamaService {
  if (-not (Test-ServiceExists)) { return }
  & sc.exe stop $ServiceName | Out-Null
  $deadline = (Get-Date).AddSeconds(40)
  while ((Get-Date) -lt $deadline) {
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc -or $svc.Status -eq 'Stopped') { return }
    Start-Sleep -Milliseconds 500
  }
  throw 'The service did not stop within 40 seconds.'
}

function Remove-TheamaService {
  if (-not (Test-ServiceExists)) { return }
  Stop-TheamaService
  Invoke-Nssm remove $ServiceName confirm
}

function Install-TheamaService {
  if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw "Node.js executable not found: $NodeExe" }
  if (-not (Test-Path -LiteralPath $ServerEntry -PathType Leaf)) { throw "Server bundle not found: $ServerEntry. Build the server first." }

  # Data folders and ACL. Inheritance is removed so only the listed principals
  # can read the API token; the installing user keeps Modify so the desktop app can read logs.
  foreach ($sub in '', 'data', 'cache', 'logs', 'secrets') {
    New-Item -ItemType Directory -Force -Path (Join-Path $DataDir $sub) | Out-Null
  }
  & icacls.exe $DataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*${UserSid}:(OI)(CI)M" /T /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Setting permissions on $DataDir failed (icacls exit code $LASTEXITCODE)." }

  $logs = Join-Path $DataDir 'logs'
  Invoke-Nssm install $ServiceName $NodeExe $ServerEntry
  Invoke-Nssm set $ServiceName AppDirectory (Split-Path -Parent $ServerEntry)
  Invoke-Nssm set $ServiceName DisplayName 'Theama Library Service'
  Invoke-Nssm set $ServiceName Description 'Indexes and serves the Theama media library. Safe to leave running when the Theama window is closed.'
  Invoke-Nssm set $ServiceName Start SERVICE_DELAYED_AUTO_START
  $envExtra = @("THEAMA_HOST_MODE=service", "THEAMA_DATA_DIR=$DataDir", "THEAMA_PORT=$Port")
  if ($FfprobeExe -and (Test-Path -LiteralPath $FfprobeExe -PathType Leaf)) { $envExtra += "THEAMA_FFPROBE=$FfprobeExe" }
  Invoke-Nssm set $ServiceName AppEnvironmentExtra @envExtra

  # Console output capture (crash traces end up here) with size-based rotation.
  Invoke-Nssm set $ServiceName AppStdout (Join-Path $logs 'service-stdout.log')
  Invoke-Nssm set $ServiceName AppStderr (Join-Path $logs 'service-stderr.log')
  Invoke-Nssm set $ServiceName AppStdoutCreationDisposition 4
  Invoke-Nssm set $ServiceName AppStderrCreationDisposition 4
  Invoke-Nssm set $ServiceName AppRotateFiles 1
  Invoke-Nssm set $ServiceName AppRotateOnline 1
  Invoke-Nssm set $ServiceName AppRotateBytes 5242880

  # Restart after a crash, but not in a tight loop; give the server time to close SQLite on stop.
  Invoke-Nssm set $ServiceName AppExit Default Restart
  Invoke-Nssm set $ServiceName AppRestartDelay 5000
  Invoke-Nssm set $ServiceName AppThrottle 15000
  Invoke-Nssm set $ServiceName AppStopMethodConsole 20000
  Invoke-Nssm set $ServiceName AppStopMethodWindow 5000
  Invoke-Nssm set $ServiceName AppStopMethodThreads 5000

  if ($Account -eq 'current-user') {
    $cred = Get-Credential -UserName $UserName -Message 'Enter the Windows password for the account the Theama service will run as.'
    if (-not $cred) { throw 'No credentials were entered.' }
    $plain = $cred.GetNetworkCredential().Password
    Invoke-Nssm set $ServiceName ObjectName $cred.UserName $plain
    $plain = $null
  } else {
    Invoke-Nssm set $ServiceName ObjectName LocalSystem
  }

  # Let the installing user query, start and stop the service without elevation.
  # SY/BA keep full control; IU (interactive users) can only query.
  $sddl = "D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWRPWPDTLOCRRC;;;$UserSid)"
  & sc.exe sdset $ServiceName $sddl | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Setting service permissions failed (sc.exe exit code $LASTEXITCODE)." }

  & sc.exe start $ServiceName | Out-Null
}

try {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) { throw 'This script must run elevated (as Administrator).' }
  if (-not (Test-Path -LiteralPath $NssmExe -PathType Leaf)) { throw "NSSM not found: $NssmExe. Run 'yarn nssm:fetch'." }
  if ($Action -ne 'uninstall') {
    if ($UserSid -notmatch '^S-1-5-21-[\d-]+$' -and $UserSid -notmatch '^S-1-12-1-[\d-]+$') { throw 'A valid -UserSid is required.' }
    if ($Account -eq 'current-user' -and -not $UserName) { throw '-UserName is required for the current-user account.' }
  }

  switch ($Action) {
    'install' {
      if (Test-ServiceExists) { throw 'The service is already installed. Use Repair to reinstall it.' }
      Install-TheamaService
      Write-Result $true 'Service installed and started.'
    }
    'repair' {
      Remove-TheamaService
      Install-TheamaService
      Write-Result $true 'Service reinstalled and started. Your library data was not touched.'
    }
    'uninstall' {
      Remove-TheamaService
      Write-Result $true 'Service removed. Your library data, settings and logs were kept.'
    }
  }
  exit 0
} catch {
  Write-Result $false $_.Exception.Message
  exit 1
}
