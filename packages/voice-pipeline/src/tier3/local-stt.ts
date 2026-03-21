/**
 * Tier 3: Faster-Whisper Local Speech-to-Text
 *
 * Spawns a faster-whisper process to transcribe audio locally
 * when cloud APIs (Deepgram) are unavailable.
 *
 * Model: base.en (English-only, optimized for speed on CPU/Hailo)
 * Input: PCM audio buffer (16kHz, mono, 16-bit signed)
 * Output: Transcript string
 *
 * This is the offline fallback — slower than Deepgram but requires
 * no internet connectivity.
 */

import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Config and events
// ---------------------------------------------------------------------------

export interface LocalSTTConfig {
  /** Path to the faster-whisper-xxl or faster-whisper CLI binary */
  binaryPath?: string;
  /** Model size (default: "base.en") */
  model?: string;
  /** Device to run on: "cpu", "cuda", "auto" (default: "cpu") */
  device?: "cpu" | "cuda" | "auto";
  /** Compute type: "int8", "float16", "float32" (default: "int8" for speed) */
  computeType?: "int8" | "float16" | "float32";
  /** Number of CPU threads (default: 4) */
  threads?: number;
  /** Beam size for decoding (default: 1 for speed) */
  beamSize?: number;
  /** Language (default: "en") */
  language?: string;
  /** Process timeout in ms (default: 30000) */
  timeoutMs?: number;
}

export interface LocalSTTEvents {
  /** Transcription completed */
  transcript: [text: string, latencyMs: number];
  /** Error occurred */
  error: [error: Error];
}

export interface LocalSTTResult {
  text: string;
  latencyMs: number;
  segments: Array<{
    text: string;
    start: number;
    end: number;
  }>;
}

// ---------------------------------------------------------------------------
// LocalSTT class
// ---------------------------------------------------------------------------

export class LocalSTT extends EventEmitter<LocalSTTEvents> {
  private readonly config: Required<LocalSTTConfig>;
  private activeProcess: ChildProcess | null = null;

  constructor(config: LocalSTTConfig = {}) {
    super();
    this.config = {
      binaryPath: config.binaryPath ?? "faster-whisper",
      model: config.model ?? "base.en",
      device: config.device ?? "cpu",
      computeType: config.computeType ?? "int8",
      threads: config.threads ?? 4,
      beamSize: config.beamSize ?? 1,
      language: config.language ?? "en",
      timeoutMs: config.timeoutMs ?? 30000,
    };
  }

  /**
   * Transcribe a PCM audio buffer using faster-whisper.
   *
   * The audio is written to a temporary WAV file, processed by the
   * faster-whisper CLI, and the transcript is returned.
   *
   * @param audio - PCM audio buffer (16kHz, mono, 16-bit signed little-endian)
   * @returns Transcription result with text, latency, and segments
   */
  async transcribe(audio: Buffer): Promise<LocalSTTResult> {
    const startTime = performance.now();
    let tempDir: string | null = null;

    try {
      // Create a temporary directory for the WAV file
      tempDir = await mkdtemp(join(tmpdir(), "clever-stt-"));
      const wavPath = join(tempDir, "input.wav");

      // Write PCM data as a WAV file (faster-whisper needs a file input)
      const wavBuffer = this.pcmToWav(audio, 16000, 1, 16);
      await writeFile(wavPath, wavBuffer);

      // Spawn faster-whisper process
      const result = await this.runFasterWhisper(wavPath);

      const latencyMs = performance.now() - startTime;
      this.emit("transcript", result.text, latencyMs);

      return {
        ...result,
        latencyMs,
      };
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error(`Local STT failed: ${String(err)}`);
      this.emit("error", error);
      throw error;
    } finally {
      // Cleanup temp files
      if (tempDir) {
        try {
          await unlink(join(tempDir, "input.wav"));
          // Remove temp directory (rmdir only works on empty dirs, which it now is)
          const { rmdir } = await import("node:fs/promises");
          await rmdir(tempDir);
        } catch {
          // Cleanup failure is non-critical
        }
      }
    }
  }

  /**
   * Check if the faster-whisper binary is available on the system.
   *
   * @returns true if the binary can be executed
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
   * Abort any in-progress transcription.
   */
  abort(): void {
    if (this.activeProcess && !this.activeProcess.killed) {
      this.activeProcess.kill("SIGTERM");
      this.activeProcess = null;
    }
  }

