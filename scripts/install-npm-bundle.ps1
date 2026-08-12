$ErrorActionPreference = "Stop"

$packageDirectory = Join-Path $PSScriptRoot "packages"
$packages = @(Get-ChildItem -Path $packageDirectory -Filter "*.tgz" -File | Sort-Object Name)

if ($packages.Count -ne 6) {
  throw "Expected 6 Paseo packages, found $($packages.Count)"
}

$packagePaths = @($packages | ForEach-Object { $_.FullName })
& npm install --global --no-audit --no-fund @packagePaths
if ($LASTEXITCODE -ne 0) {
  throw "npm install failed with exit code $LASTEXITCODE"
}

& paseo --version
if ($LASTEXITCODE -ne 0) {
  throw "Paseo installation verification failed with exit code $LASTEXITCODE"
}
