# Human Instrument 標準セッション起動（serial_hub + visualizer + ブラウザ）
# Usage: powershell -File scripts\start_session.ps1
# 停止: 開いた PowerShell ウィンドウで Ctrl+C（hub / viz サーバー）

$ErrorActionPreference = "Stop"
$TeensyRoot = Split-Path -Parent $PSScriptRoot
$WorkspaceRoot = Split-Path -Parent $TeensyRoot
$HubRoot = Join-Path $WorkspaceRoot "test_XIAO ESP32 S3 Sense"
$VizRoot = Join-Path $TeensyRoot "visualizer"
$HubScript = Join-Path $HubRoot "scripts\serial_hub.py"
$VizUrl = "http://localhost:4173/?bridge=1"

if (-not (Test-Path $HubScript)) {
    Write-Error "serial_hub.py not found: $HubScript"
}
if (-not (Test-Path $VizRoot)) {
    Write-Error "visualizer not found: $VizRoot"
}

Write-Host "=== Human Instrument session ==="
Write-Host "1. serial_hub  COM8 -> UDP 7400 + SSE :8765"
Write-Host "2. visualizer  $VizUrl (Connect Bridge 自動)"
Write-Host "3. Live M4L    udpreceive 7400（そのまま）"
Write-Host ""

$hubCmd = "Set-Location '$HubRoot'; python scripts\serial_hub.py --port COM8 --baud 115200 --udp-port 7400 --quiet"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $hubCmd -WindowStyle Minimized

Start-Sleep -Seconds 2

$vizCmd = "Set-Location '$VizRoot'; python -m http.server 4173"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $vizCmd -WindowStyle Minimized

Start-Sleep -Seconds 1
Start-Process $VizUrl

Write-Host "Started. Browser: $VizUrl"