  /**
   * Release resources.
   */
  destroy(): void {
    this.abort();
    this.removeAllListeners();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private runFasterWhisper(
    wavPath: string
  ): Promise<{ text: string; segments: Array<{ text: string; start: number; end: number }> }> {
    return new Promise((resolve, reject) => {
      const args = [
        wavPath,
        "--model",
        this.config.model,
        "--device",
        this.config.device,
        "--compute_type",
        this.config.computeType,
        "--threads",
        String(this.config.threads),
        "--beam_size",
        String(this.config.beamSize),
        "--language",
        this.config.language,
        "--output_format",
        "json",
        "--output_dir",
        "-", // stdout
      ];

      const proc = spawn(this.config.binaryPath, args, {
        timeout: this.config.timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.activeProcess = proc;

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("error", (err: Error) => {
        this.activeProcess = null;
        reject(new Error(`faster-whisper process error: ${err.message}`));
      });

      proc.on("exit", (code: number | null) => {
        this.activeProcess = null;

        if (code !== 0 && code !== null) {
          reject(
            new Error(
              `faster-whisper exited with code ${code}: ${stderr.trim()}`
            )
          );
          return;
        }

        try {
          // faster-whisper outputs segments, one per line or as JSON
          const result = this.parseOutput(stdout);
          resolve(result);
        } catch (err) {
          // Fallback: treat raw stdout as the transcript
          resolve({
            text: stdout.trim(),
            segments: [{ text: stdout.trim(), start: 0, end: 0 }],
          });
        }
      });
    });
  }

  /**
   * Parse faster-whisper JSON or text output into structured segments.
   */
  private parseOutput(
    raw: string
  ): { text: string; segments: Array<{ text: string; start: number; end: number }> } {
    // Try JSON parse first
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const segments = parsed.map((seg: Record<string, unknown>) => ({
          text: String(seg["text"] ?? ""),
          start: Number(seg["start"] ?? 0),
          end: Number(seg["end"] ?? 0),
        }));
        const text = segments.map((s) => s.text).join(" ").trim();
        return { text, segments };
      }
    } catch {
      // Not JSON, try line-based parsing
    }

    // Line-based output: "[00:00.000 --> 00:02.500] Hello world"
    const lines = raw.trim().split("\n").filter(Boolean);
    const segments: Array<{ text: string; start: number; end: number }> = [];

    for (const line of lines) {
      const match = line.match(
        /\[(\d+:\d+\.\d+)\s*-->\s*(\d+:\d+\.\d+)\]\s*(.*)/
      );
      if (match) {
        segments.push({
          text: match[3]!.trim(),
          start: this.parseTimestamp(match[1]!),
          end: this.parseTimestamp(match[2]!),
        });
      } else {
        // Plain text line
        segments.push({ text: line.trim(), start: 0, end: 0 });
      }
    }

    const text = segments.map((s) => s.text).join(" ").trim();
    return { text, segments };
  }

  /** Parse "MM:SS.mmm" timestamp to seconds */
  private parseTimestamp(ts: string): number {
    const parts = ts.split(":");
    if (parts.length === 2) {
      return Number(parts[0]) * 60 + Number(parts[1]);
    }
    return Number(ts);
  }

  /**
   * Convert raw PCM data to WAV format (RIFF header + PCM data).
   */
  private pcmToWav(
    pcmData: Buffer,
    sampleRate: number,
    channels: number,
    bitsPerSample: number
  ): Buffer {
    const byteRate = (sampleRate * channels * bitsPerSample) / 8;
    const blockAlign = (channels * bitsPerSample) / 8;
    const dataSize = pcmData.length;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const wav = Buffer.alloc(totalSize);

    // RIFF header
    wav.write("RIFF", 0);
    wav.writeUInt32LE(totalSize - 8, 4);
    wav.write("WAVE", 8);

    // fmt sub-chunk
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16); // Sub-chunk size
    wav.writeUInt16LE(1, 20); // PCM format
    wav.writeUInt16LE(channels, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(byteRate, 28);
    wav.writeUInt16LE(blockAlign, 32);
    wav.writeUInt16LE(bitsPerSample, 34);

    // data sub-chunk
    wav.write("data", 36);
    wav.writeUInt32LE(dataSize, 40);
    pcmData.copy(wav, 44);

    return wav;
  }
}
