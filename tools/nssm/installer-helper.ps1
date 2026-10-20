<#
.SYNOPSIS
  Stops or starts the Theama service on behalf of the installer.

.DESCRIPTION
  The installer is already elevated, so this needs no prompt. It exists so that an upgrade can replace the
  program files (the service runs from them) and then bring the service back, and so that nothing about the
  service lives in NSIS string quoting.

  Exit codes:  0 = nothing to do or done;  10 = (stop) the service existed and is now stopped, so the
  installer should start it again afterwards;  1 = it could not be stopped in time.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('stop', 'start')][string]$Action
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'Theama'
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) { exit 0 }

try {
  if ($Action -eq 'stop') {
    if ($svc.Status -ne 'Stopped') {
      Stop-Service -Name $ServiceName -Force
      $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
    }
    exit 10
  }
  if ($svc.Status -ne 'Running') { Start-Service -Name $ServiceName }
  exit 0
} catch {
  Write-Output $_.Exception.Message
  exit 1
}
