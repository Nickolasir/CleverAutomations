-- =============================================================================
-- Data Retention Policy Enforcement (GDPR Article 5(1)(e))
-- =============================================================================
-- Adds configurable per-tenant data retention policies and a function to
-- enforce them. Data must not be kept longer than necessary for its purpose.
--
-- Default retention periods:
--   audit_logs:              90 days
--   sensor_telemetry:        30 days (raw), aggregated daily summaries kept longer
--   aide_activity_log:       90 days
--   aide_medication_logs:   365 days (medical record retention)
--   aide_wellness_checkins: 180 days
--   voice_sessions:          90 days
--   voice_transcripts:       90 days
--   guest_profiles (expired): immediate on expiry
--   ip_address_hash:          7 days (then nullified in audit_logs)
-- =============================================================================

BEGIN;

-- ===========================================================================
-- PART 1: ADD RETENTION POLICY TO TENANTS
-- ===========================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS data_retention_policy JSONB NOT NULL DEFAULT '{
    "audit_logs_days": 90,
    "sensor_telemetry_days": 30,
    "aide_activity_log_days": 90,
    "aide_medication_logs_days": 365,
    "aide_wellness_checkins_days": 180,
    "voice_sessions_days": 90,
    "voice_transcripts_days": 90,
    "ip_truncation_days": 7
  }'::jsonb;

-- ===========================================================================
-- PART 2: DATA RETENTION ENFORCEMENT FUNCTION
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.enforce_data_retention(p_tenant_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_policy JSONB;
  v_result JSONB := '{}'::jsonb;
  v_count BIGINT;
BEGIN
  -- Load tenant's retention policy
  SELECT data_retention_policy INTO v_policy
  FROM tenants WHERE id = p_tenant_id;

  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'Tenant % not found or has no retention policy', p_tenant_id;
  END IF;

  -- 1. Audit logs
  DELETE FROM audit_logs
  WHERE tenant_id = p_tenant_id
    AND created_at < now() - make_interval(days => (v_policy->>'audit_logs_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('audit_logs_deleted', v_count);

  -- 2. Sensor telemetry
  DELETE FROM sensor_telemetry
  WHERE tenant_id = p_tenant_id
    AND recorded_at < now() - make_interval(days => (v_policy->>'sensor_telemetry_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('sensor_telemetry_deleted', v_count);

  -- 3. Aide activity log
  DELETE FROM aide_activity_log
  WHERE tenant_id = p_tenant_id
    AND created_at < now() - make_interval(days => (v_policy->>'aide_activity_log_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('aide_activity_log_deleted', v_count);

  -- 4. Aide medication logs
  DELETE FROM aide_medication_logs
  WHERE tenant_id = p_tenant_id
    AND created_at < now() - make_interval(days => (v_policy->>'aide_medication_logs_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('aide_medication_logs_deleted', v_count);

  -- 5. Aide wellness check-ins
  DELETE FROM aide_wellness_checkins
  WHERE tenant_id = p_tenant_id
    AND created_at < now() - make_interval(days => (v_policy->>'aide_wellness_checkins_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('aide_wellness_checkins_deleted', v_count);

  -- 6. Voice sessions
  DELETE FROM voice_sessions
  WHERE tenant_id = p_tenant_id
    AND created_at < now() - make_interval(days => (v_policy->>'voice_sessions_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('voice_sessions_deleted', v_count);

  -- 7. Voice transcripts
  DELETE FROM voice_transcripts
  WHERE tenant_id = p_tenant_id
    AND created_at < now() - make_interval(days => (v_policy->>'voice_transcripts_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('voice_transcripts_deleted', v_count);

  -- 8. Expired guest profiles
  DELETE FROM guest_profiles
  WHERE tenant_id = p_tenant_id
    AND expires_at IS NOT NULL
    AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('expired_guest_profiles_deleted', v_count);

  -- 9. IP address truncation (nullify hash after N days for privacy)
  UPDATE audit_logs
  SET ip_address_hash = NULL
  WHERE tenant_id = p_tenant_id
    AND ip_address_hash IS NOT NULL
    AND created_at < now() - make_interval(days => (v_policy->>'ip_truncation_days')::int);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('ip_hashes_truncated', v_count);

  -- Log the retention enforcement itself
  INSERT INTO audit_logs (tenant_id, action, details, created_at)
  VALUES (
    p_tenant_id,
    'settings_changed',
    jsonb_build_object(
      'operation', 'data_retention_enforcement',
      'results', v_result
    ),
    now()
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================================================
-- PART 3: ENFORCE RETENTION FOR ALL TENANTS (batch function)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.enforce_all_data_retention()
RETURNS JSONB AS $$
DECLARE
  t RECORD;
  v_results JSONB := '[]'::jsonb;
  v_result JSONB;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    v_result := enforce_data_retention(t.id);
    v_results := v_results || jsonb_build_array(
      jsonb_build_object('tenant_id', t.id, 'results', v_result)
    );
  END LOOP;

  RETURN v_results;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
