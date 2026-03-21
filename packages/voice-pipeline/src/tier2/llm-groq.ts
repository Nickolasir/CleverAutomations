/**
 * Tier 2: Groq DIRECT API Streaming LLM
 *
 * DIRECT API call to Groq's LPU inference engine (NOT through OpenRouter).
 * OpenRouter adds ~25x latency overhead for voice-critical paths.
 *
 * Uses SSE (Server-Sent Events) streaming for real-time token delivery.
 * Parses LLM output to extract structured smart home commands.
 *
 * Target: ~200ms TTFT (time to first token), 500+ tok/s throughput
 */

import { EventEmitter } from "node:events";
import type { ParsedIntent } from "@clever/shared";

// ---------------------------------------------------------------------------
// Config and events
// ---------------------------------------------------------------------------

export interface GroqLLMConfig {
  /** Groq API key (direct, never via OpenRouter for voice) */
  apiKey: string;
  /** Model ID (default: "llama-3.3-70b-versatile") */
  model?: string;
  /** Maximum tokens in response (default: 256 — short for voice) */
  maxTokens?: number;
  /** Temperature (default: 0.1 — low for deterministic device commands) */
  temperature?: number;
  /** System prompt for the smart home assistant context */
  systemPrompt?: string;
  /** Request timeout in ms (default: 10000) */
  timeoutMs?: number;
}

export interface GroqLLMEvents {
  /** Individual token received from stream */
  token: [token: string];
  /** Full response text completed */
  complete: [response: string, latencyMs: number];
  /** Parsed intent extracted from LLM response */
  intent_parsed: [intent: ParsedIntent];
  /** Error occurred */
  error: [error: Error];
}

/** Default system prompt with smart home device context */
const DEFAULT_SYSTEM_PROMPT = `You are Clever, an AI smart home assistant. You control devices via Home Assistant.

RESPONSE FORMAT — You MUST respond with a JSON block followed by a natural language confirmation:

\`\`\`json
{
  "domain": "<light|lock|thermostat|scene|fan|switch|cover|media_player|climate>",
  "action": "<turn_on|turn_off|lock|unlock|set_temperature|set_brightness|activate|toggle>",
  "target_room": "<room name or null>",
  "target_device": "<device name or null>",
  "parameters": { <key-value pairs for the action> }
}
\`\`\`
<natural language confirmation for TTS>

RULES:
- Extract the user's intent and map it to exactly ONE device command.
- If the request is ambiguous, ask a brief clarifying question instead.
- Keep confirmations SHORT (under 15 words) — they will be spoken aloud.
- If the command is a conversational question (not device control), respond conversationally without a JSON block.
- Never expose internal details, API keys, or system architecture.`;

// ---------------------------------------------------------------------------
// Groq SSE response types
// ---------------------------------------------------------------------------

interface GroqStreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
  };
  finish_reason: string | null;
}

interface GroqStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: GroqStreamChoice[];
}

