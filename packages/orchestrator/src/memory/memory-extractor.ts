/**
 * Memory Extractor
 *
 * Runs asynchronously after each conversation exchange to extract durable
 * memories from the conversation. Uses a fast Groq LLM call with JSON mode
 * to identify preferences, patterns, facts, and corrections.
 *
 * Non-blocking: called fire-and-forget after the response is sent.
 * Respects GDPR: checks memory_storage consent before extracting.
 */

import type { UserId, TenantId } from "@clever/shared";
import type { LLMClient } from "../llm-client.js";
import type { ConversationMessage } from "../types.js";
import type { MemoryStore } from "./memory-store.js";
import type { ExtractedMemory, MemoryType, MemoryScope } from "./types.js";

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `You are analyzing a smart home conversation to extract durable memories.
Extract ONLY facts that would be useful in future conversations. Be conservative — only extract
things the user clearly stated or demonstrated, not assumptions.

Return a JSON array of memories (or empty array [] if nothing worth remembering):
[{
  "content": "human-readable memory statement",
  "memory_type": "preference|device_pattern|household_fact|naming_alias|routine_pattern|correction|relationship",
  "scope": "user|household",
  "confidence": 0.6-1.0,
  "contains_pii": false
}]

Memory type rules:
- "preference": personal likes/dislikes ("I like the lights dim")
- "device_pattern": observed usage patterns ("Watches TV every night at 9")
- "household_fact": things about the home ("The upstairs thermostat runs 3 degrees warm")
- "naming_alias": nicknames for devices/rooms ("We call the living room TV the big screen")
- "routine_pattern": time-based habits ("Kids go to bed at 8:30 on school nights")
- "correction": user corrected the system ("I said DIM not OFF")
- "relationship": family/spatial relationships ("Mom's office is the upstairs bedroom")

Scope rules:
- "household" for facts about the home, shared spaces, or household-wide habits
- "user" for personal preferences, individual habits, or corrections

Other rules:
- Set contains_pii to true if memory references health, financial, or personal identity info
- Minimum confidence 0.6 — skip ambiguous or uncertain things
- Do NOT extract: one-time commands, greetings, meta-conversation about the system
- Return ONLY the JSON array, nothing else`;

// ---------------------------------------------------------------------------
// Consent checker interface
// ---------------------------------------------------------------------------

/** Check if a user has active consent for memory storage. */
export interface ConsentChecker {
  hasActiveConsent(userId: UserId, consentType: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Memory Extractor
// ---------------------------------------------------------------------------

export class MemoryExtractor {
  private readonly llm: LLMClient;
  private readonly memoryStore: MemoryStore;
  private readonly consentChecker: ConsentChecker | null;

  constructor(
    llm: LLMClient,
    memoryStore: MemoryStore,
    consentChecker?: ConsentChecker,
  ) {
    this.llm = llm;
    this.memoryStore = memoryStore;
    this.consentChecker = consentChecker ?? null;
  }

  /**
   * Process a completed conversation exchange and extract durable memories.
   * Called asynchronously — does not block the response path.
   */
  async processConversation(
    conversationId: string,
    tenantId: TenantId,
    userId: UserId,
    agentName: string,
    recentMessages: ConversationMessage[],
  ): Promise<void> {
    // Need at least a user message + assistant response
    if (recentMessages.length < 2) return;

    // Check GDPR consent
    if (this.consentChecker) {
      const hasConsent = await this.consentChecker.hasActiveConsent(
        userId,
        "memory_storage",
      );
      if (!hasConsent) return;
    }

    // Take the last exchange (4-6 messages for context)
    const exchangeMessages = recentMessages.slice(-6);
    const transcript = exchangeMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    try {
      const result = await this.llm.complete({
        provider: "groq",
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: transcript },
        ],
        max_tokens: 512,
        temperature: 0.1,
        json_mode: true,
      });

      let memories: ExtractedMemory[];
      try {
        memories = JSON.parse(result.content) as ExtractedMemory[];
      } catch {
        // LLM returned invalid JSON — skip
        return;
      }

      if (!Array.isArray(memories)) return;

      for (const mem of memories) {
        if (mem.confidence < 0.6) continue;
        if (!mem.content || !mem.memory_type) continue;

        await this.processExtractedMemory(
          mem,
          tenantId,
          userId,
          agentName,
          conversationId,
          exchangeMessages[exchangeMessages.length - 1]?.id,
        );
      }
    } catch (err) {
      // Memory extraction failure is non-critical — log and continue
      console.warn("Memory extraction failed:", err);
    }
  }

