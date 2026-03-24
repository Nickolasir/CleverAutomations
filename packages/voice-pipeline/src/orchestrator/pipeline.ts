/**
 * Main Voice Pipeline Orchestrator
 *
 * Chains all voice processing stages with STREAMING OVERLAP:
 * TTS starts receiving tokens before LLM finishes generating.
 *
 * Processing flow:
 *   Audio -> [Wake Word] -> STT -> Groq LLM -> TTS
 *                                     |           |
 *                              (streaming overlap)
 *
 * Tier routing:
 *   Primary: Groq LLM intent extraction (after STT) — reliable for natural speech
 *   Offline fallback: regex rules engine (only when cloud is unreachable)
 *
 * The regex/rules layer proved unreliable for natural speech variations.
 * Groq LLM is now the primary intent extraction path. Rules are kept
 * as an offline-only fallback for when cloud APIs are unavailable.
 *
 * Confidence check: below 0.7 -> status = "confirmation_required"
 * OpenRouter fallback: ONLY if Groq direct API is down
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  VoiceSession,
  VoiceSessionId,
  ParsedIntent,
  StageTimestamp,
  PipelineStage,
  StreamingPipelineConfig,
  VoiceTier,
  TenantId,
  UserId,
  DeviceId,
  FamilyVoiceContext,
} from "@clever/shared";
import { CONFIDENCE_THRESHOLD } from "@clever/shared";

import { matchRule } from "../tier1/rules-engine.js";
import { SpeechToIntent, type SpeechToIntentConfig } from "../tier1/speech-to-intent.js";
import { DeepgramSTT, type DeepgramSTTConfig } from "../tier2/stt-deepgram.js";
import { GroqLLM, type GroqLLMConfig } from "../tier2/llm-groq.js";
import { CartesiaTTS, type CartesiaTTSConfig } from "../tier2/tts-cartesia.js";
import { LocalSTT, type LocalSTTConfig } from "../tier3/local-stt.js";
import { LocalLLM, type LocalLLMConfig } from "../tier3/local-llm.js";
import { LocalTTS, type LocalTTSConfig } from "../tier3/local-tts.js";
import { TierRouter, type TierRouterConfig } from "./tier-router.js";

// ---------------------------------------------------------------------------
// Pipeline config
// ---------------------------------------------------------------------------

export interface VoicePipelineConfig {
  /** Tenant and user context for the session */
  tenantId: TenantId;
  userId: UserId;
  deviceId: DeviceId;

  /** Tier router config */
  tierRouter: TierRouterConfig;

  /** Tier 1: Rules-based speech-to-intent config (optional — rules engine always active) */
  speechToIntent?: SpeechToIntentConfig;

  /** Tier 2: Cloud streaming pipeline */
  deepgram: DeepgramSTTConfig;
  groq: GroqLLMConfig;
  cartesia: CartesiaTTSConfig;

  /** Tier 3: Local fallback */
  localStt?: LocalSTTConfig;
  localLlm?: LocalLLMConfig;
  localTts?: LocalTTSConfig;

  /** Device context string for the LLM (list of available devices) */
  deviceContext?: string;

  /**
   * Confidence threshold below which commands require confirmation.
   * Default: 0.7 (from @clever/shared CONFIDENCE_THRESHOLD)
   */
  confidenceThreshold?: number;

  /**
   * Family voice context — when present, scopes the LLM system prompt
   * to the family member's personality, permissions, and allowed devices.
   */
  familyContext?: FamilyVoiceContext;
}

export interface PipelineEvents {
  /** A processing stage started */
  stage_start: [stage: PipelineStage];
  /** A processing stage completed */
  stage_complete: [stage: PipelineStage, latencyMs: number];
  /** Partial STT transcript available */
  stt_partial: [text: string];
  /** Final STT transcript */
  stt_final: [text: string];
  /** LLM token received (for streaming TTS overlap) */
  llm_token: [token: string];
  /** TTS audio chunk ready for playback */
  tts_audio: [chunk: Buffer];
  /** Full pipeline completed */
  complete: [session: VoiceSession];
  /** Error at any stage */
  error: [error: Error, stage: PipelineStage];
}

// ---------------------------------------------------------------------------
// VoicePipeline class
// ---------------------------------------------------------------------------

/** Re-export from shared for local reference (value = 0.7) */
const DEFAULT_CONFIDENCE_THRESHOLD: number = CONFIDENCE_THRESHOLD;

