/**
 * @clever/voice-pipeline — Streaming voice pipeline for smart home control
 *
 * Three-tier hybrid voice processing system:
 *   Tier 1: Instant rules engine (50-200ms) — regex pattern matching
 *   Tier 2: Cloud streaming (580-900ms) — Deepgram + Groq + Cartesia DIRECT APIs
 *   Tier 3: Local fallback (3-5s) — faster-whisper + llama.cpp + Piper
 *
 * All voice-critical API calls are DIRECT (never through OpenRouter).
 * OpenRouter is ONLY used as LLM fallback when Groq is unavailable.
 */

// ---------------------------------------------------------------------------
// Tier 1: Instant rules engine & speech-to-intent
// ---------------------------------------------------------------------------

export { matchRule, getRules, couldMatchRule } from "./tier1/rules-engine.js";
export { SpeechToIntent } from "./tier1/speech-to-intent.js";
export type { SpeechToIntentConfig, SpeechToIntentEvents } from "./tier1/speech-to-intent.js";

// ---------------------------------------------------------------------------
// Tier 2: Cloud streaming pipeline (DIRECT APIs)
// ---------------------------------------------------------------------------

export { WakeWordDetector } from "./tier2/wake-word.js";
export type { WakeWordConfig, WakeWordEvents } from "./tier2/wake-word.js";

export { DeepgramSTT } from "./tier2/stt-deepgram.js";
export type {
  DeepgramSTTConfig,
  DeepgramSTTEvents,
  DeepgramTranscript,
} from "./tier2/stt-deepgram.js";

export { GroqLLM } from "./tier2/llm-groq.js";
export type { GroqLLMConfig, GroqLLMEvents } from "./tier2/llm-groq.js";

export { CartesiaTTS } from "./tier2/tts-cartesia.js";
export type { CartesiaTTSConfig, CartesiaTTSEvents } from "./tier2/tts-cartesia.js";

// ---------------------------------------------------------------------------
// Tier 3: Local fallback pipeline
// ---------------------------------------------------------------------------

export { LocalSTT } from "./tier3/local-stt.js";
export type { LocalSTTConfig, LocalSTTEvents, LocalSTTResult } from "./tier3/local-stt.js";

export { LocalLLM } from "./tier3/local-llm.js";
export type { LocalLLMConfig, LocalLLMEvents } from "./tier3/local-llm.js";

export { LocalTTS } from "./tier3/local-tts.js";
export type { LocalTTSConfig, LocalTTSEvents, LocalTTSResult } from "./tier3/local-tts.js";

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export { VoicePipeline, processVoiceCommand } from "./orchestrator/pipeline.js";
export type { VoicePipelineConfig, PipelineEvents } from "./orchestrator/pipeline.js";

export { TierRouter } from "./orchestrator/tier-router.js";
export type {
  TierRouterConfig,
  CloudHealthStatus,
  TierDecision,
} from "./orchestrator/tier-router.js";
