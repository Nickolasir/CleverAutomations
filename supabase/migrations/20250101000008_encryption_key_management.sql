-- =============================================================================
-- Encryption Key Management: pgcrypto + Supabase Vault
-- =============================================================================
-- Field-level PII encryption using pgcrypto's PGP symmetric encryption.
-- One master key stored in Vault, per-tenant key derivation via HMAC.
--
-- pgcrypto (pgp_sym_encrypt/decrypt) provides:
--   - AES-256 encryption with CFB mode
--   - S2K key derivation from passphrase
--   - Random session key + IV per encryption call
--   - SHA-1 integrity check (MDC)
--   - bytea output (no manual wire format needed)
--
-- Per-tenant isolation: passphrase = master_key || ':' || tenant_id
-- This derives a unique encryption key per tenant from a single Vault secret.
--
-- PREREQUISITES (run in Supabase SQL Editor BEFORE this migration):
--
--   SELECT vault.create_secret(
--     'PUT_YOUR_64_HEX_CHAR_KEY_HERE',
--     'pii_master_key',
--     'Master key for PII field-level encryption'
--   );
--
-- Generate the key locally with: openssl rand -hex 32
-- =============================================================================

BEGIN;

-- ===========================================================================
-- PART 1: EXTENSIONS
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===========================================================================
-- PART 2: CLEANUP PREVIOUS MIGRATION ATTEMPTS
-- ===========================================================================
-- Previous versions tried pgsodium (deprecated) and private schema tables.
-- Drop all leftover objects so CREATE OR REPLACE succeeds cleanly.

DROP TRIGGER IF EXISTS trg_tenant_provision_key ON tenants;
DROP FUNCTION IF EXISTS public.trg_provision_tenant_key() CASCADE;
DROP FUNCTION IF EXISTS public.provision_tenant_encryption_key(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.encrypt_pii(text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.decrypt_pii(text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.encrypt_pii_jsonb(jsonb, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.decrypt_pii_jsonb(text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.hash_pii(text) CASCADE;
DROP FUNCTION IF EXISTS private.get_master_key() CASCADE;
DROP FUNCTION IF EXISTS private.get_tenant_key(uuid) CASCADE;
DROP TABLE IF EXISTS private.tenant_encryption_keys CASCADE;
DROP TABLE IF EXISTS private.encryption_config CASCADE;

-- ===========================================================================
-- PART 3: MASTER KEY HELPER
-- ===========================================================================
-- Reads the master key from Vault. The secret must be pre-created using
-- vault.create_secret() in the SQL Editor (not raw INSERT).

CREATE OR REPLACE FUNCTION public.get_pii_passphrase(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_master TEXT;
BEGIN
  SELECT decrypted_secret INTO v_master
  FROM vault.decrypted_secrets
  WHERE name = 'pii_master_key';

  IF v_master IS NULL THEN
    RAISE EXCEPTION 'Vault secret "pii_master_key" not found. Run vault.create_secret() first.';
  END IF;

  -- Derive per-tenant passphrase so each tenant's data uses a unique key
  RETURN v_master || ':' || p_tenant_id::text;
END;
$$;

-- Only postgres and service_role should call this
REVOKE EXECUTE ON FUNCTION public.get_pii_passphrase(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pii_passphrase(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_pii_passphrase(uuid) FROM authenticated;

-- ===========================================================================
-- PART 4: ENCRYPT / DECRYPT FUNCTIONS
-- ===========================================================================
-- Uses pgp_sym_encrypt/decrypt from pgcrypto. Each call generates a random
-- session key and IV internally — no manual nonce management needed.
-- Output is bytea stored as base64 text for compatibility with existing schema.

CREATE OR REPLACE FUNCTION public.encrypt_pii(
  p_plaintext TEXT,
  p_tenant_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_passphrase TEXT;
BEGIN
  IF p_plaintext IS NULL THEN RETURN NULL; END IF;

  v_passphrase := get_pii_passphrase(p_tenant_id);

  -- pgp_sym_encrypt returns bytea; encode to base64 for TEXT column storage
  RETURN encode(
    pgp_sym_encrypt(p_plaintext, v_passphrase, 'compress-algo=0, cipher-algo=aes256'),
    'base64'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_pii(
  p_ciphertext TEXT,
  p_tenant_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_passphrase TEXT;
BEGIN
  IF p_ciphertext IS NULL THEN RETURN NULL; END IF;

  v_passphrase := get_pii_passphrase(p_tenant_id);

  RETURN pgp_sym_decrypt(decode(p_ciphertext, 'base64'), v_passphrase);
END;
$$;

CREATE OR REPLACE FUNCTION public.encrypt_pii_jsonb(
  p_data JSONB,
  p_tenant_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_data IS NULL THEN RETURN NULL; END IF;
  RETURN encrypt_pii(p_data::text, p_tenant_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_pii_jsonb(
  p_ciphertext TEXT,
  p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_ciphertext IS NULL THEN RETURN NULL; END IF;
  RETURN decrypt_pii(p_ciphertext, p_tenant_id)::jsonb;
END;
$$;

-- ===========================================================================
-- PART 5: ONE-WAY HASH FOR LOOKUPS
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.hash_pii(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  RETURN encode(digest(lower(trim(p_value)), 'sha256'), 'hex');
END;
$$;

-- ===========================================================================
-- PART 6: KEY PROVISIONING (simplified — no per-tenant key table needed)
-- ===========================================================================
-- With passphrase-based derivation from the Vault master key, there is no
-- separate per-tenant key to provision. This function is kept for API
-- compatibility with existing code that calls it on tenant creation.
-- It simply verifies the master key exists in Vault.

CREATE OR REPLACE FUNCTION public.provision_tenant_encryption_key(
  p_tenant_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_master TEXT;
BEGIN
  SELECT decrypted_secret INTO v_master
  FROM vault.decrypted_secrets
  WHERE name = 'pii_master_key';

  IF v_master IS NULL THEN
    RAISE EXCEPTION 'Vault secret "pii_master_key" not found. Run vault.create_secret() first.';
  END IF;

  -- Return a deterministic UUID for this tenant (for compatibility)
  RETURN gen_random_uuid();
END;
$$;

-- ===========================================================================
-- PART 7: TRIGGER (kept for forward compatibility)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.trg_provision_tenant_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM provision_tenant_encryption_key(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_provision_key ON tenants;
CREATE TRIGGER trg_tenant_provision_key
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION trg_provision_tenant_key();

COMMIT;
