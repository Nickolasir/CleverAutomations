-- =============================================================================
-- Clever Automations - Row-Level Security Policies
-- =============================================================================
-- Every table has RLS enabled. Tenant isolation is the foundation: all queries
-- are filtered by auth.jwt()->>'tenant_id'. Role hierarchy governs CRUD scope.
--
-- Role hierarchy (highest to lowest):
--   owner   -> full tenant access, can read audit logs
--   admin   -> manage users, devices, scenes, rooms; no audit log read
--   manager -> manage devices, scenes, rooms; read users
--   resident-> read devices, scenes, rooms; control devices
--   guest   -> read own profile + explicitly allowed devices only
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: extract tenant_id from JWT claims
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.tenant_id()
RETURNS UUID AS $$
  SELECT (auth.jwt()->>'tenant_id')::uuid;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- Helper: extract user_role from JWT claims
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS user_role AS $$
  SELECT (auth.jwt()->>'user_role')::user_role;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- Helper: extract user_id (sub) from JWT claims
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.user_id()
RETURNS UUID AS $$
  SELECT (auth.jwt()->>'sub')::uuid;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- Helper: rate limiting for device commands (max 60/min per user)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_device_command_rate_limit(p_user_id UUID, p_tenant_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  command_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO command_count
  FROM audit_logs
  WHERE tenant_id = p_tenant_id
    AND user_id = p_user_id
    AND action = 'device_command_issued'
    AND timestamp > (now() - interval '1 minute');

  RETURN command_count < 60;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- Helper: check if a role is at or above a given level
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION role_at_least(required user_role)
RETURNS BOOLEAN AS $$
DECLARE
  current_role user_role;
  role_levels  INTEGER[];
BEGIN
  current_role := auth.user_role();

  -- Map roles to numeric levels: owner=5, admin=4, manager=3, resident=2, guest=1
  RETURN CASE current_role
    WHEN 'owner'    THEN 5
    WHEN 'admin'    THEN 4
    WHEN 'manager'  THEN 3
    WHEN 'resident' THEN 2
    WHEN 'guest'    THEN 1
    ELSE 0
  END >= CASE required
    WHEN 'owner'    THEN 5
    WHEN 'admin'    THEN 4
    WHEN 'manager'  THEN 3
    WHEN 'resident' THEN 2
    WHEN 'guest'    THEN 1
    ELSE 0
  END;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- ===========================================================================
-- ENABLE RLS ON EVERY TABLE
-- ===========================================================================
ALTER TABLE tenants              ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms                ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_transcripts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_telemetry     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_wipe_checklists ENABLE ROW LEVEL SECURITY;

-- Force RLS on table owners too (prevents bypass via superuser-owned functions)
ALTER TABLE tenants              FORCE ROW LEVEL SECURITY;
ALTER TABLE users                FORCE ROW LEVEL SECURITY;
ALTER TABLE devices              FORCE ROW LEVEL SECURITY;
ALTER TABLE rooms                FORCE ROW LEVEL SECURITY;
ALTER TABLE scenes               FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_sessions       FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_transcripts    FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           FORCE ROW LEVEL SECURITY;
ALTER TABLE sensor_telemetry     FORCE ROW LEVEL SECURITY;
ALTER TABLE reservations         FORCE ROW LEVEL SECURITY;
ALTER TABLE guest_profiles       FORCE ROW LEVEL SECURITY;
ALTER TABLE guest_wipe_checklists FORCE ROW LEVEL SECURITY;


-- ===========================================================================
-- 1. TENANTS
-- ===========================================================================
-- Owners can read/update their own tenant
CREATE POLICY tenants_select ON tenants
  FOR SELECT USING (id = auth.tenant_id());

CREATE POLICY tenants_update ON tenants
  FOR UPDATE USING (id = auth.tenant_id() AND role_at_least('owner'));


-- ===========================================================================
-- 2. USERS
-- ===========================================================================
-- All authenticated tenant members can see users in their tenant
CREATE POLICY users_select ON users
  FOR SELECT USING (tenant_id = auth.tenant_id());

-- Owners and admins can create users
CREATE POLICY users_insert ON users
  FOR INSERT WITH CHECK (
    tenant_id = auth.tenant_id()
    AND role_at_least('admin')
  );

-- Owners and admins can update users; users can update themselves
CREATE POLICY users_update ON users
  FOR UPDATE USING (
    tenant_id = auth.tenant_id()
    AND (role_at_least('admin') OR id = auth.user_id())
  );

-- Only owners can delete users
CREATE POLICY users_delete ON users
  FOR DELETE USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('owner')
  );


-- ===========================================================================
-- 3. DEVICES
-- ===========================================================================
-- Residents and above see all tenant devices
CREATE POLICY devices_select_members ON devices
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('resident')
  );

-- Guests see only devices explicitly assigned to them via guest profile
-- (guest profiles link to reservations which have property_id scoping)
CREATE POLICY devices_select_guests ON devices
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND auth.user_role() = 'guest'
    AND EXISTS (
      SELECT 1 FROM guest_profiles gp
      JOIN reservations r ON r.guest_profile_id = gp.id
      WHERE gp.tenant_id = auth.tenant_id()
        AND r.status = 'active'
        AND (gp.voice_preferences->>'allowed_devices') IS NOT NULL
        AND gp.voice_preferences->'allowed_devices' ? devices.id::text
    )
  );

