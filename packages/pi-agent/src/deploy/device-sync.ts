/**
 * device-sync.ts — One-shot HA → Supabase device synchronization
 *
 * Fetches all entities from Home Assistant, maps them to Device records,
 * and upserts them into the Supabase `devices` table.
 *
 * Usage:
 *   npx tsx packages/pi-agent/src/deploy/device-sync.ts
 *   node packages/pi-agent/dist/deploy/device-sync.js
 *
 * Required env vars: HA_URL, HA_LONG_LIVED_TOKEN, SUPABASE_URL,
 *   SUPABASE_SERVICE_ROLE_KEY, TENANT_ID
 */

import { createClient } from "@supabase/supabase-js";
import type { Device, DeviceId, TenantId } from "@clever/shared";
import { HARestClient, DeviceDiscovery } from "@clever/ha-bridge";
import type { DeviceStore } from "@clever/ha-bridge";

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

const required = [
  "HA_URL",
  "HA_LONG_LIVED_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TENANT_ID",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const HA_URL = process.env.HA_URL!;
const HA_TOKEN = process.env.HA_LONG_LIVED_TOKEN!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TENANT_ID = process.env.TENANT_ID! as unknown as TenantId;

// ---------------------------------------------------------------------------
// Supabase device store implementation
// ---------------------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const store: DeviceStore = {
  async listDevices(tenantId: TenantId): Promise<Device[]> {
    const { data, error } = await supabase
      .from("devices")
      .select("*")
      .eq("tenant_id", tenantId as string);

    if (error) {
      console.error("Failed to list devices:", error.message);
      return [];
    }
    return (data ?? []) as unknown as Device[];
  },

  async upsertDevice(device: Device): Promise<void> {
    const record = {
      id: device.id,
      tenant_id: TENANT_ID as string,
      ha_entity_id: device.ha_entity_id,
      name: device.name,
      category: device.category,
      room: device.room ?? null,
      floor: device.floor ?? null,
      state: device.state,
      attributes: device.attributes ?? {},
      is_online: device.is_online,
      last_seen: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("devices")
      .upsert(record, { onConflict: "tenant_id,ha_entity_id" });

    if (error) {
      console.error(`Failed to upsert ${device.ha_entity_id}:`, error.message);
    }
  },

  async removeDevice(deviceId: DeviceId, tenantId: TenantId): Promise<void> {
    const { error } = await supabase
      .from("devices")
      .delete()
      .eq("id", deviceId as string)
      .eq("tenant_id", tenantId as string);

    if (error) {
      console.error(`Failed to remove device ${deviceId}:`, error.message);
    }
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("[DeviceSync] Starting HA → Supabase device sync...");
  console.log(`[DeviceSync] HA: ${HA_URL}`);
  console.log(`[DeviceSync] Supabase: ${SUPABASE_URL}`);
  console.log(`[DeviceSync] Tenant: ${TENANT_ID}`);

  const haClient = new HARestClient({
    baseUrl: HA_URL,
    token: HA_TOKEN,
    tenantId: TENANT_ID,
  });

  // Verify HA connection
  try {
    const config = await haClient.getConfig();
    console.log(`[DeviceSync] Connected to HA: ${config.location_name} (v${config.version})`);
  } catch (err) {
    console.error("[DeviceSync] Cannot connect to Home Assistant:", (err as Error).message);
    process.exit(1);
  }

  const discovery = new DeviceDiscovery({
    haClient,
    store,
    tenantId: TENANT_ID,
  });

  const result = await discovery.scan();

  console.log("[DeviceSync] Sync complete:");
  console.log(`  Total HA entities: ${result.totalEntities}`);
  console.log(`  Supported:         ${result.totalSupported}`);
  console.log(`  Added:             ${result.added.length}`);
  console.log(`  Updated:           ${result.updated.length}`);
  console.log(`  Removed:           ${result.removed.length}`);
  console.log(`  Unchanged:         ${result.unchanged}`);
  console.log(`  Duration:          ${result.durationMs}ms`);

  if (result.added.length > 0) {
    console.log("\n  New devices:");
    for (const d of result.added) {
      console.log(`    + ${d.ha_entity_id} → ${d.name} (${d.category}, ${d.room ?? "no room"})`);
    }
  }
}

main().catch((err) => {
  console.error("[DeviceSync] Fatal error:", err);
  process.exit(1);
});
