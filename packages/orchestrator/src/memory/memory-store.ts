/**
 * Memory Store
 *
 * Supabase CRUD operations for the agent_memories table.
 * Handles creating, querying, reinforcing, contradicting, and
 * deactivating long-term memories.
 */

import type { TenantId, UserId } from "@clever/shared";
import type { SupabaseClient } from "../conversation-manager.js";
import type { AgentMemory, AgentMemoryCreate, MemoryType } from "./types.js";

// ---------------------------------------------------------------------------
// Memory Store
// ---------------------------------------------------------------------------

export class MemoryStore {
  private readonly db: SupabaseClient;

  constructor(db: SupabaseClient) {
    this.db = db;
  }

  /**
   * Create a new memory.
   */
  async create(input: AgentMemoryCreate): Promise<AgentMemory> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const record: AgentMemory = {
      id,
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      profile_id: input.profile_id ?? null,
      memory_type: input.memory_type,
      content: input.content,
      content_encrypted: input.content_encrypted ?? null,
      scope: input.scope,
      agent_name: input.agent_name ?? null,
      confidence: input.confidence,
      source_type: input.source_type,
      times_reinforced: 0,
      times_contradicted: 0,
      last_accessed_at: null,
      source_conversation_id: input.source_conversation_id ?? null,
      source_message_id: input.source_message_id ?? null,
      is_active: true,
      expires_at: input.expires_at ?? null,
      created_at: now,
      updated_at: now,
    };

    await this.query("agent_memories", (q) =>
      q.insert({
        id: record.id,
        tenant_id: record.tenant_id,
        user_id: record.user_id,
        profile_id: record.profile_id,
        memory_type: record.memory_type,
        content: record.content,
        content_encrypted: record.content_encrypted,
        scope: record.scope,
        agent_name: record.agent_name,
        confidence: record.confidence,
        source_type: record.source_type,
        source_conversation_id: record.source_conversation_id,
        source_message_id: record.source_message_id,
        expires_at: record.expires_at,
      }),
    );

    return record;
  }

  /**
   * Get all active memories for a user (including household-scoped ones).
   * Optionally filter by agent name.
   */
  async getActiveMemories(
    tenantId: TenantId,
    userId: UserId,
    agentName?: string,
  ): Promise<AgentMemory[]> {
    const { data } = await this.query<AgentMemory[]>(
      "agent_memories",
      (q) => {
        let query = q
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("confidence", { ascending: false })
          .limit(50);

        // RLS ensures we only see user's own + household memories
        return query;
      },
    );

    let memories = data ?? [];

    // Client-side filter for agent-scoped memories
    if (agentName) {
      memories = memories.filter(
        (m) => m.agent_name === null || m.agent_name === agentName,
      );
    }

    return memories;
  }

  /**
   * Find a similar existing memory by type and keyword overlap.
   * Used to detect duplicates and contradictions before creating new memories.
   */
  async findSimilar(
    tenantId: TenantId,
    userId: UserId,
    content: string,
    memoryType: MemoryType,
  ): Promise<AgentMemory | null> {
    const { data } = await this.query<AgentMemory[]>(
      "agent_memories",
      (q) =>
        q
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("memory_type", memoryType)
          .eq("is_active", true)
          .limit(20),
    );

    if (!data || data.length === 0) return null;

    // Simple keyword overlap to find the most similar existing memory
    const contentWords = new Set(
      content.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    );

    let bestMatch: AgentMemory | null = null;
    let bestScore = 0;

    for (const mem of data) {
      const memContent = mem.content ?? "";
      const memWords = new Set(
        memContent.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
      );

      const intersection = [...contentWords].filter((w) => memWords.has(w));
      const union = new Set([...contentWords, ...memWords]);
      const jaccard = union.size > 0 ? intersection.length / union.size : 0;

      if (jaccard > bestScore && jaccard > 0.3) {
        bestScore = jaccard;
        bestMatch = mem;
      }
    }

    return bestMatch;
  }

  /**
   * Increment the reinforcement count (memory was confirmed/repeated).
   */
  async reinforce(memoryId: string): Promise<void> {
    // We use raw update since Supabase doesn't support increment in the client SDK
    // The trigger will update updated_at automatically
    const { data } = await this.query<AgentMemory | null>(
      "agent_memories",
      (q) => q.select("times_reinforced, confidence").eq("id", memoryId).single(),
    );

    if (data) {
      const newConfidence = Math.min((data.confidence ?? 0.7) + 0.05, 0.95);
      await this.query("agent_memories", (q) =>
        q
          .update({
            times_reinforced: (data.times_reinforced ?? 0) + 1,
            confidence: newConfidence,
          })
          .eq("id", memoryId),
      );
    }
  }

  /**
   * Increment the contradiction count (memory was contradicted by new info).
   */
  async contradict(memoryId: string): Promise<void> {
    const { data } = await this.query<AgentMemory | null>(
      "agent_memories",
      (q) => q.select("times_contradicted, confidence").eq("id", memoryId).single(),
    );

    if (data) {
      const newConfidence = Math.max((data.confidence ?? 0.7) - 0.1, 0.1);
      await this.query("agent_memories", (q) =>
        q
          .update({
            times_contradicted: (data.times_contradicted ?? 0) + 1,
            confidence: newConfidence,
          })
          .eq("id", memoryId),
      );
    }
  }

  /**
   * Deactivate a memory (soft delete).
   */
  async deactivate(memoryId: string): Promise<void> {
    await this.query("agent_memories", (q) =>
      q.update({ is_active: false }).eq("id", memoryId),
    );
  }

  /**
   * Update last_accessed_at for a batch of memory IDs.
   * Called after memories are used in a response context.
   */
  async touchAccessed(memoryIds: string[]): Promise<void> {
    const now = new Date().toISOString();
    for (const id of memoryIds) {
      await this.query("agent_memories", (q) =>
        q.update({ last_accessed_at: now }).eq("id", id),
      );
    }
  }

  /**
   * List all active memories for a user (for "what do you remember about me?" queries).
   */
  async listUserMemories(
    tenantId: TenantId,
    userId: UserId,
  ): Promise<AgentMemory[]> {
    const { data } = await this.query<AgentMemory[]>(
      "agent_memories",
      (q) =>
        q
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("user_id", userId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(100),
    );
    return data ?? [];
  }

  /**
   * Delete all extracted memories for a user (consent withdrawal).
   */
  async deleteExtractedMemories(
    tenantId: TenantId,
    userId: UserId,
  ): Promise<void> {
    await this.query("agent_memories", (q) =>
      q
        .update({ is_active: false })
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .eq("source_type", "extracted"),
    );
  }

  // -----------------------------------------------------------------------
  // Helper
  // -----------------------------------------------------------------------

  private query<T = unknown>(
    table: string,
    buildQuery: (q: ReturnType<SupabaseClient["from"]>) => ReturnType<SupabaseClient["from"]>,
  ): Promise<{ data: T; error: unknown }> {
    return new Promise((resolve) => {
      const q = this.db.from(table);
      buildQuery(q).then((result: { data: T; error: unknown }) => {
        resolve(result);
      });
    });
  }
}
