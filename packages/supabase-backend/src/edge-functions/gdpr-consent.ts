/**
 * GDPR Consent Management Edge Function
 *
 * Handles consent grant, withdrawal, and listing.
 * On consent withdrawal, triggers cascading data deletion for that category.
 *
 * Endpoints:
 *   GET  /functions/v1/gdpr-consent         — list user's active consents
 *   POST /functions/v1/gdpr-consent         — grant consent
 *   DELETE /functions/v1/gdpr-consent/:type  — withdraw consent
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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = new URL(req.url);

    // GET — list active consents
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("consent_records")
        .select("*")
        .eq("user_id", user.id)
        .is("withdrawn_at", null)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return new Response(
        JSON.stringify({ consents: data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // POST — grant consent
    if (req.method === "POST") {
      const body = await req.json();
      const { consent_type, lawful_basis, policy_version } = body;

      if (!consent_type || !lawful_basis) {
        return new Response(
          JSON.stringify({ error: "consent_type and lawful_basis are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Get tenant_id from JWT claims
      const { data: userData } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("auth_user_id", user.id)
        .single();

      if (!userData) {
        return new Response(
          JSON.stringify({ error: "User not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const ipHash = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip");

      const { data, error } = await supabase
        .from("consent_records")
        .upsert({
          tenant_id: userData.tenant_id,
          user_id: user.id,
          consent_type,
          lawful_basis,
          granted: true,
          policy_version: policy_version ?? "1.0",
          ip_address_hash: ipHash ? undefined : null, // Hash computed server-side
          granted_at: new Date().toISOString(),
          withdrawn_at: null,
        }, { onConflict: "tenant_id,user_id,consent_type" })
        .select()
        .single();

      if (error) throw error;

      // Audit log
      await supabase.from("audit_logs").insert({
        tenant_id: userData.tenant_id,
        user_id: userData.tenant_id, // logged against user
        action: "consent_granted",
        details: { consent_type, lawful_basis, policy_version },
      });

      return new Response(
        JSON.stringify({ consent: data }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // DELETE — withdraw consent
    if (req.method === "DELETE") {
      const pathParts = url.pathname.split("/");
      const consentType = pathParts[pathParts.length - 1];

      if (!consentType || consentType === "gdpr-consent") {
        return new Response(
          JSON.stringify({ error: "Specify consent type in URL path" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Withdraw the consent
      const { data, error } = await supabase
        .from("consent_records")
        .update({
          granted: false,
          withdrawn_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .eq("consent_type", consentType)
        .is("withdrawn_at", null)
        .select()
        .single();

      if (error) throw error;

      // Cascading effects based on consent type
      const serviceRoleClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );

      if (consentType === "voice_recording") {
        // Delete all voice transcripts for this user
        await serviceRoleClient
          .from("voice_sessions")
          .delete()
          .eq("user_id", user.id);
        await serviceRoleClient
          .from("voice_transcripts")
          .delete()
          .eq("user_id", user.id);
      }

      if (consentType === "health_data") {
        // Delete aide profile data (but not the profile link itself)
        const { data: profiles } = await serviceRoleClient
          .from("family_member_profiles")
          .select("id")
          .eq("user_id", user.id);

        if (profiles) {
          for (const profile of profiles) {
            await serviceRoleClient
              .from("aide_wellness_checkins")
              .delete()
              .eq("aide_profile_id", profile.id);
            await serviceRoleClient
              .from("aide_medication_logs")
              .delete()
              .eq("aide_profile_id", profile.id);
          }
        }
      }

      if (consentType === "nutrition_data") {
        // Delete all nutrition tracking data for this user
        await serviceRoleClient
          .from("food_logs")
          .delete()
          .eq("user_id", user.id);
        await serviceRoleClient
          .from("nutrition_goals")
          .delete()
          .eq("user_id", user.id);
        await serviceRoleClient
          .from("water_logs")
          .delete()
          .eq("user_id", user.id);
      }

      // Get tenant for audit
      const { data: userData } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("auth_user_id", user.id)
        .single();

      if (userData) {
        await supabase.from("audit_logs").insert({
          tenant_id: userData.tenant_id,
          action: "consent_withdrawn",
          details: { consent_type: consentType, cascading_deletions: true },
        });
      }

      return new Response(
        JSON.stringify({ withdrawn: data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("GDPR consent error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
