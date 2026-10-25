param(
  [int]$Port = 5050
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
$logDir = Join-Path $env:USERPROFILE '.dsh\xiaoyuer'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (-not (Test-Path $python)) { throw "缺少 Edge TTS Python：$python。先运行 scripts\setup-voice.ps1。" }

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Host "Edge TTS helper 已在端口 $Port 运行。"
  exit 0
}

$args = @(
  (Join-Path $root 'scripts\edge_tts_server.py'),
  '--host', '127.0.0.1',
  '--port', "$Port"
)
$process = Start-Process -FilePath $python -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir 'edge-tts.out.log') `
  -RedirectStandardError (Join-Path $logDir 'edge-tts.err.log') `
  -PassThru

$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($health.ok) {
      Write-Host "Edge TTS helper 已启动：http://127.0.0.1:$Port (PID $($process.Id))"
      exit 0
    }
  } catch {
    Start-Sleep -Milliseconds 300
  }
}
throw "Edge TTS helper 启动失败，见 $logDir\edge-tts.err.log"
