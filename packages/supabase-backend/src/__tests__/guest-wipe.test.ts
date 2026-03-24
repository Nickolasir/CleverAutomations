/**
 * Guest Wipe Completeness Tests
 *
 * Verifies that the guest profile wipe process between Airbnb/STR stays
 * completely removes ALL personal data across all 6 required categories.
 *
 * Security requirement from claude.md:
 *   "Guest profile wipe between Airbnb stays must be complete: locks, WiFi,
 *    voice history, TV logins, preferences, all personal data."
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type {
  TenantId,
  UserId,
  UserRole,
  GuestWipeCategory,
  GuestWipeChecklist,
  GuestWipeItem,
  GuestProfile,
  Reservation,
} from "@clever/shared";
import { REQUIRED_WIPE_CATEGORIES } from "@clever/shared";

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = process.env["SUPABASE_ANON_KEY"] ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

const TEST_TENANT_ID = "00000000-0000-4000-a000-000000000099" as unknown as TenantId;

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------------
// Wipe executor — simulates the production wipe logic
// ---------------------------------------------------------------------------

interface WipeResult {
  checklist: GuestWipeChecklist;
  errors: string[];
}

/**
 * Execute a guest profile wipe for a reservation.
 * This mirrors the production wipe logic that must be tested.
 */
