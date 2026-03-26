/**
 * GDPR Processing Restriction Edge Function (Right to Restriction)
 * Article 18
 *
 * Sets or clears the processing_restricted flag on the user record.
 * When restricted, data is stored but not actively processed
 * (no voice commands, no analytics, no AI training).
 *
 * POST /functions/v1/gdpr-restrict
 * Body: { "restrict": true | false }
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

    const body = await req.json();
    const restrict = body.restrict === true;

    // Get user record
    const { data: userRecord } = await supabase
      .from("users")
      .select("id, tenant_id, processing_restricted")
      .eq("auth_user_id", user.id)
      .single();

    if (!userRecord) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (userRecord.processing_restricted === restrict) {
      return new Response(
        JSON.stringify({
          message: `Processing is already ${restrict ? "restricted" : "unrestricted"}.`,
          processing_restricted: restrict,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Update restriction status
    const updatePayload: Record<string, unknown> = {
      processing_restricted: restrict,
      processing_restricted_at: restrict ? new Date().toISOString() : null,
    };

    const { error: updateError } = await serviceClient
      .from("users")
      .update(updatePayload)
      .eq("id", userRecord.id);

    if (updateError) throw updateError;

    // Record the DSAR
    await supabase.from("data_subject_requests").insert({
      tenant_id: userRecord.tenant_id,
      user_id: user.id,
      request_type: "restriction",
      status: "completed",
      request_details: { restrict, previous_state: userRecord.processing_restricted },
      completed_at: new Date().toISOString(),
    });

    // Audit log
    await supabase.from("audit_logs").insert({
      tenant_id: userRecord.tenant_id,
      action: "processing_restricted",
      details: {
        restricted: restrict,
        effects: restrict
          ? ["Voice commands disabled", "Analytics paused", "Data stored but not processed"]
          : ["Full processing restored"],
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        processing_restricted: restrict,
        message: restrict
          ? "Processing restricted. Your data will be stored but not actively processed."
          : "Processing restriction lifted. Normal processing resumed.",
        effects: restrict
          ? [
              "Voice commands will not be processed",
              "Analytics and behavioral monitoring paused",
              "Existing data retained but not used for any purpose",
              "You can still access and export your data",
            ]
          : ["All services restored to normal operation"],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("GDPR restriction error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
