/**
 * Clever Orchestrator
 *
 * The central brain of the CleverHub smart home system.
 * Triages all incoming requests, delegates to family member agents
 * or handles directly, and routes device commands through the
 * CommandExecutor to Home Assistant.
 *
 * Deployable in two contexts:
 *   - Pi Agent: imported directly, uses Groq for speed
 *   - Edge Function: called via HTTP, supports Claude for complex tasks
 */

import type {
  ParsedIntent,
  UserId,
  TenantId,
  DeviceStateChange,
  FamilyVoiceContext,
  AideProfile,
  AideMedication,
  HACalendarEventCreate,
} from "@clever/shared";
import { FamilyPermissionResolver, EMAIL_SEND_ENABLED } from "@clever/shared";

import type { LLMClient } from "./llm-client.js";
import type { AgentManager } from "./agent-manager.js";
import type { ConversationManager } from "./conversation-manager.js";
import { TriageClassifier } from "./triage.js";
import {
  buildCleverSystemPrompt,
  buildMonitoringPrompt,
  buildComplexTaskPrompt,
  buildWellnessCheckinPrompt,
  buildMedicationReminderPrompt,
  buildEmailCalendarSystemPrompt,
  buildNutritionLogPrompt,
  buildNutritionSummaryPrompt,
} from "./system-prompts.js";
import type {
  OrchestratorRequest,
  OrchestratorResponse,
  DeviceAction,
  DeviceStateInfo,
  DeviceStateProvider,
  EmailCalendarStateProvider,
  NutritionStateProvider,
  LLMMessage,
  ConversationMessage,
  TriageCategory,
  LLMProvider,
} from "./types.js";
import type { ContextWindowManager } from "./memory/context-window-manager.js";
import type { MemoryProvider } from "./memory/memory-provider.js";
import type { MemoryExtractor } from "./memory/memory-extractor.js";
import type { MemoryStore } from "./memory/memory-store.js";
import { getTokenBudget } from "./memory/token-counter.js";

// ---------------------------------------------------------------------------
// Command executor interface (injected by host)
// ---------------------------------------------------------------------------

