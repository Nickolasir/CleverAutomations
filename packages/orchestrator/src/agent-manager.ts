/**
 * Agent Manager
 *
 * Manages the lifecycle of family member agents. Agents are stateless
 * and instantiated per-request from cached profile data. The manager
 * handles profile loading, caching, and agent construction.
 */

import type {
  FamilyMemberProfile,
  FamilyVoiceContext,
  WakeWordEntry,
  TenantId,
} from "@clever/shared";
import type { LLMClient } from "./llm-client.js";
import { FamilyMemberAgent } from "./family-agent.js";

// ---------------------------------------------------------------------------
// Profile loader interface (injected by host environment)
// ---------------------------------------------------------------------------

/**
 * Interface for loading family data from the database.
 * Matches the FamilyProfileLoader from wake-word-registry.ts
 * so the same implementation can be reused.
 */
export interface FamilyProfileLoader {
  getProfileByAgentName(
    tenantId: TenantId,
    agentName: string,
  ): Promise<FamilyMemberProfile | null>;

  getAllProfiles(tenantId: TenantId): Promise<FamilyMemberProfile[]>;

  getOverrides(
    profileId: string,
  ): Promise<import("@clever/shared").FamilyPermissionOverride[]>;

  getSchedules(
    profileId: string,
  ): Promise<import("@clever/shared").FamilySchedule[]>;

  getSpendingLimit(
    profileId: string,
  ): Promise<import("@clever/shared").FamilySpendingLimit | null>;
}

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

interface CachedProfile {
  context: FamilyVoiceContext;
  entry: WakeWordEntry;
  cachedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Agent Manager
// ---------------------------------------------------------------------------

export class AgentManager {
  private readonly loader: FamilyProfileLoader;
  private readonly llm: LLMClient;
  private readonly tenantId: TenantId;
  private readonly cache: Map<string, CachedProfile> = new Map();

  constructor(
    loader: FamilyProfileLoader,
    llm: LLMClient,
    tenantId: TenantId,
  ) {
    this.loader = loader;
    this.llm = llm;
    this.tenantId = tenantId;
  }

  /**
   * Get a FamilyMemberAgent for the given agent name.
   * Returns null if no matching profile exists or the agent name is "clever".
   */
  async getAgent(agentName: string): Promise<FamilyMemberAgent | null> {
    const key = agentName.toLowerCase();

    // "clever" is the orchestrator, not a family agent
    if (key === "clever") return null;

    // Check cache
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return new FamilyMemberAgent(this.llm, cached.context, cached.entry);
    }

    // Load from database
    const profile = await this.loader.getProfileByAgentName(
      this.tenantId,
      agentName,
    );
    if (!profile || !profile.is_active) return null;

    // Check expiration
    if (profile.expires_at && new Date(profile.expires_at) < new Date()) {
      return null;
    }

    // Load full context
    const [overrides, schedules, spendingLimit] = await Promise.all([
      this.loader.getOverrides(profile.id),
      this.loader.getSchedules(profile.id),
      this.loader.getSpendingLimit(profile.id),
    ]);

    const context: FamilyVoiceContext = {
      profile,
      overrides,
      active_schedules: schedules,
      spending_limit: spendingLimit,
    };

    const entry: WakeWordEntry = {
      wake_word: key,
      user_id: profile.user_id,
      profile_id: profile.id,
      agent_name: profile.agent_name,
      voice_id: profile.agent_voice_id,
      personality: profile.agent_personality,
      age_group: profile.age_group,
    };

    // Cache it
    this.cache.set(key, { context, entry, cachedAt: Date.now() });

    return new FamilyMemberAgent(this.llm, context, entry);
  }

  /**
   * Get all registered family agent names for this tenant.
   */
  async getAgentNames(): Promise<string[]> {
    const profiles = await this.loader.getAllProfiles(this.tenantId);
    return profiles
      .filter((p) => p.is_active)
      .filter((p) => !p.expires_at || new Date(p.expires_at) >= new Date())
      .map((p) => p.agent_name);
  }

  /**
   * Get the FamilyVoiceContext for an agent (for permission checking).
   */
  async getVoiceContext(agentName: string): Promise<FamilyVoiceContext | null> {
    const agent = await this.getAgent(agentName);
    return agent?.voiceContext ?? null;
  }

  /**
   * Invalidate cache for a specific agent or all agents.
   */
  invalidateCache(agentName?: string): void {
    if (agentName) {
      this.cache.delete(agentName.toLowerCase());
    } else {
      this.cache.clear();
    }
  }
}
