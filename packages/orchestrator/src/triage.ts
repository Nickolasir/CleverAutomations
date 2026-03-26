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
// Email patterns
// ---------------------------------------------------------------------------

const EMAIL_QUERY_PATTERNS = [
  /\b(do i have|any|check|new|unread)\s*(new\s+)?(emails?|mail|inbox|messages?)\b/i,
  /\b(read|show|list|open)\s+(my\s+)?(emails?|mail|inbox)\b/i,
  /\bwho\s+(emailed|sent|wrote)\s+(me|to me)\b/i,
  /\b(how many|number of)\s+(unread\s+)?(emails?|messages?)\b/i,
  /\bwhat('s| is) in my\s+(inbox|email|mail)\b/i,
  /\b(latest|recent|newest)\s+(emails?|messages?|mail)\b/i,
];

const EMAIL_COMMAND_PATTERNS = [
  /\b(send|compose|write|draft|reply|forward)\s+(an?\s+)?(email|mail|message)\b/i,
  /\bemail\s+\w+\s+(about|regarding)\b/i,
  /\breply\s+to\s+.+('s|s)?\s+(email|message)\b/i,
];

// ---------------------------------------------------------------------------
// Calendar patterns
// ---------------------------------------------------------------------------

const CALENDAR_QUERY_PATTERNS = [
  /\b(what('s| is)|any(thing)?)\s+(on\s+)?(my\s+)?(calendar|schedule|agenda)\b/i,
  /\bdo i have\s+(any\s+)?(meetings?|appointments?|events?)\b/i,
  /\b(when|what time)\s+(is|are)\s+(my\s+)?(next|today'?s?)\s+(meeting|appointment|event)\b/i,
  /\bam i free\s+(at|on|tomorrow|today|this)\b/i,
  /\bwhat('s| is)\s+(happening|scheduled)\s+(today|tomorrow|this week)\b/i,
  /\b(today'?s?|tomorrow'?s?|this week'?s?)\s+(schedule|agenda|calendar|events?)\b/i,
];

const CALENDAR_COMMAND_PATTERNS = [
  /\b(create|add|schedule|book|set up)\s+(a\s+)?(meeting|appointment|event|calendar)\b/i,
  /\b(cancel|delete|remove|move|reschedule)\s+(the\s+)?(meeting|appointment|event)\b/i,
  /\bput\s+.+\s+on\s+(my\s+)?calendar\b/i,
  /\bblock\s+(off|out)\s+(time|my calendar)\b/i,
];

// ---------------------------------------------------------------------------
// Nutrition patterns
// ---------------------------------------------------------------------------

const NUTRITION_LOG_PATTERNS = [
  /\bi\s+(just\s+)?(had|ate|drank|consumed|finished|grabbed)\b/i,
  /\b(log|record|add|track)\s+(my\s+)?(food|meal|breakfast|lunch|dinner|snack|drink|water)\b/i,
  /\bi\s+(had|ate|drank)\s+.+(for|at)\s+(breakfast|lunch|dinner)\b/i,
  /\b(had|ate|drank)\s+(a|an|some|the)\s+\w+/i,
];

const NUTRITION_QUERY_PATTERNS = [
  /\b(how many|what('s| is)\s+my|total)\s+(calories|macros|protein|carbs|fat)\b/i,
  /\b(nutrition|diet|calorie|macro)\s+(summary|report|today|this week|breakdown)\b/i,
  /\b(am i|have i)\s+(on track|over|under|met).*(calorie|protein|goal|target)\b/i,
  /\bwhat\s+(did i|have i)\s+(eat|eaten|drink|drunk|consume|consumed)\b/i,
  /\b(daily|weekly)\s+(nutrition|food|diet)\s+(log|diary|summary|report)\b/i,
];

// ---------------------------------------------------------------------------
// Family messaging patterns
// ---------------------------------------------------------------------------

const FAMILY_MESSAGE_PATTERNS = [
  /\b(send|post|share)\s+(a\s+|an\s+)?(family\s+)?(announcement|message|note)\b/i,
  /\b(message|text|tell)\s+(mom|dad|sister|brother|the family)\b/i,
  /\b(family|household)\s+(announcement|bulletin|update|message)\b/i,
  /\bannounce\s+to\s+(the\s+)?family\b/i,
];

// ---------------------------------------------------------------------------
// Memory patterns
// ---------------------------------------------------------------------------

const MEMORY_SAVE_PATTERNS = [
  /\b(remember|keep in mind|note|don't forget)\s+(that|this|my)\b/i,
  /\b(save|store)\s+(this|that|my)\s+(preference|setting|memory)\b/i,
  /\bfrom now on\b/i,
];

const MEMORY_MANAGE_PATTERNS = [
  /\b(forget|delete|remove)\s+(that|this|my)\s+(preference|memory|setting)\b/i,
  /\bwhat do you (remember|know) about me\b/i,
  /\bshow (my|all)\s+(memories|preferences|saved)\b/i,
  /\bclear (my|all)\s+(memories|preferences)\b/i,
  /\bwhat have you (learned|remembered)\b/i,
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
- email_query: Asking about emails (new messages, inbox status, who emailed me, read my emails)
- email_command: Sending, replying to, composing, or forwarding emails
- calendar_query: Asking about calendar events, schedule, availability (what's on my calendar, am I free)
- calendar_command: Creating, modifying, or cancelling calendar events (schedule a meeting, add event)
- nutrition_log: User reporting food/drink intake (I had a coffee, I ate lunch, log my snack, I drank water)
- nutrition_query: Asking about nutrition data (how many calories today, what did I eat, macro summary, am I on track)
- family_message: Sending family announcements or messages (announce to the family, message mom, post a family note)
- memory_save: User explicitly asks to remember something (remember that I like..., keep in mind..., from now on...)
- memory_manage: User asks about or wants to manage memories (what do you remember, forget that preference, show my memories)

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

    // Email/Calendar (before device commands — "check my email" shouldn't match device patterns)
    if (EMAIL_COMMAND_PATTERNS.some((p) => p.test(message))) {
      return { category: "email_command", confidence: 0.9 };
    }

    if (EMAIL_QUERY_PATTERNS.some((p) => p.test(message))) {
      return { category: "email_query", confidence: 0.9 };
    }

    if (CALENDAR_COMMAND_PATTERNS.some((p) => p.test(message))) {
      return { category: "calendar_command", confidence: 0.9 };
    }

    if (CALENDAR_QUERY_PATTERNS.some((p) => p.test(message))) {
      return { category: "calendar_query", confidence: 0.9 };
    }

    // Nutrition patterns (after email/calendar, before device commands)
    if (NUTRITION_LOG_PATTERNS.some((p) => p.test(message))) {
      return { category: "nutrition_log", confidence: 0.85 };
    }

    if (NUTRITION_QUERY_PATTERNS.some((p) => p.test(message))) {
      return { category: "nutrition_query", confidence: 0.9 };
    }

    // Memory patterns (before family messaging to catch "remember" commands)
    if (MEMORY_SAVE_PATTERNS.some((p) => p.test(message))) {
      return { category: "memory_save", confidence: 0.9 };
    }

    if (MEMORY_MANAGE_PATTERNS.some((p) => p.test(message))) {
      return { category: "memory_manage", confidence: 0.9 };
    }

    // Family messaging patterns
    if (FAMILY_MESSAGE_PATTERNS.some((p) => p.test(message))) {
      return { category: "family_message", confidence: 0.9 };
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
        "email_query",
        "email_command",
        "calendar_query",
        "calendar_command",
        "nutrition_log",
        "nutrition_query",
        "family_message",
        "memory_save",
        "memory_manage",
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