export class VoicePipeline extends EventEmitter<PipelineEvents> {
  private readonly config: VoicePipelineConfig;
  private readonly tierRouter: TierRouter;
  private readonly confidenceThreshold: number;

  // Tier 1 components
  private speechToIntent: SpeechToIntent | null = null;

  // Tier 2 components (lazily initialized)
  private deepgramStt: DeepgramSTT | null = null;
  private groqLlm: GroqLLM | null = null;
  private cartesiaTts: CartesiaTTS | null = null;

  // Tier 3 components (lazily initialized)
  private localStt: LocalSTT | null = null;
  private localLlm: LocalLLM | null = null;
  private localTts: LocalTTS | null = null;

  constructor(config: VoicePipelineConfig) {
    super();
    this.config = config;
    this.confidenceThreshold =
      config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.tierRouter = new TierRouter(config.tierRouter);
  }

  /**
   * Initialize the pipeline. Starts health checks and prepares components.
   */
  async initialize(): Promise<void> {
    // Start cloud health monitoring
    this.tierRouter.startHealthChecks();

    // Initialize Tier 1 speech-to-intent if configured
    if (this.config.speechToIntent) {
      this.speechToIntent = new SpeechToIntent(this.config.speechToIntent);
      await this.speechToIntent.initialize();
    }
  }

  /**
   * Process a complete voice command through the pipeline.
   *
   * This is the main entry point for voice processing. It:
   * 1. Determines the appropriate tier via the tier router
   * 2. Runs the STT -> LLM -> TTS chain with streaming overlap
   * 3. Tracks latency per stage
   * 4. Returns a complete VoiceSession
   *
   * @param audio - Raw PCM audio buffer (16kHz, mono, 16-bit signed LE)
   * @param config - Streaming pipeline config override (optional)
   * @returns Complete VoiceSession with all stage timings
   */
  async processVoiceCommand(
    audio: Buffer,
    config?: Partial<StreamingPipelineConfig>
  ): Promise<VoiceSession> {
    const sessionId = randomUUID() as VoiceSessionId;
    const stages: StageTimestamp[] = [];
    const sessionStartTime = performance.now();

    let transcript = "";
    let parsedIntent: ParsedIntent | null = null;
    let responseText = "";
    let tier: VoiceTier = "tier2_cloud";
    let audioOutput: Buffer | null = null;

    try {
      // -------------------------------------------------------------------
      // Determine cloud availability
      // -------------------------------------------------------------------
      // On ESP32-S3 satellites, ESP-SR MultiNet handles common commands
      // locally before audio ever reaches this pipeline. Commands that
      // reach here are ones the satellite couldn't handle.

      const decision = this.tierRouter.route(transcript, transcript === "");
      tier = decision.tier;

      // -------------------------------------------------------------------
      // PRIMARY PATH: Groq LLM intent extraction (cloud)
      // -------------------------------------------------------------------
      // Groq is the primary intent extraction path. The regex/rules engine
      // proved unreliable for natural speech variations. Groq handles
      // intent extraction after STT, then streams to TTS.

      if (tier === "tier2_cloud") {
        const result = await this.runTier2Pipeline(
          audio,
          stages,
          config
        );

        transcript = result.transcript;
        parsedIntent = result.intent;
        responseText = result.responseText;
      }

      // -------------------------------------------------------------------
      // OFFLINE FALLBACK: Local pipeline + rules engine
      // -------------------------------------------------------------------
      // When cloud is unavailable, fall back to local STT + local LLM.
      // The regex rules engine is used as a last resort for offline mode.

      if (tier === "tier3_local") {
        const result = await this.runTier3Pipeline(audio, stages);

        transcript = result.transcript;
        parsedIntent = result.intent;
        responseText = result.responseText;

        // Rules engine as offline-only fallback when local LLM also fails
        if (!parsedIntent && transcript) {
          const rulesIntent = matchRule(transcript);
          if (rulesIntent) {
            parsedIntent = rulesIntent;
            tier = "tier1_rules";
          }
        }
      }

      // -------------------------------------------------------------------
      // Build final session
      // -------------------------------------------------------------------

      const totalLatency = performance.now() - sessionStartTime;
      const confidence = parsedIntent?.confidence ?? 0;
      const status =
        confidence > 0 && confidence < this.confidenceThreshold
          ? "confirmation_required"
          : parsedIntent
            ? "completed"
            : "failed";

      return this.buildSession(
        sessionId,
        tier,
        transcript,
        parsedIntent,
        responseText,
        stages,
        totalLatency,
        status
      );
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error(`Pipeline error: ${String(err)}`);
      this.emit("error", error, "error");

      const totalLatency = performance.now() - sessionStartTime;
      return this.buildSession(
        sessionId,
        tier,
        transcript,
        parsedIntent,
        `Error: ${error.message}`,
        stages,
        totalLatency,
        "failed"
      );
    }
  }

