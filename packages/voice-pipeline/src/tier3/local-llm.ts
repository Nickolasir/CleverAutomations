/**
 * Tier 3: llama.cpp Local LLM
 *
 * Runs a local LLM via llama.cpp server or direct CLI invocation.
 * Uses Qwen2.5 1.5B at Q4_K_M quantization for smart home intent parsing.
 *
 * Configured for Hailo AI HAT+ GPU offloading via n_gpu_layers to
 * maximize inference speed on Raspberry Pi 5 hardware.
 *
 * Target: 4-8 tok/s on Pi 5 with Hailo acceleration.
 */

import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import type { ParsedIntent } from "@clever/shared";

// ---------------------------------------------------------------------------
// Config and events
// ---------------------------------------------------------------------------

export interface LocalLLMConfig {
  /** Path to the llama-server or llama-cli binary */
  binaryPath?: string;
  /** Path to the GGUF model file */
  modelPath: string;
  /** Number of GPU layers to offload to Hailo HAT+ (default: 20) */
  nGpuLayers?: number;
  /** Context window size in tokens (default: 2048 — small for speed) */
  contextSize?: number;
  /** Number of CPU threads (default: 4 for Pi 5) */
  threads?: number;
  /** Maximum tokens to generate (default: 256) */
  maxTokens?: number;
  /** Temperature for sampling (default: 0.1 for deterministic output) */
  temperature?: number;
  /**
   * Mode: "server" uses a running llama-server HTTP API,
   *        "cli" spawns llama-cli for each request.
   * Default: "server" (lower per-request overhead)
   */
  mode?: "server" | "cli";
  /** llama-server host (default: "127.0.0.1") */
  serverHost?: string;
  /** llama-server port (default: 8081) */
  serverPort?: number;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
}

export interface LocalLLMEvents {
  /** Individual token generated */
  token: [token: string];
  /** Full response completed */
  complete: [response: string, latencyMs: number];
  /** Parsed intent from the response */
  intent_parsed: [intent: ParsedIntent];
  /** Error occurred */
  error: [error: Error];
  /** Server started (server mode) */
  server_ready: [];
}

/** System prompt optimized for small models — structured, explicit instructions */
const LOCAL_SYSTEM_PROMPT = `You are a smart home assistant. Parse the user's voice command into a JSON device command.

Respond with ONLY a JSON object:
{"domain":"<light|lock|thermostat|scene|fan>","action":"<turn_on|turn_off|lock|unlock|set_temperature|set_brightness|activate>","target_room":"<room or null>","parameters":{}}

Examples:
User: turn on the bedroom lights
{"domain":"light","action":"turn_on","target_room":"bedroom","parameters":{}}

User: set temperature to 72
{"domain":"thermostat","action":"set_temperature","target_room":null,"parameters":{"temperature":72}}

User: lock the front door
{"domain":"lock","action":"lock","target_room":null,"parameters":{"door":"front"}}`;

// ---------------------------------------------------------------------------
// LocalLLM class
// ---------------------------------------------------------------------------

export class LocalLLM extends EventEmitter<LocalLLMEvents> {
  private readonly config: Required<LocalLLMConfig>;
  private serverProcess: ChildProcess | null = null;
  private activeProcess: ChildProcess | null = null;
  private isServerRunning = false;

  constructor(config: LocalLLMConfig) {
    super();
    this.config = {
      binaryPath: config.binaryPath ?? "llama-server",
      modelPath: config.modelPath,
      nGpuLayers: config.nGpuLayers ?? 20,
      contextSize: config.contextSize ?? 2048,
      threads: config.threads ?? 4,
      maxTokens: config.maxTokens ?? 256,
      temperature: config.temperature ?? 0.1,
      mode: config.mode ?? "server",
      serverHost: config.serverHost ?? "127.0.0.1",
      serverPort: config.serverPort ?? 8081,
      timeoutMs: config.timeoutMs ?? 30000,
    };
  }

  // -----------------------------------------------------------------------
  // Server mode
  // -----------------------------------------------------------------------

