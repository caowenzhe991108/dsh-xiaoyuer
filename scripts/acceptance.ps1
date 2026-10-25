param(
  [switch]$Live
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:PYTHONIOENCODING = 'utf-8'

function Pass($name) { Write-Host "PASS  $name" -ForegroundColor Green }
function Fail($name, $detail) { Write-Host "FAIL  $name  $detail" -ForegroundColor Red; throw $name }

$mock = $null
$mockUri = 'http://127.0.0.1:8899/health'
try {
  $null = Invoke-RestMethod -Uri $mockUri -TimeoutSec 1
  Write-Host '复用已运行的 8899 mock Hindsight。'
} catch {
  $mock = Start-Process -FilePath 'python' -ArgumentList @('scripts\mock_hindsight.py', '--port', '8899', '--persist', '.test\mock-hindsight.json') -PassThru -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(15)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    try { $null = Invoke-RestMethod -Uri $mockUri -TimeoutSec 1; $ready = $true; break } catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $ready) { Fail 'mock Hindsight 启动' '15 秒内未就绪' }
  Pass 'mock Hindsight 启动'
}

try {
  Get-ChildItem plugins\dsh-xiaoyuer -Recurse -Filter *.js | ForEach-Object {
    & node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { Fail 'JS 语法检查' $_.FullName }
  }
  Pass 'JS 语法检查'

  & python scripts\check-links.py
  if ($LASTEXITCODE -ne 0) { Fail 'Markdown 链接检查' '' }
  Pass 'Markdown 相对链接'

  & node tests\client-module.test.mjs
  if ($LASTEXITCODE -ne 0) { Fail '客户端模块测试' '' }
  Pass '客户端模块注册'

  & node tests\bom.test.mjs
  if ($LASTEXITCODE -ne 0) { Fail 'BOM 兼容测试' '' }
  Pass 'PowerShell BOM 的密钥/Python 提示文件'

  & node tests\host-plugin.test.mjs
  if ($LASTEXITCODE -ne 0) { Fail 'Host 插件测试' '' }
  Pass 'Host 工具 / 人设开关 / 记忆硬门禁'

  & node tests\voice-routes.test.mjs
  if ($LASTEXITCODE -ne 0) { Fail '语音路由测试' '请先运行 scripts\setup-voice.ps1' }
  Pass 'ASR / Edge TTS / 路由'

  $out = Join-Path $root '.test\acceptance\distill'
  Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
  & python scripts\distill_chat.py tests\fixtures\sample_chat.txt --out $out --write --endpoint http://127.0.0.1:8899 --bank acceptance-bank --min-facts 10
  if ($LASTEXITCODE -ne 0) { Fail '离线蒸馏' "退出码 $LASTEXITCODE" }
  $log = Get-Content (Join-Path $out 'write-log.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($log.stored -lt 10) { Fail '离线蒸馏写入数' "$($log.stored) < 10" }
  $memories = Get-Content (Join-Path $out 'memories.md') -Raw -Encoding UTF8
  if ($memories -notmatch '她喜欢') { Fail '事实清单内容' '未发现“她喜欢”事实' }
  Pass "离线蒸馏（$($log.stored) 条已写入）"

  if ($Live) {
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8888/health' -TimeoutSec 5
      Pass "真实 Hindsight 在线：$($health | ConvertTo-Json -Compress)"
    } catch {
      Fail '真实 Hindsight' 'http://127.0.0.1:8888/health 不可达'
    }
  }

  Write-Host ''
  Write-Host '全部自动检查通过。' -ForegroundColor Green
  Write-Host '仍需人工完成：iPhone Safari 麦克风授权、实际语音对话、真实 Hindsight 召回。'
} finally {
  if ($mock -and -not $mock.HasExited) { Stop-Process -Id $mock.Id -Force }
}
