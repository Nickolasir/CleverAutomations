/**
 * Scene definitions and batch executor.
 *
 * Built-in scenes: Good Morning, Good Night, Away, Guest Welcome.
 * Also supports custom scenes built from the Scene type.
 * Executes all actions in a scene as a batch of HA service calls.
 */

import type {
  Scene,
  SceneAction,
  DeviceId,
  DeviceStateChange,
  DeviceCommand,
  TenantId,
  UserId,
} from "@clever/shared";
import { HARestClient, mapHAState } from "./rest-client.js";
import type { DeviceResolver } from "./command-executor.js";

// ---------------------------------------------------------------------------
// Scene execution result
// ---------------------------------------------------------------------------

export interface SceneExecutionResult {
  sceneId: string;
  sceneName: string;
  success: boolean;
  stateChanges: DeviceStateChange[];
  errors: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Built-in scene action descriptors
// ---------------------------------------------------------------------------

/**
 * A high-level scene step that uses human-readable names and rooms
 * instead of concrete device IDs. Resolved at execution time.
 */
export interface SceneStep {
  /** Device category or friendly name pattern. */
  target: string;
  /** Optional room scope. */
  room?: string;
  /** HA service domain (e.g. "light", "lock", "climate"). */
  domain: string;
  /** HA service name (e.g. "turn_on", "lock", "set_temperature"). */
  service: string;
  /** Service call data (excluding entity_id). */
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Built-in scene templates
// ---------------------------------------------------------------------------

export const BUILTIN_SCENES: Record<string, SceneStep[]> = {
  good_morning: [
    {
      target: "light",
      domain: "light",
      service: "turn_on",
      data: { brightness_pct: 80 },
    },
    {
      target: "front_door",
      domain: "lock",
      service: "unlock",
    },
    {
      target: "thermostat",
      domain: "climate",
      service: "set_temperature",
      data: { temperature: 72 },
    },
    {
      target: "media_player",
      domain: "tts",
      service: "speak",
      data: { message: "Good morning! Today's briefing is ready." },
    },
  ],

  good_night: [
    {
      target: "light",
      domain: "light",
      service: "turn_off",
    },
    {
      target: "lock",
      domain: "lock",
      service: "lock",
    },
    {
      target: "thermostat",
      domain: "climate",
      service: "set_temperature",
      data: { temperature: 68 },
    },
    {
      target: "alarm_control_panel",
      domain: "alarm_control_panel",
      service: "alarm_arm_night",
    },
  ],

  away: [
    {
      target: "light",
      domain: "light",
      service: "turn_off",
    },
    {
      target: "lock",
      domain: "lock",
      service: "lock",
    },
    {
      target: "thermostat",
      domain: "climate",
      service: "set_hvac_mode",
      data: { hvac_mode: "eco" },
    },
    {
      target: "alarm_control_panel",
      domain: "alarm_control_panel",
      service: "alarm_arm_away",
    },
  ],

  guest_welcome: [
    {
      target: "front_door",
      domain: "lock",
      service: "unlock",
    },
    {
      target: "light",
      domain: "light",
      service: "turn_on",
      data: { brightness_pct: 100 },
    },
    {
      target: "thermostat",
      domain: "climate",
      service: "set_temperature",
      data: { temperature: 72 },
    },
    {
      target: "media_player",
      domain: "tts",
      service: "speak",
      data: { message: "Welcome! We hope you enjoy your stay." },
    },
  ],

  // Aliases for rules engine scene names
  leaving: [], // alias — resolved below
  arriving: [], // alias — resolved below

  movie_mode: [
    {
      target: "light",
      domain: "light",
      service: "turn_on",
      data: { brightness_pct: 15 },
    },
    {
      target: "media_player",
      domain: "media_player",
      service: "turn_on",
    },
  ],

  bedtime: [
    {
      target: "light",
      domain: "light",
      service: "turn_off",
    },
    {
      target: "lock",
      domain: "lock",
      service: "lock",
    },
    {
      target: "thermostat",
      domain: "climate",
      service: "set_temperature",
      data: { temperature: 68 },
    },
  ],
};

// Wire up aliases to their canonical scenes
BUILTIN_SCENES["leaving"] = BUILTIN_SCENES["away"]!;
BUILTIN_SCENES["arriving"] = BUILTIN_SCENES["guest_welcome"]!;

// ---------------------------------------------------------------------------
// Scene executor
// ---------------------------------------------------------------------------

export interface SceneExecutorConfig {
  haClient: HARestClient;
  resolver: DeviceResolver;
  tenantId: TenantId;
}

export class SceneExecutor {
  private readonly haClient: HARestClient;
  private readonly resolver: DeviceResolver;
  private readonly tenantId: TenantId;

