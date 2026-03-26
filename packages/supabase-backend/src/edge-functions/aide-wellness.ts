/**
 * CleverHub — CleverAide Wellness Edge Function
 *
 * CRUD endpoints for wellness check-ins, medication management, and
 * caregiver dashboard data.
 *
 * Endpoints:
 *   POST   /functions/v1/aide-wellness/checkin          — Record a wellness check-in
 *   GET    /functions/v1/aide-wellness/checkins?pid=<id> — Get check-in history
 *   POST   /functions/v1/aide-wellness/medication/log   — Log medication taken/skipped/missed
 *   GET    /functions/v1/aide-wellness/medications?pid=<id> — Get medication schedule & adherence
 *   GET    /functions/v1/aide-wellness/activity?pid=<id>    — Get activity log
 *   GET    /functions/v1/aide-wellness/dashboard?pid=<id>   — Aggregated caregiver dashboard
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Admin/caregiver can access all aide data within tenant
 *   - Assisted living user can read their own data
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Edge Function handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("UNAUTHORIZED", "Missing Authorization header", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonError("SERVER_ERROR", "Missing Supabase config", 500);
    }

    const userToken = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser(userToken);
    if (authError || !user) {
      return jsonError("UNAUTHORIZED", "Invalid JWT", 401);
    }

    const tenantId = extractClaim(user, "tenant_id");
    if (!tenantId) {
      return jsonError("FORBIDDEN", "No tenant_id in JWT", 403);
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/functions/v1/aide-wellness", "");
    const aideProfileId = url.searchParams.get("pid");

    // Route
    if (req.method === "POST" && path === "/checkin") {
      const body = await req.json();
      return handleRecordCheckin(userClient, tenantId, body);
    }

    if (req.method === "GET" && path === "/checkins" && aideProfileId) {
      const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
      return handleGetCheckins(userClient, aideProfileId, limit);
    }

    if (req.method === "POST" && path === "/medication/log") {
      const body = await req.json();
      return handleLogMedication(userClient, tenantId, body);
    }

    if (req.method === "GET" && path === "/medications" && aideProfileId) {
      return handleGetMedications(userClient, aideProfileId);
    }

    if (req.method === "GET" && path === "/activity" && aideProfileId) {
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
      return handleGetActivity(userClient, aideProfileId, limit);
    }

    if (req.method === "GET" && path === "/dashboard" && aideProfileId) {
      return handleGetDashboard(userClient, aideProfileId);
    }

    return jsonError("NOT_FOUND", "Unknown endpoint", 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError("SERVER_ERROR", message, 500);
  }
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleRecordCheckin(
  client: ReturnType<typeof createClient>,
  tenantId: string,
  body: {
    aide_profile_id: string;
    checkin_type: string;
    status: string;
    mood_rating?: number;
    pain_level?: number;
    notes?: string;
    response_transcript?: string;
    flagged_for_review?: boolean;
  },
): Promise<Response> {
  const { data, error } = await client
    .from("aide_wellness_checkins")
    .insert({
      tenant_id: tenantId,
      aide_profile_id: body.aide_profile_id,
      checkin_type: body.checkin_type,
      status: body.status,
      mood_rating: body.mood_rating ?? null,
      pain_level: body.pain_level ?? null,
      notes: body.notes ?? null,
      response_transcript: body.response_transcript ?? null,
      flagged_for_review: body.flagged_for_review ?? false,
    })
    .select()
    .single();

  if (error) return jsonError("DB_ERROR", error.message, 500);
  return jsonSuccess(data, 201);
}

async function handleGetCheckins(
  client: ReturnType<typeof createClient>,
  aideProfileId: string,
  limit: number,
): Promise<Response> {
  const { data, error } = await client
    .from("aide_wellness_checkins")
    .select("*")
    .eq("aide_profile_id", aideProfileId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return jsonError("DB_ERROR", error.message, 500);
  return jsonSuccess(data);
}

async function handleLogMedication(
  client: ReturnType<typeof createClient>,
  tenantId: string,
  body: {
    medication_id: string;
    aide_profile_id: string;
    scheduled_at: string;
    status: string;
    confirmed_via?: string;
    notes?: string;
  },
): Promise<Response> {
  const insertData: Record<string, unknown> = {
    tenant_id: tenantId,
    medication_id: body.medication_id,
    aide_profile_id: body.aide_profile_id,
    scheduled_at: body.scheduled_at,
    status: body.status,
    notes: body.notes ?? null,
  };

  if (body.status === "taken" || body.status === "skipped") {
    insertData.confirmed_via = body.confirmed_via ?? "app";
    insertData.confirmed_at = new Date().toISOString();
  }

  const { data, error } = await client
    .from("aide_medication_logs")
    .insert(insertData)
    .select()
    .single();

  if (error) return jsonError("DB_ERROR", error.message, 500);
  return jsonSuccess(data, 201);
}

async function handleGetMedications(
  client: ReturnType<typeof createClient>,
  aideProfileId: string,
): Promise<Response> {
  // Get active medications
  const { data: meds, error: medsError } = await client
    .from("aide_medications")
    .select("*")
    .eq("aide_profile_id", aideProfileId)
    .eq("is_active", true)
    .order("medication_name");

  if (medsError) return jsonError("DB_ERROR", medsError.message, 500);

  // Get recent logs for adherence calculation (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: logs, error: logsError } = await client
    .from("aide_medication_logs")
    .select("medication_id, status")
    .eq("aide_profile_id", aideProfileId)
    .gte("scheduled_at", sevenDaysAgo);

  if (logsError) return jsonError("DB_ERROR", logsError.message, 500);

  // Calculate adherence per medication
  const adherence: Record<string, { taken: number; total: number }> = {};
  for (const log of logs ?? []) {
    const medId = log.medication_id as string;
    if (!adherence[medId]) adherence[medId] = { taken: 0, total: 0 };
    adherence[medId].total++;
    if (log.status === "taken") adherence[medId].taken++;
  }

  const result = (meds ?? []).map((med) => ({
    ...med,
    adherence_7d: adherence[med.id]
      ? Math.round((adherence[med.id].taken / adherence[med.id].total) * 100)
      : null,
  }));

  return jsonSuccess(result);
}

async function handleGetActivity(
  client: ReturnType<typeof createClient>,
  aideProfileId: string,
  limit: number,
): Promise<Response> {
  const { data, error } = await client
    .from("aide_activity_log")
    .select("*")
    .eq("aide_profile_id", aideProfileId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return jsonError("DB_ERROR", error.message, 500);
  return jsonSuccess(data);
}

async function handleGetDashboard(
  client: ReturnType<typeof createClient>,
  aideProfileId: string,
): Promise<Response> {
  // Fetch multiple data points in parallel for the caregiver dashboard
  const [
    profileResult,
    lastActivityResult,
    lastCheckinResult,
    activeAlertsResult,
    todayMedLogsResult,
    activeMedsResult,
  ] = await Promise.all([
    client
      .from("aide_profiles")
      .select("*, family_member_profiles!inner(agent_name, user_id)")
      .eq("id", aideProfileId)
      .single(),
    client
      .from("aide_activity_log")
      .select("event_type, room, created_at")
      .eq("aide_profile_id", aideProfileId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    client
      .from("aide_wellness_checkins")
      .select("checkin_type, status, mood_rating, pain_level, created_at")
      .eq("aide_profile_id", aideProfileId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    client
      .from("aide_caregiver_alerts")
      .select("id, alert_type, severity, message, created_at")
      .eq("aide_profile_id", aideProfileId)
      .eq("acknowledged", false)
      .order("created_at", { ascending: false }),
    client
      .from("aide_medication_logs")
      .select("medication_id, status, confirmed_via")
      .eq("aide_profile_id", aideProfileId)
      .gte("scheduled_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    client
      .from("aide_medications")
      .select("id")
      .eq("aide_profile_id", aideProfileId)
      .eq("is_active", true),
  ]);

  // Calculate today's medication adherence
  const totalMeds = activeMedsResult.data?.length ?? 0;
  const todayLogs = todayMedLogsResult.data ?? [];
  const takenToday = todayLogs.filter((l) => l.status === "taken").length;

  const dashboard = {
    profile: profileResult.data,
    last_activity: lastActivityResult.data,
    last_checkin: lastCheckinResult.data,
    active_alerts: activeAlertsResult.data ?? [],
    active_alert_count: activeAlertsResult.data?.length ?? 0,
    medication_adherence_today: totalMeds > 0
      ? Math.round((takenToday / totalMeds) * 100)
      : null,
    medications_due_today: totalMeds,
    medications_taken_today: takenToday,
  };

  return jsonSuccess(dashboard);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractClaim(user: { app_metadata?: Record<string, unknown> }, key: string): string | null {
  return (user.app_metadata?.[key] as string) ?? null;
}

function jsonSuccess(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ success: true, data }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function jsonError(code: string, message: string, status: number): Response {
  return new Response(
    JSON.stringify({ success: false, error: { code, message } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}
