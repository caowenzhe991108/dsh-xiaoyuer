param(
  [switch]$StartHindsight,
  [string]$SiliconFlowApiKey = $env:SILICONFLOW_API_KEY,
  [string]$HindsightApiKey = $env:HINDSIGHT_API_KEY
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host '已创建 .env。请打开它，填入 HINDSIGHT_API_LLM_API_KEY（以及可选的 SILICONFLOW_API_KEY）。'
}

& (Join-Path $PSScriptRoot 'setup-voice.ps1')
if ($SiliconFlowApiKey -or $HindsightApiKey) {
  & (Join-Path $PSScriptRoot 'configure.ps1') -SiliconFlowApiKey $SiliconFlowApiKey -HindsightApiKey $HindsightApiKey
}

if ($StartHindsight) {
  & (Join-Path $PSScriptRoot 'start-hindsight.ps1')
} else {
  Write-Host ''
  Write-Host '下一步：'
  Write-Host '  1. 编辑 .env，填入 Hindsight 使用的大模型 Key。'
  Write-Host '  2. 运行 scripts\start-hindsight.ps1 启动本地 Hindsight。'
  Write-Host '  3. 运行 scripts\install-dsh.ps1 -Profile <profile> 安装 DSH 插件。'
  Write-Host '  4. 按 docs\iphone-tailscale.md 配置手机访问。'
}
