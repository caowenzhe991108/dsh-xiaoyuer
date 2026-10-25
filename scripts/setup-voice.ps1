$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root '.venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $python) { throw '未找到 Python 3。请先安装 Python 3.10+ 并加入 PATH。' }

if (-not (Test-Path $venvPython)) {
  Write-Host "创建虚拟环境：$venv"
  & $python.Source -m venv $venv
  if ($LASTEXITCODE -ne 0) { throw '创建 Python 虚拟环境失败。' }
}

Write-Host '安装/更新 edge-tts ...'
& $venvPython -m pip install --upgrade pip edge-tts
if ($LASTEXITCODE -ne 0) { throw '安装 edge-tts 失败。请检查网络或 pip 配置。' }

$probe = Join-Path $root '.test\voice-probe.mp3'
New-Item -ItemType Directory -Force -Path (Split-Path $probe -Parent) | Out-Null
$ok = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
  & $venvPython -m edge_tts --voice zh-CN-XiaoxiaoNeural --rate=+0% --pitch=+0Hz --text '你好，我是小雨。' --write-media $probe
  if ($LASTEXITCODE -eq 0 -and (Test-Path $probe) -and (Get-Item $probe).Length -gt 1000) {
    $ok = $true
    break
  }
  Write-Warning "Edge TTS 第 $attempt 次探测失败，重试..."
  Start-Sleep -Milliseconds (500 * $attempt)
}
if (-not $ok) { throw 'Edge TTS 探测失败。请检查网络，或稍后重试。' }
Remove-Item $probe -Force -ErrorAction SilentlyContinue

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$configDir = Join-Path $dshHome 'xiaoyuer'
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
Set-Content -Path (Join-Path $configDir 'python.txt') -Value $venvPython -Encoding UTF8

Write-Host ''
Write-Host 'Edge TTS 就绪。'
Write-Host "PYTHON_PATH=$venvPython"
Write-Host "已写入提示文件：$(Join-Path $configDir 'python.txt')"
