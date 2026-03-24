/**
 * Clever Automations - Conversations Edge Function
 *
 * CRUD endpoints for managing conversation history.
 *
 * Endpoints:
 *   GET    /functions/v1/conversations          — List user's conversations
 *   GET    /functions/v1/conversations?id=<id>  — Get conversation with messages
 *   DELETE /functions/v1/conversations?id=<id>  — Archive (soft-delete) a conversation
 *   POST   /functions/v1/conversations          — Create new conversation
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Users can only access their own conversations (RLS enforced)
 */

import { createClient } from "@supabase/supabase-js";
import type { ApiResult } from "@clever/shared";

// ---------------------------------------------------------------------------
// Edge Function handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    // -----------------------------------------------------------------------
    // 1. Auth
    // -----------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("UNAUTHORIZED", "Missing Authorization header", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonError("SERVER_ERROR", "Missing Supabase config", 500);
    }

    const userToken = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser(userToken);
    if (authError || !user) {
      return jsonError("UNAUTHORIZED", "Invalid JWT", 401);
    }

    const tenantId = extractClaim(user, "tenant_id");
    const userId = user.id;

    if (!tenantId) {
      return jsonError("FORBIDDEN", "No tenant_id in JWT", 403);
    }

    const url = new URL(req.url);
    const conversationId = url.searchParams.get("id");

    // -----------------------------------------------------------------------
    // 2. Route by method
    // -----------------------------------------------------------------------

    switch (req.method) {
      case "GET": {
        if (conversationId) {
          return handleGetConversation(userClient, conversationId);
        }
        return handleListConversations(userClient);
      }

      case "POST": {
        const body = await req.json() as { agent_name: string; title?: string };
        return handleCreateConversation(userClient, tenantId, userId, body);
      }

      case "DELETE": {
        if (!conversationId) {
          return jsonError("VALIDATION_ERROR", "id query parameter required", 400);
        }
        return handleArchiveConversation(userClient, conversationId);
      }

      default:
        return jsonError("METHOD_NOT_ALLOWED", "Use GET, POST, or DELETE", 405);
    }
  } catch (err) {
    console.error("Conversations error:", err);
    return jsonError("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListConversations(
  client: ReturnType<typeof createClient>,
): Promise<Response> {
  const { data, error } = await client
    .from("conversations")
    .select("id, agent_name, title, is_active, created_at, updated_at")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    return jsonError("QUERY_ERROR", error.message, 500);
  }

  return jsonSuccess(data);
}

async function handleGetConversation(
  client: ReturnType<typeof createClient>,
  conversationId: string,
): Promise<Response> {
  // Get conversation
  const { data: conversation, error: convError } = await client
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .single();

  if (convError || !conversation) {
    return jsonError("NOT_FOUND", "Conversation not found", 404);
  }

  // Get messages
  const { data: messages, error: msgError } = await client
    .from("conversation_messages")
    .select("id, role, content, metadata, source, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (msgError) {
    return jsonError("QUERY_ERROR", msgError.message, 500);
  }

  return jsonSuccess({
    conversation,
    messages: messages ?? [],
  });
}

async function handleCreateConversation(
  client: ReturnType<typeof createClient>,
  tenantId: string,
  userId: string,
  body: { agent_name: string; title?: string },
): Promise<Response> {
  if (!body.agent_name) {
    return jsonError("VALIDATION_ERROR", "agent_name is required", 400);
  }

  const { data, error } = await client
    .from("conversations")
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      agent_name: body.agent_name.toLowerCase(),
      title: body.title ?? null,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return jsonError("INSERT_ERROR", error.message, 500);
  }

  return new Response(JSON.stringify({ data, error: null }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleArchiveConversation(
  client: ReturnType<typeof createClient>,
  conversationId: string,
): Promise<Response> {
  const { error } = await client
    .from("conversations")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  if (error) {
    return jsonError("UPDATE_ERROR", error.message, 500);
  }

  return jsonSuccess({ archived: true });
}

// ---------------------------------------------------------------------------
// Helpers
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

function jsonSuccess(data: unknown): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
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
