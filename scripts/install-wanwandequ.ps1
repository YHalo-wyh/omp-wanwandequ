param(
    [string]$Version = "wq-dev",
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\omp-wanwandequ"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Repo = "YHalo-wyh/omp-wanwandequ"

$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
switch ($arch) {
    "x64"   { $assetName = "omp-wanwandequ-windows-x64.exe" }
    "arm64" { $assetName = "omp-wanwandequ-windows-arm64.exe" }
    default  { throw "Unsupported Windows architecture: $arch" }
}

$base = "https://github.com/$Repo/releases/download/$Version"
$assetUrl = "$base/$assetName"
$checksumUrl = "$assetUrl.sha256"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$destination = Join-Path $InstallDir "omp-wanwandequ.exe"
$temp = "$destination.download"
$checksumTemp = "$temp.sha256"

Write-Host "[WQ] downloading $Version ($arch) ..." -ForegroundColor Cyan
try {
    Invoke-WebRequest -Headers @{"User-Agent"="omp-wanwandequ-installer"} -Uri $assetUrl -OutFile $temp
    Invoke-WebRequest -Headers @{"User-Agent"="omp-wanwandequ-installer"} -Uri $checksumUrl -OutFile $checksumTemp
    $expected = ((Get-Content $checksumTemp -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 $temp).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "SHA256 mismatch: expected $expected, got $actual" }
    Move-Item -Force $temp $destination
} finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $temp, $checksumTemp
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$parts = @($userPath -split ';' | Where-Object { $_ })
if ($parts -notcontains $InstallDir) {
    [Environment]::SetEnvironmentVariable("Path", (($parts + $InstallDir) -join ';'), "User")
}
if (($env:Path -split ';') -notcontains $InstallDir) { $env:Path = "$env:Path;$InstallDir" }

New-Item -ItemType Directory -Force -Path (Join-Path $HOME ".omp-wanwandequ") | Out-Null
Write-Host "[WQ] installed -> $destination" -ForegroundColor Green
Write-Host "[WQ] configure inside the agent with /wq-key and /wq-token" -ForegroundColor Cyan
& $destination doctor
