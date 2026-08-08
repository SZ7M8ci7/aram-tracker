$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BundledNode = "C:\Users\K\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if (Get-Command node -ErrorAction SilentlyContinue) {
    $NodeExe = (Get-Command node).Source
} elseif (Test-Path -LiteralPath $BundledNode) {
    $NodeExe = $BundledNode
} else {
    Write-Host "Node.jsが見つかりません。Node.js 20以降をインストールしてください。" -ForegroundColor Red
    Read-Host "Enterキーで終了"
    exit 1
}

Set-Location -LiteralPath $ProjectDir
Write-Host "PlayARAM Local Statsを起動します..." -ForegroundColor Cyan
Write-Host "終了するにはこの画面で Ctrl+C を押してください。"
& $NodeExe (Join-Path $ProjectDir "server.js")
