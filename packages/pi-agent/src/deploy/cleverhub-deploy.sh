#!/usr/bin/env bash
# ===========================================================================
# cleverhub-deploy.sh — Pull, build, and redeploy CleverHub on the Pi
#
# One command to update everything after pushing code changes:
#   sudo bash cleverhub-deploy.sh
#
# What it does:
#   1. git pull latest code
#   2. npm run build (turbo monorepo)
#   3. Copy static assets for Next.js standalone
#   4. Restart web dashboard
#   5. Run device sync
# ===========================================================================

set -euo pipefail

REPO_DIR="/opt/clever/clever-agent"
WEB_DIR="$REPO_DIR/packages/web-dashboard"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[Deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[Deploy]${NC} $*"; }
err()  { echo -e "${RED}[Deploy]${NC} $*" >&2; }

IP_ADDR=$(hostname -I | awk '{print $1}')

# ---------------------------------------------------------------------------
# 1. Pull
# ---------------------------------------------------------------------------
log "Step 1/5: Pulling latest code..."
cd "$REPO_DIR"
git pull

# ---------------------------------------------------------------------------
# 2. Build
# ---------------------------------------------------------------------------
log "Step 2/5: Building all packages..."
rm -rf "$WEB_DIR/.next" .turbo
npm run build

# ---------------------------------------------------------------------------
# 3. Copy static assets
# ---------------------------------------------------------------------------
log "Step 3/5: Copying static assets for standalone server..."
STANDALONE_WEB="$WEB_DIR/.next/standalone/packages/web-dashboard"
if [[ -d "$STANDALONE_WEB" ]]; then
  cp -r "$WEB_DIR/.next/static" "$STANDALONE_WEB/.next/static"
  cp -r "$WEB_DIR/public" "$STANDALONE_WEB/public" 2>/dev/null || true
  log "Static assets copied."
else
  warn "Standalone directory not found — web dashboard may not work."
fi

# ---------------------------------------------------------------------------
# 4. Restart web dashboard
# ---------------------------------------------------------------------------
log "Step 4/5: Restarting web dashboard..."
systemctl restart clever-web 2>/dev/null && log "Web dashboard restarted." || warn "clever-web service not found."

# ---------------------------------------------------------------------------
# 5. Device sync
# ---------------------------------------------------------------------------
log "Step 5/5: Syncing devices from HA..."
if [[ -f "$REPO_DIR/.env" ]]; then
  set -a
  source "$REPO_DIR/.env"
  set +a
fi

if [[ -f "$REPO_DIR/packages/pi-agent/dist/deploy/device-sync.js" ]]; then
  cd "$REPO_DIR"
  node packages/pi-agent/dist/deploy/device-sync.js || warn "Device sync failed."
else
  warn "Device sync not built yet — run 'npm run build' first."
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
log ""
log "══════════════════════════════════════════"
log "  Deploy complete!"
log "══════════════════════════════════════════"
log "  Dashboard: http://${IP_ADDR}:3000"
log ""
