param([switch]$Fixture)
$ErrorActionPreference = 'Stop'
$projectDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodeExe = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = (Get-Command node).Source }
$nodeVersion = & $nodeExe -p 'process.versions.node.split(".")[0]'
if ([int]$nodeVersion -lt 24) { throw '本项目需要 Node 24 或更新版本。' }
$appDir = Join-Path $projectDir 'app'
$tsc = Join-Path $appDir 'node_modules\typescript\bin\tsc'
$vite = Join-Path $appDir 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $tsc)) { throw '请先按 README 安装项目依赖。' }
Push-Location -LiteralPath $appDir
try {
  & $nodeExe $tsc --noEmit
  if ($LASTEXITCODE -ne 0) { throw '类型检查未通过。' }
  & $nodeExe $vite build
  if ($LASTEXITCODE -ne 0) { throw '界面构建未通过。' }
} finally { Pop-Location }
$serverFile = Join-Path $projectDir 'adapters\server.mjs'
$runArgs = @('--experimental-strip-types', $serverFile)
if ($Fixture) { $runArgs += '--fixture' }
& $nodeExe @runArgs
