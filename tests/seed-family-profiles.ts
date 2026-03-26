/**
 * Family Profile Seed Extension
 *
 * Seeds the family_member_profiles, family_permission_overrides,
 * family_schedules, and family_spending_limits tables with 6 family
 * members demonstrating the full age-group permission system.
 *
 * Depends on the base seed (packages/supabase-backend/src/seed.ts) having
 * already created the tenant, users, rooms, and devices.
 *
 * Run: npx tsx tests/seed-family-profiles.ts
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env["SUPABASE_URL"];
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  console.error("Set them in your .env file or export them in your shell.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ---------------------------------------------------------------------------
// Reference IDs from the base seed (packages/supabase-backend/src/seed.ts)
// ---------------------------------------------------------------------------

const SEED_IDS = {
  tenant:       "a0000000-0000-4000-8000-000000000001",
  ownerUser:    "b0000000-0000-4000-8000-000000000001",
  residentUser: "b0000000-0000-4000-8000-000000000002",
  devices: {
    livingRoomLight: "d0000000-0000-4000-8000-000000000001",
    bedroomLight:    "d0000000-0000-4000-8000-000000000002",
    frontDoorLock:   "d0000000-0000-4000-8000-000000000003",
    thermostat:      "d0000000-0000-4000-8000-000000000004",
    livingRoomTV:    "d0000000-0000-4000-8000-000000000005",
  },
} as const;

// Deterministic UUIDs for family profiles
const FAMILY_IDS = {
  // Users (we create additional users for family members beyond owner/resident)
  users: {
    jarvis:  "b0000000-0000-4000-8000-000000000010",
    luna:    "b0000000-0000-4000-8000-000000000011",
    atlas:   "b0000000-0000-4000-8000-000000000012",
    buddy:   "b0000000-0000-4000-8000-000000000013",
    sunny:   "b0000000-0000-4000-8000-000000000014",
    guest:   "b0000000-0000-4000-8000-000000000015",
  },
  // Profile IDs
  profiles: {
    jarvis:  "f0000000-0000-4000-8000-000000000001",
    luna:    "f0000000-0000-4000-8000-000000000002",
    atlas:   "f0000000-0000-4000-8000-000000000003",
    buddy:   "f0000000-0000-4000-8000-000000000004",
    sunny:   "f0000000-0000-4000-8000-000000000005",
    guest:   "f0000000-0000-4000-8000-000000000006",
  },
} as const;

// ---------------------------------------------------------------------------
// 1. Seed family users
// ---------------------------------------------------------------------------

async function seedFamilyUsers(): Promise<void> {
  console.log("Seeding family users...");

  const users = [
    {
      id: FAMILY_IDS.users.jarvis,
      tenant_id: SEED_IDS.tenant,
      email: "jarvis@cleverhost-demo.com",
      role: "owner" as const,
      display_name: "Jarvis (Dad)",
    },
    {
      id: FAMILY_IDS.users.luna,
      tenant_id: SEED_IDS.tenant,
      email: "luna@cleverhost-demo.com",
      role: "resident" as const,
      display_name: "Luna (Teenager)",
    },
    {
      id: FAMILY_IDS.users.atlas,
      tenant_id: SEED_IDS.tenant,
      email: "atlas@cleverhost-demo.com",
      role: "resident" as const,
      display_name: "Atlas (Tween)",
    },
    {
      id: FAMILY_IDS.users.buddy,
      tenant_id: SEED_IDS.tenant,
      email: "buddy@cleverhost-demo.com",
      role: "guest" as const,
      display_name: "Buddy (Child)",
    },
    {
      id: FAMILY_IDS.users.sunny,
      tenant_id: SEED_IDS.tenant,
      email: "sunny@cleverhost-demo.com",
      role: "guest" as const,
      display_name: "Sunny (Toddler)",
    },
    {
      id: FAMILY_IDS.users.guest,
      tenant_id: SEED_IDS.tenant,
      email: "guest@cleverhost-demo.com",
      role: "guest" as const,
      display_name: "Guest Visitor",
    },
  ];

  for (const user of users) {
    const { error } = await supabase.from("users").upsert(user, { onConflict: "id" });
    if (error) throw new Error(`Failed to seed user ${user.display_name}: ${error.message}`);
    console.log(`  User: ${user.display_name} (${user.role})`);
  }
}

// ---------------------------------------------------------------------------
// 2. Seed family member profiles
// ---------------------------------------------------------------------------

async function seedFamilyProfiles(): Promise<void> {
  console.log("Seeding family member profiles...");

  const now = new Date().toISOString();
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const profiles = [
    // 1. Jarvis (adult, owner) — full personality, no restrictions
    {
      id: FAMILY_IDS.profiles.jarvis,
      tenant_id: SEED_IDS.tenant,
      user_id: FAMILY_IDS.users.jarvis,
      age_group: "adult",
      agent_name: "Jarvis",
      agent_voice_id: "jarvis-deep",
      agent_personality: {
        tone: "formal",
        vocabulary_level: "adult",
        humor_level: 0.3,
        encouragement_level: 0.2,
        safety_warnings: false,
        max_response_words: 250,
        forbidden_topics: [],
        custom_greeting: "Good evening, sir.",
        sound_effects: false,
      },
      managed_by: null,
      is_active: true,
      expires_at: null,
    },
    // 2. Luna (teenager) — teen vocabulary, moderate humor
    {
      id: FAMILY_IDS.profiles.luna,
      tenant_id: SEED_IDS.tenant,
      user_id: FAMILY_IDS.users.luna,
      age_group: "teenager",
      agent_name: "Luna",
      agent_voice_id: "luna-friendly",
      agent_personality: {
        tone: "friendly",
        vocabulary_level: "teen",
        humor_level: 0.5,
        encouragement_level: 0.3,
        safety_warnings: false,
        max_response_words: 200,
        forbidden_topics: [],
        custom_greeting: "Hey Luna! What's up?",
        sound_effects: false,
      },
      managed_by: FAMILY_IDS.users.jarvis,
      is_active: true,
      expires_at: null,
    },
    // 3. Atlas (tween) — casual vocabulary, moderate restrictions
    {
      id: FAMILY_IDS.profiles.atlas,
      tenant_id: SEED_IDS.tenant,
      user_id: FAMILY_IDS.users.atlas,
      age_group: "tween",
      agent_name: "Atlas",
      agent_voice_id: "atlas-cool",
      agent_personality: {
        tone: "friendly",
        vocabulary_level: "child",
        humor_level: 0.4,
        encouragement_level: 0.4,
        safety_warnings: false,
        max_response_words: 150,
        forbidden_topics: ["violence"],
        custom_greeting: "Hey Atlas! Ready to explore?",
        sound_effects: false,
      },
      managed_by: FAMILY_IDS.users.jarvis,
      is_active: true,
      expires_at: null,
    },
    // 4. Buddy (child) — simple vocabulary, safety-focused
    {
      id: FAMILY_IDS.profiles.buddy,
      tenant_id: SEED_IDS.tenant,
      user_id: FAMILY_IDS.users.buddy,
      age_group: "child",
      agent_name: "Buddy",
      agent_voice_id: "buddy-cheerful",
      agent_personality: {
        tone: "playful",
        vocabulary_level: "child",
        humor_level: 0.7,
        encouragement_level: 0.8,
        safety_warnings: true,
        max_response_words: 100,
        forbidden_topics: [],
        custom_greeting: "Hi Buddy! What should we do today?",
        sound_effects: true,
      },
      managed_by: FAMILY_IDS.users.jarvis,
      is_active: true,
      expires_at: null,
    },
    // 5. Sunny (toddler) — toddler vocabulary, zero device control
    {
      id: FAMILY_IDS.profiles.sunny,
      tenant_id: SEED_IDS.tenant,
      user_id: FAMILY_IDS.users.sunny,
      age_group: "toddler",
      agent_name: "Sunny",
      agent_voice_id: "sunny-gentle",
      agent_personality: {
        tone: "nurturing",
        vocabulary_level: "toddler",
        humor_level: 0.9,
        encouragement_level: 1.0,
        safety_warnings: true,
        max_response_words: 50,
        forbidden_topics: [],
        custom_greeting: "Hi friend!",
        sound_effects: true,
      },
      managed_by: FAMILY_IDS.users.jarvis,
      is_active: true,
      expires_at: null,
    },
    // 6. Guest (adult_visitor) — time-limited, scoped to allowed devices
    {
      id: FAMILY_IDS.profiles.guest,
      tenant_id: SEED_IDS.tenant,
      user_id: FAMILY_IDS.users.guest,
      age_group: "adult_visitor",
      agent_name: "Guest",
      agent_voice_id: null,
      agent_personality: {
        tone: "friendly",
        vocabulary_level: "adult",
        humor_level: 0.2,
        encouragement_level: 0.1,
        safety_warnings: false,
        max_response_words: 200,
        forbidden_topics: [],
        custom_greeting: "Welcome! How can I help?",
        sound_effects: false,
      },
      managed_by: FAMILY_IDS.users.jarvis,
      is_active: true,
      expires_at: sevenDaysFromNow,
    },
  ];

  for (const profile of profiles) {
    const { error } = await supabase
      .from("family_member_profiles")
      .upsert(profile, { onConflict: "id" });
    if (error) {
      throw new Error(`Failed to seed profile ${profile.agent_name}: ${error.message}`);
    }
    console.log(
      `  Profile: ${profile.agent_name} (${profile.age_group})` +
      (profile.expires_at ? ` [expires ${profile.expires_at}]` : "")
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Seed permission overrides
// ---------------------------------------------------------------------------

async function seedPermissionOverrides(): Promise<void> {
  console.log("Seeding permission overrides...");

  const overrides = [
    // Luna (teenager): deny lock.front_door
    {
      tenant_id: SEED_IDS.tenant,
      profile_id: FAMILY_IDS.profiles.luna,
      device_id: SEED_IDS.devices.frontDoorLock,
      device_category: null,
      room: null,
      action: "control" as const,
      allowed: false,
      constraints: {},
    },
    // Luna (teenager): deny camera.front_porch (device_category-level deny)
    {
      tenant_id: SEED_IDS.tenant,
      profile_id: FAMILY_IDS.profiles.luna,
      device_id: null,
      device_category: "camera" as const,
      room: null,
      action: "control" as const,
      allowed: false,
      constraints: {},
    },

    // Atlas (tween): allow lights in master_bedroom
    {
      tenant_id: SEED_IDS.tenant,
      profile_id: FAMILY_IDS.profiles.atlas,
      device_id: null,
      device_category: "light" as const,
      room: "Master Bedroom",
      action: "control" as const,
      allowed: true,
      constraints: {},
    },
    // Atlas (tween): deny all in garage
    {
      tenant_id: SEED_IDS.tenant,
      profile_id: FAMILY_IDS.profiles.atlas,
      device_id: null,
      device_category: null,
      room: "Garage",
      action: "control" as const,
      allowed: false,
      constraints: {},
    },

    // Buddy (child): allow light.bedroom_lamp only, with brightness_max 80
    {
      tenant_id: SEED_IDS.tenant,
      profile_id: FAMILY_IDS.profiles.buddy,
      device_id: SEED_IDS.devices.bedroomLight,
      device_category: null,
      room: null,
      action: "control" as const,
      allowed: true,
      constraints: { brightness_max: 80 },
    },

    // Guest: allow light.living_room_main
    {
      tenant_id: SEED_IDS.tenant,
      profile_id: FAMILY_IDS.profiles.guest,
      device_id: SEED_IDS.devices.livingRoomLight,
      device_category: null,
      room: null,
      action: "control" as const,
      allowed: true,
      constraints: {},
    },
    // Guest: allow climate.main_thermostat with temp constraints
    {
      tenant_id: SEED_IDS.tenant,
      profile_id: FAMILY_IDS.profiles.guest,
      device_id: SEED_IDS.devices.thermostat,
      device_category: null,
      room: null,
      action: "control" as const,
      allowed: true,
      constraints: { thermostat_min: 68, thermostat_max: 76 },
    },
  ];

  for (const override of overrides) {
    const { error } = await supabase
      .from("family_permission_overrides")
      .insert(override);
    if (error) {
      const scope = override.device_id
        ? `device ${override.device_id}`
        : override.device_category
          ? `category ${override.device_category}`
          : `room ${override.room}`;
      throw new Error(`Failed to seed override (${scope}): ${error.message}`);
    }
  }

  console.log("  Luna:  deny lock.front_door, deny camera category");
  console.log("  Atlas: allow lights in Master Bedroom, deny all in Garage");
  console.log("  Buddy: allow bedroom light (brightness_max: 80)");
  console.log("  Guest: allow living room light, allow thermostat (68-76F)");
}

// ---------------------------------------------------------------------------
// 4. Seed schedules
// ---------------------------------------------------------------------------

async function seedSchedules(): Promise<void> {
  console.log("Seeding schedules...");

  const schedules = [
    // Buddy: bedtime (8:30 PM - 6:30 AM, every day)
    {
      tenant_id: SEED_IDS.tenant,
      profile_id: FAMILY_IDS.profiles.buddy,
      schedule_name: "Bedtime",
      days_of_week: [0, 1, 2, 3, 4, 5, 6], // Sun-Sat
      start_time: "20:30",
      end_time: "06:30",
      timezone: "America/Chicago",
      restrictions: {
        blocked_device_categories: ["media_player"],
        notification_message: "It's bedtime, Buddy! Time to rest up for tomorrow.",
      },
      is_active: true,
    },

    // Atlas: school hours (8:00 AM - 3:00 PM, Mon-Fri)
    {
      tenant_id: SEED_IDS.tenant,
      profile_id: FAMILY_IDS.profiles.atlas,
      schedule_name: "School Hours",
      days_of_week: [1, 2, 3, 4, 5], // Mon-Fri
      start_time: "08:00",
      end_time: "15:00",
      timezone: "America/Chicago",
      restrictions: {
        blocked_device_categories: ["media_player"],
        notification_message: "It's school time, Atlas! Focus on your studies.",
      },
      is_active: true,
    },

    // Luna: quiet time (10:00 PM - 7:00 AM, Mon-Thu)
    {
      tenant_id: SEED_IDS.tenant,
      profile_id: FAMILY_IDS.profiles.luna,
      schedule_name: "Quiet Time",
      days_of_week: [1, 2, 3, 4], // Mon-Thu
      start_time: "22:00",
      end_time: "07:00",
      timezone: "America/Chicago",
      restrictions: {
        volume_cap: 0.3,
        notification_message: "It's quiet time, Luna. Volume is capped at 30%.",
      },
      is_active: true,
    },
  ];

  for (const schedule of schedules) {
    const { error } = await supabase
      .from("family_schedules")
      .insert(schedule);
    if (error) {
      throw new Error(`Failed to seed schedule ${schedule.schedule_name}: ${error.message}`);
    }
    console.log(
      `  ${schedule.schedule_name}: ` +
      `${schedule.start_time}-${schedule.end_time} ` +
      `days=[${schedule.days_of_week.join(",")}]`
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Seed spending limits
// ---------------------------------------------------------------------------

async function seedSpendingLimits(): Promise<void> {
  console.log("Seeding spending limits...");

  const limits = [
    // Luna: $20/day, $100/month, approval above $10
    {
      tenant_id: SEED_IDS.tenant,
      profile_id: FAMILY_IDS.profiles.luna,
      daily_limit: 20,
      monthly_limit: 100,
      requires_approval_above: 10,
      approved_categories: ["food", "entertainment", "school_supplies"],
    },

    // Atlas: $5/day, $30/month, approval above $3
    {
      tenant_id: SEED_IDS.tenant,
      profile_id: FAMILY_IDS.profiles.atlas,
      daily_limit: 5,
      monthly_limit: 30,
      requires_approval_above: 3,
      approved_categories: ["food", "school_supplies"],
    },

    // Buddy: $0/day (no spending)
    {
      tenant_id: SEED_IDS.tenant,
      profile_id: FAMILY_IDS.profiles.buddy,
      daily_limit: 0,
      monthly_limit: 0,
      requires_approval_above: null,
      approved_categories: [],
    },
  ];

  for (const limit of limits) {
    const { error } = await supabase
      .from("family_spending_limits")
      .upsert(limit, { onConflict: "profile_id" });
    if (error) {
      throw new Error(`Failed to seed spending limit: ${error.message}`);
    }
  }

  console.log("  Luna:  $20/day, $100/month, approval above $10");
  console.log("  Atlas: $5/day, $30/month, approval above $3");
  console.log("  Buddy: $0/day (no spending allowed)");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=============================================================");
  console.log("  CleverHub - Family Profile Seed Extension");
  console.log("=============================================================");
  console.log(`  Target: ${SUPABASE_URL}`);
  console.log(`  Tenant: ${SEED_IDS.tenant}`);
  console.log("");

  try {
    await seedFamilyUsers();
    await seedFamilyProfiles();
    await seedPermissionOverrides();
    await seedSchedules();
    await seedSpendingLimits();

    console.log("");
    console.log("=============================================================");
    console.log("  Seed complete! Summary:");
    console.log("  6 family users created");
    console.log("  6 family profiles:");
    console.log("    Jarvis  (adult)         - full permissions, formal tone");
    console.log("    Luna    (teenager)       - deny locks/cameras, quiet time");
    console.log("    Atlas   (tween)          - own room + master bedroom lights");
    console.log("    Buddy   (child)          - bedroom lamp only, bedtime schedule");
    console.log("    Sunny   (toddler)        - zero device control, companion only");
    console.log("    Guest   (adult_visitor)  - living room light + thermostat, 7-day expiry");
    console.log("  8 permission overrides");
    console.log("  3 schedules (bedtime, school, quiet time)");
    console.log("  3 spending limits");
    console.log("=============================================================");
  } catch (error) {
    console.error("");
    console.error("Seed FAILED:", error instanceof Error ? error.message : String(error));
    console.error("");
    console.error("Make sure the base seed has been run first:");
    console.error("  npx tsx packages/supabase-backend/src/seed.ts");
    console.error("");
    console.error("And that migration 004_family_subagents.sql has been applied.");
    process.exit(1);
  }
}

main();
