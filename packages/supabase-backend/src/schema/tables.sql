-- =============================================================================
-- Clever Automations - Complete PostgreSQL Schema
-- =============================================================================
-- Security-first multi-tenant schema. Every table has tenant_id for RLS.
-- TimescaleDB for sensor telemetry, pgcrypto for encryption, uuid-ossp for PKs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "timescaledb" CASCADE;

-- ---------------------------------------------------------------------------
-- Custom ENUM types
-- ---------------------------------------------------------------------------
CREATE TYPE market_vertical AS ENUM ('clever_home', 'clever_host', 'clever_building');
CREATE TYPE subscription_tier AS ENUM ('starter', 'professional', 'enterprise');
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'manager', 'resident', 'guest');
CREATE TYPE device_category AS ENUM (
  'light', 'lock', 'thermostat', 'switch', 'sensor',
  'camera', 'cover', 'media_player', 'climate', 'fan'
);
CREATE TYPE device_state AS ENUM ('on', 'off', 'locked', 'unlocked', 'unknown');
CREATE TYPE voice_tier AS ENUM ('tier1_rules', 'tier2_cloud', 'tier3_local');
CREATE TYPE voice_session_status AS ENUM ('processing', 'completed', 'failed', 'confirmation_required');
CREATE TYPE reservation_status AS ENUM ('upcoming', 'active', 'completed', 'cancelled');
CREATE TYPE reservation_platform AS ENUM ('airbnb', 'vrbo', 'direct', 'other');
CREATE TYPE scene_trigger AS ENUM ('manual', 'schedule', 'voice', 'geofence');

CREATE TYPE audit_action AS ENUM (
  'device_state_change', 'device_command_issued',
  'user_login', 'user_logout',
  'guest_profile_created', 'guest_profile_wiped',
  'scene_activated', 'automation_triggered',
  'voice_command_processed', 'settings_changed',
  'user_created', 'user_deleted',
  'device_registered', 'device_removed'
);

-- ---------------------------------------------------------------------------
-- 1. tenants
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  vertical    market_vertical NOT NULL,
  subscription_tier subscription_tier NOT NULL DEFAULT 'starter',
  settings    JSONB NOT NULL DEFAULT '{
    "voice_enabled": true,
    "max_devices": 50,
    "max_users": 10,
    "guest_wipe_enabled": true,
    "audit_retention_days": 90
  }'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tenants has tenant_id = id (self-referencing for RLS consistency)
-- We add a computed column alias via a view or just use id directly in RLS.
-- For consistency with the "every table has tenant_id" rule, we add it:
ALTER TABLE tenants ADD COLUMN tenant_id UUID GENERATED ALWAYS AS (id) STORED;

CREATE INDEX idx_tenants_tenant_id ON tenants (tenant_id);
CREATE INDEX idx_tenants_vertical ON tenants (vertical);

-- ---------------------------------------------------------------------------
-- 2. users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         user_role NOT NULL DEFAULT 'resident',
  display_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_users_email_per_tenant UNIQUE (tenant_id, email)
);

CREATE INDEX idx_users_tenant_id ON users (tenant_id);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_tenant_role ON users (tenant_id, role);

