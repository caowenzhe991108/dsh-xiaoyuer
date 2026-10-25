param(
  [string]$MagicDns = 'mypc.tailnet-xxxx.ts.net',
  [int]$Port = 3000,
  [string]$Profile = 'web'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$logDir = Join-Path $dshHome 'xiaoyuer'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$env:DSH_HOME = $dshHome

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "DSH Web 已在端口 $Port 运行。"
  exit 0
}

$dsh = $env:DSH_CLI
if (-not $dsh) {
  $command = Get-Command dsh -ErrorAction SilentlyContinue
  if ($command) { $dsh = $command.Source }
  elseif (Test-Path 'D:\deepseekHarness\resources\runtime\cli\bin\dsh.cmd') {
    $dsh = 'D:\deepseekHarness\resources\runtime\cli\bin\dsh.cmd'
  }
}
if (-not $dsh) { throw '未找到 dsh 命令。请设置 $env:DSH_CLI。' }

$stdout = Join-Path $logDir 'dsh-web.out.log'
$stderr = Join-Path $logDir 'dsh-web.err.log'
$arguments = @(
  '--profile', $Profile,
  '--host', '127.0.0.1',
  '--port', "$Port",
  '--no-open',
  '--public-url', "https://$MagicDns",
  '--trusted-host', $MagicDns
)
$process = Start-Process -FilePath $dsh -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

$deadline = (Get-Date).AddSeconds(45)
$url = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  if (Test-Path $stdout) {
    $line = Get-Content $stdout -Encoding UTF8 | Where-Object { $_ -match 'https://\S+\?token=' } | Select-Object -Last 1
    if ($line) {
      $url = [regex]::Match($line, 'https://\S+\?token=\S+').Value
      break
    }
  }
}
if (-not $url) {
  throw "DSH Web 未能启动，见 $stdout / $stderr"
}
Set-Content -Path (Join-Path $logDir 'phone-url.txt') -Value $url -Encoding UTF8
Set-Content -Path (Join-Path $root 'PHONE_URL.txt') -Value $url -Encoding UTF8
Write-Host "DSH Web: $url"
Write-Host "手机地址已写入 $(Join-Path $logDir 'phone-url.txt')"
