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

function Get-LocalP3DevRootProcessId {
  param([Parameter(Mandatory = $true)][int]$ProcessId)

  $processById = @{}
  Get-CimInstance Win32_Process | ForEach-Object {
    $processById[[int]$_.ProcessId] = $_
  }

  $current = $processById[$ProcessId]
  if (-not $current) {
    return $ProcessId
  }

  $rootProcessId = $ProcessId
  while ($current) {
    $commandLine = [string]$current.CommandLine
    if (
      $current.Name -in @('cmd.exe', 'node.exe') -and
      $commandLine -match '(?i)npm(?:\.cmd|\\npm-cli\.js).*\brun\s+dev|wrangler(?:\.js)?\s+dev\s+--local\s+--port\s+8788|vite(?:\.js)?\s+--host\s+127\.0\.0\.1\s+--port\s+5173'
    ) {
      $rootProcessId = [int]$current.ProcessId
    }

    $current = $processById[[int]$current.ParentProcessId]
  }

  return $rootProcessId
}

function Clear-LocalP3Ports {
  $rootProcessIds = @{}
  foreach ($port in $ports) {
    foreach ($processId in Get-ListeningProcessIds -Port $port) {
      $rootProcessIds[(Get-LocalP3DevRootProcessId -ProcessId $processId)] = $true
    }
  }

  $workspacePattern = [regex]::Escape($repositoryRoot)
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -in @('cmd.exe', 'node.exe') -and
      $_.CommandLine -match $workspacePattern -and
      $_.CommandLine -match '(?i)node_modules\\(?:\.bin\\\.\.\\)?(?:wrangler|vite)\\|(?:wrangler|vite)(?:\.js)?\s+(?:dev|--host)'
    } |
    ForEach-Object {
      $rootProcessIds[(Get-LocalP3DevRootProcessId -ProcessId ([int]$_.ProcessId))] = $true
    }

  foreach ($processId in $rootProcessIds.Keys) {
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
$frontend = $null
try {
  $backend = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', 'npm.cmd run dev') -WorkingDirectory (Join-Path $repositoryRoot 'backend') -NoNewWindow -PassThru
  $frontend = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', 'npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort') -WorkingDirectory (Join-Path $repositoryRoot 'frontend') -NoNewWindow -PassThru

  Write-Host 'P4 local services are starting: frontend http://127.0.0.1:5173, backend http://127.0.0.1:8788.'
  Write-Host 'Press Ctrl+C in this window to stop both process trees. Use -StopOnly after a forced terminal close.'

  while (-not $backend.HasExited -and -not $frontend.HasExited) {
    Start-Sleep -Seconds 1
    $backend.Refresh()
    $frontend.Refresh()
  }

  if ($backend.HasExited) {
    throw "Backend development process exited early (exit code $($backend.ExitCode))."
  }
  throw "Frontend development process exited early (exit code $($frontend.ExitCode))."
}
finally {
  if ($frontend) {
    Stop-ProcessTree -ProcessId $frontend.Id
  }
  if ($backend) {
    Stop-ProcessTree -ProcessId $backend.Id
  }
}
