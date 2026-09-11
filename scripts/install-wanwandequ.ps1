param(
    [string]$Version = "latest",
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\omp-wanwandequ"
)

$ErrorActionPreference = "Stop"
$Repo = "YHalo-wyh/omp-wanwandequ"

$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
switch ($arch) {
    "x64"   { $assetName = "omp-wanwandequ-windows-x64.exe" }
    "arm64" { $assetName = "omp-wanwandequ-windows-arm64.exe" }
    default  { throw "Unsupported Windows architecture: $arch" }
}

$headers = @{ "User-Agent" = "omp-wanwandequ-installer" }
if ($Version -eq "latest") {
    $release = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$Repo/releases/latest"
} else {
    $tag = if ($Version.StartsWith("v")) { $Version } else { "v$Version" }
    $release = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$Repo/releases/tags/$tag"
}

$asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
if (-not $asset) {
    throw "Release $($release.tag_name) does not contain $assetName"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$destination = Join-Path $InstallDir "omp-wanwandequ.exe"
$temp = "$destination.download"
Invoke-WebRequest -Headers $headers -Uri $asset.browser_download_url -OutFile $temp
Move-Item -Force $temp $destination

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$parts = @($userPath -split ';' | Where-Object { $_ })
if ($parts -notcontains $InstallDir) {
    $newPath = (($parts + $InstallDir) -join ';')
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Host "Added $InstallDir to your user PATH."
}

Write-Host "Installed omp-wanwandequ $($release.tag_name) -> $destination"
& $destination doctor
