Read CLAUDE.md first, then create an agent team with 6 teammates and execute the full Phase 1 build plan below. You are the Team Lead. Coordinate all agents, resolve conflicts, and run integration checkpoints.

Create these 6 teammates:

1. backend-architect (Sonnet)
Design and build the Supabase backend. Start IMMEDIATELY with the shared TypeScript types in packages/shared/types/ since every other agent is blocked until those exist. Then: multi-tenant database schema with tenant_id + RLS on every table, JWT auth flow with custom claims (tenant_id, user_role, device_scope), Edge Functions for voice-webhook and device-command and guest-profile-wipe, Realtime channel setup for device state and presence, database migrations and dev seed data. All work goes in packages/supabase-backend/ and packages/shared/.

2. voice-engineer (Sonnet)
Build the streaming voice pipeline in packages/voice-pipeline/. Wait for backend-architect to finish shared types, then: integrate openWakeWord for Pi hub wake word detection (Python, Apache 2.0), build Deepgram Nova-3 streaming STT client using their DIRECT WebSocket API (NOT through OpenRouter), build Groq DIRECT API streaming LLM client (target ~200ms TTFT), build Cartesia Sonic 3 DIRECT API streaming TTS client (target ~100ms first audio), implement Tier 1 rules engine using regex pattern matching on STT transcripts for common smart home commands that bypasses the LLM entirely (ESP32-S3 satellites handle the most common commands locally via ESP-SR MultiNet before audio even reaches the Pi), implement Tier 3 local fallback with llama.cpp + Qwen2.5 1.5B Q4_K_M + Faster-Whisper + Piper TTS, build the pipeline orchestrator that chains all stages with streaming overlap so TTS starts before LLM finishes, write latency benchmark tests that assert Tier 2 end-to-end < 1 second, implement OpenRouter fallback that only activates if Groq goes down.

3. ha-integrator (Sonnet)
Set up Home Assistant integration in packages/ha-bridge/, packages/pi-agent/, and packages/esp32-satellite/. Start with Docker config for HA in dev. Build a TypeScript client wrapping HA REST API for device control (lights, locks, thermostats, scenes). Build a WebSocket client for real-time device state subscriptions. Implement device auto-discovery that maps HA entities to our Supabase device table. Build the command executor that receives parsed intents from the voice pipeline and translates them to HA service calls (depends on voice-engineer finishing the pipeline orchestrator interface). Create automation scene definitions (Good Morning, Good Night, Away, Guest Welcome). Write Raspberry Pi deployment scripts: OS image prep, HA install, voice pipeline install, auto-start services. Write hardware config scripts for ReSpeaker mic array, I2S audio bonnet, and Hailo HAT+ driver setup. For Phase 2 prep: design the Pi Agent audio ingestion interface to accept WiFi audio streams from multiple ESP32-S3 satellite nodes, and scaffold packages/esp32-satellite/ with ESPHome YAML configs for room nodes (INMP441 mic, BLE presence scanner, GPIO sensors). The ESP32-S3 satellites run microWakeWord (Apache 2.0, ESPHome native, <10ms inference) for wake word and ESP-SR MultiNet (free, up to 200 offline commands) for on-device command recognition. Common commands (lights, locks, temp, scenes) are handled directly on the satellite via MultiNet + HA API call. Complex/ambiguous commands stream audio to the Pi hub for Tier 2/3 processing. Satellites never run STT, LLM, or TTS. Do NOT use Picovoice (proprietary, $899/mo commercial licensing).

4. frontend-dev (Sonnet)
Build the web dashboard and mobile app. Wait for backend-architect to finish auth flow, Realtime channels, and shared types, then: scaffold Next.js web dashboard in packages/web-dashboard/ with Supabase Auth, build tenant admin views (property management, device list, user CRUD), build real-time device dashboard showing live device states via Supabase Realtime subscriptions, build voice command log viewer with searchable transcript history, scaffold React Native mobile app in packages/mobile-app/ with Supabase Auth, build mobile device control UI with room-based layout and tap-to-toggle controls, implement white-label theming support for builder sub-brand, build the CleverHost view: guest access management, turnover checklist, reservation calendar.

5. security-auditor (Sonnet)
Continuous security review across all packages. Start immediately by reviewing CLAUDE.md security requirements and creating a security test framework. As other agents commit code: audit every RLS policy with cross-tenant access tests, review auth flow for JWT handling and token refresh vulnerabilities, audit voice pipeline for command injection and confidence threshold enforcement, verify all API routes require authentication and have rate limiting, check for credential leaks (API keys in code, missing .gitignore entries), audit the guest profile wipe for completeness (locks, WiFi, voice, TV, data), write an automated security test suite, produce a STRIDE threat model document for the smart home attack surface. Message any agent directly when you find a vulnerability. If critical (credential leak, auth bypass), broadcast to all agents immediately.

6. market-researcher (Haiku)
Market research and pitch materials in docs/market/. No dependencies, start immediately. Compile a detailed Harris County builder prospect list: 100+ builders with name, website, type (volume/custom/regional), community count, and price range. Build an Airbnb host feature matrix mapping every CleverHost feature to the API capability of Guesty, Hospitable, and OwnerRez. Identify the top 20 Houston apartment property management companies with unit counts and amenity offerings. Write competitive analysis of Brilliant, Josh.ai, and Control4 on features, pricing, and positioning. Draft pitch deck content for each vertical (builder, Airbnb, apartment) with specific ROI calculations. Verify domain availability for cleverhub.space/.io/.ai and check USPTO for trademark conflicts.

Execution rules:

- backend-architect starts FIRST and ships packages/shared/types/ within the first work session. Everything else is blocked on this.
- market-researcher and security-auditor start immediately in parallel (no dependencies).
- voice-engineer, ha-integrator, and frontend-dev start as soon as shared types are ready.
- ha-integrator's command executor (H5) waits for voice-engineer's pipeline orchestrator interface.
- All agents must respect file ownership in CLAUDE.md. Message the owner before touching their files.
- When passing interfaces between agents, the producer writes the TypeScript interface in shared/types/ and messages the consumer to confirm before they build against it.
- security-auditor has read access to everything and messages agents directly about vulnerabilities.

Integration checkpoints (Team Lead runs these):

- Checkpoint 1 (after shared types ship): All agents confirm they can import from packages/shared/types/. Run npm run build across the monorepo.
- Checkpoint 2 (after voice pipeline + HA bridge basics): Voice pipeline produces parsed intents, HA bridge can execute a device command. Run a manual end-to-end test.
- Checkpoint 3 (after frontend connects): Dashboard authenticates, shows live device state, voice log viewer works. Run npm run test across all packages.
- Checkpoint 4 (full integration): Speak a command -> transcribe -> process -> execute on HA -> respond with voice. Measure latency. Run security test suite.
- Checkpoint 5 (Phase 2 prep — ESP32-S3 satellites): Verify packages/esp32-satellite/ is scaffolded with ESPHome configs. Verify Pi Agent has an audio ingestion interface that can accept streams from multiple rooms. Verify shared types include SatelliteNode, RoomAttribution, and PresenceEvent types. This is design-only — no firmware flashing or physical hardware required yet.

Go.
