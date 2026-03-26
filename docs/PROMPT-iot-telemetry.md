# Reusable Prompt: IoT Telemetry Local Storage + Cloud Sync

Copy and paste this into a new conversation when working in the CleverHub folder.

---

## Prompt

```
I'm working on the CleverHub project (CleverHub smart home system). I need you to implement the IoT telemetry data layer for the Pi hub.

### Context
- The Pi hub (Raspberry Pi 5, 8GB RAM) collects sensor readings from itself and 4 ESP32-S3 satellite nodes
- Sensors per node: temperature/humidity (SHT40), ambient light (BH1750), mmWave presence (LD2410C), air quality/VOC (ENS160)
- That's ~5 metrics x 5 nodes = 25 data points per reading cycle
- Readings come in at ~1/minute per sensor (configurable)

### Architecture Decision (already agreed upon)
We're using a TWO-TIER telemetry strategy:

**Local tier (Pi hub — SQLite):**
- Store ALL raw sensor readings in SQLite on the Pi
- Use WAL mode for concurrent read/write
- Retention: 7-30 days (configurable per tenant settings)
- Tables: `sensor_readings` (time, node_id, metric, value, unit)
- This is the source of truth for real-time local automations
- Must work fully offline
- Lightweight — SQLite uses negligible RAM vs the 8GB available

**Cloud tier (Supabase — TimescaleDB hypertable):**
- The `sensor_telemetry` table already exists in Supabase (see packages/supabase-backend/src/schema/tables.sql)
- Pi syncs AGGREGATED rollups to cloud periodically (every 5 min or hourly)
- Rollups: min, max, avg, count per metric per device per interval
- Sync via Supabase client SDK (authenticated as the device/tenant)
- If offline, queue rollups locally and batch-sync when connection restores

### What to build
1. **SQLite schema + manager** in `packages/pi-agent/src/telemetry/` — TypeScript using better-sqlite3
   - `createTelemetryDb()` — initializes SQLite with WAL mode
   - `insertReading(nodeId, metric, value, unit)` — write a sensor reading
   - `queryRecent(nodeId, metric, minutes)` — for local automations
   - `pruneOldReadings(retentionDays)` — cleanup job

2. **Cloud sync service** in `packages/pi-agent/src/telemetry/cloud-sync.ts`
   - `computeRollup(startTime, endTime)` — aggregate local readings
   - `syncToSupabase(rollups)` — upsert into cloud sensor_telemetry table
   - `SyncScheduler` class — runs on interval, handles offline queue

3. **Types** in `packages/shared/src/types/telemetry.ts`
   - `SensorReading`, `TelemetryRollup`, `SyncStatus` interfaces

### Constraints
- TypeScript strict mode
- No `any` types
- SQLite path should be configurable (default: /data/telemetry.db)
- All Supabase operations through the client SDK, never raw SQL
- The cloud sync must be resilient to network failures (queue + retry)
- Keep it simple — no over-engineering
```
