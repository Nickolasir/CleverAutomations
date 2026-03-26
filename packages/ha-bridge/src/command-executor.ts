/**
 * Command executor.
 *
 * Receives a ParsedIntent from the voice pipeline and translates it
 * into concrete HA service calls. Returns DeviceStateChange records
 * for audit logging.
 */

import type {
  Device,
  DeviceId,
  DeviceCommand,
  DeviceStateChange,
  DeviceState,
  ParsedIntent,
  TenantId,
  UserId,
  FamilyVoiceContext,
  PermissionCheckResult,
  HACalendarEventCreate,
} from "@clever/shared";
import { HARestClient, mapHAState } from "./rest-client.js";
import type { HAEntityState } from "./rest-client.js";
import { FamilyPermissionResolver, EMAIL_SEND_ENABLED } from "@clever/shared";

// ---------------------------------------------------------------------------
// Device resolver interface
// ---------------------------------------------------------------------------

/**
 * Resolves natural-language device/room references to concrete HA entity IDs.
 * The pi-agent injects a concrete implementation that queries Supabase.
 */
export interface DeviceResolver {
  /** Find a device by name (fuzzy) within an optional room scope. */
  resolveDevice(
    name: string,
    room?: string,
    tenantId?: TenantId,
  ): Promise<Device | null>;

  /** Find all devices in a room. */
  resolveRoom(
    room: string,
    tenantId?: TenantId,
  ): Promise<Device[]>;