  /**
   * Release all resources. Must be called on shutdown.
   */
  destroy(): void {
    this.tierRouter.destroy();
    this.speechToIntent?.destroy();
    this.deepgramStt?.close();
    this.groqLlm?.destroy();
    this.cartesiaTts?.close();
    this.localStt?.destroy();
    this.localLlm?.destroy();
    this.localTts?.destroy();
    this.removeAllListeners();
  }

  // -----------------------------------------------------------------------
  // Tier 2: Cloud streaming pipeline with overlap
  // -----------------------------------------------------------------------

  private async runTier2Pipeline(
    audio: Buffer,
    stages: StageTimestamp[],
    _config?: Partial<StreamingPipelineConfig>
  ): Promise<{ transcript: string; intent: ParsedIntent | null; responseText: string }> {
    // -- STT Phase --
    const sttStart = performance.now();
    this.emit("stage_start", "stt");

    const stt = this.getDeepgramSTT();
    await stt.connect();

    // Send the full audio buffer
    stt.sendAudio(audio);
    stt.finishAudio();

    // Wait for final transcript
    const transcript = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("STT timeout: no final transcript within 10s"));
      }, 10_000);

      stt.on("partial", (t) => {
        this.emit("stt_partial", t.text);
      });

      stt.on("final", (t) => {
        clearTimeout(timeout);
        this.emit("stt_final", t.text);
        resolve(t.text);
      });

      stt.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const sttLatency = performance.now() - sttStart;
    stages.push(this.makeStage("stt", sttStart, sttLatency));
    this.emit("stage_complete", "stt", sttLatency);

    // Clean up STT listeners for this session
    stt.removeAllListeners("partial");
    stt.removeAllListeners("final");
    stt.removeAllListeners("error");

    // -- LLM Phase (with streaming TTS overlap) --
    const llmStart = performance.now();
    this.emit("stage_start", "llm");

    const llm = this.getGroqLLM();
    const tts = this.getCartesiaTTS();

    // Connect TTS WebSocket for streaming overlap
    await tts.connectWebSocket();
    const ttsContextId = `tts_${Date.now()}`;
    let ttsStarted = false;
    const ttsStart = performance.now();

    // Accumulate LLM tokens to feed to TTS in sentence chunks
    let tokenBuffer = "";
    const sentenceEnders = /[.!?]\s/;

    llm.on("token", (token) => {
      this.emit("llm_token", token);
      tokenBuffer += token;

      // Feed complete sentences to TTS for streaming overlap
      if (sentenceEnders.test(tokenBuffer)) {
        if (!ttsStarted) {
          this.emit("stage_start", "tts");
          tts.streamText(tokenBuffer, ttsContextId);
          ttsStarted = true;
        } else {
          tts.continueStream(tokenBuffer, ttsContextId);
        }
        tokenBuffer = "";
      }
    });

    // Listen for TTS audio chunks
    tts.on("audio_chunk", (chunk) => {
      this.emit("tts_audio", chunk);
    });

    // Build device context, injecting family personality if present
    let effectiveDeviceContext = this.config.deviceContext;
    if (this.config.familyContext) {
      const fc = this.config.familyContext;
      const familyPreamble =
        `AGENT IDENTITY: You are ${fc.profile.agent_name}.\n` +
        `AGE GROUP: ${fc.profile.age_group}\n` +
        `RESPONSE STYLE: Keep responses under ${fc.profile.agent_personality.max_response_words} words. ` +
        `Tone: ${fc.profile.agent_personality.tone}. ` +
        `Vocabulary: ${fc.profile.agent_personality.vocabulary_level}.\n` +
        (fc.profile.agent_personality.forbidden_topics.length > 0
          ? `FORBIDDEN TOPICS: ${fc.profile.agent_personality.forbidden_topics.join(", ")}.\n`
          : "") +
        (fc.profile.age_group === "toddler"
          ? "COMPANION MODE: No device control. Be a fun conversational companion (stories, songs, animal sounds).\n"
          : "") +
        'EMERGENCY: Always respond to "help", "emergency", "fire", "hurt" regardless of restrictions.\n';

      effectiveDeviceContext = familyPreamble + (effectiveDeviceContext ?? "");
    }

    const fullResponse = await llm.streamCompletion(
      transcript,
      effectiveDeviceContext,
    );

    const llmLatency = performance.now() - llmStart;
    stages.push(this.makeStage("llm", llmStart, llmLatency));
    this.emit("stage_complete", "llm", llmLatency);

    // Flush any remaining tokens to TTS
    if (tokenBuffer.trim()) {
      if (!ttsStarted) {
        this.emit("stage_start", "tts");
        tts.streamText(tokenBuffer, ttsContextId);
        ttsStarted = true;
      } else {
        tts.continueStream(tokenBuffer, ttsContextId);
      }
    }

    // Signal end of TTS stream
    if (ttsStarted) {
      tts.endStream(ttsContextId);

      // Wait for TTS to complete
      await new Promise<void>((resolve) => {
        tts.on("complete", () => {
          resolve();
        });
        // Timeout fallback
        setTimeout(resolve, 5000);
      });
    }

    const ttsLatency = performance.now() - ttsStart;
    if (ttsStarted) {
      stages.push(this.makeStage("tts", ttsStart, ttsLatency));
      this.emit("stage_complete", "tts", ttsLatency);
    }

    // Clean up event listeners
    llm.removeAllListeners("token");
    tts.removeAllListeners("audio_chunk");
    tts.removeAllListeners("complete");

    // Extract parsed intent from LLM response
    let intent: ParsedIntent | null = null;
    const intentFromLlm = this.extractIntentFromLlmResponse(fullResponse, transcript);
    if (intentFromLlm) {
      intent = intentFromLlm;
    }

    const responseText = llm.extractSpokenResponse(fullResponse);

    return { transcript, intent, responseText };
  }

  // -----------------------------------------------------------------------
  // Tier 3: Local fallback pipeline
  // -----------------------------------------------------------------------

  private async runTier3Pipeline(
    audio: Buffer,
    stages: StageTimestamp[]
  ): Promise<{ transcript: string; intent: ParsedIntent | null; responseText: string }> {
    // -- Local STT --
    const sttStart = performance.now();
    this.emit("stage_start", "stt");

    const stt = this.getLocalSTT();
    const sttResult = await stt.transcribe(audio);

    const sttLatency = performance.now() - sttStart;
    stages.push(this.makeStage("stt", sttStart, sttLatency));
    this.emit("stage_complete", "stt", sttLatency);
    this.emit("stt_final", sttResult.text);

    // -- Local LLM --
    const llmStart = performance.now();
    this.emit("stage_start", "llm");

    const llm = this.getLocalLLM();
    const intent = await llm.generateIntent(sttResult.text);

    const llmLatency = performance.now() - llmStart;
    stages.push(this.makeStage("llm", llmStart, llmLatency));
    this.emit("stage_complete", "llm", llmLatency);

    // -- Local TTS --
    const responseText = intent
      ? `${intent.domain} ${intent.action} confirmed`
      : "I didn't understand that command.";

    const ttsStart = performance.now();
    this.emit("stage_start", "tts");

    const tts = this.getLocalTTS();
    const ttsResult = await tts.synthesize(responseText);

    const ttsLatency = performance.now() - ttsStart;
    stages.push(this.makeStage("tts", ttsStart, ttsLatency));
    this.emit("stage_complete", "tts", ttsLatency);
    this.emit("tts_audio", ttsResult.audio);

    return { transcript: sttResult.text, intent, responseText };
  }

  // -----------------------------------------------------------------------
  // Component getters (lazy initialization)
  // -----------------------------------------------------------------------

  private getDeepgramSTT(): DeepgramSTT {
    if (!this.deepgramStt) {
      this.deepgramStt = new DeepgramSTT(this.config.deepgram);
    }
    return this.deepgramStt;
  }

  private getGroqLLM(): GroqLLM {
    if (!this.groqLlm) {
      this.groqLlm = new GroqLLM(this.config.groq);
    }
    return this.groqLlm;
  }

  private getCartesiaTTS(): CartesiaTTS {
    if (!this.cartesiaTts) {
      this.cartesiaTts = new CartesiaTTS(this.config.cartesia);
    }
    return this.cartesiaTts;
  }

  private getLocalSTT(): LocalSTT {
    if (!this.localStt) {
      this.localStt = new LocalSTT(this.config.localStt);
    }
    return this.localStt;
  }

  private getLocalLLM(): LocalLLM {
    if (!this.localLlm) {
      if (!this.config.localLlm) {
        throw new Error("Local LLM config not provided for Tier 3 fallback");
      }
      this.localLlm = new LocalLLM(this.config.localLlm);
    }
    return this.localLlm;
  }

  private getLocalTTS(): LocalTTS {
    if (!this.localTts) {
      this.localTts = new LocalTTS(this.config.localTts);
    }
    return this.localTts;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private makeStage(
    stage: PipelineStage,
    startedAt: number,
    latencyMs: number
  ): StageTimestamp {
    return {
      stage,
      started_at: startedAt,
      completed_at: startedAt + latencyMs,
      latency_ms: latencyMs,
    };
  }

  private buildSession(
    id: VoiceSessionId,
    tier: VoiceTier,
    transcript: string,
    parsedIntent: ParsedIntent | null,
    responseText: string,
    stages: StageTimestamp[],
    totalLatency: number,
    status?: VoiceSession["status"]
  ): VoiceSession {
    const confidence = parsedIntent?.confidence ?? 0;
    const resolvedStatus =
      status ??
      (confidence > 0 && confidence < this.confidenceThreshold
        ? "confirmation_required"
        : parsedIntent
          ? "completed"
          : "failed");

    return {
      id,
      tenant_id: this.config.tenantId,
      user_id: this.config.userId,
      device_id: this.config.deviceId,
      tier,
      transcript,
      parsed_intent: parsedIntent,
      response_text: responseText,
      stages,
      total_latency_ms: totalLatency,
      confidence,
      status: resolvedStatus,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Extract a ParsedIntent from the LLM's JSON-formatted response.
   */
  private extractIntentFromLlmResponse(
    response: string,
    rawTranscript: string
  ): ParsedIntent | null {
    try {
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch?.[1]) return null;

      const parsed: Record<string, unknown> = JSON.parse(jsonMatch[1]);
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
        confidence: 0.85,
        raw_transcript: rawTranscript,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Main entry point — process a voice command through the full pipeline.
 *
 * @param audio - Raw PCM audio buffer (16kHz, mono, 16-bit signed LE)
 * @param config - Full pipeline configuration
 * @returns Complete VoiceSession with timing, intent, and response
 */
export async function processVoiceCommand(
  audio: Buffer,
  config: StreamingPipelineConfig & {
    tenantId: TenantId;
    userId: UserId;
    deviceId: DeviceId;
    tierRouter?: TierRouterConfig;
    speechToIntent?: SpeechToIntentConfig;
    localStt?: LocalSTTConfig;
    localLlm?: LocalLLMConfig;
    localTts?: LocalTTSConfig;
    deviceContext?: string;
    confidenceThreshold?: number;
    familyContext?: FamilyVoiceContext;
  }
): Promise<VoiceSession> {
  const pipeline = new VoicePipeline({
    tenantId: config.tenantId,
    userId: config.userId,
    deviceId: config.deviceId,
    tierRouter: config.tierRouter ?? {},
    speechToIntent: config.speechToIntent,
    deepgram: {
      apiKey: process.env["DEEPGRAM_API_KEY"] ?? "",
      model: config.stt.model,
      language: config.stt.language,
      encoding: config.stt.encoding,
      sampleRate: config.stt.sample_rate,
    },
    groq: {
      apiKey: process.env["GROQ_API_KEY"] ?? "",
      model: config.llm.model,
      maxTokens: config.llm.max_tokens,
      temperature: config.llm.temperature,
      systemPrompt: config.llm.system_prompt,
    },
    cartesia: {
      apiKey: process.env["CARTESIA_API_KEY"] ?? "",
      model: config.tts.model,
      voiceId: config.tts.voice_id,
      outputFormat: config.tts.output_format === "pcm_16000" ? "pcm_s16le" : "pcm_s16le",
      sampleRate: config.tts.output_format === "pcm_16000" ? 16000 : 44100,
    },
    localStt: config.localStt,
    localLlm: config.localLlm,
    localTts: config.localTts,
    deviceContext: config.deviceContext,
    confidenceThreshold: config.confidenceThreshold,
    familyContext: config.familyContext,
  });

  try {
    await pipeline.initialize();
    return await pipeline.processVoiceCommand(audio);
  } finally {
    pipeline.destroy();
  }
}
