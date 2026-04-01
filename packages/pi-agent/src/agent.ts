/**
 * Main Raspberry Pi agent.
 *
 * Orchestrates the full device lifecycle:
 *   - Registers this Pi device with Supabase on startup (scoped JWT)
 *   - Connects to Home Assistant via REST + WebSocket
 *   - Runs device discovery
 *   - Listens for real-time state changes
 *   - Sends heartbeat to Supabase presence channel
 *   - Handles OTA (over-the-air) updates via Supabase Realtime
 *   - Graceful shutdown on SIGINT / SIGTERM
 */

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import type {
  TenantId,
  Device,
  DeviceId,
  DeviceStateChange,
  ParsedIntent,
  UserId,
  VoiceSession,
  JwtClaims,
} from "@clever/shared";
import {
  HARestClient,
  HAWebSocketClient,
  DeviceDiscovery,
  CommandExecutor,
  SceneExecutor,
} from "@clever/ha-bridge";
import type {
  DeviceStore,
  DeviceResolver,
  DeviceStateChangedEvent,
} from "@clever/ha-bridge";
import {
  CleverOrchestrator,
  LLMClient,
  AgentManager,
  ConversationManager,
} from "@clever/orchestrator";
import type {
  OrchestratorRequest,
  DeviceStateProvider,
  DeviceStateInfo,
  FamilyProfileLoader,
} from "@clever/orchestrator";
import { isReSpeakerPresent, LEDRing } from "./hardware/respeaker-config.js";
import { isI2SBonnetPresent, VolumeControl } from "./hardware/audio-output.js";
import {
  isHailoAvailable,
  getHailoSummary,
  getLlamaCppConfig,
} from "./hardware/hailo-config.js";

// ---------------------------------------------------------------------------
// Configuration (all from environment variables -- never hardcoded)
// ---------------------------------------------------------------------------

export interface PiAgentConfig {
  /** Supabase project URL. */
  supabaseUrl: string;
  /** Supabase anon key (used for auth). */
  supabaseAnonKey: string;
  /** Scoped JWT for this device. */
  deviceJwt: string;
  /** Home Assistant base URL. */
  haUrl: string;
  /** Home Assistant long-lived access token. */
  haToken: string;
  /** Tenant ID this device belongs to. */
  tenantId: TenantId;
  /** Unique identifier for this physical device. */
  deviceId: string;
  /** Heartbeat interval in ms (default: 30 000). */
  heartbeatIntervalMs?: number;
  /** Device discovery poll interval in ms (default: 60 000). */
  discoveryIntervalMs?: number;
}

function loadConfigFromEnv(): PiAgentConfig {
  const required = (key: string): string => {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  };

  return {
    supabaseUrl: required("SUPABASE_URL"),
    supabaseAnonKey: required("SUPABASE_ANON_KEY"),
    deviceJwt: required("DEVICE_JWT"),
    haUrl: required("HA_URL"),
    haToken: required("HA_TOKEN"),
    tenantId: required("TENANT_ID") as TenantId,
    deviceId: required("DEVICE_ID") ?? `pi-${process.env["HOSTNAME"] ?? "unknown"}`,
    heartbeatIntervalMs: parseInt(
      process.env["HEARTBEAT_INTERVAL_MS"] ?? "30000",
      10,
    ),
    discoveryIntervalMs: parseInt(
      process.env["DISCOVERY_INTERVAL_MS"] ?? "60000",
      10,
    ),
  };
}

// ---------------------------------------------------------------------------
// Supabase-backed DeviceStore implementation
// ---------------------------------------------------------------------------

class SupabaseDeviceStore implements DeviceStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async listDevices(tenantId: TenantId): Promise<Device[]> {
    const { data, error } = await this.supabase
      .from("devices")
      .select("*")
      .eq("tenant_id", tenantId);

