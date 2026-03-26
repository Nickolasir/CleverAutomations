/**
 * Token Counter
 *
 * Lightweight token estimation for context window management.
 * Uses a character-ratio heuristic (~3.5 chars per token for English)
 * to avoid importing a full tokenizer on Raspberry Pi.
 */

import type { LLMProvider } from "../types.js";
import type { TokenBudget } from "./types.js";

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Average characters per token for English text (conservative — overestimates). */
const CHARS_PER_TOKEN = 3.5;

/**
 * Estimate the number of tokens in a text string.
 * Deliberately conservative (rounds up) to avoid exceeding context limits.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// Token budgets per provider
// ---------------------------------------------------------------------------

/**
 * Get the token budget allocation for a given LLM provider.
 *
 * Groq: Tight budget for latency-critical voice path.
 * Claude: Larger budget for complex tasks with more context.
 */
export function getTokenBudget(provider: LLMProvider): TokenBudget {
  if (provider === "claude") {
    return {
      total: 4096,
      systemPrompt: 1500,  // Device states, agent personality, instructions
      memories: 500,        // ~5-10 memories
      history: 1500,        // Summaries + recent messages
      currentTurn: 500,     // Current message + response buffer
    };
  }

  // Groq (llama models): 128K context but we keep prompts small for speed
  return {
    total: 2048,
    systemPrompt: 800,
    memories: 300,          // ~3-5 most relevant memories
    history: 600,           // Short history + summary
    currentTurn: 350,
  };
}
