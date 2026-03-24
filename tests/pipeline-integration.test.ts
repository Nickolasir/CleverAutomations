/**
 * Command Execution Pipeline Integration Test
 *
 * Connects the voice pipeline's ParsedIntent -> CommandExecutor -> HA simulator
 * to test the full command execution path without real hardware.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startSimulator, type SimulatorHandle } from "./ha-simulator.js";
import { HARestClient } from "../packages/ha-bridge/src/rest-client.js";
import {
  CommandExecutor,
  type DeviceResolver,
} from "../packages/ha-bridge/src/command-executor.js";
import type {
  Device,
  DeviceId,
  DeviceCategory,
  DeviceState,
  TenantId,
  UserId,
  ParsedIntent,
  FamilyVoiceContext,
  FamilyMemberProfile,
  FamilyAgeGroup,
  AgentPersonality,
} from "@clever/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIM_PORT = 18124; // avoid conflict with standalone simulator
const AUTH_TOKEN = "test-token-ha-simulator";
const TENANT_ID = "test-tenant-001" as TenantId;
const USER_ID = "test-user-001" as UserId;

// ---------------------------------------------------------------------------
// Device catalog — maps friendly names to simulator entities
// ---------------------------------------------------------------------------

interface DeviceEntry {
  name: string;
  ha_entity_id: string;
  category: DeviceCategory;
  room: string;
  floor: string;
}

const DEVICE_CATALOG: DeviceEntry[] = [
  {
    name: "living room light",
    ha_entity_id: "light.living_room_main",
    category: "light",
    room: "Living Room",
    floor: "ground",
  },
  {
    name: "bedroom lamp",
    ha_entity_id: "light.bedroom_lamp",
    category: "light",
    room: "Master Bedroom",
    floor: "upper",
  },
  {
    name: "front door",
    ha_entity_id: "lock.front_door",
    category: "lock",
    room: "Front Entry",
    floor: "ground",
  },
  {
    name: "thermostat",
    ha_entity_id: "climate.main_thermostat",
    category: "climate",
    room: "Hallway",
    floor: "ground",
  },
  {
    name: "living room tv",
    ha_entity_id: "media_player.living_room",
    category: "media_player",
    room: "Living Room",
    floor: "ground",
  },
  {
    name: "fan",
    ha_entity_id: "fan.living_room_fan",
    category: "fan",
    room: "Living Room",
    floor: "ground",
  },
];

function catalogToDevice(entry: DeviceEntry): Device {
  return {
    id: entry.ha_entity_id as unknown as DeviceId,
    tenant_id: TENANT_ID,
    ha_entity_id: entry.ha_entity_id,
    name: entry.name,
    category: entry.category,
    room: entry.room,
    floor: entry.floor,
    state: "off" as DeviceState,
    attributes: {},
    is_online: true,
    last_seen: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mock DeviceResolver
// ---------------------------------------------------------------------------

function createMockResolver(): DeviceResolver {
  const devices = DEVICE_CATALOG.map(catalogToDevice);

  return {
    async resolveDevice(
      name: string,
      room?: string,
      _tenantId?: TenantId,
    ): Promise<Device | null> {
      const lower = name.toLowerCase();

      // Try exact name match first
      let match = devices.find((d) => d.name.toLowerCase() === lower);
      if (match) return match;

      // Try partial match with optional room qualifier
      match = devices.find((d) => {
        const nameMatch = d.name.toLowerCase().includes(lower) || lower.includes(d.name.toLowerCase());
        if (room) {
          return nameMatch && d.room.toLowerCase().includes(room.toLowerCase());
        }
        return nameMatch;
      });
      if (match) return match;

      // Try matching by room + category hint (e.g., "light" in "living room")
      if (room) {
        match = devices.find(
          (d) =>
            d.room.toLowerCase().includes(room.toLowerCase()) &&
            lower.includes(d.category),
        );
        if (match) return match;
      }

      return null;
    },

    async resolveRoom(
      room: string,
      _tenantId?: TenantId,
    ): Promise<Device[]> {
      return devices.filter((d) =>
        d.room.toLowerCase().includes(room.toLowerCase()),
      );
    },

    async resolveCategory(
      category: string,
      _tenantId?: TenantId,
    ): Promise<Device[]> {
      return devices.filter(
        (d) =>
          d.category === category ||
          (category === "thermostat" && d.category === "climate"),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Family profile helpers
// ---------------------------------------------------------------------------

function makePersonality(overrides?: Partial<AgentPersonality>): AgentPersonality {
  return {
    tone: "friendly",
    vocabulary_level: "adult",
    humor_level: 0.3,
    encouragement_level: 0.1,
    safety_warnings: false,
    max_response_words: 30,
    forbidden_topics: [],
    custom_greeting: "Hello.",
    sound_effects: false,
    ...overrides,
  };
}

function makeFamilyProfile(
  ageGroup: FamilyAgeGroup,
  name: string,
): FamilyMemberProfile {
  return {
    id: `profile-${name.toLowerCase()}`,
    tenant_id: TENANT_ID,
    user_id: `user-${name.toLowerCase()}` as UserId,
    age_group: ageGroup,
    date_of_birth: null,
    agent_name: name,
    agent_voice_id: null,
    agent_personality: makePersonality(),
    managed_by: ageGroup === "adult" ? null : USER_ID,
    is_active: true,
    expires_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeFamilyContext(
  ageGroup: FamilyAgeGroup,
  name: string,
): FamilyVoiceContext {
  return {
    profile: makeFamilyProfile(ageGroup, name),
    overrides: [],
    active_schedules: [],
    spending_limit: null,
  };
}

// ---------------------------------------------------------------------------
// Intent builder helper
// ---------------------------------------------------------------------------

function makeIntent(overrides: Partial<ParsedIntent> & { domain: string; action: string }): ParsedIntent {
  return {
    target_device: undefined,
    target_room: undefined,
    parameters: {},
    confidence: 0.95,
    raw_transcript: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Command Execution Pipeline Integration", () => {
  let sim: SimulatorHandle;
  let haClient: HARestClient;
  let executor: CommandExecutor;

  beforeAll(async () => {
    sim = await startSimulator(SIM_PORT);

    haClient = new HARestClient({
      baseUrl: `http://localhost:${SIM_PORT}`,
      token: AUTH_TOKEN,
      tenantId: TENANT_ID,
      maxRetries: 0,
      requestTimeoutMs: 5000,
    });

    executor = new CommandExecutor({
      haClient,
      resolver: createMockResolver(),
      tenantId: TENANT_ID,
    });
  });

  afterAll(() => {
    return new Promise<void>((resolve) => {
      sim.server.close(() => resolve());
    });
  });

  beforeEach(() => {
    sim.resetState();
  });

  // =========================================================================
  // Light Control
  // =========================================================================

  describe("Light Control", () => {
    it("should turn on the living room light", async () => {
      // Verify initial state is off
      const before = await haClient.getState("light.living_room_main");
      expect(before.state).toBe("off");

      const result = await executor.execute(
        makeIntent({
          domain: "light",
          action: "turn_on",
          target_device: "living room light",
          raw_transcript: "turn on the living room light",
        }),
        USER_ID,
      );

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.stateChanges).toHaveLength(1);
      expect(result.stateChanges[0].previous_state).toBe("off");
      expect(result.stateChanges[0].new_state).toBe("on");

      // Verify simulator state changed
      const after = await haClient.getState("light.living_room_main");
      expect(after.state).toBe("on");
    });

    it("should set brightness to 80%", async () => {
      const result = await executor.execute(
        makeIntent({
          domain: "light",
          action: "set_brightness",
          target_device: "living room light",
          parameters: { brightness_pct: 80 },
          raw_transcript: "set living room light brightness to 80 percent",
        }),
        USER_ID,
      );

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);

      const after = await haClient.getState("light.living_room_main");
      expect(after.state).toBe("on");
      // brightness_pct 80 -> 255 * 0.80 = 204 (rounded)
      expect(after.attributes.brightness).toBe(Math.round((80 / 100) * 255));
    });

    it("should turn off lights", async () => {
      // First turn on the light
      await haClient.turnOn("light.living_room_main");
      const onState = await haClient.getState("light.living_room_main");
      expect(onState.state).toBe("on");

      const result = await executor.execute(
        makeIntent({
          domain: "light",
          action: "turn_off",
          target_device: "living room light",
          raw_transcript: "turn off the living room light",
        }),
        USER_ID,
      );

      expect(result.success).toBe(true);
      expect(result.stateChanges).toHaveLength(1);
      expect(result.stateChanges[0].new_state).toBe("off");

      const after = await haClient.getState("light.living_room_main");
      expect(after.state).toBe("off");
    });
  });

  // =========================================================================
  // Lock Control
  // =========================================================================

  describe("Lock Control", () => {
    it("should lock the front door", async () => {
      // Start unlocked
      await haClient.unlockEntity("lock.front_door");
      const before = await haClient.getState("lock.front_door");
      expect(before.state).toBe("unlocked");

      const result = await executor.execute(
        makeIntent({
          domain: "lock",
          action: "lock",
          target_device: "front door",
          raw_transcript: "lock the front door",
        }),
        USER_ID,
      );

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.stateChanges).toHaveLength(1);
      expect(result.stateChanges[0].new_state).toBe("locked");

      const after = await haClient.getState("lock.front_door");
      expect(after.state).toBe("locked");
    });

    it("should unlock the front door", async () => {
      // Start locked (default state)
      const before = await haClient.getState("lock.front_door");
      expect(before.state).toBe("locked");

      const result = await executor.execute(
        makeIntent({
          domain: "lock",
          action: "unlock",
          target_device: "front door",
          raw_transcript: "unlock the front door",
        }),
        USER_ID,
      );

      expect(result.success).toBe(true);
      expect(result.stateChanges).toHaveLength(1);
      expect(result.stateChanges[0].new_state).toBe("unlocked");

      const after = await haClient.getState("lock.front_door");
      expect(after.state).toBe("unlocked");
    });
  });

  // =========================================================================
  // Climate Control
  // =========================================================================

  describe("Climate Control", () => {
    it("should set thermostat to 72", async () => {
      const result = await executor.execute(
        makeIntent({
          domain: "climate",
          action: "set_temperature",
          target_device: "thermostat",
          parameters: { temperature: 72 },
          raw_transcript: "set the thermostat to 72",
        }),
        USER_ID,
      );

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);

      const after = await haClient.getState("climate.main_thermostat");
      expect(after.attributes.temperature).toBe(72);
    });

    it("should clamp thermostat at 90 when set to 95 (above simulator max)", async () => {
      const result = await executor.execute(
        makeIntent({
          domain: "climate",
          action: "set_temperature",
          target_device: "thermostat",
          parameters: { temperature: 95 },
          raw_transcript: "set the thermostat to 95",
        }),
        USER_ID,
      );

      expect(result.success).toBe(true);

      // Simulator clamps to max_temp of 90
      const after = await haClient.getState("climate.main_thermostat");
      expect(after.attributes.temperature).toBe(90);
    });
  });

  // =========================================================================
  // Family Permission Integration
  // =========================================================================

  describe("Family Permission Integration", () => {
    it("adult turns on light - success (full permissions)", async () => {
      const adultContext = makeFamilyContext("adult", "Jarvis");

      const result = await executor.execute(
        makeIntent({
          domain: "light",
          action: "turn_on",
          target_device: "living room light",
          raw_transcript: "turn on the living room light",
        }),
        USER_ID,
        "voice",
        adultContext,
      );

      expect(result.success).toBe(true);
      expect(result.permissionDenied).toBeFalsy();
      expect(result.errors).toHaveLength(0);

      const after = await haClient.getState("light.living_room_main");
      expect(after.state).toBe("on");
    });

    it("child tries to unlock door - permission denied", async () => {
      const childContext = makeFamilyContext("child", "Buddy");

      const result = await executor.execute(
        makeIntent({
          domain: "lock",
          action: "unlock",
          target_device: "front door",
          raw_transcript: "unlock the front door",
        }),
        childContext.profile.user_id,
        "voice",
        childContext,
      );

      expect(result.success).toBe(false);
      expect(result.permissionDenied).toBe(true);
      expect(result.denialMessage).toBeDefined();
      expect(result.denialMessage!.length).toBeGreaterThan(0);

      // Verify lock state unchanged (still locked)
      const after = await haClient.getState("lock.front_door");
      expect(after.state).toBe("locked");
    });

    it("teenager sets thermostat to 80 - success but constrained to 78", async () => {
      const teenContext = makeFamilyContext("teenager", "Luna");

      const result = await executor.execute(
        makeIntent({
          domain: "climate",
          action: "set_temperature",
          target_device: "thermostat",
          parameters: { temperature: 80 },
          raw_transcript: "set the thermostat to 80",
        }),
        teenContext.profile.user_id,
        "voice",
        teenContext,
      );

      expect(result.success).toBe(true);
      expect(result.permissionDenied).toBeFalsy();

      // Teenager's default thermostat max is 78, so 80 gets clamped
      expect(result.constraintMessages).toBeDefined();
      expect(result.constraintMessages!.length).toBeGreaterThan(0);
      expect(result.constraintMessages!.some((m) => m.includes("Temperature"))).toBe(true);

      // Verify the temperature in the simulator is 78 (clamped from 80)
      const after = await haClient.getState("climate.main_thermostat");
      expect(after.attributes.temperature).toBe(78);
    });

    it("toddler says 'help' (emergency) - success via emergency bypass", async () => {
      const toddlerContext = makeFamilyContext("toddler", "Sweetie");

      // Toddlers normally have zero device control, but emergency bypasses all
      const result = await executor.execute(
        makeIntent({
          domain: "light",
          action: "turn_on",
          target_device: "living room light",
          raw_transcript: "help help I need help",
        }),
        toddlerContext.profile.user_id,
        "voice",
        toddlerContext,
      );

      expect(result.success).toBe(true);
      expect(result.permissionDenied).toBeFalsy();

      const after = await haClient.getState("light.living_room_main");
      expect(after.state).toBe("on");
    });
  });

  // =========================================================================
  // Error Handling
  // =========================================================================

  describe("Error Handling", () => {
    it("should return error for non-existent device", async () => {
      const result = await executor.execute(
        makeIntent({
          domain: "light",
          action: "turn_on",
          target_device: "garage light",
          raw_transcript: "turn on the garage light",
        }),
        USER_ID,
      );

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("garage light");
    });
  });
});
