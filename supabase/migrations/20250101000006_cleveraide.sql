-- =============================================================================
-- CleverAide: Assisted Living Features for Elderly & Disabled Users
-- =============================================================================
-- Extends the family subagent system with care-specific profiles, medication
-- management, wellness monitoring, activity tracking, caregiver alerts, and
-- structured daily routines.
--
-- Adds 'assisted_living' to the family_age_group enum and creates companion
-- tables linked 1:1 to family_member_profiles via aide_profiles.
--
-- All tables enforce tenant isolation via RLS using public.requesting_tenant_id().
-- =============================================================================

-- ===========================================================================
-- ENUM EXTENSIONS (must be committed before use — cannot be in a transaction)
-- ===========================================================================

ALTER TYPE family_age_group ADD VALUE IF NOT EXISTS 'assisted_living';

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'aide_medication_taken';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'aide_medication_missed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'aide_wellness_checkin';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'aide_fall_detected';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'aide_inactivity_alert';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'aide_caregiver_alert_sent';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'aide_emergency_enhanced';

-- ===========================================================================
-- TABLES, RLS, FUNCTIONS (in a transaction)
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. aide_profiles
-- ---------------------------------------------------------------------------
-- Extended care profile linked 1:1 to family_member_profiles.
-- Contains medical info, emergency contacts, accessibility levels, and
-- interaction preferences.

