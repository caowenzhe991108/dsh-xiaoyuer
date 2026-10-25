param(
  [string]$Profile = 'web',
  [string]$DshCli = $env:DSH_CLI
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$plugin = Join-Path $root 'plugins\dsh-xiaoyuer'

if (-not (Test-Path (Join-Path $plugin 'package.json'))) { throw "插件目录不完整：$plugin" }

if (-not $DshCli) {
  $command = Get-Command dsh -ErrorAction SilentlyContinue
  if ($command) {
    $DshCli = $command.Source
  } elseif (Test-Path 'D:\deepseekHarness\resources\runtime\cli\bin\dsh.cmd') {
    $DshCli = 'D:\deepseekHarness\resources\runtime\cli\bin\dsh.cmd'
  }
}
if (-not $DshCli) {
  throw '未找到 dsh 命令。请把 dsh 加入 PATH，或设置 $env:DSH_CLI。'
}

$spec = "link:$plugin"
Write-Host "把 $spec 安装到 DSH profile：$Profile"
& $DshCli plugin --profile $Profile add $spec
if ($LASTEXITCODE -ne 0) { throw 'DSH 插件安装失败。Desktop 用户请优先用侧栏 Plugins 页面安装本地目录。' }

Write-Host ''
Write-Host '安装完成。'
Write-Host '如果插件没有立即出现：完全退出 DSH 后重新打开，或刷新 Web 页面。'
Write-Host '不要忘记先在 .env / Hindsight 中准备好记忆服务，并运行 scripts\setup-voice.ps1。'
