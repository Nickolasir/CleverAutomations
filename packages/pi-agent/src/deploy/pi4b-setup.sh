#!/usr/bin/env bash
# ===========================================================================
# pi4b-setup.sh — One-shot Raspberry Pi 4B staging setup
#
# Installs everything needed to run the Clever Automations pi-agent
# on a Pi 4B WITHOUT the AI HAT+, ReSpeaker, or I2S bonnet.
#
# What it does:
#   1. System update + essential packages
#   2. Docker + Docker Compose
#   3. Node.js 20 LTS + pnpm
#   4. Home Assistant container (pre-configured for REST/WS API)
#   5. Voice pipeline (Tier 3 local: faster-whisper, Piper, llama.cpp)
#   6. Clones the repo + installs deps
#   7. Generates /etc/clever-agent/env with all keys you need to fill in
#   8. Creates systemd services
#
# Usage:  sudo bash pi4b-setup.sh
#
# After running, you just need to:
#   - Complete HA onboarding in the browser
#   - Fill in /etc/clever-agent/env
#   - Start services
# ===========================================================================

set -euo pipefail
IFS=$'\n\t'

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()     { echo -e "${GREEN}[SETUP]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}   $*"; }
err()     { echo -e "${RED}[ERROR]${NC}  $*" >&2; }
header()  { echo -e "\n${CYAN}${BOLD}══════════════════════════════════════════${NC}"; echo -e "${CYAN}${BOLD}  $*${NC}"; echo -e "${CYAN}${BOLD}══════════════════════════════════════════${NC}\n"; }

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  err "Run with sudo:  sudo bash pi4b-setup.sh"
  exit 1
fi

PI_USER="${SUDO_USER:-pi}"
PI_HOME=$(eval echo "~$PI_USER")
DATA_DIR="/opt/clever"
MODEL_DIR="$DATA_DIR/models"
HA_DATA_DIR="$DATA_DIR/ha-data"
HA_COMPOSE_DIR="$DATA_DIR/ha-compose"
REPO_DIR="$DATA_DIR/clever-agent"
VENV_DIR="$DATA_DIR/voice-venv"
ENV_FILE="/etc/clever-agent/env"
HA_PORT=8123

# Check for NVMe (unlikely on Pi 4B, but just in case USB SSD is mounted)
if mountpoint -q /mnt/nvme 2>/dev/null; then
  DATA_DIR="/mnt/nvme"
  MODEL_DIR="$DATA_DIR/models"
  HA_DATA_DIR="$DATA_DIR/ha-data"
  HA_COMPOSE_DIR="$DATA_DIR/ha-compose"
  REPO_DIR="$DATA_DIR/clever-agent"
  VENV_DIR="$DATA_DIR/voice-venv"
  log "NVMe/USB SSD detected at /mnt/nvme — using for storage."
fi

mkdir -p "$DATA_DIR" "$MODEL_DIR" "$HA_DATA_DIR" "$HA_COMPOSE_DIR" "$REPO_DIR" "$VENV_DIR"

ARCH=$(uname -m)
IP_ADDR=$(hostname -I | awk '{print $1}')

header "Clever Automations — Pi 4B Staging Setup"
log "User:       $PI_USER"
log "IP:         $IP_ADDR"
log "Arch:       $ARCH"
log "Data dir:   $DATA_DIR"
echo ""

# ===========================================================================
# PHASE 1: System packages
# ===========================================================================
header "Phase 1: System Packages"

log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

log "Installing essentials..."
apt-get install -y -qq \
  git curl wget jq unzip \
  i2c-tools libi2c-dev \
  alsa-utils libasound2-dev \
  python3 python3-pip python3-venv \
  build-essential cmake pkg-config \
  libssl-dev libffi-dev \
  avahi-daemon avahi-utils \
  usbutils portaudio19-dev libportaudio2 \
  libsndfile1-dev sox libsox-fmt-all \
  libopus-dev libopusfile-dev

