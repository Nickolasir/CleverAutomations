/**
 * Tier Router — Determines which processing tier to use for a voice command.
 *
 * Fallback chain: Tier 1 (rules) -> Tier 2 (cloud) -> Tier 3 (local)
 *
 * - Tier 1 is always tried first (instant, no network, no cost).
 * - Tier 2 is used when Tier 1 doesn't match AND cloud APIs are healthy.
 * - Tier 3 is the local fallback when cloud is unavailable.
 *
 * Health checks ping Deepgram, Groq, and Cartesia directly.
 * OpenRouter fallback is ONLY activated if Groq direct API is down.
 */

import type { VoiceTier, ParsedIntent, FamilyVoiceContext } from "@clever/shared";
import { matchRule, couldMatchRule } from "../tier1/rules-engine.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface TierRouterConfig {
  /** Deepgram API key for health checks */
  deepgramApiKey?: string;
  /** Groq API key for health checks */
  groqApiKey?: string;
  /** Cartesia API key for health checks */
  cartesiaApiKey?: string;
  /** How often to re-check cloud health (ms). Default: 30000 */
  healthCheckIntervalMs?: number;
  /** Timeout for individual health check pings (ms). Default: 3000 */
  healthCheckTimeoutMs?: number;
  /** Force a specific tier (for testing/debugging) */
  forceTier?: VoiceTier;
  /** Disable Tier 3 local fallback (e.g., if no models installed) */
  disableTier3?: boolean;
}

export interface CloudHealthStatus {
  deepgram: boolean;
  groq: boolean;
  cartesia: boolean;
  lastChecked: number;
  allHealthy: boolean;
}

export interface TierDecision {
  tier: VoiceTier;
  reason: string;
  /** If Tier 1 matched, the parsed intent is included */
  tier1Intent: ParsedIntent | null;
  /** Whether to use OpenRouter as LLM fallback (only if Groq is down) */
  useOpenRouterFallback: boolean;
}

// ---------------------------------------------------------------------------
// TierRouter class
// ---------------------------------------------------------------------------