    if (error) {
      throw new Error(`Failed to list devices: ${error.message}`);
    }
    return (data ?? []) as Device[];
  }

  async upsertDevice(device: Device): Promise<void> {
    const { error } = await this.supabase.from("devices").upsert(
      {
        id: device.id,
        tenant_id: device.tenant_id,
        ha_entity_id: device.ha_entity_id,
        name: device.name,
        category: device.category,
        room: device.room,
        floor: device.floor,
        state: device.state,
        attributes: device.attributes,
        is_online: device.is_online,
        last_seen: device.last_seen,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ha_entity_id,tenant_id" },
    );

    if (error) {
      throw new Error(`Failed to upsert device: ${error.message}`);
    }
  }

  async removeDevice(deviceId: DeviceId, tenantId: TenantId): Promise<void> {
    const { error } = await this.supabase
      .from("devices")
      .delete()
      .eq("id", deviceId)
      .eq("tenant_id", tenantId);

    if (error) {
      throw new Error(`Failed to remove device: ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Supabase-backed DeviceResolver implementation
// ---------------------------------------------------------------------------

class SupabaseDeviceResolver implements DeviceResolver {
  constructor(private readonly supabase: SupabaseClient) {}

  async resolveDevice(
    name: string,
    room?: string,
    tenantId?: TenantId,
  ): Promise<Device | null> {
    let query = this.supabase
      .from("devices")
      .select("*")
      .ilike("name", `%${name}%`);

    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }
    if (room) {
      query = query.ilike("room", `%${room}%`);
    }

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) {
      console.error(`[DeviceResolver] resolveDevice error: ${error.message}`);
      return null;
    }
    return (data as Device) ?? null;
  }

  async resolveRoom(
    room: string,
    tenantId?: TenantId,
  ): Promise<Device[]> {
    let query = this.supabase
      .from("devices")
      .select("*")
      .ilike("room", `%${room}%`);

    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }

    const { data, error } = await query;
    if (error) {
      console.error(`[DeviceResolver] resolveRoom error: ${error.message}`);
      return [];
    }
    return (data ?? []) as Device[];
  }

  async resolveCategory(
    category: string,
    tenantId?: TenantId,
  ): Promise<Device[]> {
    let query = this.supabase
      .from("devices")
      .select("*")
      .eq("category", category);

    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }

    const { data, error } = await query;
    if (error) {
      console.error(
        `[DeviceResolver] resolveCategory error: ${error.message}`,
      );
      return [];
    }
    return (data ?? []) as Device[];
  }
}

// ---------------------------------------------------------------------------
// Pi Agent
// ---------------------------------------------------------------------------

export class PiAgent {
  private readonly config: PiAgentConfig;
  private readonly supabase: SupabaseClient;
  private readonly haRest: HARestClient;
  private readonly haWs: HAWebSocketClient;
  private readonly deviceStore: SupabaseDeviceStore;
  private readonly deviceResolver: SupabaseDeviceResolver;
  private readonly discovery: DeviceDiscovery;
  private readonly commandExecutor: CommandExecutor;
  private readonly sceneExecutor: SceneExecutor;
  private readonly orchestrator: CleverOrchestrator;
  private readonly ledRing: LEDRing;
  private readonly volumeControl: VolumeControl;

  private presenceChannel: RealtimeChannel | null = null;
  private otaChannel: RealtimeChannel | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(config?: PiAgentConfig) {
    this.config = config ?? loadConfigFromEnv();

    // Initialize Supabase client with the device-scoped JWT
    this.supabase = createClient(
      this.config.supabaseUrl,
      this.config.supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${this.config.deviceJwt}`,
          },
        },
        realtime: {
          params: {
            eventsPerSecond: 10,
          },
        },
      },
    );

    // Initialize HA clients
    this.haRest = new HARestClient({
      baseUrl: this.config.haUrl,
      token: this.config.haToken,
      tenantId: this.config.tenantId,
    });

    this.haWs = new HAWebSocketClient({
      url: this.config.haUrl.replace(/^http/, "ws") + "/api/websocket",
      token: this.config.haToken,
      tenantId: this.config.tenantId,
    });

    // Initialize stores and resolvers
    this.deviceStore = new SupabaseDeviceStore(this.supabase);
    this.deviceResolver = new SupabaseDeviceResolver(this.supabase);

    // Initialize discovery
    this.discovery = new DeviceDiscovery({
      haClient: this.haRest,
      store: this.deviceStore,
      tenantId: this.config.tenantId,
      pollIntervalMs: this.config.discoveryIntervalMs,
    });

    // Initialize command executor
    this.commandExecutor = new CommandExecutor({
      haClient: this.haRest,
      resolver: this.deviceResolver,
      tenantId: this.config.tenantId,
    });

    // Initialize scene executor
    this.sceneExecutor = new SceneExecutor({
      haClient: this.haRest,
      resolver: this.deviceResolver,
      tenantId: this.config.tenantId,
    });

    // Initialize orchestrator (Clever AI brain)
    const groqApiKey = process.env["GROQ_API_KEY"] ?? "";
    const claudeApiKey = process.env["ANTHROPIC_API_KEY"];

    const llmClient = new LLMClient({
      groq_api_key: groqApiKey,
      claude_api_key: claudeApiKey,
    });

    const familyProfileLoader: FamilyProfileLoader = {
      getProfileByAgentName: async (tenantId, agentName) => {
        const { data } = await this.supabase
          .from("family_member_profiles")
          .select("*")
          .eq("tenant_id", tenantId)
          .ilike("agent_name", agentName)
          .eq("is_active", true)
          .maybeSingle();
        return data;
      },
      getAllProfiles: async (tenantId) => {
        const { data } = await this.supabase
          .from("family_member_profiles")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("is_active", true);
        return data ?? [];
      },
      getOverrides: async (profileId) => {
        const { data } = await this.supabase
          .from("family_permission_overrides")
          .select("*")
          .eq("profile_id", profileId);
        return data ?? [];
      },
      getSchedules: async (profileId) => {
        const { data } = await this.supabase
          .from("family_schedules")
          .select("*")
          .eq("profile_id", profileId)
          .eq("is_active", true);
        return data ?? [];
      },
      getSpendingLimit: async (profileId) => {
        const { data } = await this.supabase
          .from("family_spending_limits")
          .select("*")
          .eq("profile_id", profileId)
          .maybeSingle();
        return data;
      },
    };

    const agentManager = new AgentManager(
      familyProfileLoader,
      llmClient,
      this.config.tenantId,
    );

    const conversationManager = new ConversationManager(
      this.supabase as unknown as import("@clever/orchestrator").SupabaseClient,
    );

    const deviceStateProvider: DeviceStateProvider = {
      getAllDeviceStates: async (tenantId) => {
        const { data } = await this.supabase
          .from("devices")
          .select("ha_entity_id, name, state, category, room, is_online, attributes, last_seen")
          .eq("tenant_id", tenantId);
        return (data ?? []).map((d: Record<string, unknown>) => ({
          entity_id: d.ha_entity_id as string,
          name: d.name as string,
          state: (d.state as string) ?? "unknown",
          category: (d.category as string) ?? "unknown",
          room: (d.room as string) ?? "unknown",
          is_online: (d.is_online as boolean) ?? false,
          attributes: (d.attributes as Record<string, unknown>) ?? {},
          last_changed: (d.last_seen as string) ?? "",
        }));
      },
      getDeviceState: async (entityId) => {
        const { data } = await this.supabase
          .from("devices")
          .select("ha_entity_id, name, state, category, room, is_online, attributes, last_seen")
          .eq("ha_entity_id", entityId)
          .maybeSingle();
        if (!data) return null;
        const d = data as Record<string, unknown>;
        return {
          entity_id: d.ha_entity_id as string,
          name: d.name as string,
          state: (d.state as string) ?? "unknown",
          category: (d.category as string) ?? "unknown",
          room: (d.room as string) ?? "unknown",
          is_online: (d.is_online as boolean) ?? false,
          attributes: (d.attributes as Record<string, unknown>) ?? {},
          last_changed: (d.last_seen as string) ?? "",
        };
      },
    };

    this.orchestrator = new CleverOrchestrator({
      llm: llmClient,
      agentManager,
      conversationManager,
      commandExecutor: this.commandExecutor as any,
      deviceStateProvider,
      tenantId: this.config.tenantId,
    });

    // Initialize hardware controllers
    this.ledRing = new LEDRing();
    this.volumeControl = new VolumeControl();
  }

  // -----------------------------------------------------------------------
  // Public accessors (used by voice pipeline and other consumers)
  // -----------------------------------------------------------------------

  getCommandExecutor(): CommandExecutor {
    return this.commandExecutor;
  }

  getSceneExecutor(): SceneExecutor {
    return this.sceneExecutor;
  }

  getHARestClient(): HARestClient {
    return this.haRest;
  }

  getLEDRing(): LEDRing {
    return this.ledRing;
  }

  getVolumeControl(): VolumeControl {
    return this.volumeControl;
  }

  getOrchestrator(): CleverOrchestrator {
    return this.orchestrator;
  }

  // -----------------------------------------------------------------------
  // Voice result handler — routes parsed intents to the correct executor
  // -----------------------------------------------------------------------

  /**
   * Handle a completed voice pipeline result.
   *
   * For Tier 1 (rules-matched) intents with known domains (scene, shopping,
   * pantry, kitchen, simple device commands), executes directly for speed.
   *
   * For everything else, delegates to the Clever orchestrator which handles
   * triage, family agent delegation, multi-turn context, and complex tasks.
   *
   * @param intent     The parsed intent from the voice pipeline.
   * @param userId     The user who issued the voice command.
   * @param agentName  Optional agent name (from wake word detection).
   * @param tier1Match Whether this was matched by Tier 1 rules engine.
   * @returns Execution result with state changes and any errors.
   */
  async handleVoiceResult(
    intent: ParsedIntent,
    userId: UserId,
    agentName?: string,
    tier1Match?: boolean,
  ): Promise<{
    success: boolean;
    stateChanges: DeviceStateChange[];
    errors: string[];
    durationMs: number;
    responseText?: string;
  }> {
    const start = Date.now();

    // -----------------------------------------------------------------------
    // Tier 1 fast path: known domains with pre-parsed intents
    // These bypass the orchestrator for sub-200ms latency.
    // -----------------------------------------------------------------------
    if (tier1Match) {
      // Scene activation: route to SceneExecutor
      if (intent.domain === "scene" && intent.parameters["scene"]) {
        const sceneName = intent.parameters["scene"] as string;
        const result = await this.sceneExecutor.executeBuiltin(
          sceneName,
          userId,
          "voice",
        );

        await this.logAudit("scene_activated", userId, null, {
          scene: sceneName,
          success: result.success,
          duration_ms: result.durationMs,
        });

        return {
          success: result.success,
          stateChanges: result.stateChanges,
          errors: result.errors,
          durationMs: result.durationMs,
        };
      }

      // Shopping list commands
      if (intent.domain === "shopping_list") {
        return this.handleShoppingListIntent(intent, userId, start);
      }

      // Pantry commands
      if (intent.domain === "pantry") {
        return this.handlePantryIntent(intent, userId, start);
      }

      // Kitchen commands
      if (intent.domain === "kitchen") {
        return this.handleKitchenIntent(intent, userId, start);
      }

      // Simple device command via Tier 1 — execute directly
      const result = await this.commandExecutor.execute(intent, userId, "voice");

      await this.logAudit(
        "device_command_issued",
        userId,
        result.stateChanges[0]?.device_id ?? null,
        {
          domain: intent.domain,
          action: intent.action,
          success: result.success,
          duration_ms: result.durationMs,
          tier: "tier1_rules",
        },
      );

      return result;
    }

    // -----------------------------------------------------------------------
    // Orchestrator path: Tier 2/3 or ambiguous commands
    // Clever triages, delegates to family agents, handles complex tasks.
    // -----------------------------------------------------------------------
    const orchestratorRequest: OrchestratorRequest = {
      message: intent.raw_transcript,
      user_id: userId,
      tenant_id: this.config.tenantId,
      agent_name: agentName ?? "clever",
      source: "voice",
      pre_parsed_intent: intent,
    };

    const orchestratorResponse = await this.orchestrator.handleRequest(
      orchestratorRequest,
    );

    await this.logAudit(
      "orchestrator_request",
      userId,
      orchestratorResponse.state_changes[0]?.device_id ?? null,
      {
        triage_category: orchestratorResponse.triage_category,
        agent_name: agentName ?? "clever",
        device_actions: orchestratorResponse.device_actions,
        latency_ms: orchestratorResponse.latency_ms,
        permission_denied: orchestratorResponse.permission_denied,
      },
    );

    return {
      success: !orchestratorResponse.permission_denied,
      stateChanges: orchestratorResponse.state_changes,
      errors: orchestratorResponse.permission_denied
        ? [orchestratorResponse.denial_message ?? "Permission denied"]
        : [],
      durationMs: Date.now() - start,
      responseText: orchestratorResponse.message,
    };
  }

  // -----------------------------------------------------------------------
  // Shopping List intent handler
  // -----------------------------------------------------------------------

  private async handleShoppingListIntent(
    intent: ParsedIntent,
    userId: UserId,
    start: number,
  ): Promise<{
    success: boolean;
    stateChanges: DeviceStateChange[];
    errors: string[];
    durationMs: number;
    responseText?: string;
  }> {
    const emptyResult = (
      success: boolean,
      responseText: string,
      errors: string[] = [],
    ) => ({
      success,
      stateChanges: [] as DeviceStateChange[],
      errors,
      durationMs: Date.now() - start,
      responseText,
    });

    try {
      switch (intent.action) {
        case "add_item": {
          const item = intent.parameters["item"] as string;
          const quantity = (intent.parameters["quantity"] as number) ?? 1;

          const { error } = await this.supabase
            .from("shopping_list_items")
            .insert({
              tenant_id: this.config.tenantId,
              name: item,
              quantity,
              added_by: userId as unknown as string,
              added_via: "voice",
              priority: "normal",
              checked: false,
            });

          if (error) throw new Error(error.message);

          await this.logAudit("shopping_list_item_added", userId, null, {
            item,
            quantity,
            via: "voice",
          });

          const qtyText = quantity > 1 ? `${quantity} ` : "";
          return emptyResult(
            true,
            `Added ${qtyText}${item} to your shopping list.`,
          );
        }

        case "remove_item": {
          const item = intent.parameters["item"] as string;

          const { error } = await this.supabase
            .from("shopping_list_items")
            .delete()
            .eq("tenant_id", this.config.tenantId)
            .ilike("name", `%${item}%`)
            .eq("checked", false);

          if (error) throw new Error(error.message);

          await this.logAudit("shopping_list_item_removed", userId, null, {
            item,
            via: "voice",
          });

          return emptyResult(true, `Removed ${item} from your shopping list.`);
        }

        case "read_list": {
          const { data, error } = await this.supabase
            .from("shopping_list_items")
            .select("name, quantity, unit")
            .eq("tenant_id", this.config.tenantId)
            .eq("checked", false)
            .order("created_at", { ascending: true });

          if (error) throw new Error(error.message);

          if (!data || data.length === 0) {
            return emptyResult(true, "Your shopping list is empty.");
          }

          const items = data.map((i) => {
            const qty = i.quantity > 1 ? `${i.quantity} ` : "";
            const unit = i.unit ? `${i.unit} of ` : "";
            return `${qty}${unit}${i.name}`;
          });

          const listText =
            items.length === 1
              ? items[0]
              : items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];

          return emptyResult(
            true,
            `You have ${data.length} item${data.length !== 1 ? "s" : ""} on your shopping list: ${listText}.`,
          );
        }

        case "clear_list": {
          const { error } = await this.supabase
            .from("shopping_list_items")
            .delete()
            .eq("tenant_id", this.config.tenantId)
            .eq("checked", false);

          if (error) throw new Error(error.message);

          await this.logAudit("shopping_list_item_removed", userId, null, {
            action: "clear_all",
            via: "voice",
          });

          return emptyResult(true, "Your shopping list has been cleared.");
        }

        case "check_item": {
          const item = intent.parameters["item"] as string;

          const { data, error } = await this.supabase
            .from("shopping_list_items")
            .select("name, quantity")
            .eq("tenant_id", this.config.tenantId)
            .ilike("name", `%${item}%`)
            .eq("checked", false);

          if (error) throw new Error(error.message);

          if (!data || data.length === 0) {
            return emptyResult(
              true,
              `No, ${item} is not on your shopping list.`,
            );
          }

          return emptyResult(
            true,
            `Yes, ${data[0]!.name} is on your shopping list.`,
          );
        }

        default:
          return emptyResult(false, "I didn't understand that shopping list command.", [
            `Unknown shopping list action: ${intent.action}`,
          ]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[PiAgent] Shopping list error: ${message}`);
      return emptyResult(false, "Sorry, there was a problem with your shopping list.", [message]);
    }
  }

  // -----------------------------------------------------------------------
  // Pantry intent handler
  // -----------------------------------------------------------------------

  private async handlePantryIntent(
    intent: ParsedIntent,
    userId: UserId,
    start: number,
  ): Promise<{
    success: boolean;
    stateChanges: DeviceStateChange[];
    errors: string[];
    durationMs: number;
    responseText?: string;
  }> {
    const emptyResult = (
      success: boolean,
      responseText: string,
      errors: string[] = [],
    ) => ({
      success,
      stateChanges: [] as DeviceStateChange[],
      errors,
      durationMs: Date.now() - start,
      responseText,
    });

    try {
      switch (intent.action) {
        case "check_stock": {
          const item = intent.parameters["item"] as string;

          const { data, error } = await this.supabase
            .from("pantry_items")
            .select("name, quantity, unit, location")
            .eq("tenant_id", this.config.tenantId)
            .ilike("name", `%${item}%`);

          if (error) throw new Error(error.message);

          if (!data || data.length === 0) {
            return emptyResult(
              true,
              `I don't see any ${item} in your pantry.`,
            );
          }

          const entries = data.map(
            (i) => `${i.quantity} ${i.unit} in the ${i.location}`,
          );
          return emptyResult(
            true,
            `You have ${data[0]!.name}: ${entries.join(", ")}.`,
          );
        }

        case "check_low_stock": {
          const { data, error } = await this.supabase
            .from("pantry_items")
            .select("name, quantity, unit, min_stock_threshold")
            .eq("tenant_id", this.config.tenantId)
            .not("min_stock_threshold", "is", null);

          if (error) throw new Error(error.message);

          const lowItems = (data ?? []).filter(
            (i) =>
              i.min_stock_threshold !== null &&
              i.quantity <= i.min_stock_threshold,
          );

          if (lowItems.length === 0) {
            return emptyResult(true, "Nothing is running low right now.");
          }

          const names = lowItems.map((i) => i.name);
          const listText =
            names.length === 1
              ? names[0]
              : names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];

          return emptyResult(
            true,
            `These items are running low: ${listText}.`,
          );
        }

        case "check_expiring": {
          const threeDaysFromNow = new Date();
          threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
          const cutoff = threeDaysFromNow.toISOString().split("T")[0]!;

          const { data, error } = await this.supabase
            .from("pantry_items")
            .select("name, expiry_date")
            .eq("tenant_id", this.config.tenantId)
            .not("expiry_date", "is", null)
            .lte("expiry_date", cutoff)
            .order("expiry_date", { ascending: true });

          if (error) throw new Error(error.message);

          if (!data || data.length === 0) {
            return emptyResult(
              true,
              "Nothing is expiring in the next few days.",
            );
          }

          const items = data.map((i) => `${i.name} (${i.expiry_date})`);
          const listText =
            items.length === 1
              ? items[0]
              : items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];

          return emptyResult(
            true,
            `These items are expiring soon: ${listText}.`,
          );
        }

        default:
          return emptyResult(false, "I didn't understand that pantry command.", [
            `Unknown pantry action: ${intent.action}`,
          ]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[PiAgent] Pantry error: ${message}`);
      return emptyResult(false, "Sorry, there was a problem checking your pantry.", [message]);
    }
  }

  // -----------------------------------------------------------------------
  // Kitchen intent handler (timers, recipes, scanning)
  // Scanning and recipe actions are forwarded to the kitchen hub via
  // Supabase Realtime broadcast. Timers are managed by the kitchen hub.
  // -----------------------------------------------------------------------

  private async handleKitchenIntent(
    intent: ParsedIntent,
    userId: UserId,
    start: number,
  ): Promise<{
    success: boolean;
    stateChanges: DeviceStateChange[];
    errors: string[];
    durationMs: number;
    responseText?: string;
  }> {
    const emptyResult = (
      success: boolean,
      responseText: string,
      errors: string[] = [],
    ) => ({
      success,
      stateChanges: [] as DeviceStateChange[],
      errors,
      durationMs: Date.now() - start,
      responseText,
    });

    // Forward kitchen commands to the kitchen hub via Realtime broadcast
    const kitchenChannel = this.supabase.channel(
      `kitchen:${this.config.tenantId as string}`,
    );

    try {
      await kitchenChannel.subscribe();
      await kitchenChannel.send({
        type: "broadcast",
        event: "kitchen_command",
        payload: {
          action: intent.action,
          parameters: intent.parameters,
          user_id: userId,
          timestamp: new Date().toISOString(),
        },
      });
      this.supabase.removeChannel(kitchenChannel);

      switch (intent.action) {
        case "set_timer": {
          const duration = intent.parameters["duration"] as number;
          const unit = (intent.parameters["unit"] as string) ?? "minute";
          const label = intent.parameters["label"] as string | undefined;
          const labelText = label ? ` ${label}` : "";
          return emptyResult(
            true,
            `Setting a${labelText} timer for ${duration} ${unit}${duration !== 1 ? "s" : ""}.`,
          );
        }
        case "cancel_timer":
          return emptyResult(true, "Timer cancelled.");
        case "check_timer":
          return emptyResult(true, "Checking your timer.");
        case "suggest_recipe":
          return emptyResult(
            true,
            "Let me check what you have and suggest some recipes.",
          );
        case "scan_receipt":
          return emptyResult(true, "Ready to scan your receipt. Hold it up to the camera.");
        case "scan_barcode":
          return emptyResult(true, "Ready to scan. Hold the barcode up to the camera.");
        case "scan_barcode_remove":
          return emptyResult(true, "Scan the item you want to remove from the pantry.");
        case "scan_pantry_photo": {
          const location = (intent.parameters["location"] as string) ?? "pantry";
          return emptyResult(
            true,
            `Taking a photo of your ${location}. Hold still.`,
          );
        }
        default:
          return emptyResult(false, "I didn't understand that kitchen command.", [
            `Unknown kitchen action: ${intent.action}`,
          ]);
      }
    } catch (err) {
      this.supabase.removeChannel(kitchenChannel);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[PiAgent] Kitchen command error: ${message}`);
      return emptyResult(false, "Sorry, there was a problem with that kitchen command.", [message]);
    }
  }

  /** Write an audit log entry to Supabase. */
  private async logAudit(
    action: string,
    userId: UserId | null,
    deviceId: DeviceId | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.supabase.from("audit_logs").insert({
      tenant_id: this.config.tenantId,
      user_id: userId as unknown as string,
      device_id: deviceId as unknown as string,
      action,
      details,
      timestamp: new Date().toISOString(),
    });

    if (error) {
      console.error(`[PiAgent] Audit log write failed: ${error.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Startup
  // -----------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn("[PiAgent] Already running.");
      return;
    }
    this.isRunning = true;

    console.log("[PiAgent] Starting Clever Automations Pi Agent...");
    console.log(`[PiAgent] Device ID: ${this.config.deviceId}`);
    console.log(`[PiAgent] Tenant:    ${this.config.tenantId as string}`);

    // 1. Hardware detection
    await this.detectHardware();

    // 2. Verify HA connectivity
    await this.verifyHAConnection();

    // 3. Register device with Supabase
    await this.registerDevice();

    // 4. Connect HA WebSocket for real-time events
    this.setupWebSocketListeners();
    this.haWs.connect();

    // 5. Start device discovery
    this.discovery.startPolling();

    // 6. Start Supabase presence heartbeat
    this.startPresenceHeartbeat();

    // 7. Subscribe to OTA update channel
    this.subscribeToOTAUpdates();

    // 8. Register signal handlers for graceful shutdown
    this.registerShutdownHandlers();

    // 9. LED feedback: agent is ready
    this.ledRing.showIdle();

    console.log("[PiAgent] Agent started successfully.");
  }

  // -----------------------------------------------------------------------
  // Hardware detection
  // -----------------------------------------------------------------------

  private async detectHardware(): Promise<void> {
    console.log("[PiAgent] Detecting hardware...");

    // ReSpeaker microphone array
    if (isReSpeakerPresent()) {
      console.log("[PiAgent]   ReSpeaker 4-Mic Array: detected");
    } else {
      console.warn("[PiAgent]   ReSpeaker 4-Mic Array: NOT detected");
    }

    // I2S audio bonnet
    if (isI2SBonnetPresent()) {
      console.log("[PiAgent]   I2S 3W Audio Bonnet: detected");
      this.volumeControl.setVolume(60);
    } else {
      console.warn("[PiAgent]   I2S 3W Audio Bonnet: NOT detected");
    }

    // Hailo AI HAT+
    if (isHailoAvailable()) {
      console.log("[PiAgent]   Hailo AI HAT+: detected");
      console.log(getHailoSummary());
      const llamaConfig = getLlamaCppConfig();
      console.log(
        `[PiAgent]   llama.cpp config: ${llamaConfig.nThreads} threads, ` +
          `ctx=${llamaConfig.contextSize}, ` +
          `hailo_offload=${llamaConfig.hailoOffloadingAvailable}`,
      );
    } else {
      console.warn("[PiAgent]   Hailo AI HAT+: NOT detected (CPU-only mode)");
    }
  }

  // -----------------------------------------------------------------------
  // HA connection verification
  // -----------------------------------------------------------------------

  private async verifyHAConnection(): Promise<void> {
    console.log(`[PiAgent] Connecting to Home Assistant at ${this.config.haUrl}...`);

    const healthy = await this.haRest.isHealthy();
    if (!healthy) {
      throw new Error(
        `Home Assistant at ${this.config.haUrl} is not reachable or not running. ` +
          `Ensure HA is started and the token is valid.`,
      );
    }

    const haConfig = await this.haRest.getConfig();
    console.log(
      `[PiAgent] Home Assistant connected: v${haConfig.version}, ` +
        `location="${haConfig.location_name}"`,
    );
  }

  // -----------------------------------------------------------------------
  // Device registration with Supabase
  // -----------------------------------------------------------------------

  private async registerDevice(): Promise<void> {
    console.log("[PiAgent] Registering device with Supabase...");

    const { error } = await this.supabase.from("pi_devices").upsert(
      {
        device_id: this.config.deviceId,
        tenant_id: this.config.tenantId,
        hostname: process.env["HOSTNAME"] ?? "unknown",
        ha_url: this.config.haUrl,
        status: "online",
        version: process.env["npm_package_version"] ?? "0.1.0",
        hardware: {
          respeaker: isReSpeakerPresent(),
          i2s_bonnet: isI2SBonnetPresent(),
          hailo: isHailoAvailable(),
        },
        last_seen: new Date().toISOString(),
        registered_at: new Date().toISOString(),
      },
      { onConflict: "device_id,tenant_id" },
    );

    if (error) {
      console.error(`[PiAgent] Device registration failed: ${error.message}`);
      // Non-fatal: continue running even if Supabase is temporarily unavailable
    } else {
      console.log("[PiAgent] Device registered successfully.");
    }
  }

  // -----------------------------------------------------------------------
  // WebSocket real-time event handling
  // -----------------------------------------------------------------------

  private setupWebSocketListeners(): void {
    this.haWs.on("authenticated", (version) => {
      console.log(`[PiAgent] HA WebSocket authenticated (HA v${version})`);
    });

    this.haWs.on("state_changed", (event: DeviceStateChangedEvent) => {
      this.handleStateChange(event).catch((err) => {
        console.error(
          "[PiAgent] Error handling state change:",
          err instanceof Error ? err.message : err,
        );
      });
    });

    this.haWs.on("disconnected", (reason) => {
      console.warn(`[PiAgent] HA WebSocket disconnected: ${reason}`);
    });

    this.haWs.on("reconnecting", (attempt, delay) => {
      console.log(
        `[PiAgent] HA WebSocket reconnecting (attempt ${attempt}, delay ${delay}ms)...`,
      );
    });

    this.haWs.on("error", (err) => {
      console.error(`[PiAgent] HA WebSocket error: ${err.message}`);
    });

    this.haWs.on("auth_failed", (msg) => {
      console.error(`[PiAgent] HA WebSocket auth failed: ${msg}`);
    });
  }

  private async handleStateChange(
    event: DeviceStateChangedEvent,
  ): Promise<void> {
    // Log state change to Supabase audit log
    const stateChange: Omit<DeviceStateChange, "id"> = {
      device_id: event.deviceId,
      tenant_id: event.tenantId,
      previous_state: event.oldState,
      new_state: event.newState,
      changed_by: "system",
      source: "automation",
      timestamp: event.timestamp,
    };

    const { error } = await this.supabase
      .from("device_state_changes")
      .insert({
        ...stateChange,
        id: crypto.randomUUID(),
      });

    if (error) {
      console.error(
        `[PiAgent] Failed to log state change: ${error.message}`,
      );
    }

    // Update device state in Supabase
    await this.supabase
      .from("devices")
      .update({
        state: event.newState,
        attributes: event.attributes,
        last_seen: event.timestamp,
        updated_at: new Date().toISOString(),
      })
      .eq("ha_entity_id", event.entityId)
      .eq("tenant_id", event.tenantId);
  }

  // -----------------------------------------------------------------------
  // Supabase presence heartbeat
  // -----------------------------------------------------------------------

  private startPresenceHeartbeat(): void {
    const channelName = `presence:${this.config.tenantId as string}`;

    this.presenceChannel = this.supabase.channel(channelName);
    this.presenceChannel
      .on("presence", { event: "sync" }, () => {
        // Presence state synced — we can read other devices' status here
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await this.presenceChannel?.track({
            device_id: this.config.deviceId,
            status: "online",
            ha_connected: this.haWs.connected,
            timestamp: new Date().toISOString(),
          });
          console.log("[PiAgent] Presence channel subscribed.");
        }
      });

    // Periodic heartbeat
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.presenceChannel?.track({
          device_id: this.config.deviceId,
          status: "online",
          ha_connected: this.haWs.connected,
          timestamp: new Date().toISOString(),
        });

        // Also update last_seen in the pi_devices table
        await this.supabase
          .from("pi_devices")
          .update({
            status: "online",
            last_seen: new Date().toISOString(),
          })
          .eq("device_id", this.config.deviceId)
          .eq("tenant_id", this.config.tenantId);
      } catch (err) {
        console.error(
          "[PiAgent] Heartbeat failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }, this.config.heartbeatIntervalMs ?? 30_000);
  }

  // -----------------------------------------------------------------------
  // OTA update handling
  // -----------------------------------------------------------------------

  private subscribeToOTAUpdates(): void {
    const channelName = `ota:${this.config.deviceId}`;

    this.otaChannel = this.supabase.channel(channelName);
    this.otaChannel
      .on(
        "broadcast",
        { event: "update_available" },
        (payload) => {
          this.handleOTAUpdate(payload.payload as OTAUpdatePayload).catch(
            (err) => {
              console.error(
                "[PiAgent] OTA update failed:",
                err instanceof Error ? err.message : err,
              );
            },
          );
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[PiAgent] OTA update channel subscribed.");
        }
      });
  }

  private async handleOTAUpdate(payload: OTAUpdatePayload): Promise<void> {
    console.log(
      `[PiAgent] OTA update available: v${payload.version} (${payload.url})`,
    );

    // Report update acknowledged
    await this.supabase.from("ota_updates").insert({
      device_id: this.config.deviceId,
      tenant_id: this.config.tenantId,
      version: payload.version,
      status: "acknowledged",
      timestamp: new Date().toISOString(),
    });

    // In production, this would:
    // 1. Download the update package from payload.url
    // 2. Verify the checksum (payload.checksum)
    // 3. Extract to a staging directory
    // 4. Run database migrations if needed
    // 5. Gracefully restart the agent service
    //
    // For safety, we use systemd's restart to apply:
    console.log("[PiAgent] OTA update would trigger restart in production.");
    console.log(
      "[PiAgent] Run: sudo systemctl restart clever-agent to apply manually.",
    );
  }

  // -----------------------------------------------------------------------
  // Graceful shutdown
  // -----------------------------------------------------------------------

  private registerShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      if (!this.isRunning) return;
      console.log(`\n[PiAgent] Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));

    process.on("uncaughtException", (err) => {
      console.error("[PiAgent] Uncaught exception:", err);
      void shutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason) => {
      console.error("[PiAgent] Unhandled rejection:", reason);
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    console.log("[PiAgent] Stopping agent...");

    // 1. Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // 2. Unsubscribe from Supabase channels
    if (this.presenceChannel) {
      await this.presenceChannel.untrack();
      this.supabase.removeChannel(this.presenceChannel);
      this.presenceChannel = null;
    }
    if (this.otaChannel) {
      this.supabase.removeChannel(this.otaChannel);
      this.otaChannel = null;
    }

    // 3. Stop device discovery
    this.discovery.stopPolling();

    // 4. Disconnect HA WebSocket
    this.haWs.disconnect();

    // 5. Update device status in Supabase
    await this.supabase
      .from("pi_devices")
      .update({
        status: "offline",
        last_seen: new Date().toISOString(),
      })
      .eq("device_id", this.config.deviceId)
      .eq("tenant_id", this.config.tenantId)
      .then(() => {
        // Ignore errors during shutdown
      });

    // 6. LED off
    this.ledRing.off();

    console.log("[PiAgent] Agent stopped.");
  }
}

// ---------------------------------------------------------------------------
// OTA payload type
// ---------------------------------------------------------------------------

interface OTAUpdatePayload {
  version: string;
  url: string;
  checksum: string;
  releaseNotes?: string;
}
