#!/usr/bin/env bash
# Nex server (single binary) installer: installs the binary, deploys the
# bundled web static assets, and registers the launchctl/systemd service.
#
# Usage:
#   sudo ./install.sh --binary /path/to/nex-server-linux-x64 [--token <hex>]
#   sudo ./install.sh --binary ./nex-server-darwin-arm64 --uninstall
#
# Behavior:
#   - Binary installed to /usr/local/bin/nex-server
#   - Web assets (./web next to this script in the tarball) deployed to the
#     data dir and served by the server process itself via NEX_WEB_STATIC_ROOT
#   - Linux: creates a nex-server system user, data dir /var/lib/nex-server,
#     env file /etc/nex-server/env, systemd unit nex-server.service
#   - macOS: data dir ~/.nex/server-data, LaunchAgent com.nex.server
#   - Token auto-generated (openssl rand -hex 32) when --token is omitted and
#     no env file exists yet
set -euo pipefail

BINARY=""
TOKEN=""
UNINSTALL=0
DATA_DIR=""
WEB_ASSETS_SRC=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --binary) BINARY="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SERVICE_NAME="nex-server"

if [[ "$(uname)" == "Darwin" ]]; then
  PLATFORM="macos"
  BIN_TARGET="${HOME}/.local/bin/nex-server"
else
  PLATFORM="linux"
  BIN_TARGET="/usr/local/bin/nex-server"
fi

# Web assets location inside the install tarball. The release tarball puts
# `web/` at the bundle root alongside the binary, with this script in
# `bundle/packaging/install.sh`; dev/local invocations may instead keep `web/`
# next to the script. Probe both so a bare-metal install serves the version
# aligned web UI regardless of layout. An explicit WEB_ASSETS_SRC still wins.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${WEB_ASSETS_SRC:-}" ]]; then
  : # honor caller override
elif [[ -d "${SCRIPT_DIR}/../web" ]]; then
  WEB_ASSETS_SRC="${SCRIPT_DIR}/../web"
else
  WEB_ASSETS_SRC="${SCRIPT_DIR}/web"
fi

if [[ $UNINSTALL -eq 1 ]]; then
  if [[ "$PLATFORM" == "linux" ]]; then
    systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
    rm -f /etc/systemd/system/${SERVICE_NAME}.service /etc/nex-server/env
    rmdir /etc/nex-server 2>/dev/null || true
    userdel "$SERVICE_NAME" 2>/dev/null || true
  else
    launchctl bootout "gui/$(id -u)/com.nex.server" 2>/dev/null || \
      launchctl unload ~/Library/LaunchAgents/com.nex.server.plist 2>/dev/null || true
    rm -f ~/Library/LaunchAgents/com.nex.server.plist
  fi
  rm -f "$BIN_TARGET"
  echo "nex-server uninstalled (data directories kept)."
  exit 0
fi

[[ -n "$BINARY" ]] || { echo "--binary is required" >&2; exit 1; }
[[ -x "$BINARY" ]] || { echo "binary not executable: $BINARY" >&2; exit 1; }

install -m 0755 "$BINARY" "$BIN_TARGET"

deploy_web_assets() {
  # 目标目录 <data>/web。每次升级整体替换，保证 server 二进制与 UI 版本对齐；
  # 备份上一份到 web.bak（保留一代），失败可手动回滚。
  local target_root="$1"   # 数据目录内 .nex 的上级（DATA_DIR 本身）
  local web_dst="${target_root}/web"
  if [[ ! -d "$WEB_ASSETS_SRC" ]]; then
    echo "WARNING: web assets not found at $WEB_ASSETS_SRC; serving API only." >&2
    return 1
  fi
  if [[ -d "$web_dst" ]]; then
    rm -rf "${web_dst}.bak"
    mv "$web_dst" "${web_dst}.bak"
  fi
  mkdir -p "$target_root"
  cp -R "$WEB_ASSETS_SRC" "$web_dst"
  echo "Web assets deployed: $web_dst"
}

