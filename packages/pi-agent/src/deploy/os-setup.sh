#!/usr/bin/env bash
# ===========================================================================
# os-setup.sh — Raspberry Pi OS image preparation
#
# Run once on a fresh Raspberry Pi OS Lite (64-bit Bookworm) install.
# Enables hardware interfaces, installs Docker + Node.js 20 LTS,
# and configures systemd services for the Clever Automations agent.
#
# Usage:  sudo bash os-setup.sh
# ===========================================================================

set -euo pipefail
IFS=$'\n\t'

# ---------------------------------------------------------------------------
# Colors for output
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[SETUP]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (use sudo)."
  exit 1
fi

if ! grep -q 'Raspberry Pi' /proc/cpuinfo 2>/dev/null; then
  warn "This does not appear to be a Raspberry Pi. Proceeding anyway..."
fi

ARCH=$(uname -m)
if [[ "$ARCH" != "aarch64" ]]; then
  err "Expected aarch64 architecture, got $ARCH. Use 64-bit Raspberry Pi OS."
  exit 1
fi

log "Starting Clever Automations OS setup on Raspberry Pi..."

# ---------------------------------------------------------------------------
# 1. System update
# ---------------------------------------------------------------------------
log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ---------------------------------------------------------------------------
# 2. Enable hardware interfaces via raspi-config non-interactive
# ---------------------------------------------------------------------------
log "Enabling I2C interface..."
raspi-config nonint do_i2c 0      # 0 = enable

log "Enabling SPI interface..."
raspi-config nonint do_spi 0

log "Enabling I2S audio interface..."
# I2S is enabled by adding the dtoverlay to config.txt
CONFIG_FILE="/boot/firmware/config.txt"
if [[ ! -f "$CONFIG_FILE" ]]; then
  CONFIG_FILE="/boot/config.txt"
fi

if ! grep -q 'dtoverlay=hifiberry-dac' "$CONFIG_FILE" 2>/dev/null; then
  log "Adding I2S DAC overlay to $CONFIG_FILE..."
  cat >> "$CONFIG_FILE" <<'DTOVERLAY'

# Clever Automations: I2S audio output (Adafruit I2S 3W Bonnet)
dtoverlay=hifiberry-dac
DTOVERLAY
fi

# Enable the Hailo AI HAT+ PCIe overlay if not present
if ! grep -q 'dtoverlay=hailo' "$CONFIG_FILE" 2>/dev/null; then
  log "Adding Hailo AI HAT+ PCIe overlay..."
  cat >> "$CONFIG_FILE" <<'HAILO'

# Clever Automations: Hailo AI HAT+ (PCIe Gen 3)
dtparam=pciex1_gen=3
HAILO
fi

# ---------------------------------------------------------------------------
# 3. Install essential packages
# ---------------------------------------------------------------------------
log "Installing essential packages..."
apt-get install -y -qq \
  git curl wget jq unzip \
  i2c-tools libi2c-dev \
  alsa-utils libasound2-dev \
  python3 python3-pip python3-venv \
  build-essential cmake pkg-config \
  libssl-dev libffi-dev \
  avahi-daemon avahi-utils \
  usbutils

# ---------------------------------------------------------------------------
# 4. Install Docker and docker-compose
# ---------------------------------------------------------------------------
if command -v docker &>/dev/null; then
  log "Docker already installed: $(docker --version)"
else
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | bash

  # Add the pi user to the docker group
  PI_USER="${SUDO_USER:-pi}"
  usermod -aG docker "$PI_USER"
  log "Added $PI_USER to docker group."
fi

# Install docker-compose plugin if not present
if ! docker compose version &>/dev/null 2>&1; then
  log "Installing Docker Compose plugin..."
  apt-get install -y -qq docker-compose-plugin
fi

# Enable and start Docker service
systemctl enable docker
systemctl start docker
log "Docker is running: $(docker --version)"

# ---------------------------------------------------------------------------
# 5. Install Node.js 20 LTS
# ---------------------------------------------------------------------------
NODE_MAJOR=20

if command -v node &>/dev/null; then
  CURRENT_NODE=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ "$CURRENT_NODE" -ge "$NODE_MAJOR" ]]; then
    log "Node.js already installed: $(node --version)"
  else
    warn "Node.js $(node --version) found but need v${NODE_MAJOR}+. Upgrading..."
    INSTALL_NODE=true
  fi
else
  INSTALL_NODE=true
fi

