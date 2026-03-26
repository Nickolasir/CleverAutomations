-- =============================================================================
-- Messaging Configuration: WhatsApp & Telegram Integration
-- =============================================================================
-- Adds user-level notification preferences for all verticals (WhatsApp,
-- Telegram, push, email) and a Telegram bot-linking token table.
-- Also extends aide_profiles with a messaging_config JSONB column for
-- caregiver-specific alert channel configuration.
--
-- All tables enforce tenant isolation via RLS using public.requesting_tenant_id().
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. user_messaging_preferences
-- ---------------------------------------------------------------------------
-- Per-user notification channel configuration. Every user across all verticals
-- (CleverHome, CleverHost, CleverBuilding) can configure their preferred
-- notification channels and alert types here.

CREATE TABLE IF NOT EXISTS public.user_messaging_preferences (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- WhatsApp (E.164 format, e.g. +15551234567)
  whatsapp_phone        TEXT,
  whatsapp_verified     BOOLEAN NOT NULL DEFAULT false,

  -- Telegram
  telegram_chat_id      TEXT,
  telegram_verified     BOOLEAN NOT NULL DEFAULT false,
  telegram_username     TEXT,

  -- Standard channels
  email_notifications   BOOLEAN NOT NULL DEFAULT true,
  push_notifications    BOOLEAN NOT NULL DEFAULT true,

  -- Ordered priority list of notification channels
  preferred_channels    TEXT[] NOT NULL DEFAULT '{push}',

  -- Notification type toggles (vertical-aware)
  notify_device_offline   BOOLEAN NOT NULL DEFAULT true,
  notify_security_alert   BOOLEAN NOT NULL DEFAULT true,
  notify_guest_arrival    BOOLEAN NOT NULL DEFAULT false,
  notify_maintenance_due  BOOLEAN NOT NULL DEFAULT false,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(tenant_id, user_id)
);

CREATE INDEX idx_user_msg_prefs_tenant ON user_messaging_preferences (tenant_id);
CREATE INDEX idx_user_msg_prefs_user ON user_messaging_preferences (user_id);
CREATE INDEX idx_user_msg_prefs_telegram ON user_messaging_preferences (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;
CREATE INDEX idx_user_msg_prefs_whatsapp ON user_messaging_preferences (whatsapp_phone)
  WHERE whatsapp_phone IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. telegram_link_tokens
-- ---------------------------------------------------------------------------
-- Ephemeral tokens for the Telegram bot deep-link flow.
-- User clicks a link containing the token, Telegram sends /start {token}
-- to the bot webhook, which looks up the token and stores the chat_id.

CREATE TABLE IF NOT EXISTS public.telegram_link_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  link_token      TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_telegram_link_tokens_token ON telegram_link_tokens (link_token)
  WHERE NOT consumed;

-- ---------------------------------------------------------------------------
-- 3. Add messaging_config to aide_profiles
-- ---------------------------------------------------------------------------
-- Stores CaregiverMessagingConfig shape for caregiver-specific alert routing.

ALTER TABLE public.aide_profiles
  ADD COLUMN IF NOT EXISTS messaging_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ===========================================================================
-- ENABLE RLS
-- ===========================================================================

ALTER TABLE user_messaging_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_messaging_preferences FORCE ROW LEVEL SECURITY;

ALTER TABLE telegram_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_link_tokens FORCE ROW LEVEL SECURITY;

-- ===========================================================================
-- RLS POLICIES — user_messaging_preferences
-- ===========================================================================

-- Users can read their own preferences; admins can read all within tenant
CREATE POLICY user_msg_prefs_select ON user_messaging_preferences
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

-- Users can insert their own row
CREATE POLICY user_msg_prefs_insert ON user_messaging_preferences
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- Users can update their own row; admins can update any within tenant
CREATE POLICY user_msg_prefs_update ON user_messaging_preferences
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND (user_id = requesting_user_id() OR role_at_least('admin'))
  );

-- Only admins can delete
CREATE POLICY user_msg_prefs_delete ON user_messaging_preferences
  FOR DELETE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

-- ===========================================================================
-- RLS POLICIES — telegram_link_tokens
-- ===========================================================================

-- Users can read their own tokens
CREATE POLICY telegram_tokens_select ON telegram_link_tokens
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- Users can insert their own tokens
CREATE POLICY telegram_tokens_insert ON telegram_link_tokens
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- Updates are done by service role only (webhook consuming the token)
-- No user-facing update policy needed; service role bypasses RLS.

-- Only admins can delete
CREATE POLICY telegram_tokens_delete ON telegram_link_tokens
  FOR DELETE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

-- ===========================================================================
-- UPDATED_AT TRIGGER
-- ===========================================================================

CREATE TRIGGER trg_user_msg_prefs_updated_at
  BEFORE UPDATE ON user_messaging_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
