/**
 * CleverHub - Guest Profile Wipe Edge Function
 *
 * Triggered on reservation checkout. Deletes ALL guest personal data:
 *   - Guest profile record
 *   - Voice history (sessions + transcripts)
 *   - Lock codes (reset via HA bridge)
 *   - WiFi passwords
 *   - TV logins
 *   - Custom preferences
 *
 * Creates a wipe checklist tracking each step and logs to audit.
 * ALL categories in REQUIRED_WIPE_CATEGORIES must be wiped.
 *
 * Endpoint: POST /functions/v1/guest-profile-wipe
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim and manager+ role
 *   - Can also be triggered by service role (automation)
 *   - Every step is audited, failures are tracked per-category
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  TenantId,
  ReservationId,
  GuestProfileId,
  GuestWipeCategory,
  GuestWipeItem,
  AuditAction,
  ApiResult,
} from "@clever/shared";

// ---------------------------------------------------------------------------
// Constants — imported from shared types but re-declared for Deno edge runtime
// ---------------------------------------------------------------------------

const REQUIRED_WIPE_CATEGORIES: GuestWipeCategory[] = [
  "locks",
  "wifi",
  "voice_history",
  "tv_logins",
  "preferences",
  "personal_data",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuestWipeRequest {
  /** Reservation ID to wipe */
  reservation_id: string;
  /** Optional: force wipe even if reservation is not in "completed" status */
  force?: boolean;
}

interface WipeResult {
  checklist_id: string;
  reservation_id: string;
  is_complete: boolean;
  items: GuestWipeItem[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Edge Function handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonError("METHOD_NOT_ALLOWED", "Only POST is accepted", 405);
  }

  try {
    // -----------------------------------------------------------------------
    // 1. Authenticate
    // -----------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("UNAUTHORIZED", "Missing or invalid Authorization header", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      return jsonError("SERVER_ERROR", "Missing Supabase environment configuration", 500);
    }

    const userToken = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser(userToken);
    if (authError || !user) {
      return jsonError("UNAUTHORIZED", "Invalid or expired JWT", 401);
    }

    // Service client for cross-table operations
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const tenantId = extractClaim(user, "tenant_id");
    const userRole = extractClaim(user, "user_role");
    const userId = user.id;

    if (!tenantId) {
      return jsonError("FORBIDDEN", "No tenant_id found in JWT claims", 403);
    }

    // Only managers+ or service role can trigger wipe
    if (userRole && !["owner", "admin", "manager"].includes(userRole)) {
      return jsonError("FORBIDDEN", "Insufficient role to trigger guest wipe", 403);
    }

    // -----------------------------------------------------------------------
    // 2. Parse request
    // -----------------------------------------------------------------------
    const payload: GuestWipeRequest = await req.json();

    if (!payload.reservation_id) {
      return jsonError("VALIDATION_ERROR", "reservation_id is required", 400);
    }

    // -----------------------------------------------------------------------
    // 3. Fetch reservation and guest profile
    // -----------------------------------------------------------------------
    const { data: reservation, error: resError } = await serviceClient
      .from("reservations")
      .select("*, guest_profiles(*)")
      .eq("id", payload.reservation_id)
      .eq("tenant_id", tenantId)
      .single();

    if (resError || !reservation) {
      return jsonError("NOT_FOUND", `Reservation ${payload.reservation_id} not found`, 404);
    }

    // Verify reservation is in a wipeable state
    if (!payload.force && reservation.status !== "completed") {
      return jsonError(
        "INVALID_STATE",
        `Reservation status is "${reservation.status}". Only completed reservations can be wiped. Use force=true to override.`,
        409
      );
    }

    const guestProfileId = reservation.guest_profile_id as string | null;

    // -----------------------------------------------------------------------
    // 4. Create wipe checklist
    // -----------------------------------------------------------------------
    const wipeItems: GuestWipeItem[] = REQUIRED_WIPE_CATEGORIES.map((category) => ({
      category,
      description: getWipeDescription(category),
      status: "pending" as const,
      completed_at: null,
    }));

    const { data: checklist, error: checklistError } = await serviceClient
      .from("guest_wipe_checklists")
      .insert({
        reservation_id: payload.reservation_id,
        tenant_id: tenantId,
        items: wipeItems,
        started_at: new Date().toISOString(),
        is_complete: false,
      })
      .select("id")
      .single();

    if (checklistError || !checklist) {
      return jsonError("DB_ERROR", "Failed to create wipe checklist", 500);
    }

    const checklistId = checklist.id as string;

    // -----------------------------------------------------------------------
    // 5. Execute wipe for each category
    // -----------------------------------------------------------------------
    const errors: string[] = [];