  /**
   * Start the llama-server process (server mode).
   * The server stays running and handles requests via HTTP.
   * This amortizes model loading time across multiple requests.
   */
  async startServer(): Promise<void> {
    if (this.isServerRunning) return;

    return new Promise<void>((resolve, reject) => {
      const args = [
        "--model",
        this.config.modelPath,
        "--host",
        this.config.serverHost,
        "--port",
        String(this.config.serverPort),
        "--n-gpu-layers",
        String(this.config.nGpuLayers),
        "--ctx-size",
        String(this.config.contextSize),
        "--threads",
        String(this.config.threads),
      ];

      this.serverProcess = spawn(this.config.binaryPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stderr = "";

      this.serverProcess.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
        // llama-server logs "HTTP server listening" when ready
        if (stderr.includes("HTTP server listening") || stderr.includes("listening on")) {
          this.isServerRunning = true;
          this.emit("server_ready");
          resolve();
        }
      });

      this.serverProcess.on("error", (err: Error) => {
        this.isServerRunning = false;
        const error = new Error(`llama-server failed to start: ${err.message}`);
        this.emit("error", error);
        reject(error);
      });

      this.serverProcess.on("exit", (code: number | null) => {
        this.isServerRunning = false;
        if (code !== 0 && code !== null) {
          const error = new Error(
            `llama-server exited with code ${code}: ${stderr.slice(-500)}`
          );
          this.emit("error", error);
          reject(error);
        }
      });

      // Timeout waiting for server to start
      setTimeout(() => {
        if (!this.isServerRunning) {
          reject(new Error("llama-server failed to start within timeout"));
        }
      }, this.config.timeoutMs);
    });
  }

  /**
   * Stop the llama-server process.
   */
  stopServer(): void {
    if (this.serverProcess && !this.serverProcess.killed) {
      this.serverProcess.kill("SIGTERM");
      this.serverProcess = null;
    }
    this.isServerRunning = false;
  }

  // -----------------------------------------------------------------------
  // Inference
  // -----------------------------------------------------------------------

  /**
   * Generate a response from the local LLM for a voice transcript.
   *
   * @param transcript - The user's spoken command
   * @returns The complete LLM response text
   */
  async generate(transcript: string): Promise<string> {
    if (this.config.mode === "server") {
      return this.generateViaServer(transcript);
    }
    return this.generateViaCli(transcript);
  }

  /**
   * Generate a response and parse it into a ParsedIntent.
   *
   * @param transcript - The user's spoken command
   * @returns ParsedIntent or null if parsing fails
   */
  async generateIntent(transcript: string): Promise<ParsedIntent | null> {
    const response = await this.generate(transcript);
    const intent = this.parseIntentFromResponse(response, transcript);

    if (intent) {
      this.emit("intent_parsed", intent);
    }

    return intent;
  }

  /**
   * Check if the llama-server is running and responding.
   */
  async isAvailable(): Promise<boolean> {
    if (this.config.mode === "server") {
      return this.checkServerHealth();
    }
    // CLI mode: check if the binary exists
    return new Promise<boolean>((resolve) => {
      try {
        const proc = spawn(this.config.binaryPath, ["--version"], {
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
   * Abort any in-progress generation.
   */
  abort(): void {
    if (this.activeProcess && !this.activeProcess.killed) {
      this.activeProcess.kill("SIGTERM");
      this.activeProcess = null;
    }
  }

  /**
   * Release all resources. Stops the server if running.
   */
  destroy(): void {
    this.abort();
    this.stopServer();
    this.removeAllListeners();
  }

  // -----------------------------------------------------------------------
  // Server mode inference (HTTP to llama-server)
  // -----------------------------------------------------------------------

  private async generateViaServer(transcript: string): Promise<string> {
    const startTime = performance.now();
    const url = `http://${this.config.serverHost}:${this.config.serverPort}/completion`;

    const prompt = this.buildPrompt(transcript);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs
      );

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          n_predict: this.config.maxTokens,
          temperature: this.config.temperature,
          stop: ["\n\n", "User:", "</s>"],
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`llama-server error ${response.status}: ${await response.text()}`);
      }

      const data: Record<string, unknown> = await response.json();
      const content = String(data["content"] ?? "");
      const latencyMs = performance.now() - startTime;

      this.emit("complete", content, latencyMs);
      return content.trim();
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error(`llama-server request failed: ${String(err)}`);
      this.emit("error", error);
      throw error;
    }
  }

  // -----------------------------------------------------------------------
  // CLI mode inference (spawn llama-cli per request)
  // -----------------------------------------------------------------------

  private generateViaCli(transcript: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      const prompt = this.buildPrompt(transcript);

      // Use llama-cli (formerly main) binary
      const cliBinary = this.config.binaryPath.replace("llama-server", "llama-cli");

      const args = [
        "--model",
        this.config.modelPath,
        "--n-gpu-layers",
        String(this.config.nGpuLayers),
        "--ctx-size",
        String(this.config.contextSize),
        "--threads",
        String(this.config.threads),
        "--n-predict",
        String(this.config.maxTokens),
        "--temp",
        String(this.config.temperature),
        "--prompt",
        prompt,
        "--no-display-prompt",
      ];

      const proc = spawn(cliBinary, args, {
        timeout: this.config.timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.activeProcess = proc;

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        this.emit("token", text);
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("error", (err: Error) => {
        this.activeProcess = null;
        const error = new Error(`llama-cli error: ${err.message}`);
        this.emit("error", error);
        reject(error);
      });

      proc.on("exit", (code: number | null) => {
        this.activeProcess = null;
        const latencyMs = performance.now() - startTime;

        if (code !== 0 && code !== null) {
          const error = new Error(
            `llama-cli exited with code ${code}: ${stderr.slice(-500)}`
          );
          this.emit("error", error);
          reject(error);
          return;
        }

        const content = stdout.trim();
        this.emit("complete", content, latencyMs);
        resolve(content);
      });
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Build the prompt in chat-like format for Qwen2.5.
   */
  private buildPrompt(transcript: string): string {
    return `<|im_start|>system
${LOCAL_SYSTEM_PROMPT}
<|im_end|>
<|im_start|>user
${transcript}
<|im_end|>
<|im_start|>assistant
`;
  }

  /**
   * Parse the LLM JSON output into a ParsedIntent.
   */
  private parseIntentFromResponse(
    response: string,
    rawTranscript: string
  ): ParsedIntent | null {
    try {
      // Find JSON in the response (may have surrounding text/whitespace)
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return null;

      const parsed: Record<string, unknown> = JSON.parse(jsonMatch[0]);

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
        confidence: 0.65, // Local small model gets lower default confidence
        raw_transcript: rawTranscript,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if the llama-server is healthy.
   */
  private async checkServerHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(
        `http://${this.config.serverHost}:${this.config.serverPort}/health`,
        { signal: controller.signal }
      );

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }
}