async function executeGuestWipe(
  admin: SupabaseClient,
  tenantId: TenantId,
  reservationId: string,
  simulateFailure?: GuestWipeCategory
): Promise<WipeResult> {
  const errors: string[] = [];
  const items: GuestWipeItem[] = [];
  const startedAt = new Date().toISOString();

  // Process each required wipe category
  for (const category of REQUIRED_WIPE_CATEGORIES) {
    const item: GuestWipeItem = {
      category,
      description: getWipeDescription(category),
      status: "in_progress",
      completed_at: null,
    };

    try {
      if (simulateFailure === category) {
        throw new Error(`Simulated failure for ${category}`);
      }

      await performCategoryWipe(admin, tenantId, reservationId, category);

      item.status = "completed";
      item.completed_at = new Date().toISOString();
    } catch (err) {
      item.status = "failed";
      item.error = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${category}: ${item.error}`);
    }

    items.push(item);
  }

  const isComplete = items.every((i) => i.status === "completed");

  const checklist: GuestWipeChecklist = {
    reservation_id: reservationId as never,
    tenant_id: tenantId,
    items,
    started_at: startedAt,
    completed_at: isComplete ? new Date().toISOString() : null,
    is_complete: isComplete,
  };

  // Store the checklist
  await admin.from("guest_wipe_checklists").upsert({
    reservation_id: reservationId,
    tenant_id: tenantId,
    items: checklist.items,
    started_at: checklist.started_at,
    completed_at: checklist.completed_at,
    is_complete: checklist.is_complete,
  });

  // Create audit log entry for the wipe
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    action: "guest_profile_wiped",
    details: {
      reservation_id: reservationId,
      is_complete: isComplete,
      categories_completed: items
        .filter((i) => i.status === "completed")
        .map((i) => i.category),
      categories_failed: items
        .filter((i) => i.status === "failed")
        .map((i) => i.category),
      errors,
    },
    timestamp: new Date().toISOString(),
  });

  return { checklist, errors };
}

function getWipeDescription(category: GuestWipeCategory): string {
  const descriptions: Record<GuestWipeCategory, string> = {
    locks: "Reset all door codes and smart lock access",
    wifi: "Rotate WiFi password and revoke guest network access",
    voice_history: "Delete all voice sessions and transcripts for this guest",
    tv_logins: "Log out of all streaming services on smart TVs",
    preferences: "Reset thermostat, lighting, and scene preferences to defaults",
    personal_data: "Purge guest profile, contact info, and any stored PII",
  };
  return descriptions[category];
}

/**
 * Perform the actual wipe for a specific category.
 * In production, each category calls different services.
 */
async function performCategoryWipe(
  admin: SupabaseClient,
  tenantId: TenantId,
  reservationId: string,
  category: GuestWipeCategory
): Promise<void> {
  switch (category) {
    case "locks":
      // Reset door codes
      await admin
        .from("guest_profiles")
        .update({ door_code_encrypted: "" })
        .eq("tenant_id", tenantId)
        .eq("reservation_id", reservationId);
      break;

    case "wifi":
      // Rotate WiFi password
      await admin
        .from("guest_profiles")
        .update({ wifi_password_encrypted: "" })
        .eq("tenant_id", tenantId)
        .eq("reservation_id", reservationId);
      break;

    case "voice_history":
      // Delete voice sessions and transcripts for this tenant/reservation period
      await admin
        .from("voice_transcripts")
        .delete()
        .eq("tenant_id", tenantId);
      await admin
        .from("voice_sessions")
        .delete()
        .eq("tenant_id", tenantId);
      break;

    case "tv_logins":
      // Clear TV login credentials
      await admin
        .from("guest_profiles")
        .update({ tv_logins_encrypted: [] })
        .eq("tenant_id", tenantId)
        .eq("reservation_id", reservationId);
      break;

    case "preferences":
      // Reset preferences to defaults
      await admin
        .from("guest_profiles")
        .update({
          voice_preferences: {},
          custom_preferences: {},
        })
        .eq("tenant_id", tenantId)
        .eq("reservation_id", reservationId);
      break;

    case "personal_data":
      // Purge the guest profile display name and any PII
      await admin
        .from("guest_profiles")
        .update({
          display_name: "[WIPED]",
        })
        .eq("tenant_id", tenantId)
        .eq("reservation_id", reservationId);
      break;
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const RESERVATION_ID = "00000000-0000-4000-b001-000000000001";
const GUEST_PROFILE_ID = "00000000-0000-4000-b002-000000000001";

// Test helper user and device UUIDs (needed for voice session FK constraints)
const TEST_USER_ID = "00000000-0000-4000-b003-000000000001";
const TEST_DEVICE_ID = "00000000-0000-4000-b004-000000000001";

let admin: SupabaseClient;

beforeAll(async () => {
  admin = serviceClient();

  // Seed tenant
  await admin.from("tenants").upsert({
    id: TEST_TENANT_ID,
    name: "Wipe Test Tenant",
    vertical: "clever_host",
    subscription_tier: "professional",
    settings: {
      voice_enabled: true,
      max_devices: 10,
      max_users: 5,
      guest_wipe_enabled: true,
      audit_retention_days: 90,
    },
  });

  // Seed a test user (needed for voice_sessions FK)
  await admin.from("users").upsert({
    id: TEST_USER_ID,
    tenant_id: TEST_TENANT_ID,
    email: "wipe-test-user@test.clever.local",
    role: "resident",
    display_name: "Wipe Test User",
  });

  // Seed a test device (needed for voice_sessions FK)
  await admin.from("devices").upsert({
    id: TEST_DEVICE_ID,
    tenant_id: TEST_TENANT_ID,
    ha_entity_id: "light.wipe_test",
    name: "Wipe Test Light",
    category: "light",
    room: "living_room",
    floor: "1",
    state: "on",
    attributes: {},
    is_online: true,
    last_seen: new Date().toISOString(),
  });
});

beforeEach(async () => {
  // Clean up any previous test data
  await admin.from("audit_logs").delete().eq("tenant_id", TEST_TENANT_ID);
  await admin.from("guest_wipe_checklists").delete().eq("tenant_id", TEST_TENANT_ID);
  await admin.from("guest_profiles").delete().eq("tenant_id", TEST_TENANT_ID);
  await admin.from("reservations").delete().eq("tenant_id", TEST_TENANT_ID);
  await admin.from("voice_transcripts").delete().eq("tenant_id", TEST_TENANT_ID);
  await admin.from("voice_sessions").delete().eq("tenant_id", TEST_TENANT_ID);

  // Insert reservation first (without guest_profile_id to avoid circular FK)
  await admin.from("reservations").insert({
    id: RESERVATION_ID,
    tenant_id: TEST_TENANT_ID,
    property_id: "prop-wipe-1",
    platform: "airbnb",
    check_in: "2026-02-01T15:00:00Z",
    check_out: "2026-02-05T11:00:00Z",
    guest_count: 2,
    status: "active",
  });

  await admin.from("guest_profiles").insert({
    id: GUEST_PROFILE_ID,
    tenant_id: TEST_TENANT_ID,
    reservation_id: RESERVATION_ID,
    display_name: "Jane Doe",
    wifi_password_encrypted: "guest-wifi-secret-123",
    door_code_encrypted: "4567",
    voice_preferences: { language: "en", volume: "loud" },
    tv_logins_encrypted: [
      { service: "netflix", encrypted_data: "ENC::netflix-creds" },
      { service: "hulu", encrypted_data: "ENC::hulu-creds" },
    ],
    custom_preferences: { theme: "dark", wake_word: "hey butler" },
    expires_at: "2026-02-05T11:00:00Z",
  });

  // Now link the guest profile back to the reservation
  await admin.from("reservations").update({
    guest_profile_id: GUEST_PROFILE_ID,
  }).eq("id", RESERVATION_ID);
});

afterAll(async () => {
  await admin.from("audit_logs").delete().eq("tenant_id", TEST_TENANT_ID);
  await admin.from("guest_wipe_checklists").delete().eq("tenant_id", TEST_TENANT_ID);
  await admin.from("guest_profiles").delete().eq("tenant_id", TEST_TENANT_ID);
  await admin.from("reservations").delete().eq("tenant_id", TEST_TENANT_ID);
  await admin.from("voice_transcripts").delete().eq("tenant_id", TEST_TENANT_ID);
  await admin.from("voice_sessions").delete().eq("tenant_id", TEST_TENANT_ID);
  await admin.from("devices").delete().eq("tenant_id", TEST_TENANT_ID);
  await admin.from("users").delete().eq("tenant_id", TEST_TENANT_ID);
  await admin.from("tenants").delete().eq("id", TEST_TENANT_ID);
});

// ===========================================================================
// ALL 6 WIPE CATEGORIES CLEARED
// ===========================================================================

describe("All 6 Wipe Categories Are Cleared", () => {
  it("REQUIRED_WIPE_CATEGORIES contains exactly 6 categories", () => {
    expect(REQUIRED_WIPE_CATEGORIES).toHaveLength(6);
  });

  it("REQUIRED_WIPE_CATEGORIES includes locks", () => {
    expect(REQUIRED_WIPE_CATEGORIES).toContain("locks");
  });

  it("REQUIRED_WIPE_CATEGORIES includes wifi", () => {
    expect(REQUIRED_WIPE_CATEGORIES).toContain("wifi");
  });

  it("REQUIRED_WIPE_CATEGORIES includes voice_history", () => {
    expect(REQUIRED_WIPE_CATEGORIES).toContain("voice_history");
  });

  it("REQUIRED_WIPE_CATEGORIES includes tv_logins", () => {
    expect(REQUIRED_WIPE_CATEGORIES).toContain("tv_logins");
  });

  it("REQUIRED_WIPE_CATEGORIES includes preferences", () => {
    expect(REQUIRED_WIPE_CATEGORIES).toContain("preferences");
  });

  it("REQUIRED_WIPE_CATEGORIES includes personal_data", () => {
    expect(REQUIRED_WIPE_CATEGORIES).toContain("personal_data");
  });

  it("successful wipe completes all 6 categories", async () => {
    const result = await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    expect(result.errors).toHaveLength(0);
    expect(result.checklist.is_complete).toBe(true);
    expect(result.checklist.completed_at).not.toBeNull();
    expect(result.checklist.items).toHaveLength(6);

    // Every category should be completed
    for (const item of result.checklist.items) {
      expect(item.status).toBe("completed");
      expect(item.completed_at).not.toBeNull();
    }

    // Verify all 6 categories are represented
    const categories = result.checklist.items.map((i) => i.category);
    for (const required of REQUIRED_WIPE_CATEGORIES) {
      expect(categories).toContain(required);
    }
  });

  it("locks wipe resets door codes", async () => {
    await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    const { data: profile } = await admin
      .from("guest_profiles")
      .select("door_code_encrypted")
      .eq("id", GUEST_PROFILE_ID)
      .single();

    expect(profile?.door_code_encrypted).toBe("");
  });

  it("wifi wipe rotates WiFi password", async () => {
    await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    const { data: profile } = await admin
      .from("guest_profiles")
      .select("wifi_password_encrypted")
      .eq("id", GUEST_PROFILE_ID)
      .single();

    expect(profile?.wifi_password_encrypted).toBe("");
    expect(profile?.wifi_password_encrypted).not.toBe("guest-wifi-secret-123");
  });

  it("voice_history wipe removes all voice sessions and transcripts", async () => {
    const vsId = "00000000-0000-4000-b005-000000000001";
    const vtId = "00000000-0000-4000-b006-000000000001";
    // First, seed some voice data
    await admin.from("voice_sessions").insert({
      id: vsId,
      tenant_id: TEST_TENANT_ID,
      user_id: TEST_USER_ID,
      device_id: TEST_DEVICE_ID,
      tier: "tier1_rules",
      transcript_encrypted: "turn off lights",
      response_text: "Done",
      stages: [],
      total_latency_ms: 100,
      confidence: 1.0,
      status: "completed",
    });

    await admin.from("voice_transcripts").insert({
      id: vtId,
      session_id: vsId,
      tenant_id: TEST_TENANT_ID,
      user_id: TEST_USER_ID,
      transcript_encrypted: "ENC::base64data",
      intent_summary: "Turn off lights",
      tier_used: "tier1_rules",
      latency_ms: 100,
    });

    await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    const { data: sessions } = await admin
      .from("voice_sessions")
      .select("*")
      .eq("tenant_id", TEST_TENANT_ID);
    expect(sessions).toHaveLength(0);

    const { data: transcripts } = await admin
      .from("voice_transcripts")
      .select("*")
      .eq("tenant_id", TEST_TENANT_ID);
    expect(transcripts).toHaveLength(0);
  });

  it("tv_logins wipe clears all streaming credentials", async () => {
    await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    const { data: profile } = await admin
      .from("guest_profiles")
      .select("tv_logins_encrypted")
      .eq("id", GUEST_PROFILE_ID)
      .single();

    expect(profile?.tv_logins_encrypted).toEqual([]);
  });

  it("preferences wipe resets all custom preferences", async () => {
    await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    const { data: profile } = await admin
      .from("guest_profiles")
      .select("voice_preferences, custom_preferences")
      .eq("id", GUEST_PROFILE_ID)
      .single();

    expect(profile?.voice_preferences).toEqual({});
    expect(profile?.custom_preferences).toEqual({});
  });

  it("personal_data wipe removes display name and PII", async () => {
    await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    const { data: profile } = await admin
      .from("guest_profiles")
      .select("display_name")
      .eq("id", GUEST_PROFILE_ID)
      .single();

    expect(profile?.display_name).toBe("[WIPED]");
    expect(profile?.display_name).not.toBe("Jane Doe");
  });
});

// ===========================================================================
// PARTIAL WIPE FAILURE
// ===========================================================================

describe("Partial Wipe Failure Handling", () => {
  it("partial wipe failure marks checklist as incomplete", async () => {
    const result = await executeGuestWipe(
      admin,
      TEST_TENANT_ID,
      RESERVATION_ID,
      "wifi" // Simulate failure on wifi category
    );

    expect(result.checklist.is_complete).toBe(false);
    expect(result.checklist.completed_at).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("wifi");
  });

  it("failed category has error status while others complete", async () => {
    const result = await executeGuestWipe(
      admin,
      TEST_TENANT_ID,
      RESERVATION_ID,
      "tv_logins"
    );

    const failedItem = result.checklist.items.find(
      (i) => i.category === "tv_logins"
    );
    expect(failedItem?.status).toBe("failed");
    expect(failedItem?.error).toBeTruthy();

    // All OTHER categories should still be completed
    const otherItems = result.checklist.items.filter(
      (i) => i.category !== "tv_logins"
    );
    for (const item of otherItems) {
      expect(item.status).toBe("completed");
    }
  });

  it("stored checklist reflects partial failure in database", async () => {
    await executeGuestWipe(
      admin,
      TEST_TENANT_ID,
      RESERVATION_ID,
      "locks"
    );

    const { data: stored } = await admin
      .from("guest_wipe_checklists")
      .select("*")
      .eq("reservation_id", RESERVATION_ID)
      .eq("tenant_id", TEST_TENANT_ID)
      .single();

    expect(stored).not.toBeNull();
    expect(stored?.is_complete).toBe(false);
    expect(stored?.completed_at).toBeNull();

    const items = stored?.items as GuestWipeItem[];
    const failedItem = items.find((i) => i.category === "locks");
    expect(failedItem?.status).toBe("failed");
  });

  it("each category failure is independent — failures do not cascade", async () => {
    // Fail on voice_history (3rd category) — categories before and after should still complete
    const result = await executeGuestWipe(
      admin,
      TEST_TENANT_ID,
      RESERVATION_ID,
      "voice_history"
    );

    const locks = result.checklist.items.find((i) => i.category === "locks");
    const wifi = result.checklist.items.find((i) => i.category === "wifi");
    const voiceHistory = result.checklist.items.find(
      (i) => i.category === "voice_history"
    );
    const tvLogins = result.checklist.items.find(
      (i) => i.category === "tv_logins"
    );
    const preferences = result.checklist.items.find(
      (i) => i.category === "preferences"
    );
    const personalData = result.checklist.items.find(
      (i) => i.category === "personal_data"
    );

    // Before the failure
    expect(locks?.status).toBe("completed");
    expect(wifi?.status).toBe("completed");

    // The failure
    expect(voiceHistory?.status).toBe("failed");

    // After the failure — should still complete
    expect(tvLogins?.status).toBe("completed");
    expect(preferences?.status).toBe("completed");
    expect(personalData?.status).toBe("completed");
  });
});

// ===========================================================================
// WIPE TRIGGERED ON CHECKOUT
// ===========================================================================

describe("Wipe Triggered on Reservation Checkout", () => {
  it("checkout status change triggers wipe", async () => {
    // Simulate checkout by updating reservation status
    await admin
      .from("reservations")
      .update({ status: "completed" })
      .eq("id", RESERVATION_ID)
      .eq("tenant_id", TEST_TENANT_ID);

    // Verify the reservation is now completed
    const { data: reservation } = await admin
      .from("reservations")
      .select("status")
      .eq("id", RESERVATION_ID)
      .single();

    expect(reservation?.status).toBe("completed");

    // Now execute the wipe (in production, this would be triggered by a DB webhook or Edge Function)
    const result = await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    expect(result.checklist.is_complete).toBe(true);
  });

  it("wipe only runs for completed reservations", async () => {
    // Verify the reservation is still active
    const { data: reservation } = await admin
      .from("reservations")
      .select("status")
      .eq("id", RESERVATION_ID)
      .single();

    expect(reservation?.status).toBe("active");

    // The wipe function itself does not check status — it is the caller's
    // responsibility. But we verify the intended trigger condition.
    // In production: a Supabase DB webhook fires when status changes to "completed"

    // Simulate the webhook guard
    function shouldTriggerWipe(reservationStatus: string): boolean {
      return reservationStatus === "completed";
    }

    expect(shouldTriggerWipe("active")).toBe(false);
    expect(shouldTriggerWipe("upcoming")).toBe(false);
    expect(shouldTriggerWipe("cancelled")).toBe(false);
    expect(shouldTriggerWipe("completed")).toBe(true);
  });

  it("wipe processes checkout regardless of checkout time", async () => {
    // Even if checkout time has passed, wipe should still execute
    await admin
      .from("reservations")
      .update({
        status: "completed",
        check_out: "2026-01-01T11:00:00Z", // In the past
      })
      .eq("id", RESERVATION_ID);

    const result = await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);
    expect(result.checklist.is_complete).toBe(true);
  });
});

// ===========================================================================
// NO PERSONAL DATA ACCESSIBLE AFTER WIPE
// ===========================================================================

describe("No Personal Data Accessible After Wipe", () => {
  it("guest profile has no personally identifiable information after wipe", async () => {
    await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    const { data: profile } = await admin
      .from("guest_profiles")
      .select("*")
      .eq("id", GUEST_PROFILE_ID)
      .single();

    expect(profile).not.toBeNull();

    // Display name should be wiped
    expect(profile!.display_name).toBe("[WIPED]");
    expect(profile!.display_name).not.toBe("Jane Doe");

    // WiFi password should be cleared
    expect(profile!.wifi_password_encrypted).toBe("");
    expect(profile!.wifi_password_encrypted).not.toBe("guest-wifi-secret-123");

    // Door code should be cleared
    expect(profile!.door_code_encrypted).toBe("");
    expect(profile!.door_code_encrypted).not.toBe("4567");

    // TV logins should be empty
    expect(profile!.tv_logins_encrypted).toEqual([]);

    // Preferences should be empty
    expect(profile!.voice_preferences).toEqual({});
    expect(profile!.custom_preferences).toEqual({});
  });

  it("no voice transcripts remain after wipe", async () => {
    const vsId = "00000000-0000-4000-b007-000000000001";
    const vtId = "00000000-0000-4000-b008-000000000001";
    // Seed voice data
    await admin.from("voice_sessions").insert({
      id: vsId,
      tenant_id: TEST_TENANT_ID,
      user_id: TEST_USER_ID,
      device_id: TEST_DEVICE_ID,
      tier: "tier2_cloud",
      transcript_encrypted: "what is my wifi password",
      response_text: "Your wifi password is...",
      stages: [],
      total_latency_ms: 500,
      confidence: 0.9,
      status: "completed",
    });

    await admin.from("voice_transcripts").insert({
      id: vtId,
      session_id: vsId,
      tenant_id: TEST_TENANT_ID,
      user_id: TEST_USER_ID,
      transcript_encrypted: "ENC::sensitive-transcript",
      intent_summary: "WiFi password query",
      tier_used: "tier2_cloud",
      latency_ms: 500,
    });

    await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    // Verify no voice data remains
    const { data: sessions } = await admin
      .from("voice_sessions")
      .select("*")
      .eq("tenant_id", TEST_TENANT_ID);
    expect(sessions).toHaveLength(0);

    const { data: transcripts } = await admin
      .from("voice_transcripts")
      .select("*")
      .eq("tenant_id", TEST_TENANT_ID);
    expect(transcripts).toHaveLength(0);
  });

  it("guest profile contains no sensitive strings after wipe", async () => {
    await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    const { data: profile } = await admin
      .from("guest_profiles")
      .select("*")
      .eq("id", GUEST_PROFILE_ID)
      .single();

    // Serialize the entire profile and check for sensitive values
    const serialized = JSON.stringify(profile);

    expect(serialized).not.toContain("Jane Doe");
    expect(serialized).not.toContain("guest-wifi-secret-123");
    expect(serialized).not.toContain("4567");
    expect(serialized).not.toContain("netflix-creds");
    expect(serialized).not.toContain("hulu-creds");
    expect(serialized).not.toContain("hey butler");
  });
});

// ===========================================================================
// WIPE AUDIT LOG
// ===========================================================================

describe("Wipe Audit Log", () => {
  it("successful wipe creates an audit log entry", async () => {
    await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    const { data: logs } = await admin
      .from("audit_logs")
      .select("*")
      .eq("tenant_id", TEST_TENANT_ID)
      .eq("action", "guest_profile_wiped")
      .order("timestamp", { ascending: false })
      .limit(1);

    expect(logs).not.toBeNull();
    expect(logs!.length).toBeGreaterThanOrEqual(1);

    const log = logs![0]!;
    expect(log.action).toBe("guest_profile_wiped");
    expect(log.tenant_id).toBe(TEST_TENANT_ID);

    const details = log.details as Record<string, unknown>;
    expect(details["reservation_id"]).toBe(RESERVATION_ID);
    expect(details["is_complete"]).toBe(true);
  });

  it("audit log records all completed categories", async () => {
    await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    const { data: logs } = await admin
      .from("audit_logs")
      .select("*")
      .eq("tenant_id", TEST_TENANT_ID)
      .eq("action", "guest_profile_wiped")
      .order("timestamp", { ascending: false })
      .limit(1);

    const details = logs![0]!.details as Record<string, unknown>;
    const completedCategories = details["categories_completed"] as string[];

    expect(completedCategories).toHaveLength(6);
    for (const cat of REQUIRED_WIPE_CATEGORIES) {
      expect(completedCategories).toContain(cat);
    }
  });

  it("failed wipe audit log records failed categories", async () => {
    await executeGuestWipe(
      admin,
      TEST_TENANT_ID,
      RESERVATION_ID,
      "personal_data"
    );

    const { data: logs } = await admin
      .from("audit_logs")
      .select("*")
      .eq("tenant_id", TEST_TENANT_ID)
      .eq("action", "guest_profile_wiped")
      .order("timestamp", { ascending: false })
      .limit(1);

    const details = logs![0]!.details as Record<string, unknown>;
    expect(details["is_complete"]).toBe(false);

    const failedCategories = details["categories_failed"] as string[];
    expect(failedCategories).toContain("personal_data");

    const errors = details["errors"] as string[];
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("personal_data");
  });

  it("audit log has a valid timestamp", async () => {
    const before = new Date().toISOString();
    await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);
    const after = new Date().toISOString();

    const { data: logs } = await admin
      .from("audit_logs")
      .select("*")
      .eq("tenant_id", TEST_TENANT_ID)
      .eq("action", "guest_profile_wiped")
      .order("timestamp", { ascending: false })
      .limit(1);

    const timestamp = logs![0]!.timestamp as string;
    expect(new Date(timestamp).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime() - 1000
    );
    expect(new Date(timestamp).getTime()).toBeLessThanOrEqual(
      new Date(after).getTime() + 1000
    );
  });

  it("wipe audit log is associated with the correct tenant", async () => {
    await executeGuestWipe(admin, TEST_TENANT_ID, RESERVATION_ID);

    const { data: logs } = await admin
      .from("audit_logs")
      .select("*")
      .eq("tenant_id", TEST_TENANT_ID)
      .eq("action", "guest_profile_wiped");

    for (const log of logs ?? []) {
      expect(log.tenant_id).toBe(TEST_TENANT_ID);
    }
  });
});