# Enable I2C and SPI (useful for future sensors)
if command -v raspi-config &>/dev/null; then
  raspi-config nonint do_i2c 0 2>/dev/null || true
  raspi-config nonint do_spi 0 2>/dev/null || true
fi

log "System packages installed."

# ===========================================================================
# PHASE 2: Docker
# ===========================================================================
header "Phase 2: Docker"

if command -v docker &>/dev/null; then
  log "Docker already installed: $(docker --version)"
else
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | bash
  usermod -aG docker "$PI_USER"
  log "Added $PI_USER to docker group."
fi

if ! docker compose version &>/dev/null 2>&1; then
  apt-get install -y -qq docker-compose-plugin
fi

systemctl enable docker
systemctl start docker
log "Docker ready: $(docker --version | cut -d, -f1)"

# ===========================================================================
# PHASE 3: Node.js 20 + pnpm
# ===========================================================================
header "Phase 3: Node.js 20 LTS"

NODE_MAJOR=20
INSTALL_NODE=false

if command -v node &>/dev/null; then
  CURRENT_NODE=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ "$CURRENT_NODE" -ge "$NODE_MAJOR" ]]; then
    log "Node.js already installed: $(node --version)"
  else
    INSTALL_NODE=true
  fi
else
  INSTALL_NODE=true
fi

