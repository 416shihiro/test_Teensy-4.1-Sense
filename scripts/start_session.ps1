# Human Instrument session: serial_hub + visualizer + browser (Bridge mode)
# Usage: powershell -File scripts\start_session.ps1
#        powershell -File scripts\start_session.ps1 -Port COM9

param(
    [string]$Port = "COM8"
)

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
Write-Host "1. serial_hub  $Port -> UDP 7400 + SSE :8765"
Write-Host "2. visualizer  $VizUrl"
Write-Host "3. viz UI      click Connect Bridge (not Connect Serial)"
Write-Host "4. Live M4L    udpreceive 7400"
Write-Host ""

$hubCmd = "Set-Location '$HubRoot'; python scripts\serial_hub.py --port $Port --baud 115200 --udp-port 7400 --quiet"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $hubCmd -WindowStyle Minimized

Start-Sleep -Seconds 2

$vizCmd = "Set-Location '$VizRoot'; python serve.py --port 4173"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $vizCmd -WindowStyle Minimized

Start-Sleep -Seconds 1
Start-Process $VizUrl

Write-Host "Started. Browser: $VizUrl"
Write-Host "Hub and Viz windows are minimized on the taskbar."
