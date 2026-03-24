/**
 * Mobile voice pipeline client — v3 (Groq LLM intent extraction).
 *
 * Architecture:
 *  1. Deepgram STT → transcript
 *  2. Groq LLM intent extraction (primary) → structured ParsedIntent
 *  3. Resolve intent target against live HA entities (fuzzy match)
 *  4. Call the appropriate HA service
 *  5. Offline fallback: keyword-based matching (only when Groq unreachable)
 *  6. Log to Supabase
 *
 * The keyword/regex layer proved unreliable for natural speech variations.
 * Groq LLM (~200-400ms, non-streaming) handles intent extraction reliably
 * and is now the primary path. Keywords are kept as an offline-only fallback.
 */

import type { ParsedIntent, VoiceTier } from "@clever/shared";
import { supabase } from "./supabase";
import { callService, getStates } from "./homeassistant";
import { wakeDevice, canWake } from "./wake-on-lan";

const DEEPGRAM_API_KEY = process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY ?? "";
const GROQ_API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VoiceResult {
  transcript: string;
  intent: ParsedIntent | null;
  response: string;
  tier: VoiceTier;
  latencyMs: number;
  executed: boolean;
  error?: string;
}

interface HaEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 1. GROQ LLM INTENT EXTRACTION (primary path)
//    Sends transcript + available entity list to Groq for structured intent.
//    Non-streaming — we only need the JSON intent, not TTS output.
// ---------------------------------------------------------------------------

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const INTENT_SYSTEM_PROMPT = `You are a smart home intent parser. Given a user's voice command and a list of available Home Assistant entities, extract the intent as a JSON object.

RESPONSE FORMAT — respond with ONLY a JSON object, no markdown, no explanation:
{
  "domain": "<light|lock|climate|scene|fan|switch|cover|media_player>",
  "action": "<turn_on|turn_off|lock|unlock|set_temperature|set_brightness|toggle|media_play|media_pause|media_stop|media_next_track|media_previous_track|volume_up|volume_down|volume_mute|select_source|open|close>",
  "target_device": "<friendly name or entity_id of the target device, or null>",
  "target_room": "<room name if mentioned, or null>",
  "parameters": { <any extra parameters like brightness, temperature, source, is_volume_muted> },
  "confidence": <0.0 to 1.0>
}

RULES:
- Map the user's natural language to exactly ONE device command.
- Match device names against the AVAILABLE ENTITIES list. Use the closest match.
- If the user says a nickname (TV, AC, thermostat), map it to the correct entity.
- For ambiguous commands, set confidence below 0.7.
- If the command is conversational (not device control), respond with:
  {"domain": "conversation", "action": "chat", "target_device": null, "target_room": null, "parameters": {}, "confidence": 1.0, "response": "<your conversational reply>"}
- For volume mute: set parameters.is_volume_muted to true for mute, false for unmute.
- For select_source: set parameters.source to the source name.
- For set_brightness: set parameters.brightness to 0-255.
- For set_temperature: set parameters.temperature to the value.`;

interface GroqIntentResult {
  intent: ParsedIntent | null;
  response: string | null;
}

