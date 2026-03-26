-- =============================================================================
-- GDPR Consent Management System
-- =============================================================================
-- Implements consent tracking per GDPR Articles 6, 7, 8, and 9.
-- Records explicit consent for each processing activity, links to privacy
-- policy versions, and supports consent withdrawal with cascading effects.
--
-- Also adds processing_restricted flag to users for Right to Restriction.
-- =============================================================================

BEGIN;

-- ===========================================================================
-- PART 1: ENUM TYPES
-- ===========================================================================

DO $$ BEGIN
  CREATE TYPE consent_type AS ENUM (
    'data_processing',       -- Art 6.1.b: Contract — required for service
    'voice_recording',       -- Art 6.1.a: Consent — voice transcript storage
    'health_data',           -- Art 9.2.a: Explicit consent — CleverAide
    'child_data',            -- Art 8: Parental consent — family profiles <16
    'marketing',             -- Art 6.1.a: Consent — marketing communications
    'analytics',             -- Art 6.1.a: Consent — usage analytics
    'third_party_sharing',   -- Art 6.1.a: Consent — sharing with processors
    'behavioral_monitoring'  -- Art 6.1.f: Legitimate interest — sensor data
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE lawful_basis AS ENUM (
    'consent',              -- Art 6.1.a
    'contract',             -- Art 6.1.b
    'legal_obligation',     -- Art 6.1.c
    'vital_interests',      -- Art 6.1.d
    'public_task',          -- Art 6.1.e
    'legitimate_interests'  -- Art 6.1.f
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE data_subject_request_type AS ENUM (
    'access',        -- Art 15: Right of access
    'portability',   -- Art 20: Right to data portability
    'erasure',       -- Art 17: Right to erasure
    'rectification', -- Art 16: Right to rectification
    'restriction',   -- Art 18: Right to restriction
    'objection'      -- Art 21: Right to object
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE dsar_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================================================
-- PART 2: CONSENT RECORDS TABLE
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.consent_records (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_type    consent_type NOT NULL,
  lawful_basis    lawful_basis NOT NULL,
  granted         BOOLEAN NOT NULL DEFAULT true,
  policy_version  TEXT NOT NULL DEFAULT '1.0',
  ip_address_hash TEXT,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A user can have at most one active consent per type per tenant
  CONSTRAINT uq_consent_active UNIQUE (tenant_id, user_id, consent_type)
);

CREATE INDEX idx_consent_records_user ON consent_records (user_id, tenant_id);
CREATE INDEX idx_consent_records_type ON consent_records (consent_type, tenant_id);

-- ===========================================================================
-- PART 3: DATA SUBJECT REQUESTS TABLE
-- ===========================================================================
-- Tracks all DSAR requests for audit and compliance (Art 15-21).

CREATE TABLE IF NOT EXISTS public.data_subject_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_type    data_subject_request_type NOT NULL,
  status          dsar_status NOT NULL DEFAULT 'pending',
  request_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_data   JSONB,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dsar_user ON data_subject_requests (user_id, tenant_id);
CREATE INDEX idx_dsar_status ON data_subject_requests (status, created_at);

-- ===========================================================================
-- PART 4: PRIVACY POLICY VERSIONS TABLE
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.privacy_policy_versions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version         TEXT NOT NULL UNIQUE,
  content_hash    TEXT NOT NULL,
  summary         TEXT NOT NULL,
  effective_date  DATE NOT NULL,
  requires_reconsent BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- PART 5: ADD PROCESSING_RESTRICTED TO USERS (Right to Restriction, Art 18)
-- ===========================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS processing_restricted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_restricted_at TIMESTAMPTZ;

-- ===========================================================================
-- PART 6: ADD PARENTAL CONSENT TO FAMILY PROFILES (Art 8)
-- ===========================================================================

ALTER TABLE family_member_profiles
  ADD COLUMN IF NOT EXISTS parental_consent_recorded BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parental_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parental_consent_by UUID REFERENCES auth.users(id);

-- ===========================================================================
-- PART 7: RLS POLICIES
-- ===========================================================================

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;
ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_subject_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE privacy_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_policy_versions FORCE ROW LEVEL SECURITY;

-- Consent records: users can read/manage their own; admin can read all within tenant
CREATE POLICY consent_select_own ON consent_records
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY consent_select_admin ON consent_records
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY consent_insert_own ON consent_records
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY consent_update_own ON consent_records
  FOR UPDATE USING (user_id = auth.uid());

-- DSAR: users can read/create their own; admin can manage all within tenant
CREATE POLICY dsar_select_own ON data_subject_requests
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY dsar_select_admin ON data_subject_requests
  FOR SELECT USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

CREATE POLICY dsar_insert_own ON data_subject_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY dsar_update_admin ON data_subject_requests
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id() AND role_at_least('admin')
  );

-- Privacy policy versions: readable by all authenticated users
CREATE POLICY policy_versions_select ON privacy_policy_versions
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY policy_versions_insert_admin ON privacy_policy_versions
  FOR INSERT WITH CHECK (role_at_least('admin'));

-- ===========================================================================
-- PART 8: HELPER FUNCTIONS
-- ===========================================================================

-- Check if a user has active consent for a specific type
CREATE OR REPLACE FUNCTION public.has_active_consent(
  p_user_id UUID,
  p_consent_type consent_type
)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM consent_records
    WHERE user_id = p_user_id
      AND consent_type = p_consent_type
      AND granted = true
      AND withdrawn_at IS NULL
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if parental consent is recorded for a family member
CREATE OR REPLACE FUNCTION public.has_parental_consent(p_profile_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT parental_consent_recorded FROM family_member_profiles WHERE id = p_profile_id),
    false
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ===========================================================================
-- PART 9: TRIGGERS
-- ===========================================================================

CREATE TRIGGER trg_dsar_updated_at
  BEFORE UPDATE ON data_subject_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Extend audit_action enum for GDPR events
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'consent_granted';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'consent_withdrawn';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'dsar_submitted';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'dsar_completed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'data_exported';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'data_erased';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'processing_restricted';

COMMIT;
