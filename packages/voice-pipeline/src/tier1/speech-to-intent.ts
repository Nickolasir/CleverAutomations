/**
 * Tier 1: Rules-Based Speech-to-Intent
 *
 * On the Pi hub, this uses the regex rules engine (rules-engine.ts) to convert
 * STT transcripts into structured intents without an LLM call.
 *
 * On ESP32-S3 satellites, ESP-SR MultiNet handles on-device speech command
 * recognition for up to 200 commands (free with Espressif silicon).
 * That processing happens in the satellite firmware, not here.
 *
 * This module provides a SpeechToIntent class that wraps the rules engine
 * for use in the Pi hub pipeline orchestrator.
 *
 * Target latency: 50-200ms (runs entirely on-device)
 *
 * NOTE: Picovoice Rhino is NOT used due to proprietary licensing ($899/mo).
 * ESP-SR MultiNet (free, on ESP32-S3) and regex rules engine (on Pi) replace it.
 */

import { EventEmitter } from "node:events";
import type { ParsedIntent } from "@clever/shared";
import { matchRule } from "./rules-engine.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Configuration for the SpeechToIntent engine */
export interface SpeechToIntentConfig {
  /**
   * Additional custom command patterns beyond what the rules engine provides.
   * Each entry maps a regex pattern string to intent fields.
   */
  customPatterns?: Array<{
    pattern: string;
    domain: string;
    action: string;
  }>;
  /**
   * Whether to require an endpoint (silence after speech) before returning.
   * Only relevant when processing streaming audio chunks.
   * Default: true
   */
  requireEndpoint?: boolean;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface SpeechToIntentEvents {
  intent: [intent: ParsedIntent];
  not_understood: [transcript: string];
  error: [error: Error];
}

// ---------------------------------------------------------------------------
// SpeechToIntent class
// ---------------------------------------------------------------------------

export class SpeechToIntent extends EventEmitter<SpeechToIntentEvents> {
  private readonly config: Required<SpeechToIntentConfig>;
  private isInitialized = false;
  private customRegexes: Array<{
    regex: RegExp;
    domain: string;
    action: string;
  }> = [];

  constructor(config: SpeechToIntentConfig) {
    super();
    this.config = {
      customPatterns: config.customPatterns ?? [],
      requireEndpoint: config.requireEndpoint ?? true,
    };
  }

  /**
   * Initialize the speech-to-intent engine.
   * Compiles custom regex patterns if provided.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Compile custom patterns
      this.customRegexes = this.config.customPatterns.map((p) => ({
        regex: new RegExp(p.pattern, "i"),
        domain: p.domain,
        action: p.action,
      }));

      this.isInitialized = true;
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error(`SpeechToIntent initialization failed: ${String(err)}`);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Process a transcript through the rules engine to extract intent.
   *
   * @param transcript - Text transcript from STT
   * @returns ParsedIntent if the rules engine matched, null otherwise
   */
  processTranscript(transcript: string): ParsedIntent | null {
    if (!this.isInitialized) {
      this.emit("error", new Error("SpeechToIntent not initialized. Call initialize() first."));
      return null;
    }

    try {
      // Try the built-in rules engine first (30+ patterns)
      const rulesIntent = matchRule(transcript);
      if (rulesIntent) {
        this.emit("intent", rulesIntent);
        return rulesIntent;
      }

      // Try custom patterns
      for (const custom of this.customRegexes) {
        const match = custom.regex.exec(transcript);
        if (match) {
          const intent: ParsedIntent = {
            domain: custom.domain,
            action: custom.action,
            target_room: undefined,
            target_device: undefined,
            parameters: {},
            confidence: 1.0,
            raw_transcript: transcript,
          };
          this.emit("intent", intent);
          return intent;
        }
      }

      // No match
      this.emit("not_understood", transcript);
      return null;
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error(`SpeechToIntent error: ${String(err)}`);
      this.emit("error", error);
      return null;
    }
  }

  /**
   * Process audio through the rules engine.
   * This is a compatibility method — on the Pi hub, audio must first go through
   * STT (Deepgram or Faster-Whisper) to get a transcript, then through processTranscript().
   *
   * For direct audio-to-intent on ESP32-S3 satellites, use ESP-SR MultiNet instead.
   *
   * @param _audio - Raw PCM audio (unused — transcript required)
   * @returns null (use processTranscript instead)
   */
  processAudio(_audio: Int16Array): ParsedIntent | null {
    this.emit("not_understood", "audio_input_not_supported");
    return null;
  }

  /**
   * Reset internal state for a new utterance.
   */
  reset(): void {
    // Stateless — no reset needed for regex matching
  }

  /**
   * Release all resources.
   */
  destroy(): void {
    this.customRegexes = [];
    this.isInitialized = false;
    this.removeAllListeners();
  }
}