export class TierRouter {
  private readonly config: Required<TierRouterConfig>;
  private cloudHealth: CloudHealthStatus;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: TierRouterConfig = {}) {
    this.config = {
      deepgramApiKey: config.deepgramApiKey ?? "",
      groqApiKey: config.groqApiKey ?? "",
      cartesiaApiKey: config.cartesiaApiKey ?? "",
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 30_000,
      healthCheckTimeoutMs: config.healthCheckTimeoutMs ?? 3_000,
      forceTier: config.forceTier ?? (undefined as unknown as VoiceTier),
      disableTier3: config.disableTier3 ?? false,
    };

    this.cloudHealth = {
      deepgram: true, // Optimistically assume healthy at startup
      groq: true,
      cartesia: true,
      lastChecked: 0,
      allHealthy: true,
    };
  }

  /**
   * Start periodic health checking of cloud APIs.
   * Should be called once at pipeline startup.
   */
  startHealthChecks(): void {
    // Run an immediate check
    void this.checkAllHealth();

    // Schedule periodic checks
    this.healthCheckTimer = setInterval(() => {
      void this.checkAllHealth();
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Stop periodic health checks.
   */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Determine which tier should handle a voice command.
   *
   * @param transcript    - The user's transcript (or empty string if not yet available)
   * @param hasAudioOnly  - True if only raw audio is available (no transcript yet)
   * @param familyContext - Optional family context (used for logging; does not affect tier selection)
   * @returns TierDecision with the selected tier and reasoning
   */
  route(transcript: string, hasAudioOnly = false, _familyContext?: FamilyVoiceContext): TierDecision {
    // Force tier override for testing
    if (this.config.forceTier) {
      return {
        tier: this.config.forceTier,
        reason: `Forced to ${this.config.forceTier} via config`,
        tier1Intent: null,
        useOpenRouterFallback: false,
      };
    }

    // Step 1: Try Tier 1 rules engine (only works with text)
    if (transcript && !hasAudioOnly) {
      const tier1Intent = matchRule(transcript);
      if (tier1Intent) {
        return {
          tier: "tier1_rules",
          reason: `Tier 1 rule matched: ${tier1Intent.domain}.${tier1Intent.action}`,
          tier1Intent,
          useOpenRouterFallback: false,
        };
      }
    }

    // Step 2: Check if cloud APIs are available for Tier 2
    if (this.cloudHealth.deepgram && (this.cloudHealth.groq || this.cloudHealth.cartesia)) {
      // Tier 2 is viable — at minimum we need STT + LLM
      const useOpenRouterFallback = !this.cloudHealth.groq;

      return {
        tier: "tier2_cloud",
        reason: useOpenRouterFallback
          ? "Tier 2 cloud (Groq down, using OpenRouter LLM fallback)"
          : "Tier 2 cloud (all APIs healthy)",
        tier1Intent: null,
        useOpenRouterFallback,
      };
    }

    // Step 3: Fall back to Tier 3 local
    if (!this.config.disableTier3) {
      return {
        tier: "tier3_local",
        reason: "Tier 3 local fallback (cloud APIs unhealthy)",
        tier1Intent: null,
        useOpenRouterFallback: false,
      };
    }

    // No tier available — this shouldn't happen in production
    return {
      tier: "tier2_cloud",
      reason: "Tier 3 disabled, attempting Tier 2 despite health issues",
      tier1Intent: null,
      useOpenRouterFallback: !this.cloudHealth.groq,
    };
  }

  /**
   * Quick check if the transcript could potentially match a Tier 1 rule.
   * Useful for early-exit optimization during streaming STT.
   */
  couldBeTier1(partialTranscript: string): boolean {
    return couldMatchRule(partialTranscript);
  }

  /**
   * Get the current cloud health status.
   */
  getHealthStatus(): Readonly<CloudHealthStatus> {
    return { ...this.cloudHealth };
  }

  /**
   * Manually trigger a health check (e.g., after a request failure).
   */
  async checkAllHealth(): Promise<CloudHealthStatus> {
    const [deepgram, groq, cartesia] = await Promise.all([
      this.checkDeepgramHealth(),
      this.checkGroqHealth(),
      this.checkCartesiaHealth(),
    ]);

    this.cloudHealth = {
      deepgram,
      groq,
      cartesia,
      lastChecked: Date.now(),
      allHealthy: deepgram && groq && cartesia,
    };

    return this.cloudHealth;
  }

  /**
   * Release resources.
   */
  destroy(): void {
    this.stopHealthChecks();
  }

  // -----------------------------------------------------------------------
  // Individual health checks — DIRECT API pings (never via OpenRouter)
  // -----------------------------------------------------------------------

  private async checkDeepgramHealth(): Promise<boolean> {
    if (!this.config.deepgramApiKey) return false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.healthCheckTimeoutMs
      );

      const response = await fetch("https://api.deepgram.com/v1/projects", {
        method: "GET",
        headers: {
          Authorization: `Token ${this.config.deepgramApiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      // 200 or 401 means the API is reachable (401 = bad key, but service is up)
      return response.status === 200 || response.status === 401;
    } catch {
      return false;
    }
  }

  private async checkGroqHealth(): Promise<boolean> {
    if (!this.config.groqApiKey) return false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.healthCheckTimeoutMs
      );

      const response = await fetch("https://api.groq.com/openai/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.config.groqApiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async checkCartesiaHealth(): Promise<boolean> {
    if (!this.config.cartesiaApiKey) return false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.healthCheckTimeoutMs
      );

      const response = await fetch("https://api.cartesia.ai/voices", {
        method: "GET",
        headers: {
          "X-API-Key": this.config.cartesiaApiKey,
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
}
