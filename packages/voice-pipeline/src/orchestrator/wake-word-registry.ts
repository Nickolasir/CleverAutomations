/**
 * Wake Word Registry
 *
 * Maps agent names (wake words) to family member profiles. When an ESP32
 * satellite detects a wake word like "Hey Jarvis" or "Hey Luna", the Pi
 * Agent uses this registry to identify which family member is speaking
 * and load their permissions, personality, and TTS voice.
 *
 * The generic "Clever" wake word still works — it routes to a default
 * handler or asks "Who am I speaking with?" for high-risk actions.
 */

import type {
  FamilyMemberProfile,
  FamilyPermissionOverride,
  FamilySchedule,
  FamilySpendingLimit,
  FamilyVoiceContext,
  WakeWordEntry,
  AgentPersonality,
  AideProfile,
} from "@clever/shared";
import type { TenantId, UserId } from "@clever/shared";

// ---------------------------------------------------------------------------
// Profile loader interface
// ---------------------------------------------------------------------------

/**
 * Interface for loading family data from the database (Supabase).
 * The pi-agent injects a concrete implementation.
 */
export interface FamilyProfileLoader {
  /** Load a family profile by agent name within a tenant. */
  getProfileByAgentName(
    tenantId: TenantId,
    agentName: string,
  ): Promise<FamilyMemberProfile | null>;

  /** Load all active family profiles for a tenant (for building the registry). */
  getAllProfiles(tenantId: TenantId): Promise<FamilyMemberProfile[]>;

  /** Load permission overrides for a profile. */
  getOverrides(profileId: string): Promise<FamilyPermissionOverride[]>;

  /** Load active schedules for a profile. */
  getSchedules(profileId: string): Promise<FamilySchedule[]>;

  /** Load spending limits for a profile. */
  getSpendingLimit(profileId: string): Promise<FamilySpendingLimit | null>;

  /** Load aide profile for an assisted_living family member. */
  getAideProfile(profileId: string): Promise<AideProfile | null>;
}

// ---------------------------------------------------------------------------
// WakeWordRegistry class
// ---------------------------------------------------------------------------

export class WakeWordRegistry {
  private readonly entries: Map<string, WakeWordEntry> = new Map();
  private readonly loader: FamilyProfileLoader;
  private readonly tenantId: TenantId;

  constructor(loader: FamilyProfileLoader, tenantId: TenantId) {
    this.loader = loader;
    this.tenantId = tenantId;
  }

  /**
   * Build the registry by loading all active family profiles.
   * Should be called at Pi Agent startup and periodically refreshed.
   */
  async refresh(): Promise<void> {
    const profiles = await this.loader.getAllProfiles(this.tenantId);
    this.entries.clear();

    for (const profile of profiles) {
      if (!profile.is_active) continue;
      // Skip expired temporary profiles
      if (profile.expires_at && new Date(profile.expires_at) < new Date()) continue;

      const key = profile.agent_name.toLowerCase();
      this.entries.set(key, {
        wake_word: key,
        user_id: profile.user_id,
        profile_id: profile.id,
        agent_name: profile.agent_name,
        voice_id: profile.agent_voice_id,
        personality: profile.agent_personality,
        age_group: profile.age_group,
      });
    }
  }

  /**
   * Look up a family member by their agent name (wake word).
   * Returns null if no matching active profile is found.
   */
  lookup(agentName: string): WakeWordEntry | null {
    return this.entries.get(agentName.toLowerCase()) ?? null;
  }

