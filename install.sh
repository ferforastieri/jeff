#!/usr/bin/env bash
set -euo pipefail

REPO="${JEFF_REPO:-ferforastieri/toph}"
VERSION="${JEFF_VERSION:-latest}"
PORT="${JEFF_PORT:-8787}"
WORKSPACES="${JEFF_WORKSPACES_DIR:-/srv/jeff/workspaces}"
DATA_DIR="${JEFF_DATA_DIR:-/var/lib/jeff}"
ENV_FILE="${JEFF_ENV_FILE:-/etc/jeff/jeff.env}"
SERVICE=/etc/systemd/system/jeff.service
UPDATE_HELPER=/usr/local/lib/jeff/update.sh
UPDATE_SERVICE=/etc/systemd/system/jeff-update.service
UPDATE_PATH=/etc/systemd/system/jeff-update.path
SERVICE_USER="${JEFF_SERVICE_USER:-${SUDO_USER:-}}"
DEV_COMPONENTS="${JEFF_DEV_COMPONENTS:-}"

usage() {
  cat <<'USAGE'
Usage: install.sh [--components git,node,pnpm,rust,go,python|all] [--no-components]

JEFF_DEV_COMPONENTS may also be set in the environment. If omitted and the
installer is interactive, it asks whether to install the development toolchain.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --components)
      shift
      [ "$#" -gt 0 ] || { usage; exit 1; }
      DEV_COMPONENTS="$1"
      ;;
    --components=*) DEV_COMPONENTS="${1#*=}" ;;
    --no-components) DEV_COMPONENTS="none" ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
  shift
done

if [ -z "$DEV_COMPONENTS" ] && [ -t 0 ]; then
  printf 'Install development tools on this server (git,node,pnpm,rust,go,python)? [y/N] ' >/dev/tty
  read -r ANSWER </dev/tty || ANSWER=""
  case "$ANSWER" in
    y|Y|yes|YES|s|S|sim|SIM) DEV_COMPONENTS="git,node,pnpm,rust,go,python" ;;
    *) DEV_COMPONENTS="none" ;;
  esac
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root (sudo)." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates curl openssl
fi

if [ "$VERSION" = "latest" ]; then
  VERSION=""
fi
if [ -z "$VERSION" ]; then
  echo "Could not determine the latest Jeff release." >&2
  exit 1
fi

install_dev_components() {
  [ "$DEV_COMPONENTS" = "none" ] && return 0
  [ -n "$DEV_COMPONENTS" ] || return 0
  if [ "$DEV_COMPONENTS" = "all" ]; then
    DEV_COMPONENTS="git,node,pnpm,rust,go,python"
  fi
  echo "Installing development environment: ${DEV_COMPONENTS}"
  local packages=()
  local comp
  IFS=',' read -ra SELECTED <<< "$DEV_COMPONENTS"
  for comp in "${SELECTED[@]}"; do
    comp="$(echo "$comp" | tr -d '[:space:]')"
    case "$comp" in
      git) packages+=(git) ;;
      node) packages+=(nodejs npm) ;;
      pnpm) packages+=(nodejs npm) ;;
      rust) packages+=(rustc cargo) ;;
      go)
        if command -v apt-get >/dev/null 2>&1; then packages+=(golang-go)
        elif command -v dnf >/dev/null 2>&1; then packages+=(golang)
        else packages+=(go); fi
        ;;
      python) packages+=(python3 python3-pip python3-venv) ;;
      "") ;;
      *) echo "Unknown development component: $comp" >&2 ;;
    esac
  done
  if [ "${#packages[@]}" -gt 0 ]; then
    if command -v apt-get >/dev/null 2>&1; then
      apt-get -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o Acquire::Retries=5 update
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
    elif command -v dnf >/dev/null 2>&1; then
      dnf install -y "${packages[@]}"
    elif command -v pacman >/dev/null 2>&1; then
      pacman -S --noconfirm --needed "${packages[@]}"
    else
      echo "No supported package manager found for the development environment." >&2
      return 1
    fi
  fi
  if printf '%s' ",$DEV_COMPONENTS," | grep -q ',pnpm,'; then
    npm install -g pnpm
  fi
  printf '%s\n' "$DEV_COMPONENTS" > /etc/jeff/dev-components
  echo "Development environment installed."
}

