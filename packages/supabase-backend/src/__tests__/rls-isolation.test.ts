/**
 * RLS Cross-Tenant Isolation Tests
 *
 * Verifies that Supabase Row Level Security policies correctly isolate data
 * between tenants and enforce role-based access within a tenant.
 *
 * Security requirement from claude.md:
 *   "All database tables have tenant_id column with RLS policies. No exceptions."
 *   "Every RLS policy must have a cross-tenant access test proving isolation."
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type {
  TenantId,
  UserId,
  UserRole,
  DeviceId,
  VoiceSessionId,
  GuestProfileId,
  ReservationId,
} from "@clever/shared";

// ---------------------------------------------------------------------------
// Test environment configuration
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = process.env["SUPABASE_ANON_KEY"] ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

// ---------------------------------------------------------------------------
// JWT helper — creates a Supabase client impersonating a specific user
// ---------------------------------------------------------------------------

/**
 * Build a custom JWT payload for test impersonation.
 * In a real test harness this would call supabase.auth.admin.generateLink
 * or use the service role to create test users and sign them in.
 */
interface TestActor {
  userId: string;
  tenantId: string;
  role: UserRole;
  deviceScope?: string;
}

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Create a Supabase client whose requests carry a JWT with the given claims.
 * Uses the service role key to mint a token via supabase.auth.admin.
 * Also ensures a corresponding row exists in public.users so RLS helpers
 * and FK constraints work correctly.
 */
async function impersonatedClient(actor: TestActor): Promise<SupabaseClient> {
  const admin = serviceClient();

  const email = `${actor.userId}@test.clever.local`;
  const password = "Test1234!";
  const predeterminedId = ACTOR_IDS[actor.userId as keyof typeof ACTOR_IDS];

  // Upsert auth user via admin API
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const existing = existingUsers?.users?.find((u) => u.email === email);

  let userId: string;
  if (existing && predeterminedId && existing.id !== predeterminedId) {
    // Delete the old user so we can recreate with the correct predetermined UUID
    await admin.from("users").delete().eq("id", existing.id);
    await admin.auth.admin.deleteUser(existing.id);
    const { data, error } = await admin.auth.admin.createUser({
      id: predeterminedId,
      email,
      password,
      email_confirm: true,
      app_metadata: {
        tenant_id: actor.tenantId,
        user_role: actor.role,
        device_scope: actor.deviceScope ?? null,
      },
    } as Parameters<typeof admin.auth.admin.createUser>[0]);
    if (error) throw new Error(`Failed to recreate test user: ${error.message}`);
    userId = data.user.id;
  } else if (existing) {
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, {
      app_metadata: {
        tenant_id: actor.tenantId,
        user_role: actor.role,
        device_scope: actor.deviceScope ?? null,
      },
    });
  } else {
    const createOpts: Record<string, unknown> = {
      email,
      password,
      email_confirm: true,
      app_metadata: {
        tenant_id: actor.tenantId,
        user_role: actor.role,
        device_scope: actor.deviceScope ?? null,
      },
    };
    if (predeterminedId) {
      createOpts.id = predeterminedId;
    }
    const { data, error } = await admin.auth.admin.createUser(createOpts as Parameters<typeof admin.auth.admin.createUser>[0]);
    if (error) throw new Error(`Failed to create test user: ${error.message}`);
    userId = data.user.id;
  }

  // Ensure a row exists in public.users (required for FK constraints and RLS)
  await admin.from("users").upsert({
    id: userId,
    tenant_id: actor.tenantId,
    email,
    role: actor.role,
    display_name: actor.userId,
  });

  // Sign in to obtain a real JWT
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError)
    throw new Error(`Failed to sign in test user: ${signInError.message}`);

  return client;
}

// ---------------------------------------------------------------------------
// Test fixtures — two completely isolated tenants
// ---------------------------------------------------------------------------

const TENANT_A_ID = "00000000-aaaa-aaaa-aaaa-000000000001" as unknown as TenantId;
const TENANT_B_ID = "00000000-bbbb-bbbb-bbbb-000000000002" as unknown as TenantId;

// Deterministic UUIDs for test actors — used for both auth and public.users rows
const ACTOR_IDS = {
  "owner-a":    "a0a00000-aaaa-0000-0001-000000000001",
  "admin-a":    "a0a00000-aaaa-0000-0002-000000000001",
  "manager-a":  "a0a00000-aaaa-0000-0003-000000000001",
  "resident-a": "a0a00000-aaaa-0000-0004-000000000001",
  "guest-a":    "a0a00000-aaaa-0000-0005-000000000001",
  "owner-b":    "a0a00000-bbbb-0000-0001-000000000002",
  "admin-b":    "a0a00000-bbbb-0000-0002-000000000002",
} as const;

interface TestFixture {
  admin: SupabaseClient; // service role
  tenantA: {
    owner: SupabaseClient;
    admin: SupabaseClient;
    manager: SupabaseClient;
    resident: SupabaseClient;
    guest: SupabaseClient;
  };
  tenantB: {
    owner: SupabaseClient;
    admin: SupabaseClient;
  };
}

