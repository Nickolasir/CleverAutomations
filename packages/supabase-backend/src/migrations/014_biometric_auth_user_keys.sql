-- =============================================================================
-- Biometric/PIN Elevated Auth Sessions + Per-User Encryption Keys
-- =============================================================================
-- Adds infrastructure for two cross-cutting features:
--
-- 1. Elevated auth sessions: biometric (Face ID, fingerprint) or PIN-based
--    secondary authentication required before accessing sensitive data
--    (email content, nutrition health data). Sessions are time-limited
--    (default 15 minutes) and per-user.
--
-- 2. Per-user encryption key derivation: extends the existing per-tenant
--    passphrase pattern (master_key || ':' || tenant_id) to add user-level
--    isolation (master_key || ':' || tenant_id || ':' || user_id). This
--    ensures personal health data and email tokens cannot be decrypted
--    even by tenant admins.
--
-- Dependencies: migration 008 (encryption key management, pgcrypto, Vault)
-- =============================================================================

BEGIN;

-- ===========================================================================
-- PART 1: ENUM TYPES
-- ===========================================================================

DO $$ BEGIN
  CREATE TYPE elevated_auth_method AS ENUM (
    'biometric',        -- Face ID, Touch ID, fingerprint
    'pin',              -- 4-6 digit PIN (fallback for devices without biometrics)
    'device_passcode'   -- OS-level device lock (Android pattern, iOS passcode)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend audit_action for elevated auth events
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'elevated_auth_success';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'elevated_auth_failed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'pin_lockout';

-- ===========================================================================
-- PART 2: ELEVATED AUTH SESSIONS TABLE
-- ===========================================================================
-- Tracks time-limited elevated authentication sessions. After a user
-- verifies via biometric or PIN, a session token is issued that grants
-- access to sensitive data for a limited duration.
--
-- SECURITY: Only the session_token_hash is stored (SHA-256). The plaintext
-- token is returned to the client once and never persisted server-side.

CREATE TABLE IF NOT EXISTS public.user_auth_sessions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  auth_method       elevated_auth_method NOT NULL,

  -- SHA-256 hash of the session token (never store plaintext)
  session_token_hash TEXT NOT NULL,

  -- Session lifetime
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '15 minutes',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Null if active, set when explicitly revoked
  revoked_at        TIMESTAMPTZ
);

