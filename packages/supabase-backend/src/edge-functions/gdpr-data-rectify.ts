/**
 * GDPR Data Rectification Edge Function (Right to Rectification)
 * Article 16
 *
 * Allows users to update their personal data. Re-encrypts updated fields.
 *
 * PATCH /functions/v1/gdpr-data-rectify
 * Body: { "email": "new@email.com", "display_name": "New Name" }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_FIELDS = ["email", "display_name"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "PATCH") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use PATCH." }),
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
    const updates: Record<string, string> = {};

    for (const field of ALLOWED_FIELDS) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return new Response(
        JSON.stringify({
          error: "No valid fields to update",
          allowed_fields: ALLOWED_FIELDS,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Get user record
    const { data: userRecord } = await supabase
      .from("users")
      .select("id, tenant_id")
      .eq("auth_user_id", user.id)
      .single();

    if (!userRecord) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tenantId = userRecord.tenant_id;
    const updatePayload: Record<string, unknown> = {};

    // Re-encrypt each updated field
    if (updates.email) {
      const { data: emailHash } = await serviceClient.rpc("hash_pii", {
        p_value: updates.email,
      });
      const { data: emailEnc } = await serviceClient.rpc("encrypt_pii", {
        p_plaintext: updates.email,
        p_tenant_id: tenantId,
      });
      updatePayload.email_hash = emailHash;
      updatePayload.email_encrypted = emailEnc;

      // Also update the Supabase auth email
      await serviceClient.auth.admin.updateUserById(user.id, {
        email: updates.email,
      });
    }

    if (updates.display_name) {
      const { data: nameEnc } = await serviceClient.rpc("encrypt_pii", {
        p_plaintext: updates.display_name,
        p_tenant_id: tenantId,
      });
      updatePayload.display_name_encrypted = nameEnc;
    }

    // Apply the update
    const { error: updateError } = await serviceClient
      .from("users")
      .update(updatePayload)
      .eq("id", userRecord.id);

    if (updateError) throw updateError;

    // Record the DSAR
    await supabase.from("data_subject_requests").insert({
      tenant_id: tenantId,
      user_id: user.id,
      request_type: "rectification",
      status: "completed",
      request_details: { fields_updated: Object.keys(updates) },
      completed_at: new Date().toISOString(),
    });

    // Audit log
    await supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      action: "settings_changed",
      details: {
        operation: "gdpr_rectification",
        fields_updated: Object.keys(updates),
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Personal data updated successfully.",
        fields_updated: Object.keys(updates),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("GDPR rectification error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
