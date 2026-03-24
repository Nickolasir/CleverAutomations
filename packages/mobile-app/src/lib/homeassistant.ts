/**
 * Home Assistant API client for mobile app.
 * Handles integration config flows (add devices) and entity state queries.
 */

const HA_URL = process.env.EXPO_PUBLIC_HA_URL ?? "";
const HA_TOKEN = process.env.EXPO_PUBLIC_HA_TOKEN ?? "";

if (!HA_URL || !HA_TOKEN) {
  console.warn(
    "Missing EXPO_PUBLIC_HA_URL or EXPO_PUBLIC_HA_TOKEN. " +
      "Home Assistant integration will not function."
  );
}

async function haFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${HA_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${HA_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HA API ${res.status}: ${text}`);
  }
  return res.json();
}

/** Supported integration types for the Add Device flow */
export const SUPPORTED_INTEGRATIONS = [
  {
    id: "samsungtv",
    name: "Samsung Smart TV",
    icon: "TV",
    category: "media_player" as const,
    description: "Control your Samsung TV — power, volume, source, media playback",
  },
  {
    id: "ecobee",
    name: "Ecobee Thermostat",
    icon: "T",
    category: "climate" as const,
    description: "Temperature, humidity, occupancy, and full thermostat control",
  },
  {
    id: "cast",
    name: "Google Home / Chromecast",
    icon: "GH",
    category: "media_player" as const,
    description: "Discover Nest Hub, Chromecast, and Google Home speakers on your network",
  },
  {
    id: "homekit_controller",
    name: "Apple HomeKit",
    icon: "HK",
    category: "switch" as const,
    description: "Discover and control HomeKit accessories on your network",
  },
] as const;

export type SupportedIntegration = (typeof SUPPORTED_INTEGRATIONS)[number];

/** Config flow step returned by HA */
export interface ConfigFlowStep {
  type: "form" | "create_entry" | "abort" | "external" | "progress" | "menu" | "show_progress_done";
  flow_id: string;
  handler: string;
  step_id: string;
  data_schema?: Array<{
    type: string;
    name: string;
    required?: boolean;
    default?: unknown;
  }>;
  errors?: Record<string, string> | null;
  description_placeholders?: Record<string, string> | null;
  reason?: string;
  title?: string;
  result?: {
    entry_id: string;
    title: string;
  };
}

/** Start a config flow for an integration */
export async function startConfigFlow(handler: string): Promise<ConfigFlowStep> {
  return haFetch("/api/config/config_entries/flow", {
    method: "POST",
    body: JSON.stringify({ handler, show_advanced_options: false }),
  });
}

/** Submit data for a config flow step */
export async function submitConfigFlowStep(
  flowId: string,
  data: Record<string, unknown>
): Promise<ConfigFlowStep> {
  return haFetch(`/api/config/config_entries/flow/${flowId}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** Delete/abort a config flow */
export async function deleteConfigFlow(flowId: string): Promise<void> {
  await fetch(`${HA_URL}/api/config/config_entries/flow/${flowId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${HA_TOKEN}` },
  });
}

/** Get all HA entity states */
export async function getStates(): Promise<
  Array<{
    entity_id: string;
    state: string;
    attributes: Record<string, unknown>;
    last_changed: string;
  }>
> {
  return haFetch("/api/states");
}

/** Get entities belonging to a specific config entry */
export async function getEntityRegistry(): Promise<
  Array<{
    entity_id: string;
    name: string | null;
    platform: string;
    config_entry_id: string | null;
    area_id: string | null;
    device_id: string | null;
    original_name: string | null;
  }>
> {
  return haFetch("/api/config/entity_registry/list", { method: "GET" });
}

/** Get config entries (installed integrations) */
export async function getConfigEntries(): Promise<
  Array<{
    entry_id: string;
    domain: string;
    title: string;
    state: string;
  }>
> {
  return haFetch("/api/config/config_entries/entry");
}

/** Map HA entity domain to our DeviceCategory */
export function entityDomainToCategory(
  entityId: string
): "light" | "lock" | "thermostat" | "switch" | "sensor" | "camera" | "cover" | "media_player" | "climate" | "fan" | null {
  const domain = entityId.split(".")[0] ?? "";
  const map: Record<string, string> = {
    light: "light",
    lock: "lock",
    climate: "climate",
    switch: "switch",
    sensor: "sensor",
    camera: "camera",
    cover: "cover",
    media_player: "media_player",
    fan: "fan",
  };
  return (map[domain] as any) ?? null;
}

/** Call an HA service directly */
export async function callService(
  domain: string,
  service: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  await haFetch(`/api/services/${domain}/${service}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** Map HA state string to our DeviceState */
export function haStateToDeviceState(
  entityId: string,
  haState: string
): "on" | "off" | "locked" | "unlocked" | "unknown" {
  const domain = entityId.split(".")[0] ?? "";
  if (domain === "lock") {
    return haState === "locked" ? "locked" : haState === "unlocked" ? "unlocked" : "unknown";
  }
  if (haState === "on" || haState === "playing") return "on";
  if (haState === "off" || haState === "standby" || haState === "idle" || haState === "paused") return "off";
  return "unknown";
}
