$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  throw '未找到 docker。请安装 Docker Desktop，并确认 docker compose 可用；或手动运行 Hindsight。'
}

Push-Location $root
try {
  if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    Write-Warning '已创建 .env；请填入 HINDSIGHT_API_LLM_API_KEY 后重新运行。'
    exit 1
  }
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { throw 'docker compose up 失败。' }

  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8888/health' -TimeoutSec 3
      Write-Host "Hindsight 就绪：$($health | ConvertTo-Json -Compress)"
      exit 0
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  docker compose logs --tail 80 hindsight
  throw 'Hindsight 在 90 秒内未就绪，请查看上面的容器日志。'
} finally {
  Pop-Location
}