  constructor(config: SceneExecutorConfig) {
    this.haClient = config.haClient;
    this.resolver = config.resolver;
    this.tenantId = config.tenantId;
  }

  // -----------------------------------------------------------------------
  // Execute a built-in scene by name
  // -----------------------------------------------------------------------

  async executeBuiltin(
    sceneName: string,
    userId: UserId,
    source: DeviceCommand["source"] = "voice",
  ): Promise<SceneExecutionResult> {
    const steps = BUILTIN_SCENES[sceneName];
    if (!steps) {
      return {
        sceneId: sceneName,
        sceneName,
        success: false,
        stateChanges: [],
        errors: [`Unknown built-in scene: "${sceneName}"`],
        durationMs: 0,
      };
    }

    return this.executeSteps(sceneName, sceneName, steps, userId, source);
  }

  // -----------------------------------------------------------------------
  // Execute a custom Scene (from database)
  // -----------------------------------------------------------------------

  async executeScene(
    scene: Scene,
    userId: UserId,
    source: DeviceCommand["source"] = "voice",
  ): Promise<SceneExecutionResult> {
    const start = Date.now();
    const errors: string[] = [];
    const stateChanges: DeviceStateChange[] = [];

    for (const action of scene.actions) {
      try {
        const change = await this.executeAction(action, userId, source);
        if (change) {
          stateChanges.push(change);
        }
      } catch (err) {
        errors.push(
          `Action on ${action.device_id as string} failed: ${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        );
      }
    }

    return {
      sceneId: scene.id,
      sceneName: scene.name,
      success: errors.length === 0,
      stateChanges,
      errors,
      durationMs: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Build a custom scene from steps
  // -----------------------------------------------------------------------

  /**
   * Convert a list of SceneSteps (human-friendly) into a Scene object
   * with resolved device IDs. Useful for dynamically building scenes.
   */
  async buildScene(
    name: string,
    description: string,
    steps: SceneStep[],
    createdBy: UserId,
  ): Promise<Scene> {
    const actions: SceneAction[] = [];

    for (const step of steps) {
      const devices = await this.resolveStepTargets(step);
      for (const device of devices) {
        actions.push({
          device_id: device.id,
          action: `${step.domain}.${step.service}`,
          parameters: step.data ?? {},
        });
      }
    }

    return {
      id: crypto.randomUUID(),
      tenant_id: this.tenantId,
      name,
      description,
      actions,
      trigger: "manual",
      created_by: createdBy,
    };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Execute a list of SceneSteps and collect results. */
  private async executeSteps(
    sceneId: string,
    sceneName: string,
    steps: SceneStep[],
    userId: UserId,
    source: DeviceCommand["source"],
  ): Promise<SceneExecutionResult> {
    const start = Date.now();
    const errors: string[] = [];
    const stateChanges: DeviceStateChange[] = [];

    for (const step of steps) {
      const results = await this.executeStep(step, userId, source);
      stateChanges.push(...results.changes);
      errors.push(...results.errors);
    }

    return {
      sceneId,
      sceneName,
      success: errors.length === 0,
      stateChanges,
      errors,
      durationMs: Date.now() - start,
    };
  }

  /** Execute a single SceneStep against all matching devices. */
  private async executeStep(
    step: SceneStep,
    userId: UserId,
    source: DeviceCommand["source"],
  ): Promise<{ changes: DeviceStateChange[]; errors: string[] }> {
    const changes: DeviceStateChange[] = [];
    const errors: string[] = [];

    const devices = await this.resolveStepTargets(step);

    if (devices.length === 0) {
      // Non-critical: some scenes reference optional devices (e.g. alarm panel)
      // Silently skip if not found.
      return { changes, errors };
    }

    for (const device of devices) {
      try {
        // Capture before state
        const beforeEntity = await this.haClient
          .getState(device.ha_entity_id)
          .catch(() => null);

        // Execute the service call
        await this.haClient.callService(step.domain, step.service, {
          entity_id: device.ha_entity_id,
          ...(step.data ?? {}),
        });

        // Capture after state
        const afterEntity = await this.haClient
          .getState(device.ha_entity_id)
          .catch(() => null);

        const change: DeviceStateChange = {
          id: crypto.randomUUID(),
          device_id: device.id,
          tenant_id: this.tenantId,
          previous_state: beforeEntity
            ? mapHAState(device.ha_entity_id, beforeEntity.state)
            : device.state,
          new_state: afterEntity
            ? mapHAState(device.ha_entity_id, afterEntity.state)
            : "unknown",
          changed_by: userId,
          source,
          timestamp: new Date().toISOString(),
        };
        changes.push(change);
      } catch (err) {
        errors.push(
          `Scene step ${step.domain}.${step.service} on ${device.ha_entity_id}: ${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        );
      }
    }

    return { changes, errors };
  }

  /** Execute a single SceneAction (from a custom Scene). */
  private async executeAction(
    action: SceneAction,
    userId: UserId,
    source: DeviceCommand["source"],
  ): Promise<DeviceStateChange | null> {
    // action.action is "domain.service"
    const [domain, service] = action.action.split(".");
    if (!domain || !service) {
      throw new Error(`Invalid action format: "${action.action}"`);
    }

    const entityId = action.device_id as unknown as string;

    const beforeEntity = await this.haClient
      .getState(entityId)
      .catch(() => null);

    await this.haClient.callService(domain, service, {
      entity_id: entityId,
      ...action.parameters,
    });

    const afterEntity = await this.haClient
      .getState(entityId)
      .catch(() => null);

    return {
      id: crypto.randomUUID(),
      device_id: action.device_id,
      tenant_id: this.tenantId,
      previous_state: beforeEntity
        ? mapHAState(entityId, beforeEntity.state)
        : "unknown",
      new_state: afterEntity
        ? mapHAState(entityId, afterEntity.state)
        : "unknown",
      changed_by: userId,
      source,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Resolve a SceneStep target to concrete Device objects.
   *
   * Tries in order:
   *  1. Specific device name (e.g. "front_door")
   *  2. Category match (e.g. "light" returns all lights)
   */
  private async resolveStepTargets(
    step: SceneStep,
  ): Promise<Array<{ id: DeviceId; ha_entity_id: string; state: import("@clever/shared").DeviceState }>> {
    // Try as a specific device name first
    const specificDevice = await this.resolver
      .resolveDevice(step.target, step.room, this.tenantId)
      .catch(() => null);

    if (specificDevice) {
      return [specificDevice];
    }

    // Try as a category (returns all devices of that type)
    const categoryDevices = await this.resolver
      .resolveCategory(step.target, this.tenantId)
      .catch(() => []);

    if (categoryDevices.length > 0) {
      // If room-scoped, filter
      if (step.room) {
        return categoryDevices.filter(
          (d) => d.room.toLowerCase() === step.room!.toLowerCase(),
        );
      }
      return categoryDevices;
    }

    return [];
  }
}

// ---------------------------------------------------------------------------
// Utility: list available built-in scene names
// ---------------------------------------------------------------------------

export function listBuiltinScenes(): string[] {
  return Object.keys(BUILTIN_SCENES);
}

/**
 * Get the human-friendly display name for a built-in scene.
 */
export function builtinSceneDisplayName(key: string): string {
  const names: Record<string, string> = {
    good_morning: "Good Morning",
    good_night: "Good Night",
    away: "Away",
    guest_welcome: "Guest Welcome",
    leaving: "Leaving",
    arriving: "Arriving",
    movie_mode: "Movie Mode",
    bedtime: "Bedtime",
  };
  return names[key] ?? key;
}
