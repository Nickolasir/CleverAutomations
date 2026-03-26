/**
 * CleverHub — WhatsApp Phone Verification
 *
 * Initiates WhatsApp phone verification for a user. The flow is:
 *   1. POST / — user submits phone (E.164), system stores it and sends
 *      a WhatsApp message asking user to reply "YES"
 *   2. User replies "YES" in WhatsApp
 *   3. The messaging-webhook edge function detects the reply, matches the
 *      phone, and sets whatsapp_verified = true
 *   4. GET /status — frontend polls to check verification status
 *
 * Requires an authenticated Supabase JWT.
 */

import { createClient } from "@supabase/supabase-js";

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const whatsappPhoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const whatsappAccessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonError("SERVER_ERROR", "Missing Supabase config", 500);
    }

    // Authenticate via the user's JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonError("UNAUTHORIZED", "Missing Authorization header", 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonError("UNAUTHORIZED", "Invalid or expired token", 401);
    }

    // Get tenant_id from the users table
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return jsonError("NOT_FOUND", "User profile not found", 404);
    }

    const tenantId = profile.tenant_id as string;
    const url = new URL(req.url);
    const path = url.pathname.replace("/functions/v1/whatsapp-verify", "");

    // -----------------------------------------------------------------
    // POST / — submit phone number and send verification message
    // -----------------------------------------------------------------
    if (req.method === "POST" && (path === "" || path === "/")) {
      const body = await req.json() as { phone?: string };
      const phone = body.phone?.trim();

      if (!phone || !E164_REGEX.test(phone)) {
        return jsonError(
          "INVALID_PHONE",
          "Phone must be in E.164 format (e.g. +15551234567)",
          400,
        );
      }

      // Upsert user messaging preferences with the phone number
      const { data: existing } = await supabase
        .from("user_messaging_preferences")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        const { error: updateError } = await supabase
          .from("user_messaging_preferences")
          .update({
            whatsapp_phone: phone,
            whatsapp_verified: false,
          })
          .eq("id", existing.id);

        if (updateError) {
          return jsonError("UPDATE_FAILED", updateError.message, 500);
        }
      } else {
        const { error: insertError } = await supabase
          .from("user_messaging_preferences")
          .insert({
            tenant_id: tenantId,
            user_id: user.id,
            whatsapp_phone: phone,
            whatsapp_verified: false,
          });

        if (insertError) {
          return jsonError("INSERT_FAILED", insertError.message, 500);
        }
      }

      // Send verification message via WhatsApp Business API
      if (whatsappPhoneNumberId && whatsappAccessToken) {
        const apiUrl = `https://graph.facebook.com/v21.0/${whatsappPhoneNumberId}/messages`;
        await fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${whatsappAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone,
            type: "text",
            text: {
              body: "CleverHub: Reply YES to confirm linking this number for notifications.",
            },
          }),
        });
      }

      return jsonSuccess({
        status: "verification_sent",
        phone,
        message: "A WhatsApp message has been sent. Reply YES to confirm.",
      });
    }

    // -----------------------------------------------------------------
    // GET /status — check whether WhatsApp is verified for this user
    // -----------------------------------------------------------------
    if (req.method === "GET" && path === "/status") {
      const { data: prefs } = await supabase
        .from("user_messaging_preferences")
        .select("whatsapp_phone, whatsapp_verified")
        .eq("tenant_id", tenantId)
        .eq("user_id", user.id)
        .maybeSingle();

      return jsonSuccess({
        linked: !!prefs?.whatsapp_phone,
        verified: !!prefs?.whatsapp_verified,
        phone: prefs?.whatsapp_phone ?? null,
      });
    }

    return jsonError("NOT_FOUND", "Unknown endpoint", 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError("SERVER_ERROR", message, 500);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