CREATE TABLE IF NOT EXISTS public.aide_profiles (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  profile_id            UUID NOT NULL UNIQUE REFERENCES public.family_member_profiles(id) ON DELETE CASCADE,
  primary_caregiver_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,

  -- Medical information (sensitive — encrypt at rest via Supabase Vault)
  medical_info          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Ordered array of {name, phone, relationship, priority}
  emergency_contacts    JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Accessibility levels
  mobility_level        TEXT NOT NULL DEFAULT 'full'
                        CHECK (mobility_level IN ('full', 'limited', 'wheelchair', 'bedridden')),
  cognitive_level       TEXT NOT NULL DEFAULT 'independent'
                        CHECK (cognitive_level IN ('independent', 'mild_assistance', 'moderate_assistance', 'full_assistance')),
  hearing_level         TEXT NOT NULL DEFAULT 'normal'
                        CHECK (hearing_level IN ('normal', 'mild_loss', 'moderate_loss', 'severe_loss')),
  vision_level          TEXT NOT NULL DEFAULT 'normal'
                        CHECK (vision_level IN ('normal', 'mild_loss', 'moderate_loss', 'legally_blind')),

  -- Interaction preferences
  preferred_interaction TEXT NOT NULL DEFAULT 'voice_first'
                        CHECK (preferred_interaction IN ('voice_first', 'touch_first', 'mixed')),
  confirmation_mode     TEXT NOT NULL DEFAULT 'safety_only'
                        CHECK (confirmation_mode IN ('always', 'safety_only', 'never')),
  speaking_pace         TEXT NOT NULL DEFAULT 'slow'
                        CHECK (speaking_pace IN ('slow', 'normal', 'fast')),

  timezone              TEXT NOT NULL DEFAULT 'America/Chicago',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_aide_profiles_tenant ON aide_profiles (tenant_id);
CREATE INDEX idx_aide_profiles_profile ON aide_profiles (profile_id);
CREATE INDEX idx_aide_profiles_caregiver ON aide_profiles (primary_caregiver_id);

-- ---------------------------------------------------------------------------
-- 2. aide_medications
-- ---------------------------------------------------------------------------
-- Medication schedules with dosage, frequency, and instructions.

CREATE TABLE IF NOT EXISTS public.aide_medications (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  aide_profile_id     UUID NOT NULL REFERENCES public.aide_profiles(id) ON DELETE CASCADE,
  medication_name     TEXT NOT NULL,
  dosage              TEXT NOT NULL,
  frequency           TEXT NOT NULL CHECK (frequency IN (
    'once_daily', 'twice_daily', 'three_times_daily', 'four_times_daily',
    'every_8_hours', 'every_12_hours', 'as_needed', 'weekly'
  )),
  scheduled_times     TIME[] NOT NULL DEFAULT '{}',
  days_of_week        INTEGER[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  instructions        TEXT,
  refill_date         DATE,
  prescribing_doctor  TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_aide_medications_tenant ON aide_medications (tenant_id);
CREATE INDEX idx_aide_medications_profile ON aide_medications (aide_profile_id);
CREATE INDEX idx_aide_medications_active ON aide_medications (aide_profile_id, is_active)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 3. aide_medication_logs
-- ---------------------------------------------------------------------------
-- Tracks per-dose confirmation/skip/miss events.

CREATE TABLE IF NOT EXISTS public.aide_medication_logs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  medication_id     UUID NOT NULL REFERENCES public.aide_medications(id) ON DELETE CASCADE,
  aide_profile_id   UUID NOT NULL REFERENCES public.aide_profiles(id) ON DELETE CASCADE,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('taken', 'skipped', 'missed', 'pending', 'reminded')),
  confirmed_via     TEXT CHECK (confirmed_via IN ('voice', 'app', 'caregiver', 'auto_timeout')),
  confirmed_at      TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_aide_med_logs_tenant ON aide_medication_logs (tenant_id);
CREATE INDEX idx_aide_med_logs_profile ON aide_medication_logs (aide_profile_id);
CREATE INDEX idx_aide_med_logs_medication ON aide_medication_logs (medication_id, scheduled_at DESC);
CREATE INDEX idx_aide_med_logs_pending ON aide_medication_logs (aide_profile_id, status)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 4. aide_wellness_checkins
-- ---------------------------------------------------------------------------
-- Periodic wellness check records (morning, afternoon, evening, or on-demand).

CREATE TABLE IF NOT EXISTS public.aide_wellness_checkins (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  aide_profile_id     UUID NOT NULL REFERENCES public.aide_profiles(id) ON DELETE CASCADE,
  checkin_type        TEXT NOT NULL CHECK (checkin_type IN (
    'morning', 'afternoon', 'evening', 'custom', 'caregiver_requested'
  )),
  status              TEXT NOT NULL DEFAULT 'completed'
                      CHECK (status IN ('completed', 'no_response', 'concern_flagged', 'emergency')),
  mood_rating         INTEGER CHECK (mood_rating BETWEEN 1 AND 5),
  pain_level          INTEGER CHECK (pain_level BETWEEN 0 AND 10),
  notes               TEXT,
  response_transcript TEXT,
  flagged_for_review  BOOLEAN NOT NULL DEFAULT false,
  reviewed_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_aide_checkins_tenant ON aide_wellness_checkins (tenant_id);
CREATE INDEX idx_aide_checkins_profile ON aide_wellness_checkins (aide_profile_id, created_at DESC);
CREATE INDEX idx_aide_checkins_flagged ON aide_wellness_checkins (aide_profile_id, flagged_for_review)
  WHERE flagged_for_review = true;

-- ---------------------------------------------------------------------------
-- 5. aide_activity_log
-- ---------------------------------------------------------------------------
-- Motion, fall detection, door events, and interaction tracking from HA sensors.

CREATE TABLE IF NOT EXISTS public.aide_activity_log (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  aide_profile_id   UUID NOT NULL REFERENCES public.aide_profiles(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL CHECK (event_type IN (
    'motion_detected', 'no_motion_alert', 'fall_detected',
    'door_opened', 'door_closed', 'appliance_used',
    'voice_interaction', 'button_press'
  )),
  room              TEXT,
  sensor_entity_id  TEXT,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  alert_sent        BOOLEAN NOT NULL DEFAULT false,
  alert_sent_to     TEXT[] DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_aide_activity_tenant ON aide_activity_log (tenant_id);
CREATE INDEX idx_aide_activity_profile ON aide_activity_log (aide_profile_id, created_at DESC);
CREATE INDEX idx_aide_activity_type ON aide_activity_log (aide_profile_id, event_type);

-- ---------------------------------------------------------------------------
-- 6. aide_caregiver_alerts
-- ---------------------------------------------------------------------------
-- Unified alert queue for caregivers with severity, delivery tracking,
-- acknowledgment, and escalation support.

CREATE TABLE IF NOT EXISTS public.aide_caregiver_alerts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  aide_profile_id   UUID NOT NULL REFERENCES public.aide_profiles(id) ON DELETE CASCADE,
  alert_type        TEXT NOT NULL CHECK (alert_type IN (
    'medication_missed', 'no_response_checkin', 'fall_detected',
    'inactivity', 'emergency', 'routine_deviation',
    'low_battery_medical_device', 'wellness_concern', 'manual'
  )),
  severity          TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'urgent', 'critical')),
  message           TEXT NOT NULL,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_channels TEXT[] NOT NULL DEFAULT '{push}',
  delivered_via     JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged      BOOLEAN NOT NULL DEFAULT false,
  acknowledged_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  acknowledged_at   TIMESTAMPTZ,
  escalated         BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_aide_alerts_tenant ON aide_caregiver_alerts (tenant_id);
CREATE INDEX idx_aide_alerts_profile ON aide_caregiver_alerts (aide_profile_id, created_at DESC);
CREATE INDEX idx_aide_alerts_unacked ON aide_caregiver_alerts (aide_profile_id, acknowledged)
  WHERE NOT acknowledged;
CREATE INDEX idx_aide_alerts_severity ON aide_caregiver_alerts (severity, created_at DESC)
  WHERE NOT acknowledged;

-- ---------------------------------------------------------------------------
-- 7. aide_routines
-- ---------------------------------------------------------------------------
-- Structured daily routines with ordered steps, optional device actions,
-- and confirmation requirements.

CREATE TABLE IF NOT EXISTS public.aide_routines (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  aide_profile_id   UUID NOT NULL REFERENCES public.aide_profiles(id) ON DELETE CASCADE,
  routine_name      TEXT NOT NULL,
  scheduled_time    TIME NOT NULL,
  days_of_week      INTEGER[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  -- Ordered array of {type, description, device_action?, confirmation_required?, timeout_seconds?}
  steps             JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_aide_routines_tenant ON aide_routines (tenant_id);
CREATE INDEX idx_aide_routines_profile ON aide_routines (aide_profile_id);
CREATE INDEX idx_aide_routines_active ON aide_routines (aide_profile_id, is_active)
  WHERE is_active = true;

-- ===========================================================================
-- ENABLE RLS ON ALL NEW TABLES
-- ===========================================================================

ALTER TABLE aide_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE aide_medications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE aide_medication_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE aide_wellness_checkins  ENABLE ROW LEVEL SECURITY;
ALTER TABLE aide_activity_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE aide_caregiver_alerts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE aide_routines           ENABLE ROW LEVEL SECURITY;

ALTER TABLE aide_profiles           FORCE ROW LEVEL SECURITY;
ALTER TABLE aide_medications        FORCE ROW LEVEL SECURITY;
ALTER TABLE aide_medication_logs    FORCE ROW LEVEL SECURITY;
ALTER TABLE aide_wellness_checkins  FORCE ROW LEVEL SECURITY;
ALTER TABLE aide_activity_log       FORCE ROW LEVEL SECURITY;
ALTER TABLE aide_caregiver_alerts   FORCE ROW LEVEL SECURITY;
ALTER TABLE aide_routines           FORCE ROW LEVEL SECURITY;

-- ===========================================================================
-- RLS POLICIES
-- ===========================================================================
-- Pattern: admin/owner can manage all aide data within tenant.
-- The assisted_living user can read their own data.
-- Caregivers (linked via primary_caregiver_id) can read/manage.

-- ---------------------------------------------------------------------------
-- aide_profiles: admin manages; associated user reads own; caregiver reads.
-- ---------------------------------------------------------------------------

CREATE POLICY aide_profiles_select_admin ON aide_profiles
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY aide_profiles_select_own ON aide_profiles
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND profile_id IN (
      SELECT id FROM family_member_profiles
      WHERE user_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY aide_profiles_select_caregiver ON aide_profiles
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND primary_caregiver_id = requesting_user_id()
  );

CREATE POLICY aide_profiles_insert ON aide_profiles
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY aide_profiles_update ON aide_profiles
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id() AND (
      role_at_least('admin')
      OR primary_caregiver_id = requesting_user_id()
    )
  );

CREATE POLICY aide_profiles_delete ON aide_profiles
  FOR DELETE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

-- ---------------------------------------------------------------------------
-- aide_medications: admin/caregiver manages; user reads own.
-- ---------------------------------------------------------------------------

CREATE POLICY aide_meds_select_admin ON aide_medications
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY aide_meds_select_own ON aide_medications
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND aide_profile_id IN (
      SELECT ap.id FROM aide_profiles ap
      JOIN family_member_profiles fmp ON fmp.id = ap.profile_id
      WHERE fmp.user_id = requesting_user_id() AND ap.tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY aide_meds_select_caregiver ON aide_medications
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND aide_profile_id IN (
      SELECT id FROM aide_profiles
      WHERE primary_caregiver_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY aide_meds_insert ON aide_medications
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id() AND (
      role_at_least('admin')
      OR aide_profile_id IN (
        SELECT id FROM aide_profiles
        WHERE primary_caregiver_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
      )
    )
  );

CREATE POLICY aide_meds_update ON aide_medications
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id() AND (
      role_at_least('admin')
      OR aide_profile_id IN (
        SELECT id FROM aide_profiles
        WHERE primary_caregiver_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
      )
    )
  );

CREATE POLICY aide_meds_delete ON aide_medications
  FOR DELETE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

-- ---------------------------------------------------------------------------
-- aide_medication_logs: admin/caregiver reads; service role + user can insert.
-- ---------------------------------------------------------------------------

CREATE POLICY aide_med_logs_select_admin ON aide_medication_logs
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY aide_med_logs_select_caregiver ON aide_medication_logs
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND aide_profile_id IN (
      SELECT id FROM aide_profiles
      WHERE primary_caregiver_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY aide_med_logs_select_own ON aide_medication_logs
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND aide_profile_id IN (
      SELECT ap.id FROM aide_profiles ap
      JOIN family_member_profiles fmp ON fmp.id = ap.profile_id
      WHERE fmp.user_id = requesting_user_id() AND ap.tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY aide_med_logs_insert ON aide_medication_logs
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
  );

CREATE POLICY aide_med_logs_update ON aide_medication_logs
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id() AND (
      role_at_least('admin')
      OR aide_profile_id IN (
        SELECT id FROM aide_profiles
        WHERE primary_caregiver_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- aide_wellness_checkins: admin/caregiver reads; service role inserts.
-- ---------------------------------------------------------------------------

CREATE POLICY aide_checkins_select_admin ON aide_wellness_checkins
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY aide_checkins_select_caregiver ON aide_wellness_checkins
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND aide_profile_id IN (
      SELECT id FROM aide_profiles
      WHERE primary_caregiver_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY aide_checkins_select_own ON aide_wellness_checkins
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND aide_profile_id IN (
      SELECT ap.id FROM aide_profiles ap
      JOIN family_member_profiles fmp ON fmp.id = ap.profile_id
      WHERE fmp.user_id = requesting_user_id() AND ap.tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY aide_checkins_insert ON aide_wellness_checkins
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
  );

CREATE POLICY aide_checkins_update ON aide_wellness_checkins
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id() AND (
      role_at_least('admin')
      OR aide_profile_id IN (
        SELECT id FROM aide_profiles
        WHERE primary_caregiver_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- aide_activity_log: admin/caregiver reads; service role inserts.
-- ---------------------------------------------------------------------------

CREATE POLICY aide_activity_select_admin ON aide_activity_log
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY aide_activity_select_caregiver ON aide_activity_log
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND aide_profile_id IN (
      SELECT id FROM aide_profiles
      WHERE primary_caregiver_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY aide_activity_select_own ON aide_activity_log
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND aide_profile_id IN (
      SELECT ap.id FROM aide_profiles ap
      JOIN family_member_profiles fmp ON fmp.id = ap.profile_id
      WHERE fmp.user_id = requesting_user_id() AND ap.tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY aide_activity_insert ON aide_activity_log
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
  );

-- ---------------------------------------------------------------------------
-- aide_caregiver_alerts: admin/caregiver reads/manages; service role inserts.
-- ---------------------------------------------------------------------------

CREATE POLICY aide_alerts_select_admin ON aide_caregiver_alerts
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY aide_alerts_select_caregiver ON aide_caregiver_alerts
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND aide_profile_id IN (
      SELECT id FROM aide_profiles
      WHERE primary_caregiver_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY aide_alerts_insert ON aide_caregiver_alerts
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
  );

CREATE POLICY aide_alerts_update ON aide_caregiver_alerts
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id() AND (
      role_at_least('admin')
      OR aide_profile_id IN (
        SELECT id FROM aide_profiles
        WHERE primary_caregiver_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- aide_routines: admin/caregiver manages; user reads own.
-- ---------------------------------------------------------------------------

CREATE POLICY aide_routines_select_admin ON aide_routines
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY aide_routines_select_own ON aide_routines
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND aide_profile_id IN (
      SELECT ap.id FROM aide_profiles ap
      JOIN family_member_profiles fmp ON fmp.id = ap.profile_id
      WHERE fmp.user_id = requesting_user_id() AND ap.tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY aide_routines_select_caregiver ON aide_routines
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND aide_profile_id IN (
      SELECT id FROM aide_profiles
      WHERE primary_caregiver_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

CREATE POLICY aide_routines_insert ON aide_routines
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id() AND (
      role_at_least('admin')
      OR aide_profile_id IN (
        SELECT id FROM aide_profiles
        WHERE primary_caregiver_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
      )
    )
  );

CREATE POLICY aide_routines_update ON aide_routines
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id() AND (
      role_at_least('admin')
      OR aide_profile_id IN (
        SELECT id FROM aide_profiles
        WHERE primary_caregiver_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
      )
    )
  );

CREATE POLICY aide_routines_delete ON aide_routines
  FOR DELETE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

-- ===========================================================================
-- HELPER FUNCTIONS
-- ===========================================================================

-- Get the aide profile for a family member profile.
CREATE OR REPLACE FUNCTION public.get_aide_profile(
  p_profile_id UUID,
  p_tenant_id UUID
)
RETURNS TABLE (
  id UUID,
  profile_id UUID,
  primary_caregiver_id UUID,
  medical_info JSONB,
  emergency_contacts JSONB,
  mobility_level TEXT,
  cognitive_level TEXT,
  hearing_level TEXT,
  vision_level TEXT,
  preferred_interaction TEXT,
  confirmation_mode TEXT,
  speaking_pace TEXT,
  timezone TEXT
) AS $$
  SELECT
    ap.id, ap.profile_id, ap.primary_caregiver_id,
    ap.medical_info, ap.emergency_contacts,
    ap.mobility_level, ap.cognitive_level, ap.hearing_level, ap.vision_level,
    ap.preferred_interaction, ap.confirmation_mode, ap.speaking_pace,
    ap.timezone
  FROM aide_profiles ap
  WHERE ap.profile_id = p_profile_id
    AND ap.tenant_id = p_tenant_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Get pending medications for an aide profile within the next N minutes.
CREATE OR REPLACE FUNCTION public.get_due_medications(
  p_aide_profile_id UUID,
  p_tenant_id UUID,
  p_window_minutes INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  medication_name TEXT,
  dosage TEXT,
  instructions TEXT,
  scheduled_time TIME
) AS $$
  SELECT
    am.id, am.medication_name, am.dosage, am.instructions,
    t.scheduled_time
  FROM aide_medications am
  CROSS JOIN LATERAL unnest(am.scheduled_times) AS t(scheduled_time)
  WHERE am.aide_profile_id = p_aide_profile_id
    AND am.tenant_id = p_tenant_id
    AND am.is_active = true
    AND EXTRACT(DOW FROM now()) = ANY(am.days_of_week)
    AND t.scheduled_time BETWEEN
      (now()::time - make_interval(mins => p_window_minutes))::time
      AND (now()::time + make_interval(mins => p_window_minutes))::time;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Get the rate limit for assisted_living age group.
-- Updates the existing function to handle the new enum value.
-- Uses p_age_group::text to avoid "unsafe use of new enum value" within
-- the same transaction as ALTER TYPE ... ADD VALUE.
CREATE OR REPLACE FUNCTION public.get_family_rate_limit(p_age_group family_age_group)
RETURNS INTEGER AS $$
  SELECT CASE p_age_group::text
    WHEN 'adult'            THEN 60
    WHEN 'assisted_living'  THEN 60
    WHEN 'teenager'         THEN 30
    WHEN 'tween'            THEN 20
    WHEN 'child'            THEN 10
    WHEN 'toddler'          THEN 5
    WHEN 'adult_visitor'    THEN 15
    ELSE 10
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ===========================================================================
-- UPDATED_AT TRIGGERS
-- ===========================================================================

CREATE TRIGGER trg_aide_profiles_updated_at
  BEFORE UPDATE ON aide_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_aide_medications_updated_at
  BEFORE UPDATE ON aide_medications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_aide_routines_updated_at
  BEFORE UPDATE ON aide_routines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
