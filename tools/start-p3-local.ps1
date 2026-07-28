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
$processStatePath = Join-Path $repositoryRoot 'backend\.wrangler\p4-dev-process.json'
$backendLogPath = Join-Path $repositoryRoot 'temp\p4-backend-dev.log'
$backendErrorLogPath = Join-Path $repositoryRoot 'temp\p4-backend-dev.err.log'

function Get-ListeningProcessIds {
  param([Parameter(Mandatory = $true)][int]$Port)

  try {
    return @(
      Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
        ForEach-Object { [int]$_.OwningProcess } |
        Sort-Object -Unique
    )
  }
  catch {
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
}

function Stop-ProcessTree {
  param([Parameter(Mandatory = $true)][int]$ProcessId)

  if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
    return
  }

  Write-Host "Stopping PID $ProcessId and its child process tree."
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    # A preceding parent-tree stop can win the race after our existence check.
    # Keep that benign "process not found" message out of the normal stop path;
    # the post-command existence check below still turns a real failure into an
    # actionable error.
    $taskkillOutput = & taskkill.exe /PID $ProcessId /T /F 2>$null
    $taskkillExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $taskkillOutput | Out-Host
  if ($taskkillExitCode -ne 0) {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
      return
    }
    throw "Unable to stop PID $ProcessId (taskkill exit code $taskkillExitCode). Run 'npm.cmd run p4:stop' from an elevated terminal, then retry."
  }
}

function Get-RecordedBackendProcessId {
  if (-not (Test-Path -LiteralPath $processStatePath)) {
    return $null
  }
  try {
    $record = Get-Content -LiteralPath $processStatePath -Raw | ConvertFrom-Json
    if ($record.backendProcessId -is [int] -or $record.backendProcessId -is [long]) {
      return [int]$record.backendProcessId
    }
  }
  catch {
    Write-Warning 'Ignoring unreadable P4 local process record.'
  }
  return $null
}

function Remove-ProcessRecord {
  Remove-Item -LiteralPath $processStatePath -Force -ErrorAction SilentlyContinue
}

function Get-DevRootProcessIds {
  $processById = @{}
  try {
    Get-CimInstance Win32_Process | ForEach-Object {
      $processById[[int]$_.ProcessId] = $_
    }
  }
  catch {
    Write-Warning 'Unable to inspect process parents; falling back to fixed-port listeners.'
    return @()
  }

  $matches = @(
    $processById.Values | Where-Object {
      $_.Name -in @('cmd.exe', 'node.exe') -and
      [string]$_.CommandLine -match '(?i)(?:wrangler(?:\.js)?\s+dev\b.*--port\s+8788|vite(?:\.js)?\b.*--port\s+5173)'
    }
  )
  $matchedIds = @{}
  foreach ($process in $matches) {
    $matchedIds[[int]$process.ProcessId] = $true
  }
  return @(
    $matches |
      Where-Object { -not $matchedIds.ContainsKey([int]$_.ParentProcessId) } |
      ForEach-Object { [int]$_.ProcessId }
  )
}

function Clear-LocalP3Ports {
  $listenerProcessIds = @{}
  $recordedBackendProcessId = Get-RecordedBackendProcessId
  if ($recordedBackendProcessId) {
    $listenerProcessIds[$recordedBackendProcessId] = $true
  }
  foreach ($processId in Get-DevRootProcessIds) {
    $listenerProcessIds[$processId] = $true
  }
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
  Remove-ProcessRecord

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
  # Wrangler enables Local Explorer automatically when it detects an AI agent.
  # That explorer starts a second workerd which can consume a CPU core and
  # stall the actual local Worker.  The P4 runtime has no dependency on it.
  New-Item -ItemType Directory -Path (Split-Path -Parent $backendLogPath) -Force | Out-Null
  Remove-Item -LiteralPath $backendLogPath, $backendErrorLogPath -Force -ErrorAction SilentlyContinue
  $backend = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', 'set "X_LOCAL_EXPLORER=false" && npm.cmd run dev') -WorkingDirectory (Join-Path $repositoryRoot 'backend') -RedirectStandardOutput $backendLogPath -RedirectStandardError $backendErrorLogPath -PassThru
  @{ backendProcessId = $backend.Id; startedAt = [DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json -Compress |
    Set-Content -LiteralPath $processStatePath -Encoding utf8

  Write-Host 'P4 local services are starting: frontend http://127.0.0.1:5173, backend http://127.0.0.1:8788.'
  Write-Host "Backend logs: $backendLogPath (errors: $backendErrorLogPath)."
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
  Remove-ProcessRecord
}
