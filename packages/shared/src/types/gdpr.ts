/**
 * GDPR Compliance Types
 *
 * Type definitions for consent management, data subject rights,
 * and privacy policy versioning per GDPR Articles 6-21.
 */

import type { TenantId, UserId } from "./tenant.js";

// ---------------------------------------------------------------------------
// Consent types
// ---------------------------------------------------------------------------

export type ConsentType =
  | "data_processing"
  | "voice_recording"
  | "health_data"
  | "child_data"
  | "marketing"
  | "analytics"
  | "third_party_sharing"
  | "behavioral_monitoring"
  | "email_data"
  | "calendar_data"
  | "nutrition_data";

export type LawfulBasis =
  | "consent"
  | "contract"
  | "legal_obligation"
  | "vital_interests"
  | "public_task"
  | "legitimate_interests";

export interface ConsentRecord {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  consent_type: ConsentType;
  lawful_basis: LawfulBasis;
  granted: boolean;
  policy_version: string;
  ip_address_hash: string | null;
  granted_at: string;
  withdrawn_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Data Subject Requests (DSAR)
// ---------------------------------------------------------------------------

export type DataSubjectRequestType =
  | "access"
  | "portability"
  | "erasure"
  | "rectification"
  | "restriction"
  | "objection";

export type DsarStatus = "pending" | "processing" | "completed" | "rejected";

export interface DataSubjectRequest {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  request_type: DataSubjectRequestType;
  status: DsarStatus;
  request_details: Record<string, unknown>;
  response_data: Record<string, unknown> | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Privacy Policy
// ---------------------------------------------------------------------------

export interface PrivacyPolicyVersion {
  id: string;
  version: string;
  content_hash: string;
  summary: string;
  effective_date: string;
  requires_reconsent: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Consent check helpers (for UI)
// ---------------------------------------------------------------------------

/** Consent types required at registration (cannot proceed without these). */
export const REQUIRED_CONSENTS: ConsentType[] = ["data_processing"];

/** Consent types that need explicit opt-in (not pre-checked). */
export const OPT_IN_CONSENTS: ConsentType[] = [
  "voice_recording",
  "marketing",
  "analytics",
  "third_party_sharing",
  "behavioral_monitoring",
  "email_data",
  "calendar_data",
];

/** Consent types requiring explicit consent under Art 9 (special categories). */
export const SPECIAL_CATEGORY_CONSENTS: ConsentType[] = [
  "health_data",
  "child_data",
];

/** Maps consent types to their default lawful basis. */
export const CONSENT_LAWFUL_BASIS: Record<ConsentType, LawfulBasis> = {
  data_processing: "contract",
  voice_recording: "consent",
  health_data: "consent",
  child_data: "consent",
  marketing: "consent",
  analytics: "consent",
  third_party_sharing: "consent",
  behavioral_monitoring: "legitimate_interests",
  email_data: "consent",
  calendar_data: "consent",
};