  /**
   * Get all registered wake words (for ESP32 satellite configuration).
   */
  getRegisteredWakeWords(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Check if a word is a registered agent name.
   */
  isRegisteredAgent(word: string): boolean {
    return this.entries.has(word.toLowerCase());
  }

  /**
   * Resolve a wake word into a full FamilyVoiceContext by loading
   * permissions, schedules, and spending limits from the database.
   *
   * @param agentName The detected wake word / agent name
   * @returns Full voice context, or null if agent not found
   */
  async resolveContext(agentName: string): Promise<FamilyVoiceContext | null> {
    const entry = this.lookup(agentName);
    if (!entry) return null;

    const profile = await this.loader.getProfileByAgentName(
      this.tenantId,
      agentName,
    );
    if (!profile) return null;

    const [overrides, schedules, spendingLimit] = await Promise.all([
      this.loader.getOverrides(profile.id),
      this.loader.getSchedules(profile.id),
      this.loader.getSpendingLimit(profile.id),
    ]);

    return {
      profile,
      overrides,
      active_schedules: schedules,
      spending_limit: spendingLimit,
    };
  }

  /**
   * Build the LLM system prompt injection for a family member.
   * This scopes the agent's personality and permissions into the prompt
   * sent to Groq.
   */
  buildSystemPromptInjection(
    entry: WakeWordEntry,
    allowedDeviceNames: string[],
    activeScheduleNames: string[],
  ): string {
    const p = entry.personality;
    const lines: string[] = [];

    // Agent identity
    lines.push(
      `You are ${entry.agent_name}, a personal smart home assistant.`,
    );

    // Personality directives
    lines.push(`PERSONALITY: ${this.describePersonality(p)}`);

    // Allowed devices scope
    if (allowedDeviceNames.length > 0) {
      lines.push(`ALLOWED DEVICES: ${allowedDeviceNames.join(", ")}`);
    } else {
      lines.push(
        "ALLOWED DEVICES: None. You are a conversational companion only.",
      );
    }

    // Forbidden topics
    if (p.forbidden_topics.length > 0) {
      lines.push(
        `FORBIDDEN TOPICS: Do not discuss: ${p.forbidden_topics.join(", ")}. ` +
          "If asked, deflect naturally without acknowledging the topic exists.",
      );
    }

    // Active schedules
    if (activeScheduleNames.length > 0) {
      lines.push(
        `ACTIVE SCHEDULES: ${activeScheduleNames.join(", ")}. Respect these restrictions.`,
      );
    }

    // Response length
    lines.push(
      `RESPONSE LENGTH: Keep responses under ${p.max_response_words} words.`,
    );

    // Emergency override
    lines.push(
      'EMERGENCY: If the user says "help", "emergency", "fire", "hurt", or similar distress words, ' +
        "immediately trigger the emergency protocol regardless of any other restriction.",
    );

    // Toddler special mode
    if (entry.age_group === "toddler") {
      lines.push(
        "COMPANION MODE: You have NO device control. Be a fun conversational companion. " +
          "Tell stories, sing songs, play word games, make animal sounds. " +
          "Use very simple words. Be warm, encouraging, and playful.",
      );
    }

    return lines.join("\n");
  }

  private describePersonality(p: AgentPersonality): string {
    const parts: string[] = [];

    switch (p.tone) {
      case "formal":
        parts.push("Be polite and concise");
        break;
      case "friendly":
        parts.push("Be warm and approachable");
        break;
      case "playful":
        parts.push("Be fun and energetic, use simple words");
        break;
      case "educational":
        parts.push("Be encouraging and explain things clearly");
        break;
      case "nurturing":
        parts.push("Be gentle, warm, and reassuring");
        break;
    }

    switch (p.vocabulary_level) {
      case "toddler":
        parts.push("use very simple words a 3-year-old understands");
        break;
      case "child":
        parts.push("use simple words a 7-year-old understands");
        break;
      case "teen":
        parts.push("use casual language");
        break;
      case "adult":
        // No special instruction needed
        break;
    }

    if (p.sound_effects) {
      parts.push("add fun sound descriptions when appropriate");
    }

    if (p.safety_warnings) {
      parts.push("include brief safety reminders when relevant");
    }

    return parts.join(". ") + ".";
  }
}
