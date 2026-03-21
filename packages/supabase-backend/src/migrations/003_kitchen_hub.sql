-- =============================================================================
-- Kitchen Sub-Hub: ePantry, Shopping List, Receipt Scanning
-- =============================================================================
-- Adds tables for pantry inventory management, shopping lists, receipt
-- scanning, and pantry photo analysis. All tables enforce tenant isolation
-- via RLS policies using public.get_tenant_id().
-- =============================================================================

-- ---------------------------------------------------------------------------
-- New ENUM types
-- ---------------------------------------------------------------------------
CREATE TYPE pantry_item_category AS ENUM (
  'produce', 'dairy', 'meat', 'seafood', 'frozen', 'canned',
  'dry_goods', 'bakery', 'beverages', 'snacks', 'condiments',
  'spices', 'household', 'personal_care', 'other'
);

CREATE TYPE pantry_item_source AS ENUM (
  'receipt_scan', 'barcode_scan', 'photo_analysis',
  'voice', 'manual', 'shopping_list_purchased'
);

CREATE TYPE pantry_location AS ENUM (
  'pantry', 'fridge', 'freezer', 'other'
);

CREATE TYPE processing_status AS ENUM (
  'pending', 'processing', 'completed', 'failed'
);

-- ---------------------------------------------------------------------------
-- Add new audit actions to existing enum
-- ---------------------------------------------------------------------------
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'pantry_item_added';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'pantry_item_removed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'pantry_item_updated';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'shopping_list_item_added';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'shopping_list_item_removed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'shopping_list_item_checked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'receipt_scanned';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'pantry_photo_analyzed';

-- ---------------------------------------------------------------------------
-- 1. pantry_items
-- ---------------------------------------------------------------------------
CREATE TABLE pantry_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  quantity            NUMERIC NOT NULL DEFAULT 1,
  unit                TEXT NOT NULL DEFAULT 'item',
  category            pantry_item_category NOT NULL DEFAULT 'other',
  barcode             TEXT,
  brand               TEXT,
  expiry_date         DATE,
  added_date          TIMESTAMPTZ NOT NULL DEFAULT now(),
  source              pantry_item_source NOT NULL,
  location            pantry_location NOT NULL DEFAULT 'pantry',
  notes               TEXT,
  image_url           TEXT,
  min_stock_threshold NUMERIC,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pantry_items_tenant_id ON pantry_items (tenant_id);
CREATE INDEX idx_pantry_items_tenant_category ON pantry_items (tenant_id, category);
CREATE INDEX idx_pantry_items_tenant_barcode ON pantry_items (tenant_id, barcode);
CREATE INDEX idx_pantry_items_tenant_expiry ON pantry_items (tenant_id, expiry_date);
CREATE INDEX idx_pantry_items_tenant_location ON pantry_items (tenant_id, location);

-- ---------------------------------------------------------------------------
-- 2. shopping_list_items
-- ---------------------------------------------------------------------------
CREATE TABLE shopping_list_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  quantity    NUMERIC NOT NULL DEFAULT 1,
  unit        TEXT,
  category    pantry_item_category,
  checked     BOOLEAN NOT NULL DEFAULT false,
  added_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_via   TEXT NOT NULL CHECK (added_via IN ('voice', 'dashboard', 'mobile', 'auto_restock')),
  notes       TEXT,
  priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shopping_list_tenant_id ON shopping_list_items (tenant_id);
CREATE INDEX idx_shopping_list_tenant_checked ON shopping_list_items (tenant_id, checked);

-- ---------------------------------------------------------------------------
-- 3. receipts
-- ---------------------------------------------------------------------------
CREATE TABLE receipts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  image_url           TEXT NOT NULL,
  store_name          TEXT,
  purchase_date       DATE,
  total               NUMERIC,
  items_extracted     JSONB NOT NULL DEFAULT '[]'::jsonb,
  processing_status   processing_status NOT NULL DEFAULT 'pending',
  error_message       TEXT,
  scanned_by          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_receipts_tenant_id ON receipts (tenant_id);
CREATE INDEX idx_receipts_tenant_status ON receipts (tenant_id, processing_status);

