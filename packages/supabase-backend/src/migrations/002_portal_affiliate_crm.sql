-- ---------------------------------------------------------------------------==
-- Migration 002: Client Portal, Affiliate Program & CRM
-- ---------------------------------------------------------------------------==
-- Adds tables for:
--   - Affiliate program (web.affiliates, web.referrals)
--   - CRM system (web.crm_admins, web.crm_notes, web.crm_activities)
--   - Enhanced leads (additional columns)
-- ---------------------------------------------------------------------------==

BEGIN;

-- Create the web schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS web;

-- Grant usage to roles so RLS and queries work
GRANT USAGE ON SCHEMA web TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA web TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA web GRANT ALL ON TABLES TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. AFFILIATES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS web.affiliates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email           TEXT NOT NULL,
  name            TEXT NOT NULL,
  company         TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  profession      TEXT NOT NULL DEFAULT '',
  referral_code   TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  payout_method   TEXT NOT NULL DEFAULT 'manual'
                  CHECK (payout_method IN ('manual', 'stripe_connect')),
  stripe_account_id TEXT,
  payout_details  JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes           TEXT NOT NULL DEFAULT '',
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_web_affiliates_email ON web.affiliates (email);
CREATE INDEX IF NOT EXISTS idx_web_affiliates_referral_code ON web.affiliates (referral_code);
CREATE INDEX IF NOT EXISTS idx_web_affiliates_user_id ON web.affiliates (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_web_affiliates_status ON web.affiliates (status);

-- ---------------------------------------------------------------------------
-- 1b. LEADS (must exist before referrals FK)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS web.leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  company         TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  vertical        TEXT,
  unit_count      INTEGER,
  message         TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'website',
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  status          TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'contacted', 'qualified', 'converted', 'closed')),
  converted_user_id UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_leads_email ON web.leads (email);
CREATE INDEX IF NOT EXISTS idx_web_leads_status ON web.leads (status);
CREATE INDEX IF NOT EXISTS idx_web_leads_created ON web.leads (created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. REFERRALS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS web.referrals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id    UUID NOT NULL REFERENCES web.affiliates(id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES web.leads(id) ON DELETE SET NULL,
  order_id        UUID,  -- FK to public.orders added when orders table exists
  referred_email  TEXT NOT NULL,
  referred_name   TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'clicked'
                  CHECK (status IN ('clicked', 'lead', 'consultation', 'converted', 'paid_out')),
  commission      NUMERIC(10,2) NOT NULL DEFAULT 500.00,
  stripe_transfer_id TEXT,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_referrals_affiliate_id ON web.referrals (affiliate_id);
CREATE INDEX IF NOT EXISTS idx_web_referrals_status ON web.referrals (status);
CREATE INDEX IF NOT EXISTS idx_web_referrals_lead_id ON web.referrals (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_web_referrals_order_id ON web.referrals (order_id) WHERE order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. CRM ADMINS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS web.crm_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION web.is_crm_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM web.crm_admins WHERE user_id = auth.uid());
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 4. CRM NOTES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS web.crm_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('lead', 'affiliate', 'order', 'customer')),
  entity_id   UUID NOT NULL,
  author_id   UUID NOT NULL REFERENCES auth.users(id),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_crm_notes_entity ON web.crm_notes (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_web_crm_notes_author ON web.crm_notes (author_id);

-- ---------------------------------------------------------------------------
-- 5. CRM ACTIVITIES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS web.crm_activities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('lead', 'affiliate', 'order', 'customer')),
  entity_id   UUID NOT NULL,
  actor_id    UUID REFERENCES auth.users(id),
  action      TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_crm_activities_entity ON web.crm_activities (entity_type, entity_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. ALTER web.leads — add CRM fields
-- ---------------------------------------------------------------------------

ALTER TABLE web.leads ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id);
ALTER TABLE web.leads ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMPTZ;
ALTER TABLE web.leads ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE web.leads ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'consultation'
  CHECK (source_type IN ('consultation', 'contact_form', 'affiliate', 'manual'));

-- ---------------------------------------------------------------------------
-- 7. RLS POLICIES
-- ---------------------------------------------------------------------------

-- Affiliates
ALTER TABLE web.affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE web.affiliates FORCE ROW LEVEL SECURITY;

CREATE POLICY affiliates_select_own ON web.affiliates
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY affiliates_select_admin ON web.affiliates
  FOR SELECT USING (web.is_crm_admin());
CREATE POLICY affiliates_insert_anon ON web.affiliates
  FOR INSERT WITH CHECK (true);
CREATE POLICY affiliates_update_admin ON web.affiliates
  FOR UPDATE USING (web.is_crm_admin());

-- Referrals
ALTER TABLE web.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE web.referrals FORCE ROW LEVEL SECURITY;

CREATE POLICY referrals_select_own ON web.referrals
  FOR SELECT USING (
    affiliate_id IN (
      SELECT id FROM web.affiliates WHERE user_id = auth.uid()
    )
  );
CREATE POLICY referrals_select_admin ON web.referrals
  FOR SELECT USING (web.is_crm_admin());
CREATE POLICY referrals_insert_service ON web.referrals
  FOR INSERT WITH CHECK (true);  -- Service role inserts via API routes
CREATE POLICY referrals_update_admin ON web.referrals
  FOR UPDATE USING (web.is_crm_admin());

-- CRM Admins
ALTER TABLE web.crm_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE web.crm_admins FORCE ROW LEVEL SECURITY;

CREATE POLICY crm_admins_select ON web.crm_admins
  FOR SELECT USING (user_id = auth.uid() OR web.is_crm_admin());

-- CRM Notes
ALTER TABLE web.crm_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE web.crm_notes FORCE ROW LEVEL SECURITY;

CREATE POLICY crm_notes_select ON web.crm_notes
  FOR SELECT USING (web.is_crm_admin());
CREATE POLICY crm_notes_insert ON web.crm_notes
  FOR INSERT WITH CHECK (web.is_crm_admin());

-- CRM Activities
ALTER TABLE web.crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE web.crm_activities FORCE ROW LEVEL SECURITY;

CREATE POLICY crm_activities_select ON web.crm_activities
  FOR SELECT USING (web.is_crm_admin());
CREATE POLICY crm_activities_insert ON web.crm_activities
  FOR INSERT WITH CHECK (web.is_crm_admin());

-- Update leads policies for CRM admin access
CREATE POLICY leads_select_admin ON web.leads
  FOR SELECT USING (web.is_crm_admin());
CREATE POLICY leads_update_admin ON web.leads
  FOR UPDATE USING (web.is_crm_admin());

-- ---------------------------------------------------------------------------
-- 8. TRIGGERS
-- ---------------------------------------------------------------------------

-- Ensure the trigger function exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_web_affiliates_updated_at
  BEFORE UPDATE ON web.affiliates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_web_referrals_updated_at
  BEFORE UPDATE ON web.referrals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
