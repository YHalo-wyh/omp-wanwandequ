#!/usr/bin/env bash
set -euo pipefail

REPO="YHalo-wyh/omp-wanwandequ"
TAG="wq-dev"
ASSET="omp-wanwandequ-linux-x64"
CHECKSUM_ASSET="${ASSET}.sha256"
INSTALL_DIR="${HOME}/.local/bin"
EXE="${INSTALL_DIR}/omp-wanwandequ"
CONFIG_DIR="${HOME}/.omp-wanwandequ"
AGENT_DIR="${CONFIG_DIR}/agent"
ENV_FILE="${CONFIG_DIR}/.env"
WORK_DIR="${WANWANDEQU_WORKDIR:-$PWD}"

say() { printf '%s\n' "$*"; }

read_env_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/,""); gsub(/^\047|\047$/,"",$0); gsub(/^\"|\"$/,"",$0); print; exit}' "$ENV_FILE"
}

prompt_secret() {
  local prompt="$1"
  local value=""
  if [[ -r /dev/tty ]]; then
    printf '%s' "$prompt" > /dev/tty
    IFS= read -r -s value < /dev/tty || true
    printf '\n' > /dev/tty
  fi
  printf '%s' "$value"
}

say "[WQ] installing OMP-Wanwandequ Linux/WSL rolling build..."
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$AGENT_DIR" "$WORK_DIR/logs"

base="https://github.com/${REPO}/releases/download/${TAG}"
tmp="${EXE}.download"
curl -fL --retry 3 "${base}/${ASSET}" -o "$tmp"
curl -fL --retry 3 "${base}/${CHECKSUM_ASSET}" -o "${tmp}.sha256"
expected="$(awk '{print tolower($1)}' "${tmp}.sha256")"
actual="$(sha256sum "$tmp" | awk '{print tolower($1)}')"
rm -f "${tmp}.sha256"
if [[ "$expected" != "$actual" ]]; then
  rm -f "$tmp"
  say "[WQ] SHA256 mismatch: expected $expected got $actual"
  exit 1
fi
mv -f "$tmp" "$EXE"
chmod +x "$EXE"
say "[WQ] SHA256 verified: $actual"

# Reuse only normal OMP's non-secret model/config declarations. Secrets remain
# independent in ~/.omp-wanwandequ/.env.
if [[ -d "${HOME}/.omp/agent" ]]; then
  for name in config.yml config.yaml models.yml models.yaml; do
    src="${HOME}/.omp/agent/${name}"
    dst="${AGENT_DIR}/${name}"
    if [[ -f "$src" && ! -f "$dst" ]]; then cp "$src" "$dst"; fi
  done
fi

old_api="$(read_env_value DEEPSEEK_API_KEY || true)"
old_team="$(read_env_value WQ_TEAM_TOKEN || true)"

say ""
say "[WQ] DeepSeek V4 Flash credential"
[[ -n "$old_api" ]] && say "    API key already configured; press Enter to keep it."
api_key="$(prompt_secret 'DeepSeek API Key: ')"
[[ -z "$api_key" ]] && api_key="$old_api"

say ""
say "[WQ] Competition team token"
say "    Leave blank for interactive testing. Once configured, bare 'omp-wanwandequ' means ARMED unattended competition mode."
[[ -n "$old_team" ]] && say "    Team token already configured; press Enter to keep it."
team_token="$(prompt_secret 'WQ Team Token (optional until match start): ')"
[[ -z "$team_token" ]] && team_token="$old_team"

cat > "$ENV_FILE" <<EOF
# OMP-Wanwandequ standalone secrets/settings. Do not commit this file.
DEEPSEEK_API_KEY=${api_key}
WQ_TEAM_TOKEN=${team_token}
WANWANDEQU_PRESET=turbo
EOF
chmod 600 "$ENV_FILE"

# Future shells find the standalone command. The current piped installer cannot
# mutate its parent's PATH, so it launches via the absolute path immediately.
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    profile="${HOME}/.bashrc"
    [[ -n "${ZSH_VERSION:-}" ]] && profile="${HOME}/.zshrc"
    touch "$profile"
    grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$profile" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$profile"
    ;;
esac

say ""
say "[WQ] installed -> $EXE"
say "[WQ] workdir -> $WORK_DIR"
say "[WQ] logs -> $WORK_DIR/logs"
say "[WQ] config -> $ENV_FILE"
if [[ -n "$team_token" ]]; then
  say "[WQ] status -> ARMED: bare launch starts unattended competition mode"
else
  say "[WQ] status -> TEST MODE: bare launch opens interactive agent"
fi

cd "$WORK_DIR"
"$EXE" doctor
say ""
say "[WQ] starting..."
exec "$EXE"