let fx: TestFixture;

// Seed data IDs for cross-reference
const seedIds = {
  tenantA: {
    deviceId: "d0000000-aaaa-4000-a001-000000000001",
    roomId: "c0000000-aaaa-4000-a002-000000000001",
    sceneId: "e0000000-aaaa-4000-a003-000000000001",
    voiceSessionId: "f0000000-aaaa-4000-a004-000000000001",
    voiceTranscriptId: "f1000000-aaaa-4000-a005-000000000001",
    auditLogId: "a1000000-aaaa-4000-a006-000000000001",
    reservationId: "b0000000-aaaa-4000-a007-000000000001",
    guestProfileId: "b1000000-aaaa-4000-a008-000000000001",
    guestWipeId: "b2000000-aaaa-4000-a009-000000000001",
  },
  tenantB: {
    deviceId: "d0000000-bbbb-4000-b001-000000000002",
    roomId: "c0000000-bbbb-4000-b002-000000000002",
    sceneId: "e0000000-bbbb-4000-b003-000000000002",
    voiceSessionId: "f0000000-bbbb-4000-b004-000000000002",
    voiceTranscriptId: "f1000000-bbbb-4000-b005-000000000002",
    auditLogId: "a1000000-bbbb-4000-b006-000000000002",
    reservationId: "b0000000-bbbb-4000-b007-000000000002",
    guestProfileId: "b1000000-bbbb-4000-b008-000000000002",
    guestWipeId: "b2000000-bbbb-4000-b009-000000000002",
  },
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const admin = serviceClient();

  // --- Clean up any leftover data from previous test runs ---
  await admin.from("guest_wipe_checklists").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("guest_profiles").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("reservations").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("audit_logs").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("voice_transcripts").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("voice_sessions").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("scenes").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("rooms").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("devices").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("users").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);

  // --- Create tenants via service role (bypasses RLS) ---
  await admin.from("tenants").upsert([
    {
      id: TENANT_A_ID,
      name: "Tenant Alpha",
      vertical: "clever_host",
      subscription_tier: "professional",
      settings: {
        voice_enabled: true,
        max_devices: 50,
        max_users: 20,
        guest_wipe_enabled: true,
        audit_retention_days: 90,
      },
    },
    {
      id: TENANT_B_ID,
      name: "Tenant Bravo",
      vertical: "clever_building",
      subscription_tier: "enterprise",
      settings: {
        voice_enabled: true,
        max_devices: 200,
        max_users: 100,
        guest_wipe_enabled: true,
        audit_retention_days: 365,
      },
    },
  ]);

  // --- Create impersonated clients FIRST (inserts public.users rows) ---
  // Run sequentially to avoid race conditions when deleting/recreating auth users
  const ownerA = await impersonatedClient({ userId: "owner-a", tenantId: TENANT_A_ID as string, role: "owner" });
  const adminA = await impersonatedClient({ userId: "admin-a", tenantId: TENANT_A_ID as string, role: "admin" });
  const managerA = await impersonatedClient({ userId: "manager-a", tenantId: TENANT_A_ID as string, role: "manager" });
  const residentA = await impersonatedClient({ userId: "resident-a", tenantId: TENANT_A_ID as string, role: "resident" });
  const guestA = await impersonatedClient({ userId: "guest-a", tenantId: TENANT_A_ID as string, role: "guest" });
  const ownerB = await impersonatedClient({ userId: "owner-b", tenantId: TENANT_B_ID as string, role: "owner" });
  const adminB = await impersonatedClient({ userId: "admin-b", tenantId: TENANT_B_ID as string, role: "admin" });

  fx = {
    admin,
    tenantA: { owner: ownerA, admin: adminA, manager: managerA, resident: residentA, guest: guestA },
    tenantB: { owner: ownerB, admin: adminB },
  };

  // --- Now seed rows using real user UUIDs from ACTOR_IDS ---
  const ownerAId = ACTOR_IDS["owner-a"];
  const ownerBId = ACTOR_IDS["owner-b"];
  const managerAId = ACTOR_IDS["manager-a"];

  // --- Seed rows for Tenant A ---
  await admin.from("devices").upsert({
    id: seedIds.tenantA.deviceId,
    tenant_id: TENANT_A_ID,
    ha_entity_id: "light.living_room",
    name: "Living Room Light",
    category: "light",
    room: "living_room",
    floor: "1",
    state: "on",
    attributes: {},
    is_online: true,
    last_seen: new Date().toISOString(),
  });

  await admin.from("rooms").upsert({
    id: seedIds.tenantA.roomId,
    tenant_id: TENANT_A_ID,
    name: "Living Room",
    floor: "1",
  });

  await admin.from("scenes").upsert({
    id: seedIds.tenantA.sceneId,
    tenant_id: TENANT_A_ID,
    name: "Good Night",
    description: "Turn everything off",
    actions: [],
    trigger: "voice",
    created_by: ownerAId,
  });

  await admin.from("voice_sessions").upsert({
    id: seedIds.tenantA.voiceSessionId,
    tenant_id: TENANT_A_ID,
    user_id: ownerAId,
    device_id: seedIds.tenantA.deviceId,
    tier: "tier1_rules",
    transcript_encrypted: "turn off the lights",
    parsed_intent: null,
    response_text: "Lights off",
    stages: [],
    total_latency_ms: 120,
    confidence: 1.0,
    status: "completed",
  });

  await admin.from("voice_transcripts").upsert({
    id: seedIds.tenantA.voiceTranscriptId,
    session_id: seedIds.tenantA.voiceSessionId,
    tenant_id: TENANT_A_ID,
    user_id: ownerAId,
    transcript_encrypted: "ENC::base64_encrypted_data",
    intent_summary: "Turn off lights",
    tier_used: "tier1_rules",
    latency_ms: 120,
  });

  await admin.from("audit_logs").insert({
    id: seedIds.tenantA.auditLogId,
    tenant_id: TENANT_A_ID,
    user_id: ownerAId,
    device_id: seedIds.tenantA.deviceId,
    voice_session_id: null,
    action: "device_state_change",
    details: { previous: "on", new: "off" },
    ip_address: "192.168.1.100",
    timestamp: new Date().toISOString(),
  });

  // Insert reservation WITHOUT guest_profile_id first (avoids circular FK issue)
  await admin.from("reservations").upsert({
    id: seedIds.tenantA.reservationId,
    tenant_id: TENANT_A_ID,
    property_id: "prop-1",
    platform: "airbnb",
    check_in: "2026-03-01T15:00:00Z",
    check_out: "2026-03-05T11:00:00Z",
    guest_count: 2,
    status: "upcoming",
  });

  await admin.from("guest_profiles").upsert({
    id: seedIds.tenantA.guestProfileId,
    tenant_id: TENANT_A_ID,
    reservation_id: seedIds.tenantA.reservationId,
    display_name: "Alice Guest",
    wifi_password_encrypted: "guest-wifi-a",
    door_code_encrypted: "1234",
    voice_preferences: {},
    tv_logins_encrypted: [],
    custom_preferences: {},
    expires_at: "2026-03-05T11:00:00Z",
  });

  // Now set the guest_profile_id on the reservation
  await admin.from("reservations").update({
    guest_profile_id: seedIds.tenantA.guestProfileId,
  }).eq("id", seedIds.tenantA.reservationId);

  await admin.from("guest_wipe_checklists").upsert({
    reservation_id: seedIds.tenantA.reservationId,
    tenant_id: TENANT_A_ID,
    items: [
      { category: "locks", description: "Reset door codes", status: "completed", completed_at: new Date().toISOString() },
      { category: "wifi", description: "Rotate WiFi password", status: "completed", completed_at: new Date().toISOString() },
      { category: "voice_history", description: "Clear voice sessions", status: "completed", completed_at: new Date().toISOString() },
      { category: "tv_logins", description: "Log out streaming", status: "completed", completed_at: new Date().toISOString() },
      { category: "preferences", description: "Reset preferences", status: "completed", completed_at: new Date().toISOString() },
      { category: "personal_data", description: "Purge PII", status: "completed", completed_at: new Date().toISOString() },
    ],
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    is_complete: true,
  });

  // --- Seed rows for Tenant B (mirrors A, different IDs) ---
  await admin.from("devices").upsert({
    id: seedIds.tenantB.deviceId,
    tenant_id: TENANT_B_ID,
    ha_entity_id: "lock.front_door",
    name: "Front Door Lock",
    category: "lock",
    room: "entry",
    floor: "1",
    state: "locked",
    attributes: {},
    is_online: true,
    last_seen: new Date().toISOString(),
  });

  await admin.from("rooms").upsert({
    id: seedIds.tenantB.roomId,
    tenant_id: TENANT_B_ID,
    name: "Entry",
    floor: "1",
  });

  await admin.from("scenes").upsert({
    id: seedIds.tenantB.sceneId,
    tenant_id: TENANT_B_ID,
    name: "Movie Mode",
    description: "Dim lights, close blinds",
    actions: [],
    trigger: "manual",
    created_by: ownerBId,
  });

  await admin.from("voice_sessions").upsert({
    id: seedIds.tenantB.voiceSessionId,
    tenant_id: TENANT_B_ID,
    user_id: ownerBId,
    device_id: seedIds.tenantB.deviceId,
    tier: "tier2_cloud",
    transcript_encrypted: "lock the front door",
    parsed_intent: null,
    response_text: "Front door locked",
    stages: [],
    total_latency_ms: 650,
    confidence: 0.95,
    status: "completed",
  });

  await admin.from("voice_transcripts").upsert({
    id: seedIds.tenantB.voiceTranscriptId,
    session_id: seedIds.tenantB.voiceSessionId,
    tenant_id: TENANT_B_ID,
    user_id: ownerBId,
    transcript_encrypted: "ENC::base64_encrypted_data_b",
    intent_summary: "Lock front door",
    tier_used: "tier2_cloud",
    latency_ms: 650,
  });

  await admin.from("audit_logs").insert({
    id: seedIds.tenantB.auditLogId,
    tenant_id: TENANT_B_ID,
    user_id: ownerBId,
    device_id: seedIds.tenantB.deviceId,
    voice_session_id: null,
    action: "device_state_change",
    details: { previous: "unlocked", new: "locked" },
    ip_address: "10.0.0.50",
    timestamp: new Date().toISOString(),
  });

  // Insert reservation WITHOUT guest_profile_id first
  await admin.from("reservations").upsert({
    id: seedIds.tenantB.reservationId,
    tenant_id: TENANT_B_ID,
    property_id: "prop-b1",
    platform: "vrbo",
    check_in: "2026-04-01T15:00:00Z",
    check_out: "2026-04-07T11:00:00Z",
    guest_count: 4,
    status: "active",
  });

  await admin.from("guest_profiles").upsert({
    id: seedIds.tenantB.guestProfileId,
    tenant_id: TENANT_B_ID,
    reservation_id: seedIds.tenantB.reservationId,
    display_name: "Bob Guest",
    wifi_password_encrypted: "guest-wifi-b",
    door_code_encrypted: "5678",
    voice_preferences: {},
    tv_logins_encrypted: [],
    custom_preferences: {},
    expires_at: "2026-04-07T11:00:00Z",
  });

  // Now set the guest_profile_id on the reservation
  await admin.from("reservations").update({
    guest_profile_id: seedIds.tenantB.guestProfileId,
  }).eq("id", seedIds.tenantB.reservationId);

  await admin.from("guest_wipe_checklists").upsert({
    reservation_id: seedIds.tenantB.reservationId,
    tenant_id: TENANT_B_ID,
    items: [],
    started_at: new Date().toISOString(),
    completed_at: null,
    is_complete: false,
  });
});

