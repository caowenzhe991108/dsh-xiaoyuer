param(
  [string]$SiliconFlowApiKey = $env:SILICONFLOW_API_KEY,
  [string]$HindsightApiKey = $env:HINDSIGHT_API_KEY,
  [string]$PythonPath
)

$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$configDir = Join-Path $dshHome 'xiaoyuer'
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
$secretsPath = Join-Path $configDir 'secrets.json'

$secrets = @{}
if (Test-Path $secretsPath) {
  try {
    $existing = Get-Content $secretsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in $existing.PSObject.Properties) { $secrets[$property.Name] = $property.Value }
  } catch {
    Write-Warning "现有 secrets.json 无法解析，将重建：$($_.Exception.Message)"
  }
}
if ($SiliconFlowApiKey) { $secrets['siliconflowApiKey'] = $SiliconFlowApiKey }
if ($HindsightApiKey) { $secrets['hindsightApiKey'] = $HindsightApiKey }
if ($secrets.Count -gt 0) {
  $secrets | ConvertTo-Json -Depth 4 | Set-Content -Path $secretsPath -Encoding UTF8
  Write-Host "已写入密钥文件：$secretsPath"
} else {
  Write-Host "未提供密钥；如需语音转写，请设置 SILICONFLOW_API_KEY 后重跑，或编辑 $secretsPath。"
}

if ($PythonPath) {
  $resolved = (Resolve-Path $PythonPath).Path
  Set-Content -Path (Join-Path $configDir 'python.txt') -Value $resolved -Encoding UTF8
  Write-Host "Edge TTS Python：$resolved"
}

Write-Host "注意：secrets.json 含明文 API Key，仅当前 Windows 用户可读；不要提交到 Git。"
