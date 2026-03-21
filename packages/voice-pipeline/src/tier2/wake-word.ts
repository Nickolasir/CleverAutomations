/**
 * Tier 2: openWakeWord Wake Word Detection (Pi Hub)
 *
 * Listens for the "Clever" wake word using openWakeWord (Apache 2.0).
 * Runs on the Pi hub via a Python subprocess (openWakeWord is Python-native).
 * ESP32-S3 satellites use microWakeWord (ESPHome native) instead.
 *
 * Target latency: ~80ms detection from end of utterance.
 * Runs entirely on-device, no cloud dependency.
 *
 * NOTE: Picovoice (Porcupine/Rhino) is NOT used due to proprietary licensing ($899/mo).
 */

import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Config and events
// ---------------------------------------------------------------------------

export interface WakeWordConfig {
  /**
   * Path to a custom openWakeWord .tflite model for "Clever".
   * If not provided, uses a pre-trained model (e.g., "hey_jarvis" for dev).
   */
  modelPath?: string;
  /**
   * Pre-trained model name to use if no custom model path is set.
   * Options: "hey_jarvis", "hey_mycroft", "alexa", etc.
   * Default: "hey_jarvis"
   */
  builtinModel?: string;
  /**
   * Detection threshold (0.0 to 1.0).
   * Higher = fewer false positives but may miss quiet utterances.
   * Default: 0.5
   */
  threshold?: number;
  /**
   * Path to the openWakeWord Python wrapper script.
   * Default: path resolved relative to this module.
   */
  wrapperScriptPath?: string;
}

export interface WakeWordEvents {
  wake: [timestamp: number];
  error: [error: Error];
  listening: [];
}

// ---------------------------------------------------------------------------
// WakeWordDetector class
// ---------------------------------------------------------------------------

export class WakeWordDetector extends EventEmitter<WakeWordEvents> {
  private process: ChildProcess | null = null;
  private readonly config: Required<WakeWordConfig>;
  private isListening = false;
  private detectionCount = 0;

  /** Timestamp of the last wake word detection (for debouncing) */
  private lastDetectionTime = 0;

  /** Minimum ms between detections to prevent double-triggers */
  private static readonly DEBOUNCE_MS = 1500;

  constructor(config: WakeWordConfig) {
    super();
    this.config = {
      modelPath: config.modelPath ?? "",
      builtinModel: config.builtinModel ?? "hey_jarvis",
      threshold: config.threshold ?? 0.5,
      wrapperScriptPath: config.wrapperScriptPath ?? "",
    };
  }

  /**
   * Initialize the openWakeWord engine.
   * Spawns a Python subprocess that loads the model and listens on stdin for audio frames.
   * Outputs detection events on stdout as JSON lines.
   */
  async initialize(): Promise<void> {
    // openWakeWord runs as a Python subprocess.
    // The wrapper script reads PCM audio from stdin and outputs JSON detection events.
    // This approach keeps the Node.js event loop unblocked.
    try {
      const args = [
        "-m", "openwakeword",
        "--model", this.config.modelPath || this.config.builtinModel,
        "--threshold", String(this.config.threshold),
        "--format", "json",
      ];

      this.process = spawn("python3", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.process.stdout?.on("data", (data: Buffer) => {
        this.handleOutput(data.toString("utf-8"));
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString("utf-8").trim();
        if (msg && !msg.startsWith("INFO")) {
          this.emit("error", new Error(`openWakeWord: ${msg}`));
        }
      });

      this.process.on("error", (err) => {
        this.emit("error", new Error(`openWakeWord process error: ${err.message}`));
      });

      this.process.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          this.emit("error", new Error(`openWakeWord exited with code ${code}`));
        }
        this.isListening = false;
      });

      this.detectionCount = 0;
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error(`openWakeWord initialization failed: ${String(err)}`);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Start listening for wake words.
   * Emits 'listening' when ready to process frames.
   */
  start(): void {
    if (!this.process) {
      this.emit("error", new Error("WakeWordDetector not initialized. Call initialize() first."));
      return;
    }
    this.isListening = true;
    this.emit("listening");
  }

  /**
   * Stop listening for wake words. Frames will be ignored until start() is called again.
   */
  stop(): void {
    this.isListening = false;
  }

  /**
   * Process a single audio frame by writing it to the openWakeWord subprocess stdin.
   *
   * @param frame - PCM audio frame (Int16Array) at 16kHz, mono.
   * @returns true if a detection was recently emitted (async detection via subprocess)
   */
  processFrame(frame: Int16Array): boolean {
    if (!this.process || !this.isListening) {
      return false;
    }

    try {
      // Write raw PCM bytes to the subprocess stdin
      const buffer = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
      this.process.stdin?.write(buffer);
      return false; // Detection is async via stdout
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error(`openWakeWord write error: ${String(err)}`);
      this.emit("error", error);
      return false;
    }
  }

  /**
   * Process a continuous audio buffer, writing it to the subprocess.
   *
   * @param audio - Continuous PCM audio buffer (Int16, 16kHz, mono)
   * @returns false (detections are async)
   */
  processAudio(audio: Int16Array): boolean {
    if (!this.process || !this.isListening) return false;

    const buffer = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
    this.process.stdin?.write(buffer);
    return false;
  }

  /**
   * Get the expected sample rate (always 16000 Hz).
   */
  get sampleRate(): number {
    return 16000;
  }

  /**
   * Get the total number of wake word detections since initialization.
   */
  get totalDetections(): number {
    return this.detectionCount;
  }

  /**
   * Check if the detector is actively listening.
   */
  get active(): boolean {
    return this.isListening && this.process !== null;
  }

  /**
   * Release all resources held by the openWakeWord subprocess.
   * Must be called when the pipeline shuts down.
   */
  destroy(): void {
    this.isListening = false;
    if (this.process) {
      try {
        this.process.stdin?.end();
        this.process.kill("SIGTERM");
      } catch {
        // Ignore cleanup errors
      }
      this.process = null;
    }
    this.removeAllListeners();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Handle JSON-line output from the openWakeWord subprocess.
   * Expected format: {"detected": true, "model": "hey_jarvis", "score": 0.85, "timestamp": 1234.5}
   */
  private handleOutput(data: string): void {
    const lines = data.trim().split("\n");

    for (const line of lines) {
      try {
        const event: Record<string, unknown> = JSON.parse(line);

        if (event["detected"] === true) {
          const now = performance.now();

          // Debounce: ignore detections too close together
          if (now - this.lastDetectionTime < WakeWordDetector.DEBOUNCE_MS) {
            continue;
          }

          this.lastDetectionTime = now;
          this.detectionCount++;
          this.emit("wake", now);
        }
      } catch {
        // Ignore non-JSON output lines (startup messages, etc.)
      }
    }
  }
}
