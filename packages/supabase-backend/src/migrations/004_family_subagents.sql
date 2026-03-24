-- =============================================================================
-- Family Subagent System: Named Personal Agents with Age-Based Permissions
-- =============================================================================
-- Adds tables for family member profiles with personal named agents,
-- granular age-based permission overrides, time-based schedules,
-- spending limits, and parental notifications.
--
-- Layers on TOP of existing 5-level role system (owner/admin/manager/resident/guest).
-- FamilyAgeGroup provides finer-grained application-level permissions resolved
-- at command execution time; the existing UserRole remains the RLS boundary.
--
-- All tables enforce tenant isolation via RLS using public.requesting_tenant_id().
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- New ENUM types
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE family_age_group AS ENUM (
    'adult',          -- 18+ parents/owners: full permissions
    'teenager',       -- 15-17: near-adult, no security/locks/cameras/spending
    'tween',          -- 10-14: own-room focused, moderate restrictions
    'child',          -- 5-9: safety-focused, own-room lights only
    'toddler',        -- 2-4: zero device control, conversational companion
    'adult_visitor'   -- visiting adults: scoped to explicitly-allowed devices
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE permission_action AS ENUM (
    'control',        -- operate the device (turn on/off, set temp, etc.)
    'view_state',     -- see device state (is the light on?)
    'configure',      -- change device settings (rename, set schedules)
    'view_history'    -- see logs/history for this device
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Add new audit actions to existing enum
-- ---------------------------------------------------------------------------
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'family_permission_denied';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'family_schedule_triggered';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'family_emergency_command';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'family_override_attempt';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'family_spending_request';

-- ---------------------------------------------------------------------------
-- 1. family_member_profiles
-- ---------------------------------------------------------------------------
-- Links each user to an age group and a named personal agent.
-- The agent_name is the wake word (e.g., "Jarvis", "Luna", "Buddy").

CREATE TABLE IF NOT EXISTS family_member_profiles (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  age_group         family_age_group NOT NULL,
  date_of_birth     DATE,
  agent_name        TEXT NOT NULL,
  agent_voice_id    TEXT,
  agent_personality JSONB NOT NULL DEFAULT '{
    "tone": "friendly",
    "vocabulary_level": "adult",
    "humor_level": 0.3,
    "encouragement_level": 0.2,
    "safety_warnings": false,
    "max_response_words": 25,
    "forbidden_topics": [],
    "custom_greeting": "Hello!",
    "sound_effects": false
  }'::jsonb,
  managed_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_agent_name_per_tenant UNIQUE (tenant_id, agent_name),
  CONSTRAINT uq_user_profile UNIQUE (tenant_id, user_id)
);

CREATE INDEX idx_family_profiles_tenant_id ON family_member_profiles (tenant_id);
CREATE INDEX idx_family_profiles_agent_name ON family_member_profiles (tenant_id, agent_name);
CREATE INDEX idx_family_profiles_user_id ON family_member_profiles (user_id);

-- ---------------------------------------------------------------------------
-- 2. family_permission_overrides
-- ---------------------------------------------------------------------------
-- Per-member permission grants/denials. Parents can allow or deny specific
-- devices, device categories, or entire rooms for each family member.
-- Constraints JSONB holds parameter limits (temp range, volume max, etc.).

CREATE TABLE IF NOT EXISTS family_permission_overrides (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id        UUID NOT NULL REFERENCES family_member_profiles(id) ON DELETE CASCADE,
  device_id         UUID REFERENCES devices(id) ON DELETE CASCADE,
  device_category   device_category,
  room              TEXT,
  action            permission_action NOT NULL,
  allowed           BOOLEAN NOT NULL,
  constraints       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_override_scope CHECK (
    device_id IS NOT NULL OR device_category IS NOT NULL OR room IS NOT NULL
  )
);

CREATE INDEX idx_family_overrides_tenant_id ON family_permission_overrides (tenant_id);
CREATE INDEX idx_family_overrides_profile_id ON family_permission_overrides (profile_id);
CREATE INDEX idx_family_overrides_device_id ON family_permission_overrides (device_id);

-- ---------------------------------------------------------------------------
-- 3. family_schedules
-- ---------------------------------------------------------------------------
-- Time-based restriction windows (bedtime, school hours, quiet time).
-- When a schedule is active, its restrictions override default permissions.

CREATE TABLE IF NOT EXISTS family_schedules (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id        UUID NOT NULL REFERENCES family_member_profiles(id) ON DELETE CASCADE,
  schedule_name     TEXT NOT NULL,
  days_of_week      INTEGER[] NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  timezone          TEXT NOT NULL DEFAULT 'America/Chicago',
  restrictions      JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_family_schedules_tenant_id ON family_schedules (tenant_id);
CREATE INDEX idx_family_schedules_profile_id ON family_schedules (profile_id);

-- ---------------------------------------------------------------------------
-- 4. family_spending_limits
-- ---------------------------------------------------------------------------
-- Purchase/ordering caps per family member.

CREATE TABLE IF NOT EXISTS family_spending_limits (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id              UUID NOT NULL REFERENCES family_member_profiles(id) ON DELETE CASCADE,
  daily_limit             NUMERIC NOT NULL DEFAULT 0,
  monthly_limit           NUMERIC NOT NULL DEFAULT 0,
  requires_approval_above NUMERIC,
  approved_categories     TEXT[] NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_spending_per_profile UNIQUE (profile_id)
);

CREATE INDEX idx_family_spending_tenant_id ON family_spending_limits (tenant_id);

-- ---------------------------------------------------------------------------
-- 5. parental_notifications
-- ---------------------------------------------------------------------------
-- Events that parents should be alerted about (permission denials,
-- emergency commands, bedtime override attempts, spending requests).

CREATE TABLE IF NOT EXISTS parental_notifications (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id        UUID NOT NULL REFERENCES family_member_profiles(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL CHECK (event_type IN (
    'permission_denied', 'bedtime_override_attempt', 'emergency',
    'spending_request', 'schedule_triggered', 'override_attempt'
  )),
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged      BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_parental_notifications_tenant_id ON parental_notifications (tenant_id);
CREATE INDEX idx_parental_notifications_profile_id ON parental_notifications (profile_id);
CREATE INDEX idx_parental_notifications_unread ON parental_notifications (tenant_id, acknowledged)
  WHERE NOT acknowledged;

-- ===========================================================================
-- ENABLE RLS ON ALL NEW TABLES
-- ===========================================================================

ALTER TABLE family_member_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_schedules            ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_spending_limits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE parental_notifications      ENABLE ROW LEVEL SECURITY;

ALTER TABLE family_member_profiles      FORCE ROW LEVEL SECURITY;
ALTER TABLE family_permission_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE family_schedules            FORCE ROW LEVEL SECURITY;
ALTER TABLE family_spending_limits      FORCE ROW LEVEL SECURITY;
ALTER TABLE parental_notifications      FORCE ROW LEVEL SECURITY;

-- ===========================================================================
-- RLS POLICIES
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- family_member_profiles:
--   SELECT: tenant members (resident+) can read all profiles in their tenant;
--           guests can read their own profile only.
--   INSERT/UPDATE/DELETE: owner/admin only (parents manage profiles).
-- ---------------------------------------------------------------------------

CREATE POLICY family_profiles_select_members ON family_member_profiles
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('resident')
  );

CREATE POLICY family_profiles_select_own ON family_member_profiles
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND user_id = requesting_user_id()
  );

CREATE POLICY family_profiles_insert ON family_member_profiles
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY family_profiles_update ON family_member_profiles
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY family_profiles_delete ON family_member_profiles
  FOR DELETE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

-- ---------------------------------------------------------------------------
-- family_permission_overrides: owner/admin can manage; residents can read.
-- ---------------------------------------------------------------------------

CREATE POLICY family_overrides_select ON family_permission_overrides
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('resident')
  );

-- Guests can read their own overrides (so their agent can load permissions)
CREATE POLICY family_overrides_select_own ON family_permission_overrides
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND profile_id IN (
      SELECT id FROM family_member_profiles
      WHERE user_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY family_overrides_insert ON family_permission_overrides
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY family_overrides_update ON family_permission_overrides
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY family_overrides_delete ON family_permission_overrides
  FOR DELETE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

-- ---------------------------------------------------------------------------
-- family_schedules: owner/admin can manage; residents can read.
-- ---------------------------------------------------------------------------

CREATE POLICY family_schedules_select ON family_schedules
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('resident')
  );

CREATE POLICY family_schedules_select_own ON family_schedules
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND profile_id IN (
      SELECT id FROM family_member_profiles
      WHERE user_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY family_schedules_insert ON family_schedules
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY family_schedules_update ON family_schedules
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY family_schedules_delete ON family_schedules
  FOR DELETE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

-- ---------------------------------------------------------------------------
-- family_spending_limits: owner/admin can manage; associated user can read.
-- ---------------------------------------------------------------------------

CREATE POLICY family_spending_select ON family_spending_limits
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY family_spending_select_own ON family_spending_limits
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND profile_id IN (
      SELECT id FROM family_member_profiles
      WHERE user_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY family_spending_insert ON family_spending_limits
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY family_spending_update ON family_spending_limits
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

-- ---------------------------------------------------------------------------
-- parental_notifications: owner/admin can read/manage.
-- ---------------------------------------------------------------------------

CREATE POLICY parental_notifications_select ON parental_notifications
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY parental_notifications_insert ON parental_notifications
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
  );

CREATE POLICY parental_notifications_update ON parental_notifications
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

-- ===========================================================================
-- HELPER FUNCTIONS
-- ===========================================================================

-- Lookup a family profile by agent name (used by voice pipeline to identify
-- which family member is speaking based on the wake word they used).
CREATE OR REPLACE FUNCTION public.get_family_profile_by_agent_name(
  p_tenant_id UUID,
  p_agent_name TEXT
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  age_group family_age_group,
  agent_name TEXT,
  agent_voice_id TEXT,
  agent_personality JSONB,
  managed_by UUID,
  is_active BOOLEAN
) AS $$
  SELECT
    fmp.id, fmp.user_id, fmp.age_group, fmp.agent_name,
    fmp.agent_voice_id, fmp.agent_personality, fmp.managed_by, fmp.is_active
  FROM family_member_profiles fmp
  WHERE fmp.tenant_id = p_tenant_id
    AND lower(fmp.agent_name) = lower(p_agent_name)
    AND fmp.is_active = true
    AND (fmp.expires_at IS NULL OR fmp.expires_at > now());
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if a schedule is currently active for a profile.
CREATE OR REPLACE FUNCTION public.is_schedule_active(
  p_profile_id UUID,
  p_tenant_id UUID
)
RETURNS TABLE (
  schedule_id UUID,
  schedule_name TEXT,
  restrictions JSONB
) AS $$
  SELECT fs.id, fs.schedule_name, fs.restrictions
  FROM family_schedules fs
  WHERE fs.profile_id = p_profile_id
    AND fs.tenant_id = p_tenant_id
    AND fs.is_active = true
    AND EXTRACT(DOW FROM now() AT TIME ZONE fs.timezone) = ANY(fs.days_of_week)
    AND (now() AT TIME ZONE fs.timezone)::time BETWEEN fs.start_time AND fs.end_time;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Get age-group-specific rate limit.
CREATE OR REPLACE FUNCTION public.get_family_rate_limit(p_age_group family_age_group)
RETURNS INTEGER AS $$
  SELECT CASE p_age_group
    WHEN 'adult'          THEN 60
    WHEN 'teenager'       THEN 30
    WHEN 'tween'          THEN 20
    WHEN 'child'          THEN 10
    WHEN 'toddler'        THEN 5
    WHEN 'adult_visitor'  THEN 15
    ELSE 10
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ===========================================================================
-- UPDATED_AT TRIGGER
-- ===========================================================================

-- Reuse the existing update_updated_at_column trigger function from 001_init
-- (or create it idempotently if running standalone).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $t$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $t$ LANGUAGE plpgsql;
    $fn$;
  END IF;
END;
$$;

CREATE TRIGGER trg_family_profiles_updated_at
  BEFORE UPDATE ON family_member_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_family_schedules_updated_at
  BEFORE UPDATE ON family_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_family_spending_updated_at
  BEFORE UPDATE ON family_spending_limits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
