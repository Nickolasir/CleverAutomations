-- =============================================================================
-- Encrypt PII Fields: users, web.leads, web.affiliates, audit_logs, family
-- =============================================================================
-- Encrypts all remaining plaintext PII across core tables.
--
-- Pattern for fields that need indexed lookups (email):
--   1. Add email_hash (SHA-256) for uniqueness/lookups
--   2. Add email_encrypted for retrieval/display
--   3. Migrate data
--   4. Drop plaintext email column
--
-- Pattern for fields that don't need lookups:
--   1. Add _encrypted column
--   2. Migrate data
--   3. Drop plaintext column
-- =============================================================================

BEGIN;

-- ===========================================================================
-- PART 1: USERS TABLE
-- ===========================================================================

-- Add hash + encrypted columns
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_hash TEXT,
  ADD COLUMN IF NOT EXISTS email_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS display_name_encrypted TEXT;

-- Migrate existing data
UPDATE users
SET
  email_hash = hash_pii(email),
  email_encrypted = encrypt_pii(email, tenant_id),
  display_name_encrypted = encrypt_pii(display_name, tenant_id)
WHERE email IS NOT NULL;

-- Create index on email_hash for login lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash
  ON users (email_hash, tenant_id) WHERE email_hash IS NOT NULL;

-- Drop the old unique index on email if it exists
DROP INDEX IF EXISTS idx_users_email;

-- Drop plaintext columns
ALTER TABLE users
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS display_name;

-- ===========================================================================
-- PART 2: WEB.LEADS TABLE
-- ===========================================================================

ALTER TABLE web.leads
  ADD COLUMN IF NOT EXISTS email_hash TEXT,
  ADD COLUMN IF NOT EXISTS email_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS name_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS phone_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS company_encrypted TEXT;

UPDATE web.leads
SET
  email_hash = hash_pii(email),
  email_encrypted = encrypt_pii(email, (SELECT id FROM tenants LIMIT 1)),
  name_encrypted = encrypt_pii(name, (SELECT id FROM tenants LIMIT 1)),
  phone_encrypted = encrypt_pii(phone, (SELECT id FROM tenants LIMIT 1)),
  company_encrypted = encrypt_pii(company, (SELECT id FROM tenants LIMIT 1))
WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_web_leads_email_hash
  ON web.leads (email_hash) WHERE email_hash IS NOT NULL;

ALTER TABLE web.leads
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS company;

-- ===========================================================================
-- PART 3: WEB.AFFILIATES TABLE
-- ===========================================================================

ALTER TABLE web.affiliates
  ADD COLUMN IF NOT EXISTS email_hash TEXT,
  ADD COLUMN IF NOT EXISTS email_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS name_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS phone_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS company_encrypted TEXT;

UPDATE web.affiliates
SET
  email_hash = hash_pii(email),
  email_encrypted = encrypt_pii(email, (SELECT id FROM tenants LIMIT 1)),
  name_encrypted = encrypt_pii(name, (SELECT id FROM tenants LIMIT 1)),
  phone_encrypted = encrypt_pii(phone, (SELECT id FROM tenants LIMIT 1)),
  company_encrypted = encrypt_pii(company, (SELECT id FROM tenants LIMIT 1))
WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_web_affiliates_email_hash
  ON web.affiliates (email_hash) WHERE email_hash IS NOT NULL;

ALTER TABLE web.affiliates
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS company;

-- ===========================================================================
-- PART 4: WEB.REFERRALS TABLE
-- ===========================================================================

ALTER TABLE web.referrals
  ADD COLUMN IF NOT EXISTS referred_email_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS referred_name_encrypted TEXT;

UPDATE web.referrals
SET
  referred_email_encrypted = encrypt_pii(referred_email, (SELECT id FROM tenants LIMIT 1)),
  referred_name_encrypted = encrypt_pii(referred_name, (SELECT id FROM tenants LIMIT 1))
WHERE referred_email IS NOT NULL;

ALTER TABLE web.referrals
  DROP COLUMN IF EXISTS referred_email,
  DROP COLUMN IF EXISTS referred_name;

-- ===========================================================================
-- PART 5: AUDIT_LOGS TABLE — IP ADDRESS
-- ===========================================================================
-- Hash IP for correlation, encrypt for retrieval.

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS ip_address_hash TEXT,
  ADD COLUMN IF NOT EXISTS ip_address_encrypted TEXT;

UPDATE audit_logs
SET
  ip_address_hash = hash_pii(ip_address::text),
  ip_address_encrypted = encrypt_pii(ip_address::text, tenant_id)
WHERE ip_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_hash
  ON audit_logs (ip_address_hash) WHERE ip_address_hash IS NOT NULL;

ALTER TABLE audit_logs
  DROP COLUMN IF EXISTS ip_address;

-- ===========================================================================
-- PART 6: FAMILY_MEMBER_PROFILES — DATE OF BIRTH
-- ===========================================================================

ALTER TABLE family_member_profiles
  ADD COLUMN IF NOT EXISTS date_of_birth_encrypted TEXT;

UPDATE family_member_profiles
SET
  date_of_birth_encrypted = encrypt_pii(date_of_birth::text, tenant_id)
WHERE date_of_birth IS NOT NULL;

ALTER TABLE family_member_profiles
  DROP COLUMN IF EXISTS date_of_birth;

-- ===========================================================================
-- PART 7: UPDATE AUTH FUNCTIONS FOR HASHED EMAIL LOOKUPS
-- ===========================================================================

-- Update create_user_with_tenant to encrypt on insert
DROP FUNCTION IF EXISTS public.create_user_with_tenant(uuid, uuid, text, user_role, text);
CREATE OR REPLACE FUNCTION public.create_user_with_tenant(
  p_auth_user_id UUID,
  p_tenant_id UUID,
  p_email TEXT,
  p_role user_role,
  p_display_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  INSERT INTO users (auth_user_id, tenant_id, email_hash, email_encrypted, display_name_encrypted, role)
  VALUES (
    p_auth_user_id,
    p_tenant_id,
    hash_pii(p_email),
    encrypt_pii(p_email, p_tenant_id),
    encrypt_pii(p_display_name, p_tenant_id),
    p_role
  )
  RETURNING id INTO v_user_id;

  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update custom_access_token_hook to use email_hash for lookup
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb AS $$
DECLARE
  v_user RECORD;
  v_claims jsonb;
BEGIN
  SELECT u.id, u.tenant_id, u.role
  INTO v_user
  FROM users u
  WHERE u.auth_user_id = (event->>'user_id')::uuid
  LIMIT 1;

  v_claims := event->'claims';

  IF v_user IS NOT NULL THEN
    v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_user.tenant_id::text));
    v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(v_user.role::text));
    v_claims := jsonb_set(v_claims, '{app_user_id}', to_jsonb(v_user.id::text));
  END IF;

  event := jsonb_set(event, '{claims}', v_claims);
  RETURN event;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
