/**
 * Biometric / Elevated Auth Types
 *
 * Types for biometric (Face ID, fingerprint) and PIN-based elevated
 * authentication sessions used to gate access to sensitive data
 * (email content, nutrition health data).
 */

import type { TenantId, UserId } from "./tenant.js";

// ---------------------------------------------------------------------------
// Auth method & capability
// ---------------------------------------------------------------------------

export type ElevatedAuthMethod = "biometric" | "pin" | "device_passcode";

/** What the current device supports */
export type BiometricCapability =
  | "face_id"
  | "touch_id"
  | "fingerprint"
  | "iris"
  | "none";

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

export interface ElevatedAuthSession {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  auth_method: ElevatedAuthMethod;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
}

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

export interface ElevatedAuthVerifyRequest {
  /** The method used to authenticate */
  method: ElevatedAuthMethod;
  /**
   * For 'pin': the PIN digits.
   * For 'biometric' / 'device_passcode': not needed (verified client-side).
   */
  credential_data?: string;
  /** Optional custom session duration in minutes (default: 15) */
  duration_minutes?: number;
}

export interface ElevatedAuthVerifyResponse {
  /** The session token (store client-side, send with sensitive requests) */
  session_token: string;
  /** When the session expires */
  expires_at: string;
}

export interface ElevatedAuthCheckRequest {
  session_token: string;
}

export interface ElevatedAuthCheckResponse {
  valid: boolean;
  expires_at?: string;
}

// ---------------------------------------------------------------------------
// PIN management
// ---------------------------------------------------------------------------

export interface PinSetupRequest {
  pin: string; // 4-6 digits
}

export interface PinStatus {
  has_pin: boolean;
  is_locked: boolean;
  locked_until: string | null;
}
