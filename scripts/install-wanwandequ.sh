#!/usr/bin/env bash
set -euo pipefail

REPO="YHalo-wyh/omp-wanwandequ"
VERSION="${OMP_WANWANDEQU_VERSION:-latest}"
INSTALL_DIR="${OMP_WANWANDEQU_INSTALL_DIR:-$HOME/.local/bin}"

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
api="https://api.github.com/repos/${REPO}/releases"
if [[ "$VERSION" == "latest" ]]; then
  release_url="${api}/latest"
else
  [[ "$VERSION" == v* ]] || VERSION="v${VERSION}"
  release_url="${api}/tags/${VERSION}"
fi

json="$(curl -fsSL --connect-timeout 10 --max-time 60 -H 'User-Agent: omp-wanwandequ-installer' "$release_url")"
download_url="$(printf '%s' "$json" | python3 -c 'import json,sys; d=json.load(sys.stdin); name=sys.argv[1]; print(next((a["browser_download_url"] for a in d.get("assets",[]) if a.get("name")==name), ""))' "$asset")"
tag="$(printf '%s' "$json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tag_name","unknown"))')"

if [[ -z "$download_url" ]]; then
  echo "Release $tag does not contain $asset" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
tmp="${INSTALL_DIR}/.omp-wanwandequ.$$"
curl -fL --connect-timeout 10 --max-time 180 "$download_url" -o "$tmp"
chmod +x "$tmp"
mv -f "$tmp" "${INSTALL_DIR}/omp-wanwandequ"

echo "Installed omp-wanwandequ $tag -> ${INSTALL_DIR}/omp-wanwandequ"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "Add $INSTALL_DIR to PATH before using omp-wanwandequ." ;;
esac
"${INSTALL_DIR}/omp-wanwandequ" doctor
