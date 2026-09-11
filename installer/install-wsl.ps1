param(
    [Parameter(Mandatory = $true)]
    [string]$Binary
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw 'WSL is not installed. Install/enable WSL first, or use the Windows installer instead.'
}

$resolved = (Resolve-Path -LiteralPath $Binary).Path
$wslPath = (& wsl.exe -- wslpath -a -u $resolved 2>$null | Select-Object -First 1).Trim()
if (-not $wslPath) {
    throw "Could not translate Windows path into WSL path: $resolved"
}

$escapedWslPath = $wslPath.Replace("'", "'\"'\"'")
$script = @'
set -e
mkdir -p "$HOME/.local/bin" "$HOME/.omp-wanwandequ"
cp '__WQ_BINARY__' "$HOME/.local/bin/omp-wanwandequ"
chmod +x "$HOME/.local/bin/omp-wanwandequ"
touch "$HOME/.bashrc"
grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.bashrc" || printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.bashrc"
printf '[WQ] WSL install complete: %s\n' "$HOME/.local/bin/omp-wanwandequ"
"$HOME/.local/bin/omp-wanwandequ" doctor
'@
$script = $script.Replace('__WQ_BINARY__', $escapedWslPath)

& wsl.exe -- bash -lc $script
if ($LASTEXITCODE -ne 0) {
    throw "WSL installation failed with exit code $LASTEXITCODE"
}