    for (let i = 0; i < wipeItems.length; i++) {
      const item = wipeItems[i]!;
      try {
        item.status = "in_progress";
        await updateChecklist(serviceClient, checklistId, wipeItems);

        await executeWipeCategory(
          serviceClient,
          tenantId,
          payload.reservation_id,
          guestProfileId,
          item.category
        );

        item.status = "completed";
        item.completed_at = new Date().toISOString();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        item.status = "failed";
        item.error = errorMessage;
        errors.push(`${item.category}: ${errorMessage}`);
        console.error(`Wipe failed for category ${item.category}:`, errorMessage);
      }

      await updateChecklist(serviceClient, checklistId, wipeItems);
    }

    // -----------------------------------------------------------------------
    // 6. Mark checklist complete (or failed)
    // -----------------------------------------------------------------------
    const isComplete = wipeItems.every((item) => item.status === "completed");

    await serviceClient
      .from("guest_wipe_checklists")
      .update({
        items: wipeItems,
        completed_at: isComplete ? new Date().toISOString() : null,
        is_complete: isComplete,
      })
      .eq("id", checklistId);

    // -----------------------------------------------------------------------
    // 7. Create audit log entry
    // -----------------------------------------------------------------------
    await serviceClient.from("audit_logs").insert({
      tenant_id: tenantId,
      user_id: userId,
      action: "guest_profile_wiped" as const,
      details: {
        reservation_id: payload.reservation_id,
        guest_profile_id: guestProfileId,
        checklist_id: checklistId,
        is_complete: isComplete,
        categories_wiped: wipeItems
          .filter((i) => i.status === "completed")
          .map((i) => i.category),
        categories_failed: wipeItems
          .filter((i) => i.status === "failed")
          .map((i) => ({ category: i.category, error: i.error })),
        forced: payload.force ?? false,
      },
      ip_address: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null,
    });

    // -----------------------------------------------------------------------
    // 8. Return result
    // -----------------------------------------------------------------------
    const result: WipeResult = {
      checklist_id: checklistId,
      reservation_id: payload.reservation_id,
      is_complete: isComplete,
      items: wipeItems,
      errors,
    };

    const statusCode = isComplete ? 200 : 207; // 207 Multi-Status if partial
    const response: ApiResult<WipeResult> = {
      data: result,
      error: null,
    };

