#!/usr/bin/env bash
# ===========================================================================
# cleverhub-boot.sh — CleverHub unified boot orchestrator
#
# Starts all CleverHub services in the correct order:
#   1. Docker daemon (dependency)
#   2. Home Assistant container
#   3. Matter Server container
#   4. Supabase (if local; skip if using hosted)
#   5. Device sync (one-shot HA → Supabase)
#   6. Web Dashboard (Next.js standalone)
#   7. Pi Agent (orchestrator, voice, cron jobs)
#
# Usage:  sudo bash cleverhub-boot.sh
#         sudo systemctl start cleverhub  (after installing the service)
# ===========================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CLEVER_DIR="/opt/clever"
REPO_DIR="$CLEVER_DIR/clever-agent"
HA_PORT=8123
ENV_FILE="$REPO_DIR/.env"
WEB_ENV_FILE="$REPO_DIR/packages/web-dashboard/.env.local"

# Load env vars
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# ---------------------------------------------------------------------------
# Colors & logging
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[CleverHub]${NC} $*"; }
warn() { echo -e "${YELLOW}[CleverHub]${NC} $*"; }
err()  { echo -e "${RED}[CleverHub]${NC} $*" >&2; }

IP_ADDR=$(hostname -I | awk '{print $1}')

# ---------------------------------------------------------------------------
# Helper: wait for HTTP endpoint
# ---------------------------------------------------------------------------
wait_for_http() {
  local url="$1"
  local name="$2"
  local max_wait="${3:-120}"
  local elapsed=0

  log "Waiting for $name..."
  while [[ $elapsed -lt $max_wait ]]; do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [[ "$code" == "200" || "$code" == "401" || "$code" == "403" ]]; then
      log "$name is ready."
      return 0
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done

  warn "$name did not respond within ${max_wait}s."
  return 1
}

# ===========================================================================
# 1. Docker
# ===========================================================================
log "Step 1/6: Ensuring Docker is running..."
if ! systemctl is-active --quiet docker; then
  systemctl start docker
  sleep 3
fi
log "Docker is running."

# ===========================================================================
# 2. Home Assistant
# ===========================================================================
log "Step 2/6: Starting Home Assistant..."
if docker ps --format '{{.Names}}' | grep -q "^homeassistant$"; then
  log "Home Assistant already running."
else
  HA_COMPOSE_DIR="$CLEVER_DIR/ha-compose"
  if [[ -f "$HA_COMPOSE_DIR/docker-compose.yml" ]]; then
    cd "$HA_COMPOSE_DIR"
    docker compose up -d
  else
    warn "No HA docker-compose.yml found at $HA_COMPOSE_DIR"
  fi
fi
wait_for_http "http://localhost:${HA_PORT}/api/" "Home Assistant" 120 || true

# ===========================================================================
# 3. Matter Server
# ===========================================================================
log "Step 3/6: Starting Matter Server..."
if docker ps --format '{{.Names}}' | grep -q "matter-server"; then
  log "Matter Server already running."
else
  if docker ps -a --format '{{.Names}}' | grep -q "matter-server"; then
    docker start matter-server
  else
    log "No Matter Server container found — skipping."
  fi
fi

# ===========================================================================
# 4. Device Sync (HA → Supabase)
# ===========================================================================
log "Step 4/6: Running device sync..."
SYNC_SCRIPT="$REPO_DIR/packages/pi-agent/src/deploy/device-sync.ts"
if [[ -f "$REPO_DIR/packages/pi-agent/dist/deploy/device-sync.js" ]]; then
  cd "$REPO_DIR"
  node packages/pi-agent/dist/deploy/device-sync.js && log "Device sync complete." || warn "Device sync failed — dashboard may be empty."
elif command -v npx &>/dev/null && [[ -f "$SYNC_SCRIPT" ]]; then
  cd "$REPO_DIR"
  npx tsx "$SYNC_SCRIPT" && log "Device sync complete." || warn "Device sync failed."
else
  warn "Device sync script not found — skipping."
fi

# ===========================================================================
# 5. Web Dashboard
# ===========================================================================
log "Step 5/6: Starting Web Dashboard..."
if systemctl is-active --quiet clever-web; then
  log "Web Dashboard already running."
else
  systemctl start clever-web 2>/dev/null || warn "clever-web service not found."
fi

# ===========================================================================
# 6. Summary
# ===========================================================================
log ""
log "══════════════════════════════════════════"
log "  CleverHub is running!"
log "══════════════════════════════════════════"
log ""
log "  Dashboard:  http://${IP_ADDR}:3000"
log "  HA (admin): http://${IP_ADDR}:${HA_PORT}"
log ""

exit 0