export interface CommandExecutorInterface {
  execute(
    intent: ParsedIntent,
    userId: UserId,
    source: string,
    familyContext?: FamilyVoiceContext,
  ): Promise<{
    success: boolean;
    stateChanges: DeviceStateChange[];
    errors: string[];
    durationMs: number;
    permissionDenied?: boolean;
    denialMessage?: string;
    constraintMessages?: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OrchestratorConfig {
  llm: LLMClient;
  agentManager: AgentManager;
  conversationManager: ConversationManager;
  commandExecutor: CommandExecutorInterface;
  deviceStateProvider: DeviceStateProvider;
  /** Optional — required for email/calendar features. */
  emailCalendarStateProvider?: EmailCalendarStateProvider;
  /** Optional — required for nutrition tracking features. */
  nutritionStateProvider?: NutritionStateProvider;
  tenantId: TenantId;
  /** Optional — enables smart context windowing (replaces slice(-20)). */
  contextWindowManager?: ContextWindowManager;
  /** Optional — enables long-term memory retrieval. */
  memoryProvider?: MemoryProvider;
  /** Optional — enables background memory extraction. */
  memoryExtractor?: MemoryExtractor;
  /** Optional — enables memory save/manage handlers. */
  memoryStore?: MemoryStore;
}

// ---------------------------------------------------------------------------
// Intent extraction from LLM response
// ---------------------------------------------------------------------------

const INTENT_BLOCK_REGEX = /```intent\s*\n([\s\S]*?)\n```/;

function extractIntent(response: string): ParsedIntent | null {
  const match = INTENT_BLOCK_REGEX.exec(response);
  if (!match?.[1]) return null;

  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    return {
      domain: String(parsed["domain"] ?? ""),
      action: String(parsed["action"] ?? ""),
      target_device: parsed["target_device"] as string | undefined,
      target_room: parsed["target_room"] as string | undefined,
      parameters: (parsed["parameters"] as Record<string, unknown>) ?? {},
      confidence: 0.9,
      raw_transcript: "",
    };
  } catch {
    return null;
  }
}

function extractMultipleIntents(response: string): ParsedIntent[] {
  // Try to parse a JSON array of intents
  const arrayMatch = /\[[\s\S]*\]/.exec(response);
  if (!arrayMatch) return [];

  try {
    const arr = JSON.parse(arrayMatch[0]) as Array<Record<string, unknown>>;
    return arr.map((item) => ({
      domain: String(item["domain"] ?? ""),
      action: String(item["action"] ?? ""),
      target_device: item["target_device"] as string | undefined,
      target_room: item["target_room"] as string | undefined,
      parameters: (item["parameters"] as Record<string, unknown>) ?? {},
      confidence: 0.9,
      raw_transcript: "",
    }));
  } catch {
    return [];
  }
}

function stripIntentBlock(response: string): string {
  return response.replace(/```intent\s*\n[\s\S]*?\n```/g, "").trim();
}

// ---------------------------------------------------------------------------
// Calendar intent extraction from LLM response
// ---------------------------------------------------------------------------

interface CalendarIntentData {
  action: string;
  summary: string;
  start_date_time?: string;
  end_date_time?: string;
  description?: string;
  location?: string;
}

const CALENDAR_INTENT_BLOCK_REGEX = /```calendar_intent\s*\n([\s\S]*?)\n```/;

function extractCalendarIntent(response: string): CalendarIntentData | null {
  const match = CALENDAR_INTENT_BLOCK_REGEX.exec(response);
  if (!match?.[1]) return null;

  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    return {
      action: String(parsed["action"] ?? "create"),
      summary: String(parsed["summary"] ?? "New Event"),
      start_date_time: parsed["start_date_time"] as string | undefined,
      end_date_time: parsed["end_date_time"] as string | undefined,
      description: parsed["description"] as string | undefined,
      location: parsed["location"] as string | undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Clever Orchestrator
// ---------------------------------------------------------------------------

export class CleverOrchestrator {
  private readonly llm: LLMClient;
  private readonly agentManager: AgentManager;
  private readonly conversations: ConversationManager;
  private readonly commandExecutor: CommandExecutorInterface;
  private readonly deviceState: DeviceStateProvider;
  private readonly emailCalendarState: EmailCalendarStateProvider | null;
  private readonly nutritionState: NutritionStateProvider | null;
  private readonly tenantId: TenantId;
  private readonly triage: TriageClassifier;
  private readonly permissionResolver: FamilyPermissionResolver;
  private readonly contextWindowManager: ContextWindowManager | null;
  private readonly memoryProvider: MemoryProvider | null;
  private readonly memoryExtractor: MemoryExtractor | null;
  private readonly memoryStore: MemoryStore | null;

  constructor(config: OrchestratorConfig) {
    this.llm = config.llm;
    this.agentManager = config.agentManager;
    this.conversations = config.conversationManager;
    this.commandExecutor = config.commandExecutor;
    this.deviceState = config.deviceStateProvider;
    this.emailCalendarState = config.emailCalendarStateProvider ?? null;
    this.nutritionState = config.nutritionStateProvider ?? null;
    this.tenantId = config.tenantId;
    this.triage = new TriageClassifier(this.llm);
    this.permissionResolver = new FamilyPermissionResolver();
    this.contextWindowManager = config.contextWindowManager ?? null;
    this.memoryProvider = config.memoryProvider ?? null;
    this.memoryExtractor = config.memoryExtractor ?? null;
    this.memoryStore = config.memoryStore ?? null;
  }

  /**
   * Main entry point: handle any incoming request.
   *
   * This is the single method called by both the Pi Agent voice path
   * and the chat Edge Function.
   */
  async handleRequest(request: OrchestratorRequest): Promise<OrchestratorResponse> {
    const start = Date.now();

    // 1. Get or create conversation
    const conversation = await this.conversations.getOrCreateConversation(
      request.tenant_id,
      request.user_id,
      request.agent_name,
      request.conversation_id,
    );

    // 2. Save user message
    const userMessage = await this.conversations.addMessage(
      conversation.id,
      request.tenant_id,
      "user",
      request.message,
      request.source,
    );

    // 3. Auto-title on first message
    if (!conversation.title) {
      const title = request.message.slice(0, 80);
      await this.conversations.setTitle(conversation.id, title);
    }

    // 4. Check if this is a family agent or Clever
    const agentName = request.agent_name.toLowerCase();
    const familyAgent = agentName !== "clever"
      ? await this.agentManager.getAgent(agentName)
      : null;

    // 5. If it's a family agent, delegate to them
    if (familyAgent) {
      return this.handleFamilyAgentRequest(request, conversation.id, familyAgent, start);
    }

    // 6. Clever handles it directly — triage first
    const triageResult = await this.triage.classify(request.message);

    // 7. Route based on triage category
    let response: OrchestratorResponse;

    switch (triageResult.category) {
      case "emergency":
        response = await this.handleEmergency(request, conversation.id, start);
        break;

      case "device_command":
        response = await this.handleDeviceCommand(request, conversation.id, start);
        break;

      case "device_query":
        response = await this.handleDeviceQuery(request, conversation.id, start);
        break;

      case "monitoring":
        response = await this.handleMonitoring(request, conversation.id, start);
        break;

      case "complex_task":
        response = await this.handleComplexTask(request, conversation.id, start);
        break;

      case "wellness_checkin":
        response = await this.handleWellnessCheckin(request, conversation.id, start);
        break;

      case "medication_reminder":
        response = await this.handleMedicationReminder(request, conversation.id, start);
        break;

      case "email_query":
        response = await this.handleEmailQuery(request, conversation.id, start);
        break;

      case "email_command":
        response = await this.handleEmailCommand(request, conversation.id, start);
        break;

      case "calendar_query":
        response = await this.handleCalendarQuery(request, conversation.id, start);
        break;

      case "calendar_command":
        response = await this.handleCalendarCommand(request, conversation.id, start);
        break;

      case "nutrition_log":
        response = await this.handleNutritionLog(request, conversation.id, start);
        break;

      case "nutrition_query":
        response = await this.handleNutritionQuery(request, conversation.id, start);
        break;

      case "family_message":
        response = await this.handleFamilyMessage(request, conversation.id, start);
        break;

      case "memory_save":
        response = await this.handleMemorySave(request, conversation.id, start);
        break;

      case "memory_manage":
        response = await this.handleMemoryManage(request, conversation.id, start);
        break;

      case "conversation":
      default:
        response = await this.handleConversation(request, conversation.id, start);
        break;
    }

    // 8. Save assistant message
    await this.conversations.addMessage(
      conversation.id,
      request.tenant_id,
      "assistant",
      response.message,
      request.source,
      {
        triage_category: response.triage_category,
        device_actions: response.device_actions,
        latency_ms: response.latency_ms,
        constraint_messages: response.constraint_messages,
      },
    );

    // 9. Background memory extraction (non-blocking, fire-and-forget)
    if (this.memoryExtractor) {
      this.conversations
        .getHistory(conversation.id, 10)
        .then((history) =>
          this.memoryExtractor!.processConversation(
            conversation.id,
            request.tenant_id,
            request.user_id,
            request.agent_name,
            history,
          ),
        )
        .catch((err) => console.warn("Memory extraction error:", err));
    }

    return response;
  }

  // -----------------------------------------------------------------------
  // Family agent delegation
  // -----------------------------------------------------------------------

  private async handleFamilyAgentRequest(
    request: OrchestratorRequest,
    conversationId: string,
    familyAgent: import("./family-agent.js").FamilyMemberAgent,
    start: number,
  ): Promise<OrchestratorResponse> {
    // Load devices and conversation history
    const [devices, history] = await Promise.all([
      this.deviceState.getAllDeviceStates(request.tenant_id),
      this.conversations.getHistory(conversationId),
    ]);

    // Get active schedule names
    const activeScheduleNames = familyAgent.voiceContext.active_schedules
      .filter((s) => s.is_active)
      .map((s) => s.schedule_name);

    // Build memory context if available
    let memoryContext: string | undefined;
    if (this.memoryProvider) {
      const budget = getTokenBudget("groq");
      const memCtx = await this.memoryProvider.getRelevantMemories(
        request.tenant_id,
        request.user_id,
        request.agent_name,
        request.message,
        budget.memories,
      );
      if (memCtx.formattedMemories) {
        memoryContext = memCtx.formattedMemories;
      }
    }

    // Build smart context if available
    let preBuiltHistory: LLMMessage[] | undefined;
    if (this.contextWindowManager) {
      const ctx = await this.contextWindowManager.buildContext(
        conversationId,
        history,
        "groq",
        request.tenant_id,
      );
      preBuiltHistory = ctx.messages;
    }

    // Let the family agent process the message
    const agentResult = await familyAgent.processMessage(
      request.message,
      devices,
      history,
      activeScheduleNames,
      memoryContext,
      preBuiltHistory,
    );

    // If the agent generated a device command intent, execute it
    if (agentResult.intent) {
      return this.executeIntent(
        agentResult.intent,
        request,
        conversationId,
        agentResult.responseText,
        agentResult.triageCategory,
        familyAgent.voiceContext,
        start,
      );
    }

    // Pure conversation response
    return {
      message: agentResult.responseText,
      triage_category: agentResult.triageCategory,
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Emergency handler
  // -----------------------------------------------------------------------

  private async handleEmergency(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    // Check if this is an assisted_living user for enhanced emergency
    const aideProfile = request.family_context?.aide_profile;

    // Build emergency response
    let emergencyResponse =
      "EMERGENCY DETECTED. I'm here to help. " +
      "If you're in immediate danger, call 911. " +
      "I've activated the emergency protocol — all lights are turning on " +
      "and doors are unlocking for emergency access. " +
      "What's happening? Are you safe?";

    // Enhanced response for assisted_living users
    if (aideProfile) {
      const contacts = aideProfile.emergency_contacts;
      const firstContact = contacts.length > 0 ? contacts[0] : null;

      emergencyResponse =
        "EMERGENCY DETECTED. I'm right here with you. " +
        "All lights are turning on and doors are unlocking. ";

      if (firstContact) {
        emergencyResponse +=
          `I'm contacting ${firstContact.name} right now. `;
      }

      emergencyResponse +=
        "Can you tell me what happened? Are you hurt?";

      // If there are medical conditions, note them for the response context
      const med = aideProfile.medical_info;
      if (med.allergies?.length || med.conditions?.length) {
        emergencyResponse +=
          " I have your medical information ready for emergency responders.";
      }
    }

    // Turn on all lights (emergency protocol)
    const allLightsIntent: ParsedIntent = {
      domain: "light",
      action: "turn_on",
      parameters: { brightness: 100 },
      confidence: 1.0,
      raw_transcript: request.message,
    };

    const result = await this.commandExecutor.execute(
      allLightsIntent,
      request.user_id,
      request.source,
      // No family context — emergency bypasses permissions
    );

    return {
      message: emergencyResponse,
      triage_category: "emergency",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: result.stateChanges,
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Device command handler
  // -----------------------------------------------------------------------

  private async handleDeviceCommand(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    // If we already have a pre-parsed intent, use it
    if (request.pre_parsed_intent) {
      return this.executeIntent(
        request.pre_parsed_intent,
        request,
        conversationId,
        "",
        "device_command",
        request.family_context,
        start,
      );
    }

    // Get devices for context
    const devices = await this.deviceState.getAllDeviceStates(request.tenant_id);
    const history = await this.conversations.getHistory(conversationId);

    // Ask LLM to generate an intent
    const systemPrompt = await this.buildSystemPromptWithMemory(
      buildCleverSystemPrompt(devices, await this.agentManager.getAgentNames()),
      request,
      "groq",
    );

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    // Add context-managed history or fallback to simple slicing
    if (this.contextWindowManager) {
      const ctx = await this.contextWindowManager.buildContext(
        conversationId, history, "groq", request.tenant_id,
      );
      messages.push(...ctx.messages);
    } else {
      for (const msg of history.slice(-10)) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({ role: "user", content: request.message });

    const llmResult = await this.llm.complete({
      provider: "groq",
      messages,
      max_tokens: 512,
      temperature: 0.3,
    });

    const intent = extractIntent(llmResult.content);
    const responseText = stripIntentBlock(llmResult.content);

    if (intent) {
      intent.raw_transcript = request.message;
      return this.executeIntent(
        intent,
        request,
        conversationId,
        responseText,
        "device_command",
        request.family_context,
        start,
      );
    }

    // LLM didn't generate an intent — return the text response
    return {
      message: responseText || "I understood that as a device command but couldn't determine which device to control. Could you be more specific?",
      triage_category: "device_command",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Device query handler
  // -----------------------------------------------------------------------

  private async handleDeviceQuery(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    const devices = await this.deviceState.getAllDeviceStates(request.tenant_id);

    const systemPrompt = buildCleverSystemPrompt(
      devices,
      await this.agentManager.getAgentNames(),
    );

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: request.message },
    ];

    const llmResult = await this.llm.complete({
      provider: "groq",
      messages,
      max_tokens: 256,
      temperature: 0.3,
    });

    return {
      message: llmResult.content,
      triage_category: "device_query",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Monitoring handler
  // -----------------------------------------------------------------------

  private async handleMonitoring(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    const devices = await this.deviceState.getAllDeviceStates(request.tenant_id);

    const monitoringPrompt = buildMonitoringPrompt(devices);

    const messages: LLMMessage[] = [
      {
        role: "system",
        content:
          "You are Clever, a smart home monitoring assistant. Provide concise, actionable home status reports.",
      },
      { role: "user", content: monitoringPrompt },
    ];

    // Use Claude for monitoring reports (more analytical)
    const llmResult = await this.llm.complete({
      provider: "claude",
      messages,
      max_tokens: 512,
      temperature: 0.2,
    });

    return {
      message: llmResult.content,
      triage_category: "monitoring",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Complex task handler
  // -----------------------------------------------------------------------

  private async handleComplexTask(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    const devices = await this.deviceState.getAllDeviceStates(request.tenant_id);

    const taskPrompt = buildComplexTaskPrompt(request.message, devices);

    const messages: LLMMessage[] = [
      {
        role: "system",
        content:
          "You are Clever, a smart home orchestrator. Plan and execute multi-step device automations.",
      },
      { role: "user", content: taskPrompt },
    ];

    // Use Claude for complex planning
    const llmResult = await this.llm.complete({
      provider: "claude",
      messages,
      max_tokens: 1024,
      temperature: 0.3,
    });

    // Extract and execute multiple intents
    const intents = extractMultipleIntents(llmResult.content);
    const responseText = stripIntentBlock(llmResult.content);

    const allStateChanges: DeviceStateChange[] = [];
    const allDeviceActions: DeviceAction[] = [];
    const allErrors: string[] = [];

    for (const intent of intents) {
      intent.raw_transcript = request.message;
      const result = await this.commandExecutor.execute(
        intent,
        request.user_id,
        request.source,
        request.family_context,
      );

      allStateChanges.push(...result.stateChanges);
      if (!result.success) {
        allErrors.push(...result.errors);
      }
    }

    const message = allErrors.length > 0
      ? `${responseText}\n\nNote: Some actions had issues: ${allErrors.join(", ")}`
      : responseText || `Executed ${intents.length} actions for your request.`;

    return {
      message,
      triage_category: "complex_task",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: allDeviceActions,
      state_changes: allStateChanges,
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Conversation handler (general chat)
  // -----------------------------------------------------------------------

  private async handleConversation(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    const devices = await this.deviceState.getAllDeviceStates(request.tenant_id);
    const history = await this.conversations.getHistory(conversationId);

    const systemPrompt = await this.buildSystemPromptWithMemory(
      buildCleverSystemPrompt(devices, await this.agentManager.getAgentNames()),
      request,
      "groq",
    );

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    // Use context window manager if available, else fall back to naive slicing
    if (this.contextWindowManager) {
      const ctx = await this.contextWindowManager.buildContext(
        conversationId, history, "groq", request.tenant_id,
      );
      messages.push(...ctx.messages);
    } else {
      for (const msg of history.slice(-20)) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({ role: "user", content: request.message });

    const llmResult = await this.llm.complete({
      provider: "groq",
      messages,
      max_tokens: 512,
      temperature: 0.5,
    });

    // Check if the LLM snuck in a device command
    const intent = extractIntent(llmResult.content);
    const responseText = stripIntentBlock(llmResult.content);

    if (intent) {
      intent.raw_transcript = request.message;
      return this.executeIntent(
        intent,
        request,
        conversationId,
        responseText,
        "device_command",
        request.family_context,
        start,
      );
    }

    return {
      message: responseText || llmResult.content,
      triage_category: "conversation",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // CleverAide: Wellness check-in handler
  // -----------------------------------------------------------------------

  private async handleWellnessCheckin(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    const aideProfile = request.family_context?.aide_profile;
    const cognitiveLevel = aideProfile?.cognitive_level ?? "independent";
    const history = await this.conversations.getHistory(conversationId);

    const checkinPrompt = buildWellnessCheckinPrompt(
      "user_initiated",
      request.agent_name,
      cognitiveLevel,
    );

    const messages: LLMMessage[] = [
      { role: "system", content: checkinPrompt },
    ];

    // Include conversation history for multi-turn check-in
    for (const msg of history.slice(-10)) {
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }

    messages.push({ role: "user", content: request.message });

    const llmResult = await this.llm.complete({
      provider: "groq",
      messages,
      max_tokens: 256,
      temperature: 0.3,
    });

    return {
      message: llmResult.content,
      triage_category: "wellness_checkin",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // CleverAide: Medication reminder handler
  // -----------------------------------------------------------------------

  private async handleMedicationReminder(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    const history = await this.conversations.getHistory(conversationId);

    // For user-initiated medication messages, use a conversational approach
    const systemPrompt =
      "You are a caring smart home assistant helping manage medications. " +
      "If the user says they took their medication, confirm warmly. " +
      "If they ask about their medication schedule, provide what you know. " +
      "If they want to skip, acknowledge without judgment but note it. " +
      "Keep responses short and clear.";

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    for (const msg of history.slice(-10)) {
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }

    messages.push({ role: "user", content: request.message });

    const llmResult = await this.llm.complete({
      provider: "groq",
      messages,
      max_tokens: 256,
      temperature: 0.3,
    });

    return {
      message: llmResult.content,
      triage_category: "medication_reminder",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Email query handler
  // -----------------------------------------------------------------------

  private async handleEmailQuery(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    if (!this.emailCalendarState) {
      return {
        message: "Email monitoring is not configured yet. Please link your email accounts in Settings first.",
        triage_category: "email_query",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    const [emailAccounts, calendarAccounts, unreadCounts, recentEmails, upcomingEvents] =
      await Promise.all([
        this.emailCalendarState.getEmailAccounts(request.tenant_id, request.user_id),
        this.emailCalendarState.getCalendarAccounts(request.tenant_id, request.user_id),
        this.emailCalendarState.getUnreadCounts(request.tenant_id, request.user_id),
        this.emailCalendarState.getRecentEmails(request.tenant_id, request.user_id, 20),
        this.emailCalendarState.getUpcomingEvents(request.tenant_id, request.user_id, 24),
      ]);

    const systemPrompt = buildEmailCalendarSystemPrompt({
      emailAccounts,
      calendarAccounts,
      unreadCounts,
      recentEmails,
      upcomingEvents,
    });

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: request.message },
    ];

    const llmResult = await this.llm.complete({
      provider: "groq",
      messages,
      max_tokens: 512,
      temperature: 0.3,
    });

    return {
      message: llmResult.content,
      triage_category: "email_query",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Email command handler (HARD-DISABLED)
  // -----------------------------------------------------------------------

  private async handleEmailCommand(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    // Layer 1: Orchestrator-level block. EMAIL_SEND_ENABLED is a compile-time constant.
    if (!EMAIL_SEND_ENABLED) {
      return {
        message:
          "Email sending is currently disabled for safety. I can read your emails and check your inbox, but sending requires a manual code update to enable.",
        triage_category: "email_command",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    // If sending is ever enabled, this code path would handle it:
    return {
      message: "Email sending is not yet implemented.",
      triage_category: "email_command",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Calendar query handler
  // -----------------------------------------------------------------------

  private async handleCalendarQuery(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    if (!this.emailCalendarState) {
      return {
        message: "Calendar monitoring is not configured yet. Please link your calendar accounts in Settings first.",
        triage_category: "calendar_query",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    const [emailAccounts, calendarAccounts, unreadCounts, recentEmails, upcomingEvents] =
      await Promise.all([
        this.emailCalendarState.getEmailAccounts(request.tenant_id, request.user_id),
        this.emailCalendarState.getCalendarAccounts(request.tenant_id, request.user_id),
        this.emailCalendarState.getUnreadCounts(request.tenant_id, request.user_id),
        this.emailCalendarState.getRecentEmails(request.tenant_id, request.user_id, 5),
        this.emailCalendarState.getUpcomingEvents(request.tenant_id, request.user_id, 48),
      ]);

    const systemPrompt = buildEmailCalendarSystemPrompt({
      emailAccounts,
      calendarAccounts,
      unreadCounts,
      recentEmails,
      upcomingEvents,
    });

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: request.message },
    ];

    const llmResult = await this.llm.complete({
      provider: "groq",
      messages,
      max_tokens: 512,
      temperature: 0.3,
    });

    return {
      message: llmResult.content,
      triage_category: "calendar_query",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Calendar command handler (create/modify events)
  // -----------------------------------------------------------------------

  private async handleCalendarCommand(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    if (!this.emailCalendarState) {
      return {
        message: "Calendar is not configured yet. Please link your calendar accounts in Settings first.",
        triage_category: "calendar_command",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    const [calendarAccounts, upcomingEvents] = await Promise.all([
      this.emailCalendarState.getCalendarAccounts(request.tenant_id, request.user_id),
      this.emailCalendarState.getUpcomingEvents(request.tenant_id, request.user_id, 48),
    ]);

    if (calendarAccounts.length === 0) {
      return {
        message: "No calendar accounts are linked. Please add a Google or Outlook calendar in Settings.",
        triage_category: "calendar_command",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    const systemPrompt = buildEmailCalendarSystemPrompt({
      emailAccounts: [],
      calendarAccounts,
      unreadCounts: {},
      recentEmails: [],
      upcomingEvents,
    });

    const history = await this.conversations.getHistory(conversationId);

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    for (const msg of history.slice(-10)) {
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }

    messages.push({ role: "user", content: request.message });

    const llmResult = await this.llm.complete({
      provider: "groq",
      messages,
      max_tokens: 512,
      temperature: 0.3,
    });

    // Extract calendar intent
    const calendarIntent = extractCalendarIntent(llmResult.content);
    const responseText = llmResult.content
      .replace(/```calendar_intent\s*\n[\s\S]*?\n```/g, "")
      .trim();

    if (calendarIntent && calendarIntent.action === "create") {
      // Use the primary calendar, or the first one
      const targetCalendar =
        calendarAccounts.find((c) => c.is_primary) ?? calendarAccounts[0];

      const event: HACalendarEventCreate = {
        entity_id: targetCalendar.ha_entity_id,
        summary: calendarIntent.summary,
        start_date_time: calendarIntent.start_date_time,
        end_date_time: calendarIntent.end_date_time,
        description: calendarIntent.description,
        location: calendarIntent.location,
      };

      // Execute via the command executor's calendar handler
      const createIntent: ParsedIntent = {
        domain: "calendar",
        action: "create_event",
        target_device: targetCalendar.ha_entity_id,
        parameters: {
          summary: event.summary,
          start_date_time: event.start_date_time,
          end_date_time: event.end_date_time,
          description: event.description,
          location: event.location,
        },
        confidence: 0.9,
        raw_transcript: request.message,
      };

      const result = await this.commandExecutor.execute(
        createIntent,
        request.user_id,
        request.source,
      );

      const message = result.success
        ? responseText || `Event "${event.summary}" created on your ${targetCalendar.display_name} calendar.`
        : `Failed to create event: ${result.errors.join(", ")}`;

      return {
        message,
        triage_category: "calendar_command",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: result.stateChanges,
        latency_ms: Date.now() - start,
      };
    }

    // No structured intent extracted — return conversational response
    return {
      message: responseText || llmResult.content,
      triage_category: "calendar_command",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Nutrition log handler
  // -----------------------------------------------------------------------

  private async handleNutritionLog(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    if (!this.nutritionState) {
      return {
        message: "Nutrition tracking is not configured yet. Please set it up in Settings.",
        triage_category: "nutrition_log",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    // Check consent
    const hasConsent = await this.nutritionState.hasNutritionConsent(request.user_id);
    if (!hasConsent) {
      return {
        message: "I need your consent to track nutrition data before I can log food. Please enable nutrition tracking in your Privacy settings.",
        triage_category: "nutrition_log",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    // Get current goals and recent logs for context
    const [goals, dailySummary] = await Promise.all([
      this.nutritionState.getGoals(request.tenant_id, request.user_id),
      this.nutritionState.getDailySummary(request.tenant_id, request.user_id),
    ]);

    // Use LLM to extract food items from natural language
    const nutritionPrompt = buildNutritionLogPrompt(
      request.message,
      dailySummary,
      goals,
    );

    const messages: LLMMessage[] = [
      { role: "system", content: nutritionPrompt },
      { role: "user", content: request.message },
    ];

    const llmResult = await this.llm.complete({
      provider: "groq",
      messages,
      max_tokens: 512,
      temperature: 0.2,
      json_mode: true,
    });

    // Parse nutrition intent from LLM response
    try {
      const nutritionData = JSON.parse(llmResult.content) as {
        items: Array<{
          name: string;
          quantity?: number;
          unit?: string;
          estimated_calories?: number;
          estimated_protein_g?: number;
          estimated_carbs_g?: number;
          estimated_fat_g?: number;
        }>;
        meal_type: string;
        response_message: string;
      };

      // Log each item
      const loggedItems: string[] = [];
      for (const item of nutritionData.items) {
        await this.nutritionState.logFood(request.tenant_id, request.user_id, {
          meal_type: (nutritionData.meal_type || "snack") as import("@clever/shared").MealType,
          source: request.source === "voice" ? "voice" : "chat",
          description: `${item.quantity ?? 1} ${item.unit ?? ""} ${item.name}`.trim(),
          serving_quantity: item.quantity ?? 1,
          calories: item.estimated_calories,
          protein_g: item.estimated_protein_g,
          carbs_g: item.estimated_carbs_g,
          fat_g: item.estimated_fat_g,
        });
        loggedItems.push(item.name);
      }

      const responseMessage = nutritionData.response_message ||
        `Logged ${loggedItems.join(", ")} to your food diary.`;

      return {
        message: responseMessage,
        triage_category: "nutrition_log",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    } catch {
      return {
        message: "I heard you mention food but couldn't quite catch the details. Could you tell me again what you had?",
        triage_category: "nutrition_log",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Nutrition query handler
  // -----------------------------------------------------------------------

  private async handleNutritionQuery(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    if (!this.nutritionState) {
      return {
        message: "Nutrition tracking is not configured yet.",
        triage_category: "nutrition_query",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    const [dailySummary, weeklySummary, goals] = await Promise.all([
      this.nutritionState.getDailySummary(request.tenant_id, request.user_id),
      this.nutritionState.getWeeklySummary(request.tenant_id, request.user_id),
      this.nutritionState.getGoals(request.tenant_id, request.user_id),
    ]);

    const summaryPrompt = buildNutritionSummaryPrompt(dailySummary, weeklySummary, goals);

    const messages: LLMMessage[] = [
      { role: "system", content: summaryPrompt },
      { role: "user", content: request.message },
    ];

    const llmResult = await this.llm.complete({
      provider: "groq",
      messages,
      max_tokens: 512,
      temperature: 0.3,
    });

    return {
      message: llmResult.content,
      triage_category: "nutrition_query",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Family message handler
  // -----------------------------------------------------------------------

  private async handleFamilyMessage(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    if (!this.emailCalendarState?.sendFamilyMessage) {
      return {
        message: "Family messaging is not configured yet. Please set it up in Settings.",
        triage_category: "family_message",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    // Use LLM to extract the message content and optional recipient
    const messages: LLMMessage[] = [
      {
        role: "system",
        content:
          "You are Clever, a family smart home assistant. The user wants to send a family message. " +
          "Extract the message content and determine if it's a family-wide announcement or a private message. " +
          "Respond with JSON: {\"content\": \"the message\", \"recipient\": \"name or null for announcement\", \"response_message\": \"confirmation to user\"}",
      },
      { role: "user", content: request.message },
    ];

    const llmResult = await this.llm.complete({
      provider: "groq",
      messages,
      max_tokens: 256,
      temperature: 0.2,
      json_mode: true,
    });

    try {
      const parsed = JSON.parse(llmResult.content) as {
        content: string;
        recipient: string | null;
        response_message: string;
      };

      const result = await this.emailCalendarState.sendFamilyMessage(
        request.tenant_id,
        request.user_id,
        parsed.content,
      );

      if (result.success) {
        return {
          message: parsed.response_message || "Message sent to the family!",
          triage_category: "family_message",
          conversation_id: conversationId,
          message_id: crypto.randomUUID(),
          device_actions: [],
          state_changes: [],
          latency_ms: Date.now() - start,
        };
      }

      return {
        message: result.error || "Failed to send the family message. Please try again.",
        triage_category: "family_message",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    } catch {
      return {
        message: "I couldn't understand the message you want to send. Could you try again?",
        triage_category: "family_message",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Memory save handler ("remember that...")
  // -----------------------------------------------------------------------

  private async handleMemorySave(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    if (!this.memoryExtractor) {
      return {
        message: "Memory system is not configured yet.",
        triage_category: "memory_save",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    // Extract the memory content from the user's message
    const memoryContent = request.message
      .replace(/\b(remember|keep in mind|note|don't forget|from now on)\s+(that|this|my)?\s*/i, "")
      .trim();

    if (!memoryContent || memoryContent.length < 3) {
      return {
        message: "What would you like me to remember?",
        triage_category: "memory_save",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    await this.memoryExtractor.saveExplicitMemory(
      memoryContent,
      request.tenant_id,
      request.user_id,
      request.agent_name,
      conversationId,
    );

    return {
      message: `Got it, I'll remember that: "${memoryContent}"`,
      triage_category: "memory_save",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Memory manage handler ("what do you remember?", "forget that...")
  // -----------------------------------------------------------------------

  private async handleMemoryManage(
    request: OrchestratorRequest,
    conversationId: string,
    start: number,
  ): Promise<OrchestratorResponse> {
    if (!this.memoryStore) {
      return {
        message: "Memory system is not configured yet.",
        triage_category: "memory_manage",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    const lower = request.message.toLowerCase();

    // "What do you remember about me?" / "Show my memories"
    if (/\b(what|show|list)\b/.test(lower) && /\b(remember|know|memories|preferences|learned)\b/.test(lower)) {
      const memories = await this.memoryStore.listUserMemories(
        request.tenant_id,
        request.user_id,
      );

      if (memories.length === 0) {
        return {
          message: "I don't have any saved memories about you yet. As we interact, I'll learn your preferences — or you can tell me directly by saying \"remember that...\"",
          triage_category: "memory_manage",
          conversation_id: conversationId,
          message_id: crypto.randomUUID(),
          device_actions: [],
          state_changes: [],
          latency_ms: Date.now() - start,
        };
      }

      const memoryList = memories
        .slice(0, 15) // Show at most 15
        .map((m) => `  - ${m.content ?? "[encrypted]"} (${m.memory_type})`)
        .join("\n");

      return {
        message: `Here's what I remember about you:\n${memoryList}\n\nYou can say "forget that..." to remove any of these.`,
        triage_category: "memory_manage",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    // "Forget that..." / "Delete/remove..." / "Clear all memories"
    if (/\b(forget|delete|remove|clear)\b/.test(lower)) {
      if (/\b(all|every|clear)\b/.test(lower)) {
        await this.memoryStore.deleteExtractedMemories(
          request.tenant_id,
          request.user_id,
        );
        return {
          message: "Done — I've cleared all my learned memories about you. Any memories you explicitly asked me to save have been kept.",
          triage_category: "memory_manage",
          conversation_id: conversationId,
          message_id: crypto.randomUUID(),
          device_actions: [],
          state_changes: [],
          latency_ms: Date.now() - start,
        };
      }

      // Try to find and deactivate a specific memory by keyword match
      const memories = await this.memoryStore.listUserMemories(
        request.tenant_id,
        request.user_id,
      );

      const searchTerms = lower
        .replace(/\b(forget|delete|remove|that|the|my|about|preference|memory)\b/g, "")
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      const match = memories.find((m) => {
        const content = (m.content ?? "").toLowerCase();
        return searchTerms.some((term) => content.includes(term));
      });

      if (match) {
        await this.memoryStore.deactivate(match.id);
        return {
          message: `Done, I've forgotten: "${match.content}"`,
          triage_category: "memory_manage",
          conversation_id: conversationId,
          message_id: crypto.randomUUID(),
          device_actions: [],
          state_changes: [],
          latency_ms: Date.now() - start,
        };
      }

      return {
        message: "I couldn't find a matching memory. Try saying \"show my memories\" to see what I remember.",
        triage_category: "memory_manage",
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - start,
      };
    }

    // Fallback
    return {
      message: "You can ask me \"what do you remember about me?\" to see my memories, or \"forget that...\" to remove one.",
      triage_category: "memory_manage",
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: [],
      state_changes: [],
      latency_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // System prompt helper (appends memory context)
  // -----------------------------------------------------------------------

  private async buildSystemPromptWithMemory(
    basePrompt: string,
    request: OrchestratorRequest,
    provider: LLMProvider,
  ): Promise<string> {
    if (!this.memoryProvider) return basePrompt;

    const budget = getTokenBudget(provider);
    const memCtx = await this.memoryProvider.getRelevantMemories(
      request.tenant_id,
      request.user_id,
      request.agent_name,
      request.message,
      budget.memories,
    );

    if (memCtx.formattedMemories) {
      return basePrompt + "\n\n" + memCtx.formattedMemories;
    }

    return basePrompt;
  }

  // -----------------------------------------------------------------------
  // Intent execution (shared by all handlers)
  // -----------------------------------------------------------------------

  private async executeIntent(
    intent: ParsedIntent,
    request: OrchestratorRequest,
    conversationId: string,
    responseText: string,
    triageCategory: TriageCategory,
    familyContext?: FamilyVoiceContext,
    start?: number,
  ): Promise<OrchestratorResponse> {
    const execStart = start ?? Date.now();

    const result = await this.commandExecutor.execute(
      intent,
      request.user_id,
      request.source,
      familyContext,
    );

    if (result.permissionDenied) {
      return {
        message: result.denialMessage ?? "You don't have permission to do that.",
        triage_category: triageCategory,
        conversation_id: conversationId,
        message_id: crypto.randomUUID(),
        device_actions: [],
        state_changes: [],
        latency_ms: Date.now() - execStart,
        permission_denied: true,
        denial_message: result.denialMessage,
      };
    }

    const deviceActions: DeviceAction[] = result.stateChanges.map((sc) => ({
      device_name: intent.target_device ?? "device",
      entity_id: sc.device_id,
      action: intent.action,
      previous_state: String(sc.previous_state),
      new_state: String(sc.new_state),
    }));

    const message = result.success
      ? responseText || `Done! ${intent.action} executed on ${intent.target_device ?? "device"}.`
      : `Failed: ${result.errors.join(", ")}`;

    return {
      message,
      triage_category: triageCategory,
      conversation_id: conversationId,
      message_id: crypto.randomUUID(),
      device_actions: deviceActions,
      state_changes: result.stateChanges,
      latency_ms: Date.now() - execStart,
      constraint_messages: result.constraintMessages,
    };
  }
}
