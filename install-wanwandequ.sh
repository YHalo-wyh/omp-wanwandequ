#!/usr/bin/env bash
set -euo pipefail

REPO="YHalo-wyh/omp-wanwandequ"
TAG="${OMP_WANWANDEQU_VERSION:-wq-dev}"
INSTALL_DIR="${OMP_WANWANDEQU_INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${WANWANDEQU_CONFIG_DIR:-$HOME/.omp-wanwandequ}"

case "$(uname -s)" in
  Linux) platform="linux" ;;
  Darwin) platform="darwin" ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

asset="omp-wanwandequ-${platform}-${arch}"
checksum_asset="${asset}.sha256"
base="https://github.com/${REPO}/releases/download/${TAG}"

mkdir -p "$INSTALL_DIR" "$CONFIG_DIR"
tmp="${INSTALL_DIR}/.omp-wanwandequ.$$"
cleanup() { rm -f "$tmp" "${tmp}.sha256"; }
trap cleanup EXIT

printf '[WQ] downloading %s (%s/%s) ...\n' "$TAG" "$platform" "$arch"
curl -fL --retry 4 --retry-all-errors --connect-timeout 10 "${base}/${asset}" -o "$tmp"
curl -fL --retry 4 --retry-all-errors --connect-timeout 10 "${base}/${checksum_asset}" -o "${tmp}.sha256"
expected="$(awk '{print tolower($1)}' "${tmp}.sha256")"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp" | awk '{print tolower($1)}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp" | awk '{print tolower($1)}')"
else
  echo "Need sha256sum or shasum to verify the download." >&2
  exit 1
fi
if [[ "$actual" != "$expected" ]]; then
  echo "SHA256 mismatch: expected $expected got $actual" >&2
  exit 1
fi
chmod +x "$tmp"
mv -f "$tmp" "${INSTALL_DIR}/omp-wanwandequ"
rm -f "${tmp}.sha256"
trap - EXIT

path_line='export PATH="$HOME/.local/bin:$PATH"'
for profile in "$HOME/.bashrc" "$HOME/.zshrc"; do
  touch "$profile"
  grep -Fq "$path_line" "$profile" 2>/dev/null || printf '\n%s\n' "$path_line" >> "$profile"
done

printf '[WQ] installed -> %s\n' "${INSTALL_DIR}/omp-wanwandequ"
printf '[WQ] config    -> %s\n' "$CONFIG_DIR"
printf '[WQ] configure inside the agent with /wq-key and /wq-token\n'
printf '[WQ] run now: %s/omp-wanwandequ\n' "$INSTALL_DIR"
"${INSTALL_DIR}/omp-wanwandequ" doctor
