/**
 * Tier 2: Cartesia Sonic 3 Streaming Text-to-Speech
 *
 * DIRECT API connection to Cartesia (NOT through OpenRouter).
 * Streams audio output — starts receiving PCM audio before the full
 * text has been sent, enabling pipeline overlap with the LLM stage.
 *
 * Output: PCM 16kHz mono for speaker playback on Raspberry Pi.
 * Target: ~100ms to first audio chunk.
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";

// ---------------------------------------------------------------------------
// Config and events
// ---------------------------------------------------------------------------

export interface CartesiaTTSConfig {
  /** Cartesia API key (direct, never via OpenRouter for voice) */
  apiKey: string;
  /** Model ID (default: "sonic-3") */
  model?: string;
  /** Voice ID for the speaking voice */
  voiceId: string;
  /**
   * Output audio format.
   * "pcm_s16le" = raw 16-bit signed little-endian PCM
   */
  outputFormat?: "pcm_s16le" | "pcm_f32le";
  /** Output sample rate in Hz (default: 16000) */
  sampleRate?: number;
  /** Container format (default: "raw" for PCM) */
  container?: "raw";
  /** Request timeout in ms (default: 15000) */
  timeoutMs?: number;
}

export interface CartesiaTTSEvents {
  /** A chunk of PCM audio data ready for playback */
  audio_chunk: [chunk: Buffer, chunkIndex: number];
  /** All audio for this utterance has been received */
  complete: [totalChunks: number, totalBytes: number, latencyMs: number];
  /** Connection established */
  connected: [];
  /** Error occurred */
  error: [error: Error];
}

// ---------------------------------------------------------------------------
// Cartesia WebSocket protocol types
// ---------------------------------------------------------------------------

interface CartesiaContextOptions {
  model_id: string;
  voice: {
    mode: "id";
    id: string;
  };
  output_format: {
    container: string;
    encoding: string;
    sample_rate: number;
  };
  transcript: string;
  language?: string;
}

interface CartesiaAudioResponse {
  type: "chunk" | "done" | "error" | "timestamps";
  data?: string; // Base64-encoded audio data
  status_code?: number;
  message?: string;
  step_time?: number;
  done?: boolean;
  context_id?: string;
  word_timestamps?: {
    words: string[];
    start: number[];
    end: number[];
  };
}

// ---------------------------------------------------------------------------
// CartesiaTTS class
// ---------------------------------------------------------------------------

const CARTESIA_WS_URL = "wss://api.cartesia.ai/tts/websocket";
const CARTESIA_REST_URL = "https://api.cartesia.ai/tts/bytes";

export class CartesiaTTS extends EventEmitter<CartesiaTTSEvents> {
  private ws: WebSocket | null = null;
  private readonly config: Required<CartesiaTTSConfig>;
  private isClosed = false;
  private contextCounter = 0;

  constructor(config: CartesiaTTSConfig) {
    super();
    this.config = {
      apiKey: config.apiKey,
      model: config.model ?? "sonic-3",
      voiceId: config.voiceId,
      outputFormat: config.outputFormat ?? "pcm_s16le",
      sampleRate: config.sampleRate ?? 16000,
      container: config.container ?? "raw",
      timeoutMs: config.timeoutMs ?? 15000,
    };
  }

  // -----------------------------------------------------------------------
  // WebSocket streaming API (preferred for pipeline overlap)
  // -----------------------------------------------------------------------

