/** Device types — represents smart home devices managed via Home Assistant */

import type { TenantId, UserId } from "./tenant.js";

export type DeviceId = string & { readonly __brand: "DeviceId" };

export type DeviceCategory =
  | "light"
  | "lock"
  | "thermostat"
  | "switch"
  | "sensor"
  | "camera"
  | "cover"
  | "media_player"
  | "climate"
  | "fan";

export type DeviceState = "on" | "off" | "locked" | "unlocked" | "unknown";

export interface Device {
  id: DeviceId;
  tenant_id: TenantId;
  ha_entity_id: string;
  name: string;
  category: DeviceCategory;
  room: string;
  floor: string;
  state: DeviceState;
  attributes: Record<string, unknown>;
  is_online: boolean;
  last_seen: string;
  created_at: string;
  updated_at: string;
}

export interface DeviceCommand {
  device_id: DeviceId;
  tenant_id: TenantId;
  issued_by: UserId;
  action: string;
  parameters: Record<string, unknown>;
  source: "voice" | "dashboard" | "mobile" | "automation" | "api";
  confidence?: number;
}

export interface DeviceStateChange {
  id: string;
  device_id: DeviceId;
  tenant_id: TenantId;
  previous_state: DeviceState;
  new_state: DeviceState;
  changed_by: UserId | "automation" | "system";
  source: DeviceCommand["source"];
  timestamp: string;
}

export interface Room {
  id: string;
  tenant_id: TenantId;
  name: string;
  floor: string;
  devices: DeviceId[];
}

export interface Scene {
  id: string;
  tenant_id: TenantId;
  name: string;
  description: string;
  actions: SceneAction[];
  trigger?: "manual" | "schedule" | "voice" | "geofence";
  created_by: UserId;
}

export interface SceneAction {
  device_id: DeviceId;
  action: string;
  parameters: Record<string, unknown>;
}
