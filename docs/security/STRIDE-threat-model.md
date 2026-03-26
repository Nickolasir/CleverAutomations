# STRIDE Threat Model - CleverHub

**Document Owner:** security-auditor
**Last Updated:** 2026-02-12
**Platform:** AI-Powered Smart Home Butler (CleverHome / CleverHost / CleverBuilding)
**Status:** Active - Review Required Before Each Major Release

---

## Table of Contents

1. [System Overview and Attack Surface](#system-overview-and-attack-surface)
2. [Spoofing](#1-spoofing)
3. [Tampering](#2-tampering)
4. [Repudiation](#3-repudiation)
5. [Information Disclosure](#4-information-disclosure)
6. [Denial of Service](#5-denial-of-service)
7. [Elevation of Privilege](#6-elevation-of-privilege)
8. [Risk Matrix Summary](#risk-matrix-summary)

---

## System Overview and Attack Surface

### Architecture Components

The CleverHub platform consists of five primary attack surface areas:

```
                                CLOUD BOUNDARY
                    +---------------------------------+
                    |                                 |
   [Mobile App] ---+--> [Supabase Backend]            |
                    |     - Auth (JWT + RLS)          |
   [Web Dashboard]-+--> - PostgreSQL + TimescaleDB    |
                    |     - Edge Functions            |
                    |     - Realtime WebSocket        |
                    |     - Storage (encrypted)       |
                    |                                 |
                    |   [Voice Pipeline APIs]         |
                    |     - Deepgram (STT)            |
                    |     - Groq (LLM)               |
                    |     - Cartesia (TTS)            |
                    |     - OpenRouter (non-voice)    |
                    +---------------------------------+
                                   |
                            WAN / Internet
                                   |
                    +---------------------------------+
                    |     LOCAL NETWORK BOUNDARY      |
                    |                                 |
                    |   [Raspberry Pi 5 Device]       |
                    |     - Pi Agent                  |
                    |     - Picovoice (wake word)     |
                    |     - Rhino (intent parsing)    |
                    |     - Faster-Whisper (fallback) |
                    |     - llama.cpp (fallback LLM)  |
                    |     - Piper TTS (fallback)      |
                    |     - ReSpeaker 4-Mic Array     |
                    |     - Hailo AI HAT+             |
                    |                                 |
                    |   [Home Assistant]              |
                    |     - REST/WebSocket API        |
                    |     - Smart Home Devices        |
                    |       (locks, lights, HVAC,     |
                    |        cameras, sensors)        |
                    +---------------------------------+
```

### Attack Surface Inventory

| Surface | Entry Points | Trust Level |
|---------|-------------|-------------|
| **Pi Device** | Physical access, USB, network, microphone, GPIO | Local network trusted, physical untrusted |
| **Cloud Backend** | Supabase REST API, WebSocket, Edge Functions, Storage | Authenticated (JWT) required for all except health check |
| **Voice Pipeline** | Microphone input, STT API, LLM API, TTS API | Varies by tier: Tier 1 local, Tier 2 cloud API keys, Tier 3 local |
| **Mobile App** | React Native app, Supabase SDK | Authenticated user session |
| **Web Dashboard** | Next.js app, Supabase SDK | Authenticated user session (browser) |

---

## 1. Spoofing

### S-01: JWT Token Forgery

| Attribute | Value |
|-----------|-------|
| **Description** | An attacker crafts a JWT with a fake tenant_id or user_role to gain unauthorized access to another tenant's data or escalate their privileges. |
| **Likelihood** | **Low** |
| **Impact** | **High** |
| **Attack Vector** | Network (API requests with forged Authorization header) |
| **Existing Mitigations** | Supabase Auth signs JWTs with HS256 using a server-side secret. RLS policies read tenant_id from `auth.jwt()` claims, not from request body. Token expiration enforced. |
| **Recommended Additional Controls** | (1) Rotate JWT signing secret periodically. (2) Implement token revocation list for compromised tokens. (3) Monitor for unusual JWT patterns (e.g., tokens with future iat timestamps). (4) Consider RS256 asymmetric signing for defense in depth. |

### S-02: Device Impersonation

| Attribute | Value |
|-----------|-------|
| **Description** | An attacker connects a rogue Raspberry Pi or other device to the network, claiming to be an authorized CleverHub hub, and issues commands to smart home devices. |
| **Likelihood** | **Medium** |
| **Impact** | **High** |
| **Attack Vector** | Local network (mDNS/SSDP spoofing, ARP spoofing) |
| **Existing Mitigations** | Each Pi device has a unique scoped JWT token (device_scope claim). Tokens are revocable. Home Assistant requires a long-lived token for API access. |
| **Recommended Additional Controls** | (1) Implement device attestation using TPM or hardware serial numbers. (2) Mutual TLS between Pi devices and cloud backend. (3) Network segmentation (dedicated IoT VLAN). (4) Device heartbeat monitoring with anomaly detection. |

### S-03: Tenant Spoofing via API

| Attribute | Value |
|-----------|-------|
| **Description** | An authenticated user of Tenant A manipulates API requests to include Tenant B's tenant_id in query parameters or request bodies, attempting to access Tenant B's resources. |
| **Likelihood** | **Medium** |
| **Impact** | **High** |
| **Attack Vector** | Network (crafted API requests) |
| **Existing Mitigations** | RLS policies extract tenant_id from `auth.jwt()->>'tenant_id'`, not from request parameters. All database tables enforce tenant isolation at the row level. |
| **Recommended Additional Controls** | (1) Add server-side validation in Edge Functions to reject requests where body tenant_id does not match JWT tenant_id. (2) Automated cross-tenant access testing in CI (see rls-isolation.test.ts). (3) Alert on any RLS policy violation attempts logged by Supabase. |

### S-04: Guest Identity Spoofing

| Attribute | Value |
|-----------|-------|
| **Description** | A previous Airbnb guest retains or fabricates credentials to access the property's smart home system after their reservation ends. |
| **Likelihood** | **Medium** |
| **Impact** | **Medium** |
| **Attack Vector** | Retained WiFi password, door code, or session token |
| **Existing Mitigations** | Guest profile wipe (6 categories) on checkout rotates WiFi password, resets door codes, and revokes access. Guest tokens have expiration tied to checkout time. |
| **Recommended Additional Controls** | (1) Force-disconnect all active sessions for the guest user on checkout. (2) Implement MAC address blocklist after checkout. (3) Alert host if the expired guest profile's door code is attempted. |

---

## 2. Tampering

### T-01: Voice Command Injection

| Attribute | Value |
|-----------|-------|
| **Description** | A malicious or crafted audio input causes the voice pipeline to execute unintended commands, such as unlocking doors or disabling alarms, through carefully constructed speech or ultrasonic injection. |
| **Likelihood** | **Medium** |
| **Impact** | **High** |
| **Attack Vector** | Physical (speaker near microphone), ultrasonic injection |
| **Existing Mitigations** | Intent confidence threshold at 0.7 requires confirmation for low-confidence commands. Tier 1 rules engine uses strict regex matching. Transcript sanitization strips shell/SQL injection patterns. |
| **Recommended Additional Controls** | (1) Implement speaker verification (voice biometrics) to identify authorized users. (2) Add a higher confidence threshold (0.9) for security-sensitive commands (unlock, disarm). (3) Require two-factor confirmation for critical commands (voice + app tap). (4) Ultrasonic injection detection via audio signal analysis. (5) Rate-limit voice commands per device. |

### T-02: Database Manipulation via API

| Attribute | Value |
|-----------|-------|
| **Description** | An attacker exploits a missing or misconfigured RLS policy to directly insert, update, or delete rows in the database, bypassing application logic. |
| **Likelihood** | **Low** |
| **Impact** | **High** |
| **Attack Vector** | Network (direct PostgREST queries) |
| **Existing Mitigations** | RLS policies on every table. All tables require tenant_id. Service role key is never exposed to clients. Supabase client SDK enforces auth. |
| **Recommended Additional Controls** | (1) Automated RLS policy coverage check: every new table must have a corresponding test in rls-isolation.test.ts. (2) Database triggers to prevent tenant_id modification on UPDATE. (3) Immutable audit_logs table (INSERT only, no UPDATE/DELETE for non-service-role). (4) pg_audit extension for database-level audit logging. |

### T-03: Firmware/Software Tampering on Pi Device

| Attribute | Value |
|-----------|-------|
| **Description** | An attacker with physical access to the Raspberry Pi modifies the pi-agent software, voice pipeline binaries, or Home Assistant configuration to install a backdoor or disable security controls. |
| **Likelihood** | **Low** |
| **Impact** | **High** |
| **Attack Vector** | Physical access to Pi device, SD card/NVMe removal |
| **Existing Mitigations** | None currently. Pi devices run standard Raspberry Pi OS. |
| **Recommended Additional Controls** | (1) Full disk encryption on the NVMe SSD (LUKS). (2) Secure Boot configuration (if supported by Pi 5). (3) Read-only root filesystem with overlayfs for runtime data. (4) Integrity monitoring (AIDE or similar) with cloud reporting. (5) Tamper-evident enclosure design. (6) Remote attestation on each cloud connection. |

### T-04: Man-in-the-Middle on Voice API Traffic

| Attribute | Value |
|-----------|-------|
| **Description** | An attacker intercepts the WebSocket connection between the Pi device and Deepgram/Groq/Cartesia APIs to inject modified transcripts or commands. |
| **Likelihood** | **Low** |
| **Impact** | **High** |
| **Attack Vector** | Network (DNS spoofing, TLS interception on local network) |
| **Existing Mitigations** | All Tier 2 cloud APIs use HTTPS/WSS with TLS 1.2+. API keys authenticate the client to the provider. |
| **Recommended Additional Controls** | (1) Certificate pinning for Deepgram, Groq, and Cartesia endpoints. (2) DNS-over-HTTPS on the Pi device. (3) Validate TLS certificate chains in the voice pipeline client. (4) Monitor for unexpected certificate changes. |

---

## 3. Repudiation

### R-01: Audit Log Completeness

| Attribute | Value |
|-----------|-------|
| **Description** | A user or system process performs a security-relevant action (device unlock, guest wipe, settings change) without creating an audit log entry, making it impossible to investigate incidents. |
| **Likelihood** | **Medium** |
| **Impact** | **Medium** |
| **Attack Vector** | Software bug or intentional bypass of audit logging |
| **Existing Mitigations** | AuditAction type enumerates all logged actions. Every device state change is logged per security requirements. Guest wipe creates audit entry. |
| **Recommended Additional Controls** | (1) Database trigger that automatically creates audit_log entries on INSERT/UPDATE/DELETE to sensitive tables (devices, guest_profiles, users). (2) Periodic audit completeness report: compare device_state_changes count with audit_log count. (3) Alert when audit_log INSERT rate drops below expected baseline. (4) Immutable audit log (append-only with RLS). |

### R-02: Timestamp Integrity

| Attribute | Value |
|-----------|-------|
| **Description** | An attacker or buggy client sends audit log entries with falsified timestamps, making forensic analysis unreliable. |
| **Likelihood** | **Low** |
| **Impact** | **Medium** |
| **Attack Vector** | Crafted API request with past/future timestamp |
| **Existing Mitigations** | Audit log entries include a timestamp field. Supabase uses server-side `now()` for created_at columns. |
| **Recommended Additional Controls** | (1) Use PostgreSQL `DEFAULT now()` for audit_logs.timestamp column, ignoring client-provided values. (2) Add a server-generated `server_timestamp` column alongside any client-provided timestamp. (3) NTP synchronization monitoring on Pi devices. (4) Reject audit entries with timestamps more than 30 seconds in the future. |

### R-03: Voice Command Attribution

| Attribute | Value |
|-----------|-------|
| **Description** | A voice command is executed but cannot be attributed to a specific user because multiple people share the same room/device, and no speaker identification is in place. |
| **Likelihood** | **High** |
| **Impact** | **Low** |
| **Attack Vector** | Operational (shared spaces, no voice biometrics) |
| **Existing Mitigations** | Voice sessions record user_id and device_id. Commands are logged with source="voice". |
| **Recommended Additional Controls** | (1) Speaker identification/verification (Phase 2 feature). (2) Log audio fingerprint hash (not raw audio) for non-repudiation. (3) In multi-occupant scenarios, require app confirmation for security-sensitive commands. |

---

## 4. Information Disclosure

### I-01: Cross-Tenant Data Leak

| Attribute | Value |
|-----------|-------|
| **Description** | A bug in RLS policies, Edge Functions, or API queries allows a user from Tenant A to read data belonging to Tenant B, exposing device configurations, guest information, or voice transcripts. |
| **Likelihood** | **Low** |
| **Impact** | **Critical** |
| **Attack Vector** | Software vulnerability (missing WHERE clause, broken RLS) |
| **Existing Mitigations** | RLS policies on every table. tenant_id in JWT claims. Cross-tenant isolation tests (rls-isolation.test.ts) cover all 11 tables. |
| **Recommended Additional Controls** | (1) Run rls-isolation.test.ts in CI on every PR. (2) Add a pre-commit hook that flags any new table without an RLS policy. (3) Quarterly manual penetration test focused on tenant isolation. (4) Supabase database logs alerting on any cross-tenant query patterns. |

### I-02: Voice Transcript Exposure

| Attribute | Value |
|-----------|-------|
| **Description** | Voice transcripts stored in Supabase Storage are accessed without authorization, exposing private conversations, WiFi passwords spoken aloud, or other sensitive content. |
| **Likelihood** | **Low** |
| **Impact** | **High** |
| **Attack Vector** | Storage misconfiguration, broken access control |
| **Existing Mitigations** | Transcripts encrypted at rest (transcript_encrypted field). No raw audio stored. Storage bucket has RLS. Only encrypted transcripts go to cloud. |
| **Recommended Additional Controls** | (1) Per-tenant encryption keys managed in Supabase Vault. (2) Storage bucket policy: only authenticated users with matching tenant_id can access. (3) Automatic transcript deletion after audit_retention_days. (4) Disable direct Storage URL access (signed URLs only with short TTL). |

### I-03: API Key Leakage

| Attribute | Value |
|-----------|-------|
| **Description** | API keys for Deepgram, Groq, Cartesia, OpenRouter, or Home Assistant are accidentally committed to source control, exposed in client-side code, or logged in error messages. |
| **Likelihood** | **Medium** |
| **Impact** | **High** |
| **Attack Vector** | Source code commit, client bundle, error logs |
| **Existing Mitigations** | .gitignore excludes .env files. .env.example uses placeholder values. credential-scan.test.ts scans for hardcoded secrets. |
| **Recommended Additional Controls** | (1) Pre-commit hook running credential scan. (2) GitHub secret scanning alerts enabled. (3) API key rotation schedule (quarterly). (4) Supabase Vault for all production secrets. (5) Error handler that redacts any string matching key patterns before logging. |

### I-04: Guest Personal Data Exposure

| Attribute | Value |
|-----------|-------|
| **Description** | Guest personal data (name, WiFi password, door code, TV login credentials) persists after checkout due to incomplete wipe, or is accessible to the next guest. |
| **Likelihood** | **Medium** |
| **Impact** | **High** |
| **Attack Vector** | Incomplete wipe, database query by next guest |
| **Existing Mitigations** | 6-category guest wipe checklist. Wipe completeness tests (guest-wipe.test.ts). Audit log for every wipe. Guest RLS restricts access to own profile. |
| **Recommended Additional Controls** | (1) Block new reservation activation until previous wipe is confirmed complete. (2) Automated post-wipe verification query that scans for any remaining PII. (3) Guest profile TTL: auto-delete records 24 hours after checkout regardless of wipe status. (4) Alert host on incomplete wipe. |

### I-05: Sensor Telemetry Data Leak

| Attribute | Value |
|-----------|-------|
| **Description** | TimescaleDB sensor telemetry (temperature, motion, energy) reveals occupancy patterns, daily routines, or absence from home to unauthorized parties. |
| **Likelihood** | **Low** |
| **Impact** | **Medium** |
| **Attack Vector** | Cross-tenant query, compromised dashboard session |
| **Existing Mitigations** | Telemetry table has tenant_id and RLS. Dashboard requires authentication. |
| **Recommended Additional Controls** | (1) Data aggregation: expose only hourly/daily averages to non-owner roles. (2) Occupancy data classified as sensitive with stricter access controls. (3) Data retention policy with automatic purge after configured period. |

---

## 5. Denial of Service

### D-01: API Rate Limiting Bypass

| Attribute | Value |
|-----------|-------|
| **Description** | An attacker floods the device command endpoint with rapid requests, overwhelming the backend, Home Assistant, or the physical device, causing service unavailability. |
| **Likelihood** | **Medium** |
| **Impact** | **Medium** |
| **Attack Vector** | Network (automated API requests) |
| **Existing Mitigations** | Rate limiting on device command endpoints: 60 commands/minute per user. Rate limit tests (rate-limiting.test.ts) verify enforcement. |
| **Recommended Additional Controls** | (1) Global rate limit in addition to per-user (protect infrastructure). (2) Rate limiting at the Supabase Edge Function level AND at the CDN/WAF level. (3) Exponential backoff response headers. (4) Separate rate limit tiers for different command criticality levels. (5) IP-based rate limiting as a secondary defense. |

### D-02: Resource Exhaustion on Pi Device

| Attribute | Value |
|-----------|-------|
| **Description** | Continuous voice input, rapid command sequences, or a runaway LLM process exhausts the Pi 5's CPU, RAM, or disk, causing the device to become unresponsive. |
| **Likelihood** | **Medium** |
| **Impact** | **Medium** |
| **Attack Vector** | Physical (continuous speech near mic), network (rapid commands) |
| **Existing Mitigations** | Tier routing: 70% handled by lightweight rules engine. Local LLM uses quantized models (Q4_K_M) with bounded memory. Active cooling on Pi. |
| **Recommended Additional Controls** | (1) Process limits (cgroups) for voice pipeline and LLM processes. (2) Watchdog timer that restarts the pi-agent if unresponsive. (3) Voice pipeline cooldown: minimum 500ms between command processing starts. (4) Disk usage monitoring with alerts. (5) OOM killer configuration to protect core system services. |

### D-03: Voice Pipeline Flooding

| Attribute | Value |
|-----------|-------|
| **Description** | An attacker plays continuous audio (radio, TV, adversarial audio) near the microphone to keep the voice pipeline in constant processing mode, preventing legitimate commands from being processed. |
| **Likelihood** | **Medium** |
| **Impact** | **Low** |
| **Attack Vector** | Physical (audio source near microphone) |
| **Existing Mitigations** | Wake word detection (Picovoice Porcupine) filters non-wake-word audio. Tier 1 rules engine rejects non-matching transcripts quickly. |
| **Recommended Additional Controls** | (1) Maximum session duration timeout (e.g., 30 seconds). (2) Cooldown period after consecutive failed wake word detections. (3) Ambient noise level monitoring: pause processing if sustained noise exceeds threshold. (4) Alert tenant owner if device is in continuous processing mode. |

### D-04: Cloud API Dependency Failure

| Attribute | Value |
|-----------|-------|
| **Description** | One or more cloud APIs (Deepgram, Groq, Cartesia) become unavailable, causing the Tier 2 voice pipeline to fail and degrading user experience. |
| **Likelihood** | **High** |
| **Impact** | **Medium** |
| **Attack Vector** | External service outage (not attacker-controlled) |
| **Existing Mitigations** | Tier 3 local fallback exists for offline operation. OpenRouter configured as LLM fallback. Three-tier architecture degrades gracefully. |
| **Recommended Additional Controls** | (1) Circuit breaker pattern on each API client with automatic fallback. (2) Health check pings to each API every 30 seconds. (3) Latency monitoring with automatic tier downgrade if API response time exceeds 2x normal. (4) Local cache of recent device states for offline command execution. |

---

## 6. Elevation of Privilege

### E-01: Role Escalation within Tenant

| Attribute | Value |
|-----------|-------|
| **Description** | A user with "resident" or "manager" role exploits a vulnerability to escalate to "admin" or "owner" role, gaining access to user management, audit logs, and tenant settings. |
| **Likelihood** | **Low** |
| **Impact** | **High** |
| **Attack Vector** | API manipulation (role parameter in requests), JWT tampering |
| **Existing Mitigations** | User role is set in JWT app_metadata by server-side auth hooks. RLS policies check `auth.jwt()->>'user_role'`. Role modification requires owner or admin JWT. |
| **Recommended Additional Controls** | (1) Database trigger preventing role UPDATE to "owner" unless performer is current owner. (2) Role change audit log entry required for every role modification. (3) Two-factor authentication for role escalation operations. (4) Maximum privilege per role strictly defined and tested. |

### E-02: Guest-to-Admin Escalation

| Attribute | Value |
|-----------|-------|
| **Description** | An Airbnb guest exploits their limited access to escalate to admin or owner role, gaining control over the property's smart home system, including security cameras and door locks. |
| **Likelihood** | **Low** |
| **Impact** | **Critical** |
| **Attack Vector** | API manipulation, JWT tampering, voice command exploitation |
| **Existing Mitigations** | Guest role has minimal RLS permissions (own profile only). Guest JWT tokens expire at checkout. Guest cannot read devices, users, or audit logs. |
| **Recommended Additional Controls** | (1) Guest tokens should have a separate JWT signing context or issuer. (2) Guest user_id should be ephemeral (not linked to persistent auth accounts). (3) Guest accounts auto-deleted after reservation completion. (4) Monitor for guest role attempting admin-level operations (alert and block). |

### E-03: Cross-Tenant Access via Edge Function

| Attribute | Value |
|-----------|-------|
| **Description** | An Edge Function contains a logic bug that uses the service role key for database queries without properly filtering by tenant_id, allowing a request from Tenant A to access or modify Tenant B's data. |
| **Likelihood** | **Medium** |
| **Impact** | **Critical** |
| **Attack Vector** | Software vulnerability in Edge Function code |
| **Existing Mitigations** | Code review process. RLS policies as defense-in-depth even if Edge Function uses service role. |
| **Recommended Additional Controls** | (1) Edge Functions should NEVER use service role key for user-facing operations. (2) Lint rule that flags any use of `SUPABASE_SERVICE_ROLE_KEY` in Edge Functions. (3) All Edge Functions must extract tenant_id from JWT and include it in every query. (4) Integration tests that verify Edge Functions cannot leak cross-tenant data. |

### E-04: Home Assistant API Abuse

| Attribute | Value |
|-----------|-------|
| **Description** | An attacker who gains access to the Home Assistant long-lived token can control all smart home devices directly, bypassing all application-level security controls (RLS, rate limiting, audit logging). |
| **Likelihood** | **Low** |
| **Impact** | **Critical** |
| **Attack Vector** | Token theft from Pi device, environment variable exposure |
| **Existing Mitigations** | HA token stored as environment variable, not in code. Pi device is on local network. |
| **Recommended Additional Controls** | (1) Use short-lived HA tokens with automatic refresh. (2) HA token stored in encrypted file on Pi, loaded at runtime. (3) Home Assistant access restricted by IP (only the Pi's IP). (4) HA API audit logging enabled. (5) Separate HA users per device with scoped permissions. |

---

## Risk Matrix Summary

| ID | Threat | Category | Likelihood | Impact | Risk Level |
|----|--------|----------|------------|--------|------------|
| S-01 | JWT Token Forgery | Spoofing | L | H | **Medium** |
| S-02 | Device Impersonation | Spoofing | M | H | **High** |
| S-03 | Tenant Spoofing via API | Spoofing | M | H | **High** |
| S-04 | Guest Identity Spoofing | Spoofing | M | M | **Medium** |
| T-01 | Voice Command Injection | Tampering | M | H | **High** |
| T-02 | Database Manipulation | Tampering | L | H | **Medium** |
| T-03 | Firmware Tampering | Tampering | L | H | **Medium** |
| T-04 | MitM on Voice APIs | Tampering | L | H | **Medium** |
| R-01 | Audit Log Completeness | Repudiation | M | M | **Medium** |
| R-02 | Timestamp Integrity | Repudiation | L | M | **Low** |
| R-03 | Voice Command Attribution | Repudiation | H | L | **Medium** |
| I-01 | Cross-Tenant Data Leak | Info Disclosure | L | C | **High** |
| I-02 | Voice Transcript Exposure | Info Disclosure | L | H | **Medium** |
| I-03 | API Key Leakage | Info Disclosure | M | H | **High** |
| I-04 | Guest Personal Data Exposure | Info Disclosure | M | H | **High** |
| I-05 | Sensor Telemetry Leak | Info Disclosure | L | M | **Low** |
| D-01 | Rate Limiting Bypass | DoS | M | M | **Medium** |
| D-02 | Pi Resource Exhaustion | DoS | M | M | **Medium** |
| D-03 | Voice Pipeline Flooding | DoS | M | L | **Low** |
| D-04 | Cloud API Dependency Failure | DoS | H | M | **High** |
| E-01 | Role Escalation | EoP | L | H | **Medium** |
| E-02 | Guest-to-Admin Escalation | EoP | L | C | **High** |
| E-03 | Cross-Tenant via Edge Function | EoP | M | C | **Critical** |
| E-04 | Home Assistant API Abuse | EoP | L | C | **High** |

### Risk Level Legend

- **Critical** (Likelihood M+ and Impact C): Immediate remediation required
- **High** (Likelihood M and Impact H, or Likelihood L and Impact C): Remediation in current sprint
- **Medium**: Remediation in next 2 sprints
- **Low**: Track and address in backlog

### Priority Actions (Top 5)

1. **E-03**: Enforce no-service-role-key rule in Edge Functions with lint check and integration tests
2. **I-01**: Run cross-tenant isolation tests (rls-isolation.test.ts) in CI on every PR
3. **I-04**: Implement post-wipe verification and block new reservation on incomplete wipe
4. **T-01**: Add higher confidence threshold (0.9) for security-sensitive commands (unlock, disarm)
5. **S-02**: Implement device attestation and mutual TLS for Pi device authentication