CREATE INDEX idx_user_auth_sessions_user ON user_auth_sessions (tenant_id, user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_user_auth_sessions_token ON user_auth_sessions (session_token_hash)
  WHERE revoked_at IS NULL;

-- ===========================================================================
-- PART 3: PIN CREDENTIALS TABLE
-- ===========================================================================
-- Stores bcrypt-hashed PINs for users who set up PIN-based elevated auth.
-- One PIN per user per tenant. Lockout after 5 failed attempts (15 min).

CREATE TABLE IF NOT EXISTS public.user_pin_credentials (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- bcrypt hash of 4-6 digit PIN
  pin_hash          TEXT NOT NULL,

  -- Brute-force protection
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  locked_until      TIMESTAMPTZ,           -- null = not locked

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_user_pin UNIQUE (tenant_id, user_id)
);

-- ===========================================================================
-- PART 4: ENABLE RLS
-- ===========================================================================

ALTER TABLE user_auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_auth_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE user_pin_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_pin_credentials FORCE ROW LEVEL SECURITY;

-- ===========================================================================
-- PART 5: RLS POLICIES — user_auth_sessions (user-only, NO admin access)
-- ===========================================================================
-- These are private security sessions. Even tenant admins cannot view
-- another user's elevated auth sessions.

CREATE POLICY user_auth_sessions_select ON user_auth_sessions
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY user_auth_sessions_insert ON user_auth_sessions
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY user_auth_sessions_update ON user_auth_sessions
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 6: RLS POLICIES — user_pin_credentials (user-only, NO admin access)
-- ===========================================================================

CREATE POLICY user_pin_credentials_select ON user_pin_credentials
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY user_pin_credentials_insert ON user_pin_credentials
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY user_pin_credentials_update ON user_pin_credentials
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY user_pin_credentials_delete ON user_pin_credentials
  FOR DELETE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 7: PER-USER ENCRYPTION KEY DERIVATION
-- ===========================================================================
-- Extends the existing get_pii_passphrase(tenant_id) pattern from migration
-- 008 to include user_id in the derivation path. This produces a unique key
-- per user so that personal health data and email tokens are encrypted with
-- a key that only that user's operations can derive.
--
-- Passphrase = master_key || ':' || tenant_id || ':' || user_id

CREATE OR REPLACE FUNCTION public.get_pii_user_passphrase(
  p_tenant_id UUID,
  p_user_id UUID
)
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

  -- Derive per-user passphrase: master || tenant || user
  RETURN v_master || ':' || p_tenant_id::text || ':' || p_user_id::text;
END;
$$;

-- Only postgres and service_role should call this
REVOKE EXECUTE ON FUNCTION public.get_pii_user_passphrase(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pii_user_passphrase(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_pii_user_passphrase(uuid, uuid) FROM authenticated;

-- ===========================================================================
-- PART 8: PER-USER ENCRYPT / DECRYPT FUNCTIONS
-- ===========================================================================
-- Same pattern as encrypt_pii() / decrypt_pii() from migration 008, but
-- using the user-level passphrase.

CREATE OR REPLACE FUNCTION public.encrypt_pii_user(
  p_plaintext TEXT,
  p_tenant_id UUID,
  p_user_id UUID
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

  v_passphrase := get_pii_user_passphrase(p_tenant_id, p_user_id);

  RETURN encode(
    pgp_sym_encrypt(p_plaintext, v_passphrase, 'compress-algo=0, cipher-algo=aes256'),
    'base64'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_pii_user(
  p_ciphertext TEXT,
  p_tenant_id UUID,
  p_user_id UUID
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

  v_passphrase := get_pii_user_passphrase(p_tenant_id, p_user_id);

  RETURN pgp_sym_decrypt(decode(p_ciphertext, 'base64'), v_passphrase);
END;
$$;

CREATE OR REPLACE FUNCTION public.encrypt_pii_user_jsonb(
  p_data JSONB,
  p_tenant_id UUID,
  p_user_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_data IS NULL THEN RETURN NULL; END IF;
  RETURN encrypt_pii_user(p_data::text, p_tenant_id, p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_pii_user_jsonb(
  p_ciphertext TEXT,
  p_tenant_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_ciphertext IS NULL THEN RETURN NULL; END IF;
  RETURN decrypt_pii_user(p_ciphertext, p_tenant_id, p_user_id)::jsonb;
END;
$$;

-- ===========================================================================
-- PART 9: ELEVATED SESSION MANAGEMENT FUNCTIONS
-- ===========================================================================

-- Create an elevated session and return the plaintext token (one-time)
CREATE OR REPLACE FUNCTION public.create_elevated_session(
  p_user_id UUID,
  p_tenant_id UUID,
  p_auth_method elevated_auth_method,
  p_duration_minutes INTEGER DEFAULT 15
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token TEXT;
  v_token_hash TEXT;
BEGIN
  -- Generate a cryptographically random session token
  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  -- Revoke any existing active sessions for this user (one session at a time)
  UPDATE user_auth_sessions
  SET revoked_at = now()
  WHERE user_id = p_user_id
    AND tenant_id = p_tenant_id
    AND revoked_at IS NULL
    AND expires_at > now();

  -- Create new session
  INSERT INTO user_auth_sessions (tenant_id, user_id, auth_method, session_token_hash, expires_at)
  VALUES (
    p_tenant_id,
    p_user_id,
    p_auth_method,
    v_token_hash,
    now() + (p_duration_minutes || ' minutes')::INTERVAL
  );

  -- Return plaintext token (stored only on client side)
  RETURN v_token;
END;
$$;

-- Validate an elevated session token
CREATE OR REPLACE FUNCTION public.validate_elevated_session(
  p_session_token TEXT,
  p_user_id UUID,
  p_tenant_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token_hash TEXT;
  v_exists BOOLEAN;
BEGIN
  v_token_hash := encode(digest(p_session_token, 'sha256'), 'hex');

  SELECT EXISTS (
    SELECT 1 FROM user_auth_sessions
    WHERE session_token_hash = v_token_hash
      AND user_id = p_user_id
      AND tenant_id = p_tenant_id
      AND revoked_at IS NULL
      AND expires_at > now()
  ) INTO v_exists;

  RETURN v_exists;
END;
$$;

-- Revoke all elevated sessions for a user
CREATE OR REPLACE FUNCTION public.revoke_elevated_sessions(
  p_user_id UUID,
  p_tenant_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE user_auth_sessions
  SET revoked_at = now()
  WHERE user_id = p_user_id
    AND tenant_id = p_tenant_id
    AND revoked_at IS NULL
    AND expires_at > now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ===========================================================================
-- PART 10: PIN MANAGEMENT FUNCTIONS
-- ===========================================================================

-- Verify a PIN attempt with lockout protection
CREATE OR REPLACE FUNCTION public.verify_user_pin(
  p_user_id UUID,
  p_tenant_id UUID,
  p_pin TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_record RECORD;
  v_match BOOLEAN;
BEGIN
  SELECT * INTO v_record
  FROM user_pin_credentials
  WHERE user_id = p_user_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Check lockout
  IF v_record.locked_until IS NOT NULL AND v_record.locked_until > now() THEN
    RETURN false;
  END IF;

  -- Verify PIN against bcrypt hash
  v_match := (v_record.pin_hash = crypt(p_pin, v_record.pin_hash));

  IF v_match THEN
    -- Reset failed attempts on success
    UPDATE user_pin_credentials
    SET failed_attempts = 0, locked_until = NULL, updated_at = now()
    WHERE id = v_record.id;
  ELSE
    -- Increment failed attempts
    UPDATE user_pin_credentials
    SET
      failed_attempts = v_record.failed_attempts + 1,
      locked_until = CASE
        WHEN v_record.failed_attempts + 1 >= 5
        THEN now() + INTERVAL '15 minutes'
        ELSE locked_until
      END,
      updated_at = now()
    WHERE id = v_record.id;
  END IF;

  RETURN v_match;
END;
$$;

-- Set or update a user's PIN
CREATE OR REPLACE FUNCTION public.set_user_pin(
  p_user_id UUID,
  p_tenant_id UUID,
  p_pin TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  -- Validate PIN format (4-6 digits)
  IF p_pin !~ '^\d{4,6}$' THEN
    RAISE EXCEPTION 'PIN must be 4-6 digits';
  END IF;

  v_hash := crypt(p_pin, gen_salt('bf', 10));

  INSERT INTO user_pin_credentials (tenant_id, user_id, pin_hash)
  VALUES (p_tenant_id, p_user_id, v_hash)
  ON CONFLICT (tenant_id, user_id) DO UPDATE
  SET pin_hash = v_hash, failed_attempts = 0, locked_until = NULL, updated_at = now();
END;
$$;

-- ===========================================================================
-- PART 11: TRIGGERS
-- ===========================================================================

CREATE TRIGGER trg_user_pin_credentials_updated_at
  BEFORE UPDATE ON user_pin_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
