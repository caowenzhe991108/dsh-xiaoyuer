$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$phoneFile = Join-Path $dshHome 'xiaoyuer\phone-url.txt'

Write-Host '=== Tailscale ==='
& 'C:\Program Files\Tailscale\tailscale.exe' status
& 'C:\Program Files\Tailscale\tailscale.exe' serve status

Write-Host ''
Write-Host '=== Ports ==='
Get-NetTCPConnection -LocalPort 3000,5050,8888,9999 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess |
  Sort-Object LocalPort, LocalAddress |
  Format-Table -AutoSize

Write-Host '=== Hindsight ==='
try {
  Invoke-RestMethod http://127.0.0.1:8888/health -TimeoutSec 3 | ConvertTo-Json -Compress
} catch {
  Write-Host "Hindsight 不可用：$($_.Exception.Message)"
}

Write-Host ''
Write-Host '=== Edge TTS helper ==='
try {
  Invoke-RestMethod http://127.0.0.1:5050/health -TimeoutSec 3 | ConvertTo-Json -Compress
} catch {
  Write-Host "TTS helper 不可用：$($_.Exception.Message)"
}

Write-Host ''
Write-Host '=== 手机地址 ==='
if (Test-Path $phoneFile) { Get-Content $phoneFile -Encoding UTF8 } else { Write-Host '尚未生成，运行 scripts\start-dsh-web.ps1' }

Write-Host ''
Write-Host '=== 自启动 ==='
$startup = [Environment]::GetFolderPath('Startup')
Get-ChildItem $startup -Filter 'Xiaoyuer*' | Select-Object Name, Length | Format-Table -AutoSize
