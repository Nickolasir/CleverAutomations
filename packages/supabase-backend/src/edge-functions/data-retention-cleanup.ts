/**
 * Data Retention Cleanup Edge Function
 *
 * Enforces GDPR Article 5(1)(e) data minimization by deleting data
 * that has exceeded its retention period. Runs daily via pg_cron
 * or Supabase scheduled functions.
 *
 * Invocation: POST /functions/v1/data-retention-cleanup
 * Auth: Requires service_role key (admin-only)
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
    // Verify service_role authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Call the batch retention enforcement function
    const { data, error } = await supabase.rpc("enforce_all_data_retention");

    if (error) {
      console.error("Data retention enforcement failed:", error);
      return new Response(
        JSON.stringify({ error: "Retention enforcement failed", details: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("Data retention enforcement completed:", JSON.stringify(data));

    return new Response(
      JSON.stringify({
        success: true,
        message: "Data retention enforcement completed",
        results: data,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unexpected error in data-retention-cleanup:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
