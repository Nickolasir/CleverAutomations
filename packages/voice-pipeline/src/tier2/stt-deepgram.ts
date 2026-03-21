/**
 * Tier 2: Deepgram Nova-3 Streaming Speech-to-Text
 *
 * DIRECT WebSocket connection to the Deepgram API (NOT through OpenRouter).
 * Streams audio chunks and receives partial + final transcripts in real-time.
 *
 * Model: Nova-3 | Encoding: linear16 | Sample Rate: 16kHz | Language: English
 * Target: ~150ms to first partial transcript tokens
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";

// ---------------------------------------------------------------------------
// Config and events
// ---------------------------------------------------------------------------

export interface DeepgramSTTConfig {
  /** Deepgram API key (direct, not via OpenRouter) */
  apiKey: string;
  /** Model to use (default: "nova-3") */
  model?: string;
  /** Language code (default: "en") */
  language?: string;
  /** Audio encoding (default: "linear16") */
  encoding?: "linear16" | "opus" | "flac" | "mulaw";
  /** Audio sample rate in Hz (default: 16000) */
  sampleRate?: number;
  /** Number of audio channels (default: 1) */
  channels?: number;
  /** Enable interim/partial results (default: true) */
  interimResults?: boolean;
  /** Enable punctuation (default: true) */
  punctuate?: boolean;
  /** Enable smart formatting (default: true) */
  smartFormat?: boolean;
  /** Enable endpointing with timeout in ms (default: 300) */
  endpointing?: number | false;
  /** Max reconnection attempts on disconnect (default: 3) */
  maxReconnectAttempts?: number;
  /** Delay between reconnection attempts in ms (default: 1000) */
  reconnectDelayMs?: number;
}

export interface DeepgramTranscript {
  /** The transcript text */
  text: string;
  /** Whether this is a final (not interim) result */
  isFinal: boolean;
  /** Confidence score 0.0-1.0 */
  confidence: number;
  /** Timestamp when this result was received */
  receivedAt: number;
  /** Duration of the recognized audio segment in seconds */
  duration: number;
  /** Individual word-level details (if available) */
  words: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}

export interface DeepgramSTTEvents {
  /** Partial/interim transcript (text may change) */
  partial: [transcript: DeepgramTranscript];
  /** Final transcript (text is locked in) */
  final: [transcript: DeepgramTranscript];
  /** Connection opened */
  connected: [];
  /** Connection closed */
  disconnected: [code: number, reason: string];
  /** Reconnection attempt */
  reconnecting: [attempt: number];
  /** Error occurred */
  error: [error: Error];
}

// ---------------------------------------------------------------------------
// Deepgram WebSocket response shapes
// ---------------------------------------------------------------------------

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
}

interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words: DeepgramWord[];
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

interface DeepgramResponse {
  type: "Results" | "Metadata" | "UtteranceEnd" | "SpeechStarted" | "Error";
  channel_index?: number[];
  duration?: number;
  start?: number;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: DeepgramChannel;
  error?: string;
}

// ---------------------------------------------------------------------------
// DeepgramSTT class
// ---------------------------------------------------------------------------

const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";

export class DeepgramSTT extends EventEmitter<DeepgramSTTEvents> {
  private ws: WebSocket | null = null;
  private readonly config: Required<DeepgramSTTConfig>;
  private reconnectAttempts = 0;
  private isConnecting = false;
  private isClosed = false;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  /** Accumulated final transcript across the session */
  private accumulatedTranscript = "";

  constructor(config: DeepgramSTTConfig) {
    super();
    this.config = {
      apiKey: config.apiKey,
      model: config.model ?? "nova-3",
      language: config.language ?? "en",
      encoding: config.encoding ?? "linear16",
      sampleRate: config.sampleRate ?? 16000,
      channels: config.channels ?? 1,
      interimResults: config.interimResults ?? true,
      punctuate: config.punctuate ?? true,
      smartFormat: config.smartFormat ?? true,
      endpointing: config.endpointing ?? 300,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 3,
      reconnectDelayMs: config.reconnectDelayMs ?? 1000,
    };
  }