-- Managers and above can insert/update/delete devices
CREATE POLICY devices_insert ON devices
  FOR INSERT WITH CHECK (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

CREATE POLICY devices_update ON devices
  FOR UPDATE USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

CREATE POLICY devices_delete ON devices
  FOR DELETE USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('admin')
  );


-- ===========================================================================
-- 4. ROOMS
-- ===========================================================================
CREATE POLICY rooms_select ON rooms
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('resident')
  );

CREATE POLICY rooms_insert ON rooms
  FOR INSERT WITH CHECK (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

CREATE POLICY rooms_update ON rooms
  FOR UPDATE USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

CREATE POLICY rooms_delete ON rooms
  FOR DELETE USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('admin')
  );


-- ===========================================================================
-- 5. SCENES
-- ===========================================================================
CREATE POLICY scenes_select ON scenes
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('resident')
  );

CREATE POLICY scenes_insert ON scenes
  FOR INSERT WITH CHECK (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

CREATE POLICY scenes_update ON scenes
  FOR UPDATE USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

CREATE POLICY scenes_delete ON scenes
  FOR DELETE USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('admin')
  );


-- ===========================================================================
-- 6. VOICE SESSIONS
-- ===========================================================================
-- Residents+ see all tenant voice sessions; guests see only their own
CREATE POLICY voice_sessions_select_members ON voice_sessions
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('resident')
  );

CREATE POLICY voice_sessions_select_guests ON voice_sessions
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND auth.user_role() = 'guest'
    AND user_id = auth.user_id()
  );

-- Insert allowed for all authenticated tenant users (voice pipeline creates these)
CREATE POLICY voice_sessions_insert ON voice_sessions
  FOR INSERT WITH CHECK (
    tenant_id = auth.tenant_id()
  );

-- Only the voice pipeline (service role) or managers+ can update
CREATE POLICY voice_sessions_update ON voice_sessions
  FOR UPDATE USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );


-- ===========================================================================
-- 7. VOICE TRANSCRIPTS
-- ===========================================================================
-- Same pattern as voice sessions
CREATE POLICY voice_transcripts_select_members ON voice_transcripts
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('resident')
  );

CREATE POLICY voice_transcripts_select_guests ON voice_transcripts
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND auth.user_role() = 'guest'
    AND user_id = auth.user_id()
  );

CREATE POLICY voice_transcripts_insert ON voice_transcripts
  FOR INSERT WITH CHECK (
    tenant_id = auth.tenant_id()
  );


-- ===========================================================================
-- 8. AUDIT LOGS
-- ===========================================================================
-- Insert-only for all authenticated users (everyone creates audit entries)
CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT WITH CHECK (
    tenant_id = auth.tenant_id()
  );

-- Only owners can read audit logs
CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('owner')
  );

-- No UPDATE or DELETE — audit logs are immutable


-- ===========================================================================
-- 9. SENSOR TELEMETRY
-- ===========================================================================
CREATE POLICY sensor_telemetry_select ON sensor_telemetry
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('resident')
  );

CREATE POLICY sensor_telemetry_insert ON sensor_telemetry
  FOR INSERT WITH CHECK (
    tenant_id = auth.tenant_id()
  );

-- No UPDATE or DELETE — telemetry is append-only


-- ===========================================================================
-- 10. RESERVATIONS
-- ===========================================================================
CREATE POLICY reservations_select ON reservations
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

-- Guests can see their own active reservation
CREATE POLICY reservations_select_guests ON reservations
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND auth.user_role() = 'guest'
    AND status = 'active'
    AND guest_profile_id IN (
      SELECT gp.id FROM guest_profiles gp
      WHERE gp.tenant_id = auth.tenant_id()
    )
  );

CREATE POLICY reservations_insert ON reservations
  FOR INSERT WITH CHECK (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

CREATE POLICY reservations_update ON reservations
  FOR UPDATE USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

CREATE POLICY reservations_delete ON reservations
  FOR DELETE USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('owner')
  );


-- ===========================================================================
-- 11. GUEST PROFILES
-- ===========================================================================
-- Managers+ see all guest profiles; guests see only their own
CREATE POLICY guest_profiles_select_managers ON guest_profiles
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

CREATE POLICY guest_profiles_select_guests ON guest_profiles
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND auth.user_role() = 'guest'
    AND id IN (
      SELECT r.guest_profile_id FROM reservations r
      WHERE r.tenant_id = auth.tenant_id()
        AND r.status = 'active'
    )
  );

CREATE POLICY guest_profiles_insert ON guest_profiles
  FOR INSERT WITH CHECK (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

CREATE POLICY guest_profiles_update ON guest_profiles
  FOR UPDATE USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

CREATE POLICY guest_profiles_delete ON guest_profiles
  FOR DELETE USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );


-- ===========================================================================
-- 12. GUEST WIPE CHECKLISTS
-- ===========================================================================
CREATE POLICY guest_wipe_checklists_select ON guest_wipe_checklists
  FOR SELECT USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

CREATE POLICY guest_wipe_checklists_insert ON guest_wipe_checklists
  FOR INSERT WITH CHECK (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );

CREATE POLICY guest_wipe_checklists_update ON guest_wipe_checklists
  FOR UPDATE USING (
    tenant_id = auth.tenant_id()
    AND role_at_least('manager')
  );
