# Serve Teensy visualizer on http://localhost:4173
# Usage: powershell -File scripts\start_visualizer.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $RepoRoot "visualizer")

Write-Host "Visualizer: http://localhost:4173"
Write-Host "With M4L running, click Connect Bridge (not Connect Serial)."
Write-Host ""

python serve.py --port 4173
