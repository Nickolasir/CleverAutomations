-- =============================================================================
-- Nutrition Tracking Sub-Agent
-- =============================================================================
-- Adds tables for food/drink intake tracking via voice, photo, or barcode.
-- Food logs are personal health data (GDPR Art 9) encrypted with per-user
-- keys from migration 014.
--
-- Input methods:
--   - Voice/chat: "I just had a coffee and a sandwich"
--   - Photo: vision AI identifies foods and estimates portions
--   - Barcode: product lookup via OpenFoodFacts API with local cache
--   - Manual: direct entry via mobile app form
--   - Pantry consumed: linked to pantry_items from kitchen hub
--
-- Dependencies: migrations 008 (encryption), 014 (per-user keys)
-- =============================================================================

-- ===========================================================================
-- PART 0: ENUM EXTENSIONS (must be committed BEFORE they can be referenced)
-- ===========================================================================
-- PostgreSQL requires new enum values to be committed before any SQL in the
-- same session can reference them. These ALTER TYPE statements run outside
-- the main transaction block so the values are visible to functions below.

DO $$ BEGIN
  CREATE TYPE meal_type AS ENUM (
    'breakfast',
    'lunch',
    'dinner',
    'snack',
    'drink'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE nutrition_log_source AS ENUM (
    'voice',            -- Spoken to agent ("I had a coffee")
    'chat',             -- Typed in chat
    'photo',            -- Photo analyzed by vision AI
    'barcode',          -- Barcode scanned and looked up
    'manual',           -- Manual entry in mobile app form
    'pantry_consumed'   -- Consumed from pantry inventory
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend consent_type for nutrition data (GDPR Art 9 special category)
ALTER TYPE consent_type ADD VALUE IF NOT EXISTS 'nutrition_data';

-- Extend audit_action for nutrition events
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'nutrition_log_created';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'nutrition_goal_set';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'food_photo_analyzed';

BEGIN;

-- ===========================================================================
-- PART 1: FOOD ITEMS (Product Reference Cache)
-- ===========================================================================
-- Cached nutritional data for foods and products. Shared within a tenant
-- so multiple family members benefit from the same barcode lookups.
-- NOT personal health data — this is reference data.

CREATE TABLE IF NOT EXISTS public.food_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Product identification
  barcode               TEXT,                    -- UPC/EAN (nullable for non-barcoded foods)
  name                  TEXT NOT NULL,
  brand                 TEXT,

  -- Nutritional data (per serving)
  serving_size_g        NUMERIC,
  serving_description   TEXT,                    -- "1 cup", "2 slices", etc.
  calories_per_serving  NUMERIC,
  protein_g             NUMERIC,
  carbs_g               NUMERIC,
  fat_g                 NUMERIC,
  fiber_g               NUMERIC,
  sugar_g               NUMERIC,
  sodium_mg             NUMERIC,

  -- Source metadata
  source                TEXT NOT NULL DEFAULT 'manual',  -- openfoodfacts, usda, vision_ai, manual
  openfoodfacts_id      TEXT,                    -- For dedup on re-lookup
  image_url             TEXT,                    -- Product image URL

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One barcode per tenant (prevents duplicate lookups)
  CONSTRAINT uq_food_item_barcode UNIQUE (tenant_id, barcode)
);

CREATE INDEX IF NOT EXISTS idx_food_items_tenant ON food_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_food_items_name ON food_items (tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_food_items_barcode ON food_items (barcode) WHERE barcode IS NOT NULL;

-- ===========================================================================
-- PART 3: FOOD LOGS (Personal Health Data — Per-User Encrypted)
-- ===========================================================================
-- Each food log entry is health data owned by a single user. Description
-- and analysis results are encrypted with per-user keys so that not even
-- tenant admins can read another user's food intake.

CREATE TABLE IF NOT EXISTS public.food_logs (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Food reference (null for free-text entries from voice/chat)
  food_item_id              UUID REFERENCES public.food_items(id) ON DELETE SET NULL,

  -- Classification
  meal_type                 meal_type NOT NULL,
  source                    nutrition_log_source NOT NULL,

  -- Description (encrypted with per-user key)
  description_encrypted     TEXT NOT NULL,        -- encrypt_pii_user(): "coffee and a sandwich"

  -- Calculated nutrition totals for this entry
  serving_quantity          NUMERIC NOT NULL DEFAULT 1,
  calories                  NUMERIC,
  protein_g                 NUMERIC,
  carbs_g                   NUMERIC,
  fat_g                     NUMERIC,
  fiber_g                   NUMERIC,

  -- Photo analysis (for photo-sourced entries)
  photo_url                 TEXT,                 -- Supabase Storage path
  photo_analysis_encrypted  TEXT,                 -- encrypt_pii_user(): vision AI response

  -- Pantry link (for pantry_consumed source)
  pantry_item_id            UUID,                 -- FK to pantry_items (soft ref, no cascade)

  -- Timestamps
  logged_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),  -- When the food was consumed
  notes_encrypted           TEXT,                 -- encrypt_pii_user(): optional user notes
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs (tenant_id, user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_food_logs_meal ON food_logs (user_id, meal_type, logged_at DESC);

-- ===========================================================================
-- PART 4: NUTRITION GOALS (Per-User Daily Targets)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.nutrition_goals (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  daily_calories    INTEGER,
  daily_protein_g   INTEGER,
  daily_carbs_g     INTEGER,
  daily_fat_g       INTEGER,
  daily_fiber_g     INTEGER,
  daily_water_ml    INTEGER,          -- Hydration target

  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_nutrition_goals UNIQUE (tenant_id, user_id)
);

-- ===========================================================================
-- PART 5: WATER LOGS (Hydration Tracking)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.water_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  amount_ml     INTEGER NOT NULL,
  logged_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        nutrition_log_source NOT NULL DEFAULT 'manual',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_water_logs_user_date ON water_logs (tenant_id, user_id, logged_at DESC);

-- ===========================================================================
-- PART 6: ENABLE RLS
-- ===========================================================================

ALTER TABLE food_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_items FORCE ROW LEVEL SECURITY;

ALTER TABLE food_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE nutrition_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_goals FORCE ROW LEVEL SECURITY;

ALTER TABLE water_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_logs FORCE ROW LEVEL SECURITY;

-- ===========================================================================
-- PART 7: RLS POLICIES — food_items (shared reference data within tenant)
-- ===========================================================================
-- DROP IF EXISTS guards make this migration idempotent on re-run.

DROP POLICY IF EXISTS food_items_select ON food_items;
CREATE POLICY food_items_select ON food_items
  FOR SELECT USING (tenant_id = requesting_tenant_id());

DROP POLICY IF EXISTS food_items_insert ON food_items;
CREATE POLICY food_items_insert ON food_items
  FOR INSERT WITH CHECK (tenant_id = requesting_tenant_id());

DROP POLICY IF EXISTS food_items_update ON food_items;
CREATE POLICY food_items_update ON food_items
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND role_at_least('resident')
  );

-- ===========================================================================
-- PART 8: RLS POLICIES — food_logs (USER-ONLY, NO admin access)
-- ===========================================================================
-- Personal health data: only the user who created the entry can access it.

DROP POLICY IF EXISTS food_logs_select ON food_logs;
CREATE POLICY food_logs_select ON food_logs
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

DROP POLICY IF EXISTS food_logs_insert ON food_logs;
CREATE POLICY food_logs_insert ON food_logs
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

DROP POLICY IF EXISTS food_logs_update ON food_logs;
CREATE POLICY food_logs_update ON food_logs
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

DROP POLICY IF EXISTS food_logs_delete ON food_logs;
CREATE POLICY food_logs_delete ON food_logs
  FOR DELETE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 9: RLS POLICIES — nutrition_goals (USER-ONLY)
-- ===========================================================================

DROP POLICY IF EXISTS nutrition_goals_select ON nutrition_goals;
CREATE POLICY nutrition_goals_select ON nutrition_goals
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

DROP POLICY IF EXISTS nutrition_goals_insert ON nutrition_goals;
CREATE POLICY nutrition_goals_insert ON nutrition_goals
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

DROP POLICY IF EXISTS nutrition_goals_update ON nutrition_goals;
CREATE POLICY nutrition_goals_update ON nutrition_goals
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 10: RLS POLICIES — water_logs (USER-ONLY)
-- ===========================================================================

DROP POLICY IF EXISTS water_logs_select ON water_logs;
CREATE POLICY water_logs_select ON water_logs
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

DROP POLICY IF EXISTS water_logs_insert ON water_logs;
CREATE POLICY water_logs_insert ON water_logs
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

DROP POLICY IF EXISTS water_logs_delete ON water_logs;
CREATE POLICY water_logs_delete ON water_logs
  FOR DELETE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 11: HELPER FUNCTIONS
-- ===========================================================================

-- Daily nutrition summary for a user
CREATE OR REPLACE FUNCTION public.get_daily_nutrition_summary(
  p_user_id UUID,
  p_tenant_id UUID,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  total_calories NUMERIC,
  total_protein_g NUMERIC,
  total_carbs_g NUMERIC,
  total_fat_g NUMERIC,
  total_fiber_g NUMERIC,
  total_water_ml BIGINT,
  food_entries_count BIGINT,
  water_entries_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(fl.calories), 0)::NUMERIC AS total_calories,
    COALESCE(SUM(fl.protein_g), 0)::NUMERIC AS total_protein_g,
    COALESCE(SUM(fl.carbs_g), 0)::NUMERIC AS total_carbs_g,
    COALESCE(SUM(fl.fat_g), 0)::NUMERIC AS total_fat_g,
    COALESCE(SUM(fl.fiber_g), 0)::NUMERIC AS total_fiber_g,
    (SELECT COALESCE(SUM(wl.amount_ml), 0)
     FROM water_logs wl
     WHERE wl.user_id = p_user_id
       AND wl.tenant_id = p_tenant_id
       AND wl.logged_at::DATE = p_date
    )::BIGINT AS total_water_ml,
    COUNT(fl.id)::BIGINT AS food_entries_count,
    (SELECT COUNT(wl.id)
     FROM water_logs wl
     WHERE wl.user_id = p_user_id
       AND wl.tenant_id = p_tenant_id
       AND wl.logged_at::DATE = p_date
    )::BIGINT AS water_entries_count
  FROM food_logs fl
  WHERE fl.user_id = p_user_id
    AND fl.tenant_id = p_tenant_id
    AND fl.logged_at::DATE = p_date;
END;
$$;

-- Weekly nutrition summary (array of daily summaries)
CREATE OR REPLACE FUNCTION public.get_weekly_nutrition_summary(
  p_user_id UUID,
  p_tenant_id UUID,
  p_week_start DATE DEFAULT (CURRENT_DATE - INTERVAL '6 days')::DATE
)
RETURNS TABLE (
  log_date DATE,
  total_calories NUMERIC,
  total_protein_g NUMERIC,
  total_carbs_g NUMERIC,
  total_fat_g NUMERIC,
  total_fiber_g NUMERIC,
  total_water_ml BIGINT,
  food_entries_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.dt::DATE AS log_date,
    COALESCE(SUM(fl.calories), 0)::NUMERIC AS total_calories,
    COALESCE(SUM(fl.protein_g), 0)::NUMERIC AS total_protein_g,
    COALESCE(SUM(fl.carbs_g), 0)::NUMERIC AS total_carbs_g,
    COALESCE(SUM(fl.fat_g), 0)::NUMERIC AS total_fat_g,
    COALESCE(SUM(fl.fiber_g), 0)::NUMERIC AS total_fiber_g,
    (SELECT COALESCE(SUM(wl.amount_ml), 0)
     FROM water_logs wl
     WHERE wl.user_id = p_user_id
       AND wl.tenant_id = p_tenant_id
       AND wl.logged_at::DATE = d.dt::DATE
    )::BIGINT AS total_water_ml,
    COUNT(fl.id)::BIGINT AS food_entries_count
  FROM generate_series(p_week_start, p_week_start + INTERVAL '6 days', INTERVAL '1 day') AS d(dt)
  LEFT JOIN food_logs fl
    ON fl.user_id = p_user_id
    AND fl.tenant_id = p_tenant_id
    AND fl.logged_at::DATE = d.dt::DATE
  GROUP BY d.dt
  ORDER BY d.dt;
END;
$$;

-- Check if user has active nutrition_data consent.
-- Uses plpgsql with text-to-enum cast so the 'nutrition_data' literal is
-- resolved at CALL TIME, not at CREATE FUNCTION time. This avoids the
-- PostgreSQL restriction that new enum values added via ALTER TYPE ... ADD VALUE
-- cannot be referenced in the same session until committed.
CREATE OR REPLACE FUNCTION public.check_nutrition_consent(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN has_active_consent(p_user_id, 'nutrition_data'::text::consent_type);
END;
$$;

-- ===========================================================================
-- PART 12: TRIGGERS
-- ===========================================================================

DROP TRIGGER IF EXISTS trg_food_items_updated_at ON food_items;
CREATE TRIGGER trg_food_items_updated_at
  BEFORE UPDATE ON food_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_nutrition_goals_updated_at ON nutrition_goals;
CREATE TRIGGER trg_nutrition_goals_updated_at
  BEFORE UPDATE ON nutrition_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
