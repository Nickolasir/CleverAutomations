CleverHub - AI-Powered Smart Home Butler
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

ESP32-S3 Room Satellite Nodes:
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

Intent Extraction Strategy:
Groq LLM is the PRIMARY intent extraction path for both the Pi hub voice pipeline and the mobile app. The regex/keyword rules engine proved unreliable for natural speech variations and is now an OFFLINE-ONLY fallback. HA Conversation API is NOT used (15-30s latency).

Two-tier system (cloud primary, local offline fallback):

On-Device (ESP32-S3 satellites only): ESP-SR MultiNet (up to 200 commands)

ESP-SR MultiNet on-device speech command recognition on ESP32-S3 satellites (up to 200 commands, no cloud needed, free with Espressif silicon). Handles lights, locks, thermostat, scenes directly on the satellite with zero Pi involvement for the most common commands.
This is the ONLY place where pattern-based matching is the primary path — it runs on embedded hardware that cannot run an LLM.

Primary: Groq LLM Cloud Pipeline (500-900ms) - handles ~90% of commands that reach Pi/mobile

Wake word: microWakeWord on ESP32-S3 satellites (ESPHome native, <10ms, Apache 2.0) or openWakeWord on Pi hub (Python, Apache 2.0)
STT: Deepgram Nova-3 DIRECT API (streaming WebSocket, ~150ms first tokens)
LLM: Groq DIRECT API (LPU hardware, ~200ms TTFT, 500+ tok/s) — intent extraction + response generation
TTS: Cartesia Sonic 3 DIRECT API (streaming, ~100ms first audio) — Pi hub only, mobile app skips TTS
All stages stream and overlap on Pi hub. TTS starts before LLM finishes.
Mobile app uses non-streaming Groq call for intent extraction only (~200-400ms).

Offline Fallback (3-5s) - when cloud is unreachable

Pi hub: Faster-Whisper STT → local LLM (llama.cpp) → Piper TTS → regex rules engine as last resort
Mobile app: keyword-based action detection + fuzzy entity matching → direct HA service calls
Regex/keyword rules are ONLY used in offline mode. They are NOT the primary intent path.

CRITICAL RULES:

Groq LLM is the PRIMARY intent extraction path. Regex/keyword rules are OFFLINE-ONLY fallback. The rules engine proved unreliable for natural speech variations — do NOT add new regex rules or promote the rules engine back to primary.
Voice hot path uses DIRECT APIs to Deepgram, Groq, Cartesia. NEVER route voice through OpenRouter. OpenRouter adds 25x latency overhead in benchmarks.
OpenRouter is ONLY for: background queries, analytics, model A/B testing, and LLM fallback if Groq is down.
Home Assistant's built-in Assist voice pipeline and Conversation API are NOT USED. They have 15-30s latency due to orchestration overhead. We use HA only as the device control layer via REST/WebSocket API.
NO PICOVOICE. Picovoice (Porcupine/Rhino) is proprietary with commercial licensing starting at $899/mo. Use microWakeWord (Apache 2.0, ESPHome native) for wake word and ESP-SR MultiNet (free with Espressif silicon) for on-device command recognition instead. openWakeWord (Apache 2.0) for Pi hub wake word.

Cloud Backend

Supabase: Auth (JWT + RLS), PostgreSQL, Realtime WebSocket, Edge Functions, Storage
OpenRouter: Non-voice AI only (background, analytics, model experimentation, fallback)
Multi-tenant: tenant_id in JWT claims, RLS policies enforced on every single table
TimescaleDB extension for sensor telemetry time-series data

Frontend

Web: React / Next.js admin dashboard (packages/web-dashboard)
Mobile: React Native / Expo (packages/mobile-app)
Both connect via Supabase client SDK (auth, realtime subscriptions)

