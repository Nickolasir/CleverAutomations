/**
 * Chat Service
 *
 * API client for the chat and conversations Edge Functions.
 * Handles communication between the mobile app and the Clever orchestrator.
 */

import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: {
    triage_category?: string;
    device_actions?: DeviceAction[];
    latency_ms?: number;
    constraint_messages?: string[];
  };
  source: "chat" | "voice" | "quick_command";
  created_at: string;
}

export interface DeviceAction {
  device_name: string;
  entity_id: string;
  action: string;
  previous_state: string;
  new_state: string;
}

export interface Conversation {
  id: string;
  agent_name: string;
  title: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatResponse {
  conversation_id: string;
  message_id: string;
  content: string;
  triage_category: string;
  device_actions: DeviceAction[];
  latency_ms: number;
  permission_denied?: boolean;
  denial_message?: string;
  constraint_messages?: string[];
}

export interface AgentProfile {
  id: string;
  agent_name: string;
  age_group: string;
  agent_voice_id: string | null;
  agent_personality: {
    tone: string;
    custom_greeting: string;
  };
}

// ---------------------------------------------------------------------------
// Chat API
// ---------------------------------------------------------------------------

/**
 * Send a message to the orchestrator via the chat Edge Function.
 */
export async function sendChatMessage(
  message: string,
  agentName: string,
  source: "chat" | "voice" = "chat",
  conversationId?: string,
): Promise<ChatResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL");

  const response = await fetch(`${supabaseUrl}/functions/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      message,
      agent_name: agentName,
      source,
      conversation_id: conversationId,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = (errorData as { error?: { message?: string } })?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(errorMsg);
  }

  const result = await response.json() as { data: ChatResponse; error: unknown };
  if (result.error) {
    throw new Error(String(result.error));
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Conversations API
// ---------------------------------------------------------------------------

/**
 * List all active conversations for the current user.
 */
export async function listConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, agent_name, title, is_active, created_at, updated_at")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return (data ?? []) as Conversation[];
}

/**
 * Get a conversation with its messages.
 */
export async function getConversationMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("id, conversation_id, role, content, metadata, source, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw new Error(error.message);
  return (data ?? []) as ChatMessage[];
}

/**
 * Create a new conversation.
 */
export async function createConversation(
  agentName: string,
): Promise<Conversation> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL");

  const response = await fetch(`${supabaseUrl}/functions/v1/conversations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ agent_name: agentName }),
  });

  const result = await response.json() as { data: Conversation; error: unknown };
  if (result.error) throw new Error(String(result.error));
  return result.data;
}

/**
 * Archive a conversation (soft-delete).
 */
export async function archiveConversation(conversationId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL");

  await fetch(`${supabaseUrl}/functions/v1/conversations?id=${conversationId}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${session.access_token}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Agent Profiles API
// ---------------------------------------------------------------------------

/**
 * Load available agent profiles for the current user's tenant.
 */
export async function getAgentProfiles(): Promise<AgentProfile[]> {
  const { data, error } = await supabase
    .from("family_member_profiles")
    .select("id, agent_name, age_group, agent_voice_id, agent_personality")
    .eq("is_active", true);

  if (error) throw new Error(error.message);

  // Always include Clever as the first option
  const clever: AgentProfile = {
    id: "clever",
    agent_name: "Clever",
    age_group: "adult",
    agent_voice_id: null,
    agent_personality: {
      tone: "friendly",
      custom_greeting: "Hi! I'm Clever, your smart home assistant.",
    },
  };

  return [clever, ...((data ?? []) as AgentProfile[])];
}