if [[ "$PLATFORM" == "linux" ]]; then
  DATA_DIR="${DATA_DIR:-/var/lib/${SERVICE_NAME}}"
  ENV_DIR="/etc/${SERVICE_NAME}"
  ENV_FILE="${ENV_DIR}/env"
  id "$SERVICE_NAME" &>/dev/null || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_NAME"
  mkdir -p "$DATA_DIR" "$ENV_DIR"
  deploy_web_assets "$DATA_DIR" || true
  chown -R "$SERVICE_NAME:$SERVICE_NAME" "$DATA_DIR"
  if [[ ! -f "$ENV_FILE" ]]; then
    TOKEN="${TOKEN:-$(openssl rand -hex 32)}"
    umask 077
    printf 'NEX_SERVER_AUTH_TOKEN=%s\nNEX_WEB_STATIC_ROOT=%s/web\n' "$TOKEN" "$DATA_DIR" > "$ENV_FILE"
    umask 022
  elif [[ -n "$TOKEN" ]]; then
    sed -i "s|^NEX_SERVER_AUTH_TOKEN=.*|NEX_SERVER_AUTH_TOKEN=${TOKEN}|" "$ENV_FILE"
    grep -q '^NEX_WEB_STATIC_ROOT=' "$ENV_FILE" || \
      printf 'NEX_WEB_STATIC_ROOT=%s/web\n' "$DATA_DIR" >> "$ENV_FILE"
  fi
  sed "s|/var/lib/nex-server|${DATA_DIR}|" "$SCRIPT_DIR/nex-server.service" > "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
  sleep 2
  systemctl --no-pager --lines 3 status "$SERVICE_NAME" || true
  echo
  echo "Token: $(grep NEX_SERVER_AUTH_TOKEN "$ENV_FILE" | cut -d= -f2)"
  echo "URL:   http://127.0.0.1:${NEX_SERVER_PORT:-3030}/?token=<token>"
else
  DATA_DIR="${DATA_DIR:-$HOME/.nex/server-data}"
  mkdir -p "$DATA_DIR" "$HOME/.nex" "$HOME/Library/LaunchAgents"
  deploy_web_assets "$DATA_DIR" || true
  ENV_FILE="$DATA_DIR/env"
  if [[ ! -f "$ENV_FILE" ]]; then
    TOKEN="${TOKEN:-$(openssl rand -hex 32)}"
    printf 'NEX_SERVER_AUTH_TOKEN=%s\nNEX_WEB_STATIC_ROOT=%s/web\n' "$TOKEN" "$DATA_DIR" > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  else
    if [[ -n "$TOKEN" ]]; then
      # Also normalize legacy env files written with an "export " prefix.
      sed -i '' -e "s|^export NEX_SERVER_AUTH_TOKEN=.*|NEX_SERVER_AUTH_TOKEN=${TOKEN}|" \
                -e "s|^NEX_SERVER_AUTH_TOKEN=.*|NEX_SERVER_AUTH_TOKEN=${TOKEN}|" "$ENV_FILE"
    fi
    if ! grep -qE '^(export )?NEX_WEB_STATIC_ROOT=' "$ENV_FILE"; then
      printf 'NEX_WEB_STATIC_ROOT=%s/web\n' "$DATA_DIR" >> "$ENV_FILE"
    fi
  fi
  TOKEN="$(grep -E '^(export )?NEX_SERVER_AUTH_TOKEN=' "$ENV_FILE" | head -1 | sed 's/^export //' | cut -d= -f2)"
  if [[ -z "$TOKEN" ]]; then
    echo "Could not read NEX_SERVER_AUTH_TOKEN from $ENV_FILE" >&2
    exit 1
  fi
  PLIST_SRC="$SCRIPT_DIR/com.nex.server.plist"
  PLIST_DST="$HOME/Library/LaunchAgents/com.nex.server.plist"
  # launchd does not source shell env files: the token must be injected into
  # the plist's EnvironmentVariables dict, otherwise the server runs with no
  # auth at all. NEX_WEB_STATIC_ROOT is injected the same way.
  sed "s|/Users/REPLACE_ME|$HOME|g; s|/usr/local/bin/nex-server|$HOME/.local/bin/nex-server|g" "$PLIST_SRC" | \
    sed "s|<string>REPLACE_ME_TOKEN</string>|<string>${TOKEN}</string>|" \
    | sed "s|<string>REPLACE_ME_WEB_STATIC_ROOT</string>|<string>${DATA_DIR}/web</string>|" > "$PLIST_DST"
  launchctl bootout "gui/$(id -u)/com.nex.server" 2>/dev/null || true
  launchctl load -w "$PLIST_DST"
  sleep 2
  launchctl list | grep com.nex.server || true
  echo
  echo "Token: $(grep NEX_SERVER_AUTH_TOKEN "$ENV_FILE" | cut -d= -f2)"
  echo "URL:   http://127.0.0.1:3030/?token=<token>"
  echo "Logs:  ~/.nex/server.log ~/.nex/server.err.log"
  echo "Binary: $BIN_TARGET (make sure ~/.local/bin is on your PATH)"
fi