async function extractIntentWithGroq(
  transcript: string,
  entities: HaEntity[]
): Promise<GroqIntentResult> {
  if (!GROQ_API_KEY) {
    throw new Error("groq_unavailable");
  }

  // Build a compact entity list for context
  const entitySummary = entities
    .filter((e) => {
      const domain = e.entity_id.split(".")[0] ?? "";
      return ["light", "lock", "climate", "fan", "switch", "cover", "media_player", "scene"].includes(domain);
    })
    .map((e) => {
      const fname = (e.attributes.friendly_name as string) ?? "";
      return `${e.entity_id} (${fname}) [${e.state}]`;
    })
    .join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: `${INTENT_SYSTEM_PROMPT}\n\nAVAILABLE ENTITIES:\n${entitySummary}` },
          { role: "user", content: transcript },
        ],
        max_tokens: 256,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";

    const parsed: Record<string, unknown> = JSON.parse(content);

    // Handle conversational responses (no device command)
    if (parsed["domain"] === "conversation") {
      return {
        intent: null,
        response: (parsed["response"] as string) ?? "I'm not sure how to help with that.",
      };
    }

    const domain = parsed["domain"];
    const action = parsed["action"];
    if (typeof domain !== "string" || typeof action !== "string") {
      return { intent: null, response: null };
    }

    const targetDevice = parsed["target_device"];
    const targetRoom = parsed["target_room"];
    const parameters = parsed["parameters"];
    const confidence = typeof parsed["confidence"] === "number" ? parsed["confidence"] : 0.85;

    return {
      intent: {
        domain,
        action,
        target_device: typeof targetDevice === "string" && targetDevice !== "null" ? targetDevice : undefined,
        target_room: typeof targetRoom === "string" && targetRoom !== "null" ? targetRoom : undefined,
        parameters: typeof parameters === "object" && parameters !== null
          ? (parameters as Record<string, unknown>)
          : {},
        confidence,
        raw_transcript: transcript,
      },
      response: null,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("groq_timeout");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 2. ENTITY RESOLUTION
//    Resolve intent target_device/target_room to a specific HA entity
// ---------------------------------------------------------------------------

/** Common nicknames → HA domain + search terms */
const NICKNAMES: Record<string, { domains: string[]; terms: string[] }> = {
  tv: { domains: ["media_player"], terms: ["tv", "television", "samsung", "lg", "sony", "vizio", "roku"] },
  television: { domains: ["media_player"], terms: ["tv", "television", "samsung"] },
  samsung: { domains: ["media_player"], terms: ["samsung"] },
  lights: { domains: ["light"], terms: ["light"] },
  light: { domains: ["light"], terms: ["light"] },
  fan: { domains: ["fan"], terms: ["fan"] },
  thermostat: { domains: ["climate"], terms: ["climate", "thermostat", "ecobee", "nest"] },
  ac: { domains: ["climate"], terms: ["climate", "thermostat"] },
  door: { domains: ["lock"], terms: ["lock", "door"] },
  front: { domains: ["lock"], terms: ["front", "lock"] },
  back: { domains: ["lock"], terms: ["back", "lock"] },
  garage: { domains: ["cover"], terms: ["garage", "cover"] },
};

const FILLER_WORDS = new Set([
  "please", "thanks", "thank", "you", "hey", "hi", "hello", "ok", "okay",
  "can", "could", "would", "will", "just", "go", "ahead", "and",
  "for", "me", "now", "right", "a", "an", "the", "my", "our",
  "um", "uh", "like", "so", "well", "actually", "basically",
]);

function scoreEntityMatch(entity: HaEntity, targetWords: string[], domains: string[]): number {
  const eid = entity.entity_id.toLowerCase();
  const fname = ((entity.attributes.friendly_name as string) ?? "").toLowerCase();
  const domain = eid.split(".")[0] ?? "";

  let score = 0;

  // Domain match bonus
  if (domains.length > 0 && domains.includes(domain)) score += 10;

  // Word matches against friendly name and entity_id
  for (const word of targetWords) {
    if (fname.includes(word)) score += 5;
    if (eid.includes(word)) score += 3;
  }

  // Nickname expansion
  for (const word of targetWords) {
    const nick = NICKNAMES[word];
    if (!nick) continue;
    if (nick.domains.includes(domain)) score += 8;
    for (const term of nick.terms) {
      if (fname.includes(term)) score += 4;
      if (eid.includes(term)) score += 2;
    }
  }

  return score;
}

function resolveEntity(
  entities: HaEntity[],
  intent: ParsedIntent
): HaEntity | null {
  if (entities.length === 0) return null;

  // If Groq returned an entity_id directly, try exact match first
  const targetDevice = intent.target_device ?? "";
  const exactMatch = entities.find(
    (e) => e.entity_id === targetDevice ||
           ((e.attributes.friendly_name as string) ?? "").toLowerCase() === targetDevice.toLowerCase()
  );
  if (exactMatch) return exactMatch;

  // Fuzzy match using target_device and target_room
  const searchText = [intent.target_device, intent.target_room].filter(Boolean).join(" ");
  if (!searchText) {
    // No target info — try to find the only entity in this domain
    const domainEntities = entities.filter((e) => {
      const d = e.entity_id.split(".")[0] ?? "";
      return d === intent.domain;
    });
    if (domainEntities.length === 1) return domainEntities[0]!;
    return null;
  }

  const targetWords = searchText
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !FILLER_WORDS.has(w));

  const preferredDomains = [intent.domain];
  // Expand nicknames
  for (const word of targetWords) {
    const nick = NICKNAMES[word];
    if (nick) {
      for (const d of nick.domains) {
        if (!preferredDomains.includes(d)) preferredDomains.push(d);
      }
    }
  }

  let best: HaEntity | null = null;
  let bestScore = 0;

  for (const entity of entities) {
    const score = scoreEntityMatch(entity, targetWords, preferredDomains);
    if (score > bestScore) {
      bestScore = score;
      best = entity;
    }
  }

  return bestScore >= 5 ? best : null;
}

