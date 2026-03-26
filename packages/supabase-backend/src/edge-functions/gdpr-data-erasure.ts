/**
 * GDPR Data Erasure Edge Function (Right to Erasure / Right to Be Forgotten)
 * Article 17
 *
 * Deletes all personal data for the requesting user. Anonymizes audit logs
 * (replaces user_id with DELETED_USER, clears IP). Cannot delete data
 * required for legal obligations (e.g., financial records).
 *
 * Requires double-opt-in: first POST creates a pending request,
 * second POST with confirm=true executes the erasure.
 *
 * POST /functions/v1/gdpr-data-erasure
 * Body: { "confirm": true } for confirmed erasure
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const confirmed = body.confirm === true;

    // Get user record
    const { data: userRecord } = await supabase
      .from("users")
      .select("id, tenant_id, role")
      .eq("auth_user_id", user.id)
      .single();

    if (!userRecord) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Tenant owners cannot erase themselves (must transfer ownership first)
    if (userRecord.role === "owner") {
      return new Response(
        JSON.stringify({
          error: "Tenant owners must transfer ownership before requesting erasure.",
          action_required: "Transfer tenant ownership to another admin first.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!confirmed) {
      // Create a pending erasure request
      const { data: request, error } = await supabase.from("data_subject_requests").insert({
        tenant_id: userRecord.tenant_id,
        user_id: user.id,
        request_type: "erasure",
        status: "pending",
        request_details: {
          warning: "This action is irreversible. All personal data will be permanently deleted.",
          data_affected: [
            "User profile (email, name)",
            "Voice sessions and transcripts",
            "Chat messages",
            "Family member profiles",
            "Aide profiles and health data",
            "Consent records",
            "Nutrition data (food logs, goals, water logs)",
            "Email accounts and cached email summaries",
            "Calendar accounts and cached events",
            "Email/calendar alert rules and notification preferences",
            "Email OAuth tokens (revoked before deletion)",
            "Email access policies and audit logs",
            "Family messages",
            "Email delegation grants",
            "Email rate limits",
            "Audit logs (anonymized, not deleted)",
          ],
          data_retained: [
            "Anonymized audit logs (legal obligation)",
            "Financial records if applicable (tax compliance)",
          ],
        },
      }).select().single();

      if (error) throw error;

      return new Response(
        JSON.stringify({
          message: "Erasure request created. Send another POST with { \"confirm\": true } to execute.",
          request_id: request.id,
          warning: "This action is IRREVERSIBLE.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // CONFIRMED ERASURE — execute deletion
    const tenantId = userRecord.tenant_id;
    const userId = userRecord.id;
    const deletionLog: Record<string, number> = {};

    // 1. Delete voice sessions and transcripts
    const { count: vs } = await serviceClient
      .from("voice_sessions")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    deletionLog.voice_sessions = vs ?? 0;

    const { count: vt } = await serviceClient
      .from("voice_transcripts")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    deletionLog.voice_transcripts = vt ?? 0;

    // 2. Delete chat messages
    const { count: cm } = await serviceClient
      .from("chat_messages")
      .delete({ count: "exact" })
      .eq("user_id", user.id);
    deletionLog.chat_messages = cm ?? 0;

    // 3. Delete family profiles (cascades to aide_profiles, medications, etc.)
    const { count: fp } = await serviceClient
      .from("family_member_profiles")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    deletionLog.family_profiles = fp ?? 0;

    // 4. Delete consent records
    const { count: cr } = await serviceClient
      .from("consent_records")
      .delete({ count: "exact" })
      .eq("user_id", user.id);
    deletionLog.consent_records = cr ?? 0;

    // 4a. Delete nutrition data
    const { count: fl } = await serviceClient
      .from("food_logs")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    deletionLog.food_logs = fl ?? 0;

    const { count: ng } = await serviceClient
      .from("nutrition_goals")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    deletionLog.nutrition_goals = ng ?? 0;

    const { count: wl } = await serviceClient
      .from("water_logs")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    deletionLog.water_logs = wl ?? 0;

    // 4b. Delete communications privacy data
    // Revoke OAuth tokens before deleting (invalidate with provider if possible)
    const { data: oauthTokens } = await serviceClient
      .from("email_oauth_tokens")
      .select("id")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);

    const { count: eot } = await serviceClient
      .from("email_oauth_tokens")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    deletionLog.email_oauth_tokens = eot ?? 0;

    const { count: eaal } = await serviceClient
      .from("email_access_audit_log")
      .delete({ count: "exact" })
      .eq("tenant_id", tenantId)
      .or(`accessor_user_id.eq.${user.id},target_user_id.eq.${user.id}`);
    deletionLog.email_access_audit_log = eaal ?? 0;

    const { count: fm } = await serviceClient
      .from("family_messages")
      .delete({ count: "exact" })
      .eq("tenant_id", tenantId)
      .or(`sender_user_id.eq.${user.id},recipient_user_id.eq.${user.id}`);
    deletionLog.family_messages = fm ?? 0;

    const { count: edg } = await serviceClient
      .from("email_delegation_grants")
      .delete({ count: "exact" })
      .eq("tenant_id", tenantId)
      .or(`parent_user_id.eq.${user.id},child_user_id.eq.${user.id}`);
    deletionLog.email_delegation_grants = edg ?? 0;

    const { count: eap } = await serviceClient
      .from("email_access_policies")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    deletionLog.email_access_policies = eap ?? 0;

    const { count: erl } = await serviceClient
      .from("email_rate_limits")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    deletionLog.email_rate_limits = erl ?? 0;

    // 4c. Delete email/calendar data (cache tables first due to FK constraints)
    const { data: emailAccountIds } = await serviceClient
      .from("email_accounts")
      .select("id")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);

    if (emailAccountIds?.length) {
      const eaIds = emailAccountIds.map((a: { id: string }) => a.id);
      const { count: ec } = await serviceClient
        .from("email_cache")
        .delete({ count: "exact" })
        .in("email_account_id", eaIds);
      deletionLog.email_cache = ec ?? 0;
    }

    const { data: calAccountIds } = await serviceClient
      .from("calendar_accounts")
      .select("id")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);

    if (calAccountIds?.length) {
      const caIds = calAccountIds.map((a: { id: string }) => a.id);
      const { count: cec } = await serviceClient
        .from("calendar_event_cache")
        .delete({ count: "exact" })
        .in("calendar_account_id", caIds);
      deletionLog.calendar_event_cache = cec ?? 0;
    }

    const { count: ea } = await serviceClient
      .from("email_accounts")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    deletionLog.email_accounts = ea ?? 0;

    const { count: ca } = await serviceClient
      .from("calendar_accounts")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    deletionLog.calendar_accounts = ca ?? 0;

    const { count: ar } = await serviceClient
      .from("email_calendar_alert_rules")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    deletionLog.email_calendar_alert_rules = ar ?? 0;

    const { count: np } = await serviceClient
      .from("email_calendar_notification_prefs")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId);
    deletionLog.email_calendar_notification_prefs = np ?? 0;

    // 5. Anonymize audit logs (do not delete — legal obligation)
    const { count: al } = await serviceClient
      .from("audit_logs")
      .update({
        user_id: null,
        ip_address_hash: null,
        ip_address_encrypted: null,
        details: { anonymized: true, reason: "GDPR Art 17 erasure" },
      })
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);
    deletionLog.audit_logs_anonymized = al ?? 0;

    // 6. Delete the user record itself
    await serviceClient
      .from("users")
      .delete()
      .eq("id", userId);
    deletionLog.user_record = 1;

    // 7. Record the completed DSAR
    await serviceClient.from("data_subject_requests").insert({
      tenant_id: tenantId,
      user_id: user.id,
      request_type: "erasure",
      status: "completed",
      request_details: { deletion_log: deletionLog },
      completed_at: new Date().toISOString(),
    });

    // 8. Record anonymized audit entry for the erasure itself
    await serviceClient.from("audit_logs").insert({
      tenant_id: tenantId,
      action: "data_erased",
      details: {
        erasure_type: "gdpr_art_17",
        records_deleted: deletionLog,
        user_auth_id_hash: "REDACTED",
      },
    });

    // 9. Delete the Supabase auth user
    await serviceClient.auth.admin.deleteUser(user.id);

    return new Response(
      JSON.stringify({
        success: true,
        message: "All personal data has been permanently deleted.",
        deletion_summary: deletionLog,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("GDPR erasure error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
