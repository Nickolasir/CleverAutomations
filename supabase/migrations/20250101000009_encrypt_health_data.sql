-- =============================================================================
-- Encrypt Health Data at Rest (GDPR Article 9 — Special Category)
-- =============================================================================
-- Migrates plaintext health data in CleverAide tables to encrypted fields
-- using the encrypt_pii / encrypt_pii_jsonb functions from migration 008.
--
-- Idempotent: safe to re-run. Skips data migration if plaintext columns
-- have already been dropped from a prior partial run.
-- =============================================================================

BEGIN;

-- ===========================================================================
-- PART 1: ADD ENCRYPTED COLUMNS (IF NOT EXISTS — idempotent)
-- ===========================================================================

ALTER TABLE aide_profiles
  ADD COLUMN IF NOT EXISTS medical_info_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contacts_encrypted TEXT;

ALTER TABLE aide_medications
  ADD COLUMN IF NOT EXISTS medication_name_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS dosage_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS instructions_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS prescribing_doctor_encrypted TEXT;

ALTER TABLE aide_wellness_checkins
  ADD COLUMN IF NOT EXISTS response_transcript_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS notes_encrypted TEXT;

ALTER TABLE aide_caregiver_alerts
  ADD COLUMN IF NOT EXISTS message_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS details_encrypted TEXT;

ALTER TABLE aide_medication_logs
  ADD COLUMN IF NOT EXISTS notes_encrypted TEXT;

-- ===========================================================================
-- PART 2: MIGRATE DATA (only if plaintext columns still exist)
-- ===========================================================================

DO $$
BEGIN
  -- aide_profiles
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aide_profiles' AND column_name = 'medical_info'
  ) THEN
    UPDATE aide_profiles
    SET
      medical_info_encrypted = encrypt_pii_jsonb(medical_info, tenant_id),
      emergency_contacts_encrypted = encrypt_pii_jsonb(emergency_contacts, tenant_id)
    WHERE (medical_info IS NOT NULL OR emergency_contacts IS NOT NULL)
      AND medical_info_encrypted IS NULL;
  END IF;

  -- aide_medications
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aide_medications' AND column_name = 'medication_name'
  ) THEN
    UPDATE aide_medications
    SET
      medication_name_encrypted = encrypt_pii(medication_name, tenant_id),
      dosage_encrypted = encrypt_pii(dosage, tenant_id),
      instructions_encrypted = encrypt_pii(instructions, tenant_id),
      prescribing_doctor_encrypted = encrypt_pii(prescribing_doctor, tenant_id)
    WHERE medication_name IS NOT NULL
      AND medication_name_encrypted IS NULL;
  END IF;

  -- aide_wellness_checkins
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aide_wellness_checkins' AND column_name = 'response_transcript'
  ) THEN
    UPDATE aide_wellness_checkins
    SET
      response_transcript_encrypted = encrypt_pii(response_transcript, tenant_id),
      notes_encrypted = encrypt_pii(notes, tenant_id)
    WHERE (response_transcript IS NOT NULL OR notes IS NOT NULL)
      AND response_transcript_encrypted IS NULL;
  END IF;

  -- aide_caregiver_alerts
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aide_caregiver_alerts' AND column_name = 'message'
  ) THEN
    UPDATE aide_caregiver_alerts
    SET
      message_encrypted = encrypt_pii(message, tenant_id),
      details_encrypted = encrypt_pii_jsonb(details, tenant_id)
    WHERE message IS NOT NULL
      AND message_encrypted IS NULL;
  END IF;

  -- aide_medication_logs
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aide_medication_logs' AND column_name = 'notes'
  ) THEN
    UPDATE aide_medication_logs
    SET
      notes_encrypted = encrypt_pii(notes, tenant_id)
    WHERE notes IS NOT NULL
      AND notes_encrypted IS NULL;
  END IF;
END $$;

-- ===========================================================================
-- PART 3: DROP PLAINTEXT COLUMNS (IF EXISTS — idempotent)
-- ===========================================================================

ALTER TABLE aide_profiles
  DROP COLUMN IF EXISTS medical_info,
  DROP COLUMN IF EXISTS emergency_contacts;

ALTER TABLE aide_medications
  DROP COLUMN IF EXISTS medication_name,
  DROP COLUMN IF EXISTS dosage,
  DROP COLUMN IF EXISTS instructions,
  DROP COLUMN IF EXISTS prescribing_doctor;

ALTER TABLE aide_wellness_checkins
  DROP COLUMN IF EXISTS response_transcript,
  DROP COLUMN IF EXISTS notes;

ALTER TABLE aide_caregiver_alerts
  DROP COLUMN IF EXISTS message,
  DROP COLUMN IF EXISTS details;

ALTER TABLE aide_medication_logs
  DROP COLUMN IF EXISTS notes;

-- ===========================================================================
-- PART 4: UPDATE HELPER FUNCTIONS TO DECRYPT ON READ
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_aide_profile(
  p_profile_id UUID,
  p_tenant_id UUID
)
RETURNS TABLE (
  id UUID,
  profile_id UUID,
  primary_caregiver_id UUID,
  medical_info JSONB,
  emergency_contacts JSONB,
  mobility_level TEXT,
  cognitive_level TEXT,
  hearing_level TEXT,
  vision_level TEXT,
  preferred_interaction TEXT,
  confirmation_mode TEXT,
  speaking_pace TEXT,
  timezone TEXT
) AS $$
  SELECT
    ap.id, ap.profile_id, ap.primary_caregiver_id,
    decrypt_pii_jsonb(ap.medical_info_encrypted, ap.tenant_id),
    decrypt_pii_jsonb(ap.emergency_contacts_encrypted, ap.tenant_id),
    ap.mobility_level, ap.cognitive_level, ap.hearing_level, ap.vision_level,
    ap.preferred_interaction, ap.confirmation_mode, ap.speaking_pace,
    ap.timezone
  FROM aide_profiles ap
  WHERE ap.profile_id = p_profile_id
    AND ap.tenant_id = p_tenant_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_due_medications(
  p_aide_profile_id UUID,
  p_tenant_id UUID,
  p_window_minutes INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  medication_name TEXT,
  dosage TEXT,
  instructions TEXT,
  scheduled_time TIME
) AS $$
  SELECT
    am.id,
    decrypt_pii(am.medication_name_encrypted, am.tenant_id),
    decrypt_pii(am.dosage_encrypted, am.tenant_id),
    decrypt_pii(am.instructions_encrypted, am.tenant_id),
    t.scheduled_time
  FROM aide_medications am
  CROSS JOIN LATERAL unnest(am.scheduled_times) AS t(scheduled_time)
  WHERE am.aide_profile_id = p_aide_profile_id
    AND am.tenant_id = p_tenant_id
    AND am.is_active = true
    AND EXTRACT(DOW FROM now()) = ANY(am.days_of_week)
    AND t.scheduled_time BETWEEN
      (now()::time - make_interval(mins => p_window_minutes))::time
      AND (now()::time + make_interval(mins => p_window_minutes))::time;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMIT;
