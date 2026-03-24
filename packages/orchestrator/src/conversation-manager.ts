/**
 * Conversation Manager
 *
 * Handles CRUD operations for conversations and messages in Supabase.
 * Provides multi-turn context by loading recent conversation history
 * for the orchestrator and family agents.
 */

import type { TenantId, UserId } from "@clever/shared";
import type {
  Conversation,
  ConversationMessage,
  MessageRole,
  RequestSource,
} from "./types.js";

// ---------------------------------------------------------------------------
// Supabase client interface (injected, not imported)
// ---------------------------------------------------------------------------

/**
 * Minimal Supabase client interface.
 * The host environment (Pi Agent or Edge Function) provides a concrete client.
 */
export interface SupabaseClient {
  from(table: string): SupabaseQueryBuilder;
}

export interface SupabaseQueryBuilder {
  select(columns?: string): SupabaseQueryBuilder;
  insert(data: Record<string, unknown> | Record<string, unknown>[]): SupabaseQueryBuilder;
  update(data: Record<string, unknown>): SupabaseQueryBuilder;
  delete(): SupabaseQueryBuilder;
  eq(column: string, value: unknown): SupabaseQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): SupabaseQueryBuilder;
  limit(count: number): SupabaseQueryBuilder;
  single(): SupabaseQueryBuilder;
  maybeSingle(): SupabaseQueryBuilder;
  then<T>(resolve: (value: { data: T; error: unknown }) => void): void;
}

// ---------------------------------------------------------------------------
// Conversation Manager
// ---------------------------------------------------------------------------

export class ConversationManager {
  private readonly db: SupabaseClient;

  constructor(db: SupabaseClient) {
    this.db = db;
  }

  /**
   * Get or create a conversation for a user + agent combination.
   */
  async getOrCreateConversation(
    tenantId: TenantId,
    userId: UserId,
    agentName: string,
    conversationId?: string,
  ): Promise<Conversation> {
    // If a specific conversation ID is provided, try to load it
    if (conversationId) {
      const existing = await this.getConversation(conversationId);
      if (existing) return existing;
    }

    // Find the most recent active conversation with this agent
    const { data: recent } = await this.query<Conversation[]>(
      "conversations",
      (q) =>
        q
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("user_id", userId)
          .eq("agent_name", agentName.toLowerCase())
          .eq("is_active", true)
          .order("updated_at", { ascending: false })
          .limit(1),
    );

    if (recent && recent.length > 0 && recent[0]) {
      return recent[0];
    }

    // Create a new conversation
    return this.createConversation(tenantId, userId, agentName);
  }

  /**
   * Create a new conversation.
   */
  async createConversation(
    tenantId: TenantId,
    userId: UserId,
    agentName: string,
    profileId?: string,
  ): Promise<Conversation> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const conversation: Conversation = {
      id,
      tenant_id: tenantId,
      user_id: userId,
      agent_name: agentName.toLowerCase(),
      profile_id: profileId ?? null,
      title: null,
      is_active: true,
      created_at: now,
      updated_at: now,
    };

    await this.query("conversations", (q) =>
      q.insert({
        id: conversation.id,
        tenant_id: conversation.tenant_id,
        user_id: conversation.user_id,
        agent_name: conversation.agent_name,
        profile_id: conversation.profile_id,
        title: conversation.title,
        is_active: conversation.is_active,
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
      }),
    );

    return conversation;
  }

  /**
   * Get a conversation by ID.
   */
  async getConversation(conversationId: string): Promise<Conversation | null> {
    const { data } = await this.query<Conversation | null>(
      "conversations",
      (q) => q.select("*").eq("id", conversationId).maybeSingle(),
    );
    return data;
  }

  /**
   * List conversations for a user.
   */
  async listConversations(
    tenantId: TenantId,
    userId: UserId,
    limit = 50,
  ): Promise<Conversation[]> {
    const { data } = await this.query<Conversation[]>(
      "conversations",
      (q) =>
        q
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("user_id", userId)
          .eq("is_active", true)
          .order("updated_at", { ascending: false })
          .limit(limit),
    );
    return data ?? [];
  }

  /**
   * Archive (soft-delete) a conversation.
   */
  async archiveConversation(conversationId: string): Promise<void> {
    await this.query("conversations", (q) =>
      q
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", conversationId),
    );
  }

  // -----------------------------------------------------------------------
  // Messages
  // -----------------------------------------------------------------------

  /**
   * Add a message to a conversation.
   */
  async addMessage(
    conversationId: string,
    tenantId: TenantId,
    role: MessageRole,
    content: string,
    source: RequestSource,
    metadata: Record<string, unknown> = {},
  ): Promise<ConversationMessage> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const message: ConversationMessage = {
      id,
      conversation_id: conversationId,
      tenant_id: tenantId,
      role,
      content,
      metadata,
      source,
      created_at: now,
    };

    await this.query("conversation_messages", (q) =>
      q.insert({
        id: message.id,
        conversation_id: message.conversation_id,
        tenant_id: message.tenant_id,
        role: message.role,
        content: message.content,
        metadata: message.metadata,
        source: message.source,
        created_at: message.created_at,
      }),
    );

    // Update conversation timestamp
    await this.query("conversations", (q) =>
      q
        .update({ updated_at: now })
        .eq("id", conversationId),
    );

    return message;
  }

  /**
   * Get conversation history (most recent messages).
   */
  async getHistory(
    conversationId: string,
    limit = 20,
  ): Promise<ConversationMessage[]> {
    const { data } = await this.query<ConversationMessage[]>(
      "conversation_messages",
      (q) =>
        q
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(limit),
    );
    return data ?? [];
  }

  /**
   * Get messages for a conversation (with pagination).
   */
  async getMessages(
    conversationId: string,
    limit = 50,
    before?: string,
  ): Promise<ConversationMessage[]> {
    const { data } = await this.query<ConversationMessage[]>(
      "conversation_messages",
      (q) => {
        let query = q
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(limit);
        return query;
      },
    );
    return (data ?? []).reverse();
  }

  // -----------------------------------------------------------------------
  // Auto-title
  // -----------------------------------------------------------------------

  /**
   * Set the title of a conversation (typically auto-generated from first message).
   */
  async setTitle(conversationId: string, title: string): Promise<void> {
    await this.query("conversations", (q) =>
      q.update({ title }).eq("id", conversationId),
    );
  }

  // -----------------------------------------------------------------------
  // Helper
  // -----------------------------------------------------------------------

  private query<T = unknown>(
    table: string,
    buildQuery: (q: SupabaseQueryBuilder) => SupabaseQueryBuilder,
  ): Promise<{ data: T; error: unknown }> {
    return new Promise((resolve) => {
      const q = this.db.from(table);
      buildQuery(q).then((result: { data: T; error: unknown }) => {
        resolve(result);
      });
    });
  }
}
