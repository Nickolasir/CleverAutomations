/** Audit logging types — every device state change is logged */

import type { TenantId, UserId } from "./tenant.js";
import type { DeviceId, DeviceCommand } from "./device.js";
import type { VoiceSessionId } from "./voice.js";

export type AuditLogId = string & { readonly __brand: "AuditLogId" };

export type AuditAction =
  | "device_state_change"
  | "device_command_issued"
  | "user_login"
  | "user_logout"
  | "guest_profile_created"
  | "guest_profile_wiped"
  | "scene_activated"
  | "automation_triggered"
  | "voice_command_processed"
  | "settings_changed"
  | "user_created"
  | "user_deleted"
  | "device_registered"
  | "device_removed"
  | "pantry_item_added"
  | "pantry_item_removed"
  | "pantry_item_updated"
  | "shopping_list_item_added"
  | "shopping_list_item_removed"
  | "shopping_list_item_checked"
  | "receipt_scanned"
  | "pantry_photo_analyzed";

export interface AuditLog {
  id: AuditLogId;
  tenant_id: TenantId;
  user_id: UserId | null;
  device_id: DeviceId | null;
  voice_session_id: VoiceSessionId | null;
  action: AuditAction;
  details: Record<string, unknown>;
  ip_address: string | null;
  timestamp: string;
}

export interface AuditQuery {
  tenant_id: TenantId;
  action?: AuditAction;
  user_id?: UserId;
  device_id?: DeviceId;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** Telemetry data stored in TimescaleDB hypertable */
export interface SensorTelemetry {
  time: string;
  tenant_id: TenantId;
  device_id: DeviceId;
  metric: string;
  value: number;
  unit: string;
}