if [[ "${INSTALL_NODE:-false}" == "true" ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x LTS..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
  log "Node.js installed: $(node --version)"
fi

# Install pnpm (used by the monorepo)
if ! command -v pnpm &>/dev/null; then
  log "Installing pnpm..."
  npm install -g pnpm@latest
fi

# ---------------------------------------------------------------------------
# 6. Configure NVMe SSD mount point
# ---------------------------------------------------------------------------
NVME_MOUNT="/mnt/nvme"
if [[ -b /dev/nvme0n1p1 ]]; then
  if ! mountpoint -q "$NVME_MOUNT" 2>/dev/null; then
    log "Mounting NVMe SSD at $NVME_MOUNT..."
    mkdir -p "$NVME_MOUNT"

    # Auto-format if no filesystem detected
    FSTYPE=$(blkid -o value -s TYPE /dev/nvme0n1p1 2>/dev/null || true)
    if [[ -z "$FSTYPE" ]]; then
      log "Formatting /dev/nvme0n1p1 as ext4..."
      mkfs.ext4 -L clever-data /dev/nvme0n1p1
    fi

    mount /dev/nvme0n1p1 "$NVME_MOUNT"

    # Add to fstab for persistence
    if ! grep -q 'nvme0n1p1' /etc/fstab; then
      echo '/dev/nvme0n1p1  /mnt/nvme  ext4  defaults,noatime  0  2' >> /etc/fstab
    fi
    log "NVMe SSD mounted at $NVME_MOUNT."
  else
    log "NVMe SSD already mounted at $NVME_MOUNT."
  fi

  # Create data directories
  mkdir -p "$NVME_MOUNT/ha-data"
  mkdir -p "$NVME_MOUNT/models"
  mkdir -p "$NVME_MOUNT/clever-agent"
else
  warn "No NVMe SSD detected at /dev/nvme0n1p1. Using SD card storage."
  NVME_MOUNT="/opt/clever"
  mkdir -p "$NVME_MOUNT/ha-data"
  mkdir -p "$NVME_MOUNT/models"
  mkdir -p "$NVME_MOUNT/clever-agent"
fi

# ---------------------------------------------------------------------------
# 7. Create systemd service for the Clever Agent
# ---------------------------------------------------------------------------
log "Creating systemd service for clever-agent..."

PI_USER="${SUDO_USER:-pi}"

cat > /etc/systemd/system/clever-agent.service <<EOF
[Unit]
Description=Clever Automations Pi Agent
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=${PI_USER}
WorkingDirectory=${NVME_MOUNT}/clever-agent
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=CLEVER_DATA_DIR=${NVME_MOUNT}
EnvironmentFile=-/etc/clever-agent/env

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${NVME_MOUNT}
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=clever-agent

[Install]
WantedBy=multi-user.target
EOF

mkdir -p /etc/clever-agent

# Create a placeholder env file
if [[ ! -f /etc/clever-agent/env ]]; then
  cat > /etc/clever-agent/env <<'ENVFILE'
# Clever Automations Agent Environment
# Fill in these values after setup:
#
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_ANON_KEY=your-anon-key
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# HA_URL=http://homeassistant.local:8123
# HA_TOKEN=your-ha-long-lived-access-token
# TENANT_ID=your-tenant-uuid
# DEVICE_JWT=your-scoped-device-jwt
ENVFILE
  chmod 600 /etc/clever-agent/env
fi

systemctl daemon-reload
systemctl enable clever-agent.service
log "clever-agent.service enabled (will start after deployment)."

# ---------------------------------------------------------------------------
# 8. Configure mDNS hostname
# ---------------------------------------------------------------------------
HOSTNAME="cleverpi"
if [[ "$(hostname)" != "$HOSTNAME" ]]; then
  log "Setting hostname to $HOSTNAME..."
  hostnamectl set-hostname "$HOSTNAME"
  echo "127.0.1.1  $HOSTNAME" >> /etc/hosts
fi

# Ensure avahi-daemon is enabled for .local resolution
systemctl enable avahi-daemon
systemctl restart avahi-daemon

# ---------------------------------------------------------------------------
# 9. Final summary
# ---------------------------------------------------------------------------
log ""
log "============================================="
log "  Clever Automations OS Setup Complete"
log "============================================="
log ""
log "  Hostname:     $HOSTNAME.local"
log "  Node.js:      $(node --version)"
log "  Docker:       $(docker --version | cut -d, -f1)"
log "  Data dir:     $NVME_MOUNT"
log ""
log "  Next steps:"
log "    1. Run ha-install.sh to set up Home Assistant"
log "    2. Run voice-install.sh to set up voice pipeline"
log "    3. Configure /etc/clever-agent/env"
log "    4. Deploy the agent code to $NVME_MOUNT/clever-agent"
log "    5. sudo systemctl start clever-agent"
log ""
log "  A reboot is recommended to apply hardware overlay changes."
log ""

exit 0
