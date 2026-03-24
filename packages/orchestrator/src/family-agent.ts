/**
 * Family Member Agent
 *
 * A lightweight, stateless agent scoped to a family member's personality,
 * permissions, and allowed devices. Instantiated per-request by the
 * AgentManager, not a persistent process.
 */

import type {
  FamilyVoiceContext,
  WakeWordEntry,
  ParsedIntent,
  UserId,
} from "@clever/shared";
import { FamilyPermissionResolver } from "@clever/shared";
import type { LLMClient } from "./llm-client.js";
import type {
  LLMMessage,
  DeviceStateInfo,
  ConversationMessage,
  OrchestratorResponse,
  TriageCategory,
} from "./types.js";
import {
  buildFamilyAgentSystemPrompt,
} from "./system-prompts.js";

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

function stripIntentBlock(response: string): string {
  return response.replace(/```intent\s*\n[\s\S]*?\n```/, "").trim();
}

// ---------------------------------------------------------------------------
// Family Member Agent
// ---------------------------------------------------------------------------

export class FamilyMemberAgent {
  readonly agentName: string;
  readonly voiceContext: FamilyVoiceContext;
  readonly wakeWordEntry: WakeWordEntry;

  private readonly llm: LLMClient;
  private readonly permissionResolver: FamilyPermissionResolver;

  constructor(
    llm: LLMClient,
    voiceContext: FamilyVoiceContext,
    wakeWordEntry: WakeWordEntry,
  ) {
    this.llm = llm;
    this.voiceContext = voiceContext;
    this.wakeWordEntry = wakeWordEntry;
    this.agentName = wakeWordEntry.agent_name;
    this.permissionResolver = new FamilyPermissionResolver();
  }

  /**
   * Process a user message through this family agent.
   * Returns the LLM response text and any extracted intent.
   */
  async processMessage(
    message: string,
    allowedDevices: DeviceStateInfo[],
    conversationHistory: ConversationMessage[],
    activeScheduleNames: string[],
  ): Promise<{
    responseText: string;
    intent: ParsedIntent | null;
    triageCategory: TriageCategory;
  }> {
    // Build the system prompt scoped to this agent
    const systemPrompt = buildFamilyAgentSystemPrompt(
      this.wakeWordEntry,
      allowedDevices,
      activeScheduleNames,
    );

    // Build message history
    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    // Add conversation history (last 20 messages for context)
    const recentHistory = conversationHistory.slice(-20);
    for (const msg of recentHistory) {
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }

    // Add the current message
    messages.push({ role: "user", content: message });

    // Call LLM
    const result = await this.llm.complete({
      provider: "groq",
      messages,
      max_tokens: 512,
      temperature: 0.4,
    });

    // Extract intent from response if present
    const intent = extractIntent(result.content);
    const responseText = stripIntentBlock(result.content);

    // Determine category based on whether an intent was generated
    const triageCategory: TriageCategory = intent
      ? "device_command"
      : "conversation";

    return { responseText, intent, triageCategory };
  }

  /**
   * Get the TTS voice ID for this agent.
   */
  getVoiceId(): string | null {
    return this.wakeWordEntry.voice_id;
  }
}
