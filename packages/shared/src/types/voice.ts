/** Voice pipeline types — covers all 3 tiers of the voice system */

import type { TenantId, UserId } from "./tenant.js";
import type { DeviceId } from "./device.js";

export type VoiceSessionId = string & { readonly __brand: "VoiceSessionId" };

export type VoiceTier = "tier1_rules" | "tier2_cloud" | "tier3_local";

export type PipelineStage =
  | "wake_word"
  | "stt"
  | "intent_parse"
  | "llm"
  | "command_execute"
  | "tts"
  | "complete"
  | "error";

export interface VoiceSession {
  id: VoiceSessionId;
  tenant_id: TenantId;
  user_id: UserId;
  device_id: DeviceId;
  tier: VoiceTier;
  transcript: string;
  parsed_intent: ParsedIntent | null;
  response_text: string;
  stages: StageTimestamp[];
  total_latency_ms: number;
  confidence: number;
  status: "processing" | "completed" | "failed" | "confirmation_required";
  created_at: string;
}

export interface ParsedIntent {
  domain: string;
  action: string;
  target_device?: string;
  target_room?: string;
  parameters: Record<string, unknown>;
  confidence: number;
  raw_transcript: string;
}

export interface StageTimestamp {
  stage: PipelineStage;
  started_at: number;
  completed_at: number;
  latency_ms: number;
  metadata?: Record<string, unknown>;
}

/** Tier 1: Rules engine pattern for instant local commands */
export interface RulePattern {
  id: string;
  pattern: RegExp | string;
  domain: string;
  action: string;
  extract_params: (match: RegExpMatchArray) => Record<string, unknown>;
}

/** Tier 2: Streaming pipeline config for cloud APIs */
export interface StreamingPipelineConfig {
  stt: {
    provider: "deepgram";
    model: "nova-3";
    language: "en";
    encoding: "linear16";
    sample_rate: 16000;
  };
  llm: {
    provider: "groq";
    model: string;
    max_tokens: number;
    temperature: number;
    system_prompt: string;
  };
  tts: {
    provider: "cartesia";
    model: "sonic-3";
    voice_id: string;
    output_format: "pcm_16000" | "pcm_44100";
  };
}

/** Tier 3: Local fallback config */
export interface LocalFallbackConfig {
  stt: {
    provider: "faster-whisper";
    model: "base.en";
  };
  llm: {
    provider: "llama_cpp";
    model: "qwen2.5-1.5b-q4_k_m" | "phi-2-q4_k_m";
    n_gpu_layers: number;
  };
  tts: {
    provider: "piper";
    model: "en_US-lessac-medium";
  };
}

/** Confidence threshold — commands below this require user confirmation */
export const CONFIDENCE_THRESHOLD = 0.7;

/** Voice transcript stored encrypted, never raw audio */
export interface VoiceTranscriptRecord {
  id: string;
  session_id: VoiceSessionId;
  tenant_id: TenantId;
  user_id: UserId;
  transcript_encrypted: string;
  intent_summary: string;
  tier_used: VoiceTier;
  latency_ms: number;
  created_at: string;
}
