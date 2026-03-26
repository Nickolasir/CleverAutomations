/**
 * CleverHub — CleverAide Alerts Edge Function
 *
 * Alert creation, acknowledgment, and escalation for caregiver notifications.
 *
 * Endpoints:
 *   POST   /functions/v1/aide-alerts                  — Create a new alert
 *   GET    /functions/v1/aide-alerts?pid=<id>          — List alerts for an aide profile
 *   PATCH  /functions/v1/aide-alerts?id=<id>           — Acknowledge an alert
 *   POST   /functions/v1/aide-alerts/escalate          — Escalate unacknowledged alerts
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Admin/caregiver can manage alerts
 */

import { createClient } from "@supabase/supabase-js";

// Escalation timeouts in minutes
const ESCALATION_TIMEOUTS: Record<string, number> = {
  info: 0,
  warning: 30,
  urgent: 10,
  critical: 5,
};

const SEVERITY_ESCALATION: Record<string, string> = {
  info: "warning",
  warning: "urgent",
  urgent: "critical",
  critical: "critical",
};

// ---------------------------------------------------------------------------
// Edge Function handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("UNAUTHORIZED", "Missing Authorization header", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonError("SERVER_ERROR", "Missing Supabase config", 500);
    }

    const userToken = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    // Service client for escalation (bypasses RLS)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await userClient.auth.getUser(userToken);
    if (authError || !user) {
      return jsonError("UNAUTHORIZED", "Invalid JWT", 401);
    }

    const tenantId = extractClaim(user, "tenant_id");
    if (!tenantId) {
      return jsonError("FORBIDDEN", "No tenant_id in JWT", 403);
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/functions/v1/aide-alerts", "");

    // POST /aide-alerts — Create alert
    if (req.method === "POST" && (path === "" || path === "/")) {
      const body = await req.json();
      return handleCreateAlert(userClient, tenantId, body);
    }

    // GET /aide-alerts?pid=<id> — List alerts
    if (req.method === "GET" && (path === "" || path === "/")) {
      const aideProfileId = url.searchParams.get("pid");
      if (!aideProfileId) {
        return jsonError("BAD_REQUEST", "Missing pid parameter", 400);
      }
      const unackedOnly = url.searchParams.get("unacked") === "true";
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
      return handleListAlerts(userClient, aideProfileId, unackedOnly, limit);
    }

    // PATCH /aide-alerts?id=<id> — Acknowledge
    if (req.method === "PATCH" && (path === "" || path === "/")) {
      const alertId = url.searchParams.get("id");
      if (!alertId) {
        return jsonError("BAD_REQUEST", "Missing id parameter", 400);
      }
      return handleAcknowledgeAlert(userClient, alertId, user.id);
    }

    // POST /aide-alerts/escalate — Escalate overdue alerts
    if (req.method === "POST" && path === "/escalate") {
      return handleEscalateAlerts(serviceClient, tenantId);
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

async function handleCreateAlert(
  client: ReturnType<typeof createClient>,
  tenantId: string,
  body: {
    aide_profile_id: string;
    alert_type: string;
    severity: string;
    message: string;
    details?: Record<string, unknown>;
    delivery_channels?: string[];
  },
): Promise<Response> {
  const { data, error } = await client
    .from("aide_caregiver_alerts")
    .insert({
      tenant_id: tenantId,
      aide_profile_id: body.aide_profile_id,
      alert_type: body.alert_type,
      severity: body.severity,
      message: body.message,
      details: body.details ?? {},
      delivery_channels: body.delivery_channels ?? ["push"],
    })
    .select()
    .single();

  if (error) return jsonError("DB_ERROR", error.message, 500);
  return jsonSuccess(data, 201);
}

async function handleListAlerts(
  client: ReturnType<typeof createClient>,
  aideProfileId: string,
  unackedOnly: boolean,
  limit: number,
): Promise<Response> {
  let query = client
    .from("aide_caregiver_alerts")
    .select("*")
    .eq("aide_profile_id", aideProfileId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unackedOnly) {
    query = query.eq("acknowledged", false);
  }

  const { data, error } = await query;

  if (error) return jsonError("DB_ERROR", error.message, 500);
  return jsonSuccess(data);
}

async function handleAcknowledgeAlert(
  client: ReturnType<typeof createClient>,
  alertId: string,
  userId: string,
): Promise<Response> {
  const { data, error } = await client
    .from("aide_caregiver_alerts")
    .update({
      acknowledged: true,
      acknowledged_by: userId,
      acknowledged_at: new Date().toISOString(),
    })
    .eq("id", alertId)
    .select()
    .single();

  if (error) return jsonError("DB_ERROR", error.message, 500);
  return jsonSuccess(data);
}

async function handleEscalateAlerts(
  serviceClient: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<Response> {
  // Find unacknowledged, non-escalated alerts that have exceeded their timeout
  const { data: alerts, error } = await serviceClient
    .from("aide_caregiver_alerts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("acknowledged", false)
    .eq("escalated", false)
    .neq("severity", "info"); // info alerts don't escalate

  if (error) return jsonError("DB_ERROR", error.message, 500);

  const now = Date.now();
  const escalated: string[] = [];

  for (const alert of alerts ?? []) {
    const timeoutMinutes = ESCALATION_TIMEOUTS[alert.severity] ?? 30;
    if (timeoutMinutes === 0) continue;

    const createdAt = new Date(alert.created_at).getTime();
    const elapsedMinutes = (now - createdAt) / (1000 * 60);

    if (elapsedMinutes >= timeoutMinutes) {
      const newSeverity = SEVERITY_ESCALATION[alert.severity] ?? alert.severity;

      await serviceClient
        .from("aide_caregiver_alerts")
        .update({
          escalated: true,
          severity: newSeverity,
        })
        .eq("id", alert.id);

      escalated.push(alert.id);
    }
  }

  return jsonSuccess({
    escalated_count: escalated.length,
    escalated_ids: escalated,
  });
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
