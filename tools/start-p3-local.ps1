<#
.SYNOPSIS
Starts or cleans up the local P3 Vite + Wrangler development environment.

.DESCRIPTION
The script owns both child process trees. Press Ctrl+C in the same PowerShell
window to run the finally block, which terminates Vite/Wrangler and every child
process (including workerd). -StopOnly is the recovery path for a terminal that
was closed forcibly before its finally block could run.
#>
[CmdletBinding()]
param(
  [switch]$StopOnly
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$ports = @(5173, 8788)

function Get-ListeningProcessIds {
  param([Parameter(Mandatory = $true)][int]$Port)

  $pattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
  return @(
    netstat.exe -ano -p tcp |
      ForEach-Object {
        if ($_ -match $pattern) {
          [int]$Matches[1]
        }
      } |
      Sort-Object -Unique
  )
}

function Stop-ProcessTree {
  param([Parameter(Mandatory = $true)][int]$ProcessId)

  if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
    return
  }

  Write-Host "Stopping PID $ProcessId and its child process tree."
  & taskkill.exe /PID $ProcessId /T /F | Out-Host
}

function Clear-LocalP3Ports {
  $listenerProcessIds = @{}
  foreach ($port in $ports) {
    foreach ($processId in Get-ListeningProcessIds -Port $port) {
      # Do not inspect Win32_Process here: that WMI class is unavailable to
      # standard Windows users in some environments.  The port is the explicit
      # ownership boundary of this tool, and taskkill /T clears its child tree.
      $listenerProcessIds[$processId] = $true
    }
  }
  foreach ($processId in $listenerProcessIds.Keys) {
    Stop-ProcessTree -ProcessId $processId
  }

  Start-Sleep -Milliseconds 300
  foreach ($port in $ports) {
    $remaining = @(Get-ListeningProcessIds -Port $port)
    if ($remaining.Count -gt 0) {
      throw "Port $port is still in use by PID(s): $($remaining -join ', ')."
    }
  }
}

Clear-LocalP3Ports

if ($StopOnly) {
  Write-Host 'Local P4 development ports are clean.'
  exit 0
}

$backend = $null
try {
  $backend = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', 'npm.cmd run dev') -WorkingDirectory (Join-Path $repositoryRoot 'backend') -NoNewWindow -PassThru

  Write-Host 'P4 local services are starting: frontend http://127.0.0.1:5173, backend http://127.0.0.1:8788.'
  Write-Host 'Vite runs in this foreground terminal. Ctrl+C stops Vite, then this script stops the backend process tree.'
  Write-Host 'Use -StopOnly only after a forced terminal close.'

  Push-Location (Join-Path $repositoryRoot 'frontend')
  try {
    & cmd.exe /d /c 'npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort'
    if ($LASTEXITCODE -ne 0) {
      throw "Frontend development process exited with code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }

  $backend.Refresh()
  if ($backend.HasExited) {
    throw "Backend development process exited early (exit code $($backend.ExitCode))."
  }
}
finally {
  if ($backend) {
    Stop-ProcessTree -ProcessId $backend.Id
  }
}
