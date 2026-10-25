param(
  [int]$Port = 3000,
  [int]$DelaySeconds = 20
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$logDir = Join-Path $dshHome 'xiaoyuer'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'restart.log'

function Write-Log([string]$message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  Add-Content -Path $log -Value $line -Encoding UTF8
  Write-Host $line
}

Write-Log "restart requested: port=$Port delay=${DelaySeconds}s"
if ($DelaySeconds -gt 0) { Start-Sleep -Seconds $DelaySeconds }

$stopped = @()
foreach ($connection in @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
  $target = $connection.OwningProcess
  if ($target -and $target -ne $PID -and $stopped -notcontains $target) {
    Write-Log "stopping PID $target"
    Stop-Process -Id $target -Force -ErrorAction SilentlyContinue
    $stopped += $target
  }
}

$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 300
}

Write-Log 'starting DSH web'
& (Join-Path $PSScriptRoot 'start-dsh-web.ps1') -Port $Port
Write-Log 'restart finished'
