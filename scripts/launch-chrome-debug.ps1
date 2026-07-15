# Launch Google Chrome with remote debugging for CX Mile Puppeteer (Windows).
# Usage:
#   .\scripts\launch-chrome-debug.ps1
# Then set CX_CDP_URL=http://127.0.0.1:9222 in .env.local and pnpm start

$ErrorActionPreference = 'Stop'
$Port = if ($env:CX_CDP_PORT) { $env:CX_CDP_PORT } else { '9222' }
$Profile = if ($env:CX_CHROME_DEBUG_PROFILE) {
  $env:CX_CHROME_DEBUG_PROFILE
} else {
  Join-Path $env:USERPROFILE '.cx-mile-puppeteer\chrome-debug-profile'
}

New-Item -ItemType Directory -Force -Path $Profile | Out-Null

$candidates = @(
  "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "${env:LOCALAPPDATA}\Google\Chrome\Application\chrome.exe"
)
$chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
  Write-Error 'Google Chrome not found. Install Chrome or set the path manually.'
}

Write-Host "Chrome:  $chrome"
Write-Host "Profile: $Profile"
Write-Host "CDP:     http://127.0.0.1:$Port"
Write-Host 'If Access Denied persists, wipe the profile and relaunch:'
Write-Host "  Remove-Item -Recurse -Force `"$Profile`""

& $chrome `
  "--remote-debugging-port=$Port" `
  "--user-data-dir=$Profile" `
  '--no-first-run' `
  '--no-default-browser-check' `
  'https://www.cathaypacific.com/cx/en_HK/book-a-trip/redeem-flights/redeem-flight-awards.html'