-- ---------------------------------------------------------------------------
-- 4. pantry_photo_analyses
-- ---------------------------------------------------------------------------
CREATE TABLE pantry_photo_analyses (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  image_url           TEXT NOT NULL,
  location            pantry_location NOT NULL,
  identified_items    JSONB NOT NULL DEFAULT '[]'::jsonb,
  processing_status   processing_status NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pantry_photos_tenant_id ON pantry_photo_analyses (tenant_id);

-- ===========================================================================
-- RLS HELPER FUNCTIONS (idempotent — safe to re-run)
-- ===========================================================================
-- Placed in public schema because the auth schema is owned by Supabase
-- and does not allow user-defined functions.

CREATE OR REPLACE FUNCTION public.get_tenant_id()
RETURNS UUID AS $$
  SELECT (auth.jwt()->>'tenant_id')::uuid;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS user_role AS $$
  SELECT (auth.jwt()->>'user_role')::user_role;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.role_at_least(required user_role)
RETURNS BOOLEAN AS $$
  SELECT (
    CASE public.get_user_role()
      WHEN 'owner'    THEN 5
      WHEN 'admin'    THEN 4
      WHEN 'manager'  THEN 3
      WHEN 'resident' THEN 2
      WHEN 'guest'    THEN 1
      ELSE 0
    END
  ) >= (
    CASE required
      WHEN 'owner'    THEN 5
      WHEN 'admin'    THEN 4
      WHEN 'manager'  THEN 3
      WHEN 'resident' THEN 2
      WHEN 'guest'    THEN 1
      ELSE 0
    END
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ===========================================================================
-- RLS POLICIES
-- ===========================================================================

-- Enable RLS
ALTER TABLE pantry_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_list_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE pantry_photo_analyses ENABLE ROW LEVEL SECURITY;

-- Force RLS on table owners too
ALTER TABLE pantry_items          FORCE ROW LEVEL SECURITY;
ALTER TABLE shopping_list_items   FORCE ROW LEVEL SECURITY;
ALTER TABLE receipts              FORCE ROW LEVEL SECURITY;
ALTER TABLE pantry_photo_analyses FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- pantry_items: all tenant members (resident+) can read/write
-- ---------------------------------------------------------------------------
CREATE POLICY pantry_items_select ON pantry_items
  FOR SELECT USING (tenant_id = public.get_tenant_id() AND role_at_least('resident'));

CREATE POLICY pantry_items_insert ON pantry_items
  FOR INSERT WITH CHECK (tenant_id = public.get_tenant_id() AND role_at_least('resident'));

CREATE POLICY pantry_items_update ON pantry_items
  FOR UPDATE USING (tenant_id = public.get_tenant_id() AND role_at_least('resident'));

CREATE POLICY pantry_items_delete ON pantry_items
  FOR DELETE USING (tenant_id = public.get_tenant_id() AND role_at_least('resident'));

-- ---------------------------------------------------------------------------
-- shopping_list_items: all tenant members (resident+) can read/write
-- ---------------------------------------------------------------------------
CREATE POLICY shopping_list_select ON shopping_list_items
  FOR SELECT USING (tenant_id = public.get_tenant_id() AND role_at_least('resident'));

CREATE POLICY shopping_list_insert ON shopping_list_items
  FOR INSERT WITH CHECK (tenant_id = public.get_tenant_id() AND role_at_least('resident'));

CREATE POLICY shopping_list_update ON shopping_list_items
  FOR UPDATE USING (tenant_id = public.get_tenant_id() AND role_at_least('resident'));

CREATE POLICY shopping_list_delete ON shopping_list_items
  FOR DELETE USING (tenant_id = public.get_tenant_id() AND role_at_least('resident'));

-- ---------------------------------------------------------------------------
-- receipts: all tenant members (resident+) can read; insert by resident+
-- ---------------------------------------------------------------------------
CREATE POLICY receipts_select ON receipts
  FOR SELECT USING (tenant_id = public.get_tenant_id() AND role_at_least('resident'));

CREATE POLICY receipts_insert ON receipts
  FOR INSERT WITH CHECK (tenant_id = public.get_tenant_id() AND role_at_least('resident'));

CREATE POLICY receipts_update ON receipts
  FOR UPDATE USING (tenant_id = public.get_tenant_id() AND role_at_least('resident'));

-- ---------------------------------------------------------------------------
-- pantry_photo_analyses: all tenant members (resident+) can read/write
-- ---------------------------------------------------------------------------
CREATE POLICY pantry_photos_select ON pantry_photo_analyses
  FOR SELECT USING (tenant_id = public.get_tenant_id() AND role_at_least('resident'));

CREATE POLICY pantry_photos_insert ON pantry_photo_analyses
  FOR INSERT WITH CHECK (tenant_id = public.get_tenant_id() AND role_at_least('resident'));

CREATE POLICY pantry_photos_update ON pantry_photo_analyses
  FOR UPDATE USING (tenant_id = public.get_tenant_id() AND role_at_least('resident'));
