-- =============================================================================
-- CleverHub Shared Supabase Schema Plan
-- =============================================================================
-- Single Supabase project, logically separated into three domains:
--
--   SHARED (public schema)  — Auth, tenants, users, subscriptions
--   APP    (public schema)  — Devices, voice, sensors, reservations, guests
--   WEB    (web schema)     — Marketing site content, leads, contact forms
--
-- The APP tables already exist (001_init.sql). This migration adds the
-- SHARED commerce layer and the WEB schema for the marketing site.
--
-- Key principle: Supabase Auth is the single identity provider. A user who
-- buys on cleverhub.space and logs into the dashboard uses the SAME account.
-- =============================================================================

BEGIN;

-- ===========================================================================
-- SCHEMA: web (marketing site isolation)
-- ===========================================================================
CREATE SCHEMA IF NOT EXISTS web;

-- ===========================================================================
-- SHARED: Subscription & Commerce Tables (public schema)
-- ===========================================================================
-- These sit alongside the existing tenants/users tables and link purchases
-- on the website to tenant provisioning in the app.

-- ---------------------------------------------------------------------------
-- subscription_plans — defines what $2,500 + $100/mo buys
-- ---------------------------------------------------------------------------
CREATE TYPE subscription_status AS ENUM (
  'trialing', 'active', 'past_due', 'canceled', 'paused'
);

