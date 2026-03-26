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
  EmailAccountInfo,
  CalendarAccountInfo,
  EmailSummary,
  CalendarEventInfo,
  DailyNutritionSummary,
  WeeklyNutritionSummary,
  NutritionGoals,
  FoodLogCreateInput,
  FoodLog,
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
  | "medication_reminder" // CleverAide: medication reminder/confirmation
  | "email_query"         // Email inbox queries ("do I have new emails?")
  | "email_command"       // Send/compose email ("send an email to...")
  | "calendar_query"      // Calendar queries ("what's on my calendar today?")
  | "calendar_command"    // Create/modify events ("schedule a meeting at 3pm")
  | "nutrition_log"       // User reporting food/drink intake ("I just had a coffee")
  | "nutrition_query"     // Asking about nutrition data ("how many calories today?")
  | "family_message"      // Family messaging ("send an announcement to the family")
  | "memory_save"         // Explicit memory save ("remember that I like the lights dim")
  | "memory_manage";      // Memory queries/deletion ("what do you remember?", "forget that")

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
  /** Elevated auth session token (for accessing sensitive data like email/nutrition). */
  elevated_auth_session?: string;
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

// ---------------------------------------------------------------------------
// Email & Calendar state query interface
// ---------------------------------------------------------------------------

/**
 * Interface for querying email/calendar state from HA and the local cache.
 * Injected by the host environment alongside DeviceStateProvider.
 */
export interface EmailCalendarStateProvider {
  /** Get all linked email accounts for a user. */
  getEmailAccounts(tenantId: TenantId, userId: UserId): Promise<EmailAccountInfo[]>;
  /** Get all linked calendar accounts for a user. */
  getCalendarAccounts(tenantId: TenantId, userId: UserId): Promise<CalendarAccountInfo[]>;
  /** Get unread email counts per account (keyed by email_account.id). */
  getUnreadCounts(tenantId: TenantId, userId: UserId): Promise<Record<string, number>>;
  /** Get cached email summaries for a user (recent, from all accounts). */
  getRecentEmails(tenantId: TenantId, userId: UserId, limit?: number): Promise<EmailSummary[]>;
  /** Get upcoming calendar events within the next N hours. */
  getUpcomingEvents(tenantId: TenantId, userId: UserId, hours?: number): Promise<CalendarEventInfo[]>;
  /** Check if user requires elevated auth to access email data. */
  requiresElevatedAuth?(userId: UserId, tenantId: TenantId): Promise<boolean>;
  /** Check if accessor can view target user's email. */
  checkEmailAccess?(accessorId: UserId, targetId: UserId, tenantId: TenantId): Promise<{ allowed: boolean; reason?: string }>;
  /** Send an email on behalf of the user (requires elevated auth + rate limit). */
  sendEmail?(tenantId: TenantId, userId: UserId, to: string, subject: string, body: string): Promise<{ success: boolean; error?: string }>;
  /** Get family messages for a user. */
  getFamilyMessages?(tenantId: TenantId, userId: UserId, limit?: number): Promise<unknown[]>;
  /** Send a family announcement or private message. */
  sendFamilyMessage?(tenantId: TenantId, userId: UserId, content: string, recipientId?: UserId): Promise<{ success: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// Nutrition state provider interface
// ---------------------------------------------------------------------------

/**
 * Interface for nutrition tracking data access.
 * Injected by the host environment for nutrition sub-agent features.
 */
export interface NutritionStateProvider {
  /** Get daily nutrition summary for a user. */
  getDailySummary(tenantId: TenantId, userId: UserId, date?: string): Promise<DailyNutritionSummary>;
  /** Get weekly nutrition summary for a user. */
  getWeeklySummary(tenantId: TenantId, userId: UserId, startDate?: string): Promise<WeeklyNutritionSummary>;
  /** Get user's nutrition goals. */
  getGoals(tenantId: TenantId, userId: UserId): Promise<NutritionGoals | null>;
  /** Log a food entry. */
  logFood(tenantId: TenantId, userId: UserId, entry: FoodLogCreateInput): Promise<FoodLog>;
  /** Check if user has active nutrition_data consent. */
  hasNutritionConsent(userId: UserId): Promise<boolean>;
}
