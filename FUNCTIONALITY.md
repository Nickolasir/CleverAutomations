# CleverAutomations — Complete Functionality Reference

## Executive Summary

CleverAutomations is an AI-powered smart home automation platform built around a Raspberry Pi 5 local hub with Home Assistant integration and a three-tier voice pipeline. It serves three market verticals — **CleverHome** (homebuilders), **CleverHost** (Airbnb/STR hosts), and **CleverBuilding** (apartment complexes) — through a multi-tenant SaaS backend on Supabase, a Next.js web dashboard, and a React Native mobile app.

---

## Table of Contents

1. [Market Verticals & Positioning](#1-market-verticals--positioning)
2. [System Architecture](#2-system-architecture)
3. [Voice Pipeline (Three-Tier Hybrid)](#3-voice-pipeline-three-tier-hybrid)
4. [Home Assistant Integration (HA Bridge)](#4-home-assistant-integration-ha-bridge)
5. [Database Schema & Multi-Tenancy](#5-database-schema--multi-tenancy)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [Family Subagent System](#7-family-subagent-system)
8. [Web Dashboard (Next.js)](#8-web-dashboard-nextjs)
9. [Mobile App (React Native)](#9-mobile-app-react-native)
10. [Guest Lifecycle Management (CleverHost)](#10-guest-lifecycle-management-cleverhost)
11. [Audit Logging](#11-audit-logging)
12. [Security Model](#12-security-model)
13. [Hardware & Deployment](#13-hardware--deployment)
14. [Codebase Organization](#14-codebase-organization)
15. [Roadmap](#15-roadmap)

---

## 1. Market Verticals & Positioning

### CleverHome (Homebuilders)

- **Model**: Pre-installed intelligent hub in new construction homes
- **Cost to builder**: $550–$1,995 (hardware + install labor)
- **Builder ROI**: 3.6x–13.2x at point of sale ($2,000–$20,000 home price uplift)
- **Buyer monthly SaaS**: $5–10/mo for premium features (builder gets 20% revenue share)
- **Target market**: Harris County builders (Chesmar, Highland, Gehan, Perry, LGI, etc.)
- **Differentiator**: Only builder-integrated smart home solution in the Houston market
- **TAM**: ~200 volume/regional builders in Harris County building 100+ homes/year

### CleverHost (Airbnb/STR Hosts)

- **Model**: SaaS subscription per property (no hardware cost to host)
- **Pricing**:
  - Solo (1 property): $29/mo
  - Growing (2–5 properties): $24/mo each
  - Professional (6–10): $19/mo each
  - Portfolio (11+): $14/mo each
- **Host ROI**: 8.6x–22.1x annually ($15,480–$39,800 per property)
- **Target market**: 15,000+ active Houston Airbnb/VRBO listings; $3.5M–$5.5M TAM at 15–25% penetration
- **Unique features no competitor offers**:
  - WiFi credential rotation between guests
  - Complete 6-category guest profile wipe
  - Voice concierge in guest mode
  - Pre-check-in energy management (pre-cool/heat)
- **PMS integrations**: OwnerRez, Guesty, Hospitable, Direct Booking

### CleverBuilding (Apartment Complexes)

- Enterprise tier for multi-unit smart building management
- Shared services: common areas, parking, mailroom
- Unit-level privacy with building-wide energy/security management
- Not fully detailed in current codebase (future expansion)

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLOUD (Supabase)                      │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ PostgreSQL +   │  │ Edge         │  │ Realtime    │  │
│  │ RLS Policies   │  │ Functions    │  │ WebSocket   │  │
│  │ + TimescaleDB  │  │              │  │             │  │
│  └────────────────┘  └──────────────┘  └─────────────┘  │
│         ↕                    ↕                ↕          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │  Web Dashboard (Next.js) │ Mobile App (React Native) │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │         Voice Pipeline Cloud APIs (Direct)           │ │
│ │  Deepgram Nova-3 (STT) │ Groq LPU (LLM) │ Cartesia │ │
│ │  OpenRouter fallback ONLY if Groq is down            │ │
│ └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                         ↕ WAN
┌──────────────────────────────────────────────────────────┐
│          LOCAL NETWORK (Raspberry Pi 5)                  │
│  ┌──────────────┐  ┌──────────────────────────────────┐  │
│  │ Pi Agent     │  │ Voice Pipeline (3-tier)          │  │
│  │ - Supabase   │  │  Tier 1: Rules engine (50–200ms) │  │
│  │   Realtime   │  │  Tier 2: Cloud APIs  (580–900ms) │  │
│  │ - HA Bridge  │  │  Tier 3: Local       (3–5s)      │  │
│  │ - Auth       │  │                                   │  │
│  └──────────────┘  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Home Assistant (REST + WebSocket)                    │ │
│  │ Device discovery │ Scene execution │ State subs      │ │
│  └──────────────────────────────────────────────────────┘ │
│                         ↕                                 │
│  Smart Home Devices (Zigbee / Z-Wave / Thread / WiFi)    │
│  Locks │ Lights │ Thermostats │ Garage │ Cameras │ etc.  │
└──────────────────────────────────────────────────────────┘
```

**Key architectural decisions:**
- All voice-critical API calls go DIRECT to Deepgram/Groq/Cartesia — never through OpenRouter (which adds ~25x latency overhead)
- OpenRouter is only used as a fallback LLM if Groq is down
- Every database table is RLS-protected with tenant isolation via JWT claims
- The Pi Agent orchestrates all local processing and bridges cloud ↔ local
- ESP32-S3 satellite nodes (~$8 each) distribute microphones, sensors, and BLE presence to every room — the Pi remains the brain, satellites are the nervous system

---

## 3. Voice Pipeline (Three-Tier Hybrid)

The voice pipeline is the most architecturally critical component. It targets **sub-1-second end-to-end latency** using a tiered approach that degrades gracefully.

### Distributed Voice via ESP32-S3 Satellites

Wake word detection is distributed across rooms. Each ESP32-S3 satellite runs **microWakeWord** locally (<10ms inference per 20ms audio stride, Apache 2.0, ESPHome native). When the wake word "Clever" is detected, the satellite first attempts to recognize the command locally using **ESP-SR MultiNet** (up to 200 offline commands, free with Espressif silicon). Common commands (lights, locks, thermostat, scenes) execute directly from the satellite via HA API — zero Pi involvement. For complex or ambiguous commands, the satellite streams raw audio over WiFi to the Pi hub for Tier 2/3 processing.

```
ESP32-S3 (Bedroom)  ──┐
ESP32-S3 (Kitchen)  ──┤── Common commands: MultiNet → HA API (no Pi needed)
ESP32-S3 (Living)   ──┤── Complex commands: WiFi audio stream → Pi Agent → Tier 2/3
ESP32-S3 (Garage)   ──┘
```

**Room attribution:** The Pi Agent knows which satellite triggered the wake word, so commands are automatically room-aware (e.g., "turn off the lights" from the bedroom satellite targets bedroom lights).

**Why not Picovoice?** Picovoice (Porcupine/Rhino) is proprietary with commercial licensing starting at $899/mo. The open-source stack (microWakeWord + ESP-SR MultiNet + openWakeWord) provides equivalent or better functionality at $0 licensing cost, with native ESPHome/HA ecosystem integration.

### Tier 1: Rules Engine (~70% of commands, 50–200ms)

**Technologies:** ESP-SR MultiNet (on-device command recognition on ESP32-S3) + regex pattern matching (on Pi hub)

**How it works:**
1. Audio captured by INMP441 mic on ESP32-S3 satellite (or ReSpeaker on Pi hub)
2. microWakeWord detects wake word "Clever" (<10ms inference, Apache 2.0)
3. ESP-SR MultiNet on the satellite attempts to recognize the command from up to 200 pre-defined phrases (no transcription step, runs entirely on ESP32-S3)
4. If MultiNet matches → direct HA API call from satellite, command complete in 50–200ms
5. If no MultiNet match → audio streams to Pi hub, regex engine checks transcript against 30+ patterns
6. Matched intent is sent to Home Assistant via REST API

**Supported command patterns (30+):**
| Category | Examples |
|----------|----------|
| Lights | "turn on/off [room] lights", "dim the [room] to [X]%", "set brightness to [X]" |
| Locks | "lock/unlock the [door]", "lock all doors" |
| Thermostat | "set temp to [X]", "turn up/down the AC [X] degrees", "set to heat/cool/auto mode" |
| Scenes | "good morning", "good night", "movie mode", "I'm leaving", "I'm home" |
| Fans | "turn on/off the [room] fan" |

**Strengths:** Fastest response, fully private (local processing), no cloud dependency, 1.0 confidence score

### Tier 2: Cloud Streaming (~20% of commands, 580–900ms)

**Flow with streaming overlap (the key optimization):**
```
Audio → microWakeWord / openWakeWord wake word (<10ms / ~80ms)
      → Deepgram Nova-3 STT via WebSocket (~150ms first tokens)
           ↓ partial transcripts stream in
        Check Tier 1 rules (if match → skip to HA call)
           ↓ no match
        Groq LLM streaming via SSE (~200ms TTFT, 500+ tok/s)
           ↓ tokens stream to TTS immediately
        Cartesia Sonic 3 TTS via WebSocket (~100ms first audio)
           ↓ audio plays while LLM is still generating
        Total: 580–900ms end-to-end
```

**Wake Word:**
- **ESP32-S3 satellites:** microWakeWord (Apache 2.0, ESPHome native, <10ms inference, TFLite Micro, custom wake words via synthetic training)
- **Pi hub:** openWakeWord (Apache 2.0, Python, good accuracy, easy custom training)
- Pre-trained words available: "Hey Jarvis", "Hey Nabu", "Hey Mycroft" — custom "Clever" wake word to be trained

**STT — Deepgram Nova-3:**
- WebSocket streaming (partial + final transcripts)
- Linear16 encoding, 16kHz sample rate, mono
- ~150ms to first partial transcript

**LLM — Groq LPU (Direct API):**
- Model: `llama-3.3-70b-versatile`
- DIRECT to `api.groq.com` (never via OpenRouter)
- SSE streaming, ~200ms time-to-first-token, 500+ tok/s throughput
- Temperature: 0.1 (deterministic for device commands)
- Max tokens: 256 (short spoken responses)
- System prompt instructs the model to respond with a JSON action block + short natural language confirmation

**TTS — Cartesia Sonic 3:**
- WebSocket streaming for audio chunks
- PCM 16-bit output, ~100ms to first audio chunk
- Audio playback begins before LLM finishes generating (streaming overlap)

**Health checks:** Each API is pinged every 30 seconds. If Groq is unhealthy, OpenRouter is used as LLM fallback only.

**Confidence threshold:** 0.85 for LLM-parsed intents

### Tier 3: Local Fallback (~10% of commands / offline, 3–5s)

**Activated when:** Cloud APIs are unhealthy or no internet connection

**STT — Faster-Whisper:**
- Model: `base.en` (~77M params)
- 4–8x faster than standard Whisper
- Runs on CPU (Hailo can optionally accelerate)

**LLM — llama.cpp + Qwen2.5 1.5B:**
- Model: `qwen2.5-1.5b-q4_k_m` (Q4 quantized)
- 4–8 tok/s on Pi 5 with Hailo GPU offloading (20 GPU layers)
- 4 CPU threads, 2048 context window
- Simplified system prompt (JSON-only output)

**TTS — Piper TTS:**
- Model: `en_US-lessac-medium` (300M params)
- CPU-based, runs locally
- PCM 16kHz output

**Confidence threshold:** 0.65 (lower due to small model size)

### Tier Router Logic

```
1. Check cloud API health (Deepgram, Groq, Cartesia)
2. If ALL healthy → Route to Tier 2 (but try Tier 1 rules first)
3. If Tier 1 rules match → Execute immediately, skip cloud
4. If ANY cloud API unhealthy → Route to Tier 3
5. Log tier used, latency, confidence to voice_sessions table
```

### Voice Security

- Global confidence threshold: 0.7 — commands below this require user confirmation
- Security-sensitive commands (unlock, disarm) will require 2FA in future
- No raw audio is stored — only encrypted transcripts
- Voice processing is local for Tier 1 and Tier 3
- All voice components are open-source (microWakeWord, openWakeWord, ESP-SR) — no proprietary licensing dependencies

---

## 4. Home Assistant Integration (HA Bridge)

### REST Client (`rest-client.ts`)

Wraps the Home Assistant REST API:
- **Service calls**: `POST /api/services/{domain}/{service}` — execute device commands
- **State queries**: `GET /api/states/{entity_id}` — read current device state
- **Entity registry**: `GET /api/config/entity_registry/list` — discover all entities
- **Area registry**: `GET /api/config/area_registry/list` — discover rooms/areas

### WebSocket Client (`websocket-client.ts`)

- Maintains persistent WebSocket connection to Home Assistant
- Subscribes to real-time state change events
- Pi Agent forwards state changes to Supabase Realtime channels
- Enables live dashboard/mobile app updates

### Device Discovery (`device-discovery.ts`)

- Auto-discovers all HA entities on the local network
- Maps `entity_id` to internal `DeviceId` and device category
- Syncs discovered devices to Supabase `devices` table
- Supports Zigbee, Z-Wave, Thread, and WiFi devices

### Command Executor (`command-executor.ts`)

Translates parsed voice intents into HA service calls. When a `FamilyVoiceContext` is provided, the executor runs the `FamilyPermissionResolver` before any HA API call — checking age-based permissions, applying constraint clamping (thermostat range, volume cap), and returning age-appropriate denial messages if blocked.

| Intent | HA Service Call |
|--------|----------------|
| `light.turn_on` | `callService("light", "turn_on", {entity_id, brightness?, color?})` |
| `light.turn_off` | `callService("light", "turn_off", {entity_id})` |
| `lock.lock` | `callService("lock", "lock", {entity_id})` |
| `lock.unlock` | `callService("lock", "unlock", {entity_id})` |
| `climate.set_temperature` | `callService("climate", "set_temperature", {entity_id, temperature})` |
| `scene.activate` | `callService("scene", "turn_on", {entity_id})` |
| `fan.turn_on/off` | `callService("fan", "turn_on/turn_off", {entity_id})` |

### Scene Executor (`scenes.ts`)

Built-in scenes that execute multiple device commands:

| Scene | Actions |
|-------|---------|
| **Good Morning** | Lights on gradually, AC to comfort temp, coffee maker start |
| **Good Night** | All lights off, doors lock, thermostat adjust, alarm arm |
| **Movie Mode** | Living room dims, blinds close, TV on |
| **Leaving** | Doors lock, lights off, AC to energy saving, alarm arm |
| **Arriving** | Doors unlock, lights on, AC to comfort temp, welcome voice |

---

## 5. Database Schema & Multi-Tenancy

All tables enforce tenant isolation via Row-Level Security (RLS). Every query is filtered by `tenant_id = auth.jwt()->>'tenant_id'`.

### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `tenants` | Tenant/property registration | name, vertical, subscription_tier, settings (voice_enabled, max_devices, max_users, guest_wipe_enabled, audit_retention_days) |
| `users` | User accounts (linked to Supabase Auth) | tenant_id, email, role (owner\|admin\|manager\|resident\|guest), display_name |
| `devices` | Smart home devices | tenant_id, ha_entity_id, name, category, room, floor, state, is_online, last_seen, attributes |
| `rooms` | Room/area organization | tenant_id, name, floor, devices (UUID array) |
| `scenes` | Automation scenes | tenant_id, name, actions (JSON), trigger (manual\|schedule\|voice\|geofence) |
| `device_state_changes` | State change history | device_id, tenant_id, previous_state, new_state, changed_by, source, timestamp |
| `device_commands` | Command log | device_id, tenant_id, issued_by, action, parameters, source, confidence |
| `voice_sessions` | Voice interaction log | tenant_id, user_id, tier, transcript, parsed_intent, response_text, stages (with per-stage latency), total_latency_ms, confidence, status |
| `audit_logs` | Immutable security audit trail | tenant_id, user_id, action (14 types), details, ip_address, timestamp (server-generated) |

### Family Subagent Tables (Migration 004)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `family_member_profiles` | Links user to age group + named agent | tenant_id, user_id, age_group, agent_name (unique per tenant), agent_voice_id, agent_personality (JSONB), managed_by, expires_at |
| `family_permission_overrides` | Per-member device/category/room grants/denials | tenant_id, profile_id, device_id, device_category, room, action (control\|view_state\|configure\|view_history), allowed, constraints (JSONB) |
| `family_schedules` | Time-based restriction windows | tenant_id, profile_id, schedule_name, days_of_week, start_time, end_time, timezone, restrictions (JSONB), is_active |
| `family_spending_limits` | Purchase/ordering caps per member | tenant_id, profile_id, daily_limit, monthly_limit, requires_approval_above, approved_categories |
| `parental_notifications` | Events parents should see | tenant_id, profile_id, event_type, details (JSONB), acknowledged |

### CleverHost Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `reservations` | Guest reservations | tenant_id, property_id, guest_profile_id, platform (airbnb\|vrbo\|direct), check_in, check_out, guest_count, status |
| `guest_profiles` | Per-reservation guest data | tenant_id, reservation_id, display_name, wifi_password (encrypted), door_code (encrypted), voice_preferences, tv_logins, expires_at |
| `guest_wipe_checklists` | Wipe completion tracking | reservation_id, tenant_id, items (6 categories), is_complete |
| `turnover_tasks` | Between-stay task management | tenant_id, reservation_id, type (wipe\|prepare\|inspect), status, assigned_devices |

### Time-Series Table

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `sensor_telemetry` | TimescaleDB hypertable for IoT data | time (partition key), tenant_id, device_id, metric, value, unit |

---

## 6. Authentication & Authorization

### Authentication

- **Provider**: Supabase Auth (email + password, JWT-based)
- **Token structure**:
  ```json
  {
    "sub": "user-id",
    "tenant_id": "tenant-uuid",
    "user_role": "owner|admin|manager|resident|guest",
    "device_scope": "device-id (optional, for scoped device tokens)",
    "family_age_group": "adult|teenager|tween|child|toddler|adult_visitor (optional)",
    "family_profile_id": "profile-uuid (optional)",
    "agent_name": "Jarvis|Luna|Buddy|etc (optional)",
    "iat": 1234567890,
    "exp": 1234571490
  }
  ```
- **Device tokens**: Scoped JWTs with `device_scope` claim, revocable
- **Session management**: Token expiration enforced server-side with refresh token mechanism
- **Web middleware**: Next.js middleware validates JWT and refreshes expired sessions on all `/dashboard/*` routes

### Authorization (Role Hierarchy)

```
owner > admin > manager > resident > guest
```

| Permission | Owner | Admin | Manager | Resident | Guest |
|------------|:-----:|:-----:|:-------:|:--------:|:-----:|
| Manage users | ✓ | ✓ (not owner/admin) | ✗ | ✗ | ✗ |
| Manage devices | ✓ | ✓ | ✓ | ✗ | ✗ |
| View audit logs | ✓ | ✓ | ✗ | ✗ | ✗ |
| Tenant settings | ✓ | ✓ | ✗ | ✗ | ✗ |
| Control devices | ✓ | ✓ | ✓ | ✓ | Limited |
| Voice commands | ✓ | ✓ | ✓ | ✓ | ✓ |

### RLS Enforcement

- Every table has `tenant_id` column with RLS policy: `tenant_id = auth.jwt()->>'tenant_id'`
- Cross-tenant isolation is verified by automated tests (`rls-isolation.test.ts`) on all 16 tables (11 core + 5 family)
- Edge Functions never use service role for user-initiated requests (defense-in-depth)
- Audit logs table: no UPDATE/DELETE allowed for any user role (immutable)
- Guest users can only read their own guest profile

---

## 7. Family Subagent System

### Overview

Each family member gets a **named personal agent** with a unique wake word (e.g., "Hey Jarvis" for Dad, "Hey Luna" for the teen, "Hey Buddy" for a child). The system provides **age-based differential permissions** that layer on top of the existing 5-level role system without replacing it.

The existing `UserRole` (owner/admin/manager/resident/guest) remains the RLS security boundary. The new `FamilyAgeGroup` adds finer-grained application-level permission control resolved at command execution time by the `FamilyPermissionResolver`.

### Age Group Tiers (6 Levels)

| Age Group | Ages | Maps to DB Role | Description |
|-----------|------|-----------------|-------------|
| **adult** | 18+ (parents) | owner/admin | Full control of everything |
| **teenager** | 15-17 | resident | Near-adult but no security/locks/cameras/spending |
| **tween** | 10-14 | resident | Own-room focused, PG content, no thermostat extremes |
| **child** | 5-9 | guest | Own-room lights only, G content, educational interactions |
| **toddler** | 2-4 | guest | Zero device control — agent is a conversational companion |
| **adult_visitor** | 18+ (guests) | guest | Scoped to explicitly-allowed devices, time-limited |

### Permission Matrix — Device Control

| Capability | Adult | Teenager | Tween | Child | Toddler | Visitor |
|-----------|:-----:|:--------:|:-----:|:-----:|:-------:|:-------:|
| Lights — own room | Yes | Yes | Yes | Yes | No | Allowed only |
| Lights — common areas | Yes | Yes | No | No | No | Allowed only |
| Locks (front door, garage) | Yes | **No** | No | No | No | No |
| Thermostat | Full range | 65-78°F | 68-75°F | No | No | 68-76°F |
| Media player | All | PG-13, vol≤80% | PG, vol≤70% | G, vol≤50% | Playlist only | PG-13, vol≤70% |
| Cameras/surveillance | Yes | **No** | No | No | No | No |
| Fans | Yes | Own room | Own room | Own room | No | Allowed only |
| Sensors (read) | Yes | Yes | Own room | No | No | No |
| Alarm/security | Yes | **No** | No | No | No | No |

### Permission Matrix — Non-Device

| Capability | Adult | Teenager | Tween | Child | Toddler | Visitor |
|-----------|:-----:|:--------:|:-----:|:-----:|:-------:|:-------:|
| Shopping list — add | Yes | Yes | Yes | No | No | No |
| Shopping list — purchase | Yes | No | No | No | No | No |
| Scene activation | All | Approved list | Approved list | None | None | None |
| View voice history | All users | Own only | Own only | None | None | None |
| View audit logs | Yes | No | No | No | No | No |
| Override others | Yes | No | No | No | No | No |

### Safety & Rate Limits

| Constraint | Adult | Teenager | Tween | Child | Toddler | Visitor |
|-----------|:-----:|:--------:|:-----:|:-----:|:-------:|:-------:|
| Rate limit (cmd/min) | 60 | 30 | 20 | 10 | 5 | 15 |
| Emergency commands | Always | Always | Always | Always | Always | Always |
| Time-of-day restrictions | None | Configurable | Configurable | Enforced | Enforced | Configurable |

### Permission Resolution Priority

The `FamilyPermissionResolver` evaluates permissions in this order (highest to lowest):

1. **Emergency bypass** — "help", "fire", "hurt" always pass, all ages
2. **Explicit per-device override** — parent specifically allowed/denied this device
3. **Active schedule restriction** — bedtime/school blocks override defaults
4. **Per-category override** — parent allowed/denied a whole device category
5. **Per-room override** — parent allowed/denied all devices in a room
6. **Age-group default matrix** — baseline from the tables above

### Constraint Clamping

When a command is allowed but constrained, parameters are silently adjusted:
- Teen sets thermostat to 80°F (max 78°F) → clamped to 78°F, agent says "Set to 78, that's your max"
- Child requests volume at 100% (max 50%) → capped at 50%
- Tween dims lights to 5% (min 20%) → raised to 20%

### Named Agent System

Each family member picks a unique name for their personal agent. This name becomes their wake word.

| Example Family | Agent Name | Wake Phrase | Personality |
|---------------|------------|-------------|-------------|
| Dad (owner) | Jarvis | "Hey Jarvis" | Formal, concise, dry wit |
| Mom (admin) | Nova | "Hey Nova" | Warm, efficient, informative |
| Teen (16) | Luna | "Hey Luna" | Friendly, casual |
| Tween (11) | Sage | "Hey Sage" | Encouraging, educational |
| Child (7) | Buddy | "Hey Buddy" | Playful, simple words, sound effects, ≤15 words |
| Toddler (3) | Sunny | "Hey Sunny" | Nurturing, sing-song, ≤10 words, animal sounds |
| Grandma (visitor) | Clever | "Hey Clever" | Friendly, patient, clear |

### Agent Personality Configuration

Each agent has configurable personality traits stored in `agent_personality` (JSONB):
- `tone`: formal, friendly, playful, educational, nurturing
- `vocabulary_level`: adult, teen, child, toddler
- `humor_level`: 0.0–1.0
- `encouragement_level`: 0.0–1.0 (higher for younger children)
- `safety_warnings`: boolean (inject safety reminders)
- `max_response_words`: shorter for younger users
- `forbidden_topics`: topics the agent won't discuss (security, cameras, money for children)
- `sound_effects`: boolean (fun sounds for kids)

### Toddler Companion Mode

Toddlers get zero device control. Their agent is a **conversational companion**:
- Tells stories, sings nursery rhymes, plays word games
- "What does a cow say?" → "Mooooo!"
- Can play parent-approved music playlist on room speaker (the ONLY device interaction)
- Always responds to "help" / distress keywords → immediate parent notification
- Keeps responses under 10 words, uses simple vocabulary

### Permission Denial UX

Denials are age-appropriate:
- **Adult**: "That device isn't in your allowed list."
- **Teenager**: "You don't have access to the locks. Want me to ask your parents?"
- **Tween**: "I can't do that one, but I can help with your bedroom lights!"
- **Child**: "That's a grown-up thing! But hey, want me to tell you a joke?"
- **Toddler**: "Let's sing a song instead!"

### Schedule System (Parental Time Controls)

Parents define named schedules per child:

| Schedule | Days | Time | Restrictions |
|----------|------|------|-------------|
| Bedtime (child) | Sun-Thu | 8:30PM-6:30AM | Block media, all lights except nightlight; auto-activate bedtime scene |
| School Hours (tween) | Mon-Fri | 8AM-3PM | Block media, gaming switches; allow lights, fan |
| Quiet Time (teen) | Sun-Thu | 10PM-6AM | Volume cap 30%; no common-area scene changes |

Schedules can auto-activate scenes and generate parental notifications on override attempts.

### Voice Pipeline Integration

```
ESP32 detects wake word ("Hey Luna") → Pi Agent
  → WakeWordRegistry.lookup("luna") → load FamilyMemberProfile
  → WakeWordRegistry.resolveContext("luna") → load overrides, schedules, spending limits
  → VoicePipeline.processVoiceCommand(audio, { familyContext }) →
      LLM system prompt scoped to personality + allowed devices + restrictions
  → CommandExecutor.execute(intent, userId, "voice", familyContext) →
      FamilyPermissionResolver.checkPermission() → 6-level priority chain
  → If allowed → apply constraints → HA service call → respond in agent's TTS voice
  → If denied → age-appropriate denial message → parental notification
```

The generic "Clever" wake word still works as a fallback.

### Database Tables (Migration 004)

| Table | Purpose |
|-------|---------|
| `family_member_profiles` | Links user → age group + agent config (name, voice, personality) |
| `family_permission_overrides` | Per-member device/category/room grants/denials with constraints |
| `family_schedules` | Time-based restriction windows (bedtime, school hours, quiet time) |
| `family_spending_limits` | Purchase/ordering caps per member |
| `parental_notifications` | Events parents should see (denials, emergencies, override attempts) |

All tables enforce `tenant_id` isolation via RLS. Config tables writable by owner/admin only.

### Edge Cases

| Scenario | Handling |
|----------|---------|
| **Babysitter** | Temporary `adult_visitor` profile with custom agent name, explicit device allowances, expiration time |
| **Grandparent visit** | `adult_visitor` with generous permissions (near-adult minus security/cameras) |
| **Play date** | Visiting child uses the family child's agent (already scoped appropriately) |
| **Teen overrides child's bedtime** | Denied — `override_others: false` for teens; only adults can override |
| **Child speaks from living room** | Permissions follow the USER, not the room; child still limited to own-room devices |
| **Unknown speaker** | Generic "Clever" handler; low-risk actions allowed; high-risk requires parent confirmation |
| **Emergency from any age** | Always executes; notifies all adults immediately |

---

## 8. Web Dashboard (Next.js)

### Authentication Pages

| Page | Functionality |
|------|---------------|
| `/auth/login` | Email + password sign-in |
| `/auth/signup` | Tenant registration, user creation, initial setup |
| `/auth/callback` | OAuth callback handler |
| `/auth/onboarding` | First-time setup wizard for new properties |

### Dashboard Pages

#### Overview (`/dashboard`)
- Summary metrics: total devices, online count, active count, voice command volume
- Tier breakdown visualization (Tier 1% / Tier 2% / Tier 3%)
- Real-time device grid via Supabase Realtime subscriptions

#### Devices (`/dashboard/devices`)
- Searchable, filterable device table
- Filters: search text, category, state (on/off/locked/unlocked), online/offline
- Columns: device name, category, room, state, status, last seen, actions
- One-click toggle for controllable devices
- Click device name → detail page

#### Device Detail (`/dashboard/devices/[id]`)
- Current state, online status, full attribute display
- State change history (last 50, sortable)
- Command log (last 50, with source and confidence)
- Interactive toggle button (if device is online)
- Real-time updates via device-specific Realtime channel

#### Rooms (`/dashboard/rooms`)
- Floor filter tabs (Ground, First, Second, etc.)
- Room cards showing: device count, online count, active percentage progress bar
- Click room → filtered device view for that room

#### Scenes (`/dashboard/scenes`)
- List all scenes with action count and trigger type
- Create scene: name, description, trigger type, action builder (select device + action)
- Edit and delete existing scenes
- Activate scene button → executes all associated device actions

#### Guest Management (`/dashboard/guests`) — CleverHost only
- Status filter tabs: All, Upcoming, Active, Completed, Cancelled
- Split view:
  - **Left panel**: Searchable reservation list sorted by check-in date
  - **Right panel**: Selected reservation details
    - Guest profile: display name, door code, WiFi password, expiration
    - Wipe checklist status: locks ✓, WiFi ✓, voice_history ✓, tv_logins ✓, preferences ✓, personal_data ✓
    - Turnover tasks: pending / in_progress / completed
- "Initiate Wipe" button on completed reservations

#### Family Management (`/dashboard/family`) — Admin only
- List all family members with agent names, age groups, and active status
- Add/remove family member profiles with agent name and personality configuration
- Permission editor: visual matrix of devices × actions with constraint editing
- Schedule manager: drag-and-drop weekly calendar for bedtime, school hours, quiet time
- Activity feed: real-time log of family member voice commands with permission denial highlights
- Notification center: parental alerts for denials, emergencies, and override attempts
- Spending controls: daily/monthly limits, approved categories, approval queue

#### User Management (`/dashboard/users`) — Admin only
- List all users in tenant: name, email, role, joined date
- Invite new user: email, display name, role (constrained by invoker's role)
- Change user role via dropdown
- Deactivate user (soft-delete with cascade)
- Role hierarchy enforced: owners can manage all roles; admins cannot manage owner/admin

#### Settings (`/dashboard/settings`) — Admin only
- Property name, market vertical, subscription tier
- Device and user limits
- Voice settings toggle (enable/disable each tier)
- Guest wipe toggle (CleverHost only)
- Audit retention days (30–365)

#### Voice Log (`/dashboard/voice-log`)
- Searchable transcript history: timestamp, intent summary, tier used, latency
- Filters: search term, tier dropdown, date range (from/to)
- Metrics: total commands, average latency (color-coded: <200ms green, <500ms blue, <1s amber, >1s red)
- Tier distribution stacked bar chart
- Load-more pagination

#### Audit Log (`/dashboard/audit`) — Admin only
- Table: timestamp, action (color-coded badge), user, details
- Filters: action type dropdown, date range
- Paginated with record count
- RLS enforces tenant isolation

### Components

- **DeviceCard**: Grid card with device state indicator, status dot, category badge, tap-to-toggle
- **DeviceGrid**: Responsive grid layout with optional room grouping and empty state handling
- **Header**: Tenant name, user menu, logout button
- **Sidebar**: Navigation with role-based visibility (guests/residents see fewer links than admins/owners)

### Hooks

| Hook | Provides |
|------|----------|
| `useAuth()` | user, tenant, tenantId, role, permission helpers (isOwner, isAdmin, canManageUsers, canManageDevices, canViewAuditLog), signOut |
| `useDevices(tenantId)` | devices[], rooms[], loading, error, devicesByRoom(), getDevice(), sendCommand(), toggleDevice(), refresh() |
| `useVoiceLog(tenantId)` | transcripts[], loading, totalCount, avgLatencyMs, tierBreakdown[], applyFilters(), loadMore(), hasMore |

### Real-Time Subscriptions

- `devices:tenant:{tenantId}` — live device state updates on dashboard
- `device:{deviceId}` — single device detail page updates
- `device_state_changes` — state history updates
- `audit_logs:tenant:{tenantId}` — live audit log entries

---

## 9. Mobile App (React Native)

### Screens

#### Login Screen
- Email + password authentication via Supabase
- Error handling with user feedback

#### Dashboard Screen
- Real-time device list grouped by room (`SectionList`)
- Summary bar: device count, online count, active count
- Room sections with online/total device counts
- Device cards: category icon, device name, state badge, status dot
- Long-press to toggle device state
- Pull-to-refresh
- Supabase Realtime subscriptions for live updates

#### Device Control Screen
- Single device detail and interactive control
- State display with toggle capability

#### Guest Screen (CleverHost)
- Guest management interface mirroring web dashboard functionality

### Tech Stack
- React Native (Expo or bare workflow)
- Supabase JS SDK for auth and Realtime
- React Navigation (bottom tab + stack navigator)

---

## 10. Guest Lifecycle Management (CleverHost)

### Full Guest Lifecycle

```
Reservation Created → Guest Profile Generated → Check-In Automation
  │                       │                         │
  │                       ├─ Door code assigned      ├─ Doors unlock
  │                       ├─ WiFi password generated ├─ Welcome voice greeting
  │                       └─ Voice preferences set   ├─ AC to comfort temp
  │                                                  └─ Lights on
  │
  ├─ During Stay ─────────────────────────────────────────────────
  │   ├─ Voice concierge (guest mode)
  │   ├─ Device control (limited by guest role)
  │   └─ All interactions logged
  │
  └─ Check-Out → 6-Category Profile Wipe → Turnover Tasks
                    │
                    ├─ 1. Locks: Deactivate guest door code
                    ├─ 2. WiFi: Rotate WiFi password
                    ├─ 3. Voice history: Clear all transcripts & preferences
                    ├─ 4. TV logins: Factory reset smart TV, disconnect streaming
                    ├─ 5. Preferences: Clear guest-created automations & scenes
                    └─ 6. Personal data: Delete guest profile & contact info
```

### Wipe Enforcement

- Triggered automatically at checkout time
- Executed by `guest-profile-wipe` Edge Function
- Each category is independently tracked (can partially complete)
- Audit log entry created for each completed category
- Future: next reservation activation blocked until wipe is fully complete
- On failure: host is alerted with error details

---

## 11. Audit Logging

### Tracked Actions (19 Types)

| Action | Description |
|--------|-------------|
| `device_state_change` | Any device state transition |
| `device_command_issued` | Command sent to a device |
| `user_login` | Successful authentication |
| `user_logout` | Session termination |
| `user_created` | New user added to tenant |
| `user_role_changed` | Role modification |
| `user_deactivated` | User soft-deleted |
| `guest_profile_created` | New guest profile for reservation |
| `guest_profile_wiped` | Guest data wipe completed |
| `voice_command_processed` | Voice command executed |
| `scene_activated` | Scene triggered |
| `scene_created` | New scene defined |
| `settings_changed` | Tenant settings modified |
| `security_alert` | Security-related event |
| `family_permission_denied` | Family member command blocked by permission resolver |
| `family_schedule_triggered` | Schedule restriction activated (bedtime, school hours) |
| `family_emergency_command` | Emergency command executed by any family member |
| `family_override_attempt` | Attempt to override another member's restrictions |
| `family_spending_request` | Spending request from a family member |

### Properties

- **Immutable**: RLS prevents UPDATE/DELETE on `audit_logs` for all user roles
- **Server-timestamped**: `timestamp` uses PostgreSQL `now()` default — never client-provided
- **Tenant-isolated**: RLS filter on `tenant_id`
- **Configurable retention**: 30–365 days per tenant, auto-purge after retention period
- **Fields**: tenant_id, user_id, device_id (optional), voice_session_id (optional), action, details (JSON), ip_address, timestamp

---

## 12. Security Model

### STRIDE Threat Model (24 Identified Threats)

| Category | Key Threats | Mitigations |
|----------|-------------|-------------|
| **Spoofing** | JWT token forgery, device impersonation | HS256 secret, token expiration, scoped JWTs, HA auth |
| **Tampering** | Voice command injection, database manipulation | Confidence threshold, regex validation, RLS, service role restrictions |
| **Repudiation** | Audit log gaps, timestamp manipulation | Database triggers on sensitive tables, server-generated timestamps |
| **Information Disclosure** | Cross-tenant data leaks, transcript exposure, API key leakage | RLS isolation tests, encryption at rest, credential scanning |
| **Denial of Service** | API rate limit bypass, Pi resource exhaustion, voice flooding | Per-user rate limits (60 cmd/min), process limits, wake word filtering, cooldown |
| **Elevation of Privilege** | Role escalation, guest-to-admin, edge function cross-tenant | Role set by JWT only, ephemeral guest tokens, no service role for user requests |

### Automated Security Tests (7 Test Suites)

| Test Suite | What It Verifies |
|------------|-----------------|
| `rls-isolation.test.ts` | Cross-tenant query isolation on all 11 tables (INSERT, SELECT, UPDATE, DELETE) |
| `auth-flow.test.ts` | JWT validation, 401 on missing/invalid auth |
| `rate-limiting.test.ts` | 60 commands/minute per user, 429 response on exceeded |
| `guest-wipe.test.ts` | All 6 wipe categories clear properly, incomplete wipe handling |
| `credential-scan.test.ts` | No hardcoded secrets in codebase, `.env.example` coverage |
| `security.test.ts` | Voice confidence threshold enforcement, command injection prevention, no raw audio storage |
| `family-permissions.test.ts` | Age group × device category × action permission matrix, emergency bypass for all ages, schedule enforcement, constraint clamping, RLS isolation on family tables |

### Network Security

- Cloud ↔ Pi: HTTPS/WSS with TLS 1.2+
- Cloud APIs: Direct endpoints (Deepgram, Groq, Cartesia) — never proxied through OpenRouter for voice
- Home Assistant: Local network only, long-lived token authentication
- Rate limiting: 60 device commands/minute per user

### Security Checklist (9 Sections)

Covers: authentication, authorization, data isolation, API security, device security, voice security, audit logging, network security, and CI/CD pipeline requirements. Every PR must pass all 6 security test suites before merge.

---

## 13. Hardware & Deployment

### Central Hub (Per Property)

| Component | Purpose |
|-----------|---------|
| **Raspberry Pi 5** (8GB RAM) | Main compute |
| **ReSpeaker 4-Mic Array** | Far-field voice capture, direction-of-arrival estimation |
| **Adafruit I2S 3W Bonnet** | I2S audio output via I2C |
| **Powered speakers** (3W+) | Audio output for TTS |
| **Hailo AI HAT+** (40 TOPS, 8GB) | GPU acceleration for local LLM inference (Tier 3) |
| **NVMe SSD** (via M.2 HAT+) | Model storage, Home Assistant database |
| **Active cooling heatsink + fan** | Sustained inference thermal management |
| **12V power supply** | Powers entire stack |

### ESP32-S3 Room Satellite Nodes (~$8 each)

One per room for distributed sensing and voice capture. Connects to Pi hub over WiFi.

| Component | Purpose |
|-----------|---------|
| **ESP32-S3** (dual Xtensa LX7, 8MB PSRAM) | Room-level microcontroller |
| **INMP441 MEMS microphone** | Voice capture for that room |
| **microWakeWord** (on-device, Apache 2.0) | Local wake word detection (<10ms inference, ESPHome native) |
| **ESP-SR MultiNet** (on-device, free) | Offline speech command recognition (up to 200 commands) |
| **ESP-SR AFE** (on-device, free) | Noise suppression, AEC, beamforming, VADNet |
| **Wi-Fi 4 + Bluetooth 5.0** | Audio streaming to Pi + BLE presence scanning |
| **GPIO sensors** | Temperature, humidity, air quality, motion, leak, door/window |
| **Optional TFT/e-ink display** | Room status display |
| **USB-C (5V) or battery** | Power (deep sleep for sensor-only nodes) |

**What satellites do:**
- Run wake word detection locally via microWakeWord — only stream audio to Pi after trigger
- Recognize common commands locally via ESP-SR MultiNet (up to 200 offline commands) and execute HA API calls without Pi involvement
- Process audio with ESP-SR AFE (noise suppression, echo cancellation, beamforming, VADNet)
- BLE scan for room-level occupancy (phones, watches, beacons)
- Read GPIO sensors and report to HA via MQTT or ESPHome native API
- Provide room attribution for voice commands (Pi knows which room spoke)
- Optional: TensorFlow Lite Micro for edge AI (face detection, gesture, anomaly)

**What satellites do NOT do:**
- Run STT, LLM, TTS, or any full voice processing pipeline
- Run Home Assistant, Node.js, or Supabase client
- Store any data locally (stateless sensor/mic endpoints)

**Firmware:** ESPHome YAML configs for zero-code HA integration, or custom ESP-IDF for advanced features (MultiNet command recognition, audio streaming).

### Cost Comparison

| Configuration | Coverage | BOM |
|---|---|---|
| Pi 5 hub only (current) | Voice in 1 room | ~$200–300 |
| Pi 5 hub + 5 ESP32-S3 satellites | Voice + sensors in 6 rooms | ~$240–340 |
| Pi 5 hub + 8 ESP32-S3 satellites | Whole-home coverage | ~$264–364 |

### Software Stack on Pi

| Software | Purpose |
|----------|---------|
| Raspberry Pi OS (Debian) | Base OS |
| Home Assistant (Docker/supervised) | Device management hub |
| Pi Agent (Node.js) | Orchestrator: voice pipeline, HA bridge, Supabase Realtime |
| llama.cpp server | Background service for Tier 3 local LLM inference |
| Faster-Whisper | Tier 3 local STT |
| Piper TTS | Tier 3 local TTS |
| openWakeWord | Pi hub wake word detection (Apache 2.0, Python) |

### Deployment Scripts

- `os-setup.sh` — Base OS configuration, system dependencies
- `ha-install.sh` — Home Assistant installation and configuration
- `voice-install.sh` — Voice pipeline dependencies (models, SDKs)

### Deployment Flow (CleverHome)

1. **Factory image**: Pre-configured Pi OS image with all services installed
2. **Hardware install**: Mount hub during construction (electrical panel or shelf)
3. **Smart device install**: Locks, switches, thermostat, sensors during rough-in/trim-out
4. **HA auto-discovery**: Home Assistant discovers Zigbee/Z-Wave devices
5. **Buyer onboarding**: Welcome email at closing with setup instructions
6. **App access**: Buyer creates Supabase account, connects to dashboard/mobile app
7. **Voice activation**: Buyer says wake word "Clever" to begin

---

## 14. Codebase Organization

### Monorepo Structure (npm workspaces + Turborepo)

```
CleverAutomations/
├── packages/
│   ├── shared/              # Shared TypeScript types, constants & permission engine
│   │   └── src/
│   │       ├── types/       # tenant, device, voice, guest, audit, api, family types
│   │       └── permissions/ # FamilyPermissionResolver, default matrices, denial templates
│   │
│   ├── voice-pipeline/      # Three-tier voice processing
│   │   └── src/
│   │       ├── orchestrator/ # Pipeline entry point, tier router, health checks, wake-word registry
│   │       ├── tier1/        # Rules engine, Picovoice Rhino
│   │       ├── tier2/        # Deepgram STT, Groq LLM, Cartesia TTS
│   │       ├── tier3/        # Faster-Whisper, llama.cpp, Piper TTS
│   │       └── __tests__/    # Latency benchmarks, security tests
│   │
│   ├── ha-bridge/           # Home Assistant integration
│   │   └── src/             # REST client, WebSocket client, device discovery,
│   │                        # command executor, scene executor
│   │
│   ├── pi-agent/            # Raspberry Pi orchestrator
│   │   └── src/
│   │       ├── agent.ts     # Main agent loop, voice input, Realtime integration
│   │       ├── hardware/    # ReSpeaker config, audio output, Hailo config
│   │       └── deploy/      # OS setup, HA install, voice install scripts
│   │
│   ├── esp32-satellite/     # ESP32-S3 room node firmware (Phase 2)
│   │   ├── esphome/         # ESPHome YAML configs per room type
│   │   ├── custom/          # Custom ESPHome components (MultiNet, audio stream)
│   │   └── docs/            # Wiring diagrams, flashing instructions
│   │
│   ├── supabase-backend/    # Cloud backend
│   │   └── src/
│   │       ├── schema/      # SQL table definitions, auth schema
│   │       ├── migrations/  # Migration files (init, portal/CRM, kitchen hub, family subagents)
│   │       ├── rls/         # RLS policy definitions
│   │       ├── edge-functions/ # device-command, guest-profile-wipe, voice-webhook
│   │       ├── realtime/    # Channel setup, state broadcasts
│   │       └── __tests__/   # Auth, RLS isolation, rate limiting, guest wipe,
│   │                        # credential scan tests
│   │
│   ├── web-dashboard/       # Next.js web application
│   │   └── src/
│   │       ├── app/         # Pages (auth, dashboard with 10+ sub-pages)
│   │       ├── components/  # DeviceCard, DeviceGrid, Header, Sidebar
│   │       ├── hooks/       # useAuth, useDevices, useVoiceLog
│   │       ├── lib/         # Supabase clients, auth context, utils
│   │       └── middleware.ts # Auth middleware for route protection
│   │
│   └── mobile-app/          # React Native (Expo) mobile app
│       └── src/
│           ├── screens/     # Login, Dashboard, DeviceControl, Guest
│           └── lib/         # Supabase client
│
├── docs/
│   ├── market/              # Pitch decks (host, builder, apartment),
│   │                        # competitive analysis, feature matrix,
│   │                        # builder/apartment company lists
│   └── security/            # STRIDE threat model, security checklist
│
├── claude.md                # Architecture & security requirements
├── prompt.md                # Agent team setup & Phase 1 build plan
├── turbo.json               # Turborepo build config
├── tsconfig.json             # Base TypeScript config
└── package.json              # Workspace root
```

### Build Commands (Turborepo)

| Command | Purpose |
|---------|---------|
| `npm run build` | Build all packages |
| `npm run dev` | Dev mode (watch all) |
| `npm run test` | Run all tests |
| `npm run lint` | ESLint + Prettier |
| `npm run type-check` | TypeScript strict mode check |
| `npm run security-test` | Run all 6 security test suites |

---

## 15. Roadmap

### Phase 1 (Current)

- Tier 1 rules engine with 30+ patterns
- Tier 2 cloud pipeline (Deepgram, Groq, Cartesia direct APIs)
- Tier 3 local fallback (Faster-Whisper, llama.cpp, Piper)
- Home Assistant REST + WebSocket integration
- Multi-tenant SaaS backend (Supabase + RLS)
- Web dashboard (Next.js, 10+ pages)
- Mobile app (React Native, 4 screens)
- Guest profile wipe for CleverHost
- Complete audit logging
- 6 automated security test suites
- **Family Subagent System**: Named personal agents with age-based permissions (6 age tiers), wake word registry, permission resolver with 6-level priority chain, constraint clamping, schedule system, parental notifications, age-appropriate agent personalities and denial UX
- Kitchen Sub-Hub: ePantry, shopping lists, receipt scanning, pantry photo analysis

### Phase 2 (Planned)

- **ESP32-S3 Room Satellite Nodes** — Distributed wake word (microWakeWord), on-device command recognition (ESP-SR MultiNet, up to 200 commands), mic streaming, BLE presence, and GPIO sensors at ~$8/room. ESPHome configs for zero-code HA integration. Custom ESP-IDF components for MultiNet and audio streaming. Pi Agent audio ingestion interface for multi-room voice. Whole-home coverage for ~$40–64 additional BOM. $0 licensing cost (all open-source/free).
- **TensorFlow Lite Micro on ESP32-S3** — Edge AI for doorbell face detection, gesture recognition, sensor anomaly detection
- **Moshi speech-to-speech** (Kyutai Labs, 160–200ms, CC-BY 4.0) — end-to-end voice without separate TTS, requires cloud GPU
- **Kyutai Pocket TTS** — 100M param CPU-based local TTS (faster than Piper)
- **PMS integration** — Guesty/Hospitable for deeper property management
- **Speaker identification** — Voice biometrics for automatic multi-occupant attribution (Phase 1 uses named agent wake words as a manual workaround)
- **Dynamic pricing advisor** — AI-powered STR pricing suggestions
- **Direct booking integration** — Reduce Airbnb dependency
- **Guest loyalty program** — Repeat guest recognition
- **Certificate pinning** — For cloud API connections
- **Full disk encryption** — Pi firmware tamper protection
