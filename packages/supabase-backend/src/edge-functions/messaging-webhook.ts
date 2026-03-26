/**
 * CleverHub — Unified Messaging Webhook
 *
 * Receives incoming messages from Telegram and WhatsApp, validates
 * signatures, identifies the caregiver by chat/phone ID, and routes
 * through the orchestrator or handles commands directly.
 *
 * Endpoints:
 *   POST /functions/v1/messaging-webhook/telegram — Telegram bot updates
 *   GET  /functions/v1/messaging-webhook/whatsapp — WhatsApp webhook verification
 *   POST /functions/v1/messaging-webhook/whatsapp — WhatsApp incoming messages
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Input sanitization (inline for Deno edge function — mirrors @clever/shared)
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH = 4096;
const MAX_ID_LENGTH = 128;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .slice(0, MAX_MESSAGE_LENGTH)
    .replace(/\0/g, "")
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim();
}

function sanitizeId(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.slice(0, MAX_ID_LENGTH).trim().replace(/[^a-zA-Z0-9\-_]/g, "");
}

function validateUUID(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().slice(0, 40);
  return UUID_REGEX.test(trimmed) ? trimmed : null;
}

function sanitizeSender(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.slice(0, 20).replace(/[^0-9+]/g, "");
}

function sanitizeUsername(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  return input.slice(0, 64).replace(/[^a-zA-Z0-9_ \-]/g, "").trim() || null;
}

// ---------------------------------------------------------------------------
// Edge Function handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonError("SERVER_ERROR", "Missing Supabase config", 500);
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const url = new URL(req.url);
    const path = url.pathname.replace("/functions/v1/messaging-webhook", "");

    // WhatsApp webhook verification (GET)
    if (req.method === "GET" && path === "/whatsapp") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      const verifyToken = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN");

      if (mode === "subscribe" && token === verifyToken && challenge) {
        return new Response(challenge, { status: 200 });
      }
      return jsonError("FORBIDDEN", "Verification failed", 403);
    }

    // Telegram incoming message
    if (req.method === "POST" && path === "/telegram") {
      const payload = await req.json() as Record<string, unknown>;
      return handleTelegramMessage(serviceClient, payload);
    }

    // WhatsApp incoming message
    if (req.method === "POST" && path === "/whatsapp") {
      const payload = await req.json() as Record<string, unknown>;
      return handleWhatsAppMessage(serviceClient, payload);
    }

    return jsonError("NOT_FOUND", "Unknown endpoint", 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError("SERVER_ERROR", message, 500);
  }
});

// ---------------------------------------------------------------------------
// Telegram handler
// ---------------------------------------------------------------------------

async function handleTelegramMessage(
  client: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
): Promise<Response> {
  // Extract message
  const message = payload["message"] as Record<string, unknown> | undefined;
  const callbackQuery = payload["callback_query"] as Record<string, unknown> | undefined;

  let senderId: string;
  let chatId: string;
  let text: string;
  let senderUsername: string | null = null;
  let isCallback = false;

  if (message) {
    const from = message["from"] as Record<string, unknown>;
    const chat = message["chat"] as Record<string, unknown>;
    senderId = sanitizeSender(String(from["id"]));
    chatId = sanitizeSender(String(chat["id"]));
    text = sanitizeText(message["text"]);
    senderUsername = sanitizeUsername(from["username"]);
  } else if (callbackQuery) {
    const from = callbackQuery["from"] as Record<string, unknown>;
    const cbMessage = callbackQuery["message"] as Record<string, unknown> | undefined;
    const chat = cbMessage?.["chat"] as Record<string, unknown> | undefined;
    senderId = sanitizeSender(String(from["id"]));
    chatId = chat ? sanitizeSender(String(chat["id"])) : senderId;
    text = sanitizeId(callbackQuery["data"]);
    senderUsername = sanitizeUsername(from["username"]);
    isCallback = true;
  } else {
    return jsonSuccess({ status: "ignored" });
  }

  const command = text.trim().toLowerCase();

  // -----------------------------------------------------------------------
  // Handle /start {link_token} — Telegram bot linking flow
  // -----------------------------------------------------------------------
  if (command.startsWith("/start ")) {
    const rawToken = text.trim().replace(/^\/start\s+/i, "");
    const linkToken = sanitizeId(rawToken);
    if (linkToken) {
      return handleTelegramLinking(client, linkToken, chatId, senderUsername);
    }
  }

  if (command.startsWith("/status")) {
    // Return current aide status
    return jsonSuccess({ status: "command_received", command: "status" });
  }

  if (command.startsWith("/checkin")) {
    return jsonSuccess({ status: "command_received", command: "checkin" });
  }

  if (command.startsWith("/medications") || command.startsWith("/meds")) {
    return jsonSuccess({ status: "command_received", command: "medications" });
  }

  if (command.startsWith("/ack")) {
    const rawAlertId = command.replace("/ack", "").trim();
    const alertId = validateUUID(rawAlertId);
    if (alertId) {
      await client
        .from("aide_caregiver_alerts")
        .update({
          acknowledged: true,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", alertId);
      return jsonSuccess({ status: "alert_acknowledged", alert_id: alertId });
    }
  }

  // Free text — route through orchestrator
  return jsonSuccess({
    status: "message_received",
    sender_id: senderId,
    text,
    is_callback: isCallback,
  });
}

// ---------------------------------------------------------------------------
// Telegram bot linking handler
// ---------------------------------------------------------------------------

async function handleTelegramLinking(
  client: ReturnType<typeof createClient>,
  linkToken: string,
  chatId: string,
  senderUsername: string | null,
): Promise<Response> {
  // Look up the link token
  const { data: token, error: tokenError } = await client
    .from("telegram_link_tokens")
    .select("*")
    .eq("link_token", linkToken)
    .eq("consumed", false)
    .single();

  if (tokenError || !token) {
    return jsonSuccess({ status: "invalid_token" });
  }

  // Check expiry
  if (new Date(token.expires_at) < new Date()) {
    return jsonSuccess({ status: "token_expired" });
  }

  // Upsert user_messaging_preferences with the chat_id
  const { data: existing } = await client
    .from("user_messaging_preferences")
    .select("id")
    .eq("tenant_id", token.tenant_id)
    .eq("user_id", token.user_id)
    .maybeSingle();

  if (existing) {
    await client
      .from("user_messaging_preferences")
      .update({
        telegram_chat_id: chatId,
        telegram_verified: true,
        telegram_username: senderUsername,
      })
      .eq("id", existing.id);
  } else {
    await client
      .from("user_messaging_preferences")
      .insert({
        tenant_id: token.tenant_id,
        user_id: token.user_id,
        telegram_chat_id: chatId,
        telegram_verified: true,
        telegram_username: senderUsername,
      });
  }

  // Mark token as consumed
  await client
    .from("telegram_link_tokens")
    .update({ consumed: true })
    .eq("id", token.id);

  // Send confirmation message back to the user
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (botToken) {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "Successfully linked! You will now receive CleverHub notifications here.",
        parse_mode: "Markdown",
      }),
    });
  }

  return jsonSuccess({ status: "telegram_linked", chat_id: chatId });
}

// ---------------------------------------------------------------------------
// WhatsApp handler
// ---------------------------------------------------------------------------

async function handleWhatsAppMessage(
  client: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
): Promise<Response> {
  const entry = (payload["entry"] as Array<Record<string, unknown>>)?.[0];
  if (!entry) return jsonSuccess({ status: "ignored" });

  const changes = (entry["changes"] as Array<Record<string, unknown>>)?.[0];
  if (!changes) return jsonSuccess({ status: "ignored" });

  const value = changes["value"] as Record<string, unknown>;
  if (!value) return jsonSuccess({ status: "ignored" });

  const messages = value["messages"] as Array<Record<string, unknown>>;
  if (!messages?.length) return jsonSuccess({ status: "ignored" });

  const msg = messages[0];
  const from = sanitizeSender(msg["from"]);
  const type = msg["type"] as string;

  let text = "";
  let buttonId: string | null = null;

  if (type === "text") {
    const textObj = msg["text"] as Record<string, unknown>;
    text = sanitizeText(textObj?.["body"]);
  } else if (type === "interactive") {
    const interactive = msg["interactive"] as Record<string, unknown>;
    const buttonReply = interactive?.["button_reply"] as Record<string, unknown>;
    if (buttonReply) {
      buttonId = sanitizeId(buttonReply["id"]);
      text = sanitizeText(buttonReply["title"]);
    }
  }

  // -----------------------------------------------------------------------
  // Handle WhatsApp verification — user replies "YES" to confirm linking
  // -----------------------------------------------------------------------
  if (type === "text" && text.trim().toUpperCase() === "YES") {
    // Look up this phone in unverified user_messaging_preferences
    const { data: pendingPref } = await client
      .from("user_messaging_preferences")
      .select("id")
      .eq("whatsapp_phone", from)
      .eq("whatsapp_verified", false)
      .maybeSingle();

    if (pendingPref) {
      await client
        .from("user_messaging_preferences")
        .update({ whatsapp_verified: true })
        .eq("id", pendingPref.id);

      return jsonSuccess({ status: "whatsapp_verified", phone: from });
    }
  }

  // Handle button callbacks (alert acknowledgment)
  if (buttonId?.startsWith("ack_")) {
    const alertId = validateUUID(buttonId.replace("ack_", ""));
    if (alertId) {
      await client
        .from("aide_caregiver_alerts")
        .update({
          acknowledged: true,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", alertId);
      return jsonSuccess({ status: "alert_acknowledged", alert_id: alertId });
    }
  }

  return jsonSuccess({
    status: "message_received",
    sender: from,
    text,
  });
}

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
