/**
 * Orchestrator types.
 *
 * Defines the request/response contract for the Clever orchestrator,
 * triage classification, and conversation message types.
 */

import type {
  ParsedIntent,
  FamilyVoiceContext,
  UserId,
  TenantId,
  DeviceStateChange,
} from "@clever/shared";

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

export type TriageCategory =
  | "device_command"      // Direct device control ("turn off the lights")
  | "device_query"        // Status question ("is the door locked?")
  | "monitoring"          // System health ("are all devices online?")
  | "conversation"        // General question, chitchat ("what's the weather?")
  | "complex_task"        // Multi-step ("get the house ready for bedtime")
  | "emergency"           // Distress signal ("help! fire!")
  | "wellness_checkin"    // CleverAide: proactive or user-initiated wellness check
  | "medication_reminder"; // CleverAide: medication reminder/confirmation

export interface TriageResult {
  category: TriageCategory;
  confidence: number;
  /** Optional parsed intent if the triage identified a device command. */
  intent?: ParsedIntent;
  /** For complex tasks, a list of sub-steps the LLM planned. */
  planned_steps?: string[];
}

// ---------------------------------------------------------------------------
// Orchestrator request / response
// ---------------------------------------------------------------------------

export type RequestSource = "voice" | "chat" | "quick_command";

export interface OrchestratorRequest {
  /** The user's message (text, either typed or from STT). */
  message: string;
  /** Who is making the request. */
  user_id: UserId;
  /** Tenant scope. */
  tenant_id: TenantId;
  /** Which agent the user is talking to ("clever" = orchestrator). */
  agent_name: string;
  /** Where the request came from. */
  source: RequestSource;
  /** Optional conversation ID for multi-turn context. */
  conversation_id?: string;
  /** Pre-resolved family context (voice path resolves before calling). */
  family_context?: FamilyVoiceContext;
  /** Pre-parsed intent (Tier 1 rules match already happened). */
  pre_parsed_intent?: ParsedIntent;
}

export interface DeviceAction {
  device_name: string;
  entity_id: string;
  action: string;
  previous_state: string;
  new_state: string;
}

export interface OrchestratorResponse {
  /** The assistant's text response. */
  message: string;
  /** What the triage classified this as. */
  triage_category: TriageCategory;
  /** Conversation ID (created if new). */
  conversation_id: string;
  /** Message ID of the assistant response in the database. */
  message_id: string;
  /** Device actions that were executed, if any. */
  device_actions: DeviceAction[];
  /** State changes for audit logging. */
  state_changes: DeviceStateChange[];
  /** Total processing time. */
  latency_ms: number;
  /** Whether family permission was denied. */
  permission_denied?: boolean;
  /** Denial message if permission was denied. */
  denial_message?: string;
  /** Constraints that were applied (e.g., "Temperature capped at 78 F"). */
  constraint_messages?: string[];
}

// ---------------------------------------------------------------------------
// Conversation persistence
// ---------------------------------------------------------------------------

export interface Conversation {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  agent_name: string;
  profile_id: string | null;
  title: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type MessageRole = "user" | "assistant" | "system";

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  tenant_id: TenantId;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown>;
  source: RequestSource;
  created_at: string;
}

// ---------------------------------------------------------------------------
// LLM abstraction
// ---------------------------------------------------------------------------

export type LLMProvider = "groq" | "claude";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCompletionOptions {
  provider?: LLMProvider;
  model?: string;
  messages: LLMMessage[];
  max_tokens?: number;
  temperature?: number;
  /** If true, expect JSON output. */
  json_mode?: boolean;
}

export interface LLMCompletionResult {
  content: string;
  provider: LLMProvider;
  model: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
}

// ---------------------------------------------------------------------------
// Device state query interface
// ---------------------------------------------------------------------------

/**
 * Interface for querying current device states from Home Assistant.
 * Injected by the host environment (Pi Agent or Edge Function).
 */
export interface DeviceStateProvider {
  /** Get all device states for a tenant. */
  getAllDeviceStates(tenantId: TenantId): Promise<DeviceStateInfo[]>;
  /** Get a specific device's current state. */
  getDeviceState(entityId: string): Promise<DeviceStateInfo | null>;
}

export interface DeviceStateInfo {
  entity_id: string;
  name: string;
  state: string;
  category: string;
  room: string;
  is_online: boolean;
  attributes: Record<string, unknown>;
  last_changed: string;
}
