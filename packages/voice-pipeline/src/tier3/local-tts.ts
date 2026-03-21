/**
 * Tier 3: Piper TTS Local Text-to-Speech
 *
 * Spawns the Piper TTS process to synthesize speech locally
 * when cloud APIs (Cartesia) are unavailable.
 *
 * Model: en_US-lessac-medium (good quality / speed balance for Pi 5)
 * Output: PCM 16kHz mono 16-bit signed little-endian audio
 *
 * This is the offline fallback — lower quality than Cartesia Sonic 3
 * but requires no internet connectivity.
 */

import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, unlink, readFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Config and events
// ---------------------------------------------------------------------------

export interface LocalTTSConfig {
  /** Path to the piper binary */
  binaryPath?: string;
  /** Path to the .onnx model file (default: auto-detected) */
  modelPath?: string;
  /** Output sample rate in Hz (default: 16000) */
  sampleRate?: number;
  /** Speaking rate multiplier (default: 1.0) */
  speakingRate?: number;
  /** Sentence silence duration in seconds (default: 0.2) */
  sentenceSilence?: number;
  /** Process timeout in ms (default: 15000) */
  timeoutMs?: number;
}

export interface LocalTTSEvents {
  /** Audio synthesis completed */
  audio: [buffer: Buffer, latencyMs: number];
  /** Error occurred */
  error: [error: Error];
}

export interface LocalTTSResult {
  /** PCM audio buffer (16kHz, mono, 16-bit signed LE) */
  audio: Buffer;
  /** Time from request to complete audio in ms */
  latencyMs: number;
  /** Text that was synthesized */
  text: string;
}

// ---------------------------------------------------------------------------
// LocalTTS class
// ---------------------------------------------------------------------------

export class LocalTTS extends EventEmitter<LocalTTSEvents> {
  private readonly config: Required<LocalTTSConfig>;
  private activeProcess: ChildProcess | null = null;

  constructor(config: LocalTTSConfig = {}) {
    super();
    this.config = {
      binaryPath: config.binaryPath ?? "piper",
      modelPath: config.modelPath ?? "en_US-lessac-medium.onnx",
      sampleRate: config.sampleRate ?? 16000,
      speakingRate: config.speakingRate ?? 1.0,
      sentenceSilence: config.sentenceSilence ?? 0.2,
      timeoutMs: config.timeoutMs ?? 15000,
    };
  }

  /**
   * Synthesize text into PCM audio using Piper TTS.
   *
   * @param text - Text to synthesize into speech
   * @returns PCM audio buffer (16kHz, mono, 16-bit signed LE)
   */
  async synthesize(text: string): Promise<LocalTTSResult> {
    if (!text.trim()) {
      return { audio: Buffer.alloc(0), latencyMs: 0, text };
    }

    const startTime = performance.now();
    let tempDir: string | null = null;

    try {
      // Create temporary directory for output
      tempDir = await mkdtemp(join(tmpdir(), "clever-tts-"));
      const outputPath = join(tempDir, "output.wav");

      // Run Piper TTS
      await this.runPiper(text, outputPath);

      // Read the generated WAV file
      const wavBuffer = await readFile(outputPath);

      // Strip WAV header (44 bytes) to get raw PCM
      const pcmBuffer = wavBuffer.subarray(44);

      const latencyMs = performance.now() - startTime;
      this.emit("audio", pcmBuffer, latencyMs);

      return { audio: pcmBuffer, latencyMs, text };
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error(`Local TTS failed: ${String(err)}`);
      this.emit("error", error);
      throw error;
    } finally {
      // Cleanup temp files
      if (tempDir) {
        try {
          await unlink(join(tempDir, "output.wav"));
          const { rmdir } = await import("node:fs/promises");
          await rmdir(tempDir);
        } catch {
          // Cleanup failure is non-critical
        }
      }
    }
  }

  /**
   * Synthesize text and stream PCM audio chunks via stdout pipe.
   * More memory-efficient for longer utterances.
   *
   * @param text - Text to synthesize
   * @param onChunk - Callback for each audio chunk
   * @returns Total audio buffer concatenated from all chunks
   */
  async synthesizeStreaming(
    text: string,
    onChunk: (chunk: Buffer) => void
  ): Promise<Buffer> {
    if (!text.trim()) {
      return Buffer.alloc(0);
    }

    const startTime = performance.now();

    return new Promise<Buffer>((resolve, reject) => {
      const args = this.buildArgs();
      // Use --output_raw to pipe raw PCM to stdout
      args.push("--output_raw");

      const proc = spawn(this.config.binaryPath, args, {
        timeout: this.config.timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.activeProcess = proc;
      const chunks: Buffer[] = [];
      let headerSkipped = false;

      proc.stdout?.on("data", (data: Buffer) => {
        // Piper --output_raw already outputs raw PCM, no header to skip
        if (!headerSkipped) {
          headerSkipped = true;
        }
        chunks.push(data);
        onChunk(data);
      });

      // Feed text via stdin
      proc.stdin?.write(text);
      proc.stdin?.end();

      let stderr = "";
      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("error", (err: Error) => {
        this.activeProcess = null;
        reject(new Error(`piper process error: ${err.message}`));
      });

      proc.on("exit", (code: number | null) => {
        this.activeProcess = null;

        if (code !== 0 && code !== null) {
          reject(new Error(`piper exited with code ${code}: ${stderr.slice(-500)}`));
          return;
        }

        const fullBuffer = Buffer.concat(chunks);
        const latencyMs = performance.now() - startTime;
        this.emit("audio", fullBuffer, latencyMs);
        resolve(fullBuffer);
      });
    });
  }

  /**
   * Check if the piper binary is available on the system.
   */
  async isAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      try {
        const proc = spawn(this.config.binaryPath, ["--help"], {
          timeout: 5000,
          stdio: "pipe",
        });
        proc.on("error", () => resolve(false));
        proc.on("exit", (code) => resolve(code === 0));
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Abort any in-progress synthesis.
   */
  abort(): void {
    if (this.activeProcess && !this.activeProcess.killed) {
      this.activeProcess.kill("SIGTERM");
      this.activeProcess = null;
    }
  }

  /**
   * Release all resources.
   */
  destroy(): void {
    this.abort();
    this.removeAllListeners();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Build common piper CLI arguments.
   */
  private buildArgs(): string[] {
    return [
      "--model",
      this.config.modelPath,
      "--length_scale",
      String(1.0 / this.config.speakingRate),
      "--sentence_silence",
      String(this.config.sentenceSilence),
    ];
  }

  /**
   * Run piper to synthesize text to a WAV file.
   */
  private runPiper(text: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        ...this.buildArgs(),
        "--output_file",
        outputPath,
      ];

      const proc = spawn(this.config.binaryPath, args, {
        timeout: this.config.timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.activeProcess = proc;

      // Feed text via stdin
      proc.stdin?.write(text);
      proc.stdin?.end();

      let stderr = "";
      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("error", (err: Error) => {
        this.activeProcess = null;
        reject(new Error(`piper error: ${err.message}`));
      });

      proc.on("exit", (code: number | null) => {
        this.activeProcess = null;

        if (code !== 0 && code !== null) {
          reject(new Error(`piper exited with code ${code}: ${stderr.slice(-500)}`));
          return;
        }

        resolve();
      });
    });
  }
}
