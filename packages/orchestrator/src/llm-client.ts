/**
 * LLM Client
 *
 * Abstraction over Groq (fast voice path) and Claude (complex reasoning).
 * The orchestrator picks the right provider based on the task:
 *   - Groq: triage classification, simple responses, voice hot path
 *   - Claude: complex multi-step planning, monitoring summaries
 */

import type {
  LLMCompletionOptions,
  LLMCompletionResult,
  LLMProvider,
} from "./types.js";

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

export interface LLMClientConfig {
  groq_api_key: string;
  groq_model?: string;
  claude_api_key?: string;
  claude_model?: string;
}

const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6-20250514";

// ---------------------------------------------------------------------------
// LLM Client
// ---------------------------------------------------------------------------

export class LLMClient {
  private readonly config: LLMClientConfig;

  constructor(config: LLMClientConfig) {
    this.config = config;
  }

  /**
   * Send a completion request to the appropriate LLM provider.
   * Defaults to Groq for speed. Falls back to Groq if Claude key is not set.
   */
  async complete(options: LLMCompletionOptions): Promise<LLMCompletionResult> {
    const provider = options.provider ?? "groq";

    if (provider === "claude" && this.config.claude_api_key) {
      return this.completeClaude(options);
    }

    return this.completeGroq(options);
  }

  // -----------------------------------------------------------------------
  // Groq (fast path)
  // -----------------------------------------------------------------------

  private async completeGroq(
    options: LLMCompletionOptions,
  ): Promise<LLMCompletionResult> {
    const model = options.model ?? this.config.groq_model ?? DEFAULT_GROQ_MODEL;
    const start = Date.now();

    const body: Record<string, unknown> = {
      model,
      messages: options.messages,
      max_tokens: options.max_tokens ?? 512,
      temperature: options.temperature ?? 0.3,
    };

    if (options.json_mode) {
      body["response_format"] = { type: "json_object" };
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.groq_api_key}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const content = data.choices[0]?.message?.content ?? "";

    return {
      content,
      provider: "groq",
      model,
      latency_ms: Date.now() - start,
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    };
  }

  // -----------------------------------------------------------------------
  // Claude (complex reasoning)
  // -----------------------------------------------------------------------

  private async completeClaude(
    options: LLMCompletionOptions,
  ): Promise<LLMCompletionResult> {
    const model =
      options.model ?? this.config.claude_model ?? DEFAULT_CLAUDE_MODEL;
    const start = Date.now();

    // Convert messages: separate system from user/assistant
    const systemMessage = options.messages.find((m) => m.role === "system");
    const nonSystemMessages = options.messages.filter(
      (m) => m.role !== "system",
    );

    const body: Record<string, unknown> = {
      model,
      max_tokens: options.max_tokens ?? 1024,
      messages: nonSystemMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    if (systemMessage) {
      body["system"] = systemMessage.content;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.claude_api_key!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const content =
      data.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("") ?? "";

    return {
      content,
      provider: "claude",
      model,
      latency_ms: Date.now() - start,
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    };
  }
}