# Python debugging uses debugpy, installed here so the running server never
# downloads an adapter on demand. The Docker image bundles the same files.
install_debug_adapters() {
  local target=/usr/local/lib/jeff/debug-adapters/python
  if python3 -c "import debugpy" >/dev/null 2>&1; then
    return 0
  fi
  install -d -m 0755 "$target"
  if ! python3 -m pip --version >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3-pip
    else
      echo "Warning: python3-pip is missing; Python debugging will remain unavailable." >&2
      return 0
    fi
  fi
  if ! python3 -m pip install --no-cache-dir --break-system-packages --target "$target" debugpy==1.8.22 \
    && ! python3 -m pip install --no-cache-dir --target "$target" debugpy==1.8.22; then
    echo "Warning: could not install debugpy; Python debugging will remain unavailable." >&2
  fi
}

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ASSET="jeff-linux-amd64" ;;
  aarch64|arm64) ASSET="jeff-linux-arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

if [ -z "$VERSION" ]; then
  # Releases are partial: an Android-only release may not contain a server
  # binary. Resolve the newest release that actually carries this architecture.
  RELEASES_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=100" 2>/dev/null || true)"
  if [ -n "$RELEASES_JSON" ]; then
    VERSION="$(printf '%s\n' "$RELEASES_JSON" | awk -v asset="$ASSET" '
      /"tag_name"[[:space:]]*:/ {
        tag=$0
        sub(/^.*"tag_name"[[:space:]]*:[[:space:]]*"/, "", tag)
        sub(/".*$/, "", tag)
      }
      /"name"[[:space:]]*:/ {
        name=$0
        sub(/^.*"name"[[:space:]]*:[[:space:]]*"/, "", name)
        sub(/".*$/, "", name)
        if (name == asset && tag != "") { print tag; exit }
      }
    ')"
  fi
  if [ -z "$VERSION" ]; then
    VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
      | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || true)"
  fi
fi
if [ -z "$VERSION" ]; then
  echo "Could not determine the latest Jeff release with ${ASSET}." >&2
  exit 1
fi

URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "Downloading Jeff ${VERSION} (${ARCH})..."
curl -fL --retry 6 --retry-all-errors --retry-delay 3 "$URL" -o "$TMP"

EXISTING=0
if [ -f "$SERVICE" ] || [ -f "$ENV_FILE" ]; then
  EXISTING=1
fi

if [ -f "$ENV_FILE" ]; then
  ADDR="$(sed -n 's/^JEFF_ADDR=//p' "$ENV_FILE" | tail -n 1)"
  if [ -n "$ADDR" ]; then
    PORT="${ADDR##*:}"
  fi
  ENV_DATA_DIR="$(sed -n 's/^JEFF_DATA_DIR=//p' "$ENV_FILE" | tail -n 1)"
  if [ -n "$ENV_DATA_DIR" ]; then
    DATA_DIR="$ENV_DATA_DIR"
  fi
  ENV_WORKSPACES="$(sed -n 's/^JEFF_WORKSPACES=//p' "$ENV_FILE" | tail -n 1)"
  if [ -n "$ENV_WORKSPACES" ]; then
    WORKSPACES="$ENV_WORKSPACES"
  fi
fi

if [ -z "$SERVICE_USER" ] && [ -f "$SERVICE" ]; then
  SERVICE_USER="$(sed -n 's/^User=//p' "$SERVICE" | tail -n 1)"
fi
if [ -z "$SERVICE_USER" ] || [ "$SERVICE_USER" = "root" ]; then
  if [ "$EXISTING" -eq 0 ]; then
    SERVICE_USER="jeff"
  else
    echo "Could not determine the service user. Set JEFF_SERVICE_USER." >&2
    exit 1
  fi
fi
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  if [ "$EXISTING" -eq 1 ]; then
    echo "Service user ${SERVICE_USER} does not exist." >&2
    exit 1
  fi
  useradd --system --create-home --home-dir "$DATA_DIR" --shell /bin/bash "$SERVICE_USER"
fi
SERVICE_GROUP="${JEFF_SERVICE_GROUP:-$(id -gn "$SERVICE_USER")}"

if [ "$EXISTING" -eq 0 ]; then
  install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$DATA_DIR" "$WORKSPACES"
  install -d -m 0755 /etc/jeff
fi

PREVIOUS_VERSION=""
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
if curl -fsS --max-time 3 "$HEALTH_URL" >/tmp/jeff-existing-health.json 2>/dev/null; then
  PREVIOUS_VERSION="$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' /tmp/jeff-existing-health.json | head -1)"
fi
rm -f /tmp/jeff-existing-health.json

install -m 0755 "$TMP" /usr/local/bin/jeff
install_debug_adapters

if [ -f "$ENV_FILE" ]; then
  if grep -q '^JEFF_BUILD_ID=' "$ENV_FILE"; then
    sed -i "s|^JEFF_BUILD_ID=.*|JEFF_BUILD_ID=${VERSION}-$(date +%s)|" "$ENV_FILE"
  else
    echo "JEFF_BUILD_ID=${VERSION}-$(date +%s)" >> "$ENV_FILE"
  fi
else
  NEW_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-28)"
  {
    echo "JEFF_ADDR=0.0.0.0:${PORT}"
    echo "JEFF_DATA_DIR=${DATA_DIR}"
    echo "JEFF_WORKSPACES=${WORKSPACES}"
    echo "JEFF_ADMIN_PASSWORD=${NEW_PASSWORD}"
    echo "JEFF_BUILD_ID=${VERSION}-$(date +%s)"
    echo "JEFF_SECURE_COOKIES=true"
    [ -n "${JEFF_TRUSTED_PROXIES:-}" ] && echo "JEFF_TRUSTED_PROXIES=${JEFF_TRUSTED_PROXIES}"
    [ -n "${JEFF_FIREBASE_CREDENTIALS_FILE:-}" ] && echo "JEFF_FIREBASE_CREDENTIALS_FILE=${JEFF_FIREBASE_CREDENTIALS_FILE}"
    [ -n "${JEFF_FIREBASE_PROJECT_ID:-}" ] && echo "JEFF_FIREBASE_PROJECT_ID=${JEFF_FIREBASE_PROJECT_ID}"
  } > "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
fi

UNIT_TMP="$(mktemp)"
UPDATE_TMP="$(mktemp)"
UPDATE_SERVICE_TMP="$(mktemp)"
UPDATE_PATH_TMP="$(mktemp)"
trap 'rm -f "$TMP" "$UNIT_TMP" "$UPDATE_TMP" "$UPDATE_SERVICE_TMP" "$UPDATE_PATH_TMP"' EXIT
cat > "$UNIT_TMP" <<UNIT
[Unit]
Description=Jeff self-hosted workbench
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/local/bin/jeff
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=false
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
install -m 0644 "$UNIT_TMP" "$SERVICE"

# The web UI may request an update. The API writes an authenticated request
# file; a root-owned systemd path unit runs this helper and applies the same
# release installer as a manual `sudo bash install.sh`.
install -d -m 0755 /usr/local/lib/jeff
cat > "$UPDATE_TMP" <<UPDATE
#!/usr/bin/env bash
set -euo pipefail

# install.sh replaces this helper while the update is running. Execute from a
# private copy so replacing the file cannot corrupt the running script.
if [ "\${JEFF_UPDATER_RUNNING:-}" != "1" ]; then
  COPY="\$(mktemp)"
  cp "\$0" "\$COPY"
  JEFF_UPDATER_RUNNING=1 JEFF_UPDATER_COPY="\$COPY" exec bash "\$COPY"
fi
if [ -n "\${JEFF_UPDATER_COPY:-}" ]; then
  trap 'rm -f "\$JEFF_UPDATER_COPY"' EXIT
fi

REPO="${REPO}"
DATA_DIR="${DATA_DIR}"
SERVICE_USER="${SERVICE_USER}"
REQUEST="\${DATA_DIR}/update.request"
STATE="\${DATA_DIR}/update-state.json"
LOG="\${DATA_DIR}/update.log"

write_state() {
  status="\$1"
  version="\$2"
  printf '{"status":"%s","version":"%s","updatedAt":"%s"}\n' "\$status" "\$version" "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "\${STATE}.tmp"
  chmod 0644 "\${STATE}.tmp"
  mv "\${STATE}.tmp" "\$STATE"
}

if [ ! -s "\$REQUEST" ]; then
  exit 0
fi
TAG="\$(head -n 1 "\$REQUEST" | tr -d '[:space:]')"
rm -f "\$REQUEST"
if ! [[ "\$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+\$ ]]; then
  write_state error "\$TAG"
  exit 1
fi

INSTALLER="\$(mktemp)"
trap 'rm -f "\$INSTALLER"' EXIT
write_state running "\$TAG"
if ! curl -fL --retry 6 --retry-all-errors --retry-delay 3 "https://github.com/\${REPO}/releases/download/\${TAG}/install.sh" -o "\$INSTALLER"; then
  write_state error "\$TAG"
  exit 1
fi
if ! JEFF_REPO="\$REPO" JEFF_VERSION="\$TAG" JEFF_SERVICE_USER="\$SERVICE_USER" JEFF_DATA_DIR="\$DATA_DIR" JEFF_DEV_COMPONENTS="none" \
  bash "\$INSTALLER" >> "\$LOG" 2>&1; then
  write_state error "\$TAG"
  exit 1
fi
write_state success "\$TAG"
UPDATE
install -m 0755 "$UPDATE_TMP" "$UPDATE_HELPER"

cat > "$UPDATE_SERVICE_TMP" <<UNIT
[Unit]
Description=Jeff updater
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${UPDATE_HELPER}
UNIT
install -m 0644 "$UPDATE_SERVICE_TMP" "$UPDATE_SERVICE"

cat > "$UPDATE_PATH_TMP" <<UNIT
[Unit]
Description=Watch for Jeff update requests

[Path]
PathExists=${DATA_DIR}/update.request
Unit=jeff-update.service

[Install]
WantedBy=multi-user.target
UNIT
install -m 0644 "$UPDATE_PATH_TMP" "$UPDATE_PATH"

rollback() {
  echo "Jeff did not become healthy; rolling back the binary." >&2
  set +e
  ROLLBACK_VERSION="${JEFF_ROLLBACK_VERSION:-$PREVIOUS_VERSION}"
  if [ -n "$ROLLBACK_VERSION" ]; then
    OLD_TMP="$(mktemp)"
    OLD_URL="https://github.com/${REPO}/releases/download/v${ROLLBACK_VERSION}/${ASSET}"
    if curl -fL --retry 6 --retry-all-errors --retry-delay 3 "$OLD_URL" -o "$OLD_TMP"; then
      install -m 0755 "$OLD_TMP" /usr/local/bin/jeff
      if [ -f "$ENV_FILE" ]; then
        sed -i "s|^JEFF_BUILD_ID=.*|JEFF_BUILD_ID=${ROLLBACK_VERSION}-$(date +%s)|" "$ENV_FILE"
      fi
      systemctl restart jeff
      echo "Rolled back to ${ROLLBACK_VERSION}." >&2
    else
      echo "Could not download previous version ${ROLLBACK_VERSION}." >&2
    fi
    rm -f "$OLD_TMP"
  else
    echo "Previous version unknown; binary rollback was not possible." >&2
  fi
  exit 1
}

systemctl daemon-reload
systemctl enable jeff >/dev/null
systemctl enable --now jeff-update.path >/dev/null
systemctl restart jeff

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  rollback
fi

if ! install_dev_components; then
  echo "Warning: the development environment could not be fully installed." >&2
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Jeff ${VERSION} is running."
echo "  App:  http://${IP:-SERVER_IP}:${PORT}/app"
echo "  Data: ${DATA_DIR}"
echo "  Workspaces: ${WORKSPACES}"
echo "  Service user: ${SERVICE_USER}"
echo "  Service: systemctl status jeff"
if [ "$EXISTING" -eq 0 ]; then
  echo
  echo "Initial admin password: ${NEW_PASSWORD:-generated}"
  echo "Store it now; it will not be printed again."
else
  echo
  echo "Existing application configuration preserved."
fi
