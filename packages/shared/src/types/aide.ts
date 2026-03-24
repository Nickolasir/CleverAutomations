/**
 * CleverAide Types
 *
 * Defines the type system for the assisted living features: care profiles,
 * medication management, wellness monitoring, activity tracking, caregiver
 * alerts, and structured daily routines.
 *
 * The AideProfile extends a FamilyMemberProfile (age_group = "assisted_living")
 * with care-specific data stored in the aide_profiles companion table.
 */

import type { TenantId, UserId } from "./tenant.js";

// ---------------------------------------------------------------------------
// Accessibility levels
// ---------------------------------------------------------------------------

export type MobilityLevel = "full" | "limited" | "wheelchair" | "bedridden";
export type CognitiveLevel = "independent" | "mild_assistance" | "moderate_assistance" | "full_assistance";
export type HearingLevel = "normal" | "mild_loss" | "moderate_loss" | "severe_loss";
export type VisionLevel = "normal" | "mild_loss" | "moderate_loss" | "legally_blind";

// ---------------------------------------------------------------------------
// Interaction preferences
// ---------------------------------------------------------------------------

export type PreferredInteraction = "voice_first" | "touch_first" | "mixed";
export type ConfirmationMode = "always" | "safety_only" | "never";
export type SpeakingPace = "slow" | "normal" | "fast";

// ---------------------------------------------------------------------------
// Emergency contact
// ---------------------------------------------------------------------------

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
  /** Lower number = higher priority (1 = first to contact) */
  priority: number;
}

// ---------------------------------------------------------------------------
// Medical info
// ---------------------------------------------------------------------------

export interface MedicalInfo {
  allergies?: string[];
  conditions?: string[];
  blood_type?: string;
  doctor_name?: string;
  doctor_phone?: string;
  insurance_provider?: string;
  insurance_id?: string;
  dnr_status?: boolean;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Aide profile (1:1 companion to FamilyMemberProfile)
// ---------------------------------------------------------------------------

export interface AideProfile {
  id: string;
  tenant_id: TenantId;
  profile_id: string;
  primary_caregiver_id: UserId | null;
  medical_info: MedicalInfo;
  emergency_contacts: EmergencyContact[];
  mobility_level: MobilityLevel;
  cognitive_level: CognitiveLevel;
  hearing_level: HearingLevel;
  vision_level: VisionLevel;
  preferred_interaction: PreferredInteraction;
  confirmation_mode: ConfirmationMode;
  speaking_pace: SpeakingPace;
  timezone: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Medications
// ---------------------------------------------------------------------------

export type MedicationFrequency =
  | "once_daily"
  | "twice_daily"
  | "three_times_daily"
  | "four_times_daily"
  | "every_8_hours"
  | "every_12_hours"
  | "as_needed"
  | "weekly";

export interface AideMedication {
  id: string;
  tenant_id: TenantId;
  aide_profile_id: string;
  medication_name: string;
  dosage: string;
  frequency: MedicationFrequency;
  /** Scheduled times as "HH:MM" strings */
  scheduled_times: string[];
  /** Days of week: 0=Sun, 6=Sat */
  days_of_week: number[];
  instructions: string | null;
  refill_date: string | null;
  prescribing_doctor: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Medication logs
// ---------------------------------------------------------------------------

export type MedicationLogStatus = "taken" | "skipped" | "missed" | "pending" | "reminded";
export type MedicationConfirmationMethod = "voice" | "app" | "caregiver" | "auto_timeout";

export interface AideMedicationLog {
  id: string;
  tenant_id: TenantId;
  medication_id: string;
  aide_profile_id: string;
  scheduled_at: string;
  status: MedicationLogStatus;
  confirmed_via: MedicationConfirmationMethod | null;
  confirmed_at: string | null;
  notes: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Wellness check-ins
// ---------------------------------------------------------------------------

export type CheckinType = "morning" | "afternoon" | "evening" | "custom" | "caregiver_requested";
export type CheckinStatus = "completed" | "no_response" | "concern_flagged" | "emergency";

export interface AideWellnessCheckin {
  id: string;
  tenant_id: TenantId;
  aide_profile_id: string;
  checkin_type: CheckinType;
  status: CheckinStatus;
  /** Self-reported mood: 1 (very bad) to 5 (great) */
  mood_rating: number | null;
  /** Self-reported pain: 0 (none) to 10 (worst) */
  pain_level: number | null;
  notes: string | null;
  response_transcript: string | null;
  flagged_for_review: boolean;
  reviewed_by: UserId | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export type AideActivityEventType =
  | "motion_detected"
  | "no_motion_alert"
  | "fall_detected"
  | "door_opened"
  | "door_closed"
  | "appliance_used"
  | "voice_interaction"
  | "button_press";

export interface AideActivityEvent {
  id: string;
  tenant_id: TenantId;
  aide_profile_id: string;
  event_type: AideActivityEventType;
  room: string | null;
  sensor_entity_id: string | null;
  details: Record<string, unknown>;
  alert_sent: boolean;
  alert_sent_to: string[];
  created_at: string;
}

// ---------------------------------------------------------------------------
// Caregiver alerts
// ---------------------------------------------------------------------------

export type CaregiverAlertType =
  | "medication_missed"
  | "no_response_checkin"
  | "fall_detected"
  | "inactivity"
  | "emergency"
  | "routine_deviation"
  | "low_battery_medical_device"
  | "wellness_concern"
  | "manual";

export type AlertSeverity = "info" | "warning" | "urgent" | "critical";

export type AlertDeliveryChannel = "push" | "sms" | "telegram" | "whatsapp" | "email";

export interface AideCaregiverAlert {
  id: string;
  tenant_id: TenantId;
  aide_profile_id: string;
  alert_type: CaregiverAlertType;
  severity: AlertSeverity;
  message: string;
  details: Record<string, unknown>;
  delivery_channels: AlertDeliveryChannel[];
  delivered_via: Record<string, unknown>;
  acknowledged: boolean;
  acknowledged_by: UserId | null;
  acknowledged_at: string | null;
  escalated: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

export interface AideRoutineStep {
  type: "announcement" | "device_action" | "medication" | "checkin" | "wait";
  description: string;
  device_action?: {
    domain: string;
    action: string;
    target_device: string;
    parameters: Record<string, unknown>;
  };
  confirmation_required?: boolean;
  timeout_seconds?: number;
}

export interface AideRoutine {
  id: string;
  tenant_id: TenantId;
  aide_profile_id: string;
  routine_name: string;
  /** Scheduled time as "HH:MM" */
  scheduled_time: string;
  /** Days of week: 0=Sun, 6=Sat */
  days_of_week: number[];
  steps: AideRoutineStep[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Escalation configuration
// ---------------------------------------------------------------------------

/** Timeout in minutes before an unacknowledged alert escalates */
export const ALERT_ESCALATION_TIMEOUTS: Record<AlertSeverity, number> = {
  info: 0,       // info alerts do not escalate
  warning: 30,
  urgent: 10,
  critical: 5,
};

/** Default medication confirmation timeout in minutes */
export const MEDICATION_CONFIRMATION_TIMEOUT_MINUTES = 15;

/** Default inactivity threshold in minutes during waking hours */
export const INACTIVITY_THRESHOLD_MINUTES = 120;
