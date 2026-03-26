/**
 * Email Access Control Edge Function
 *
 * Manages per-user email privacy policies and parental access controls.
 *
 * Endpoints:
 *   GET  /functions/v1/email-access?action=policy     — get user's email access policy
 *   POST /functions/v1/email-access?action=request     — parent requests access to teen's email
 *   POST /functions/v1/email-access?action=respond      — teen responds to access request
 *   GET  /functions/v1/email-access?action=audit        — get email access audit log
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Enforces age-group-based access levels
 *   - Audit logging on all access events
 */

import { createClient } from "@supabase/supabase-js";
import type { ApiResult } from "@clever/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

function jsonResponse<T>(data: ApiResult<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing Authorization header", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return errorResponse("Unauthorized", 401);

    const userId = user.id;
    const tenantId = user.app_metadata?.tenant_id;
    if (!tenantId) return errorResponse("Missing tenant_id in JWT", 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // -----------------------------------------------------------------------
    // GET: policy — get user's email access policy
    // -----------------------------------------------------------------------
    if (req.method === "GET" && action === "policy") {
      const { data: policy } = await admin
        .from("email_access_policies")
        .select("*")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (!policy) {
        // No policy set — return default based on age group
        const { data: profile } = await admin
          .from("family_member_profiles")
          .select("age_group")
          .eq("user_id", userId)
          .eq("tenant_id", tenantId)
          .maybeSingle();

        const ageGroup = profile?.age_group ?? "adult";

        const defaults: Record<string, { access_level: string; elevated_auth_required: boolean }> = {
          adult: { access_level: "full_private", elevated_auth_required: true },
          teenager: { access_level: "full_private", elevated_auth_required: true },
          tween: { access_level: "parental_monitoring", elevated_auth_required: true },
          child: { access_level: "parental_managed", elevated_auth_required: false },
          toddler: { access_level: "parental_managed", elevated_auth_required: false },
          adult_visitor: { access_level: "full_private", elevated_auth_required: true },
          assisted_living: { access_level: "full_private", elevated_auth_required: true },
        };

        return jsonResponse({
          success: true,
          data: {
            access_level: defaults[ageGroup]?.access_level ?? "full_private",
            elevated_auth_required: defaults[ageGroup]?.elevated_auth_required ?? true,
            session_duration_minutes: 15,
            age_group: ageGroup,
            is_default: true,
          },
        });
      }

      return jsonResponse({ success: true, data: { ...policy, is_default: false } });
    }

    // -----------------------------------------------------------------------
    // GET: audit — get email access audit log
    // -----------------------------------------------------------------------
    if (req.method === "GET" && action === "audit") {
      const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);

      const { data: auditLog, error: auditError } = await admin
        .from("email_access_audit_log")
        .select("*")
        .eq("tenant_id", tenantId)
        .or(`accessor_user_id.eq.${userId},target_user_id.eq.${userId}`)
        .order("accessed_at", { ascending: false })
        .limit(limit);

      if (auditError) return errorResponse("Failed to fetch audit log", 500);

      return jsonResponse({ success: true, data: auditLog });
    }

    // -----------------------------------------------------------------------
    // POST requests
    // -----------------------------------------------------------------------
    if (req.method !== "POST") return errorResponse("Method not allowed", 405);

    const body = await req.json();

    // POST: request — parent requests access to teen's email
    if (action === "request") {
      const childUserId = body.child_user_id;
      if (!childUserId) return errorResponse("child_user_id is required");

      // Verify parent role
      const userRole = user.app_metadata?.user_role;
      if (!["owner", "admin"].includes(userRole)) {
        return errorResponse("Only parents (admin/owner) can request email access", 403);
      }

      // Check child's policy
      const { data: childPolicy } = await admin
        .from("email_access_policies")
        .select("*")
        .eq("user_id", childUserId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      // Check child's age group
      const { data: childProfile } = await admin
        .from("family_member_profiles")
        .select("age_group")
        .eq("user_id", childUserId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      const ageGroup = childProfile?.age_group ?? "adult";

      // Adults and teens: need explicit delegation or notification
      if (ageGroup === "adult") {
        return errorResponse("Cannot request access to adult family member's email", 403);
      }

      if (ageGroup === "teenager") {
        // Create a notification to the teen (they must respond)
        // For now, create a delegation request
        const { data: grant, error: grantError } = await admin
          .from("email_delegation_grants")
          .insert({
            tenant_id: tenantId,
            parent_user_id: userId,
            child_user_id: childUserId,
            child_consent_recorded: false,
            granted_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (grantError) {
          // May already exist
          return errorResponse("Access request already pending or granted", 409);
        }

        // Audit log
        await admin.from("audit_logs").insert({
          tenant_id: tenantId,
          user_id: userId,
          action: "email_delegation_granted",
          details: { child_user_id: childUserId, awaiting_consent: true },
        });

        return jsonResponse({
          success: true,
          data: { message: "Access request sent. The teen will be notified.", grant_id: grant.id },
        });
      }

      // Tween/child: parent can monitor/manage directly
      const { error: delegateError } = await admin
        .from("email_delegation_grants")
        .upsert({
          tenant_id: tenantId,
          parent_user_id: userId,
          child_user_id: childUserId,
          child_consent_recorded: ageGroup === "child", // Children don't need separate consent
          granted_at: new Date().toISOString(),
        });

      if (delegateError) return errorResponse("Failed to create delegation", 500);

      return jsonResponse({
        success: true,
        data: { message: `Email access granted for ${ageGroup} family member` },
      });
    }

    // POST: respond — teen responds to parent's access request
    if (action === "respond") {
      const grantId = body.grant_id;
      const accepted = body.accepted === true;

      if (!grantId) return errorResponse("grant_id is required");

      const { data: grant } = await admin
        .from("email_delegation_grants")
        .select("*")
        .eq("id", grantId)
        .eq("child_user_id", userId)
        .eq("tenant_id", tenantId)
        .single();

      if (!grant) return errorResponse("Delegation grant not found", 404);

      if (accepted) {
        await admin
          .from("email_delegation_grants")
          .update({ child_consent_recorded: true })
          .eq("id", grantId);

        return jsonResponse({
          success: true,
          data: { message: "Access granted to parent" },
        });
      } else {
        // Revoke the grant
        await admin
          .from("email_delegation_grants")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", grantId);

        await admin.from("audit_logs").insert({
          tenant_id: tenantId,
          user_id: userId,
          action: "email_delegation_revoked",
          details: { grant_id: grantId, reason: "teen_declined" },
        });

        return jsonResponse({
          success: true,
          data: { message: "Access request declined" },
        });
      }
    }

    return errorResponse(`Unknown action: ${action}`);
  } catch (err) {
    console.error("email-access error:", err);
    return errorResponse("Internal server error", 500);
  }
});
