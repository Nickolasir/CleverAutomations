/**
 * Triage Classifier
 *
 * Classifies incoming requests into categories that determine how the
 * orchestrator handles them. Uses a fast LLM call (Groq) to classify,
 * with regex pre-checks for obvious cases.
 */

import type { ParsedIntent } from "@clever/shared";
import type { LLMClient } from "./llm-client.js";
import type { TriageCategory, TriageResult, LLMMessage } from "./types.js";

// ---------------------------------------------------------------------------
// Emergency patterns (bypass LLM — immediate classification)
// ---------------------------------------------------------------------------

const EMERGENCY_PATTERNS = [
  /\b(help|emergency|fire|hurt|danger|911|ambulance|police|injured|bleeding)\b/i,
  /\b(i('m| am) (scared|hurt|in danger|not (okay|ok|safe)))\b/i,
  /\b(call (for )?(help|911|an ambulance|the police))\b/i,
  /\bsos\b/i,
];

// ---------------------------------------------------------------------------
// Device command patterns (skip LLM for obvious commands)
// ---------------------------------------------------------------------------

const DEVICE_COMMAND_PATTERNS = [
  /\b(turn|switch)\s+(on|off)\b/i,
  /\b(dim|brighten)\b/i,
  /\bset\s+(temperature|temp|brightness|volume)\b/i,
  /\b(lock|unlock)\s+(the\s+)?(front|back|garage)?\s*(door|lock)/i,
  /\b(open|close)\s+(the\s+)?(blinds|curtains|shades|garage)/i,
  /\bactivate\s+(scene|mode)\b/i,
];

// ---------------------------------------------------------------------------
// Device query patterns
// ---------------------------------------------------------------------------

const DEVICE_QUERY_PATTERNS = [
  /\b(is|are)\s+(the\s+)?.+\s+(on|off|locked|unlocked|open|closed)\b/i,
  /\bwhat('s| is)\s+(the\s+)?(temperature|temp|status|state)\b/i,
  /\bhow\s+(hot|cold|warm|bright)\b/i,
  /\bstatus\s+of\b/i,
];

// ---------------------------------------------------------------------------
// Monitoring patterns
// ---------------------------------------------------------------------------

const MONITORING_PATTERNS = [
  /\b(all|every)\s+device(s)?\s+(online|connected|working|status)\b/i,
  /\bsystem\s+(health|status|check|report)\b/i,
  /\b(anything|something)\s+(wrong|offline|disconnected)\b/i,
  /\bdevice(s)?\s+(offline|disconnected|not responding)\b/i,
  /\bhome\s+(status|report|summary)\b/i,
];

// ---------------------------------------------------------------------------
// CleverAide wellness / medication patterns
// ---------------------------------------------------------------------------

const WELLNESS_PATTERNS = [
  /\b(how (am|are) (i|you)|feeling|wellness|check.?in|pain)\b/i,
  /\b(i('m| am) (confused|lost|dizzy|cold|hot|uncomfortable|nauseous))\b/i,
  /\b(i (don't|do not) feel (well|good|right))\b/i,
  /\b(something('s| is) wrong( with me)?)\b/i,
];

const MEDICATION_PATTERNS = [
  /\b(medication|medicine|pill|meds|prescription|dose|dosage)\b/i,
  /\b(did i take|have i taken|time (for|to take))\b/i,
  /\b(i took|i('ve| have) taken|skip(ped)?)\b/i,
];

// ---------------------------------------------------------------------------
// Complex task patterns
// ---------------------------------------------------------------------------

const COMPLEX_TASK_PATTERNS = [
  /\b(get|make)\s+(the\s+)?(house|home)\s+(ready|set up)\b/i,
  /\b(bedtime|morning|movie|dinner|party)\s+(routine|mode|time)\b/i,
  /\bset\s+up\s+(for|the)\b/i,
  /\b(good\s+)?(morning|night|evening)\s+routine\b/i,
  /\bwhen\s+I\s+(leave|get home|wake up)\b/i,
];

// ---------------------------------------------------------------------------
// Triage classifier
// ---------------------------------------------------------------------------

const TRIAGE_SYSTEM_PROMPT = `You are a smart home request classifier. Given a user message, classify it into exactly ONE category.

Categories:
- device_command: Direct device control (turn on/off, set temperature, lock, dim, etc.)
- device_query: Asking about device state (is the door locked? what's the temperature?)
- monitoring: System-wide health or status checks (are all devices online?)
- conversation: General questions, chitchat, or requests not related to device control
- complex_task: Multi-step tasks that require planning multiple device actions (bedtime routine, movie mode)
- emergency: Distress signals or urgent safety situations
- wellness_checkin: User reporting how they feel, health concerns, or responding to a check-in
- medication_reminder: Anything about medications, pills, prescriptions, taking/skipping doses

Respond with ONLY a JSON object: {"category": "<category>", "confidence": <0.0-1.0>}`;

export class TriageClassifier {
  private readonly llm: LLMClient;

  constructor(llm: LLMClient) {
    this.llm = llm;
  }

  /**
   * Classify a user message into a triage category.
   * Uses regex pre-checks for speed, falls back to LLM for ambiguous cases.
   */
  async classify(message: string): Promise<TriageResult> {
    // 1. Emergency — instant, no LLM needed
    if (EMERGENCY_PATTERNS.some((p) => p.test(message))) {
      return { category: "emergency", confidence: 1.0 };
    }

    // 2. Try regex pre-checks for common patterns
    const regexResult = this.regexClassify(message);
    if (regexResult && regexResult.confidence >= 0.85) {
      return regexResult;
    }

    // 3. LLM classification for ambiguous messages
    return this.llmClassify(message);
  }

  private regexClassify(message: string): TriageResult | null {
    // CleverAide: medication patterns (before device commands to avoid false matches)
    if (MEDICATION_PATTERNS.some((p) => p.test(message))) {
      return { category: "medication_reminder", confidence: 0.85 };
    }

    // CleverAide: wellness patterns
    if (WELLNESS_PATTERNS.some((p) => p.test(message))) {
      return { category: "wellness_checkin", confidence: 0.85 };
    }

    if (DEVICE_COMMAND_PATTERNS.some((p) => p.test(message))) {
      return { category: "device_command", confidence: 0.9 };
    }

    if (DEVICE_QUERY_PATTERNS.some((p) => p.test(message))) {
      return { category: "device_query", confidence: 0.85 };
    }

    if (MONITORING_PATTERNS.some((p) => p.test(message))) {
      return { category: "monitoring", confidence: 0.9 };
    }

    if (COMPLEX_TASK_PATTERNS.some((p) => p.test(message))) {
      return { category: "complex_task", confidence: 0.85 };
    }

    return null;
  }

  private async llmClassify(message: string): Promise<TriageResult> {
    const messages: LLMMessage[] = [
      { role: "system", content: TRIAGE_SYSTEM_PROMPT },
      { role: "user", content: message },
    ];

    try {
      const result = await this.llm.complete({
        provider: "groq",
        messages,
        max_tokens: 64,
        temperature: 0.1,
        json_mode: true,
      });

      const parsed = JSON.parse(result.content) as {
        category: string;
        confidence: number;
      };

      const validCategories: TriageCategory[] = [
        "device_command",
        "device_query",
        "monitoring",
        "conversation",
        "complex_task",
        "emergency",
        "wellness_checkin",
        "medication_reminder",
      ];

      const category = validCategories.includes(parsed.category as TriageCategory)
        ? (parsed.category as TriageCategory)
        : "conversation";

      return {
        category,
        confidence: Math.min(Math.max(parsed.confidence ?? 0.5, 0), 1),
      };
    } catch {
      // If LLM fails, default to conversation (safest fallback)
      return { category: "conversation", confidence: 0.5 };
    }
  }
}
