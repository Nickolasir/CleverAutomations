/**
 * Family Messages Edge Function
 *
 * In-app family messaging — announcements (broadcast to all household members)
 * and private messages between family members.
 *
 * Endpoints:
 *   POST  /functions/v1/family-messages              — send message
 *   GET   /functions/v1/family-messages               — get messages for user
 *   PATCH /functions/v1/family-messages?id=UUID       — mark as read
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Content encrypted with tenant-level key (readable by all family members)
 *   - Announcements visible to all tenant members
 *   - Private messages visible only to sender and recipient
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
// Types
// ---------------------------------------------------------------------------

interface SendMessageBody {
  content: string;
  channel_type: "family_announcement" | "private_message";
  recipient_user_id?: string; // Required for private_message
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

    // -----------------------------------------------------------------------
    // GET: retrieve messages
    // -----------------------------------------------------------------------
    if (req.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

      // Get announcements + messages where user is sender or recipient
      const { data: messages, error: fetchError } = await admin
        .from("family_messages")
        .select("*")
        .eq("tenant_id", tenantId)
        .or(
          `channel_type.eq.family_announcement,sender_user_id.eq.${userId},recipient_user_id.eq.${userId}`,
        )
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (fetchError) return errorResponse("Failed to fetch messages", 500);

      // Decrypt content for each message
      const decrypted = await Promise.all(
        (messages ?? []).map(async (msg) => {
          const { data: content } = await admin.rpc("decrypt_pii", {
            p_ciphertext: msg.content_encrypted,
            p_tenant_id: tenantId,
          });

          // Get sender display name
          const { data: senderUser } = await admin
            .from("users")
            .select("id")
            .eq("id", msg.sender_user_id)
            .single();

          // Get sender's family profile for display name
          const { data: senderProfile } = await admin
            .from("family_member_profiles")
            .select("display_name_encrypted")
            .eq("user_id", msg.sender_user_id)
            .eq("tenant_id", tenantId)
            .maybeSingle();

          let senderName = "Family Member";
          if (senderProfile?.display_name_encrypted) {
            const { data: name } = await admin.rpc("decrypt_pii", {
              p_ciphertext: senderProfile.display_name_encrypted,
              p_tenant_id: tenantId,
            });
            if (name) senderName = name;
          }

          return {
            id: msg.id,
            sender_user_id: msg.sender_user_id,
            sender_name: senderName,
            channel_type: msg.channel_type,
            recipient_user_id: msg.recipient_user_id,
            content,
            is_read: msg.is_read,
            created_at: msg.created_at,
          };
        }),
      );

      return jsonResponse({ success: true, data: decrypted });
    }

    // -----------------------------------------------------------------------
    // PATCH: mark message as read
    // -----------------------------------------------------------------------
    if (req.method === "PATCH") {
      const messageId = url.searchParams.get("id");
      if (!messageId) return errorResponse("Message ID required");

      const { error: updateError } = await admin
        .from("family_messages")
        .update({ is_read: true })
        .eq("id", messageId)
        .eq("tenant_id", tenantId)
        .or(`recipient_user_id.eq.${userId},channel_type.eq.family_announcement`);

      if (updateError) return errorResponse("Failed to mark as read", 500);

      return jsonResponse({ success: true, data: { message: "Marked as read" } });
    }

    // -----------------------------------------------------------------------
    // POST: send message
    // -----------------------------------------------------------------------
    if (req.method !== "POST") return errorResponse("Method not allowed", 405);

    const body: SendMessageBody = await req.json();

    if (!body.content || body.content.trim().length === 0) {
      return errorResponse("Message content is required");
    }

    if (body.content.length > 2000) {
      return errorResponse("Message too long (max 2000 characters)");
    }

    if (body.channel_type === "private_message" && !body.recipient_user_id) {
      return errorResponse("recipient_user_id is required for private messages");
    }

    // Verify recipient is in the same tenant
    if (body.recipient_user_id) {
      const { data: recipient } = await admin
        .from("users")
        .select("id")
        .eq("id", body.recipient_user_id)
        .eq("tenant_id", tenantId)
        .single();

      if (!recipient) return errorResponse("Recipient not found in your household", 404);
    }

    // Encrypt content with tenant key (not user key — must be readable by recipients)
    const { data: contentEncrypted } = await admin.rpc("encrypt_pii", {
      p_plaintext: body.content.trim(),
      p_tenant_id: tenantId,
    });

    const { data: message, error: insertError } = await admin
      .from("family_messages")
      .insert({
        tenant_id: tenantId,
        sender_user_id: userId,
        channel_type: body.channel_type,
        recipient_user_id: body.recipient_user_id || null,
        content_encrypted: contentEncrypted,
      })
      .select("id, channel_type, recipient_user_id, is_read, created_at")
      .single();

    if (insertError) {
      console.error("family_messages insert error:", insertError);
      return errorResponse("Failed to send message", 500);
    }

    // Audit log
    await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      user_id: userId,
      action: "family_message_sent",
      details: {
        channel_type: body.channel_type,
        recipient_user_id: body.recipient_user_id,
      },
    });

    return jsonResponse({ success: true, data: message }, 201);
  } catch (err) {
    console.error("family-messages error:", err);
    return errorResponse("Internal server error", 500);
  }
});
