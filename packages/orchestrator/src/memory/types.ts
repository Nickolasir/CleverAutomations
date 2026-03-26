/**
 * Memory system types.
 *
 * Defines the data structures for the orchestrator's long-term memory,
 * conversation summaries, and context window management.
 */

import type { TenantId, UserId } from "@clever/shared";

// ---------------------------------------------------------------------------
// Memory types
// ---------------------------------------------------------------------------

export type MemoryType =
  | "preference"       // "I like lights dim in the evening"
  | "device_pattern"   // "Usually watches TV at 9pm"
  | "household_fact"   // "The upstairs thermostat runs warm"
  | "naming_alias"     // "We call the living room TV the big screen"
  | "routine_pattern"  // "Kids go to bed at 8:30 on school nights"
  | "correction"       // "I said DIM not OFF"
  | "relationship";    // "Mom's office is the upstairs bedroom"

export type MemoryScope = "user" | "household" | "agent";

export type MemorySourceType = "extracted" | "explicit" | "inferred" | "corrected";

export interface AgentMemory {
  id: string;
  tenant_id: TenantId;
  user_id: UserId | null;
  profile_id: string | null;
  memory_type: MemoryType;
  content: string | null;
  content_encrypted: string | null;
  scope: MemoryScope;
  agent_name: string | null;
  confidence: number;
  source_type: MemorySourceType;
  times_reinforced: number;
  times_contradicted: number;
  last_accessed_at: string | null;
  source_conversation_id: string | null;
  source_message_id: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Input for creating a new memory (id and timestamps auto-generated). */
export interface AgentMemoryCreate {
  tenant_id: TenantId;
  user_id: UserId;
  profile_id?: string;
  memory_type: MemoryType;
  content: string | null;
  content_encrypted?: string | null;
  scope: MemoryScope;
  agent_name?: string | null;
  confidence: number;
  source_type: MemorySourceType;
  source_conversation_id?: string | null;
  source_message_id?: string | null;
  expires_at?: string | null;
}

// ---------------------------------------------------------------------------
// Conversation summaries
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  id: string;
  conversation_id: string;
  tenant_id: TenantId;
  summary_text: string;
  first_message_id: string;
  last_message_id: string;
  message_count: number;
  original_tokens: number;
  summary_tokens: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Context building
// ---------------------------------------------------------------------------

/** Result of retrieving relevant memories for a request. */
export interface MemoryContext {
  /** Memories formatted for system prompt injection. Empty string if none. */
  formattedMemories: string;
  /** Estimated token count of the formatted memories block. */
  tokenCount: number;
  /** IDs of memories that were selected (for access tracking). */
  memoryIds: string[];
}

/** Token budget allocation per LLM provider. */
export interface TokenBudget {
  /** Total tokens available for the full prompt. */
  total: number;
  /** Tokens reserved for the system prompt (device states, personality). */
  systemPrompt: number;
  /** Tokens reserved for memory injection. */
  memories: number;
  /** Tokens reserved for conversation history + summaries. */
  history: number;
  /** Tokens reserved for the current user message + response buffer. */
  currentTurn: number;
}

// ---------------------------------------------------------------------------
// Memory extraction (output from the LLM extractor)
// ---------------------------------------------------------------------------

export interface ExtractedMemory {
  content: string;
  memory_type: MemoryType;
  scope: MemoryScope;
  confidence: number;
  contains_pii: boolean;
}
