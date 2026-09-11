param(
    [string]$WorkDir = (Get-Location).Path,
    [switch]$NoLaunch,
    [switch]$SkipConfigImport
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Repo = "YHalo-wyh/omp-wanwandequ"
$Tag = "wq-dev"
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\omp-wanwandequ"
$Exe = Join-Path $InstallDir "omp-wanwandequ.exe"
$Asset = "omp-wanwandequ-windows-x64.exe"
$ChecksumAsset = "$Asset.sha256"
$WanwanConfig = Join-Path $HOME ".omp-wanwandequ"
$WanwanAgent = Join-Path $WanwanConfig "agent"
$EnvFile = Join-Path $WanwanConfig ".env"

function SecureToPlain([Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Read-ExistingEnv([string]$Path) {
    $map = @{}
    if (Test-Path $Path) {
        foreach ($line in Get-Content $Path) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
                $v = $Matches[2].Trim()
                if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) { $v = $v.Substring(1, $v.Length - 2) }
                $map[$Matches[1]] = $v
            }
        }
    }
    return $map
}

Write-Host "[WQ] installing OMP-Wanwandequ rolling build..." -ForegroundColor Cyan
$release = Invoke-RestMethod -Headers @{"User-Agent"="omp-wanwandequ-installer"} -Uri "https://api.github.com/repos/$Repo/releases/tags/$Tag"
$binary = $release.assets | Where-Object { $_.name -eq $Asset } | Select-Object -First 1
$checksum = $release.assets | Where-Object { $_.name -eq $ChecksumAsset } | Select-Object -First 1
if (-not $binary) { throw "Release $Tag does not contain $Asset" }

New-Item -ItemType Directory -Force -Path $InstallDir, $WanwanConfig, $WanwanAgent | Out-Null
$tmp = "$Exe.download"
Invoke-WebRequest -Headers @{"User-Agent"="omp-wanwandequ-installer"} -Uri $binary.browser_download_url -OutFile $tmp
if ($checksum) {
    $checksumTmp = "$tmp.sha256"
    Invoke-WebRequest -Headers @{"User-Agent"="omp-wanwandequ-installer"} -Uri $checksum.browser_download_url -OutFile $checksumTmp
    $expected = ((Get-Content $checksumTmp -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLowerInvariant()
    Remove-Item -Force $checksumTmp
    if ($actual -ne $expected) { Remove-Item -Force $tmp; throw "SHA256 mismatch: expected $expected, got $actual" }
    Write-Host "[WQ] SHA256 verified: $actual" -ForegroundColor DarkGray
}
Move-Item -Force $tmp $Exe

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$parts = @($userPath -split ';' | Where-Object { $_ })
if ($parts -notcontains $InstallDir) { [Environment]::SetEnvironmentVariable("Path", (($parts + $InstallDir) -join ';'), "User") }
if (($env:Path -split ';') -notcontains $InstallDir) { $env:Path = "$env:Path;$InstallDir" }

# Reuse only non-secret model/config declarations from a normal OMP install.
# WQ has an independent config root and its own .env secrets.
if (-not $SkipConfigImport) {
    $normalAgent = Join-Path $HOME ".omp\agent"
    if (Test-Path $normalAgent) {
        foreach ($name in @("config.yml", "config.yaml", "models.yml", "models.yaml")) {
            $src = Join-Path $normalAgent $name
            $dst = Join-Path $WanwanAgent $name
            if ((Test-Path $src -PathType Leaf) -and -not (Test-Path $dst)) { Copy-Item -Force $src $dst }
        }
    }
}

$existing = Read-ExistingEnv $EnvFile
$oldApi = if ($existing.ContainsKey("DEEPSEEK_API_KEY")) { [string]$existing["DEEPSEEK_API_KEY"] } else { "" }
$oldTeam = if ($existing.ContainsKey("WQ_TEAM_TOKEN")) { [string]$existing["WQ_TEAM_TOKEN"] } else { "" }

Write-Host ""
Write-Host "[WQ] DeepSeek V4 Flash credential" -ForegroundColor Cyan
if ($oldApi) { Write-Host "    API key is already configured; press Enter to keep it." -ForegroundColor DarkGray }
$apiSecure = Read-Host "DeepSeek API Key" -AsSecureString
$apiKey = SecureToPlain $apiSecure
if (-not $apiKey) { $apiKey = $oldApi }

Write-Host ""
Write-Host "[WQ] Competition team token" -ForegroundColor Cyan
Write-Host "    Leave blank for normal interactive testing. Once a team token is configured, running 'omp-wanwandequ' with no arguments means ARMED unattended competition mode." -ForegroundColor Yellow
if ($oldTeam) { Write-Host "    Team token is already configured; press Enter to keep it." -ForegroundColor DarkGray }
$teamSecure = Read-Host "WQ Team Token (optional until match start)" -AsSecureString
$teamToken = SecureToPlain $teamSecure
if (-not $teamToken) { $teamToken = $oldTeam }

$envLines = @(
    "# OMP-Wanwandequ standalone secrets/settings. Do not commit this file.",
    "DEEPSEEK_API_KEY=$apiKey",
    "WQ_TEAM_TOKEN=$teamToken",
    "WANWANDEQU_PRESET=turbo"
)
Set-Content -Encoding UTF8 -Path $EnvFile -Value $envLines

$resolvedWorkDir = [IO.Path]::GetFullPath($WorkDir)
New-Item -ItemType Directory -Force -Path $resolvedWorkDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $resolvedWorkDir "logs") | Out-Null
Write-Host ""
Write-Host "[WQ] installed -> $Exe" -ForegroundColor Green
Write-Host "[WQ] workdir -> $resolvedWorkDir" -ForegroundColor Green
Write-Host "[WQ] logs -> $(Join-Path $resolvedWorkDir 'logs')" -ForegroundColor Green
Write-Host "[WQ] config -> $EnvFile" -ForegroundColor Green
if ($teamToken) { Write-Host "[WQ] status -> ARMED: bare launch starts unattended competition mode" -ForegroundColor Yellow }
else { Write-Host "[WQ] status -> TEST MODE: bare launch opens interactive agent" -ForegroundColor Cyan }

Push-Location $resolvedWorkDir
try { & $Exe doctor } finally { Pop-Location }

if (-not $NoLaunch) {
    $escapedDir = $resolvedWorkDir.Replace("'", "''")
    $escapedExe = $Exe.Replace("'", "''")
    $command = "Set-Location -LiteralPath '$escapedDir'; Write-Host '[WQ] logs are written to .\logs' -ForegroundColor Cyan; & '$escapedExe'"
    Start-Process powershell.exe -WorkingDirectory $resolvedWorkDir -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $command)
    Write-Host "[WQ] launched in a new terminal." -ForegroundColor Cyan
}
