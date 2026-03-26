/**
 * Memory Provider
 *
 * Retrieves relevant memories for a request and formats them for
 * system prompt injection. Scores memories by keyword relevance,
 * confidence, reinforcement, recency, and type-specific boosts.
 *
 * Phase 1-2: keyword-based retrieval.
 * Phase 3 (future): augmented with pgvector cosine similarity.
 */

import type { TenantId, UserId } from "@clever/shared";
import type { MemoryStore } from "./memory-store.js";
import type { AgentMemory, MemoryContext } from "./types.js";
import { estimateTokens } from "./token-counter.js";

// ---------------------------------------------------------------------------
// Memory Provider
// ---------------------------------------------------------------------------

export class MemoryProvider {
  private readonly memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    this.memoryStore = memoryStore;
  }

  /**
   * Get memories relevant to a request, formatted for system prompt injection.
   */
  async getRelevantMemories(
    tenantId: TenantId,
    userId: UserId,
    agentName: string,
    message: string,
    tokenBudget: number,
  ): Promise<MemoryContext> {
    const allMemories = await this.memoryStore.getActiveMemories(
      tenantId,
      userId,
      agentName,
    );

    if (allMemories.length === 0) {
      return { formattedMemories: "", tokenCount: 0, memoryIds: [] };
    }

    // Score and rank memories by relevance to the current message
    const scored = allMemories
      .map((memory) => ({
        memory,
        score: this.scoreRelevance(memory, message),
      }))
      .sort((a, b) => b.score - a.score);

    // Select top memories within token budget
    const selected: AgentMemory[] = [];
    const HEADER_TOKENS = 30; // "REMEMBERED CONTEXT:" header overhead
    let totalTokens = 0;

    for (const { memory, score } of scored) {
      if (score < 0.1) break; // Below relevance threshold

      const memContent = memory.content ?? "[encrypted]";
      const memTokens = estimateTokens(memContent) + 10; // +10 for formatting

      if (totalTokens + memTokens + HEADER_TOKENS > tokenBudget) break;

      selected.push(memory);
      totalTokens += memTokens;
    }

    if (selected.length === 0) {
      return { formattedMemories: "", tokenCount: 0, memoryIds: [] };
    }

    // Format for system prompt injection
    const lines = ["REMEMBERED CONTEXT (from previous interactions):"];
    for (const mem of selected) {
      const prefix = mem.scope === "household" ? "[household]" : "[personal]";
      const content = mem.content ?? "[encrypted memory]";
      lines.push(`  ${prefix} ${content}`);
    }
    const formattedMemories = lines.join("\n");

    // Track access for decay scoring (fire-and-forget)
    const memoryIds = selected.map((m) => m.id);
    this.memoryStore.touchAccessed(memoryIds).catch(() => {});

    return {
      formattedMemories,
      tokenCount: totalTokens + HEADER_TOKENS,
      memoryIds,
    };
  }

  /**
   * Score relevance of a memory to the current message.
   * Combines keyword overlap, confidence, reinforcement, recency, and type boosts.
   */
  private scoreRelevance(memory: AgentMemory, message: string): number {
    let score = 0;
    const messageLower = message.toLowerCase();
    const contentLower = (memory.content ?? "").toLowerCase();

    // 1. Keyword overlap (weighted Jaccard-like)
    const messageWords = new Set(
      messageLower.split(/\s+/).filter((w) => w.length > 3),
    );
    const memoryWords = new Set(
      contentLower.split(/\s+/).filter((w) => w.length > 3),
    );
    const intersection = [...messageWords].filter((w) => memoryWords.has(w));
    if (messageWords.size > 0) {
      score += (intersection.length / messageWords.size) * 0.4;
    }

    // 2. Confidence boost
    score += memory.confidence * 0.2;

    // 3. Reinforcement boost (capped)
    score += Math.min(memory.times_reinforced * 0.05, 0.2);

    // 4. Recency boost (memories accessed recently are slightly more relevant)
    if (memory.last_accessed_at) {
      const hoursSinceAccess =
        (Date.now() - new Date(memory.last_accessed_at).getTime()) / 3_600_000;
      score += Math.max(0, 0.1 - hoursSinceAccess * 0.001);
    }

    // 5. Type-specific boosts
    if (memory.memory_type === "naming_alias") {
      // Always somewhat relevant — helps interpret device references
      score += 0.15;
    }
    if (memory.memory_type === "correction") {
      // Corrections are high priority to avoid repeating mistakes
      score += 0.2;
    }

    return Math.min(score, 1.0);
  }
}
