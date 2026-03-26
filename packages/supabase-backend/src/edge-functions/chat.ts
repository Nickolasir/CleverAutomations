/**
 * CleverHub - Chat Edge Function
 *
 * Main entry point for the mobile app to communicate with the Clever
 * orchestrator and family member agents. Receives user messages,
 * routes through the orchestrator, and returns agent responses.
 *
 * Endpoint: POST /functions/v1/chat
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Rate limited: max 30 messages/minute per user
 *   - Tenant-scoped: all data operations respect RLS
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TenantId, UserId, ApiResult } from "@clever/shared";

// ---------------------------------------------------------------------------
// Input sanitization (inline for Deno edge function — mirrors @clever/shared)
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH = 4096;

function sanitizeText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .slice(0, MAX_MESSAGE_LENGTH)
    .replace(/\0/g, "")
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim();
}

function sanitizeAgentName(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.slice(0, 64).replace(/[^a-zA-Z0-9_ \-]/g, "").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatRequest {
  /** Existing conversation ID (null = create new) */
  conversation_id?: string;
  /** Which agent to talk to ('clever', 'jarvis', 'luna', etc.) */
  agent_name: string;
  /** The user's message text */
  message: string;
  /** How the message was created */
  source: "chat" | "voice" | "quick_command";
}

interface ChatResponse {
  /** Conversation ID (created if new) */
  conversation_id: string;
  /** Message ID of the assistant response */
  message_id: string;
  /** The assistant's text response */
  content: string;
  /** What the triage classified this as */
  triage_category: string;
  /** Device actions executed, if any */
  device_actions: Array<{
    device_name: string;
    entity_id: string;
    action: string;
    previous_state: string;
    new_state: string;
  }>;
  /** Processing time in ms */
  latency_ms: number;
  /** Whether permission was denied */
  permission_denied?: boolean;
  /** Denial message if applicable */
  denial_message?: string;
  /** Constraints that were applied */
  constraint_messages?: string[];
}

