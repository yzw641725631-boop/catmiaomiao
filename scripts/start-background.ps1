$ErrorActionPreference = 'Stop'
$taskProject = Split-Path -Parent $PSScriptRoot
$taskNode = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (Get-NetTCPConnection -State Listen -LocalPort 5217 -ErrorAction SilentlyContinue) { Write-Output '助理服务已经运行：http://127.0.0.1:5217/'; return }
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList 'scripts/background.mjs' -WorkingDirectory $taskProject -WindowStyle Hidden -PassThru
Write-Output "助理后台启动中，进程 $($taskProcess.Id)。页面：http://127.0.0.1:5217/"