  /**
   * Open a persistent WebSocket connection to Cartesia.
   * Enables streaming TTS with pipeline overlap — send text chunks
   * as they arrive from the LLM, receive audio immediately.
   */
  async connectWebSocket(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.isClosed = false;

    const url = `${CARTESIA_WS_URL}?api_key=${this.config.apiKey}&cartesia_version=2024-06-10`;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.on("open", () => {
        this.emit("connected");
        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        this.handleWebSocketMessage(data);
      });

      this.ws.on("error", (err: Error) => {
        this.emit("error", err);
        reject(err);
      });

      this.ws.on("close", () => {
        this.ws = null;
        if (!this.isClosed) {
          this.emit("error", new Error("Cartesia WebSocket closed unexpectedly"));
        }
      });
    });
  }

  /**
   * Send text to Cartesia for streaming TTS via WebSocket.
   * Audio chunks will be emitted as 'audio_chunk' events.
   *
   * @param text - Text to synthesize
   * @param contextId - Optional context ID for tracking (auto-generated if omitted)
   * @returns The context ID for this synthesis request
   */
  streamText(text: string, contextId?: string): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.emit("error", new Error("WebSocket not connected. Call connectWebSocket() first."));
      return "";
    }

    const ctxId = contextId ?? `ctx_${++this.contextCounter}_${Date.now()}`;

    const message: CartesiaContextOptions & { context_id: string; continue?: boolean } = {
      context_id: ctxId,
      model_id: this.config.model,
      voice: {
        mode: "id",
        id: this.config.voiceId,
      },
      output_format: {
        container: this.config.container,
        encoding: this.config.outputFormat,
        sample_rate: this.config.sampleRate,
      },
      transcript: text,
      language: "en",
    };

    this.ws.send(JSON.stringify(message));
    return ctxId;
  }

  /**
   * Send a continuation text chunk for an existing context.
   * Use this to feed LLM tokens to TTS as they arrive (pipeline overlap).
   *
   * @param text - Additional text to append to the ongoing synthesis
   * @param contextId - The context ID from a previous streamText() call
   */
  continueStream(text: string, contextId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.emit("error", new Error("WebSocket not connected."));
      return;
    }

    const message = {
      context_id: contextId,
      model_id: this.config.model,
      voice: {
        mode: "id",
        id: this.config.voiceId,
      },
      output_format: {
        container: this.config.container,
        encoding: this.config.outputFormat,
        sample_rate: this.config.sampleRate,
      },
      transcript: text,
      continue: true,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Signal that no more text will be sent for this context.
   * Cartesia will flush remaining audio.
   */
  endStream(contextId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        context_id: contextId,
        transcript: "",
        continue: false,
      })
    );
  }

  // -----------------------------------------------------------------------
  // REST API (simpler, for non-streaming use cases)
  // -----------------------------------------------------------------------

  /**
   * Synthesize complete text to audio via the REST API.
   * Simpler than WebSocket but doesn't support streaming overlap.
   *
   * @param text - Complete text to synthesize
   * @returns PCM audio buffer
   */
  async synthesize(text: string): Promise<Buffer> {
    const startTime = performance.now();

    const response = await fetch(CARTESIA_REST_URL, {
      method: "POST",
      headers: {
        "X-API-Key": this.config.apiKey,
        "Cartesia-Version": "2024-06-10",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: this.config.model,
        transcript: text,
        voice: {
          mode: "id",
          id: this.config.voiceId,
        },
        output_format: {
          container: this.config.container,
          encoding: this.config.outputFormat,
          sample_rate: this.config.sampleRate,
        },
        language: "en",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cartesia API error ${response.status}: ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    const latencyMs = performance.now() - startTime;

    this.emit("audio_chunk", audioBuffer, 0);
    this.emit("complete", 1, audioBuffer.length, latencyMs);

    return audioBuffer;
  }

  /**
   * Perform a health check against the Cartesia API.
   *
   * @returns true if Cartesia is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      // Use a minimal synthesis request to check availability
      const response = await fetch("https://api.cartesia.ai/voices", {
        method: "GET",
        headers: {
          "X-API-Key": this.config.apiKey,
          "Cartesia-Version": "2024-06-10",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Close all connections and release resources.
   */
  close(): void {
    this.isClosed = true;

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, "Client closing");
      }
      this.ws.removeAllListeners();
      this.ws = null;
    }

    this.removeAllListeners();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Track per-context audio for the 'complete' event */
  private contextAudioState = new Map<
    string,
    { chunks: number; bytes: number; startTime: number }
  >();

  private handleWebSocketMessage(data: WebSocket.Data): void {
    try {
      const response: CartesiaAudioResponse & { context_id?: string } = JSON.parse(
        data.toString()
      );

      if (response.type === "error") {
        this.emit(
          "error",
          new Error(`Cartesia error ${response.status_code ?? ""}: ${response.message ?? "Unknown"}`)
        );
        return;
      }

      const contextId = response.context_id ?? "default";

      if (response.type === "chunk" && response.data) {
        // Decode base64 audio data to Buffer
        const audioChunk = Buffer.from(response.data, "base64");

        // Track state for this context
        let state = this.contextAudioState.get(contextId);
        if (!state) {
          state = { chunks: 0, bytes: 0, startTime: performance.now() };
          this.contextAudioState.set(contextId, state);
        }

        state.chunks++;
        state.bytes += audioChunk.length;

        this.emit("audio_chunk", audioChunk, state.chunks - 1);
      }

      if (response.type === "done" || response.done === true) {
        const state = this.contextAudioState.get(contextId);
        if (state) {
          const latencyMs = performance.now() - state.startTime;
          this.emit("complete", state.chunks, state.bytes, latencyMs);
          this.contextAudioState.delete(contextId);
        } else {
          this.emit("complete", 0, 0, 0);
        }
      }
    } catch (err) {
      this.emit(
        "error",
        err instanceof Error
          ? err
          : new Error(`Failed to parse Cartesia message: ${String(err)}`)
      );
    }
  }
}