// ---------------------------------------------------------------------------
// 3. EXECUTE ON ENTITY
// ---------------------------------------------------------------------------

async function executeOnEntity(
  entity: HaEntity,
  domain: string,
  action: string,
  extraParams: Record<string, unknown> = {}
): Promise<{ executed: boolean; response: string }> {
  const fname = (entity.attributes.friendly_name as string) ?? entity.entity_id;
  const isUnavailable = entity.state === "unavailable" || entity.state === "unknown";
  const isTurnOn = action === "turn_on";

  // If device is unavailable and we're trying to turn it on, try WoL first
  if (isUnavailable && isTurnOn && canWake(entity.entity_id)) {
    const woke = await wakeDevice(entity.entity_id);
    if (woke) {
      return { executed: true, response: `Waking up ${fname}... it should turn on in a few seconds.` };
    }
  }

  // If device is unavailable for non-turn_on actions, report it
  if (isUnavailable && !isTurnOn) {
    if (canWake(entity.entity_id)) {
      await wakeDevice(entity.entity_id);
      await new Promise((r) => setTimeout(r, 5000));
    } else {
      return { executed: false, response: `${fname} is currently offline. Turn it on first.` };
    }
  }

  try {
    const data: Record<string, unknown> = { entity_id: entity.entity_id, ...extraParams };
    await callService(domain, action, data);

    const label = action.replace(/_/g, " ");
    return { executed: true, response: `Done! ${label} ${fname}.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { executed: false, response: `Failed: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// 4. OFFLINE FALLBACK: KEYWORD-BASED INTENT DETECTION
//    Only used when Groq is unreachable (no API key, timeout, network down).
// ---------------------------------------------------------------------------

interface DetectedAction {
  domain: string;
  action: string;
  target: string;
}

const ACTION_PATTERNS: Array<{
  phrases: string[];
  domain: string;
  action: string;
}> = [
  // Playback (check before generic on/off)
  { phrases: ["press play", "hit play", "start playing", "resume playing", "resume", "play"], domain: "media_player", action: "media_play" },
  { phrases: ["press pause", "hit pause", "stop playing", "pause"], domain: "media_player", action: "media_pause" },
  { phrases: ["play pause", "toggle play"], domain: "media_player", action: "media_play_pause" },
  { phrases: ["skip forward", "next track", "next episode", "skip", "next"], domain: "media_player", action: "media_next_track" },
  { phrases: ["go back", "previous track", "previous episode", "previous", "prev"], domain: "media_player", action: "media_previous_track" },
  { phrases: ["stop"], domain: "media_player", action: "media_stop" },
  // Volume
  { phrases: ["turn up volume", "volume up", "raise volume", "increase volume", "louder", "turn it up", "turn up"], domain: "media_player", action: "volume_up" },
  { phrases: ["turn down volume", "volume down", "lower volume", "decrease volume", "quieter", "turn it down", "turn down"], domain: "media_player", action: "volume_down" },
  { phrases: ["unmute"], domain: "media_player", action: "volume_mute" },
  { phrases: ["mute"], domain: "media_player", action: "volume_mute" },
  // Source
  { phrases: ["switch to", "change to", "change input to", "select input", "switch input to"], domain: "media_player", action: "select_source" },
  // Locks
  { phrases: ["unlock"], domain: "lock", action: "unlock" },
  { phrases: ["lock"], domain: "lock", action: "lock" },
  // Lights (specific — must come before generic on/off)
  { phrases: ["lights on in", "turn on lights in", "lights on"], domain: "light", action: "turn_on" },
  { phrases: ["lights off in", "turn off lights in", "lights off"], domain: "light", action: "turn_off" },
  // Generic on/off (last — catches everything)
  { phrases: ["turn on", "switch on", "power on", "enable", "start"], domain: "_generic", action: "turn_on" },
  { phrases: ["turn off", "switch off", "power off", "disable", "shut off", "shut down"], domain: "_generic", action: "turn_off" },
];

const FILLER_PHRASES = [
  "can you", "could you", "would you", "will you", "please",
  "go ahead and", "i want to", "i'd like to", "i would like to",
  "i need to", "i want you to",
];

function normalize(raw: string): string {
  let text = raw.toLowerCase().trim();
  text = text.replace(/[.,!?;:'"…\-—]+/g, " ");
  for (const phrase of FILLER_PHRASES) {
    text = text.replace(new RegExp(`\\b${phrase}\\b`, "gi"), " ");
  }
  const words = text.split(/\s+/).filter(Boolean);
  while (words.length > 0 && FILLER_WORDS.has(words[0]!)) words.shift();
  while (words.length > 0 && FILLER_WORDS.has(words[words.length - 1]!)) words.pop();
  return words.join(" ").trim();
}

function detectAction(text: string): DetectedAction | null {
  const lower = text.toLowerCase();

  for (const pattern of ACTION_PATTERNS) {
    for (const phrase of pattern.phrases) {
      const idx = lower.indexOf(phrase);
      if (idx === -1) continue;

      const before = text.slice(0, idx).trim();
      const after = text.slice(idx + phrase.length).trim();
      let target = after || before;
      target = target.replace(/^(?:on|in|of|to)\s+/i, "").trim();

      return { domain: pattern.domain, action: pattern.action, target };
    }
  }

  return null;
}

function findBestEntity(
  entities: HaEntity[],
  target: string,
  preferredDomains: string[]
): HaEntity | null {
  if (entities.length === 0) return null;

  const targetWords = target
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !FILLER_WORDS.has(w));

  if (targetWords.length === 0 && preferredDomains.length > 0) {
    const domainEntities = entities.filter((e) => {
      const d = e.entity_id.split(".")[0] ?? "";
      return preferredDomains.includes(d);
    });
    if (domainEntities.length === 1) return domainEntities[0]!;
  }

  let best: HaEntity | null = null;
  let bestScore = 0;

  for (const entity of entities) {
    const score = scoreEntityMatch(entity, targetWords, preferredDomains);
    if (score > bestScore) {
      bestScore = score;
      best = entity;
    }
  }

  return bestScore >= 5 ? best : null;
}

function resolveDomain(action: DetectedAction, entity: HaEntity): { domain: string; action: string } {
  const entityDomain = entity.entity_id.split(".")[0] ?? "";

  if (action.domain !== "_generic") {
    return { domain: action.domain, action: action.action };
  }

  if (entityDomain === "lock") {
    return {
      domain: "lock",
      action: action.action === "turn_on" ? "unlock" : "lock",
    };
  }

  return { domain: entityDomain, action: action.action };
}

/**
 * Offline fallback: keyword-based intent detection + entity matching.
 * Only called when Groq is unreachable.
 */
async function processOfflineFallback(
  text: string,
  entities: HaEntity[]
): Promise<{ intent: ParsedIntent | null; entity: HaEntity | null; extraParams: Record<string, unknown> }> {
  const cleaned = normalize(text);
  const action = detectAction(cleaned);
  if (!action) return { intent: null, entity: null, extraParams: {} };

  const preferredDomains = action.domain === "_generic" ? [] : [action.domain];
  for (const word of action.target.toLowerCase().split(/\s+/)) {
    const nick = NICKNAMES[word];
    if (nick) {
      for (const d of nick.domains) {
        if (!preferredDomains.includes(d)) preferredDomains.push(d);
      }
    }
  }

  const entity = findBestEntity(entities, action.target, preferredDomains);
  if (!entity) return { intent: null, entity: null, extraParams: {} };

  const resolved = resolveDomain(action, entity);
  const extraParams: Record<string, unknown> = {};
  if (action.action === "volume_mute") {
    extraParams.is_volume_muted = cleaned.includes("mute") && !cleaned.includes("unmute");
  }
  if (action.action === "select_source" && action.target) {
    extraParams.source = action.target;
  }

  return {
    intent: {
      domain: resolved.domain,
      action: resolved.action,
      parameters: { entity_id: entity.entity_id, ...extraParams },
      confidence: 0.8,
      raw_transcript: text,
    },
    entity,
    extraParams,
  };
}

// ---------------------------------------------------------------------------
// Deepgram STT
// ---------------------------------------------------------------------------

async function transcribeWithDeepgram(audioUri: string): Promise<string> {
  if (!DEEPGRAM_API_KEY) {
    throw new Error("Add EXPO_PUBLIC_DEEPGRAM_API_KEY to .env");
  }

  const audioResponse = await fetch(audioUri);
  const audioBlob = await audioResponse.blob();

  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        "Content-Type": "audio/wav",
      },
      body: audioBlob,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Deepgram ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

export async function processAudioCommand(
  audioUri: string,
  tenantId: string
): Promise<VoiceResult> {
  let transcript: string;
  try {
    transcript = await transcribeWithDeepgram(audioUri);
  } catch (err) {
    return {
      transcript: "",
      intent: null,
      response: err instanceof Error ? err.message : "Transcription failed",
      tier: "tier2_cloud",
      latencyMs: 0,
      executed: false,
      error: "stt_failed",
    };
  }

  if (!transcript.trim()) {
    return {
      transcript: "",
      intent: null,
      response: "I didn't catch that. Try again or type your command.",
      tier: "tier2_cloud",
      latencyMs: 0,
      executed: false,
      error: "empty_transcript",
    };
  }

  return processVoiceCommand(transcript, tenantId);
}

export async function processVoiceCommand(
  text: string,
  tenantId: string
): Promise<VoiceResult> {
  const startTime = Date.now();
  const originalText = text;

  console.log("[Voice] Processing:", JSON.stringify(originalText));

  // Fetch HA entities (needed by both Groq and offline paths)
  let entities: HaEntity[];
  try {
    entities = await getStates();
  } catch {
    entities = [];
  }

  // ----- PRIMARY PATH: Groq LLM intent extraction -----
  try {
    const groqResult = await extractIntentWithGroq(originalText, entities);
    console.log("[Voice] Groq intent:", JSON.stringify(groqResult.intent));

    // Conversational response (no device command)
    if (!groqResult.intent && groqResult.response) {
      const latencyMs = Date.now() - startTime;
      void logVoiceTranscript(originalText, "tier2_cloud", latencyMs, tenantId, "conversation");
      return {
        transcript: originalText,
        intent: null,
        response: groqResult.response,
        tier: "tier2_cloud",
        latencyMs,
        executed: false,
      };
    }

    // Device command intent extracted
    if (groqResult.intent) {
      const entity = resolveEntity(entities, groqResult.intent);

      if (entity) {
        const result = await executeOnEntity(
          entity,
          groqResult.intent.domain,
          groqResult.intent.action,
          groqResult.intent.parameters
        );
        const latencyMs = Date.now() - startTime;
        const intentSummary = `${groqResult.intent.domain}.${groqResult.intent.action}`;
        void logVoiceTranscript(originalText, "tier2_cloud", latencyMs, tenantId, intentSummary);

        return {
          transcript: originalText,
          intent: {
            ...groqResult.intent,
            parameters: { entity_id: entity.entity_id, ...groqResult.intent.parameters },
          },
          response: result.response,
          tier: "tier2_cloud",
          latencyMs,
          executed: result.executed,
        };
      }

      // Intent extracted but no matching entity found
      const latencyMs = Date.now() - startTime;
      void logVoiceTranscript(originalText, "tier2_cloud", latencyMs, tenantId, "no_entity_match");
      return {
        transcript: originalText,
        intent: groqResult.intent,
        response: `I understood "${groqResult.intent.action} ${groqResult.intent.target_device ?? groqResult.intent.domain}" but couldn't find that device.`,
        tier: "tier2_cloud",
        latencyMs,
        executed: false,
      };
    }

    // Groq returned nothing useful — fall through
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.log("[Voice] Groq unavailable, falling back to offline keywords:", errMsg);
  }

  // ----- OFFLINE FALLBACK: keyword-based matching -----
  console.log("[Voice] Using offline keyword fallback");
  const fallback = await processOfflineFallback(originalText, entities);

  if (fallback.intent && fallback.entity) {
    const result = await executeOnEntity(
      fallback.entity,
      fallback.intent.domain,
      fallback.intent.action,
      fallback.extraParams
    );
    const latencyMs = Date.now() - startTime;
    const intentSummary = `${fallback.intent.domain}.${fallback.intent.action}`;
    void logVoiceTranscript(originalText, "tier1_rules", latencyMs, tenantId, intentSummary);

    return {
      transcript: originalText,
      intent: fallback.intent,
      response: result.response,
      tier: "tier1_rules",
      latencyMs,
      executed: result.executed,
    };
  }

  // Nothing matched at all
  const latencyMs = Date.now() - startTime;
  void logVoiceTranscript(originalText, "tier1_rules", latencyMs, tenantId, "no_match");
  return {
    transcript: originalText,
    intent: null,
    response: "I couldn't understand that command. Try something like 'turn off the lights' or 'lock the front door'.",
    tier: "tier1_rules",
    latencyMs,
    executed: false,
  };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

async function logVoiceTranscript(
  text: string,
  tier: VoiceTier,
  latencyMs: number,
  tenantId: string,
  intentSummary: string
): Promise<void> {
  try {
    await supabase.from("voice_transcripts").insert({
      tenant_id: tenantId,
      transcript_encrypted: text,
      intent_summary: intentSummary,
      tier_used: tier,
      latency_ms: latencyMs,
    });
  } catch (err) {
    console.error("[Voice] Failed to log transcript:", err);
  }
}
