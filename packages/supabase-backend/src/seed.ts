/**
 * Clever Automations - Development Seed Data
 *
 * Seeds a local Supabase instance with the minimum data needed for the app:
 *   - 1 tenant (CleverHost demo)
 *   - 2 users (owner + resident)
 *   - 2 rooms (Living Room, Master Bedroom)
 *
 * Devices are added through the app by pairing real hardware (no dummy devices).
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
  // Devices are added through the app by pairing real hardware — no seed IDs needed
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

// No dummy devices, scenes, or audit logs — devices are added through the app
// by pairing real hardware.

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

    console.log("");
    console.log("===========================================");
    console.log("Seed complete! Summary:");
    console.log("  1 tenant (CleverHost Demo Property)");
    console.log("  2 users (owner + resident)");
    console.log("  2 rooms (Living Room, Master Bedroom)");
    console.log("  Devices: add through the app by pairing real hardware");
    console.log("===========================================");
  } catch (error) {
    console.error("");
    console.error("Seed FAILED:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