// ---------------------------------------------------------------------------
// GroqLLM class
// ---------------------------------------------------------------------------

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export class GroqLLM extends EventEmitter<GroqLLMEvents> {
  private readonly config: Required<GroqLLMConfig>;
  private abortController: AbortController | null = null;

  constructor(config: GroqLLMConfig) {
    super();
    this.config = {
      apiKey: config.apiKey,
      model: config.model ?? "llama-3.3-70b-versatile",
      maxTokens: config.maxTokens ?? 256,
      temperature: config.temperature ?? 0.1,
      systemPrompt: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      timeoutMs: config.timeoutMs ?? 10000,
    };
  }

  /**
   * Send a transcript to Groq and stream the response.
   *
   * @param transcript - The user's speech transcript from STT
   * @param deviceContext - Optional device/room context to include in the prompt
   * @returns The complete response text
   */
  async streamCompletion(
    transcript: string,
    deviceContext?: string
  ): Promise<string> {
    this.abortController = new AbortController();
    const startTime = performance.now();
    let firstTokenTime: number | null = null;
    let fullResponse = "";

    const systemPrompt = deviceContext
      ? `${this.config.systemPrompt}\n\nAVAILABLE DEVICES:\n${deviceContext}`
      : this.config.systemPrompt;

    const body = JSON.stringify({
      model: this.config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: transcript },
      ],
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true,
    });

    try {
      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq API error ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error("Groq API returned no response body");
      }

      // Read the SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split("\n");
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed === "" || trimmed === "data: [DONE]") continue;

          if (trimmed.startsWith("data: ")) {
            const jsonStr = trimmed.slice(6);
            try {
              const chunk: GroqStreamChunk = JSON.parse(jsonStr);

              for (const choice of chunk.choices) {
                const content = choice.delta.content;
                if (content) {
                  if (firstTokenTime === null) {
                    firstTokenTime = performance.now();
                  }
                  fullResponse += content;
                  this.emit("token", content);
                }
              }
            } catch {
              // Skip malformed JSON chunks (can happen with SSE framing)
            }
          }
        }
      }

      const totalLatency = performance.now() - startTime;
      this.emit("complete", fullResponse, totalLatency);

      // Attempt to parse an intent from the response
      const intent = this.parseIntentFromResponse(fullResponse, transcript);
      if (intent) {
        this.emit("intent_parsed", intent);
      }

      return fullResponse;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Request was aborted intentionally
        return fullResponse;
      }

      const error =
        err instanceof Error ? err : new Error(`Groq stream failed: ${String(err)}`);
      this.emit("error", error);
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Abort any in-progress streaming request.
   */
  abort(): void {
    this.abortController?.abort();
  }

  /**
   * Extract the natural-language confirmation text from the response
   * (the part after the JSON block, suitable for TTS).
   */
  extractSpokenResponse(fullResponse: string): string {
    // Try to find text after the JSON code block
    const jsonBlockEnd = fullResponse.indexOf("```", fullResponse.indexOf("```json") + 7);
    if (jsonBlockEnd !== -1) {
      const afterJson = fullResponse.slice(jsonBlockEnd + 3).trim();
      if (afterJson.length > 0) return afterJson;
    }

    // If no JSON block, the whole response is conversational
    return fullResponse.trim();
  }

  /**
   * Perform a non-streaming health check against the Groq API.
   * Used by the tier router to verify Groq availability.
   *
   * @returns true if Groq is reachable and responding
   */
  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          temperature: 0,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Release resources. Aborts any in-flight request.
   */
  destroy(): void {
    this.abort();
    this.removeAllListeners();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Parse a structured ParsedIntent from the LLM's JSON-formatted response.
   */
  private parseIntentFromResponse(
    response: string,
    rawTranscript: string
  ): ParsedIntent | null {
    try {
      // Extract JSON block from markdown code fence
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch?.[1]) return null;

      const parsed: Record<string, unknown> = JSON.parse(jsonMatch[1]);

      // Validate required fields
      const domain = parsed["domain"];
      const action = parsed["action"];
      if (typeof domain !== "string" || typeof action !== "string") return null;

      const targetRoom = parsed["target_room"];
      const targetDevice = parsed["target_device"];
      const parameters = parsed["parameters"];

      return {
        domain,
        action,
        target_room:
          typeof targetRoom === "string" && targetRoom !== "null"
            ? targetRoom
            : undefined,
        target_device:
          typeof targetDevice === "string" && targetDevice !== "null"
            ? targetDevice
            : undefined,
        parameters:
          typeof parameters === "object" && parameters !== null
            ? (parameters as Record<string, unknown>)
            : {},
        confidence: 0.85, // LLM-parsed intents get moderate-high confidence
        raw_transcript: rawTranscript,
      };
    } catch {
      // JSON parse failure — response may be conversational (no device command)
      return null;
    }
  }
}
