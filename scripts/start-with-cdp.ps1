# Launch Chrome with CDP, set CX_CDP_URL, then start the app.
# Wipes the debug Chrome profile on every start, and enables wipe + relaunch
# between scan passes (after each pass ends, while waiting for the next).
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$Port = if ($env:CX_CDP_PORT) { $env:CX_CDP_PORT } else { '9222' }

& "$PSScriptRoot\clean-chrome-debug-profile.ps1"
& "$PSScriptRoot\launch-chrome-debug.ps1"

$env:CX_CDP_URL = "http://127.0.0.1:$Port"
# After each scan pass: disconnect, wipe profile/cache, wait, relaunch Chrome.
$env:CX_CLEAN_PROFILE_BETWEEN_PASSES = '1'
Write-Host "CX_CDP_URL=$env:CX_CDP_URL"
Write-Host "CX_CLEAN_PROFILE_BETWEEN_PASSES=$env:CX_CLEAN_PROFILE_BETWEEN_PASSES"

Start-Sleep -Seconds 2

$pnpm = Join-Path $env:LOCALAPPDATA 'pnpm\pnpm.cmd'
if (-not (Test-Path $pnpm)) { $pnpm = 'pnpm.cmd' }
& $pnpm start