-- ---------------------------------------------------------------------------
-- 3. rooms
-- ---------------------------------------------------------------------------
CREATE TABLE rooms (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  floor      TEXT NOT NULL DEFAULT '1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rooms_tenant_id ON rooms (tenant_id);
CREATE INDEX idx_rooms_tenant_floor ON rooms (tenant_id, floor);

-- ---------------------------------------------------------------------------
-- 4. devices
-- ---------------------------------------------------------------------------
CREATE TABLE devices (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ha_entity_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  category      device_category NOT NULL,
  room          TEXT NOT NULL,
  floor         TEXT NOT NULL DEFAULT '1',
  state         device_state NOT NULL DEFAULT 'unknown',
  attributes    JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_online     BOOLEAN NOT NULL DEFAULT false,
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_devices_ha_entity_per_tenant UNIQUE (tenant_id, ha_entity_id)
);

CREATE INDEX idx_devices_tenant_id ON devices (tenant_id);
CREATE INDEX idx_devices_tenant_category ON devices (tenant_id, category);
CREATE INDEX idx_devices_tenant_room ON devices (tenant_id, room);
CREATE INDEX idx_devices_tenant_state ON devices (tenant_id, state);
CREATE INDEX idx_devices_ha_entity ON devices (ha_entity_id);

-- ---------------------------------------------------------------------------
-- 5. scenes
-- ---------------------------------------------------------------------------
CREATE TABLE scenes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  actions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  trigger     scene_trigger,
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenes_tenant_id ON scenes (tenant_id);
CREATE INDEX idx_scenes_created_by ON scenes (created_by);

-- ---------------------------------------------------------------------------
-- 6. voice_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE voice_sessions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id             UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tier                  voice_tier NOT NULL,
  transcript_encrypted  TEXT NOT NULL,
  parsed_intent         JSONB,
  response_text         TEXT NOT NULL DEFAULT '',
  stages                JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_latency_ms      INTEGER NOT NULL DEFAULT 0,
  confidence            NUMERIC(4,3) NOT NULL DEFAULT 0.0,
  status                voice_session_status NOT NULL DEFAULT 'processing',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_voice_sessions_tenant_id ON voice_sessions (tenant_id);
CREATE INDEX idx_voice_sessions_user_id ON voice_sessions (user_id);
CREATE INDEX idx_voice_sessions_device_id ON voice_sessions (device_id);
CREATE INDEX idx_voice_sessions_tenant_status ON voice_sessions (tenant_id, status);
CREATE INDEX idx_voice_sessions_tenant_created ON voice_sessions (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. voice_transcripts
-- ---------------------------------------------------------------------------
CREATE TABLE voice_transcripts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id            UUID NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transcript_encrypted  TEXT NOT NULL,
  intent_summary        TEXT NOT NULL DEFAULT '',
  tier_used             voice_tier NOT NULL,
  latency_ms            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_voice_transcripts_tenant_id ON voice_transcripts (tenant_id);
CREATE INDEX idx_voice_transcripts_session_id ON voice_transcripts (session_id);
CREATE INDEX idx_voice_transcripts_user_id ON voice_transcripts (user_id);
CREATE INDEX idx_voice_transcripts_tenant_created ON voice_transcripts (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 8. audit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id          UUID,
  device_id        UUID,
  voice_session_id UUID,
  action           audit_action NOT NULL,
  details          JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address       INET,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_tenant_id ON audit_logs (tenant_id);
CREATE INDEX idx_audit_logs_tenant_action ON audit_logs (tenant_id, action);
CREATE INDEX idx_audit_logs_tenant_timestamp ON audit_logs (tenant_id, timestamp DESC);
CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX idx_audit_logs_device_id ON audit_logs (device_id);
CREATE INDEX idx_audit_logs_voice_session ON audit_logs (voice_session_id);

-- ---------------------------------------------------------------------------
-- 9. sensor_telemetry (TimescaleDB hypertable)
-- ---------------------------------------------------------------------------
CREATE TABLE sensor_telemetry (
  time       TIMESTAMPTZ NOT NULL,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  metric     TEXT NOT NULL,
  value      NUMERIC NOT NULL,
  unit       TEXT NOT NULL
);

-- Convert to TimescaleDB hypertable partitioned on time
SELECT create_hypertable('sensor_telemetry', 'time');

CREATE INDEX idx_sensor_telemetry_tenant_id ON sensor_telemetry (tenant_id, time DESC);
CREATE INDEX idx_sensor_telemetry_device_id ON sensor_telemetry (device_id, time DESC);
CREATE INDEX idx_sensor_telemetry_tenant_device_metric ON sensor_telemetry (tenant_id, device_id, metric, time DESC);

-- ---------------------------------------------------------------------------
-- 10. reservations
-- ---------------------------------------------------------------------------
CREATE TABLE reservations (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id              TEXT NOT NULL,
  guest_profile_id         UUID,  -- FK added after guest_profiles table creation
  platform                 reservation_platform NOT NULL DEFAULT 'direct',
  external_reservation_id  TEXT,
  check_in                 TIMESTAMPTZ NOT NULL,
  check_out                TIMESTAMPTZ NOT NULL,
  guest_count              INTEGER NOT NULL DEFAULT 1 CHECK (guest_count > 0),
  status                   reservation_status NOT NULL DEFAULT 'upcoming',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reservations_tenant_id ON reservations (tenant_id);
CREATE INDEX idx_reservations_tenant_status ON reservations (tenant_id, status);
CREATE INDEX idx_reservations_tenant_property ON reservations (tenant_id, property_id);
CREATE INDEX idx_reservations_checkout ON reservations (check_out);
CREATE INDEX idx_reservations_external_id ON reservations (external_reservation_id) WHERE external_reservation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 11. guest_profiles
-- ---------------------------------------------------------------------------
CREATE TABLE guest_profiles (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reservation_id           UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  display_name             TEXT NOT NULL,
  wifi_password_encrypted  TEXT,
  door_code_encrypted      TEXT,
  voice_preferences        JSONB NOT NULL DEFAULT '{}'::jsonb,
  tv_logins_encrypted      JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_preferences       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at               TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_guest_profiles_tenant_id ON guest_profiles (tenant_id);
CREATE INDEX idx_guest_profiles_reservation_id ON guest_profiles (reservation_id);
CREATE INDEX idx_guest_profiles_expires ON guest_profiles (expires_at);

-- Add the FK from reservations -> guest_profiles now that both tables exist
ALTER TABLE reservations
  ADD CONSTRAINT fk_reservations_guest_profile
  FOREIGN KEY (guest_profile_id) REFERENCES guest_profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 12. guest_wipe_checklists
-- ---------------------------------------------------------------------------
CREATE TABLE guest_wipe_checklists (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id  UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  items           JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  is_complete     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_guest_wipe_checklists_tenant_id ON guest_wipe_checklists (tenant_id);
CREATE INDEX idx_guest_wipe_checklists_reservation_id ON guest_wipe_checklists (reservation_id);
CREATE INDEX idx_guest_wipe_checklists_incomplete ON guest_wipe_checklists (tenant_id) WHERE NOT is_complete;

-- ---------------------------------------------------------------------------
-- 13. device_commands (queued commands from frontend / API)
-- ---------------------------------------------------------------------------
CREATE TABLE device_commands (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  parameters      JSONB NOT NULL DEFAULT '{}'::jsonb,
  source          TEXT NOT NULL DEFAULT 'dashboard',
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'completed', 'failed')),
  result          JSONB,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at     TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_device_commands_tenant_id ON device_commands (tenant_id);
CREATE INDEX idx_device_commands_device_id ON device_commands (device_id);
CREATE INDEX idx_device_commands_user_id ON device_commands (user_id);
CREATE INDEX idx_device_commands_tenant_status ON device_commands (tenant_id, status);
CREATE INDEX idx_device_commands_tenant_created ON device_commands (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Timestamp auto-update trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'tenants', 'users', 'rooms', 'devices', 'scenes',
      'voice_sessions', 'voice_transcripts', 'reservations',
      'guest_wipe_checklists'
    ])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW
       EXECUTE FUNCTION update_updated_at_column()',
      tbl, tbl
    );
  END LOOP;
END;
$$;
