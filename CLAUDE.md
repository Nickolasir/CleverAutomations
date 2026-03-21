Clever Automations - AI-Powered Smart Home Butler
Mission
Build an AI-powered electronic butler platform combining OpenClaw (MIT License) and Home Assistant (Apache 2.0) on Raspberry Pi 5 hardware. Three market verticals: homebuilders, Airbnb hosts, apartment complexes. Security is the #1 design priority.
Architecture
Hardware

Central Hub (Raspberry Pi 5):
Raspberry Pi 5 (8GB) with ReSpeaker 4-Mic Array for far-field voice
Hailo AI HAT+ 2 (40 TOPS, 8GB dedicated RAM) for local LLM offloading
NVMe SSD via M.2 HAT+ for model storage and Home Assistant data
Adafruit I2S 3W Bonnet + powered speakers for audio output
Active cooling heatsink + fan

ESP32-S3 Room Satellite Nodes (~$8 each):
One per room for distributed sensing and voice capture. Connects to Pi hub over WiFi.
Dual Xtensa LX7 cores, 8MB PSRAM, Wi-Fi 4 + Bluetooth 5.0
INMP441 MEMS microphone for room-level voice capture
microWakeWord wake word detection runs locally on-device (<10ms inference per 20ms audio stride, Apache 2.0)
ESP-SR MultiNet for on-device speech command recognition (up to 200 offline commands, free with Espressif silicon)
ESP-SR AFE (Audio Front End) for noise suppression, AEC, beamforming, and VADNet voice activity detection
Audio streams to Pi hub ONLY after wake word triggers (saves bandwidth + Pi CPU)
BLE scanning for room-level presence detection (phones, watches, beacons)
GPIO sensors: temperature, humidity, air quality, motion, leak, door/window reed switches
Optional: small TFT/e-ink display for room status
Firmware: ESPHome for zero-code HA integration, or custom Arduino/ESP-IDF
Communicates via: MQTT to HA broker on Pi, or ESPHome native API
Does NOT run: LLM inference, STT/TTS, Home Assistant, Node.js, or Supabase client
Power: USB-C (5V) or battery with deep sleep for sensor-only nodes

Voice Pipeline (LATENCY-CRITICAL - sub-1-second target)
This is the most important architectural component. Every design decision prioritizes latency.
Three-tier hybrid system:
Tier 1: Instant Rules Engine (50-200ms) - handles ~70% of commands

ESP-SR MultiNet on-device speech command recognition on ESP32-S3 satellites (up to 200 commands, no cloud needed, free with Espressif silicon). Handles lights, locks, thermostat, scenes directly on the satellite with zero Pi involvement for the most common commands.
Regex pattern matching on partial STT for commands that reach the Pi hub
Direct Home Assistant API calls for device control
Examples: "turn off lights", "set temp to 72", "lock front door"

Tier 2: Cloud Streaming Pipeline (580-900ms) - handles ~20% of commands

Wake word: microWakeWord on ESP32-S3 satellites (ESPHome native, <10ms, Apache 2.0) or openWakeWord on Pi hub (Python, Apache 2.0)
STT: Deepgram Nova-3 DIRECT API (streaming WebSocket, ~150ms first tokens)
LLM: Groq DIRECT API (LPU hardware, ~200ms TTFT, 500+ tok/s)
TTS: Cartesia Sonic 3 DIRECT API (streaming, ~100ms first audio)
All stages stream and overlap. TTS starts before LLM finishes.

Tier 3: Local Fallback (3-5s) - handles ~10% / offline

STT: Faster-Whisper base.en (local)
LLM: Qwen2.5 1.5B or Phi-2 at Q4_K_M via llama.cpp (4-8 tok/s)
TTS: Piper TTS medium quality (local)

CRITICAL RULES:

Voice hot path (Tier 2) uses DIRECT APIs to Deepgram, Groq, Cartesia. NEVER route voice through OpenRouter. OpenRouter adds 25x latency overhead in benchmarks.
OpenRouter is ONLY for: background queries, analytics, model A/B testing, and LLM fallback if Groq is down.
Home Assistant's built-in Assist voice pipeline is NOT USED. It has 15-30s latency due to orchestration overhead. We use HA only as the device control layer via REST/WebSocket API.
NO PICOVOICE. Picovoice (Porcupine/Rhino) is proprietary with commercial licensing starting at $899/mo. Use microWakeWord (Apache 2.0, ESPHome native) for wake word and ESP-SR MultiNet (free with Espressif silicon) for on-device command recognition instead. openWakeWord (Apache 2.0) for Pi hub wake word.

Cloud Backend

Supabase: Auth (JWT + RLS), PostgreSQL, Realtime WebSocket, Edge Functions, Storage
OpenRouter: Non-voice AI only (background, analytics, model experimentation, fallback)
Multi-tenant: tenant_id in JWT claims, RLS policies enforced on every single table
TimescaleDB extension for sensor telemetry time-series data

Frontend

Web: React / Next.js admin dashboard
Mobile: React Native (iOS + Android)
Both connect via Supabase client SDK (auth, realtime subscriptions)

Market Verticals

CleverHome: Pre-installed hub in new construction for Harris County builders
CleverHost: Guest lifecycle automation for Airbnb/STR hosts (profile wipe between stays)
CleverBuilding: Multi-tenant smart building for apartment complexes

Security Requirements (Premium Priority)
These are non-negotiable. Every PR must satisfy these:

All database tables have tenant_id column with RLS policies. No exceptions.
Every API endpoint requires JWT authentication. No public endpoints except health check.
Device auth via scoped JWT tokens (one token per physical device, revocable).
Voice transcripts encrypted at rest in Supabase Storage.
No raw audio ever stored to cloud. Only transcripts.
API keys stored in environment variables or Supabase secrets vault. Never in code, never in database.
Guest profile wipe between Airbnb stays must be complete: locks, WiFi, voice history, TV logins, preferences, all personal data.
Rate limiting on all device command endpoints (prevent brute-force/abuse).
Full audit logging: every device state change logged with timestamp, user, tenant, device.
Intent confidence threshold: voice commands below 0.7 confidence require confirmation.

Code Standards

TypeScript strict mode for ALL new code
ESLint + Prettier enforced (config in repo root)
No any types. Shared interfaces in packages/shared/types/
All Supabase operations through client SDK (never raw SQL in application code)
Environment variables via .env files (never committed, .env.example committed)
Every voice pipeline component must have latency benchmark tests
Every RLS policy must have a cross-tenant access test proving isolation

Monorepo Structure
packages/
  voice-pipeline/     # Streaming voice: wake word, STT, LLM, TTS, tier routing
  ha-bridge/          # Home Assistant REST/WebSocket client, device registration
  supabase-backend/   # Schema, migrations, RLS policies, Edge Functions
  web-dashboard/      # Next.js admin dashboard
  mobile-app/         # React Native iOS/Android app
  pi-agent/           # Raspberry Pi device agent, hardware config, deployment
  kitchen-hub/        # Kitchen Sub-Hub: ePantry, shopping list, receipt/barcode scanning, timers
  esp32-satellite/    # ESP32-S3 room node firmware (ESPHome configs + custom components)
  shared/             # Shared TypeScript types, utils, constants
hardware/             # BOM, enclosure CAD, wiring diagrams
docs/                 # Architecture docs, API specs, market research
File Ownership (CRITICAL for Agent Teams)
Each agent owns specific directories. Do NOT edit files outside your ownership without messaging the owning agent first.
AgentOwnsCan Readbackend-architectsupabase-backend/, shared/types/Allvoice-engineervoice-pipeline/shared/, ha-bridge/ (interfaces only)ha-integratorha-bridge/, pi-agent/, esp32-satellite/, kitchen-hub/shared/, voice-pipeline/ (interfaces only)frontend-devweb-dashboard/, mobile-app/shared/, supabase-backend/ (types only)security-auditor(read-only auditor)ALL packagesmarket-researcherdocs/market/docs/
Voice Pipeline with ESP32-S3 Satellites
The wake word detection is distributed: each ESP32-S3 satellite runs microWakeWord locally (<10ms inference, Apache 2.0, ESPHome native).
When wake word is detected, the satellite streams raw audio over WiFi to the Pi hub.
The Pi hub handles Tier 2/3 voice processing. The ESP32-S3 can handle common commands locally via ESP-SR MultiNet (up to 200 offline commands) without Pi involvement. For complex/ambiguous commands, audio streams to the Pi for full pipeline processing. The ESP32-S3 never runs STT, LLM, or TTS.
Audio routing: ESP32-S3 satellite → WiFi UDP/TCP stream → Pi Agent audio ingestion → Voice Pipeline.
Response audio: Pi Agent → WiFi stream → ESP32-S3 I2S speaker output (or Pi hub speakers only).
Room attribution: Pi Agent knows which satellite triggered, so commands are room-aware by default.
BLE presence data from satellites feeds into HA for occupancy-based automations.

Phase 2 Future Work (do NOT build yet, but design interfaces for)

ESP32-S3 Room Satellites: Firmware for distributed wake word (microWakeWord), on-device command recognition (ESP-SR MultiNet), mic streaming, BLE presence, and GPIO sensors. ESPHome configs for zero-code HA integration. Custom ESP-IDF components for MultiNet and audio streaming. Design the Pi Agent audio ingestion interface to accept streams from multiple satellites. Target: whole-home voice coverage at ~$8-15 per room vs. running mic wire.
Moshi speech-to-speech: Kyutai Labs model (CC-BY 4.0), 160-200ms latency, requires cloud GPU. Economics break even at ~30-50 devices. Design voice pipeline interface to be swappable.
Kyutai Pocket TTS: 100M param, runs on CPU in real-time. Could replace Cartesia for local TTS.
Property management API integration: Guesty/Hospitable for Airbnb host features (no direct Airbnb API access available).
Speaker identification: Voice biometrics for multi-occupant attribution (which person spoke, not just which room).
TensorFlow Lite Micro on ESP32-S3: Edge AI for doorbell face detection, gesture recognition, sensor anomaly detection.

Key API Docs

Supabase: https://supabase.com/docs
Deepgram: https://developers.deepgram.com/docs
Groq: https://console.groq.com/docs
Cartesia: https://docs.cartesia.ai
microWakeWord: https://esphome.io/components/micro_wake_word/
openWakeWord: https://github.com/dscripka/openWakeWord
ESP-SR (WakeNet + MultiNet): https://docs.espressif.com/projects/esp-sr/en/latest/esp32s3/getting_started/readme.html
ESPHome: https://esphome.io/
Home Assistant: https://developers.home-assistant.io/docs/api/rest
OpenRouter: https://openrouter.ai/docs (non-voice path only)
OpenClaw: https://github.com/openclaw/openclaw