Design System:
- Warm gold/amber theme (#D4A843 primary, #FDF6E3 cream background, #1F1F1F charcoal sidebar)
- Tailwind CSS with CSS custom properties for white-label theming (web)
- React Native StyleSheet with hardcoded gold palette (mobile)
- WCAG AAA high-contrast variant for CleverAide assisted living screens

Vertical-Aware UX:
- Onboarding is a 2-step flow: Step 1 = visual vertical card selector (3 large cards with icons/features), Step 2 = property details
- Navigation adapts per vertical: CleverHome shows "Family", CleverHost shows "Users" + "Guests", CleverBuilding shows "Users"
- Dashboard shows vertical-specific sections: family member cards (Home), guest check-in stats (Host)
- Sidebar branding shows vertical-specific icon and label

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
Family permission checks: every device command from a non-adult family member must pass through the FamilyPermissionResolver before execution.
Emergency commands must bypass all permission restrictions for all ages.
Parental notifications must be generated for permission denials and emergency commands from child profiles.
All PII must be encrypted at rest using encrypt_pii() / encrypt_pii_jsonb() SQL functions. No plaintext PII in database columns.
Health data (GDPR Art 9 special category) requires explicit consent check via has_active_consent() before processing.
Children's data requires parental consent verification via has_parental_consent() before processing.
All data in transit must use TLS 1.2+. HA WebSocket must use wss:// in production (ws:// only with HA_ALLOW_INSECURE=true for local dev).
GDPR data subject rights (export, erasure, rectification, restriction) must remain functional — update gdpr-data-export.ts when adding new PII tables.
Check processing_restricted flag on user record before processing any personal data.

Encryption Architecture
All PII is encrypted at rest using pgcrypto PGP symmetric encryption (AES-256, CFB mode, S2K key derivation, SHA-1 MDC integrity).
One master key is stored in Supabase Vault via vault.create_secret() — must be created BEFORE running migration 008.
Per-tenant key derivation: passphrase = master_key || ':' || tenant_id (unique encryption key per tenant from single Vault secret).
Encryption/decryption happens inside PostgreSQL via SECURITY DEFINER functions — raw keys never leave the database.
pgp_sym_encrypt handles IV generation, key derivation, and integrity checking internally — no manual wire format.
Fields that need indexed lookups (email) use a SHA-256 hash for uniqueness + encrypted copy for display.
pgcrypto functions are in the extensions schema — all functions use SET search_path = public, extensions.
NOTE: pgsodium is deprecated on Supabase. Do NOT use pgsodium or raw INSERT INTO vault.secrets (use vault.create_secret() instead).
Mobile app stores auth tokens in OS keychain (expo-secure-store), not AsyncStorage.
TLS certificate pins for voice APIs (Deepgram, Groq, Cartesia) are in packages/shared/src/crypto/tls-config.ts.

Key Files:
- Key management migration: packages/supabase-backend/src/migrations/008_encryption_key_management.sql
- Health data encryption: packages/supabase-backend/src/migrations/009_encrypt_health_data.sql
- PII field encryption: packages/supabase-backend/src/migrations/010_encrypt_pii_fields.sql
- TypeScript helpers: packages/shared/src/crypto/encryption.ts
- TLS config: packages/shared/src/crypto/tls-config.ts

SQL helper functions (use these, never roll your own):
- encrypt_pii(plaintext, tenant_id) → encrypted TEXT
- decrypt_pii(ciphertext, tenant_id) → plaintext TEXT
- encrypt_pii_jsonb(data, tenant_id) → encrypted TEXT
- decrypt_pii_jsonb(ciphertext, tenant_id) → JSONB
- hash_pii(value) → SHA-256 hex TEXT

GDPR Compliance
Full GDPR compliance framework implemented. All data processing requires documented lawful basis (see docs/legal/lawful-basis-register.md).

Consent Management:
- consent_records table tracks per-user consent by type (data_processing, voice_recording, health_data, child_data, marketing, etc.)
- has_active_consent(user_id, consent_type) checks consent before processing
- Consent withdrawal triggers cascading data deletion for that category
- Edge Function: packages/supabase-backend/src/edge-functions/gdpr-consent.ts

Data Subject Rights (Edge Functions):
- gdpr-data-export.ts — Right of Access + Portability (Art 15/20), rate limited 1/24h
- gdpr-data-erasure.ts — Right to Erasure (Art 17), double-opt-in confirmation, anonymizes audit logs
- gdpr-data-rectify.ts — Right to Rectification (Art 16), re-encrypts updated fields
- gdpr-restrict.ts — Right to Restriction (Art 18), sets processing_restricted flag in JWT

Data Retention:
- Configurable per-tenant via tenants.data_retention_policy JSONB
- Defaults: audit_logs 90d, sensor_telemetry 30d, voice 90d, health 180d, medications 365d
- Enforcement: packages/supabase-backend/src/edge-functions/data-retention-cleanup.ts (runs daily)
- IP addresses hashed after 7 days
- Migration: packages/supabase-backend/src/migrations/011_data_retention.sql

Children's Data (Art 8):
- parental_consent_recorded flag on family_member_profiles
- Block child profile creation until parental consent recorded
- has_parental_consent(profile_id) check before processing

Key Files:
- GDPR migration: packages/supabase-backend/src/migrations/012_gdpr_consent.sql
- GDPR types: packages/shared/src/types/gdpr.ts
- Privacy policy: docs/legal/privacy-policy.md
- Lawful basis register: docs/legal/lawful-basis-register.md
- DPIA: docs/legal/dpia.md
- Breach response: docs/legal/breach-response-plan.md
- Security checklist (Section 10 — GDPR): docs/security/security-checklist.md

Family Subagent System
Each family member gets a named personal agent (e.g., "Hey Jarvis", "Hey Luna", "Hey Buddy") with age-based permissions layered on top of the existing 5-level role system. The FamilyAgeGroup enum (adult, teenager, tween, child, toddler, adult_visitor) provides fine-grained application-level permission control resolved at command execution time. The existing UserRole remains the RLS security boundary.

Age Group Tiers:
- adult (18+): Full permissions, maps to owner/admin role
- teenager (15-17): Near-adult, no locks/cameras/spending, maps to resident role
- tween (10-14): Own-room focused, PG content, maps to resident role
- child (5-9): Own-room lights only, G content, maps to guest role
- toddler (2-4): Zero device control, conversational companion only, maps to guest role
- adult_visitor: Scoped to explicitly-allowed devices, time-limited, maps to guest role
- assisted_living: Elderly/disabled users with caregiver support, full device access, purchases require caregiver approval, maps to resident role

Permission Resolution Priority (highest to lowest):
1. Emergency commands → always pass (all ages, all roles)
2. Explicit per-device override → parent specifically allowed/denied
3. Active schedule restriction → bedtime/school blocks override defaults
4. Per-category override → parent allowed/denied whole category
5. Per-room override → parent allowed/denied all devices in room
6. Age-group default matrix → baseline permissions

Voice Routing:
- Each agent name is a registered wake word on ESP32-S3 satellites
- Wake word → WakeWordRegistry lookup → load profile + permissions + schedules
- LLM system prompt is scoped to the member's personality, allowed devices, and restrictions
- TTS responds in the agent's configured Cartesia voice
- Generic "Clever" wake word still works as fallback

Safety Rules:
- Emergency commands ("help", "fire", "hurt") bypass ALL permissions for ALL ages
- Toddler agents have zero device control — they are conversational companions (stories, songs, animal sounds)
- Constraint clamping: parameters silently adjusted to limits (temp range, volume cap, brightness)
- Parental notifications generated on permission denials, override attempts, and emergencies
- Schedules (bedtime, school hours, quiet time) enforce time-based restrictions automatically

Key Files:
- Migration: packages/supabase-backend/src/migrations/004_family_subagents.sql
- Types: packages/shared/src/types/family.ts
- Permission resolver: packages/shared/src/permissions/family-permissions.ts
- Default matrices: packages/shared/src/permissions/default-matrices.ts
- Web UI: packages/web-dashboard/src/app/dashboard/family/page.tsx (tabbed: Members, Permissions, Schedules, Spending)
- Mobile UI: packages/mobile-app/src/screens/FamilyScreen.tsx (segmented control with same 4 sections)

CleverAide System (Assisted Living)
The assisted_living age group extends the family subagent system with care-specific features for elderly and disabled users. An aide_profiles companion table (1:1 with family_member_profiles) stores medical info, emergency contacts, accessibility levels, and interaction preferences.

Features:
- Medication management: scheduled reminders via voice with confirmation tracking (taken/skipped/missed)
- Wellness check-ins: 3x daily proactive conversations assessing mood, pain, and needs
- Inactivity monitoring: HA motion sensors detect prolonged inactivity during waking hours
- Caregiver alerts: unified alert queue with severity escalation and multi-channel delivery (push, Telegram, WhatsApp, SMS)
- Fall assessment: "I fell" triggers assessment flow (not immediate emergency) to reduce false positives
- Enhanced emergency: reads medical info aloud, contacts caregivers, stays conversational
- Simplified mobile UI: 3-tab navigator (Home/Talk/Help) with large text, SOS button, WCAG AAA
- Messaging integration: Telegram bot and WhatsApp Business API for caregiver alerts and remote commands
- Proactive speech: Pi Agent can initiate voice without wake word for reminders and check-ins
- TTS pacing: Cartesia speed parameter adjusted for hearing level (slower pace, louder volume)

Confirmation Mode (aide_profiles.confirmation_mode):
- "always": requires verbal confirmation before every device command
- "safety_only": confirmation only for locks, thermostat, climate, covers
- "never": no extra confirmation (standard behavior)

Key Files:
- Migration: packages/supabase-backend/src/migrations/006_cleveraide.sql
- Types: packages/shared/src/types/aide.ts
- Edge Functions: packages/supabase-backend/src/edge-functions/aide-wellness.ts, aide-alerts.ts
- Orchestrator prompts: packages/orchestrator/src/system-prompts.ts (buildAideAgentSystemPrompt)
- HA Monitor: packages/ha-bridge/src/aide-monitor.ts
- Pi Agent crons: packages/pi-agent/src/cron/aide-medication-cron.ts, aide-checkin-cron.ts
- Proactive speech: packages/pi-agent/src/aide-proactive.ts
- Mobile screens: packages/mobile-app/src/screens/aide/
- Messaging: packages/messaging/src/telegram.ts, whatsapp.ts
- Webhook: packages/supabase-backend/src/edge-functions/messaging-webhook.ts
- Wake word registry: packages/voice-pipeline/src/orchestrator/wake-word-registry.ts

Code Standards

TypeScript strict mode for ALL new code
ESLint + Prettier enforced (config in repo root)
No any types. Shared interfaces in packages/shared/types/
All Supabase operations through client SDK (never raw SQL in application code)
Environment variables via .env files (never committed, .env.example committed)
Every voice pipeline component must have latency benchmark tests
Every RLS policy must have a cross-tenant access test proving isolation
Family permission checks must add less than 50ms to voice pipeline latency

Monorepo Structure
packages/
  orchestrator/       # Clever AI orchestrator: triage, family agents, conversation manager, LLM client
  voice-pipeline/     # Streaming voice: wake word, STT, LLM, TTS, tier routing
  ha-bridge/          # Home Assistant REST/WebSocket client, device registration
  supabase-backend/   # Schema, migrations, RLS policies, Edge Functions
  web-dashboard/      # Next.js admin dashboard
  mobile-app/         # React Native iOS/Android app (includes chat + voice UI)
  pi-agent/           # Raspberry Pi device agent, hardware config, deployment
  kitchen-hub/        # Kitchen Sub-Hub: ePantry, shopping list, receipt/barcode scanning, timers
  comms-agent/        # Communications Sub-Agent: email (Gmail/Outlook OAuth), calendar, family messaging, privacy controls
  esp32-satellite/    # ESP32-S3 room node firmware (ESPHome configs + custom components)
  shared/             # Shared TypeScript types, utils, constants, permission engine
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

ESP32-S3 Room Satellites: Firmware for distributed wake word (microWakeWord), on-device command recognition (ESP-SR MultiNet), mic streaming, BLE presence, and GPIO sensors. ESPHome configs for zero-code HA integration. Custom ESP-IDF components for MultiNet and audio streaming. Design the Pi Agent audio ingestion interface to accept streams from multiple satellites. Target: whole-home voice coverage with low-cost satellite nodes.
Moshi speech-to-speech: Kyutai Labs model (CC-BY 4.0), 160-200ms latency, requires cloud GPU. Economics break even at ~30-50 devices. Design voice pipeline interface to be swappable.
Kyutai Pocket TTS: 100M param, runs on CPU in real-time. Could replace Cartesia for local TTS.
Property management API integration: Guesty/Hospitable for Airbnb host features (no direct Airbnb API access available).
Speaker identification: Voice biometrics for multi-occupant attribution (which person spoke, not just which room). Phase 1 workaround: named agent wake words ("Hey Jarvis", "Hey Luna") provide user identification via wake word selection. Phase 2 adds true voice biometrics for automatic identification.
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

GDPR Pre-Production Checklist (DAILY REMINDER — incomplete items)
The following items MUST be completed before production deployment. Remind the user about these at the start of every conversation until all are checked off.

- [ ] Execute DPAs (Data Processing Agreements) with: Deepgram, Groq, Cartesia, Supabase, Telegram, WhatsApp/Meta. Most providers have standard DPAs on their legal/compliance pages. Download, sign, and file.
- [ ] Fill in placeholder fields in legal docs: [INSERT DATE], [INSERT ADDRESS], [INSERT NAME] in docs/legal/privacy-policy.md, docs/legal/dpia.md, docs/legal/breach-response-plan.md.
- [ ] Appoint a Data Protection Officer (DPO). Required under GDPR Art 37 because CleverAide processes health data (Art 9 special category). Can be an employee, consultant, or external DPO service.
- [ ] Set up pg_cron or Supabase scheduled function to run data-retention-cleanup Edge Function daily. Without this, retention policies exist but are not enforced.
