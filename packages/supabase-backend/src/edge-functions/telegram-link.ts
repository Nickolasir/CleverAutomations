/**
 * CleverHub — Telegram Bot Linking
 *
 * Generates a deep-link token so a user can link their Telegram account
 * to receive notifications. The flow is:
 *   1. POST /generate — creates a token, returns a Telegram deep-link URL
 *   2. User opens the link → taps START in Telegram
 *   3. The messaging-webhook edge function consumes the token and stores chat_id
 *   4. GET /status — frontend polls to check if linking succeeded
 *
 * Both endpoints require an authenticated Supabase JWT.
 */

import { createClient } from "@supabase/supabase-js";

const BOT_USERNAME = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "CleverHubBot";
const TOKEN_TTL_MINUTES = 15;

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
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
    const path = url.pathname.replace("/functions/v1/telegram-link", "");

    // -----------------------------------------------------------------
    // POST /generate — create a link token and return the deep-link URL
    // -----------------------------------------------------------------
    if (req.method === "POST" && (path === "/generate" || path === "")) {
      const linkToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

      const { error: insertError } = await supabase
        .from("telegram_link_tokens")
        .insert({
          tenant_id: tenantId,
          user_id: user.id,
          link_token: linkToken,
          expires_at: expiresAt,
        });

      if (insertError) {
        return jsonError("INSERT_FAILED", insertError.message, 500);
      }

      const deepLinkUrl = `https://t.me/${BOT_USERNAME}?start=${linkToken}`;

      return jsonSuccess({
        link_token: linkToken,
        bot_username: BOT_USERNAME,
        deep_link_url: deepLinkUrl,
        expires_at: expiresAt,
      });
    }

    // -----------------------------------------------------------------
    // GET /status — check whether Telegram is linked for this user
    // -----------------------------------------------------------------
    if (req.method === "GET" && path === "/status") {
      const { data: prefs } = await supabase
        .from("user_messaging_preferences")
        .select("telegram_chat_id, telegram_verified, telegram_username")
        .eq("tenant_id", tenantId)
        .eq("user_id", user.id)
        .maybeSingle();

      return jsonSuccess({
        linked: !!prefs?.telegram_verified,
        telegram_username: prefs?.telegram_username ?? null,
        telegram_chat_id: prefs?.telegram_chat_id ? "***" : null, // mask for security
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