// ---------------------------------------------------------------------------
// Edge Function handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonError("METHOD_NOT_ALLOWED", "Only POST is accepted", 405);
  }

  try {
    // -----------------------------------------------------------------------
    // 1. Extract and validate JWT
    // -----------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("UNAUTHORIZED", "Missing or invalid Authorization header", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    const claudeApiKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      return jsonError("SERVER_ERROR", "Missing Supabase environment configuration", 500);
    }

    if (!groqApiKey) {
      return jsonError("SERVER_ERROR", "Missing GROQ_API_KEY", 500);
    }

    const userToken = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser(userToken);
    if (authError || !user) {
      return jsonError("UNAUTHORIZED", "Invalid or expired JWT", 401);
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const tenantId = extractClaim(user, "tenant_id");
    const userId = user.id;

    if (!tenantId) {
      return jsonError("FORBIDDEN", "No tenant_id found in JWT claims", 403);
    }

    // -----------------------------------------------------------------------
    // 2. Parse and validate request
    // -----------------------------------------------------------------------
    const rawPayload: ChatRequest = await req.json();

    if (!rawPayload.message || typeof rawPayload.message !== "string") {
      return jsonError("VALIDATION_ERROR", "message is required and must be a string", 400);
    }

    if (!rawPayload.agent_name || typeof rawPayload.agent_name !== "string") {
      return jsonError("VALIDATION_ERROR", "agent_name is required", 400);
    }

    const validSources = ["chat", "voice", "quick_command"];
    if (!validSources.includes(rawPayload.source)) {
      return jsonError("VALIDATION_ERROR", `source must be one of: ${validSources.join(", ")}`, 400);
    }

    // Sanitize all external inputs
    const payload: ChatRequest = {
      ...rawPayload,
      message: sanitizeText(rawPayload.message),
      agent_name: sanitizeAgentName(rawPayload.agent_name),
      source: rawPayload.source,
    };

    if (!payload.message) {
      return jsonError("VALIDATION_ERROR", "message cannot be empty after sanitization", 400);
    }

    if (!payload.agent_name) {
      return jsonError("VALIDATION_ERROR", "agent_name is invalid", 400);
    }

    // -----------------------------------------------------------------------
    // 3. Rate limit check
    // -----------------------------------------------------------------------
    const rateLimitOk = await checkRateLimit(serviceClient, userId, tenantId);
    if (!rateLimitOk.allowed) {
      return new Response(
        JSON.stringify({
          data: null,
          error: {
            code: "RATE_LIMITED",
            message: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX} messages per minute.`,
          },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }

    // -----------------------------------------------------------------------
    // 4. Get or create conversation
    // -----------------------------------------------------------------------
    let conversationId = payload.conversation_id;

    if (!conversationId) {
      // Find most recent active conversation with this agent
      const { data: existing } = await userClient
        .from("conversations")
        .select("id")
        .eq("agent_name", payload.agent_name.toLowerCase())
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        conversationId = existing[0].id;
      } else {
        // Create new conversation
        const newId = crypto.randomUUID();
        await serviceClient.from("conversations").insert({
          id: newId,
          tenant_id: tenantId,
          user_id: userId,
          agent_name: payload.agent_name.toLowerCase(),
          title: payload.message.slice(0, 80),
          is_active: true,
        });
        conversationId = newId;
      }
    }

    // -----------------------------------------------------------------------
    // 5. Save user message
    // -----------------------------------------------------------------------
    const userMessageId = crypto.randomUUID();
    await serviceClient.from("conversation_messages").insert({
      id: userMessageId,
      conversation_id: conversationId,
      tenant_id: tenantId,
      role: "user",
      content: payload.message,
      source: payload.source,
      metadata: {},
    });

    // -----------------------------------------------------------------------
    // 6. Load conversation history
    // -----------------------------------------------------------------------
    const { data: history } = await userClient
      .from("conversation_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(20);

    // -----------------------------------------------------------------------
    // 7. Load family profile (if not "clever")
    // -----------------------------------------------------------------------
    let familyProfile = null;
    if (payload.agent_name.toLowerCase() !== "clever") {
      const { data: profile } = await serviceClient
        .from("family_member_profiles")
        .select("*")
        .eq("tenant_id", tenantId)
        .ilike("agent_name", payload.agent_name)
        .eq("is_active", true)
        .maybeSingle();
      familyProfile = profile;
    }

    // -----------------------------------------------------------------------
    // 8. Load device states for context
    // -----------------------------------------------------------------------
    const { data: devices } = await serviceClient
      .from("devices")
      .select("ha_entity_id, name, state, category, room, is_online, attributes, last_seen")
      .eq("tenant_id", tenantId);

    const deviceStates = (devices ?? []).map((d: Record<string, unknown>) => ({
      entity_id: d.ha_entity_id as string,
      name: d.name as string,
      state: (d.state as string) ?? "unknown",
      category: (d.category as string) ?? "unknown",
      room: (d.room as string) ?? "unknown",
      is_online: (d.is_online as boolean) ?? false,
      attributes: (d.attributes as Record<string, unknown>) ?? {},
      last_changed: (d.last_seen as string) ?? "",
    }));

    // -----------------------------------------------------------------------
    // 9. Build system prompt and call LLM
    // -----------------------------------------------------------------------
    const systemPrompt = buildSystemPrompt(
      payload.agent_name,
      familyProfile,
      deviceStates,
    );

    const llmMessages = [
      { role: "system", content: systemPrompt },
      ...(history ?? []).map((m: { role: string; content: string }) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
      { role: "user", content: payload.message },
    ];

    const start = Date.now();

    const llmResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: llmMessages,
        max_tokens: 512,
        temperature: 0.4,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error("Groq error:", errText);
      return jsonError("LLM_ERROR", "Failed to get response from AI", 502);
    }

    const llmData = await llmResponse.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const assistantContent = llmData.choices[0]?.message?.content ?? "I'm sorry, I couldn't process that request.";
    const latencyMs = Date.now() - start;

    // -----------------------------------------------------------------------
    // 10. Extract and execute device intent if present
    // -----------------------------------------------------------------------
    const intentMatch = /```intent\s*\n([\s\S]*?)\n```/.exec(assistantContent);
    let deviceActions: ChatResponse["device_actions"] = [];
    let triageCategory = "conversation";
    const cleanContent = assistantContent.replace(/```intent\s*\n[\s\S]*?\n```/g, "").trim();

    if (intentMatch?.[1]) {
      triageCategory = "device_command";
      try {
        const intent = JSON.parse(intentMatch[1]);
        // Broadcast the intent to the Pi Agent via Realtime for execution
        await serviceClient
          .from("device_commands")
          .insert({
            tenant_id: tenantId,
            user_id: userId,
            command: intent,
            source: payload.source,
            status: "pending",
          });

        // Also broadcast via Realtime channel for Pi Agent to pick up
        const channel = serviceClient.channel(`device_command:${tenantId}`);
        await channel.send({
          type: "broadcast",
          event: "command",
          payload: {
            intent,
            user_id: userId,
            source: payload.source,
            conversation_id: conversationId,
          },
        });
      } catch (e) {
        console.error("Failed to process device intent:", e);
      }
    }

    // -----------------------------------------------------------------------
    // 11. Save assistant message
    // -----------------------------------------------------------------------
    const assistantMessageId = crypto.randomUUID();
    await serviceClient.from("conversation_messages").insert({
      id: assistantMessageId,
      conversation_id: conversationId,
      tenant_id: tenantId,
      role: "assistant",
      content: cleanContent || assistantContent,
      source: payload.source,
      metadata: {
        triage_category: triageCategory,
        device_actions: deviceActions,
        latency_ms: latencyMs,
      },
    });

    // Update conversation timestamp
    await serviceClient
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    // -----------------------------------------------------------------------
    // 12. Return response
    // -----------------------------------------------------------------------
    const response: ApiResult<ChatResponse> = {
      data: {
        conversation_id: conversationId!,
        message_id: assistantMessageId,
        content: cleanContent || assistantContent,
        triage_category: triageCategory,
        device_actions: deviceActions,
        latency_ms: latencyMs,
      },
      error: null,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Chat error:", err);
    return jsonError("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function extractClaim(
  user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> },
  claim: string,
): string | null {
  return (
    (user.app_metadata?.[claim] as string | undefined) ??
    (user.user_metadata?.[claim] as string | undefined) ??
    null
  );
}

async function checkRateLimit(
  client: SupabaseClient,
  userId: string,
  tenantId: string,
): Promise<{ allowed: true; remaining: number } | { allowed: false }> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString();

  const { count } = await client
    .from("conversation_messages")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("role", "user")
    .gte("created_at", windowStart);

  const currentCount = count ?? 0;
  if (currentCount >= RATE_LIMIT_MAX) {
    return { allowed: false };
  }

  return { allowed: true, remaining: RATE_LIMIT_MAX - currentCount - 1 };
}

function buildSystemPrompt(
  agentName: string,
  familyProfile: Record<string, unknown> | null,
  devices: Array<{ entity_id: string; name: string; state: string; category: string; room: string; is_online: boolean }>,
): string {
  const lines: string[] = [];

  if (agentName.toLowerCase() === "clever" || !familyProfile) {
    lines.push("You are Clever, the AI orchestrator for a smart home system powered by Home Assistant.");
    lines.push("You control devices, answer questions, and monitor the home.");
  } else {
    const personality = familyProfile.agent_personality as Record<string, unknown> | undefined;
    lines.push(`You are ${familyProfile.agent_name}, a personal smart home assistant.`);
    if (personality) {
      const tone = personality.tone as string;
      const maxWords = personality.max_response_words as number;
      lines.push(`PERSONALITY: ${tone}. Keep responses under ${maxWords} words.`);
      const forbidden = personality.forbidden_topics as string[];
      if (forbidden?.length) {
        lines.push(`FORBIDDEN TOPICS: ${forbidden.join(", ")}`);
      }
    }
  }

  if (devices.length > 0) {
    lines.push("");
    lines.push("AVAILABLE DEVICES:");
    for (const d of devices) {
      const status = d.is_online ? d.state : "OFFLINE";
      lines.push(`  - ${d.name}: ${status} (${d.room})`);
    }
  }

  lines.push("");
  lines.push("DEVICE COMMAND FORMAT:");
  lines.push('When controlling a device, include a JSON block in your response:');
  lines.push("```intent");
  lines.push('{"domain": "light", "action": "turn_on", "target_device": "living room lights", "target_room": "living room", "parameters": {}}');
  lines.push("```");
  lines.push("Always include a natural language response alongside the intent block.");

  lines.push("");
  lines.push("Keep responses concise and helpful.");

  return lines.join("\n");
}

function jsonError(code: string, message: string, status: number): Response {
  const body: ApiResult<never> = {
    data: null,
    error: { code, message },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