  /** Find all devices of a given category across the tenant. */
  resolveCategory(
    category: string,
    tenantId?: TenantId,
  ): Promise<Device[]>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CommandExecutorConfig {
  haClient: HARestClient;
  resolver: DeviceResolver;
  tenantId: TenantId;
}

// ---------------------------------------------------------------------------
// Execution result
// ---------------------------------------------------------------------------

export interface ExecutionResult {
  success: boolean;
  stateChanges: DeviceStateChange[];
  errors: string[];
  /** Time to execute all service calls in ms. */
  durationMs: number;
  /** Set to true when the command was denied by family permissions. */
  permissionDenied?: boolean;
  /** Human-readable denial reason (age-appropriate). */
  denialMessage?: string;
  /** Descriptions of constraints that were applied (e.g., "Temperature capped at 78°F"). */
  constraintMessages?: string[];
}

// ---------------------------------------------------------------------------
// Domain action maps
// ---------------------------------------------------------------------------

/**
 * Mapping from (domain, action) pairs to HA service call functions.
 * Each handler returns the affected entity states.
 */
type ActionHandler = (
  client: HARestClient,
  entityId: string,
  params: Record<string, unknown>,
) => Promise<HAEntityState[]>;

const ACTION_HANDLERS: Record<string, Record<string, ActionHandler>> = {
  light: {
    turn_on: (c, eid, p) => c.turnOn(eid, p),
    turn_off: (c, eid) => c.turnOff(eid),
    on: (c, eid, p) => c.turnOn(eid, p),
    off: (c, eid) => c.turnOff(eid),
    set_brightness: (c, eid, p) =>
      c.setBrightness(eid, Number(p["brightness"] ?? p["brightness_pct"] ?? 100)),
    set_color: (c, eid, p) => {
      const rgb = p["rgb"] ?? p["rgb_color"] ?? p["color"];
      if (Array.isArray(rgb) && rgb.length === 3) {
        return c.setColor(eid, rgb as [number, number, number]);
      }
      return c.turnOn(eid, p);
    },
    brightness: (c, eid, p) =>
      c.setBrightness(eid, Number(p["brightness"] ?? p["brightness_pct"] ?? p["value"] ?? 100)),
    dim: (c, eid, p) =>
      c.setBrightness(eid, Number(p["brightness"] ?? p["value"] ?? 30)),
  },

  lock: {
    lock: (c, eid) => c.lockEntity(eid),
    unlock: (c, eid) => c.unlockEntity(eid),
  },

  climate: {
    set_temperature: (c, eid, p) =>
      c.setTemperature(
        eid,
        Number(p["temperature"] ?? p["temp"] ?? 72),
        typeof p["hvac_mode"] === "string" ? p["hvac_mode"] : undefined,
      ),
    set_temp: (c, eid, p) =>
      c.setTemperature(
        eid,
        Number(p["temperature"] ?? p["temp"] ?? 72),
        typeof p["hvac_mode"] === "string" ? p["hvac_mode"] : undefined,
      ),
    set_mode: (c, eid, p) =>
      c.setHvacMode(eid, String(p["mode"] ?? p["hvac_mode"] ?? "auto")),
    turn_on: (c, eid) => c.turnOn(eid),
    turn_off: (c, eid) => c.turnOff(eid),
    eco: (c, eid) => c.setHvacMode(eid, "eco"),
    increment_temperature: async (c, eid, p) => {
      const current = await c.getState(eid);
      const currentTemp = Number(current.attributes?.["temperature"] ?? 72);
      const delta = Number(p["delta"] ?? 2);
      return c.setTemperature(eid, currentTemp + delta);
    },
    decrement_temperature: async (c, eid, p) => {
      const current = await c.getState(eid);
      const currentTemp = Number(current.attributes?.["temperature"] ?? 72);
      const delta = Number(p["delta"] ?? 2);
      return c.setTemperature(eid, currentTemp - delta);
    },
  },

  // "thermostat" is our DeviceCategory alias for climate
  thermostat: {
    set_temperature: (c, eid, p) =>
      c.setTemperature(
        eid,
        Number(p["temperature"] ?? p["temp"] ?? 72),
        typeof p["hvac_mode"] === "string" ? p["hvac_mode"] : undefined,
      ),
    set_temp: (c, eid, p) =>
      c.setTemperature(
        eid,
        Number(p["temperature"] ?? p["temp"] ?? 72),
        typeof p["hvac_mode"] === "string" ? p["hvac_mode"] : undefined,
      ),
    set_mode: (c, eid, p) =>
      c.setHvacMode(eid, String(p["mode"] ?? p["hvac_mode"] ?? "auto")),
    eco: (c, eid) => c.setHvacMode(eid, "eco"),
    increment_temperature: async (c, eid, p) => {
      const current = await c.getState(eid);
      const currentTemp = Number(current.attributes?.["temperature"] ?? 72);
      const delta = Number(p["delta"] ?? 2);
      return c.setTemperature(eid, currentTemp + delta);
    },
    decrement_temperature: async (c, eid, p) => {
      const current = await c.getState(eid);
      const currentTemp = Number(current.attributes?.["temperature"] ?? 72);
      const delta = Number(p["delta"] ?? 2);
      return c.setTemperature(eid, currentTemp - delta);
    },
  },

  switch: {
    turn_on: (c, eid) => c.turnOn(eid),
    turn_off: (c, eid) => c.turnOff(eid),
    on: (c, eid) => c.turnOn(eid),
    off: (c, eid) => c.turnOff(eid),
    toggle: async (c, eid) => {
      const state = await c.getState(eid);
      return state.state === "on" ? c.turnOff(eid) : c.turnOn(eid);
    },
  },

  cover: {
    open: (c, eid) => c.openCover(eid),
    close: (c, eid) => c.closeCover(eid),
    open_cover: (c, eid) => c.openCover(eid),
    close_cover: (c, eid) => c.closeCover(eid),
  },

  media_player: {
    play: (c, eid) => c.mediaPlay(eid),
    pause: (c, eid) => c.mediaPause(eid),
    stop: (c, eid) => c.mediaPause(eid),
    volume: (c, eid, p) =>
      c.mediaSetVolume(eid, Number(p["volume"] ?? p["volume_level"] ?? 0.5)),
    set_volume: (c, eid, p) =>
      c.mediaSetVolume(eid, Number(p["volume"] ?? p["volume_level"] ?? 0.5)),
    turn_on: (c, eid) => c.turnOn(eid),
    turn_off: (c, eid) => c.turnOff(eid),
    tts: (c, eid, p) =>
      c.playTts(eid, String(p["message"] ?? ""), typeof p["engine"] === "string" ? p["engine"] : undefined),
  },

  fan: {
    turn_on: (c, eid) => c.turnOn(eid),
    turn_off: (c, eid) => c.turnOff(eid),
    on: (c, eid) => c.turnOn(eid),
    off: (c, eid) => c.turnOff(eid),
  },

  scene: {
    activate: (c, eid) =>
      c.callService("scene", "turn_on", { entity_id: eid }),
    turn_on: (c, eid) =>
      c.callService("scene", "turn_on", { entity_id: eid }),
  },

  calendar: {
    create_event: async (c, eid, p) => {
      const event: HACalendarEventCreate = {
        entity_id: eid,
        summary: String(p["summary"] ?? p["title"] ?? "New Event"),
        ...(p["start_date_time"] ? { start_date_time: String(p["start_date_time"]) } : {}),
        ...(p["end_date_time"] ? { end_date_time: String(p["end_date_time"]) } : {}),
        ...(p["start_date"] ? { start_date: String(p["start_date"]) } : {}),
        ...(p["end_date"] ? { end_date: String(p["end_date"]) } : {}),
        ...(p["description"] ? { description: String(p["description"]) } : {}),
        ...(p["location"] ? { location: String(p["location"]) } : {}),
      };
      await c.createCalendarEvent(event);
      // Return current state after event creation
      const state = await c.getState(eid);
      return [state];
    },
  },

  // Email send actions — hard-gated by EMAIL_SEND_ENABLED feature flag
  email: {
    send: async (c, eid, p) => {
      if (!EMAIL_SEND_ENABLED) {
        throw new Error(
          "Email sending is disabled. Change EMAIL_SEND_ENABLED in feature-flags.ts to enable.",
        );
      }
      const to = String(p["to"] ?? p["target"] ?? "");
      const subject = String(p["subject"] ?? p["title"] ?? "");
      const body = String(p["body"] ?? p["message"] ?? "");
      // Determine provider from entity_id pattern
      if (eid.includes("outlook") || eid.includes("o365")) {
        await c.sendOutlookEmail(eid, to, subject, body);
      } else {
        await c.sendGmailEmail(eid, to, subject, body);
      }
      return [];
    },
  },
};

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class CommandExecutor {
  private readonly haClient: HARestClient;
  private readonly resolver: DeviceResolver;
  private readonly tenantId: TenantId;
  private readonly permissionResolver: FamilyPermissionResolver;

  constructor(config: CommandExecutorConfig) {
    this.haClient = config.haClient;
    this.resolver = config.resolver;
    this.tenantId = config.tenantId;
    this.permissionResolver = new FamilyPermissionResolver();
  }

  // -----------------------------------------------------------------------
  // Main entry point
  // -----------------------------------------------------------------------

  /**
   * Execute a parsed voice intent against Home Assistant.
   *
   * @param intent         Parsed intent from the voice pipeline.
   * @param userId         The user who issued the command.
   * @param source         Origin of the command.
   * @param familyContext  Optional family context for permission checking.
   */
  async execute(
    intent: ParsedIntent,
    userId: UserId,
    source: DeviceCommand["source"] = "voice",
    familyContext?: FamilyVoiceContext,
  ): Promise<ExecutionResult> {
    const start = Date.now();
    const errors: string[] = [];
    const stateChanges: DeviceStateChange[] = [];
    const constraintMessages: string[] = [];

    // 1. Resolve target device(s)
    const targets = await this.resolveTargets(intent);

    if (targets.length === 0) {
      return {
        success: false,
        stateChanges: [],
        errors: [
          `Could not find device "${intent.target_device ?? "unknown"}"` +
            (intent.target_room ? ` in room "${intent.target_room}"` : ""),
        ],
        durationMs: Date.now() - start,
      };
    }

    // 2. Family permission check (before any HA calls)
    if (familyContext) {
      for (const target of targets) {
        const permCheck = this.permissionResolver.checkPermission(
          familyContext,
          intent,
          target,
        );

        if (!permCheck.allowed) {
          return {
            success: false,
            stateChanges: [],
            errors: [],
            durationMs: Date.now() - start,
            permissionDenied: true,
            denialMessage: permCheck.reason,
          };
        }

        // Apply constraints (clamp parameters in place)
        const clamped = this.permissionResolver.applyConstraints(
          intent,
          permCheck.constraints_applied,
        );
        constraintMessages.push(...clamped);
      }
    }

    // 3. Find the action handler
    const domainHandlers =
      ACTION_HANDLERS[intent.domain] ??
      ACTION_HANDLERS[this.categoryToDomain(targets[0]?.category)];

    if (!domainHandlers) {
      return {
        success: false,
        stateChanges: [],
        errors: [`Unsupported domain: "${intent.domain}"`],
        durationMs: Date.now() - start,
      };
    }

    const handler = domainHandlers[intent.action];
    if (!handler) {
      return {
        success: false,
        stateChanges: [],
        errors: [
          `Unsupported action "${intent.action}" for domain "${intent.domain}"`,
        ],
        durationMs: Date.now() - start,
      };
    }

    // 4. Execute against each target device
    for (const target of targets) {
      try {
        // Capture state before execution
        const beforeEntity = await this.haClient
          .getState(target.ha_entity_id)
          .catch(() => null);
        const previousState: DeviceState = beforeEntity
          ? mapHAState(target.ha_entity_id, beforeEntity.state)
          : target.state;

        // Execute the service call
        await handler(this.haClient, target.ha_entity_id, intent.parameters);

        // Capture state after execution
        const afterEntity = await this.haClient
          .getState(target.ha_entity_id)
          .catch(() => null);
        const newState: DeviceState = afterEntity
          ? mapHAState(target.ha_entity_id, afterEntity.state)
          : "unknown";

        const change: DeviceStateChange = {
          id: crypto.randomUUID(),
          device_id: target.id,
          tenant_id: this.tenantId,
          previous_state: previousState,
          new_state: newState,
          changed_by: userId,
          source,
          timestamp: new Date().toISOString(),
        };
        stateChanges.push(change);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unknown execution error";
        errors.push(
          `Failed to execute ${intent.action} on ${target.ha_entity_id}: ${msg}`,
        );
      }
    }

    return {
      success: errors.length === 0,
      stateChanges,
      errors,
      durationMs: Date.now() - start,
      constraintMessages: constraintMessages.length > 0 ? constraintMessages : undefined,
    };
  }

  // -----------------------------------------------------------------------
  // Execute a raw DeviceCommand (for non-voice callers)
  // -----------------------------------------------------------------------

  async executeCommand(command: DeviceCommand): Promise<ExecutionResult> {
    const intent: ParsedIntent = {
      domain: this.guessDomain(command),
      action: command.action,
      target_device: command.device_id as unknown as string,
      parameters: command.parameters,
      confidence: command.confidence ?? 1.0,
      raw_transcript: "",
    };
    return this.execute(intent, command.issued_by, command.source);
  }

  // -----------------------------------------------------------------------
  // Target resolution
  // -----------------------------------------------------------------------

  private async resolveTargets(intent: ParsedIntent): Promise<Device[]> {
    // If a specific device is named, resolve it
    if (intent.target_device) {
      const device = await this.resolver.resolveDevice(
        intent.target_device,
        intent.target_room,
        this.tenantId,
      );
      if (device) return [device];
    }

    // If only a room is specified, get all devices in the room
    // that match the domain
    if (intent.target_room) {
      const roomDevices = await this.resolver.resolveRoom(
        intent.target_room,
        this.tenantId,
      );
      return roomDevices.filter(
        (d) =>
          d.category === intent.domain ||
          this.categoryToDomain(d.category) === intent.domain,
      );
    }

    // If only a domain/category is given (e.g. "turn off all lights"),
    // resolve all devices of that category
    if (intent.domain && !intent.target_device && !intent.target_room) {
      const all = await this.resolver.resolveCategory(
        intent.domain,
        this.tenantId,
      );
      return all;
    }

    return [];
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Map our DeviceCategory to the HA service domain string.
   * "thermostat" -> "climate", everything else is identity.
   */
  private categoryToDomain(
    category: string | undefined,
  ): string {
    if (!category) return "homeassistant";
    if (category === "thermostat") return "climate";
    return category;
  }

  /** Best-effort domain guess from a DeviceCommand (no intent). */
  private guessDomain(command: DeviceCommand): string {
    const action = command.action.toLowerCase();
    if (action.includes("lock") || action.includes("unlock")) return "lock";
    if (action.includes("temp") || action.includes("thermostat"))
      return "climate";
    if (action.includes("bright") || action.includes("dim")) return "light";
    if (action.includes("play") || action.includes("pause") || action.includes("volume"))
      return "media_player";
    if (action.includes("open") || action.includes("close")) return "cover";
    return "homeassistant";
  }
}
