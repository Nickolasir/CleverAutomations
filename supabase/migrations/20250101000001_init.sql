-- =============================================================================
-- Clever Automations - Migration 001: Initial Schema (Supabase-compatible)
-- =============================================================================
-- Combined migration: schema + RLS + auth.
-- Idempotent where possible (IF NOT EXISTS, OR REPLACE).
-- Run order: Extensions -> ENUMs -> Tables -> Indexes -> Triggers -> RLS -> Auth
-- =============================================================================

BEGIN;

-- ===========================================================================
-- PART 1: EXTENSIONS
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- TimescaleDB not available on Supabase hosted; skipped.
-- sensor_telemetry works as a normal table.

-- ===========================================================================
-- PART 2: CUSTOM ENUM TYPES
-- ===========================================================================

DO $$ BEGIN
  CREATE TYPE market_vertical AS ENUM ('clever_home', 'clever_host', 'clever_building');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE subscription_tier AS ENUM ('starter', 'professional', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('owner', 'admin', 'manager', 'resident', 'guest');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE device_category AS ENUM (
    'light', 'lock', 'thermostat', 'switch', 'sensor',
    'camera', 'cover', 'media_player', 'climate', 'fan'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE device_state AS ENUM ('on', 'off', 'locked', 'unlocked', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE voice_tier AS ENUM ('tier1_rules', 'tier2_cloud', 'tier3_local');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE voice_session_status AS ENUM ('processing', 'completed', 'failed', 'confirmation_required');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reservation_status AS ENUM ('upcoming', 'active', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reservation_platform AS ENUM ('airbnb', 'vrbo', 'direct', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE scene_trigger AS ENUM ('manual', 'schedule', 'voice', 'geofence');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE audit_action AS ENUM (
    'device_state_change', 'device_command_issued',
    'user_login', 'user_logout',
    'guest_profile_created', 'guest_profile_wiped',
    'scene_activated', 'automation_triggered',
    'voice_command_processed', 'settings_changed',
    'user_created', 'user_deleted',
    'device_registered', 'device_removed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================================================
-- PART 3: TABLES
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. tenants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
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

-- tenant_id computed column for RLS consistency
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tenant_id UUID GENERATED ALWAYS AS (id) STORED;

CREATE INDEX IF NOT EXISTS idx_tenants_tenant_id ON tenants (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_vertical ON tenants (vertical);

-- ---------------------------------------------------------------------------
-- 2. users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         user_role NOT NULL DEFAULT 'resident',
  display_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_users_email_per_tenant UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_tenant_role ON users (tenant_id, role);

-- ---------------------------------------------------------------------------
-- 3. rooms
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  floor      TEXT NOT NULL DEFAULT '1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rooms_tenant_id ON rooms (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rooms_tenant_floor ON rooms (tenant_id, floor);

-- ---------------------------------------------------------------------------
-- 4. devices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
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

CREATE INDEX IF NOT EXISTS idx_devices_tenant_id ON devices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_devices_tenant_category ON devices (tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_devices_tenant_room ON devices (tenant_id, room);
CREATE INDEX IF NOT EXISTS idx_devices_tenant_state ON devices (tenant_id, state);
CREATE INDEX IF NOT EXISTS idx_devices_ha_entity ON devices (ha_entity_id);

-- ---------------------------------------------------------------------------
-- 5. scenes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scenes (
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

CREATE INDEX IF NOT EXISTS idx_scenes_tenant_id ON scenes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_scenes_created_by ON scenes (created_by);

-- ---------------------------------------------------------------------------
-- 6. voice_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_sessions (
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

CREATE INDEX IF NOT EXISTS idx_voice_sessions_tenant_id ON voice_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_user_id ON voice_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_device_id ON voice_sessions (device_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_tenant_status ON voice_sessions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_tenant_created ON voice_sessions (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. voice_transcripts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_transcripts (
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

CREATE INDEX IF NOT EXISTS idx_voice_transcripts_tenant_id ON voice_transcripts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_voice_transcripts_session_id ON voice_transcripts (session_id);
CREATE INDEX IF NOT EXISTS idx_voice_transcripts_user_id ON voice_transcripts (user_id);
CREATE INDEX IF NOT EXISTS idx_voice_transcripts_tenant_created ON voice_transcripts (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 8. audit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
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

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action ON audit_logs (tenant_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_timestamp ON audit_logs (tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_device_id ON audit_logs (device_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_voice_session ON audit_logs (voice_session_id);

-- ---------------------------------------------------------------------------
-- 9. sensor_telemetry (normal table, no TimescaleDB)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sensor_telemetry (
  time       TIMESTAMPTZ NOT NULL,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  metric     TEXT NOT NULL,
  value      NUMERIC NOT NULL,
  unit       TEXT NOT NULL
);


CREATE INDEX IF NOT EXISTS idx_sensor_telemetry_tenant_id ON sensor_telemetry (tenant_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_telemetry_device_id ON sensor_telemetry (device_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_telemetry_tenant_device_metric ON sensor_telemetry (tenant_id, device_id, metric, time DESC);

-- ---------------------------------------------------------------------------
-- 10. reservations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id              TEXT NOT NULL,
  guest_profile_id         UUID,
  platform                 reservation_platform NOT NULL DEFAULT 'direct',
  external_reservation_id  TEXT,
  check_in                 TIMESTAMPTZ NOT NULL,
  check_out                TIMESTAMPTZ NOT NULL,
  guest_count              INTEGER NOT NULL DEFAULT 1 CHECK (guest_count > 0),
  status                   reservation_status NOT NULL DEFAULT 'upcoming',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservations_tenant_id ON reservations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant_status ON reservations (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant_property ON reservations (tenant_id, property_id);
CREATE INDEX IF NOT EXISTS idx_reservations_checkout ON reservations (check_out);
CREATE INDEX IF NOT EXISTS idx_reservations_external_id ON reservations (external_reservation_id) WHERE external_reservation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 11. guest_profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guest_profiles (
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

CREATE INDEX IF NOT EXISTS idx_guest_profiles_tenant_id ON guest_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_guest_profiles_reservation_id ON guest_profiles (reservation_id);
CREATE INDEX IF NOT EXISTS idx_guest_profiles_expires ON guest_profiles (expires_at);

-- FK from reservations -> guest_profiles (deferred because of circular reference)
DO $$ BEGIN
  ALTER TABLE reservations
    ADD CONSTRAINT fk_reservations_guest_profile
    FOREIGN KEY (guest_profile_id) REFERENCES guest_profiles(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 12. guest_wipe_checklists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guest_wipe_checklists (
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

CREATE INDEX IF NOT EXISTS idx_guest_wipe_checklists_tenant_id ON guest_wipe_checklists (tenant_id);
CREATE INDEX IF NOT EXISTS idx_guest_wipe_checklists_reservation_id ON guest_wipe_checklists (reservation_id);
CREATE INDEX IF NOT EXISTS idx_guest_wipe_checklists_incomplete ON guest_wipe_checklists (tenant_id) WHERE NOT is_complete;

-- ===========================================================================
-- PART 4: TRIGGERS
-- ===========================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I',
      tbl, tbl
    );
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

-- ===========================================================================
-- PART 5: RLS HELPER FUNCTIONS
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.requesting_tenant_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    (auth.jwt()->>'tenant_id')::uuid,
    (auth.jwt()->'app_metadata'->>'tenant_id')::uuid
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.requesting_user_role()
RETURNS user_role AS $$
  SELECT COALESCE(
    (auth.jwt()->>'user_role')::user_role,
    (auth.jwt()->'app_metadata'->>'user_role')::user_role
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.requesting_user_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    (auth.jwt()->>'sub')::uuid,
    auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION check_device_command_rate_limit(p_user_id UUID, p_tenant_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  command_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO command_count
  FROM audit_logs
  WHERE tenant_id = p_tenant_id
    AND user_id = p_user_id
    AND action = 'device_command_issued'
    AND timestamp > (now() - interval '1 minute');

  RETURN command_count < 60;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION role_at_least(required user_role)
RETURNS BOOLEAN AS $$
DECLARE
  caller_role user_role;
BEGIN
  caller_role := requesting_user_role();

  RETURN CASE caller_role
    WHEN 'owner'    THEN 5
    WHEN 'admin'    THEN 4
    WHEN 'manager'  THEN 3
    WHEN 'resident' THEN 2
    WHEN 'guest'    THEN 1
    ELSE 0
  END >= CASE required
    WHEN 'owner'    THEN 5
    WHEN 'admin'    THEN 4
    WHEN 'manager'  THEN 3
    WHEN 'resident' THEN 2
    WHEN 'guest'    THEN 1
    ELSE 0
  END;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ===========================================================================
-- PART 6: ENABLE RLS ON ALL TABLES
-- ===========================================================================

ALTER TABLE tenants              ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms                ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_transcripts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_telemetry     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_wipe_checklists ENABLE ROW LEVEL SECURITY;


-- ===========================================================================
-- PART 6b: RLS HELPER FUNCTIONS (break circular policy references)
-- ===========================================================================

-- These SECURITY DEFINER functions bypass RLS to prevent infinite recursion
-- between guest_profiles <-> reservations policies.

CREATE OR REPLACE FUNCTION public.get_active_guest_profile_ids(p_tenant_id UUID)
RETURNS SETOF UUID AS $$
  SELECT gp.id FROM guest_profiles gp
  JOIN reservations r ON r.guest_profile_id = gp.id
  WHERE gp.tenant_id = p_tenant_id AND r.status = 'active';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_guest_allowed_device_ids(p_tenant_id UUID)
RETURNS SETOF UUID AS $$
  SELECT (jsonb_array_elements_text(gp.voice_preferences->'allowed_devices'))::uuid
  FROM guest_profiles gp
  JOIN reservations r ON r.guest_profile_id = gp.id
  WHERE gp.tenant_id = p_tenant_id
    AND r.status = 'active'
    AND gp.voice_preferences->'allowed_devices' IS NOT NULL;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ===========================================================================
-- PART 7: RLS POLICIES
-- ===========================================================================

-- Drop all existing policies first for idempotency
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
  END LOOP;
END;
$$;

-- ---- TENANTS ----
CREATE POLICY tenants_select ON tenants
  FOR SELECT USING (id = requesting_tenant_id());
-- Allow users to read their own tenant (lookup via users table, works before JWT hook)
CREATE POLICY tenants_select_own ON tenants
  FOR SELECT USING (id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
CREATE POLICY tenants_update ON tenants
  FOR UPDATE USING (id = requesting_tenant_id() AND role_at_least('owner'));

-- ---- USERS ----
CREATE POLICY users_select ON users
  FOR SELECT USING (tenant_id = requesting_tenant_id());
-- Allow users to read their own row by auth.uid() (works before JWT hook sets tenant_id)
CREATE POLICY users_select_own ON users
  FOR SELECT USING (id = auth.uid());
CREATE POLICY users_insert ON users
  FOR INSERT WITH CHECK (tenant_id = requesting_tenant_id() AND role_at_least('admin'));
CREATE POLICY users_update ON users
  FOR UPDATE USING (tenant_id = requesting_tenant_id() AND (role_at_least('admin') OR id = requesting_user_id()));
CREATE POLICY users_delete ON users
  FOR DELETE USING (tenant_id = requesting_tenant_id() AND role_at_least('owner'));

-- ---- DEVICES ----
CREATE POLICY devices_select_members ON devices
  FOR SELECT USING (tenant_id = requesting_tenant_id() AND role_at_least('resident'));
CREATE POLICY devices_select_guests ON devices
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND requesting_user_role() = 'guest'
    AND id IN (SELECT get_guest_allowed_device_ids(requesting_tenant_id()))
  );
CREATE POLICY devices_insert ON devices
  FOR INSERT WITH CHECK (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY devices_update ON devices
  FOR UPDATE USING (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY devices_delete ON devices
  FOR DELETE USING (tenant_id = requesting_tenant_id() AND role_at_least('admin'));

-- ---- ROOMS ----
CREATE POLICY rooms_select ON rooms
  FOR SELECT USING (tenant_id = requesting_tenant_id() AND role_at_least('resident'));
CREATE POLICY rooms_insert ON rooms
  FOR INSERT WITH CHECK (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY rooms_update ON rooms
  FOR UPDATE USING (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY rooms_delete ON rooms
  FOR DELETE USING (tenant_id = requesting_tenant_id() AND role_at_least('admin'));

-- ---- SCENES ----
CREATE POLICY scenes_select ON scenes
  FOR SELECT USING (tenant_id = requesting_tenant_id() AND role_at_least('resident'));
CREATE POLICY scenes_insert ON scenes
  FOR INSERT WITH CHECK (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY scenes_update ON scenes
  FOR UPDATE USING (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY scenes_delete ON scenes
  FOR DELETE USING (tenant_id = requesting_tenant_id() AND role_at_least('admin'));

-- ---- VOICE SESSIONS ----
CREATE POLICY voice_sessions_select_members ON voice_sessions
  FOR SELECT USING (tenant_id = requesting_tenant_id() AND role_at_least('resident'));
CREATE POLICY voice_sessions_select_guests ON voice_sessions
  FOR SELECT USING (tenant_id = requesting_tenant_id() AND requesting_user_role() = 'guest' AND user_id = requesting_user_id());
CREATE POLICY voice_sessions_insert ON voice_sessions
  FOR INSERT WITH CHECK (tenant_id = requesting_tenant_id());
CREATE POLICY voice_sessions_update ON voice_sessions
  FOR UPDATE USING (tenant_id = requesting_tenant_id() AND role_at_least('manager'));

-- ---- VOICE TRANSCRIPTS ----
CREATE POLICY voice_transcripts_select_members ON voice_transcripts
  FOR SELECT USING (tenant_id = requesting_tenant_id() AND role_at_least('resident'));
CREATE POLICY voice_transcripts_select_guests ON voice_transcripts
  FOR SELECT USING (tenant_id = requesting_tenant_id() AND requesting_user_role() = 'guest' AND user_id = requesting_user_id());
CREATE POLICY voice_transcripts_insert ON voice_transcripts
  FOR INSERT WITH CHECK (tenant_id = requesting_tenant_id());

-- ---- AUDIT LOGS ----
CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT WITH CHECK (tenant_id = requesting_tenant_id());
CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT USING (tenant_id = requesting_tenant_id() AND role_at_least('owner'));

-- ---- SENSOR TELEMETRY ----
CREATE POLICY sensor_telemetry_select ON sensor_telemetry
  FOR SELECT USING (tenant_id = requesting_tenant_id() AND role_at_least('resident'));
CREATE POLICY sensor_telemetry_insert ON sensor_telemetry
  FOR INSERT WITH CHECK (tenant_id = requesting_tenant_id());

-- ---- RESERVATIONS ----
CREATE POLICY reservations_select ON reservations
  FOR SELECT USING (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY reservations_select_guests ON reservations
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND requesting_user_role() = 'guest'
    AND status = 'active'
    AND guest_profile_id IN (SELECT get_active_guest_profile_ids(requesting_tenant_id()))
  );
CREATE POLICY reservations_insert ON reservations
  FOR INSERT WITH CHECK (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY reservations_update ON reservations
  FOR UPDATE USING (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY reservations_delete ON reservations
  FOR DELETE USING (tenant_id = requesting_tenant_id() AND role_at_least('owner'));

-- ---- GUEST PROFILES ----
CREATE POLICY guest_profiles_select_managers ON guest_profiles
  FOR SELECT USING (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY guest_profiles_select_guests ON guest_profiles
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND requesting_user_role() = 'guest'
    AND id IN (SELECT get_active_guest_profile_ids(requesting_tenant_id()))
  );
CREATE POLICY guest_profiles_insert ON guest_profiles
  FOR INSERT WITH CHECK (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY guest_profiles_update ON guest_profiles
  FOR UPDATE USING (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY guest_profiles_delete ON guest_profiles
  FOR DELETE USING (tenant_id = requesting_tenant_id() AND role_at_least('manager'));

-- ---- GUEST WIPE CHECKLISTS ----
CREATE POLICY guest_wipe_checklists_select ON guest_wipe_checklists
  FOR SELECT USING (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY guest_wipe_checklists_insert ON guest_wipe_checklists
  FOR INSERT WITH CHECK (tenant_id = requesting_tenant_id() AND role_at_least('manager'));
CREATE POLICY guest_wipe_checklists_update ON guest_wipe_checklists
  FOR UPDATE USING (tenant_id = requesting_tenant_id() AND role_at_least('manager'));

-- ===========================================================================
-- PART 8: AUTH FUNCTIONS
-- ===========================================================================

-- JWT claims hook
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB AS $$
DECLARE
  claims       JSONB;
  user_record  RECORD;
BEGIN
  claims := event->'claims';

  SELECT u.tenant_id, u.role
  INTO user_record
  FROM public.users u
  WHERE u.id = (event->>'user_id')::uuid;

  IF user_record IS NOT NULL THEN
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(user_record.tenant_id::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_record.role::text));
  ELSE
    claims := jsonb_set(claims, '{tenant_id}', 'null'::jsonb);
    claims := jsonb_set(claims, '{user_role}', 'null'::jsonb);
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM anon;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated;

-- Create user with tenant assignment
CREATE OR REPLACE FUNCTION create_user_with_tenant(
  p_auth_user_id UUID,
  p_tenant_id    UUID,
  p_email        TEXT,
  p_role         user_role DEFAULT 'resident',
  p_display_name TEXT DEFAULT ''
)
RETURNS UUID AS $$
DECLARE
  new_user_id UUID;
  tenant_exists BOOLEAN;
  user_count    INTEGER;
  max_users     INTEGER;
BEGIN
  SELECT EXISTS(SELECT 1 FROM tenants WHERE id = p_tenant_id)
  INTO tenant_exists;

  IF NOT tenant_exists THEN
    RAISE EXCEPTION 'Tenant % does not exist', p_tenant_id;
  END IF;

  SELECT (settings->>'max_users')::integer INTO max_users
  FROM tenants WHERE id = p_tenant_id;

  SELECT COUNT(*) INTO user_count
  FROM users WHERE tenant_id = p_tenant_id;

  IF user_count >= max_users THEN
    RAISE EXCEPTION 'Tenant % has reached maximum user limit (%)', p_tenant_id, max_users;
  END IF;

  IF EXISTS(SELECT 1 FROM users WHERE tenant_id = p_tenant_id AND email = p_email) THEN
    RAISE EXCEPTION 'Email % already exists in tenant %', p_email, p_tenant_id;
  END IF;

  INSERT INTO users (id, tenant_id, email, role, display_name)
  VALUES (p_auth_user_id, p_tenant_id, p_email, p_role, COALESCE(NULLIF(p_display_name, ''), split_part(p_email, '@', 1)))
  RETURNING id INTO new_user_id;

  INSERT INTO audit_logs (tenant_id, user_id, action, details)
  VALUES (
    p_tenant_id, new_user_id, 'user_created',
    jsonb_build_object('email', p_email, 'role', p_role::text, 'display_name', p_display_name)
  );

  RETURN new_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION create_user_with_tenant FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_user_with_tenant FROM anon;
REVOKE EXECUTE ON FUNCTION create_user_with_tenant FROM authenticated;

-- Validate device-scoped token
CREATE OR REPLACE FUNCTION validate_device_scoped_token(
  p_device_id UUID,
  p_tenant_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  jwt_device_scope TEXT;
  device_exists    BOOLEAN;
BEGIN
  jwt_device_scope := auth.jwt()->>'device_scope';

  IF jwt_device_scope IS NULL THEN
    RETURN true;
  END IF;

  IF jwt_device_scope != p_device_id::text THEN
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM devices WHERE id = p_device_id AND tenant_id = p_tenant_id
  ) INTO device_exists;

  RETURN device_exists;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Create tenant with owner
CREATE OR REPLACE FUNCTION create_tenant_with_owner(
  p_auth_user_id  UUID,
  p_tenant_name   TEXT,
  p_vertical      market_vertical,
  p_email         TEXT,
  p_display_name  TEXT DEFAULT '',
  p_tier          subscription_tier DEFAULT 'starter'
)
RETURNS UUID AS $$
DECLARE
  new_tenant_id UUID;
BEGIN
  -- Prevent users from creating tenants on behalf of other users
  IF p_auth_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Cannot create tenant for another user';
  END IF;

  INSERT INTO tenants (name, vertical, subscription_tier)
  VALUES (p_tenant_name, p_vertical, p_tier)
  RETURNING id INTO new_tenant_id;

  PERFORM create_user_with_tenant(
    p_auth_user_id, new_tenant_id, p_email, 'owner', p_display_name
  );

  RETURN new_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION create_tenant_with_owner FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_tenant_with_owner FROM anon;
GRANT EXECUTE ON FUNCTION create_tenant_with_owner TO authenticated;

COMMIT;