CREATE TABLE subscription_plans (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,                          -- 'CleverHub Standard'
  description     TEXT NOT NULL DEFAULT '',
  hardware_price  NUMERIC(10,2) NOT NULL,                 -- 2500.00
  monthly_price   NUMERIC(10,2) NOT NULL,                 -- 100.00
  vertical        market_vertical NOT NULL,               -- reuse existing enum
  tier            subscription_tier NOT NULL,              -- reuse existing enum
  features        JSONB NOT NULL DEFAULT '[]'::jsonb,     -- feature list for website
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- orders — hardware purchase from website
-- ---------------------------------------------------------------------------
CREATE TYPE order_status AS ENUM (
  'pending', 'paid', 'processing', 'shipped', 'delivered', 'refunded', 'canceled'
);

CREATE TABLE orders (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id             UUID REFERENCES tenants(id),       -- assigned after provisioning
  plan_id               UUID NOT NULL REFERENCES subscription_plans(id),
  stripe_payment_intent TEXT,                               -- Stripe PI ID
  stripe_checkout_id    TEXT,                               -- Stripe Checkout session
  status                order_status NOT NULL DEFAULT 'pending',
  hardware_total        NUMERIC(10,2) NOT NULL,
  tax                   NUMERIC(10,2) NOT NULL DEFAULT 0,
  shipping_address      JSONB NOT NULL DEFAULT '{}'::jsonb,
  tracking_number       TEXT,
  notes                 TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_user_id ON orders (user_id);
CREATE INDEX idx_orders_tenant_id ON orders (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_stripe_pi ON orders (stripe_payment_intent) WHERE stripe_payment_intent IS NOT NULL;

-- ---------------------------------------------------------------------------
-- subscriptions — recurring $100/mo cloud AI
-- ---------------------------------------------------------------------------
CREATE TABLE subscriptions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id                 UUID NOT NULL REFERENCES subscription_plans(id),
  stripe_subscription_id  TEXT,                             -- Stripe sub ID
  stripe_customer_id      TEXT,                             -- Stripe customer ID
  status                  subscription_status NOT NULL DEFAULT 'trialing',
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at               TIMESTAMPTZ,
  canceled_at             TIMESTAMPTZ,
  trial_end               TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_tenant_id ON subscriptions (tenant_id);
CREATE INDEX idx_subscriptions_status ON subscriptions (status);
CREATE INDEX idx_subscriptions_stripe_sub ON subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX idx_subscriptions_stripe_cust ON subscriptions (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- provisioning_queue — when order ships, auto-create tenant + devices
-- ---------------------------------------------------------------------------
CREATE TYPE provisioning_status AS ENUM (
  'pending', 'in_progress', 'completed', 'failed'
);

CREATE TABLE provisioning_queue (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id       UUID REFERENCES tenants(id),
  status          provisioning_status NOT NULL DEFAULT 'pending',
  hub_serial      TEXT,                                    -- Pi hub serial number
  node_serials    TEXT[] NOT NULL DEFAULT '{}',             -- ESP32 node serials
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,      -- pre-provisioning config
  error           TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_provisioning_order_id ON provisioning_queue (order_id);
CREATE INDEX idx_provisioning_status ON provisioning_queue (status);


-- ===========================================================================
-- WEB SCHEMA: Marketing Site Tables
-- ===========================================================================
-- These are ONLY for the cleverhub.space website. No tenant_id — these are
-- public/pre-purchase. RLS policies use auth.uid() or are public-read.

-- ---------------------------------------------------------------------------
-- web.leads — contact form / "get a quote" submissions
-- ---------------------------------------------------------------------------
CREATE TABLE web.leads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  company         TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  vertical        market_vertical,                         -- which product interested in
  unit_count      INTEGER,                                 -- how many units (for builders/apartments)
  message         TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'website',         -- 'website', 'referral', 'ad_google', etc.
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'converted', 'closed')),
  converted_user_id UUID REFERENCES auth.users(id),       -- links to user if they sign up
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_web_leads_email ON web.leads (email);
CREATE INDEX idx_web_leads_status ON web.leads (status);
CREATE INDEX idx_web_leads_vertical ON web.leads (vertical) WHERE vertical IS NOT NULL;
CREATE INDEX idx_web_leads_created ON web.leads (created_at DESC);

-- ---------------------------------------------------------------------------
-- web.testimonials — customer quotes for the landing page
-- ---------------------------------------------------------------------------
CREATE TABLE web.testimonials (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT '',                 -- 'Homebuilder', 'Airbnb Host', etc.
  company         TEXT NOT NULL DEFAULT '',
  quote           TEXT NOT NULL,
  avatar_url      TEXT,                                    -- Supabase Storage path
  vertical        market_vertical,
  rating          INTEGER CHECK (rating BETWEEN 1 AND 5),
  is_featured     BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_web_testimonials_featured ON web.testimonials (is_featured, sort_order);

-- ---------------------------------------------------------------------------
-- web.faqs — FAQ content managed via dashboard
-- ---------------------------------------------------------------------------
CREATE TABLE web.faqs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',         -- 'general', 'pricing', 'technical', 'installation'
  vertical        market_vertical,                         -- NULL = applies to all
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_published    BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_web_faqs_category ON web.faqs (category, sort_order);

-- ---------------------------------------------------------------------------
-- web.waitlist — pre-launch email collection
-- ---------------------------------------------------------------------------
CREATE TABLE web.waitlist (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT NOT NULL UNIQUE,
  vertical        market_vertical,
  referral_code   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_web_waitlist_created ON web.waitlist (created_at DESC);


-- ===========================================================================
-- RLS for new tables
-- ===========================================================================

-- Public schema commerce tables
ALTER TABLE subscription_plans     ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioning_queue     ENABLE ROW LEVEL SECURITY;

ALTER TABLE subscription_plans     FORCE ROW LEVEL SECURITY;
ALTER TABLE orders                 FORCE ROW LEVEL SECURITY;
ALTER TABLE subscriptions          FORCE ROW LEVEL SECURITY;
ALTER TABLE provisioning_queue     FORCE ROW LEVEL SECURITY;

-- Plans are public-read
CREATE POLICY plans_select ON subscription_plans
  FOR SELECT USING (is_active = true);

-- Orders: users see their own, owners see tenant orders
CREATE POLICY orders_select_own ON orders
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY orders_select_tenant ON orders
  FOR SELECT USING (tenant_id = auth.tenant_id() AND role_at_least('owner'));
CREATE POLICY orders_insert ON orders
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Subscriptions: tenant owners only
CREATE POLICY subscriptions_select ON subscriptions
  FOR SELECT USING (tenant_id = auth.tenant_id() AND role_at_least('owner'));
CREATE POLICY subscriptions_update ON subscriptions
  FOR UPDATE USING (tenant_id = auth.tenant_id() AND role_at_least('owner'));

-- Provisioning: service role only (no user policies — handled by Edge Functions)

-- Web schema tables
ALTER TABLE web.leads              ENABLE ROW LEVEL SECURITY;
ALTER TABLE web.testimonials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE web.faqs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE web.waitlist           ENABLE ROW LEVEL SECURITY;

ALTER TABLE web.leads              FORCE ROW LEVEL SECURITY;
ALTER TABLE web.testimonials       FORCE ROW LEVEL SECURITY;
ALTER TABLE web.faqs               FORCE ROW LEVEL SECURITY;
ALTER TABLE web.waitlist           FORCE ROW LEVEL SECURITY;

-- Leads: anon can insert (contact form), only service role reads
CREATE POLICY leads_insert ON web.leads
  FOR INSERT WITH CHECK (true);  -- anon can submit contact forms

-- Testimonials: public read
CREATE POLICY testimonials_select ON web.testimonials
  FOR SELECT USING (true);

-- FAQs: public read (published only)
CREATE POLICY faqs_select ON web.faqs
  FOR SELECT USING (is_published = true);

-- Waitlist: anon can insert
CREATE POLICY waitlist_insert ON web.waitlist
  FOR INSERT WITH CHECK (true);


-- ===========================================================================
-- Updated_at triggers for new tables
-- ===========================================================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'subscription_plans', 'orders', 'subscriptions'
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

-- Web schema triggers
CREATE TRIGGER trg_web_leads_updated_at
  BEFORE UPDATE ON web.leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_web_faqs_updated_at
  BEFORE UPDATE ON web.faqs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================================================================
-- PART: ACCESS GATE — Subscription-Aware JWT Claims Hook
-- ===========================================================================
-- This REPLACES the existing auth.custom_access_token_hook from auth.sql.
-- The original hook only injected tenant_id and user_role.
-- This version adds a `subscription_active` boolean claim so that:
--   - RLS policies can block access when subscription is lapsed
--   - Frontend can show "reactivate" UI instead of broken dashboards
--   - The Pi hub can degrade gracefully to local-only mode
-- ===========================================================================

CREATE OR REPLACE FUNCTION auth.custom_access_token_hook(event JSONB)
RETURNS JSONB AS $$
DECLARE
  claims              JSONB;
  user_record         RECORD;
  sub_active          BOOLEAN := false;
  has_paid_order      BOOLEAN := false;
BEGIN
  claims := event->'claims';

  -- Look up the user's tenant and role
  SELECT u.tenant_id, u.role
  INTO user_record
  FROM public.users u
  WHERE u.id = (event->>'user_id')::uuid;

  IF user_record IS NOT NULL THEN
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(user_record.tenant_id::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_record.role::text));

    -- Check if tenant has an active (or trialing) subscription
    SELECT EXISTS(
      SELECT 1 FROM public.subscriptions s
      WHERE s.tenant_id = user_record.tenant_id
        AND s.status IN ('active', 'trialing')
    ) INTO sub_active;

    claims := jsonb_set(claims, '{subscription_active}', to_jsonb(sub_active));
  ELSE
    -- No user row yet — check if they at least have a paid order
    -- (covers the window between payment and provisioning)
    SELECT EXISTS(
      SELECT 1 FROM public.orders o
      WHERE o.user_id = (event->>'user_id')::uuid
        AND o.status IN ('paid', 'processing', 'shipped', 'delivered')
    ) INTO has_paid_order;

    claims := jsonb_set(claims, '{tenant_id}', 'null'::jsonb);
    claims := jsonb_set(claims, '{user_role}', 'null'::jsonb);
    claims := jsonb_set(claims, '{subscription_active}', 'false'::jsonb);
    claims := jsonb_set(claims, '{has_paid_order}', to_jsonb(has_paid_order));
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION auth.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM anon;
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM authenticated;


-- ===========================================================================
-- HELPER: Check subscription is active (for use in RLS policies)
-- ===========================================================================
CREATE OR REPLACE FUNCTION auth.subscription_active()
RETURNS BOOLEAN AS $$
  SELECT COALESCE((auth.jwt()->>'subscription_active')::boolean, false);
$$ LANGUAGE sql STABLE SECURITY DEFINER;


-- ===========================================================================
-- EXAMPLE: Updating existing RLS policies to require active subscription
-- ===========================================================================
-- You'd update your key app-facing policies like this:
--
--   CREATE POLICY devices_select_members ON devices
--     FOR SELECT USING (
--       tenant_id = auth.tenant_id()
--       AND role_at_least('resident')
--       AND auth.subscription_active()          -- <== NEW: payment gate
--     );
--
-- Apply this to: devices, scenes, voice_sessions, sensor_telemetry,
-- reservations, guest_profiles — anything that's a "paid feature."
--
-- Do NOT gate: tenants (owner needs to see their own tenant to reactivate),
-- users (need to log in to manage billing), orders, subscriptions.
-- ===========================================================================


COMMIT;


-- ===========================================================================
-- ARCHITECTURE NOTES
-- ===========================================================================
--
-- ACCESS CONTROL SUMMARY
-- ================================================
-- There are THREE layers of access control:
--
-- Layer 1: Supabase Auth (auth.users)
--   WHO: Anyone who signs up on cleverhub.space or the app
--   WHAT: Can authenticate, see public plans, submit orders
--   GATE: Email/password or OAuth — no payment required
--
-- Layer 2: Tenant Membership (public.users + JWT claims)
--   WHO: Users assigned to a tenant after provisioning
--   WHAT: tenant_id and user_role in JWT, basic RLS access
--   GATE: Tenant exists → created during provisioning after order ships
--
-- Layer 3: Active Subscription (subscriptions + JWT claims)
--   WHO: Tenants with status = 'active' or 'trialing'
--   WHAT: Full app access — devices, voice, sensors, dashboard
--   GATE: subscription_active = true in JWT, checked by RLS policies
--
-- A user who signed up but hasn't paid:
--   - Can log in ✓
--   - Can see their order status ✓
--   - Can see subscription plans ✓
--   - CANNOT access devices, voice, sensors, dashboard ✗
--
-- A user whose subscription lapsed (past_due/canceled):
--   - Can log in ✓
--   - Can see billing page to reactivate ✓
--   - CANNOT access app features ✗
--   - Pi hub falls back to local-only mode (no cloud AI)
--
-- Data Flow: Website Purchase → App Provisioning
-- ================================================
-- 1. User visits cleverhub.space, clicks "Buy Now"
-- 2. Supabase Auth sign-up (or existing login)
-- 3. Stripe Checkout → webhook → Edge Function creates `orders` row (status: paid)
-- 4. JWT now has `has_paid_order: true` — frontend shows "awaiting shipment"
-- 5. Order ships → `provisioning_queue` entry created
-- 6. Pi hub first-boot registers with cloud → Edge Function:
--    a. Creates `tenants` row (via create_tenant_with_owner)
--    b. Links order.tenant_id
--    c. Creates `subscriptions` row (status: active, or trialing if trial period)
--    d. Marks provisioning complete
-- 7. Next JWT refresh: tenant_id, user_role, subscription_active = true
-- 8. User can now access full app features
--
-- IoT Telemetry Strategy
-- ================================================
-- HIGH-FREQUENCY sensor data (per-second/per-minute readings) lives in
-- SQLite on the Pi hub locally. Only AGGREGATED summaries sync to Supabase
-- sensor_telemetry (TimescaleDB hypertable) periodically.
--
-- Local (Pi SQLite):  raw readings, 7-30 day retention, fast local queries
-- Cloud (Supabase):   5-min/hourly rollups, long-term trends, dashboard charts
--
-- This keeps Supabase costs low and the Pi responsive even offline.
--
-- Schema Split Escape Hatch
-- ================================================
-- If you need to split later:
-- 1. web.* schema → separate Supabase project (marketing DB)
-- 2. Keep public.* (tenants, users, orders, subscriptions, app tables) together
-- 3. Bridge auth via shared JWT secret or Supabase's custom auth provider
-- The web schema is intentionally isolated to make this split painless.
