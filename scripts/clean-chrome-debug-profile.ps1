# Stop CDP Chrome for the CX debug profile and delete the profile folder
# (cookies, Cache, Code Cache, GPUCache, etc.). Does not relaunch Chrome.
$ErrorActionPreference = 'Stop'

$Port = if ($env:CX_CDP_PORT) { $env:CX_CDP_PORT } else { '9222' }
$Profile = if ($env:CX_CHROME_DEBUG_PROFILE) {
  $env:CX_CHROME_DEBUG_PROFILE
} else {
  Join-Path $env:USERPROFILE '.cx-mile-puppeteer\chrome-debug-profile'
}

# Stop CDP Chrome using this profile so the folder can be deleted.
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Profile*" } |
  ForEach-Object {
    Write-Host "Stopping Chrome PID $($_.ProcessId) (debug profile)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

# Also free the CDP port if something is still bound.
Get-NetTCPConnection -LocalPort ([int]$Port) -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object {
    Write-Host "Stopping PID $_ on port $Port"
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }

Start-Sleep -Seconds 1

if (Test-Path $Profile) {
  Remove-Item -Recurse -Force $Profile
  Write-Host "Cleaned profile + cache: $Profile"
} else {
  Write-Host "Profile already clean: $Profile"
}