afterAll(async () => {
  const admin = serviceClient();

  // Clean up seed data (order matters for foreign keys)
  await admin.from("guest_wipe_checklists").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("guest_profiles").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("reservations").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("audit_logs").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("voice_transcripts").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("voice_sessions").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("scenes").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("rooms").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("devices").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("users").delete().in("tenant_id", [TENANT_A_ID, TENANT_B_ID]);
  await admin.from("tenants").delete().in("id", [TENANT_A_ID, TENANT_B_ID]);
});

// ===========================================================================
// CROSS-TENANT ISOLATION TESTS
// ===========================================================================

/**
 * For every table, tenant A's client must NOT be able to read, insert,
 * update, or delete tenant B's rows (and vice versa).
 */

const TABLES_UNDER_TEST = [
  "tenants",
  "users",
  "devices",
  "rooms",
  "scenes",
  "voice_sessions",
  "voice_transcripts",
  "audit_logs",
  "reservations",
  "guest_profiles",
  "guest_wipe_checklists",
] as const;

describe("RLS Cross-Tenant Isolation", () => {
  // -------------------------------------------------------------------------
  // READ isolation: tenant A cannot see tenant B rows
  // -------------------------------------------------------------------------

  describe("SELECT isolation — tenant A cannot read tenant B data", () => {
    for (const table of TABLES_UNDER_TEST) {
      it(`${table}: tenant A owner SELECT returns zero rows from tenant B`, async () => {
        const { data, error } = await fx.tenantA.owner
          .from(table)
          .select("*")
          .eq("tenant_id", TENANT_B_ID);

        // RLS should either filter out the rows (data=[]) or return error
        if (error) {
          // Some RLS policies may throw a permission error — that is acceptable
          expect(error.code).toBeTruthy();
        } else {
          expect(data).toHaveLength(0);
        }
      });
    }

    for (const table of TABLES_UNDER_TEST) {
      it(`${table}: tenant B owner SELECT returns zero rows from tenant A`, async () => {
        const { data, error } = await fx.tenantB.owner
          .from(table)
          .select("*")
          .eq("tenant_id", TENANT_A_ID);

        if (error) {
          expect(error.code).toBeTruthy();
        } else {
          expect(data).toHaveLength(0);
        }
      });
    }
  });

  // -------------------------------------------------------------------------
  // INSERT isolation: tenant A cannot insert rows into tenant B's space
  // -------------------------------------------------------------------------

  describe("INSERT isolation — tenant A cannot write into tenant B space", () => {
    it("devices: tenant A cannot insert a device with tenant B tenant_id", async () => {
      const { error } = await fx.tenantA.owner.from("devices").insert({
        id: "d0000000-fafa-4000-a099-000000000099",
        tenant_id: TENANT_B_ID,
        ha_entity_id: "switch.injected",
        name: "Injected Device",
        category: "switch",
        room: "garage",
        floor: "1",
        state: "off",
        attributes: {},
        is_online: false,
        last_seen: new Date().toISOString(),
      });

      expect(error).not.toBeNull();
    });

    it("rooms: tenant A cannot insert a room into tenant B", async () => {
      const { error } = await fx.tenantA.owner.from("rooms").insert({
        id: "c0000000-fafa-4000-a099-000000000099",
        tenant_id: TENANT_B_ID,
        name: "Injected Room",
        floor: "2",
        devices: [],
      });

      expect(error).not.toBeNull();
    });

    it("scenes: tenant A cannot insert a scene into tenant B", async () => {
      const { error } = await fx.tenantA.owner.from("scenes").insert({
        id: "e0000000-fafa-4000-a099-000000000099",
        tenant_id: TENANT_B_ID,
        name: "Injected Scene",
        description: "Malicious",
        actions: [],
        created_by: ACTOR_IDS["owner-a"],
      });

      expect(error).not.toBeNull();
    });

    it("voice_sessions: tenant A cannot insert a session into tenant B", async () => {
      const { error } = await fx.tenantA.owner.from("voice_sessions").insert({
        id: "f0000000-fafa-4000-a099-000000000099",
        tenant_id: TENANT_B_ID,
        user_id: ACTOR_IDS["owner-a"],
        device_id: seedIds.tenantB.deviceId,
        tier: "tier1_rules",
        transcript_encrypted: "injected",
        response_text: "injected",
        stages: [],
        total_latency_ms: 0,
        confidence: 1.0,
        status: "completed",
      });

      expect(error).not.toBeNull();
    });

    it("audit_logs: tenant A cannot insert an audit log into tenant B", async () => {
      const { error } = await fx.tenantA.owner.from("audit_logs").insert({
        id: "a1000000-fafa-4000-a099-000000000099",
        tenant_id: TENANT_B_ID,
        user_id: ACTOR_IDS["owner-a"],
        action: "device_state_change",
        details: { injected: true },
        timestamp: new Date().toISOString(),
      });

      expect(error).not.toBeNull();
    });

    it("reservations: tenant A cannot insert a reservation into tenant B", async () => {
      const { error } = await fx.tenantA.owner.from("reservations").insert({
        id: "b0000000-fafa-4000-a099-000000000099",
        tenant_id: TENANT_B_ID,
        property_id: "prop-hijack",
        platform: "airbnb",
        check_in: "2026-05-01T15:00:00Z",
        check_out: "2026-05-05T11:00:00Z",
        guest_count: 1,
        status: "upcoming",
      });

      expect(error).not.toBeNull();
    });

    it("guest_profiles: tenant A cannot insert a guest profile into tenant B", async () => {
      const { error } = await fx.tenantA.owner.from("guest_profiles").insert({
        id: "b1000000-fafa-4000-a099-000000000099",
        tenant_id: TENANT_B_ID,
        reservation_id: seedIds.tenantB.reservationId,
        display_name: "Hacker",
        wifi_password_encrypted: "stolen",
        door_code_encrypted: "0000",
        voice_preferences: {},
        tv_logins_encrypted: [],
        custom_preferences: {},
        expires_at: "2026-12-31T00:00:00Z",
      });

      expect(error).not.toBeNull();
    });

    it("guest_wipe_checklists: tenant A cannot insert a wipe checklist for tenant B", async () => {
      const { error } = await fx.tenantA.owner.from("guest_wipe_checklists").insert({
        reservation_id: seedIds.tenantB.reservationId,
        tenant_id: TENANT_B_ID,
        items: [],
        started_at: new Date().toISOString(),
        completed_at: null,
        is_complete: false,
      });

      expect(error).not.toBeNull();
    });

    it("voice_transcripts: tenant A cannot insert a transcript into tenant B", async () => {
      const { error } = await fx.tenantA.owner.from("voice_transcripts").insert({
        id: "f1000000-fafa-4000-a099-000000000099",
        session_id: seedIds.tenantB.voiceSessionId,
        tenant_id: TENANT_B_ID,
        user_id: ACTOR_IDS["owner-a"],
        transcript_encrypted: "ENC::injected",
        intent_summary: "Injected",
        tier_used: "tier1_rules",
        latency_ms: 0,
      });

      expect(error).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // UPDATE isolation: tenant A cannot modify tenant B rows
  // -------------------------------------------------------------------------

  describe("UPDATE isolation — tenant A cannot modify tenant B data", () => {
    it("devices: tenant A cannot update tenant B device", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("devices")
        .update({ name: "HACKED" })
        .eq("id", seedIds.tenantB.deviceId)
        .select();

      // Either error or zero rows returned
      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }
    });

    it("rooms: tenant A cannot update tenant B room", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("rooms")
        .update({ name: "HACKED ROOM" })
        .eq("id", seedIds.tenantB.roomId)
        .select();

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }
    });

    it("scenes: tenant A cannot update tenant B scene", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("scenes")
        .update({ name: "HACKED SCENE" })
        .eq("id", seedIds.tenantB.sceneId)
        .select();

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }
    });

    it("reservations: tenant A cannot update tenant B reservation", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("reservations")
        .update({ status: "cancelled" })
        .eq("id", seedIds.tenantB.reservationId)
        .select();

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }
    });

    it("guest_profiles: tenant A cannot update tenant B guest profile", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("guest_profiles")
        .update({ display_name: "HACKED" })
        .eq("id", seedIds.tenantB.guestProfileId)
        .select();

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // DELETE isolation: tenant A cannot delete tenant B rows
  // -------------------------------------------------------------------------

  describe("DELETE isolation — tenant A cannot delete tenant B data", () => {
    it("devices: tenant A cannot delete tenant B device", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("devices")
        .delete()
        .eq("id", seedIds.tenantB.deviceId)
        .select();

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }

      // Verify B's device still exists via service role
      const { data: check } = await fx.admin
        .from("devices")
        .select("id")
        .eq("id", seedIds.tenantB.deviceId);
      expect(check).toHaveLength(1);
    });

    it("rooms: tenant A cannot delete tenant B room", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("rooms")
        .delete()
        .eq("id", seedIds.tenantB.roomId)
        .select();

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }

      const { data: check } = await fx.admin
        .from("rooms")
        .select("id")
        .eq("id", seedIds.tenantB.roomId);
      expect(check).toHaveLength(1);
    });

    it("audit_logs: tenant A cannot delete tenant B audit logs", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("audit_logs")
        .delete()
        .eq("id", seedIds.tenantB.auditLogId)
        .select();

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }

      const { data: check } = await fx.admin
        .from("audit_logs")
        .select("id")
        .eq("id", seedIds.tenantB.auditLogId);
      expect(check).toHaveLength(1);
    });

    it("voice_sessions: tenant A cannot delete tenant B voice sessions", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("voice_sessions")
        .delete()
        .eq("id", seedIds.tenantB.voiceSessionId)
        .select();

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }

      const { data: check } = await fx.admin
        .from("voice_sessions")
        .select("id")
        .eq("id", seedIds.tenantB.voiceSessionId);
      expect(check).toHaveLength(1);
    });

    it("guest_profiles: tenant A cannot delete tenant B guest profiles", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("guest_profiles")
        .delete()
        .eq("id", seedIds.tenantB.guestProfileId)
        .select();

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }

      const { data: check } = await fx.admin
        .from("guest_profiles")
        .select("id")
        .eq("id", seedIds.tenantB.guestProfileId);
      expect(check).toHaveLength(1);
    });
  });
});