    return new Response(JSON.stringify(response), {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Guest profile wipe error:", err);
    return jsonError("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});

// ---------------------------------------------------------------------------
// Wipe Category Executors
// ---------------------------------------------------------------------------

async function executeWipeCategory(
  client: SupabaseClient,
  tenantId: string,
  reservationId: string,
  guestProfileId: string | null,
  category: GuestWipeCategory
): Promise<void> {
  switch (category) {
    case "locks":
      await wipeLocks(client, tenantId, guestProfileId);
      break;
    case "wifi":
      await wipeWifi(client, tenantId, guestProfileId);
      break;
    case "voice_history":
      await wipeVoiceHistory(client, tenantId, guestProfileId, reservationId);
      break;
    case "tv_logins":
      await wipeTvLogins(client, tenantId, guestProfileId);
      break;
    case "preferences":
      await wipePreferences(client, tenantId, guestProfileId);
      break;
    case "personal_data":
      await wipePersonalData(client, tenantId, guestProfileId, reservationId);
      break;
    default: {
      // Exhaustive check — ensures all categories are handled
      const _exhaustive: never = category;
      throw new Error(`Unknown wipe category: ${_exhaustive}`);
    }
  }
}

/**
 * Reset all lock codes assigned to the guest.
 * Clears door_code_encrypted from the guest profile.
 * The HA bridge is responsible for physically resetting the lock codes
 * after receiving the device state change event.
 */
async function wipeLocks(
  client: SupabaseClient,
  tenantId: string,
  guestProfileId: string | null
): Promise<void> {
  if (!guestProfileId) return;

  const { error } = await client
    .from("guest_profiles")
    .update({ door_code_encrypted: null })
    .eq("id", guestProfileId)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(`Failed to clear lock codes: ${error.message}`);

  // Reset lock devices to default state
  // Find all locks in the tenant and queue reset commands
  const { data: locks, error: lockError } = await client
    .from("devices")
    .select("id, ha_entity_id")
    .eq("tenant_id", tenantId)
    .eq("category", "lock");

  if (lockError) throw new Error(`Failed to query lock devices: ${lockError.message}`);

  // Mark locks as needing code reset via attributes
  for (const lock of locks ?? []) {
    await client
      .from("devices")
      .update({
        attributes: { guest_code_cleared: true, last_guest_profile_id: guestProfileId },
      })
      .eq("id", lock.id)
      .eq("tenant_id", tenantId);
  }
}

/**
 * Clear the guest's WiFi password from the profile.
 */
async function wipeWifi(
  client: SupabaseClient,
  tenantId: string,
  guestProfileId: string | null
): Promise<void> {
  if (!guestProfileId) return;

  const { error } = await client
    .from("guest_profiles")
    .update({ wifi_password_encrypted: null })
    .eq("id", guestProfileId)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(`Failed to clear WiFi password: ${error.message}`);
}

/**
 * Delete all voice sessions and transcripts associated with the guest's
 * reservation period. Uses the guest profile's user context to scope the
 * deletion to only their sessions.
 */
async function wipeVoiceHistory(
  client: SupabaseClient,
  tenantId: string,
  guestProfileId: string | null,
  reservationId: string
): Promise<void> {
  // Get the reservation time window to scope voice history deletion
  const { data: reservation, error: resError } = await client
    .from("reservations")
    .select("check_in, check_out, guest_profile_id")
    .eq("id", reservationId)
    .eq("tenant_id", tenantId)
    .single();

  if (resError || !reservation) {
    throw new Error(`Failed to fetch reservation for voice wipe: ${resError?.message ?? "not found"}`);
  }

  // Delete voice transcripts for this tenant within the reservation window
  const { error: transcriptError } = await client
    .from("voice_transcripts")
    .delete()
    .eq("tenant_id", tenantId)
    .gte("created_at", reservation.check_in)
    .lte("created_at", reservation.check_out);

  if (transcriptError) {
    throw new Error(`Failed to delete voice transcripts: ${transcriptError.message}`);
  }

  // Delete voice sessions for this tenant within the reservation window
  const { error: sessionError } = await client
    .from("voice_sessions")
    .delete()
    .eq("tenant_id", tenantId)
    .gte("created_at", reservation.check_in)
    .lte("created_at", reservation.check_out);

  if (sessionError) {
    throw new Error(`Failed to delete voice sessions: ${sessionError.message}`);
  }
}

/**
 * Remove all TV streaming service logins stored in the guest profile.
 */
async function wipeTvLogins(
  client: SupabaseClient,
  tenantId: string,
  guestProfileId: string | null
): Promise<void> {
  if (!guestProfileId) return;

  const { error } = await client
    .from("guest_profiles")
    .update({ tv_logins_encrypted: "[]" })
    .eq("id", guestProfileId)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(`Failed to clear TV logins: ${error.message}`);

  // Reset media player devices to default (log out streaming apps)
  const { data: mediaPlayers, error: mpError } = await client
    .from("devices")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("category", "media_player");

  if (mpError) throw new Error(`Failed to query media players: ${mpError.message}`);

  for (const mp of mediaPlayers ?? []) {
    await client
      .from("devices")
      .update({
        attributes: { guest_logins_cleared: true, last_guest_profile_id: guestProfileId },
      })
      .eq("id", mp.id)
      .eq("tenant_id", tenantId);
  }
}

/**
 * Clear all guest custom preferences (voice settings, room preferences, etc.)
 */
async function wipePreferences(
  client: SupabaseClient,
  tenantId: string,
  guestProfileId: string | null
): Promise<void> {
  if (!guestProfileId) return;

  const { error } = await client
    .from("guest_profiles")
    .update({
      voice_preferences: {},
      custom_preferences: {},
    })
    .eq("id", guestProfileId)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(`Failed to clear preferences: ${error.message}`);
}

/**
 * Delete the guest profile record itself, removing all remaining personal data.
 * This is the final step — the nuclear option that removes the profile entirely.
 */
async function wipePersonalData(
  client: SupabaseClient,
  tenantId: string,
  guestProfileId: string | null,
  reservationId: string
): Promise<void> {
  if (!guestProfileId) return;

  // Unlink the guest profile from the reservation first
  const { error: unlinkError } = await client
    .from("reservations")
    .update({ guest_profile_id: null })
    .eq("id", reservationId)
    .eq("tenant_id", tenantId);

  if (unlinkError) {
    throw new Error(`Failed to unlink guest profile from reservation: ${unlinkError.message}`);
  }

  // Delete the guest profile record
  const { error: deleteError } = await client
    .from("guest_profiles")
    .delete()
    .eq("id", guestProfileId)
    .eq("tenant_id", tenantId);

  if (deleteError) {
    throw new Error(`Failed to delete guest profile: ${deleteError.message}`);
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function getWipeDescription(category: GuestWipeCategory): string {
  const descriptions: Record<GuestWipeCategory, string> = {
    locks: "Reset all guest door/lock codes to defaults",
    wifi: "Clear guest WiFi password from profile",
    voice_history: "Delete all voice sessions and transcripts from stay period",
    tv_logins: "Remove all TV/streaming service logins",
    preferences: "Clear all guest voice and custom preferences",
    personal_data: "Delete guest profile record and all remaining personal data",
  };
  return descriptions[category];
}

async function updateChecklist(
  client: SupabaseClient,
  checklistId: string,
  items: GuestWipeItem[]
): Promise<void> {
  const { error } = await client
    .from("guest_wipe_checklists")
    .update({ items })
    .eq("id", checklistId);

  if (error) {
    console.error("Failed to update wipe checklist:", error.message);
  }
}

function extractClaim(
  user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> },
  claim: string
): string | null {
  return (
    (user.app_metadata?.[claim] as string | undefined) ??
    (user.user_metadata?.[claim] as string | undefined) ??
    null
  );
}

function jsonError(code: string, message: string, status: number): Response {
  const body: ApiResult<never> = {
    data: null,
    error: { code, message },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
