-- =============================================================================
-- Email & Calendar Monitoring via Home Assistant
-- =============================================================================
-- Adds tables for linked email/calendar accounts (Outlook via o365, Gmail via
-- IMAP/SMTP), cached email summaries and calendar events, automation alert
-- rules, and per-user notification preferences.
--
-- Email/calendar data accessed through HA integrations:
--   - Microsoft 365 (o365): Outlook inbox sensor + calendar entity
--   - Google Calendar: calendar entities via HA integration
--   - IMAP sensor: Gmail inbox monitoring (unread count)
--   - SMTP notify: Gmail outbound (DISABLED at app level via feature flag)
--
-- All PII fields encrypted via encrypt_pii() / hash_pii() per migrations 008-010.
-- =============================================================================

BEGIN;

-- ===========================================================================
-- PART 1: ENUM TYPES
-- ===========================================================================

DO $$ BEGIN
  CREATE TYPE email_provider AS ENUM (
    'gmail',     -- IMAP sensor + SMTP notify via HA
    'outlook'    -- Microsoft 365 (o365) integration via HA
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE calendar_provider AS ENUM (
    'google_calendar',   -- HA Google Calendar integration
    'outlook_calendar'   -- HA Microsoft 365 calendar entity
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE email_calendar_alert_type AS ENUM (
    'unread_email',      -- Unread count exceeds threshold
    'important_email',   -- Email from specific sender/domain
    'upcoming_event',    -- Event starting within N minutes
    'event_reminder',    -- Scheduled reminder before event
    'event_started',     -- Event just started (trigger automation)
    'daily_digest'       -- Daily email/calendar summary
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend consent_type for email/calendar data access (GDPR Art 6.1.a)
ALTER TYPE consent_type ADD VALUE IF NOT EXISTS 'email_data';
ALTER TYPE consent_type ADD VALUE IF NOT EXISTS 'calendar_data';

-- Extend audit_action for email/calendar events
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'email_account_linked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'email_account_unlinked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'email_sent';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'calendar_event_created';

-- ===========================================================================
-- PART 2: EMAIL ACCOUNTS TABLE
-- ===========================================================================
-- Linked email accounts per user. Each row maps to HA entities (inbox sensor,
-- notify service) for the provider. Email address is encrypted at rest.

CREATE TABLE IF NOT EXISTS public.email_accounts (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider                email_provider NOT NULL,

  -- HA entity references
  ha_inbox_entity_id      TEXT NOT NULL,     -- e.g. sensor.outlook_inbox_nick, sensor.imap_gmail
  ha_notify_service       TEXT,              -- e.g. notify.smtp_gmail, o365.send_email (null if send disabled)

  -- Identity (encrypted per migration 010 pattern)
  display_name_encrypted  TEXT NOT NULL,
  email_address_hash      TEXT NOT NULL,     -- hash_pii() for uniqueness/lookups
  email_address_encrypted TEXT NOT NULL,     -- encrypt_pii() for display

  is_active               BOOLEAN NOT NULL DEFAULT true,
  last_synced_at          TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_email_account UNIQUE (tenant_id, email_address_hash)
);

CREATE INDEX IF NOT EXISTS idx_email_accounts_tenant_user ON email_accounts (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_email_accounts_ha_entity ON email_accounts (ha_inbox_entity_id);

-- ===========================================================================
-- PART 3: CALENDAR ACCOUNTS TABLE
-- ===========================================================================
-- Linked calendar accounts per user. Each row maps to an HA calendar entity.

CREATE TABLE IF NOT EXISTS public.calendar_accounts (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider                calendar_provider NOT NULL,

  -- HA entity reference
  ha_entity_id            TEXT NOT NULL,     -- e.g. calendar.outlook_nick, calendar.google_personal

  display_name            TEXT NOT NULL,
  is_primary              BOOLEAN NOT NULL DEFAULT false,
  sync_enabled            BOOLEAN NOT NULL DEFAULT true,
  last_synced_at          TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_calendar_account UNIQUE (tenant_id, user_id, ha_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_accounts_tenant_user ON calendar_accounts (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_accounts_ha_entity ON calendar_accounts (ha_entity_id);

-- ===========================================================================
-- PART 4: EMAIL CACHE TABLE
-- ===========================================================================
-- Cached email summaries from HA inbox sensors. Data minimization: stores only
-- subject, sender, and a short snippet — never full email bodies.
-- Retention: 7 days (enforced by data-retention-cleanup edge function).

CREATE TABLE IF NOT EXISTS public.email_cache (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email_account_id        UUID NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,

  ha_message_id           TEXT NOT NULL,     -- HA-provided identifier for dedup
  subject_encrypted       TEXT NOT NULL,     -- encrypt_pii()
  sender_encrypted        TEXT NOT NULL,     -- encrypt_pii()
  snippet_encrypted       TEXT,              -- encrypt_pii() — first ~100 chars

  is_read                 BOOLEAN NOT NULL DEFAULT false,
  is_important            BOOLEAN NOT NULL DEFAULT false,
  received_at             TIMESTAMPTZ NOT NULL,
  cached_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_email_cache_msg UNIQUE (email_account_id, ha_message_id)
);

CREATE INDEX IF NOT EXISTS idx_email_cache_account_received ON email_cache (email_account_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_cache_tenant ON email_cache (tenant_id);

-- ===========================================================================
-- PART 5: CALENDAR EVENT CACHE TABLE
-- ===========================================================================
-- Cached calendar event summaries from HA calendar entities.
-- Retention: 30 days past event end date.

CREATE TABLE IF NOT EXISTS public.calendar_event_cache (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  calendar_account_id     UUID NOT NULL REFERENCES public.calendar_accounts(id) ON DELETE CASCADE,

  ha_event_id             TEXT NOT NULL,     -- HA-provided identifier for dedup
  summary_encrypted       TEXT NOT NULL,     -- encrypt_pii()
  description_encrypted   TEXT,              -- encrypt_pii() — short excerpt only
  location_encrypted      TEXT,              -- encrypt_pii()

  start_time              TIMESTAMPTZ NOT NULL,
  end_time                TIMESTAMPTZ NOT NULL,
  is_all_day              BOOLEAN NOT NULL DEFAULT false,
  cached_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_calendar_event_cache UNIQUE (calendar_account_id, ha_event_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_cache_start ON calendar_event_cache (calendar_account_id, start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_event_cache_tenant ON calendar_event_cache (tenant_id);

-- ===========================================================================
-- PART 6: ALERT RULES TABLE
-- ===========================================================================
-- User-configured automation triggers for email/calendar events.
-- Example conditions: {"from_domain": "company.com"}, {"minutes_before": 5}
-- Example actions: [{"type": "activate_scene", "scene": "meeting_mode"}]

CREATE TABLE IF NOT EXISTS public.email_calendar_alert_rules (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  alert_type              email_calendar_alert_type NOT NULL,
  conditions              JSONB NOT NULL DEFAULT '{}'::jsonb,
  actions                 JSONB NOT NULL DEFAULT '[]'::jsonb,

  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant_user ON email_calendar_alert_rules (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_active ON email_calendar_alert_rules (is_active, alert_type)
  WHERE is_active = true;

-- ===========================================================================
-- PART 7: NOTIFICATION PREFERENCES TABLE
-- ===========================================================================
-- Per-user email/calendar notification settings.

CREATE TABLE IF NOT EXISTS public.email_calendar_notification_prefs (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Email digest settings
  email_digest_enabled      BOOLEAN NOT NULL DEFAULT true,
  email_digest_time         TIME NOT NULL DEFAULT '08:00',

  -- Calendar reminder settings
  calendar_reminder_minutes INTEGER NOT NULL DEFAULT 15,

  -- Thresholds
  notify_unread_threshold   INTEGER NOT NULL DEFAULT 5,

  -- Channel routing (same format as user_messaging_preferences.preferred_channels)
  preferred_channels        TEXT[] NOT NULL DEFAULT '{push}',

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_email_cal_notif_prefs UNIQUE (tenant_id, user_id)
);

-- ===========================================================================
-- PART 8: ENABLE RLS
-- ===========================================================================

ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_accounts FORCE ROW LEVEL SECURITY;

ALTER TABLE calendar_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_accounts FORCE ROW LEVEL SECURITY;

ALTER TABLE email_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_cache FORCE ROW LEVEL SECURITY;

ALTER TABLE calendar_event_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event_cache FORCE ROW LEVEL SECURITY;

ALTER TABLE email_calendar_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_calendar_alert_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE email_calendar_notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_calendar_notification_prefs FORCE ROW LEVEL SECURITY;

-- ===========================================================================
-- PART 9: RLS POLICIES — email_accounts
-- ===========================================================================
-- DROP before CREATE for idempotent re-runs (PostgreSQL has no CREATE POLICY IF NOT EXISTS)

DROP POLICY IF EXISTS email_accounts_select ON email_accounts;
CREATE POLICY email_accounts_select ON email_accounts
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

DROP POLICY IF EXISTS email_accounts_insert ON email_accounts;
CREATE POLICY email_accounts_insert ON email_accounts
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

DROP POLICY IF EXISTS email_accounts_update ON email_accounts;
CREATE POLICY email_accounts_update ON email_accounts
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

DROP POLICY IF EXISTS email_accounts_delete ON email_accounts;
CREATE POLICY email_accounts_delete ON email_accounts
  FOR DELETE USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

-- ===========================================================================
-- PART 10: RLS POLICIES — calendar_accounts
-- ===========================================================================

DROP POLICY IF EXISTS calendar_accounts_select ON calendar_accounts;
CREATE POLICY calendar_accounts_select ON calendar_accounts
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

DROP POLICY IF EXISTS calendar_accounts_insert ON calendar_accounts;
CREATE POLICY calendar_accounts_insert ON calendar_accounts
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

DROP POLICY IF EXISTS calendar_accounts_update ON calendar_accounts;
CREATE POLICY calendar_accounts_update ON calendar_accounts
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

DROP POLICY IF EXISTS calendar_accounts_delete ON calendar_accounts;
CREATE POLICY calendar_accounts_delete ON calendar_accounts
  FOR DELETE USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

-- ===========================================================================
-- PART 11: RLS POLICIES — email_cache (owner only, no admin access)
-- ===========================================================================

DROP POLICY IF EXISTS email_cache_select ON email_cache;
CREATE POLICY email_cache_select ON email_cache
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND email_account_id IN (
      SELECT id FROM email_accounts
      WHERE user_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

DROP POLICY IF EXISTS email_cache_insert ON email_cache;
CREATE POLICY email_cache_insert ON email_cache
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND email_account_id IN (
      SELECT id FROM email_accounts
      WHERE user_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

DROP POLICY IF EXISTS email_cache_delete ON email_cache;
CREATE POLICY email_cache_delete ON email_cache
  FOR DELETE USING (
    tenant_id = requesting_tenant_id()
    AND email_account_id IN (
      SELECT id FROM email_accounts
      WHERE user_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

-- ===========================================================================
-- PART 12: RLS POLICIES — calendar_event_cache (owner only)
-- ===========================================================================

DROP POLICY IF EXISTS calendar_event_cache_select ON calendar_event_cache;
CREATE POLICY calendar_event_cache_select ON calendar_event_cache
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND calendar_account_id IN (
      SELECT id FROM calendar_accounts
      WHERE user_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

DROP POLICY IF EXISTS calendar_event_cache_insert ON calendar_event_cache;
CREATE POLICY calendar_event_cache_insert ON calendar_event_cache
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND calendar_account_id IN (
      SELECT id FROM calendar_accounts
      WHERE user_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

DROP POLICY IF EXISTS calendar_event_cache_delete ON calendar_event_cache;
CREATE POLICY calendar_event_cache_delete ON calendar_event_cache
  FOR DELETE USING (
    tenant_id = requesting_tenant_id()
    AND calendar_account_id IN (
      SELECT id FROM calendar_accounts
      WHERE user_id = requesting_user_id() AND tenant_id = requesting_tenant_id()
    )
  );

-- ===========================================================================
-- PART 13: RLS POLICIES — email_calendar_alert_rules
-- ===========================================================================

DROP POLICY IF EXISTS alert_rules_select ON email_calendar_alert_rules;
CREATE POLICY alert_rules_select ON email_calendar_alert_rules
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

DROP POLICY IF EXISTS alert_rules_insert ON email_calendar_alert_rules;
CREATE POLICY alert_rules_insert ON email_calendar_alert_rules
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

DROP POLICY IF EXISTS alert_rules_update ON email_calendar_alert_rules;
CREATE POLICY alert_rules_update ON email_calendar_alert_rules
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

DROP POLICY IF EXISTS alert_rules_delete ON email_calendar_alert_rules;
CREATE POLICY alert_rules_delete ON email_calendar_alert_rules
  FOR DELETE USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

-- ===========================================================================
-- PART 14: RLS POLICIES — email_calendar_notification_prefs
-- ===========================================================================

DROP POLICY IF EXISTS email_cal_notif_prefs_select ON email_calendar_notification_prefs;
CREATE POLICY email_cal_notif_prefs_select ON email_calendar_notification_prefs
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

DROP POLICY IF EXISTS email_cal_notif_prefs_insert ON email_calendar_notification_prefs;
CREATE POLICY email_cal_notif_prefs_insert ON email_calendar_notification_prefs
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

DROP POLICY IF EXISTS email_cal_notif_prefs_update ON email_calendar_notification_prefs;
CREATE POLICY email_cal_notif_prefs_update ON email_calendar_notification_prefs
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 15: TRIGGERS
-- ===========================================================================

DROP TRIGGER IF EXISTS trg_email_accounts_updated_at ON email_accounts;
CREATE TRIGGER trg_email_accounts_updated_at
  BEFORE UPDATE ON email_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_calendar_accounts_updated_at ON calendar_accounts;
CREATE TRIGGER trg_calendar_accounts_updated_at
  BEFORE UPDATE ON calendar_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_alert_rules_updated_at ON email_calendar_alert_rules;
CREATE TRIGGER trg_alert_rules_updated_at
  BEFORE UPDATE ON email_calendar_alert_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_email_cal_notif_prefs_updated_at ON email_calendar_notification_prefs;
CREATE TRIGGER trg_email_cal_notif_prefs_updated_at
  BEFORE UPDATE ON email_calendar_notification_prefs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================================================================
-- PART 16: HELPER FUNCTIONS
-- ===========================================================================

-- Get unread email count across all accounts for a user
CREATE OR REPLACE FUNCTION public.get_unread_email_count(
  p_user_id UUID,
  p_tenant_id UUID
)
RETURNS INTEGER AS $$
  SELECT COALESCE(COUNT(*)::INTEGER, 0)
  FROM email_cache ec
  JOIN email_accounts ea ON ec.email_account_id = ea.id
  WHERE ea.user_id = p_user_id
    AND ea.tenant_id = p_tenant_id
    AND ea.is_active = true
    AND ec.is_read = false;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Get upcoming events within the next N hours for a user
CREATE OR REPLACE FUNCTION public.get_upcoming_events(
  p_user_id UUID,
  p_tenant_id UUID,
  p_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
  event_id UUID,
  calendar_account_id UUID,
  summary_encrypted TEXT,
  location_encrypted TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  is_all_day BOOLEAN
) AS $$
  SELECT
    cec.id,
    cec.calendar_account_id,
    cec.summary_encrypted,
    cec.location_encrypted,
    cec.start_time,
    cec.end_time,
    cec.is_all_day
  FROM calendar_event_cache cec
  JOIN calendar_accounts ca ON cec.calendar_account_id = ca.id
  WHERE ca.user_id = p_user_id
    AND ca.tenant_id = p_tenant_id
    AND ca.sync_enabled = true
    AND cec.start_time >= now()
    AND cec.start_time <= now() + (p_hours || ' hours')::INTERVAL
  ORDER BY cec.start_time ASC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ===========================================================================
-- PART 17: DATA RETENTION CLEANUP
-- ===========================================================================
-- Email cache: 7 days retention
-- Calendar event cache: 30 days past event end date

CREATE OR REPLACE FUNCTION public.cleanup_email_calendar_retention()
RETURNS JSONB AS $$
DECLARE
  email_deleted INTEGER;
  calendar_deleted INTEGER;
BEGIN
  -- Delete email cache entries older than 7 days
  DELETE FROM email_cache
  WHERE cached_at < now() - INTERVAL '7 days';
  GET DIAGNOSTICS email_deleted = ROW_COUNT;

  -- Delete calendar event cache entries 30 days past end date
  DELETE FROM calendar_event_cache
  WHERE end_time < now() - INTERVAL '30 days';
  GET DIAGNOSTICS calendar_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'email_cache_deleted', email_deleted,
    'calendar_event_cache_deleted', calendar_deleted
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
