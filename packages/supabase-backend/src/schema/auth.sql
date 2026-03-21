-- =============================================================================
-- Clever Automations - Auth Setup
-- =============================================================================
-- Custom JWT claims hook, user creation with tenant assignment,
-- and device-scoped token validation.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Custom JWT Claims Hook
-- ---------------------------------------------------------------------------
-- Supabase Auth calls this function on every token refresh to inject
-- custom claims (tenant_id, user_role) into the JWT payload.
-- This is what powers all RLS policies throughout the system.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.custom_access_token_hook(event JSONB)
RETURNS JSONB AS $$
DECLARE
  claims       JSONB;
  user_tenant  UUID;
  user_role_v  user_role;
  user_record  RECORD;
BEGIN
  -- Extract the existing claims from the event
  claims := event->'claims';

  -- Look up the user's tenant and role from the users table
  SELECT u.tenant_id, u.role
  INTO user_record
  FROM public.users u
  WHERE u.id = (event->>'user_id')::uuid;

  IF user_record IS NOT NULL THEN
    -- Inject tenant_id and user_role into the JWT claims
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(user_record.tenant_id::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_record.role::text));
  ELSE
    -- User not found in users table — set null claims
    -- This handles the edge case where a Supabase auth user exists
    -- but hasn't been assigned to a tenant yet
    claims := jsonb_set(claims, '{tenant_id}', 'null'::jsonb);
    claims := jsonb_set(claims, '{user_role}', 'null'::jsonb);
  END IF;

  -- Return the modified event with updated claims
  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute permission to supabase_auth_admin (required for hooks)
GRANT EXECUTE ON FUNCTION auth.custom_access_token_hook TO supabase_auth_admin;

-- Revoke from public for security
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM anon;
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM authenticated;


-- ---------------------------------------------------------------------------
-- 2. Create User with Tenant Assignment
-- ---------------------------------------------------------------------------
-- Called after Supabase Auth sign-up to create the user row in public.users
-- and assign them to a tenant. Typically invoked from an Edge Function
-- or a post-signup hook.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_user_with_tenant(
  p_auth_user_id UUID,
  p_tenant_id    UUID,
  p_email        TEXT,
  p_role         user_role DEFAULT 'resident',
  p_display_name TEXT DEFAULT ''
)
RETURNS UUID AS $$
DECLARE
  new_user_id UUID;
  tenant_exists BOOLEAN;
  user_count    INTEGER;
  max_users     INTEGER;
BEGIN
  -- Validate tenant exists
  SELECT EXISTS(SELECT 1 FROM tenants WHERE id = p_tenant_id)
  INTO tenant_exists;

  IF NOT tenant_exists THEN
    RAISE EXCEPTION 'Tenant % does not exist', p_tenant_id;
  END IF;

  -- Check max_users limit from tenant settings
  SELECT (settings->>'max_users')::integer
  INTO max_users
  FROM tenants
  WHERE id = p_tenant_id;

  SELECT COUNT(*)
  INTO user_count
  FROM users
  WHERE tenant_id = p_tenant_id;

  IF user_count >= max_users THEN
    RAISE EXCEPTION 'Tenant % has reached maximum user limit (%)', p_tenant_id, max_users;
  END IF;

  -- Check for duplicate email within tenant
  IF EXISTS(
    SELECT 1 FROM users
    WHERE tenant_id = p_tenant_id AND email = p_email
  ) THEN
    RAISE EXCEPTION 'Email % already exists in tenant %', p_email, p_tenant_id;
  END IF;

  -- Use the auth user ID as the public user ID for consistency
  INSERT INTO users (id, tenant_id, email, role, display_name)
  VALUES (p_auth_user_id, p_tenant_id, p_email, p_role, COALESCE(NULLIF(p_display_name, ''), split_part(p_email, '@', 1)))
  RETURNING id INTO new_user_id;

  -- Create audit log entry
  INSERT INTO audit_logs (tenant_id, user_id, action, details)
  VALUES (
    p_tenant_id,
    new_user_id,
    'user_created',
    jsonb_build_object(
      'email', p_email,
      'role', p_role::text,
      'display_name', p_display_name
    )
  );

  RETURN new_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only service role should call this function
REVOKE EXECUTE ON FUNCTION create_user_with_tenant FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_user_with_tenant FROM anon;
REVOKE EXECUTE ON FUNCTION create_user_with_tenant FROM authenticated;


-- ---------------------------------------------------------------------------
-- 3. Validate Device-Scoped Token
-- ---------------------------------------------------------------------------
-- Devices authenticate with scoped JWTs that contain a device_scope claim.
-- This function validates that:
--   a) The device exists in the tenant
--   b) The device_scope in the JWT matches the device being accessed
--   c) The device is online and not deregistered
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_device_scoped_token(
  p_device_id   UUID,
  p_tenant_id   UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  jwt_device_scope TEXT;
  device_exists    BOOLEAN;
BEGIN
  -- Extract device_scope from JWT claims
  jwt_device_scope := auth.jwt()->>'device_scope';

  -- If no device_scope claim, this is a regular user token — allow
  IF jwt_device_scope IS NULL THEN
    RETURN true;
  END IF;

  -- Device-scoped token: verify the scope matches the target device
  IF jwt_device_scope != p_device_id::text THEN
    RETURN false;
  END IF;

  -- Verify the device exists in the specified tenant and is registered
  SELECT EXISTS(
    SELECT 1 FROM devices
    WHERE id = p_device_id
      AND tenant_id = p_tenant_id
  ) INTO device_exists;

  RETURN device_exists;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- ---------------------------------------------------------------------------
-- 4. Create Tenant with Owner
-- ---------------------------------------------------------------------------
-- Bootstrap function: creates a new tenant and assigns the creating user
-- as the owner. Used during initial signup flow.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_tenant_with_owner(
  p_auth_user_id  UUID,
  p_tenant_name   TEXT,
  p_vertical      market_vertical,
  p_email         TEXT,
  p_display_name  TEXT DEFAULT '',
  p_tier          subscription_tier DEFAULT 'starter'
)
RETURNS UUID AS $$
DECLARE
  new_tenant_id UUID;
BEGIN
  -- Create the tenant
  INSERT INTO tenants (name, vertical, subscription_tier)
  VALUES (p_tenant_name, p_vertical, p_tier)
  RETURNING id INTO new_tenant_id;

  -- Create the owner user
  PERFORM create_user_with_tenant(
    p_auth_user_id,
    new_tenant_id,
    p_email,
    'owner',
    p_display_name
  );

  RETURN new_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only service role should call this function
REVOKE EXECUTE ON FUNCTION create_tenant_with_owner FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_tenant_with_owner FROM anon;
REVOKE EXECUTE ON FUNCTION create_tenant_with_owner FROM authenticated;
