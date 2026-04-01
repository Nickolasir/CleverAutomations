#!/usr/bin/env bash
# ===========================================================================
# voice-install.sh — Install voice pipeline dependencies on Raspberry Pi 5
#
# Installs:
#   - PortAudio (audio I/O library)
#   - faster-whisper (local STT for Tier 3 fallback)
#   - Piper TTS (local TTS for Tier 3 fallback)
#   - llama.cpp (local LLM for Tier 3 fallback)
#   - Downloads models to NVMe SSD
#   - Configures ALSA for ReSpeaker 4-Mic Array + I2S Bonnet
#   - Creates systemd service for the voice pipeline
#
# Prerequisites: os-setup.sh must have been run first.
# Usage:  sudo bash voice-install.sh
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

log()  { echo -e "${GREEN}[VOICE]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (use sudo)."
  exit 1
fi

# Determine model storage directory
if mountpoint -q /mnt/nvme 2>/dev/null; then
  MODEL_DIR="/mnt/nvme/models"
else
  MODEL_DIR="/opt/clever/models"
fi
mkdir -p "$MODEL_DIR"

PI_USER="${SUDO_USER:-pi}"

log "Voice pipeline installation starting..."
log "Model storage: $MODEL_DIR"

# ---------------------------------------------------------------------------
# 1. Install audio libraries
# ---------------------------------------------------------------------------
log "Installing audio libraries (PortAudio, ALSA, PulseAudio)..."
apt-get install -y -qq \
  portaudio19-dev \
  libportaudio2 \
  libasound2-dev \
  libsndfile1-dev \
  alsa-utils \
  pulseaudio \
  pulseaudio-utils \
  libopus-dev \
  libopusfile-dev \
  sox \
  libsox-fmt-all

# ---------------------------------------------------------------------------
# 2. Configure ALSA for ReSpeaker 4-Mic Array
# ---------------------------------------------------------------------------
log "Configuring ALSA devices..."

ALSA_CONF="/etc/asound.conf"
cat > "$ALSA_CONF" <<'ALSACONFIG'
# Clever Automations ALSA Configuration
# Input:  ReSpeaker 4-Mic Array (USB)
# Output: Adafruit I2S 3W Stereo Bonnet

# --- Find the ReSpeaker by card name ---
# The card number may change across reboots; use 'arecord -l' to verify.

# Default PCM device: route to I2S bonnet for output
pcm.!default {
    type asym
    capture.pcm "mic_array"
    playback.pcm "i2s_output"
}

ctl.!default {
    type hw
    card 0
}

# ReSpeaker 4-Mic Array — capture at 16kHz mono (channel 0)
pcm.mic_array {
    type plug
    slave {
        pcm "hw:seeed4micvoicec,0"
        rate 16000
        channels 1
        format S16_LE
    }
}

# I2S 3W Bonnet — playback
pcm.i2s_output {
    type plug
    slave {
        pcm "hw:sndrpihifiberry,0"
        rate 16000
        format S16_LE
        channels 2
    }
}

# Software volume control for I2S output
pcm.speaker {
    type softvol
    slave.pcm "i2s_output"
    control {
        name "Clever Volume"
        card sndrpihifiberry
    }
    min_dB -51.0
    max_dB 0.0
    resolution 256
}
ALSACONFIG

log "ALSA configuration written to $ALSA_CONF"

# ---------------------------------------------------------------------------
# 3. Install Python virtual environment for voice tools
# ---------------------------------------------------------------------------
VENV_DIR="/opt/clever/voice-venv"
log "Creating Python virtual environment at $VENV_DIR..."
python3 -m venv "$VENV_DIR"

# Activate the venv for subsequent pip installs
source "$VENV_DIR/bin/activate"

pip install --upgrade pip wheel setuptools

# ---------------------------------------------------------------------------
# 4. Install faster-whisper (Tier 3 STT)
# ---------------------------------------------------------------------------
log "Installing faster-whisper..."
pip install faster-whisper

# Download the base.en model
WHISPER_MODEL_DIR="$MODEL_DIR/faster-whisper-base.en"
if [[ ! -d "$WHISPER_MODEL_DIR" ]]; then
  log "Downloading faster-whisper base.en model..."
  python3 -c "
from faster_whisper import WhisperModel
model = WhisperModel('base.en', device='cpu', compute_type='int8',
                     download_root='${MODEL_DIR}')
print('Model downloaded successfully')
"
  log "faster-whisper base.en model ready."
else
  log "faster-whisper base.en model already exists."
fi

# ---------------------------------------------------------------------------
# 5. Install Piper TTS (Tier 3 TTS)
# ---------------------------------------------------------------------------
log "Installing Piper TTS..."
pip install piper-tts

# Download the en_US-lessac-medium voice model
PIPER_MODEL_DIR="$MODEL_DIR/piper"
mkdir -p "$PIPER_MODEL_DIR"

PIPER_MODEL_FILE="$PIPER_MODEL_DIR/en_US-lessac-medium.onnx"
PIPER_MODEL_JSON="$PIPER_MODEL_DIR/en_US-lessac-medium.onnx.json"

if [[ ! -f "$PIPER_MODEL_FILE" ]]; then
  log "Downloading Piper en_US-lessac-medium voice model..."
  PIPER_RELEASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium"
  wget -q -O "$PIPER_MODEL_FILE" \
    "${PIPER_RELEASE_URL}/en_US-lessac-medium.onnx"
  wget -q -O "$PIPER_MODEL_JSON" \
    "${PIPER_RELEASE_URL}/en_US-lessac-medium.onnx.json"
  log "Piper voice model downloaded."
else
  log "Piper voice model already exists."
fi

# ---------------------------------------------------------------------------
# 6. Build llama.cpp (Tier 3 LLM)
# ---------------------------------------------------------------------------
LLAMA_DIR="/opt/clever/llama.cpp"
log "Building llama.cpp from source..."

if [[ ! -d "$LLAMA_DIR" ]]; then
  git clone --depth 1 https://github.com/ggerganov/llama.cpp.git "$LLAMA_DIR"
fi

cd "$LLAMA_DIR"
git pull --ff-only 2>/dev/null || true

# Build with ARM NEON optimizations
# If Hailo HAT+ is detected, we enable GGML_HAILO (future support)
CMAKE_ARGS="-DGGML_NATIVE=ON"

# Check for Hailo device
if lspci 2>/dev/null | grep -qi 'hailo'; then
  log "Hailo AI HAT+ detected — building with Hailo awareness."
  # Note: Hailo integration with llama.cpp is experimental
  # For now we build with CPU optimizations only
fi

mkdir -p build && cd build
cmake .. $CMAKE_ARGS -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Release -j "$(nproc)"

# Symlink the server binary
ln -sf "$LLAMA_DIR/build/bin/llama-server" /usr/local/bin/llama-server
ln -sf "$LLAMA_DIR/build/bin/llama-cli" /usr/local/bin/llama-cli

log "llama.cpp built successfully."

# ---------------------------------------------------------------------------
# 7. Download LLM model (Qwen2.5 1.5B Q4_K_M)
# ---------------------------------------------------------------------------
LLM_MODEL_DIR="$MODEL_DIR/llm"
mkdir -p "$LLM_MODEL_DIR"

QWEN_MODEL="$LLM_MODEL_DIR/qwen2.5-1.5b-instruct-q4_k_m.gguf"
if [[ ! -f "$QWEN_MODEL" ]]; then
  log "Downloading Qwen2.5 1.5B Q4_K_M model..."
  wget -q --show-progress -O "$QWEN_MODEL" \
    "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
  log "Qwen2.5 model downloaded."
else
  log "Qwen2.5 model already exists."
fi

# Deactivate venv
deactivate

# ---------------------------------------------------------------------------
# 8. Create systemd service for the voice pipeline
# ---------------------------------------------------------------------------
log "Creating systemd service for clever-voice..."

cat > /etc/systemd/system/clever-voice.service <<EOF
[Unit]
Description=Clever Automations Voice Pipeline
After=network-online.target clever-agent.service
Wants=network-online.target
BindsTo=clever-agent.service

[Service]
Type=simple
User=${PI_USER}
WorkingDirectory=/opt/clever
ExecStart=/usr/bin/node /opt/clever/clever-agent/dist/index.js --voice
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=CLEVER_MODEL_DIR=${MODEL_DIR}
Environment=CLEVER_VENV_DIR=${VENV_DIR}
EnvironmentFile=-/etc/clever-agent/env

# Audio device access
SupplementaryGroups=audio

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${MODEL_DIR} /tmp
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=clever-voice

[Install]
WantedBy=multi-user.target
EOF

# Create systemd service for llama.cpp server (local LLM)
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
Environment=GGML_CUDA_NO_PINNED=1

# Security
NoNewPrivileges=true
ProtectSystem=strict
ReadOnlyPaths=${LLM_MODEL_DIR}
PrivateTmp=true

StandardOutput=journal
StandardError=journal
SyslogIdentifier=clever-llm

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable clever-voice.service
systemctl enable clever-llm.service

log "Voice services enabled."

# ---------------------------------------------------------------------------
# 9. Audio device verification
# ---------------------------------------------------------------------------
log "Verifying audio devices..."

echo ""
log "=== ALSA Capture Devices ==="
arecord -l 2>/dev/null || warn "No capture devices found."

echo ""
log "=== ALSA Playback Devices ==="
aplay -l 2>/dev/null || warn "No playback devices found."

# ---------------------------------------------------------------------------
# 10. Summary
# ---------------------------------------------------------------------------
log ""
log "============================================="
log "  Voice Pipeline Installation Complete"
log "============================================="
log ""
log "  Models directory:  $MODEL_DIR"
log "  Python venv:       $VENV_DIR"
log "  llama.cpp:         $LLAMA_DIR"
log ""
log "  Installed components:"
log "    - faster-whisper base.en (Tier 3 STT)"
log "    - Piper TTS en_US-lessac-medium (Tier 3 TTS)"
log "    - llama.cpp + Qwen2.5 1.5B Q4_K_M (Tier 3 LLM)"
log ""
log "  ALSA config:       $ALSA_CONF"
log "    - Input:  ReSpeaker 4-Mic Array (16kHz/16-bit/mono)"
log "    - Output: I2S 3W Bonnet (16kHz/16-bit/stereo)"
log ""
log "  Services:"
log "    - clever-voice.service (voice pipeline)"
log "    - clever-llm.service   (local LLM server on port 8081)"
log ""
log "  Next steps:"
log "    1. Verify audio with: speaker-test -t wav -c 2"
log "    2. Test mic with: arecord -D mic_array -f S16_LE -r 16000 -c 1 test.wav"
log "    3. Start services: sudo systemctl start clever-llm clever-voice"
log ""

exit 0
