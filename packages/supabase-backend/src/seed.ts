/**
 * Clever Automations - Development Seed Data
 *
 * Seeds a local Supabase instance with sample data for development:
 *   - 1 tenant (CleverHost demo)
 *   - 2 users (owner + resident)
 *   - 2 rooms (Living Room, Master Bedroom)
 *   - 5 devices (lights, lock, thermostat, media player)
 *   - 2 scenes (Movie Night, Good Morning)
 *
 * Usage: npx tsx src/seed.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./index.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env["SUPABASE_URL"];
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required.");
  console.error("Set them in your .env file or export them in your shell.");
  process.exit(1);
}

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ---------------------------------------------------------------------------
// Deterministic UUIDs for reproducible seeds
// ---------------------------------------------------------------------------

const SEED_IDS = {
  tenant:      "a0000000-0000-4000-8000-000000000001",
  ownerUser:   "b0000000-0000-4000-8000-000000000001",
  residentUser:"b0000000-0000-4000-8000-000000000002",
  rooms: {
    livingRoom:    "c0000000-0000-4000-8000-000000000001",
    masterBedroom: "c0000000-0000-4000-8000-000000000002",
  },
  devices: {
    livingRoomLight:   "d0000000-0000-4000-8000-000000000001",
    bedroomLight:      "d0000000-0000-4000-8000-000000000002",
    frontDoorLock:     "d0000000-0000-4000-8000-000000000003",
    thermostat:        "d0000000-0000-4000-8000-000000000004",
    livingRoomTV:      "d0000000-0000-4000-8000-000000000005",
  },
  scenes: {
    movieNight:   "e0000000-0000-4000-8000-000000000001",
    goodMorning:  "e0000000-0000-4000-8000-000000000002",
  },
} as const;

// ---------------------------------------------------------------------------
// Seed Functions
// ---------------------------------------------------------------------------

async function seedTenant(): Promise<void> {
  console.log("Seeding tenant...");

  const { error } = await supabase.from("tenants").upsert(
    {
      id: SEED_IDS.tenant,
      name: "CleverHost Demo Property",
      vertical: "clever_host",
      subscription_tier: "professional",
      settings: {
        voice_enabled: true,
        max_devices: 50,
        max_users: 10,
        guest_wipe_enabled: true,
        audit_retention_days: 90,
      },
    },
    { onConflict: "id" }
  );

  if (error) throw new Error(`Failed to seed tenant: ${error.message}`);
  console.log("  Tenant created: CleverHost Demo Property");
}

async function seedUsers(): Promise<void> {
  console.log("Seeding users...");

  const users = [
    {
      id: SEED_IDS.ownerUser,
      tenant_id: SEED_IDS.tenant,
      email: "owner@cleverhost-demo.com",
      role: "owner" as const,
      display_name: "Alex Owner",
    },
    {
      id: SEED_IDS.residentUser,
      tenant_id: SEED_IDS.tenant,
      email: "resident@cleverhost-demo.com",
      role: "resident" as const,
      display_name: "Jordan Resident",
    },
  ];

  for (const user of users) {
    const { error } = await supabase.from("users").upsert(user, { onConflict: "id" });
    if (error) throw new Error(`Failed to seed user ${user.email}: ${error.message}`);
    console.log(`  User created: ${user.display_name} (${user.role})`);
  }
}

async function seedRooms(): Promise<void> {
  console.log("Seeding rooms...");

  const rooms = [
    {
      id: SEED_IDS.rooms.livingRoom,
      tenant_id: SEED_IDS.tenant,
      name: "Living Room",
      floor: "1",
    },
    {
      id: SEED_IDS.rooms.masterBedroom,
      tenant_id: SEED_IDS.tenant,
      name: "Master Bedroom",
      floor: "2",
    },
  ];

  for (const room of rooms) {
    const { error } = await supabase.from("rooms").upsert(room, { onConflict: "id" });
    if (error) throw new Error(`Failed to seed room ${room.name}: ${error.message}`);
    console.log(`  Room created: ${room.name} (Floor ${room.floor})`);
  }
}

async function seedDevices(): Promise<void> {
  console.log("Seeding devices...");

  const devices = [
    {
      id: SEED_IDS.devices.livingRoomLight,
      tenant_id: SEED_IDS.tenant,
      ha_entity_id: "light.living_room_main",
      name: "Living Room Main Light",
      category: "light" as const,
      room: "Living Room",
      floor: "1",
      state: "off" as const,
      attributes: {
        brightness: 0,
        color_temp: 4000,
        supported_features: ["brightness", "color_temp"],
      },
      is_online: true,
      last_seen: new Date().toISOString(),
    },
    {
      id: SEED_IDS.devices.bedroomLight,
      tenant_id: SEED_IDS.tenant,
      ha_entity_id: "light.master_bedroom",
      name: "Master Bedroom Light",
      category: "light" as const,
      room: "Master Bedroom",
      floor: "2",
      state: "off" as const,
      attributes: {
        brightness: 0,
        color_temp: 3000,
        supported_features: ["brightness", "color_temp", "rgb"],
      },
      is_online: true,
      last_seen: new Date().toISOString(),
    },
    {
      id: SEED_IDS.devices.frontDoorLock,
      tenant_id: SEED_IDS.tenant,
      ha_entity_id: "lock.front_door",
      name: "Front Door Lock",
      category: "lock" as const,
      room: "Living Room",
      floor: "1",
      state: "locked" as const,
      attributes: {
        lock_type: "smart_deadbolt",
        battery_level: 87,
        supports_codes: true,
      },
      is_online: true,
      last_seen: new Date().toISOString(),
    },
    {
      id: SEED_IDS.devices.thermostat,
      tenant_id: SEED_IDS.tenant,
      ha_entity_id: "climate.main_thermostat",
      name: "Main Thermostat",
      category: "thermostat" as const,
      room: "Living Room",
      floor: "1",
      state: "on" as const,
      attributes: {
        current_temperature: 72,
        target_temperature: 72,
        hvac_mode: "cool",
        humidity: 45,
        unit: "F",
      },
      is_online: true,
      last_seen: new Date().toISOString(),
    },
    {
      id: SEED_IDS.devices.livingRoomTV,
      tenant_id: SEED_IDS.tenant,
      ha_entity_id: "media_player.living_room_tv",
      name: "Living Room TV",
      category: "media_player" as const,
      room: "Living Room",
      floor: "1",
      state: "off" as const,
      attributes: {
        source: "HDMI 1",
        volume_level: 0.3,
        supported_features: ["volume", "source", "play", "pause"],
      },
      is_online: true,
      last_seen: new Date().toISOString(),
    },
  ];

  for (const device of devices) {
    const { error } = await supabase.from("devices").upsert(device, { onConflict: "id" });
    if (error) throw new Error(`Failed to seed device ${device.name}: ${error.message}`);
    console.log(`  Device created: ${device.name} (${device.category}) in ${device.room}`);
  }
}

async function seedScenes(): Promise<void> {
  console.log("Seeding scenes...");

  const scenes = [
    {
      id: SEED_IDS.scenes.movieNight,
      tenant_id: SEED_IDS.tenant,
      name: "Movie Night",
      description: "Dims living room lights, turns on TV, sets comfortable temperature",
      actions: [
        {
          device_id: SEED_IDS.devices.livingRoomLight,
          action: "turn_on",
          parameters: { brightness: 20, color_temp: 2700 },
        },
        {
          device_id: SEED_IDS.devices.livingRoomTV,
          action: "turn_on",
          parameters: { source: "HDMI 1" },
        },
        {
          device_id: SEED_IDS.devices.thermostat,
          action: "set_temperature",
          parameters: { temperature: 70, unit: "F" },
        },
      ],
      trigger: "voice" as const,
      created_by: SEED_IDS.ownerUser,
    },
    {
      id: SEED_IDS.scenes.goodMorning,
      tenant_id: SEED_IDS.tenant,
      name: "Good Morning",
      description: "Brightens bedroom light, unlocks front door, sets daytime temperature",
      actions: [
        {
          device_id: SEED_IDS.devices.bedroomLight,
          action: "turn_on",
          parameters: { brightness: 80, color_temp: 5000 },
        },
        {
          device_id: SEED_IDS.devices.frontDoorLock,
          action: "unlock",
          parameters: {},
        },
        {
          device_id: SEED_IDS.devices.thermostat,
          action: "set_temperature",
          parameters: { temperature: 72, unit: "F" },
        },
      ],
      trigger: "schedule" as const,
      created_by: SEED_IDS.ownerUser,
    },
  ];

  for (const scene of scenes) {
    const { error } = await supabase.from("scenes").upsert(scene, { onConflict: "id" });
    if (error) throw new Error(`Failed to seed scene ${scene.name}: ${error.message}`);
    console.log(`  Scene created: ${scene.name} (trigger: ${scene.trigger})`);
  }
}

async function seedAuditLogs(): Promise<void> {
  console.log("Seeding sample audit logs...");

  const logs = [
    {
      tenant_id: SEED_IDS.tenant,
      user_id: SEED_IDS.ownerUser,
      action: "user_created" as const,
      details: {
        email: "owner@cleverhost-demo.com",
        role: "owner",
        display_name: "Alex Owner",
      },
    },
    {
      tenant_id: SEED_IDS.tenant,
      user_id: SEED_IDS.ownerUser,
      device_id: SEED_IDS.devices.livingRoomLight,
      action: "device_registered" as const,
      details: {
        ha_entity_id: "light.living_room_main",
        name: "Living Room Main Light",
        category: "light",
      },
    },
    {
      tenant_id: SEED_IDS.tenant,
      user_id: SEED_IDS.residentUser,
      device_id: SEED_IDS.devices.livingRoomLight,
      action: "device_command_issued" as const,
      details: {
        action: "turn_on",
        source: "voice",
        confidence: 0.95,
        parameters: { brightness: 100 },
      },
    },
  ];

  const { error } = await supabase.from("audit_logs").insert(logs);
  if (error) throw new Error(`Failed to seed audit logs: ${error.message}`);
  console.log(`  ${logs.length} audit log entries created`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("===========================================");
  console.log("Clever Automations - Seeding Development DB");
  console.log("===========================================");
  console.log(`Target: ${SUPABASE_URL}`);
  console.log("");

  try {
    await seedTenant();
    await seedUsers();
    await seedRooms();
    await seedDevices();
    await seedScenes();
    await seedAuditLogs();

    console.log("");
    console.log("===========================================");
    console.log("Seed complete! Summary:");
    console.log("  1 tenant (CleverHost Demo Property)");
    console.log("  2 users (owner + resident)");
    console.log("  2 rooms (Living Room, Master Bedroom)");
    console.log("  5 devices (2 lights, 1 lock, 1 thermostat, 1 TV)");
    console.log("  2 scenes (Movie Night, Good Morning)");
    console.log("  3 audit log entries");
    console.log("===========================================");
  } catch (error) {
    console.error("");
    console.error("Seed FAILED:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
