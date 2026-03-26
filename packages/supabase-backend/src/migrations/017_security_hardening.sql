-- =============================================================================
-- Security Hardening: REVOKE + Authorization Checks
-- =============================================================================
-- Addresses security audit findings:
--   C2: encrypt/decrypt_pii_user callable by any authenticated user
--   C3: session management functions callable by any authenticated user
--   M5: encrypt/decrypt_pii (tenant-level) also callable by any authenticated user
--   M3: missing DELETE RLS policy on user_auth_sessions
--   M2: no cleanup of expired sessions
--   H2: PIN change requires elevated auth (server-side enforcement)
--
-- Dependencies: migrations 008, 014
-- =============================================================================

BEGIN;

-- ===========================================================================
-- PART 1: REVOKE — Migration 008 encrypt/decrypt functions (M5)
-- ===========================================================================
-- These SECURITY DEFINER functions should only be called by postgres and
-- service_role (via Edge Functions / triggers), never directly by clients.

REVOKE EXECUTE ON FUNCTION public.encrypt_pii(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.encrypt_pii(text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.encrypt_pii(text, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.decrypt_pii(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrypt_pii(text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.decrypt_pii(text, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.encrypt_pii_jsonb(jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.encrypt_pii_jsonb(jsonb, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.encrypt_pii_jsonb(jsonb, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.decrypt_pii_jsonb(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrypt_pii_jsonb(text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.decrypt_pii_jsonb(text, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.hash_pii(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hash_pii(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.hash_pii(text) FROM authenticated;

-- ===========================================================================
-- PART 2: REVOKE — Migration 014 per-user encrypt/decrypt functions (C2)
-- ===========================================================================

REVOKE EXECUTE ON FUNCTION public.encrypt_pii_user(text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.encrypt_pii_user(text, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.encrypt_pii_user(text, uuid, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.decrypt_pii_user(text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrypt_pii_user(text, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.decrypt_pii_user(text, uuid, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.encrypt_pii_user_jsonb(jsonb, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.encrypt_pii_user_jsonb(jsonb, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.encrypt_pii_user_jsonb(jsonb, uuid, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.decrypt_pii_user_jsonb(text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrypt_pii_user_jsonb(text, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.decrypt_pii_user_jsonb(text, uuid, uuid) FROM authenticated;

-- ===========================================================================
-- PART 3: REVOKE — Session management functions (C3)
-- ===========================================================================
-- These are called by the elevated-auth Edge Function using service_role.
-- Direct client access must be blocked.

REVOKE EXECUTE ON FUNCTION public.create_elevated_session(uuid, uuid, elevated_auth_method, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_elevated_session(uuid, uuid, elevated_auth_method, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_elevated_session(uuid, uuid, elevated_auth_method, integer) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.validate_elevated_session(text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_elevated_session(text, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_elevated_session(text, uuid, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.revoke_elevated_sessions(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_elevated_sessions(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.revoke_elevated_sessions(uuid, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.verify_user_pin(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_user_pin(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.verify_user_pin(uuid, uuid, text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.set_user_pin(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_pin(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_user_pin(uuid, uuid, text) FROM authenticated;

-- ===========================================================================
-- PART 4: DELETE RLS POLICY on user_auth_sessions (M3)
-- ===========================================================================

CREATE POLICY user_auth_sessions_delete ON user_auth_sessions
  FOR DELETE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 5: EXPIRED SESSION CLEANUP FUNCTION (M2)
-- ===========================================================================
-- Purges sessions that expired or were revoked more than 48 hours ago.
-- Intended to be called by pg_cron or the data-retention-cleanup Edge Function.

CREATE OR REPLACE FUNCTION public.cleanup_expired_elevated_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM user_auth_sessions
  WHERE (expires_at < now() - INTERVAL '48 hours')
     OR (revoked_at IS NOT NULL AND revoked_at < now() - INTERVAL '48 hours');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Only postgres / service_role should run cleanup
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_elevated_sessions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_elevated_sessions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_elevated_sessions() FROM authenticated;

-- ===========================================================================
-- PART 6: DEVICE ATTESTATION KEY STORAGE (C1)
-- ===========================================================================
-- Stores public keys for device-bound biometric attestation. On first
-- biometric enrollment, the client generates a key pair in the Secure
-- Enclave (iOS) or Android Keystore. The public key is registered here.
-- On subsequent biometric verifications, the client signs a server nonce
-- with the private key (which requires biometric unlock), and the server
-- validates the signature against this stored public key.

CREATE TABLE IF NOT EXISTS public.user_device_attestation_keys (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Device identifier (stable per app install)
  device_id         TEXT NOT NULL,

  -- Public key in PEM or JWK format for signature verification
  public_key        TEXT NOT NULL,

  -- Platform info for key type selection during verification
  platform          TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  key_algorithm     TEXT NOT NULL DEFAULT 'ES256',

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ,

  CONSTRAINT uq_device_attestation UNIQUE (tenant_id, user_id, device_id)
);

CREATE INDEX idx_device_attestation_lookup
  ON user_device_attestation_keys (tenant_id, user_id, device_id)
  WHERE revoked_at IS NULL;

-- RLS: user-only access (same pattern as user_auth_sessions)
ALTER TABLE user_device_attestation_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_device_attestation_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY device_attestation_keys_select ON user_device_attestation_keys
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY device_attestation_keys_insert ON user_device_attestation_keys
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY device_attestation_keys_update ON user_device_attestation_keys
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY device_attestation_keys_delete ON user_device_attestation_keys
  FOR DELETE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 7: ATTESTATION CHALLENGE TABLE
-- ===========================================================================
-- Short-lived nonces for the device attestation challenge-response flow.
-- Server generates a nonce, client signs it with the biometric-gated
-- private key, server verifies the signature.

CREATE TABLE IF NOT EXISTS public.attestation_challenges (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_id         TEXT NOT NULL,

  -- Random nonce the client must sign
  challenge         TEXT NOT NULL,

  -- Short TTL (60 seconds)
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '60 seconds',
  consumed_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Note: expires_at filtering happens at query time, not in the index predicate,
-- because now() is STABLE (not IMMUTABLE) and cannot appear in partial indexes.
CREATE INDEX IF NOT EXISTS idx_attestation_challenge_lookup
  ON attestation_challenges (tenant_id, user_id, device_id, challenge)
  WHERE consumed_at IS NULL;

ALTER TABLE attestation_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE attestation_challenges FORCE ROW LEVEL SECURITY;

CREATE POLICY attestation_challenges_select ON attestation_challenges
  FOR SELECT USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY attestation_challenges_insert ON attestation_challenges
  FOR INSERT WITH CHECK (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

CREATE POLICY attestation_challenges_update ON attestation_challenges
  FOR UPDATE USING (
    tenant_id = requesting_tenant_id()
    AND user_id = requesting_user_id()
  );

-- ===========================================================================
-- PART 8: ATTESTATION HELPER FUNCTIONS
-- ===========================================================================

-- Generate a challenge nonce for device attestation
CREATE OR REPLACE FUNCTION public.create_attestation_challenge(
  p_user_id UUID,
  p_tenant_id UUID,
  p_device_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_challenge TEXT;
BEGIN
  -- Generate a random challenge nonce
  v_challenge := encode(gen_random_bytes(32), 'hex');

  -- Invalidate any existing challenges for this device
  UPDATE attestation_challenges
  SET consumed_at = now()
  WHERE user_id = p_user_id
    AND tenant_id = p_tenant_id
    AND device_id = p_device_id
    AND consumed_at IS NULL;

  INSERT INTO attestation_challenges (tenant_id, user_id, device_id, challenge)
  VALUES (p_tenant_id, p_user_id, p_device_id, v_challenge);

  RETURN v_challenge;
END;
$$;

-- Validate and consume a challenge (called during signature verification)
CREATE OR REPLACE FUNCTION public.consume_attestation_challenge(
  p_user_id UUID,
  p_tenant_id UUID,
  p_device_id TEXT,
  p_challenge TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_found BOOLEAN;
BEGIN
  UPDATE attestation_challenges
  SET consumed_at = now()
  WHERE user_id = p_user_id
    AND tenant_id = p_tenant_id
    AND device_id = p_device_id
    AND challenge = p_challenge
    AND consumed_at IS NULL
    AND expires_at > now();

  GET DIAGNOSTICS v_found = ROW_COUNT;
  RETURN v_found > 0;
END;
$$;

-- Restrict attestation functions to service_role only
REVOKE EXECUTE ON FUNCTION public.create_attestation_challenge(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_attestation_challenge(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_attestation_challenge(uuid, uuid, text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.consume_attestation_challenge(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_attestation_challenge(uuid, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_attestation_challenge(uuid, uuid, text, text) FROM authenticated;

-- ===========================================================================
-- PART 9: CLEANUP STALE CHALLENGES
-- ===========================================================================
-- Purge consumed or expired challenges older than 1 hour.

CREATE OR REPLACE FUNCTION public.cleanup_attestation_challenges()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM attestation_challenges
  WHERE expires_at < now() - INTERVAL '1 hour';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_attestation_challenges() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_attestation_challenges() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_attestation_challenges() FROM authenticated;

COMMIT;