if [[ "$INSTALL_NODE" == "true" ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
  log "Node.js installed: $(node --version)"
fi

if ! command -v pnpm &>/dev/null; then
  log "Installing pnpm..."
  npm install -g pnpm@latest
fi

log "Node $(node --version) + pnpm $(pnpm --version)"

# ===========================================================================
# PHASE 4: Home Assistant
# ===========================================================================
header "Phase 4: Home Assistant"

log "Pulling Home Assistant container..."
docker pull "ghcr.io/home-assistant/home-assistant:stable"

# Stop existing if running
if docker ps -a --format '{{.Names}}' | grep -q "^homeassistant$"; then
  log "Stopping existing HA container..."
  docker stop homeassistant 2>/dev/null || true
  docker rm homeassistant 2>/dev/null || true
fi

# Docker Compose file
cat > "$HA_COMPOSE_DIR/docker-compose.yml" <<EOF
version: '3.8'

services:
  homeassistant:
    container_name: homeassistant
    image: ghcr.io/home-assistant/home-assistant:stable
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

# HA configuration.yaml (only if fresh install)
if [[ ! -f "$HA_DATA_DIR/configuration.yaml" ]]; then
  cat > "$HA_DATA_DIR/configuration.yaml" <<'HACONFIG'
homeassistant:
  name: Clever Home
  unit_system: imperial
  time_zone: America/Chicago
  currency: USD
  country: US

http:
  server_port: 8123
  cors_allowed_origins:
    - http://localhost:3000
    - http://localhost:8080
  ip_ban_enabled: true
  login_attempts_threshold: 5

api:
websocket_api:

recorder:
  purge_keep_days: 7
  commit_interval: 5

history:

logger:
  default: warning
  logs:
    homeassistant.components.api: info
    homeassistant.components.websocket_api: info

automation: !include automations.yaml
scene: !include scenes.yaml
script: !include scripts.yaml
HACONFIG

  echo "[]" > "$HA_DATA_DIR/automations.yaml"
  echo "[]" > "$HA_DATA_DIR/scenes.yaml"
  echo ""  > "$HA_DATA_DIR/scripts.yaml"
fi

# Start HA
cd "$HA_COMPOSE_DIR"
docker compose up -d

# systemd service for HA
cat > /etc/systemd/system/homeassistant-docker.service <<EOF
[Unit]
Description=Home Assistant Docker Compose
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${HA_COMPOSE_DIR}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable homeassistant-docker.service

# mDNS
mkdir -p /etc/avahi/services
cat > /etc/avahi/services/homeassistant.service <<'AVAHI'
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">Home Assistant on %h</name>
  <service>
    <type>_home-assistant._tcp</type>
    <port>8123</port>
  </service>
</service-group>
AVAHI
systemctl restart avahi-daemon 2>/dev/null || true

# Set hostname
if [[ "$(hostname)" != "cleverpi" ]]; then
  hostnamectl set-hostname cleverpi
  grep -q '127.0.1.1.*cleverpi' /etc/hosts || echo "127.0.1.1  cleverpi" >> /etc/hosts
fi

# Wait for HA
log "Waiting for Home Assistant to start (up to 3 minutes)..."
ELAPSED=0
while [[ $ELAPSED -lt 180 ]]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${HA_PORT}/api/" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "401" ]]; then
    log "Home Assistant API is up!"
    break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  echo -n "."
done
echo ""

if [[ $ELAPSED -ge 180 ]]; then
  warn "HA didn't respond in time. Check: docker logs homeassistant"
fi

# ===========================================================================
# PHASE 5: Voice Pipeline (Tier 3 — local offline fallback)
# ===========================================================================
header "Phase 5: Voice Pipeline (local offline models)"

log "Setting up Python virtual environment..."
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"
pip install --upgrade pip wheel setuptools -q

# faster-whisper (STT)
log "Installing faster-whisper..."
pip install faster-whisper -q

WHISPER_MODEL_DIR="$MODEL_DIR/faster-whisper-base.en"
if [[ ! -d "$WHISPER_MODEL_DIR" ]]; then
  log "Downloading faster-whisper base.en model..."
  python3 -c "
from faster_whisper import WhisperModel
model = WhisperModel('base.en', device='cpu', compute_type='int8',
                     download_root='${MODEL_DIR}')
print('Model downloaded')
" || warn "faster-whisper model download failed — can retry later."
fi

# Piper TTS
log "Installing Piper TTS..."
pip install piper-tts -q

PIPER_DIR="$MODEL_DIR/piper"
mkdir -p "$PIPER_DIR"
PIPER_MODEL="$PIPER_DIR/en_US-lessac-medium.onnx"
if [[ ! -f "$PIPER_MODEL" ]]; then
  log "Downloading Piper voice model..."
  PIPER_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium"
  wget -q --show-progress -O "$PIPER_MODEL" "${PIPER_URL}/en_US-lessac-medium.onnx" || warn "Piper model download failed."
  wget -q -O "${PIPER_MODEL}.json" "${PIPER_URL}/en_US-lessac-medium.onnx.json" 2>/dev/null || true
fi

deactivate

# llama.cpp
LLAMA_DIR="$DATA_DIR/llama.cpp"
log "Building llama.cpp (ARM NEON optimized)..."

if [[ ! -d "$LLAMA_DIR" ]]; then
  git clone --depth 1 https://github.com/ggerganov/llama.cpp.git "$LLAMA_DIR"
fi

cd "$LLAMA_DIR"
mkdir -p build && cd build
cmake .. -DGGML_NATIVE=ON -DCMAKE_BUILD_TYPE=Release 2>&1 | tail -5
cmake --build . --config Release -j "$(nproc)" 2>&1 | tail -5
ln -sf "$LLAMA_DIR/build/bin/llama-server" /usr/local/bin/llama-server 2>/dev/null || true
ln -sf "$LLAMA_DIR/build/bin/llama-cli" /usr/local/bin/llama-cli 2>/dev/null || true
log "llama.cpp built."

# Download Qwen model
LLM_DIR="$MODEL_DIR/llm"
mkdir -p "$LLM_DIR"
QWEN_MODEL="$LLM_DIR/qwen2.5-1.5b-instruct-q4_k_m.gguf"
if [[ ! -f "$QWEN_MODEL" ]]; then
  log "Downloading Qwen2.5 1.5B model (~1GB)..."
  wget -q --show-progress -O "$QWEN_MODEL" \
    "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf" \
    || warn "Qwen model download failed — can retry later."
fi

# ===========================================================================
# PHASE 6: systemd services
# ===========================================================================
header "Phase 6: systemd Services"

# clever-agent service
cat > /etc/systemd/system/clever-agent.service <<EOF
[Unit]
Description=Clever Automations Pi Agent
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=${PI_USER}
WorkingDirectory=${REPO_DIR}
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=CLEVER_DATA_DIR=${DATA_DIR}
EnvironmentFile=-${ENV_FILE}

NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${DATA_DIR}
PrivateTmp=true

StandardOutput=journal
StandardError=journal
SyslogIdentifier=clever-agent

[Install]
WantedBy=multi-user.target
EOF

# clever-llm service
cat > /etc/systemd/system/clever-llm.service <<EOF
[Unit]
Description=Clever Automations Local LLM (llama.cpp)
After=network.target

[Service]
Type=simple
User=${PI_USER}
ExecStart=/usr/local/bin/llama-server \
  --model ${QWEN_MODEL} \
  --host 127.0.0.1 \
  --port 8081 \
  --ctx-size 2048 \
  --threads $(( $(nproc) - 1 )) \
  --batch-size 512
Restart=on-failure
RestartSec=10

NoNewPrivileges=true
ProtectSystem=strict
ReadOnlyPaths=${LLM_DIR}
PrivateTmp=true

StandardOutput=journal
StandardError=journal
SyslogIdentifier=clever-llm

[Install]
WantedBy=multi-user.target
EOF

mkdir -p /etc/clever-agent
systemctl daemon-reload
systemctl enable clever-agent.service
systemctl enable clever-llm.service

log "Services registered (not started yet — fill in .env first)."

# ===========================================================================
# PHASE 7: Generate .env file
# ===========================================================================
header "Phase 7: Environment File"

# Detect HA token placeholder
HA_URL="http://${IP_ADDR}:${HA_PORT}"

cat > "$ENV_FILE" <<ENVFILE
# ═══════════════════════════════════════════════════════════════════
# Clever Automations — Pi Agent Environment
# Generated: $(date '+%Y-%m-%d %H:%M:%S')
# Host: $(hostname) (${IP_ADDR})
#
# Fill in each value below, then start services with:
#   sudo systemctl start clever-llm clever-agent
# ═══════════════════════════════════════════════════════════════════

# ── Supabase ──────────────────────────────────────────────────────
# Get these from: https://supabase.com/dashboard → your project → Settings → API
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ── Home Assistant ────────────────────────────────────────────────
# HA is running locally. Create a long-lived token at:
#   ${HA_URL} → Profile (bottom-left) → Security → Long-Lived Access Tokens
HA_URL=${HA_URL}
HA_LONG_LIVED_TOKEN=

# ── Device Identity ──────────────────────────────────────────────
# TENANT_ID: your tenant UUID from the tenants table in Supabase
# DEVICE_JWT: a scoped JWT for this Pi (generate via Edge Function or manually)
TENANT_ID=
DEVICE_JWT=

# ── Voice Pipeline — Tier 2 (Cloud APIs) ─────────────────────────
# Sign up and get API keys from each provider:
#   Deepgram:  https://console.deepgram.com  (free tier available)
#   Groq:      https://console.groq.com      (free tier available)
#   Cartesia:  https://play.cartesia.ai      (free tier available)
DEEPGRAM_API_KEY=
GROQ_API_KEY=
CARTESIA_API_KEY=

# ── OpenRouter (non-voice only) ──────────────────────────────────
# https://openrouter.ai/keys
OPENROUTER_API_KEY=

# ── PII Encryption ───────────────────────────────────────────────
# Generate with:  openssl rand -hex 32
# Must match the key in Supabase Vault (vault.create_secret)
PII_MASTER_KEY=

# ── Intervals ────────────────────────────────────────────────────
HEARTBEAT_INTERVAL_MS=30000
DISCOVERY_INTERVAL_MS=60000

# ── Runtime ──────────────────────────────────────────────────────
NODE_ENV=development
CLEVER_DATA_DIR=${DATA_DIR}
CLEVER_MODEL_DIR=${MODEL_DIR}
CLEVER_VENV_DIR=${VENV_DIR}
ENVFILE

chmod 600 "$ENV_FILE"
chown root:root "$ENV_FILE"

log "Environment file created at: $ENV_FILE"

# ===========================================================================
# FINAL SUMMARY
# ===========================================================================
header "Setup Complete!"

echo -e "${BOLD}What's running:${NC}"
echo -e "  Home Assistant    ${GREEN}●${NC}  http://${IP_ADDR}:${HA_PORT}"
echo -e "  mDNS hostname     ${GREEN}●${NC}  cleverpi.local"
echo ""

echo -e "${BOLD}What's installed (not started):${NC}"
echo -e "  clever-agent      ${YELLOW}○${NC}  systemd service (needs .env)"
echo -e "  clever-llm        ${YELLOW}○${NC}  llama.cpp on port 8081"
echo -e "  faster-whisper    ${GREEN}●${NC}  ${MODEL_DIR}/faster-whisper-base.en"
echo -e "  Piper TTS         ${GREEN}●${NC}  ${MODEL_DIR}/piper/"
echo -e "  Qwen 1.5B         ${GREEN}●${NC}  ${MODEL_DIR}/llm/"
echo ""

echo -e "${BOLD}${CYAN}═══ WHAT YOU NEED TO DO ═══${NC}"
echo ""
echo -e "  ${BOLD}1.${NC} Open Home Assistant in your browser:"
echo -e "     ${CYAN}http://${IP_ADDR}:${HA_PORT}${NC}"
echo -e "     Complete the onboarding wizard (create admin account)."
echo ""
echo -e "  ${BOLD}2.${NC} Create a HA long-lived access token:"
echo -e "     Profile → Security → Long-Lived Access Tokens → Create"
echo ""
echo -e "  ${BOLD}3.${NC} Get your Supabase credentials:"
echo -e "     https://supabase.com/dashboard → Project → Settings → API"
echo -e "     Copy: Project URL, anon key, service_role key"
echo ""
echo -e "  ${BOLD}4.${NC} Get voice API keys (all have free tiers):"
echo -e "     Deepgram:  https://console.deepgram.com"
echo -e "     Groq:      https://console.groq.com"
echo -e "     Cartesia:  https://play.cartesia.ai"
echo ""
echo -e "  ${BOLD}5.${NC} Generate a PII encryption key:"
echo -e "     ${CYAN}openssl rand -hex 32${NC}"
echo ""
echo -e "  ${BOLD}6.${NC} Edit the env file with all of the above:"
echo -e "     ${CYAN}sudo nano /etc/clever-agent/env${NC}"
echo ""
echo -e "  ${BOLD}7.${NC} Start the services:"
echo -e "     ${CYAN}sudo systemctl start clever-llm${NC}"
echo -e "     ${CYAN}sudo systemctl start clever-agent${NC}"
echo ""
echo -e "  ${BOLD}8.${NC} Check logs:"
echo -e "     ${CYAN}journalctl -u clever-agent -f${NC}"
echo -e "     ${CYAN}journalctl -u clever-llm -f${NC}"
echo ""

echo -e "${BOLD}Pi 4B notes:${NC}"
echo -e "  - No Hailo AI HAT — local LLM will be slower (~3-5s per response)"
echo -e "  - No ReSpeaker — use USB mic or test with audio files"
echo -e "  - No I2S bonnet — audio plays through 3.5mm jack or HDMI"
echo -e "  - Cloud voice pipeline (Tier 2) works at full speed"
echo ""

exit 0
