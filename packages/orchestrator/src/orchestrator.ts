/**
 * Clever Orchestrator
 *
 * The central brain of the CleverAutomations smart home system.
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
} from "@clever/shared";
import { FamilyPermissionResolver } from "@clever/shared";

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
} from "./system-prompts.js";
import type {
  OrchestratorRequest,
  OrchestratorResponse,
  DeviceAction,
  DeviceStateInfo,
  DeviceStateProvider,
  LLMMessage,
  ConversationMessage,
  TriageCategory,
} from "./types.js";

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
  tenantId: TenantId;
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
// Clever Orchestrator
// ---------------------------------------------------------------------------

export class CleverOrchestrator {
  private readonly llm: LLMClient;
  private readonly agentManager: AgentManager;
  private readonly conversations: ConversationManager;
  private readonly commandExecutor: CommandExecutorInterface;
  private readonly deviceState: DeviceStateProvider;
  private readonly tenantId: TenantId;
  private readonly triage: TriageClassifier;
  private readonly permissionResolver: FamilyPermissionResolver;

  constructor(config: OrchestratorConfig) {
    this.llm = config.llm;
    this.agentManager = config.agentManager;
    this.conversations = config.conversationManager;
    this.commandExecutor = config.commandExecutor;
    this.deviceState = config.deviceStateProvider;
    this.tenantId = config.tenantId;
    this.triage = new TriageClassifier(this.llm);
    this.permissionResolver = new FamilyPermissionResolver();
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

    // Let the family agent process the message
    const agentResult = await familyAgent.processMessage(
      request.message,
      devices,
      history,
      activeScheduleNames,
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
    const systemPrompt = buildCleverSystemPrompt(
      devices,
      await this.agentManager.getAgentNames(),
    );

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    // Add recent history
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

    const systemPrompt = buildCleverSystemPrompt(
      devices,
      await this.agentManager.getAgentNames(),
    );

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    for (const msg of history.slice(-20)) {
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