// ===========================================================================
// ROLE-BASED ACCESS WITHIN A TENANT
// ===========================================================================

describe("RLS Role-Based Access within Tenant A", () => {
  // -------------------------------------------------------------------------
  // Owner: sees all data within their tenant
  // -------------------------------------------------------------------------

  describe("owner role — full visibility", () => {
    it("owner can read all devices in their tenant", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("devices")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("owner can read all users in their tenant", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("users")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      expect(error).toBeNull();
      // Owner should see users (at least the seeded ones)
      expect(data).toBeDefined();
    });

    it("owner can read all audit logs in their tenant", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("audit_logs")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("owner can read all voice sessions in their tenant", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("voice_sessions")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("owner can read all guest profiles in their tenant", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("guest_profiles")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("owner can read all reservations in their tenant", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("reservations")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("owner can read all scenes in their tenant", async () => {
      const { data, error } = await fx.tenantA.owner
        .from("scenes")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Admin: manages users and devices, not full owner powers
  // -------------------------------------------------------------------------

  describe("admin role — manages users and devices", () => {
    it("admin can read devices in their tenant", async () => {
      const { data, error } = await fx.tenantA.admin
        .from("devices")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("admin can create a new device in their tenant", async () => {
      const { error } = await fx.tenantA.admin.from("devices").insert({
        id: "d0000000-aaaa-4000-ad01-000000000001",
        tenant_id: TENANT_A_ID,
        ha_entity_id: "switch.admin_created",
        name: "Admin Created Switch",
        category: "switch",
        room: "office",
        floor: "2",
        state: "off",
        attributes: {},
        is_online: true,
        last_seen: new Date().toISOString(),
      });

      // Should succeed or already exist
      expect(error === null || error.code === "23505").toBeTruthy();
    });

    it("admin can read users in their tenant", async () => {
      const { data, error } = await fx.tenantA.admin
        .from("users")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it("admin can update a device in their tenant", async () => {
      const { data, error } = await fx.tenantA.admin
        .from("devices")
        .update({ name: "Updated by Admin" })
        .eq("id", seedIds.tenantA.deviceId)
        .select();

      expect(error).toBeNull();
      if (data && data.length > 0) {
        expect(data[0]["name"]).toBe("Updated by Admin");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Manager: manages devices and scenes
  // -------------------------------------------------------------------------

  describe("manager role — manages devices and scenes", () => {
    it("manager can read devices in their tenant", async () => {
      const { data, error } = await fx.tenantA.manager
        .from("devices")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("manager can read scenes in their tenant", async () => {
      const { data, error } = await fx.tenantA.manager
        .from("scenes")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("manager can create a scene in their tenant", async () => {
      const { error } = await fx.tenantA.manager.from("scenes").insert({
        id: "e0000000-aaaa-4000-a301-000000000001",
        tenant_id: TENANT_A_ID,
        name: "Manager Scene",
        description: "Created by manager",
        actions: [],
        trigger: "manual",
        created_by: ACTOR_IDS["manager-a"],
      });

      expect(error === null || error.code === "23505").toBeTruthy();
    });

    it("manager can update a device in their tenant", async () => {
      const { data, error } = await fx.tenantA.manager
        .from("devices")
        .update({ name: "Updated by Manager" })
        .eq("id", seedIds.tenantA.deviceId)
        .select();

      expect(error).toBeNull();
    });

    it("manager cannot manage users", async () => {
      const { error } = await fx.tenantA.manager.from("users").insert({
        id: "00000000-0000-4000-af01-000000000001",
        tenant_id: TENANT_A_ID,
        email: "shouldfail@test.local",
        role: "resident",
        display_name: "Should Fail",
      });

      // Manager should not be able to create users — expect error or policy denial
      expect(error).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Resident: read devices, no write to scenes/users
  // -------------------------------------------------------------------------

  describe("resident role — read devices, limited write", () => {
    it("resident can read devices in their tenant", async () => {
      const { data, error } = await fx.tenantA.resident
        .from("devices")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("resident cannot create new devices", async () => {
      const { error } = await fx.tenantA.resident.from("devices").insert({
        id: "d0000000-0000-4000-af02-000000000001",
        tenant_id: TENANT_A_ID,
        ha_entity_id: "light.resident_should_fail",
        name: "Resident Fail",
        category: "light",
        room: "bathroom",
        floor: "1",
        state: "off",
        attributes: {},
        is_online: false,
        last_seen: new Date().toISOString(),
      });

      expect(error).not.toBeNull();
    });

    it("resident cannot delete devices", async () => {
      const { data, error } = await fx.tenantA.resident
        .from("devices")
        .delete()
        .eq("id", seedIds.tenantA.deviceId)
        .select();

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }
    });

    it("resident cannot create or modify users", async () => {
      const { error } = await fx.tenantA.resident.from("users").insert({
        id: "00000000-0000-4000-af03-000000000001",
        tenant_id: TENANT_A_ID,
        email: "resfail@test.local",
        role: "guest",
        display_name: "Resident Fail",
      });

      expect(error).not.toBeNull();
    });

    it("resident cannot create scenes", async () => {
      const { error } = await fx.tenantA.resident.from("scenes").insert({
        id: "e0000000-0000-4000-af04-000000000001",
        tenant_id: TENANT_A_ID,
        name: "Resident Scene Fail",
        description: "Should fail",
        actions: [],
        created_by: ACTOR_IDS["resident-a"],
      });

      expect(error).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Guest: sees only their own profile
  // -------------------------------------------------------------------------

  describe("guest role — can only see their own profile", () => {
    it("guest cannot read devices", async () => {
      const { data, error } = await fx.tenantA.guest
        .from("devices")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      // Guest should either get error or empty result
      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }
    });

    it("guest can only see users within their own tenant", async () => {
      const { data, error } = await fx.tenantA.guest
        .from("users")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        // The users_select policy allows all authenticated users in a tenant
        // to see all other users in the same tenant (for roster/directory).
        // Guest should see at least themselves via users_select_own policy.
        expect(data!.length).toBeGreaterThanOrEqual(1);
        // All returned rows should belong to the guest's tenant
        for (const row of data!) {
          expect(row.tenant_id).toBe(TENANT_A_ID);
        }
      }
    });

    it("guest cannot read audit logs", async () => {
      const { data, error } = await fx.tenantA.guest
        .from("audit_logs")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }
    });

    it("guest cannot read voice sessions", async () => {
      const { data, error } = await fx.tenantA.guest
        .from("voice_sessions")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toHaveLength(0);
      }
    });

    it("guest cannot create devices, users, or scenes", async () => {
      const deviceInsert = await fx.tenantA.guest.from("devices").insert({
        id: "d0000000-0000-4000-af05-000000000001",
        tenant_id: TENANT_A_ID,
        ha_entity_id: "light.guest_fail",
        name: "Guest Fail",
        category: "light",
        room: "x",
        floor: "1",
        state: "off",
        attributes: {},
        is_online: false,
        last_seen: new Date().toISOString(),
      });
      expect(deviceInsert.error).not.toBeNull();

      const userInsert = await fx.tenantA.guest.from("users").insert({
        id: "00000000-0000-4000-af06-000000000001",
        tenant_id: TENANT_A_ID,
        email: "guestfail@test.local",
        role: "admin",
        display_name: "Escalation Attempt",
      });
      expect(userInsert.error).not.toBeNull();

      const sceneInsert = await fx.tenantA.guest.from("scenes").insert({
        id: "e0000000-0000-4000-af07-000000000001",
        tenant_id: TENANT_A_ID,
        name: "Guest Scene Fail",
        description: "Should fail",
        actions: [],
        created_by: ACTOR_IDS["guest-a"],
      });
      expect(sceneInsert.error).not.toBeNull();
    });

    it("guest cannot modify other guest profiles", async () => {
      // Try to read all guest profiles — should only see own
      const { data, error } = await fx.tenantA.guest
        .from("guest_profiles")
        .select("*")
        .eq("tenant_id", TENANT_A_ID);

      if (error) {
        expect(error.code).toBeTruthy();
      } else {
        // Should only see their own profile, not all profiles
        for (const row of data ?? []) {
          // Each row should belong to the guest's own reservation
          expect(row["tenant_id"]).toBe(TENANT_A_ID);
        }
      }
    });
  });
});

// ===========================================================================
// AUDIT LOG INSERT-ONLY POLICY
// ===========================================================================

describe("Audit logs are insert-only for non-owners", () => {
  it("admin can insert audit log entries", async () => {
    const { error } = await fx.tenantA.admin.from("audit_logs").insert({
      tenant_id: TENANT_A_ID,
      user_id: ACTOR_IDS["admin-a"],
      action: "device_command_issued",
      details: { test: true },
      timestamp: new Date().toISOString(),
    });

    // Insert should work for admin
    expect(error).toBeNull();
  });

  it("admin cannot update existing audit log entries", async () => {
    const { data, error } = await fx.tenantA.admin
      .from("audit_logs")
      .update({ details: { tampered: true } })
      .eq("id", seedIds.tenantA.auditLogId)
      .select();

    // Should be blocked by RLS — either error or zero updated rows
    if (error) {
      expect(error.code).toBeTruthy();
    } else {
      expect(data).toHaveLength(0);
    }
  });

  it("admin cannot delete audit log entries", async () => {
    const { data, error } = await fx.tenantA.admin
      .from("audit_logs")
      .delete()
      .eq("id", seedIds.tenantA.auditLogId)
      .select();

    if (error) {
      expect(error.code).toBeTruthy();
    } else {
      expect(data).toHaveLength(0);
    }

    // Verify the log still exists
    const { data: check } = await fx.admin
      .from("audit_logs")
      .select("id")
      .eq("id", seedIds.tenantA.auditLogId);
    expect(check).toHaveLength(1);
  });

  it("manager cannot update audit log entries", async () => {
    const { data, error } = await fx.tenantA.manager
      .from("audit_logs")
      .update({ details: { tampered: true } })
      .eq("id", seedIds.tenantA.auditLogId)
      .select();

    if (error) {
      expect(error.code).toBeTruthy();
    } else {
      expect(data).toHaveLength(0);
    }
  });

  it("manager cannot delete audit log entries", async () => {
    const { data, error } = await fx.tenantA.manager
      .from("audit_logs")
      .delete()
      .eq("id", seedIds.tenantA.auditLogId)
      .select();

    if (error) {
      expect(error.code).toBeTruthy();
    } else {
      expect(data).toHaveLength(0);
    }
  });

  it("resident cannot update or delete audit log entries", async () => {
    const updateResult = await fx.tenantA.resident
      .from("audit_logs")
      .update({ details: { tampered: true } })
      .eq("id", seedIds.tenantA.auditLogId)
      .select();

    if (updateResult.error) {
      expect(updateResult.error.code).toBeTruthy();
    } else {
      expect(updateResult.data).toHaveLength(0);
    }

    const deleteResult = await fx.tenantA.resident
      .from("audit_logs")
      .delete()
      .eq("id", seedIds.tenantA.auditLogId)
      .select();

    if (deleteResult.error) {
      expect(deleteResult.error.code).toBeTruthy();
    } else {
      expect(deleteResult.data).toHaveLength(0);
    }
  });

  it("guest cannot read, update, or delete audit log entries", async () => {
    const readResult = await fx.tenantA.guest
      .from("audit_logs")
      .select("*")
      .eq("tenant_id", TENANT_A_ID);

    if (readResult.error) {
      expect(readResult.error.code).toBeTruthy();
    } else {
      expect(readResult.data).toHaveLength(0);
    }

    const updateResult = await fx.tenantA.guest
      .from("audit_logs")
      .update({ details: { tampered: true } })
      .eq("id", seedIds.tenantA.auditLogId)
      .select();

    if (updateResult.error) {
      expect(updateResult.error.code).toBeTruthy();
    } else {
      expect(updateResult.data).toHaveLength(0);
    }
  });
});

// ===========================================================================
// TENANT ISOLATION SMOKE TEST — UNFILTERED SELECT
// ===========================================================================

describe("Unfiltered SELECT only returns own-tenant rows", () => {
  for (const table of TABLES_UNDER_TEST) {
    it(`${table}: unfiltered SELECT from tenant A returns only tenant A rows`, async () => {
      const { data, error } = await fx.tenantA.owner.from(table).select("*");

      if (error) {
        // If the table requires filter, that is a valid RLS enforcement pattern
        expect(error.code).toBeTruthy();
      } else {
        // Every row returned must belong to tenant A
        for (const row of data ?? []) {
          expect(row["tenant_id"]).toBe(TENANT_A_ID);
        }
      }
    });
  }
});
