-- =============================================================================
-- Communications Privacy & Family Messaging
-- =============================================================================
-- Builds on migration 013 (email_accounts, calendar_accounts) to add:
--   - OAuth2 token storage for direct email access (per-user encrypted)
--   - Privacy-respecting email access policies (parental monitoring levels)
--   - Email access audit logging (who accessed whose email, when)
--   - In-app family messaging (announcements, private messages, delegated email)
--   - Email delegation grants (parent managing child's email)
--   - Email rate limiting (prevent mass sending)
--   - Shared calendar visibility toggle
--
-- All PII fields encrypted via encrypt_pii() / encrypt_pii_user() per
-- migrations 008-010 and 014. OAuth tokens use per-user encryption so
-- even tenant admins cannot read them.
-- =============================================================================

BEGIN;

-- ===========================================================================
-- PART 1: ENUM TYPES
-- ===========================================================================

DO $$ BEGIN
  CREATE TYPE email_auth_provider AS ENUM (
    'gmail_oauth',       -- Google OAuth2
    'outlook_oauth',     -- Microsoft OAuth2
    'imap_custom'        -- Custom IMAP credentials
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE email_access_level AS ENUM (
    'full_private',          -- Only the user can access their email
    'parental_monitoring',   -- Parent can view (read-only) with audit trail
    'parental_managed'       -- Parent has full send/receive delegation
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE message_channel_type AS ENUM (
    'family_announcement',   -- Broadcast to all tenant members
    'private_message',       -- 1:1 between family members
    'email_delegation'       -- Message sent on behalf of child by parent
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend audit_action for communications events
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'email_accessed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'email_access_audit';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'email_delegation_granted';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'email_delegation_revoked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'family_message_sent';

-- ===========================================================================
-- PART 2: EMAIL OAUTH TOKENS TABLE
-- ===========================================================================
-- Per-user encrypted OAuth2 tokens for direct email access. Uses per-user
-- encryption (encrypt_pii_user) so tokens cannot be decrypted by tenant
-- admins or other users.

CREATE TABLE IF NOT EXISTS public.email_oauth_tokens (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email_account_id          UUID NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,

  -- Encrypted with per-user key (encrypt_pii_user)
  access_token_encrypted    TEXT NOT NULL,
  refresh_token_encrypted   TEXT NOT NULL,

  token_expiry              TIMESTAMPTZ,
  scopes                    TEXT[],
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_oauth_tokens_user ON email_oauth_tokens (tenant_id, user_id);
CREATE INDEX idx_email_oauth_tokens_account ON email_oauth_tokens (email_account_id);

-- ===========================================================================
-- PART 3: EMAIL ACCESS POLICIES TABLE
-- ===========================================================================
-- Per-user privacy settings that control who can access their email and
-- under what conditions.

CREATE TABLE IF NOT EXISTS public.email_access_policies (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  profile_id                      UUID REFERENCES public.family_member_profiles(id) ON DELETE CASCADE,

  access_level                    email_access_level NOT NULL,
  elevated_auth_required          BOOLEAN NOT NULL DEFAULT true,
  session_duration_minutes        INTEGER NOT NULL DEFAULT 15,

  -- Which parent monitors (null if full_private)
  parent_monitoring_user_id       UUID REFERENCES public.users(id),
  monitoring_notification_enabled BOOLEAN NOT NULL DEFAULT true,

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_email_access_policy UNIQUE (tenant_id, user_id)
);

CREATE INDEX idx_email_access_policies_user ON email_access_policies (tenant_id, user_id);

-- ===========================================================================
-- PART 4: EMAIL ACCESS AUDIT LOG TABLE
-- ===========================================================================
-- Records every instance of one user accessing another user's email.
-- Critical for parental monitoring transparency and GDPR accountability.

CREATE TABLE IF NOT EXISTS public.email_access_audit_log (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  accessor_user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  access_type           TEXT NOT NULL,
  elevated_session_id   UUID REFERENCES public.user_auth_sessions(id),
  action                TEXT NOT NULL,
  metadata              JSONB DEFAULT '{}'::jsonb,
  accessed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_access_audit_accessor ON email_access_audit_log (tenant_id, accessor_user_id, accessed_at DESC);
CREATE INDEX idx_email_access_audit_target ON email_access_audit_log (tenant_id, target_user_id, accessed_at DESC);

-- ===========================================================================
-- PART 5: FAMILY MESSAGES TABLE
-- ===========================================================================
-- In-app family messaging. Content encrypted with tenant key (not user key)
-- so that recipients can decrypt messages sent to them.

CREATE TABLE IF NOT EXISTS public.family_messages (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sender_user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  channel_type          message_channel_type NOT NULL,
  recipient_user_id     UUID REFERENCES public.users(id),   -- null for announcements

  -- Encrypted with tenant key (encrypt_pii) so recipients can read
  content_encrypted     TEXT NOT NULL,

  is_read               BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_family_messages_sender ON family_messages (tenant_id, sender_user_id, created_at DESC);
CREATE INDEX idx_family_messages_recipient ON family_messages (tenant_id, recipient_user_id, created_at DESC)
  WHERE recipient_user_id IS NOT NULL;
CREATE INDEX idx_family_messages_announcements ON family_messages (tenant_id, created_at DESC)
  WHERE channel_type = 'family_announcement';

-- ===========================================================================
-- PART 6: EMAIL DELEGATION GRANTS TABLE
-- ===========================================================================
-- Parent managing child's email. Tracks consent and revocation.

CREATE TABLE IF NOT EXISTS public.email_delegation_grants (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_user_id            UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  child_user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  child_consent_recorded    BOOLEAN NOT NULL DEFAULT false,
  granted_at                TIMESTAMPTZ,
  revoked_at                TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_delegation_parent ON email_delegation_grants (tenant_id, parent_user_id);
CREATE INDEX idx_email_delegation_child ON email_delegation_grants (tenant_id, child_user_id);

-- ===========================================================================
-- PART 7: EMAIL RATE LIMITS TABLE
-- ===========================================================================
-- Prevent mass sending by enforcing per-user daily send limits.

CREATE TABLE IF NOT EXISTS public.email_rate_limits (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  profile_id            UUID REFERENCES public.family_member_profiles(id) ON DELETE CASCADE,

  daily_send_limit      INTEGER NOT NULL,
  current_daily_count   INTEGER NOT NULL DEFAULT 0,
  count_reset_at        TIMESTAMPTZ NOT NULL DEFAULT now()::date + INTERVAL '1 day',

  CONSTRAINT uq_email_rate_limit UNIQUE (tenant_id, user_id)
);

-- ===========================================================================
-- PART 8: ALTER EXISTING TABLES
-- ===========================================================================
-- Add shared_with_family column to calendar_accounts (from migration 013)

ALTER TABLE public.calendar_accounts
  ADD COLUMN IF NOT EXISTS shared_with_family BOOLEAN NOT NULL DEFAULT false;

-- ===========================================================================
-- PART 9: ENABLE RLS
-- ===========================================================================

ALTER TABLE email_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_oauth_tokens FORCE ROW LEVEL SECURITY;

ALTER TABLE email_access_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_access_policies FORCE ROW LEVEL SECURITY;

ALTER TABLE email_access_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_access_audit_log FORCE ROW LEVEL SECURITY;

ALTER TABLE family_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_messages FORCE ROW LEVEL SECURITY;

ALTER TABLE email_delegation_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_delegation_grants FORCE ROW LEVEL SECURITY;

ALTER TABLE email_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_rate_limits FORCE ROW LEVEL SECURITY;

-- ===========================================================================
-- PART 10: RLS POLICIES — email_oauth_tokens (user-only, NO admin access)
-- ===========================================================================
-- OAuth tokens are deeply personal. Even tenant admins cannot access them.

CREATE POLICY email_oauth_tokens_select ON email_oauth_tokens
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY email_oauth_tokens_insert ON email_oauth_tokens
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY email_oauth_tokens_update ON email_oauth_tokens
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY email_oauth_tokens_delete ON email_oauth_tokens
  FOR DELETE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 11: RLS POLICIES — email_access_policies
-- ===========================================================================
-- User reads own policy. Parent reads child's policy via active delegation.

CREATE POLICY email_access_policies_select ON email_access_policies
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND (
      user_id = requesting_user_id()
      OR EXISTS (
        SELECT 1 FROM email_delegation_grants edg
        WHERE edg.parent_user_id = requesting_user_id()
          AND edg.child_user_id = email_access_policies.user_id
          AND edg.tenant_id = email_access_policies.tenant_id
          AND edg.granted_at IS NOT NULL
          AND edg.revoked_at IS NULL
      )
    )
  );

CREATE POLICY email_access_policies_insert ON email_access_policies
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY email_access_policies_update ON email_access_policies
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 12: RLS POLICIES — email_access_audit_log
-- ===========================================================================
-- Accessor or target can read their own rows.

CREATE POLICY email_access_audit_log_select ON email_access_audit_log
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND (
      accessor_user_id = requesting_user_id()
      OR target_user_id = requesting_user_id()
    )
  );

CREATE POLICY email_access_audit_log_insert ON email_access_audit_log
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND accessor_user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 13: RLS POLICIES — family_messages
-- ===========================================================================
-- Sender can INSERT. Recipient or sender can SELECT. Announcements visible
-- to all tenant members. UPDATE (mark read) by recipient only.

CREATE POLICY family_messages_insert ON family_messages
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND sender_user_id = requesting_user_id()
  );

CREATE POLICY family_messages_select ON family_messages
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND (
      sender_user_id = requesting_user_id()
      OR recipient_user_id = requesting_user_id()
      OR channel_type = 'family_announcement'
    )
  );

CREATE POLICY family_messages_update ON family_messages
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND recipient_user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 14: RLS POLICIES — email_delegation_grants
-- ===========================================================================
-- Parent can INSERT/UPDATE. Child can SELECT own grants.

CREATE POLICY email_delegation_grants_select ON email_delegation_grants
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND (
      parent_user_id = requesting_user_id()
      OR child_user_id = requesting_user_id()
    )
  );

CREATE POLICY email_delegation_grants_insert ON email_delegation_grants
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND parent_user_id = requesting_user_id()
  );

CREATE POLICY email_delegation_grants_update ON email_delegation_grants
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND parent_user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 15: RLS POLICIES — email_rate_limits
-- ===========================================================================
-- User reads own. Admin can update (to adjust limits).

CREATE POLICY email_rate_limits_select ON email_rate_limits
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

CREATE POLICY email_rate_limits_insert ON email_rate_limits
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

CREATE POLICY email_rate_limits_update ON email_rate_limits
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

-- ===========================================================================
-- PART 16: TRIGGERS
-- ===========================================================================

CREATE TRIGGER trg_email_oauth_tokens_updated_at
  BEFORE UPDATE ON email_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_email_access_policies_updated_at
  BEFORE UPDATE ON email_access_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================================================================
-- PART 17: HELPER FUNCTIONS
-- ===========================================================================

-- Check if an accessor has permission to read a target user's email
CREATE OR REPLACE FUNCTION public.check_email_access(
  p_accessor_id UUID,
  p_target_id UUID,
  p_tenant_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_policy RECORD;
  v_has_delegation BOOLEAN;
BEGIN
  -- Self-access is always allowed
  IF p_accessor_id = p_target_id THEN
    RETURN true;
  END IF;

  -- Check target's access policy
  SELECT * INTO v_policy
  FROM email_access_policies
  WHERE user_id = p_target_id
    AND tenant_id = p_tenant_id;

  -- No policy means full_private (default deny)
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- full_private means only self (already checked above)
  IF v_policy.access_level = 'full_private' THEN
    RETURN false;
  END IF;

  -- Check if accessor has an active delegation grant for the target
  SELECT EXISTS (
    SELECT 1 FROM email_delegation_grants
    WHERE parent_user_id = p_accessor_id
      AND child_user_id = p_target_id
      AND tenant_id = p_tenant_id
      AND granted_at IS NOT NULL
      AND revoked_at IS NULL
  ) INTO v_has_delegation;

  IF NOT v_has_delegation THEN
    RETURN false;
  END IF;

  -- parental_monitoring or parental_managed: accessor must be the monitoring parent
  IF v_policy.parent_monitoring_user_id IS NOT NULL
     AND v_policy.parent_monitoring_user_id != p_accessor_id THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Get remaining email sends for a user today
CREATE OR REPLACE FUNCTION public.get_email_rate_limit_remaining(
  p_user_id UUID,
  p_tenant_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_record RECORD;
BEGIN
  SELECT * INTO v_record
  FROM email_rate_limits
  WHERE user_id = p_user_id
    AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Reset count if past the reset time
  IF v_record.count_reset_at <= now() THEN
    RETURN v_record.daily_send_limit;
  END IF;

  RETURN GREATEST(v_record.daily_send_limit - v_record.current_daily_count, 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Increment rate limit counter, return false if exceeded
CREATE OR REPLACE FUNCTION public.enforce_email_rate_limit(
  p_user_id UUID,
  p_tenant_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_record RECORD;
BEGIN
  SELECT * INTO v_record
  FROM email_rate_limits
  WHERE user_id = p_user_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Reset count if past the reset time
  IF v_record.count_reset_at <= now() THEN
    UPDATE email_rate_limits
    SET current_daily_count = 1,
        count_reset_at = now()::date + INTERVAL '1 day'
    WHERE id = v_record.id;
    RETURN true;
  END IF;

  -- Check if limit exceeded
  IF v_record.current_daily_count >= v_record.daily_send_limit THEN
    RETURN false;
  END IF;

  -- Increment counter
  UPDATE email_rate_limits
  SET current_daily_count = v_record.current_daily_count + 1
  WHERE id = v_record.id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================================================
-- PART 18: DATA RETENTION POLICY DEFAULTS
-- ===========================================================================
-- Add retention period defaults for the new tables. These are added to the
-- tenant's data_retention_policy JSONB column (from migration 011).

UPDATE tenants
SET data_retention_policy = data_retention_policy
  || '{"food_logs_days": 365, "water_logs_days": 90, "email_access_audit_log_days": 180, "family_messages_days": 365}'::jsonb
WHERE NOT (data_retention_policy ? 'food_logs_days');

-- ===========================================================================
-- PART 19: EXTEND DATA RETENTION ENFORCEMENT FUNCTION
-- ===========================================================================
-- Re-create enforce_data_retention to include the new tables.

CREATE OR REPLACE FUNCTION public.enforce_data_retention(p_tenant_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_policy JSONB;
  v_result JSONB := '{}'::jsonb;
  v_count BIGINT;
BEGIN
  -- Load tenant's retention policy
  SELECT data_retention_policy INTO v_policy
  FROM tenants WHERE id = p_tenant_id;

  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'Tenant % not found or has no retention policy', p_tenant_id;
  END IF;

  -- 1. Audit logs
  DELETE FROM audit_logs
  WHERE tenant_id = p_tenant_id
    AND created_at < now() - make_interval(days => (v_policy->>'audit_logs_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('audit_logs_deleted', v_count);

  -- 2. Sensor telemetry
  DELETE FROM sensor_telemetry
  WHERE tenant_id = p_tenant_id
    AND recorded_at < now() - make_interval(days => (v_policy->>'sensor_telemetry_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('sensor_telemetry_deleted', v_count);

  -- 3. Aide activity log
  DELETE FROM aide_activity_log
  WHERE tenant_id = p_tenant_id
    AND created_at < now() - make_interval(days => (v_policy->>'aide_activity_log_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('aide_activity_log_deleted', v_count);

  -- 4. Aide medication logs
  DELETE FROM aide_medication_logs
  WHERE tenant_id = p_tenant_id
    AND created_at < now() - make_interval(days => (v_policy->>'aide_medication_logs_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('aide_medication_logs_deleted', v_count);

  -- 5. Aide wellness check-ins
  DELETE FROM aide_wellness_checkins
  WHERE tenant_id = p_tenant_id
    AND created_at < now() - make_interval(days => (v_policy->>'aide_wellness_checkins_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('aide_wellness_checkins_deleted', v_count);

  -- 6. Voice sessions
  DELETE FROM voice_sessions
  WHERE tenant_id = p_tenant_id
    AND created_at < now() - make_interval(days => (v_policy->>'voice_sessions_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('voice_sessions_deleted', v_count);

  -- 7. Voice transcripts
  DELETE FROM voice_transcripts
  WHERE tenant_id = p_tenant_id
    AND created_at < now() - make_interval(days => (v_policy->>'voice_transcripts_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('voice_transcripts_deleted', v_count);

  -- 8. Expired guest profiles
  DELETE FROM guest_profiles
  WHERE tenant_id = p_tenant_id
    AND expires_at IS NOT NULL
    AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('expired_guest_profiles_deleted', v_count);

  -- 9. IP address truncation (nullify hash after N days for privacy)
  UPDATE audit_logs
  SET ip_address_hash = NULL
  WHERE tenant_id = p_tenant_id
    AND ip_address_hash IS NOT NULL
    AND created_at < now() - make_interval(days => (v_policy->>'ip_truncation_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('ip_hashes_truncated', v_count);

  -- 10. Food logs (365 days)
  IF v_policy ? 'food_logs_days' THEN
    DELETE FROM food_logs
    WHERE tenant_id = p_tenant_id
      AND created_at < now() - make_interval(days => (v_policy->>'food_logs_days')::int);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('food_logs_deleted', v_count);
  END IF;

  -- 11. Water logs (90 days)
  IF v_policy ? 'water_logs_days' THEN
    DELETE FROM water_logs
    WHERE tenant_id = p_tenant_id
      AND created_at < now() - make_interval(days => (v_policy->>'water_logs_days')::int);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('water_logs_deleted', v_count);
  END IF;

  -- 12. Email access audit log (180 days)
  IF v_policy ? 'email_access_audit_log_days' THEN
    DELETE FROM email_access_audit_log
    WHERE tenant_id = p_tenant_id
      AND accessed_at < now() - make_interval(days => (v_policy->>'email_access_audit_log_days')::int);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('email_access_audit_log_deleted', v_count);
  END IF;

  -- 13. Family messages (365 days)
  IF v_policy ? 'family_messages_days' THEN
    DELETE FROM family_messages
    WHERE tenant_id = p_tenant_id
      AND created_at < now() - make_interval(days => (v_policy->>'family_messages_days')::int);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('family_messages_deleted', v_count);
  END IF;

  -- Log the retention enforcement itself
  INSERT INTO audit_logs (tenant_id, action, details, created_at)
  VALUES (
    p_tenant_id,
    'settings_changed',
    jsonb_build_object(
      'operation', 'data_retention_enforcement',
      'results', v_result
    ),
    now()
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
