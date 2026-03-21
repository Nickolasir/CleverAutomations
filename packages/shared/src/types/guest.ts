/** CleverHost guest lifecycle types — Airbnb/STR guest management */

import type { TenantId, UserId } from "./tenant.js";
import type { DeviceId } from "./device.js";

export type GuestProfileId = string & { readonly __brand: "GuestProfileId" };
export type ReservationId = string & { readonly __brand: "ReservationId" };

export interface Reservation {
  id: ReservationId;
  tenant_id: TenantId;
  property_id: string;
  guest_profile_id: GuestProfileId;
  platform: "airbnb" | "vrbo" | "direct" | "other";
  external_reservation_id?: string;
  check_in: string;
  check_out: string;
  guest_count: number;
  status: "upcoming" | "active" | "completed" | "cancelled";
  created_at: string;
  updated_at: string;
}

export interface GuestProfile {
  id: GuestProfileId;
  tenant_id: TenantId;
  reservation_id: ReservationId;
  display_name: string;
  wifi_password: string;
  door_code: string;
  voice_preferences: Record<string, unknown>;
  tv_logins: EncryptedCredential[];
  custom_preferences: Record<string, unknown>;
  created_at: string;
  expires_at: string;
}

export interface EncryptedCredential {
  service: string;
  encrypted_data: string;
}

/**
 * Guest profile wipe checklist — ALL items must complete between stays.
 * Security requirement: no personal data persists across reservations.
 */
export interface GuestWipeChecklist {
  reservation_id: ReservationId;
  tenant_id: TenantId;
  items: GuestWipeItem[];
  started_at: string;
  completed_at: string | null;
  is_complete: boolean;
}

export type GuestWipeCategory =
  | "locks"
  | "wifi"
  | "voice_history"
  | "tv_logins"
  | "preferences"
  | "personal_data";

export interface GuestWipeItem {
  category: GuestWipeCategory;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  completed_at: string | null;
  error?: string;
}

/** All wipe categories that must be cleared */
export const REQUIRED_WIPE_CATEGORIES: GuestWipeCategory[] = [
  "locks",
  "wifi",
  "voice_history",
  "tv_logins",
  "preferences",
  "personal_data",
];

export interface TurnoverTask {
  id: string;
  tenant_id: TenantId;
  reservation_id: ReservationId;
  type: "wipe" | "prepare" | "inspect";
  status: "pending" | "in_progress" | "completed" | "failed";
  assigned_devices: DeviceId[];
  created_at: string;
  completed_at: string | null;
}
