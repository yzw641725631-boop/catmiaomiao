$ErrorActionPreference = 'Stop'
$taskProject = Split-Path -Parent $PSScriptRoot
$taskControl = Join-Path $taskProject 'runtime/background-service.json'
if (!(Test-Path -LiteralPath $taskControl)) { Write-Output '没有本项目托管的后台服务。'; return }
$taskService = Get-Content -LiteralPath $taskControl -Raw | ConvertFrom-Json
$taskStop = Join-Path $taskProject 'runtime/background-stop.json'
@{ id = $taskService.id } | ConvertTo-Json | Set-Content -LiteralPath $taskStop
Write-Output '已请求正常停止助理服务，聊天和文件会保留。'
