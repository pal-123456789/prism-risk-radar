# =============================================================================
#  PRism · fetch-fonts.ps1
#  Downloads the two brand fonts (Space Grotesk + IBM Plex Mono) into
#  assets\fonts\ so the app serves them itself and makes ZERO third-party
#  network calls. Run this ONCE, from anywhere:
#
#      cd "F:\HackDevenger 4.0"
#      powershell -ExecutionPolicy Bypass -File .\fetch-fonts.ps1
#
#  Source: @fontsource static woff2 files, via the jsDelivr CDN. The download
#  is a one-time build step — the live site never touches jsDelivr.
# =============================================================================

$ErrorActionPreference = "Continue"
$dir = Join-Path $PSScriptRoot "assets\fonts"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# TLS 1.2 for older PowerShell (5.1) so the HTTPS download doesn't fail.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$base  = "https://cdn.jsdelivr.net/npm/@fontsource"
$files = @(
  "space-grotesk/files/space-grotesk-latin-400-normal.woff2",
  "space-grotesk/files/space-grotesk-latin-500-normal.woff2",
  "space-grotesk/files/space-grotesk-latin-600-normal.woff2",
  "space-grotesk/files/space-grotesk-latin-700-normal.woff2",
  "ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
  "ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2",
  "ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2"
)

Write-Host ""
Write-Host "Fetching PRism brand fonts into assets\fonts\ ..." -ForegroundColor Cyan
Write-Host ""

$ok = 0
foreach ($f in $files) {
  $name = Split-Path $f -Leaf
  $out  = Join-Path $dir $name
  try {
    Invoke-WebRequest -Uri "$base/$f" -OutFile $out -UseBasicParsing -TimeoutSec 30
    $size = (Get-Item $out).Length
    if ($size -lt 1000) { throw "suspiciously small ($size bytes)" }
    Write-Host ("  OK    {0,-42} {1,8:N0} bytes" -f $name, $size) -ForegroundColor Green
    $ok++
  } catch {
    Write-Host ("  FAIL  {0,-42} {1}" -f $name, $_.Exception.Message) -ForegroundColor Red
    if (Test-Path $out) { Remove-Item $out -Force }   # never leave a truncated file
  }
}

Write-Host ""
if ($ok -eq $files.Count) {
  Write-Host "All $ok fonts downloaded. PRism is now fully self-hosted." -ForegroundColor Green
} else {
  Write-Host "Downloaded $ok / $($files.Count). The site still runs on system fonts; re-run to get the rest." -ForegroundColor Yellow
}
Write-Host ""