  /**
   * Process an explicit memory save request ("remember that...").
   */
  async saveExplicitMemory(
    content: string,
    tenantId: TenantId,
    userId: UserId,
    agentName: string,
    conversationId: string,
    scope: MemoryScope = "user",
  ): Promise<void> {
    // Determine memory type from content
    const memoryType = this.classifyMemoryType(content);

    await this.memoryStore.create({
      tenant_id: tenantId,
      user_id: userId,
      memory_type: memoryType,
      content,
      scope,
      agent_name: agentName !== "clever" ? agentName : null,
      confidence: 0.95, // Explicit memories start high
      source_type: "explicit",
      source_conversation_id: conversationId,
    });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async processExtractedMemory(
    mem: ExtractedMemory,
    tenantId: TenantId,
    userId: UserId,
    agentName: string,
    conversationId: string,
    messageId?: string,
  ): Promise<void> {
    // Check for duplicates or contradictions
    const existing = await this.memoryStore.findSimilar(
      tenantId,
      userId,
      mem.content,
      mem.memory_type,
    );

    if (existing) {
      // Determine if this reinforces or contradicts
      if (this.isReinforcement(existing.content ?? "", mem.content)) {
        await this.memoryStore.reinforce(existing.id);
        return;
      }

      // Contradiction — reduce confidence on old, potentially supersede
      await this.memoryStore.contradict(existing.id);

      if (mem.confidence > (existing.confidence ?? 0.5)) {
        await this.memoryStore.deactivate(existing.id);
        // Fall through to create new memory below
      } else {
        return; // Keep existing, skip new
      }
    }

    // Create the new memory
    await this.memoryStore.create({
      tenant_id: tenantId,
      user_id: userId,
      memory_type: mem.memory_type,
      content: mem.contains_pii ? null : mem.content,
      content_encrypted: mem.contains_pii ? mem.content : null,
      scope: mem.scope,
      agent_name: agentName !== "clever" ? agentName : null,
      confidence: mem.confidence,
      source_type: "extracted",
      source_conversation_id: conversationId,
      source_message_id: messageId,
    });
  }

  /**
   * Simple heuristic: if two memory contents share many words, it's a reinforcement.
   * If they share topic words but differ in value words, it's a contradiction.
   */
  private isReinforcement(existingContent: string, newContent: string): boolean {
    const existingWords = new Set(
      existingContent.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    );
    const newWords = new Set(
      newContent.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    );

    const intersection = [...existingWords].filter((w) => newWords.has(w));
    const union = new Set([...existingWords, ...newWords]);

    // High overlap = reinforcement, moderate overlap = possible contradiction
    return union.size > 0 && intersection.length / union.size > 0.6;
  }

  /**
   * Classify an explicit memory's type from its content.
   */
  private classifyMemoryType(content: string): MemoryType {
    const lower = content.toLowerCase();

    if (/\b(call|nickname|name|known as|refer to|the big)\b/.test(lower)) {
      return "naming_alias";
    }
    if (/\b(prefer|like|love|hate|don't like|always want)\b/.test(lower)) {
      return "preference";
    }
    if (/\b(usually|every|always|at \d|routine|schedule)\b/.test(lower)) {
      return "routine_pattern";
    }
    if (/\b(thermostat|runs|degrees|warm|cold|broken|noisy)\b/.test(lower)) {
      return "household_fact";
    }
    if (/\b(mom|dad|sister|brother|wife|husband|office|room)\b/.test(lower)) {
      return "relationship";
    }
    if (/\b(not|wrong|actually|meant|correction)\b/.test(lower)) {
      return "correction";
    }

    return "preference"; // Default
  }
}
