param(
    [string]$WorkDir = (Get-Location).Path,
    [string]$Tag = "wq-dev",
    [switch]$NoLaunch,
    [switch]$SkipConfigImport
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Repo = "YHalo-wyh/omp-wanwandequ"
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\omp-wanwandequ"
$Exe = Join-Path $InstallDir "omp-wanwandequ.exe"
$Asset = "omp-wanwandequ-windows-x64.exe"
$ChecksumAsset = "$Asset.sha256"

Write-Host "[WQ] installing OMP-Wanwandequ ($Tag)..." -ForegroundColor Cyan

$release = Invoke-RestMethod -Headers @{"User-Agent"="omp-wanwandequ-installer"} -Uri "https://api.github.com/repos/$Repo/releases/tags/$Tag"
$binary = $release.assets | Where-Object { $_.name -eq $Asset } | Select-Object -First 1
$checksum = $release.assets | Where-Object { $_.name -eq $ChecksumAsset } | Select-Object -First 1
if (-not $binary) { throw "Release $Tag does not contain $Asset" }

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$tmp = "$Exe.download"
Invoke-WebRequest -Headers @{"User-Agent"="omp-wanwandequ-installer"} -Uri $binary.browser_download_url -OutFile $tmp

if ($checksum) {
    $checksumTmp = "$tmp.sha256"
    Invoke-WebRequest -Headers @{"User-Agent"="omp-wanwandequ-installer"} -Uri $checksum.browser_download_url -OutFile $checksumTmp
    $expected = ((Get-Content $checksumTmp -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLowerInvariant()
    Remove-Item -Force $checksumTmp
    if ($actual -ne $expected) {
        Remove-Item -Force $tmp
        throw "SHA256 mismatch: expected $expected, got $actual"
    }
    Write-Host "[WQ] SHA256 verified: $actual" -ForegroundColor DarkGray
}

Move-Item -Force $tmp $Exe

# Register for future terminals without replacing the user's normal `omp`.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$parts = @($userPath -split ';' | Where-Object { $_ })
if ($parts -notcontains $InstallDir) {
    [Environment]::SetEnvironmentVariable("Path", (($parts + $InstallDir) -join ';'), "User")
}
if (($env:Path -split ';') -notcontains $InstallDir) { $env:Path = "$env:Path;$InstallDir" }

# Seed the standalone config from an existing OMP install on first setup only.
# This is a copy, never a symlink: subsequent Wanwandequ changes cannot mutate normal OMP.
$normalOmp = Join-Path $HOME ".omp"
$wanwanConfig = Join-Path $HOME ".omp-wanwandequ"
if (-not $SkipConfigImport -and (Test-Path $normalOmp) -and -not (Test-Path $wanwanConfig)) {
    Write-Host "[WQ] seeding standalone config from $normalOmp (read-only source)..." -ForegroundColor DarkGray
    New-Item -ItemType Directory -Force -Path $wanwanConfig | Out-Null
    $copyNames = @("config.yml", "config.yaml", "models.yml", "models.yaml", "auth.json", "agent")
    foreach ($name in $copyNames) {
        $src = Join-Path $normalOmp $name
        if (Test-Path $src) {
            $dst = Join-Path $wanwanConfig $name
            Copy-Item -Force -Recurse $src $dst
        }
    }
}

$resolvedWorkDir = [IO.Path]::GetFullPath($WorkDir)
New-Item -ItemType Directory -Force -Path $resolvedWorkDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $resolvedWorkDir "logs") | Out-Null

Write-Host "[WQ] installed -> $Exe" -ForegroundColor Green
Write-Host "[WQ] working directory -> $resolvedWorkDir" -ForegroundColor Green
Write-Host "[WQ] logs -> $(Join-Path $resolvedWorkDir 'logs')" -ForegroundColor Green

Push-Location $resolvedWorkDir
try {
    & $Exe doctor
} finally {
    Pop-Location
}

if (-not $NoLaunch) {
    $escapedDir = $resolvedWorkDir.Replace("'", "''")
    $escapedExe = $Exe.Replace("'", "''")
    $command = "Set-Location -LiteralPath '$escapedDir'; Write-Host '[WQ] OMP-Wanwandequ ready. Logs are written to .\logs' -ForegroundColor Cyan; & '$escapedExe'"
    Start-Process powershell.exe -WorkingDirectory $resolvedWorkDir -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $command)
    Write-Host "[WQ] launched a new terminal with the interactive agent." -ForegroundColor Cyan
}