  /**
   * Open a streaming WebSocket connection to Deepgram.
   * The connection stays open until close() is called or an unrecoverable error occurs.
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.isConnecting) return;

    this.isConnecting = true;
    this.isClosed = false;

    const url = this.buildWebSocketUrl();

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(url, {
          headers: {
            Authorization: `Token ${this.config.apiKey}`,
          },
        });

        this.ws.on("open", () => {
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.accumulatedTranscript = "";
          this.startKeepAlive();
          this.emit("connected");
          resolve();
        });

        this.ws.on("message", (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on("close", (code: number, reason: Buffer) => {
          this.isConnecting = false;
          this.stopKeepAlive();
          const reasonStr = reason.toString("utf-8");
          this.emit("disconnected", code, reasonStr);

          // Attempt reconnection if not intentionally closed
          if (!this.isClosed) {
            this.attemptReconnect();
          }
        });

        this.ws.on("error", (err: Error) => {
          this.isConnecting = false;
          this.emit("error", err);
          if (!this.isClosed) {
            reject(err);
          }
        });
      } catch (err) {
        this.isConnecting = false;
        const error =
          err instanceof Error ? err : new Error(`Deepgram connection failed: ${String(err)}`);
        this.emit("error", error);
        reject(error);
      }
    });
  }

  /**
   * Send an audio chunk to Deepgram for streaming transcription.
   *
   * @param audio - Raw PCM audio data (Buffer or Int16Array)
   */
  sendAudio(audio: Buffer | Int16Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.emit("error", new Error("WebSocket not connected. Call connect() first."));
      return;
    }

    // Convert Int16Array to Buffer if needed
    const buffer = audio instanceof Buffer ? audio : Buffer.from(audio.buffer);
    this.ws.send(buffer);
  }

  /**
   * Signal the end of audio input to Deepgram.
   * Deepgram will flush any remaining audio and send final results.
   */
  finishAudio(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Send the CloseStream message per Deepgram protocol
    this.ws.send(JSON.stringify({ type: "CloseStream" }));
  }

  /**
   * Get the accumulated final transcript for the current session.
   */
  get transcript(): string {
    return this.accumulatedTranscript.trim();
  }

  /**
   * Check if the WebSocket is currently connected.
   */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Close the WebSocket connection and release resources.
   */
  close(): void {
    this.isClosed = true;
    this.stopKeepAlive();

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.finishAudio();
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

  private buildWebSocketUrl(): string {
    const params = new URLSearchParams({
      model: this.config.model,
      language: this.config.language,
      encoding: this.config.encoding,
      sample_rate: String(this.config.sampleRate),
      channels: String(this.config.channels),
      punctuate: String(this.config.punctuate),
      smart_format: String(this.config.smartFormat),
      interim_results: String(this.config.interimResults),
    });

    if (this.config.endpointing !== false) {
      params.set("endpointing", String(this.config.endpointing));
    }

    return `${DEEPGRAM_WS_URL}?${params.toString()}`;
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const response: DeepgramResponse = JSON.parse(data.toString());

      if (response.type === "Error") {
        this.emit("error", new Error(`Deepgram error: ${response.error ?? "Unknown error"}`));
        return;
      }

      if (response.type !== "Results") return;

      const channel = response.channel;
      if (!channel?.alternatives?.length) return;

      const bestAlt = channel.alternatives[0]!;
      if (!bestAlt.transcript) return;

      const transcript: DeepgramTranscript = {
        text: bestAlt.transcript,
        isFinal: response.is_final === true,
        confidence: bestAlt.confidence,
        receivedAt: performance.now(),
        duration: response.duration ?? 0,
        words: bestAlt.words.map((w) => ({
          word: w.punctuated_word ?? w.word,
          start: w.start,
          end: w.end,
          confidence: w.confidence,
        })),
      };

      if (transcript.isFinal) {
        this.accumulatedTranscript += (this.accumulatedTranscript ? " " : "") + transcript.text;
        this.emit("final", transcript);
      } else {
        this.emit("partial", transcript);
      }
    } catch (err) {
      this.emit(
        "error",
        err instanceof Error ? err : new Error(`Failed to parse Deepgram message: ${String(err)}`)
      );
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.isClosed) return;
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.emit(
        "error",
        new Error(
          `Deepgram reconnection failed after ${this.config.maxReconnectAttempts} attempts`
        )
      );
      return;
    }

    this.reconnectAttempts++;
    this.emit("reconnecting", this.reconnectAttempts);

    await new Promise<void>((resolve) =>
      setTimeout(resolve, this.config.reconnectDelayMs * this.reconnectAttempts)
    );

    if (!this.isClosed) {
      try {
        await this.connect();
      } catch {
        // Reconnection failed; the error event will be emitted by connect()
      }
    }
  }

  /**
   * Send periodic keep-alive messages to prevent WebSocket timeout.
   * Deepgram closes idle connections after ~10 seconds of no audio.
   */
  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, 8000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }
}
