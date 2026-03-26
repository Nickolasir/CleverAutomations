#!/usr/bin/env bash
# ===========================================================================
# ha-install.sh — Install Home Assistant Container via Docker
#
# Sets up Home Assistant Core in a Docker container with:
#   - REST API enabled (used by our ha-bridge, NOT the built-in Assist)
#   - Persistent storage on NVMe SSD
#   - mDNS discovery (homeassistant.local)
#   - Automatic restart policy
#
# Prerequisites: os-setup.sh must have been run first.
# Usage:  sudo bash ha-install.sh
# ===========================================================================

set -euo pipefail
IFS=$'\n\t'

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[HA-INSTALL]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}       $*"; }
err()  { echo -e "${RED}[ERROR]${NC}      $*" >&2; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (use sudo)."
  exit 1
fi

if ! command -v docker &>/dev/null; then
  err "Docker is not installed. Run os-setup.sh first."
  exit 1
fi

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
HA_VERSION="stable"
HA_CONTAINER_NAME="homeassistant"
HA_PORT=8123

# Determine data directory (NVMe preferred, fallback to /opt)
if mountpoint -q /mnt/nvme 2>/dev/null; then
  HA_DATA_DIR="/mnt/nvme/ha-data"
else
  HA_DATA_DIR="/opt/clever/ha-data"
fi

mkdir -p "$HA_DATA_DIR"

log "Home Assistant data directory: $HA_DATA_DIR"

# ---------------------------------------------------------------------------
# 1. Pull Home Assistant Container image
# ---------------------------------------------------------------------------
log "Pulling Home Assistant Container image (${HA_VERSION})..."
docker pull "ghcr.io/home-assistant/home-assistant:${HA_VERSION}"

# ---------------------------------------------------------------------------
# 2. Stop existing container if running
# ---------------------------------------------------------------------------
if docker ps -a --format '{{.Names}}' | grep -q "^${HA_CONTAINER_NAME}$"; then
  log "Stopping existing Home Assistant container..."
  docker stop "$HA_CONTAINER_NAME" 2>/dev/null || true
  docker rm "$HA_CONTAINER_NAME" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# 3. Create docker-compose file
# ---------------------------------------------------------------------------
COMPOSE_DIR="$HA_DATA_DIR/../ha-compose"
mkdir -p "$COMPOSE_DIR"

cat > "$COMPOSE_DIR/docker-compose.yml" <<EOF
version: '3.8'

services:
  homeassistant:
    container_name: ${HA_CONTAINER_NAME}
    image: ghcr.io/home-assistant/home-assistant:${HA_VERSION}
    restart: unless-stopped
    privileged: true
    network_mode: host
    volumes:
      - ${HA_DATA_DIR}:/config
      - /etc/localtime:/etc/localtime:ro
      - /run/dbus:/run/dbus:ro
    environment:
      - TZ=$(cat /etc/timezone 2>/dev/null || echo "America/Chicago")
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${HA_PORT}/api/"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 60s
EOF

log "Docker Compose file created at $COMPOSE_DIR/docker-compose.yml"

# ---------------------------------------------------------------------------
# 4. Pre-configure Home Assistant for REST API access
# ---------------------------------------------------------------------------
HA_CONFIG_FILE="$HA_DATA_DIR/configuration.yaml"

if [[ ! -f "$HA_CONFIG_FILE" ]]; then
  log "Creating initial Home Assistant configuration..."
  cat > "$HA_CONFIG_FILE" <<'HACONFIG'
# CleverHub — Home Assistant Configuration
# This instance is used as the device control layer only.
# Voice is handled by our custom pipeline, NOT HA Assist.

homeassistant:
  name: Clever Home
  unit_system: imperial
  time_zone: America/Chicago
  currency: USD
  country: US

# Enable the HTTP API (used by ha-bridge REST client)
http:
  server_port: 8123
  cors_allowed_origins:
    - http://localhost:3000
    - http://localhost:8080
  use_x_forwarded_for: false
  ip_ban_enabled: true
  login_attempts_threshold: 5

# REST API is enabled by default with http component.
# Long-lived access tokens are created in the HA user profile UI.

api:

# Enable WebSocket API (used by ha-bridge WebSocket client)
websocket_api:

# Enable recorder for state history
recorder:
  purge_keep_days: 7
  commit_interval: 5

# Enable history panel
history:

# Logger configuration
logger:
  default: warning
  logs:
    homeassistant.components.api: info
    homeassistant.components.websocket_api: info

# Automation engine (for HA-native automations if needed)
automation: !include automations.yaml

# Scene definitions (HA-native scenes as backup)
scene: !include scenes.yaml

# Scripts
script: !include scripts.yaml
HACONFIG

  # Create required include files
  echo "[]" > "$HA_DATA_DIR/automations.yaml"
  echo "[]" > "$HA_DATA_DIR/scenes.yaml"
  echo "" > "$HA_DATA_DIR/scripts.yaml"

  log "Initial configuration written to $HA_CONFIG_FILE"
else
  log "Existing configuration found at $HA_CONFIG_FILE (preserving)."

  # Ensure API components are enabled
  if ! grep -q '^api:' "$HA_CONFIG_FILE"; then
    warn "Adding 'api:' to existing configuration..."
    echo -e "\n# Added by CleverHub installer\napi:" >> "$HA_CONFIG_FILE"
  fi

  if ! grep -q '^websocket_api:' "$HA_CONFIG_FILE"; then
    warn "Adding 'websocket_api:' to existing configuration..."
    echo -e "\nwebsocket_api:" >> "$HA_CONFIG_FILE"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Start Home Assistant
# ---------------------------------------------------------------------------
log "Starting Home Assistant container..."
cd "$COMPOSE_DIR"
docker compose up -d

# ---------------------------------------------------------------------------
# 6. Create systemd service to manage docker compose
# ---------------------------------------------------------------------------
cat > /etc/systemd/system/homeassistant-docker.service <<EOF
[Unit]
Description=Home Assistant Docker Compose
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${COMPOSE_DIR}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable homeassistant-docker.service
log "homeassistant-docker.service enabled for boot."

# ---------------------------------------------------------------------------
# 7. Configure mDNS for homeassistant.local
# ---------------------------------------------------------------------------
AVAHI_SERVICE_FILE="/etc/avahi/services/homeassistant.service"
if [[ ! -f "$AVAHI_SERVICE_FILE" ]]; then
  log "Configuring mDNS for homeassistant.local..."
  mkdir -p /etc/avahi/services
  cat > "$AVAHI_SERVICE_FILE" <<'AVAHI'
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">Home Assistant on %h</name>
  <service>
    <type>_home-assistant._tcp</type>
    <port>8123</port>
  </service>
  <service>
    <type>_http._tcp</type>
    <port>8123</port>
    <txt-record>path=/</txt-record>
  </service>
</service-group>
AVAHI
  systemctl restart avahi-daemon
  log "mDNS service registered."
fi

# ---------------------------------------------------------------------------
# 8. Wait for HA to become ready
# ---------------------------------------------------------------------------
log "Waiting for Home Assistant to start (this may take 2-3 minutes on first boot)..."

MAX_WAIT=180
ELAPSED=0
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${HA_PORT}/api/" | grep -q "200\|401"; then
    log "Home Assistant API is responding!"
    break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  echo -n "."
done
echo ""

if [[ $ELAPSED -ge $MAX_WAIT ]]; then
  warn "Home Assistant did not respond within ${MAX_WAIT}s."
  warn "Check logs: docker logs $HA_CONTAINER_NAME"
else
  log "Home Assistant is running at http://localhost:${HA_PORT}"
fi

# ---------------------------------------------------------------------------
# 9. Summary
# ---------------------------------------------------------------------------
log ""
log "============================================="
log "  Home Assistant Installation Complete"
log "============================================="
log ""
log "  Container:    $HA_CONTAINER_NAME"
log "  Data dir:     $HA_DATA_DIR"
log "  API URL:      http://localhost:$HA_PORT/api/"
log "  WebSocket:    ws://localhost:$HA_PORT/api/websocket"
log ""
log "  Next steps:"
log "    1. Open http://$(hostname).local:$HA_PORT in a browser"
log "    2. Complete the onboarding wizard"
log "    3. Create a long-lived access token:"
log "       Profile -> Security -> Long-Lived Access Tokens"
log "    4. Add the token to /etc/clever-agent/env as HA_TOKEN"
log ""

exit 0
