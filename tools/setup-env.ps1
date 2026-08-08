# Finds your laptop's wifi IP and writes app\.env for you.
#
#   cd witness
#   powershell -ExecutionPolicy Bypass -File tools\setup-env.ps1
#
# The phone cannot reach "localhost" - on the phone, that means the phone.
# It needs your laptop's address on the wifi network you are both on.

$ErrorActionPreference = 'Stop'
$appDir = Join-Path $PSScriptRoot '..\app'
$envFile = Join-Path $appDir '.env'

Write-Host ""
Write-Host "Looking for your wifi address..." -ForegroundColor Cyan

# Real wifi/ethernet only. Skips loopback, WSL, VirtualBox, VMware, Hyper-V,
# and 169.254.x.x (which means "no network", not an address).
$candidates = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.254.*' -and
    $_.InterfaceAlias -notmatch 'Loopback|WSL|vEthernet|VirtualBox|VMware|Hyper-V'
  } |
  Sort-Object { if ($_.InterfaceAlias -match 'Wi-Fi|Wireless') { 0 } else { 1 } }

if (-not $candidates) {
  Write-Host "No network address found. Are you connected to wifi?" -ForegroundColor Red
  exit 1
}

if ($candidates.Count -gt 1) {
  Write-Host "Found more than one. Pick the one your PHONE is also on:" -ForegroundColor Yellow
  for ($i = 0; $i -lt $candidates.Count; $i++) {
    Write-Host ("  [{0}] {1,-28} {2}" -f $i, $candidates[$i].InterfaceAlias, $candidates[$i].IPAddress)
  }
  $pick = Read-Host "Number (Enter for 0)"
  if ([string]::IsNullOrWhiteSpace($pick)) { $pick = 0 }
  $ip = $candidates[[int]$pick].IPAddress
} else {
  $ip = $candidates[0].IPAddress
}

@"
# Written by tools\setup-env.ps1
# Restart 'npm start' after changing this - it is baked in at bundle time.
EXPO_PUBLIC_SERVER_URL=http://${ip}:8787

# Optional. Blank = the app speaks the deterministic on-device template.
# The verdict is identical either way; this only changes the wording.
EXPO_PUBLIC_LLM_URL=
EXPO_PUBLIC_LLM_KEY=
EXPO_PUBLIC_LLM_MODEL=claude-sonnet-5
"@ | Set-Content -Path $envFile -Encoding UTF8

Write-Host ""
Write-Host "Your laptop: $ip" -ForegroundColor Green
Write-Host "Wrote:       app\.env" -ForegroundColor Green
Write-Host ""
Write-Host "Check it works - open this on your PHONE's browser:" -ForegroundColor Cyan
Write-Host "    http://${ip}:8787/health" -ForegroundColor White
Write-Host "  Expect: {`"ok`":true}"
Write-Host "  Nothing loads? Windows Firewall is blocking Node. Allow it on Private networks."
Write-Host "  (Start the server first: node server\index.mjs)"
Write-Host ""
