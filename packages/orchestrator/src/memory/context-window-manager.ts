/**
 * Context Window Manager
 *
 * Replaces the naive `history.slice(-20)` with token-aware context building.
 * Strategy:
 *   1. Always include the most recent N messages verbatim (recency window)
 *   2. Prepend a cached summary of older messages if available
 *   3. If no summary exists and history is long enough, summarize via LLM and cache
 *
 * Summaries are generated via a fast Groq call and cached in conversation_summaries.
 */

import type { LLMClient } from "../llm-client.js";
import type { ConversationManager } from "../conversation-manager.js";
import type { ConversationMessage, LLMMessage, LLMProvider } from "../types.js";
import type { TenantId } from "@clever/shared/src/types/tenant.js";
import type { ConversationSummary } from "./types.js";
import { estimateTokens, getTokenBudget } from "./token-counter.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Always include the most recent N messages verbatim. */
const RECENCY_WINDOW = 6;

/** Minimum older messages before summarization is worthwhile. */
const MIN_MESSAGES_FOR_SUMMARY = 4;

// ---------------------------------------------------------------------------
// Context Window Manager
// ---------------------------------------------------------------------------

export class ContextWindowManager {
  private readonly llm: LLMClient;
  private readonly conversations: ConversationManager;

  constructor(llm: LLMClient, conversations: ConversationManager) {
    this.llm = llm;
    this.conversations = conversations;
  }

  /**
   * Build an optimized context from conversation history.
   * Returns LLM messages sized to fit within the token budget.
   */
  async buildContext(
    conversationId: string,
    messages: ConversationMessage[],
    provider: LLMProvider,
    tenantId: string,
  ): Promise<{ messages: LLMMessage[]; tokensUsed: number }> {
    const budget = getTokenBudget(provider);
    const historyBudget = budget.history;

    // Take the recency window
    const recentMessages = messages.slice(-RECENCY_WINDOW);
    const recentTokens = recentMessages.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0,
    );

    // If all messages fit in recency window, or we're at budget, return as-is
    if (messages.length <= RECENCY_WINDOW || recentTokens >= historyBudget) {
      return {
        messages: recentMessages.map(toLLMMessage),
        tokensUsed: recentTokens,
      };
    }

    const remainingBudget = historyBudget - recentTokens;

    // Try to load an existing cached summary
    const existingSummary = await this.conversations.loadLatestSummary(
      conversationId,
    );

    if (existingSummary) {
      const summaryTokens = estimateTokens(existingSummary.summary_text);
      if (summaryTokens <= remainingBudget) {
        return {
          messages: [
            {
              role: "system",
              content: `Previous conversation summary: ${existingSummary.summary_text}`,
            },
            ...recentMessages.map(toLLMMessage),
          ],
          tokensUsed: recentTokens + summaryTokens,
        };
      }
    }

    // No usable summary — create one if there are enough older messages
    const olderMessages = messages.slice(0, -RECENCY_WINDOW);
    if (olderMessages.length >= MIN_MESSAGES_FOR_SUMMARY) {
      const summaryText = await this.summarizeMessages(olderMessages);

      // Cache for future requests
      await this.conversations.saveSummary(
        conversationId,
        tenantId as TenantId,
        summaryText,
        olderMessages,
        estimateTokens(summaryText),
      );

      const summaryTokens = estimateTokens(summaryText);
      if (summaryTokens <= remainingBudget) {
        return {
          messages: [
            {
              role: "system",
              content: `Previous conversation summary: ${summaryText}`,
            },
            ...recentMessages.map(toLLMMessage),
          ],
          tokensUsed: recentTokens + summaryTokens,
        };
      }
    }

    // Fallback: just return recent messages (no summary fits budget)
    return {
      messages: recentMessages.map(toLLMMessage),
      tokensUsed: recentTokens,
    };
  }

  /**
   * Summarize a batch of conversation messages using a fast LLM call.
   */
  private async summarizeMessages(
    messages: ConversationMessage[],
  ): Promise<string> {
    const transcript = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const result = await this.llm.complete({
      provider: "groq",
      messages: [
        {
          role: "system",
          content:
            "Summarize this smart home conversation in 2-3 sentences. " +
            "Focus on: what the user asked for, device commands executed, " +
            "preferences expressed, and important context. " +
            "Be factual and concise. Do not add opinions.",
        },
        { role: "user", content: transcript },
      ],
      max_tokens: 150,
      temperature: 0.2,
    });

    return result.content;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toLLMMessage(msg: ConversationMessage): LLMMessage {
  return {
    role: msg.role === "user" ? "user" : "assistant",
    content: msg.content,
  };
}
