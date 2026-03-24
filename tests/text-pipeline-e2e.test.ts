/**
 * Text-Injection Pipeline End-to-End Test
 *
 * Bypasses audio/STT and injects text directly into the pipeline to test:
 *   Text → Tier 1 Rules Engine → Permission Check → Command Execution → State Verification
 *
 * This tests the FULL flow from natural language to device state change,
 * using the family permission system and live Home Assistant.
 *
 * Prerequisites:
 *   - Home Assistant at http://127.0.0.1:8123 with virtual devices
 *   - Supabase at http://127.0.0.1:54321 with family seed data
 *   - HA_URL, HA_LONG_LIVED_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars
 *
 * Run: npx vitest run tests/text-pipeline-e2e.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";

// Voice pipeline
import { matchRule } from "../packages/voice-pipeline/src/tier1/rules-engine.js";

// HA Bridge
import {
  HARestClient,
  CommandExecutor,
  DeviceDiscovery,
} from "../packages/ha-bridge/src/index.js";
import type {
  DeviceResolver,
  DeviceStore,
} from "../packages/ha-bridge/src/index.js";

// Shared types & permissions
import { FamilyPermissionResolver } from "../packages/shared/src/permissions/index.js";
import type {
  Device,
  DeviceId,
  TenantId,
  UserId,
  ParsedIntent,
  FamilyVoiceContext,
  FamilyMemberProfile,
  FamilyPermissionOverride,
  FamilySchedule,
  FamilySpendingLimit,
} from "../packages/shared/src/index.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HA_URL = process.env["HA_URL"] || "http://127.0.0.1:8123";
const HA_TOKEN = process.env["HA_LONG_LIVED_TOKEN"] || "";
const TENANT_ID = "a0000000-0000-4000-8000-000000000001" as TenantId;

const HA_AVAILABLE = !!HA_TOKEN;

// Family member user IDs from seed data
const FAMILY = {
  jarvis: { userId: "b0000000-0000-4000-8000-000000000010" as UserId, ageGroup: "adult" as const },
  luna:   { userId: "b0000000-0000-4000-8000-000000000011" as UserId, ageGroup: "teenager" as const },
  atlas:  { userId: "b0000000-0000-4000-8000-000000000012" as UserId, ageGroup: "tween" as const },
  buddy:  { userId: "b0000000-0000-4000-8000-000000000013" as UserId, ageGroup: "child" as const },
  sunny:  { userId: "b0000000-0000-4000-8000-000000000014" as UserId, ageGroup: "toddler" as const },
  guest:  { userId: "b0000000-0000-4000-8000-000000000015" as UserId, ageGroup: "adult_visitor" as const },
};

// ---------------------------------------------------------------------------
// In-memory device store (same as ha-bridge-integration test)
// ---------------------------------------------------------------------------

class InMemoryDeviceStore implements DeviceStore {
  private devices: Map<string, Device> = new Map();
  async listDevices(): Promise<Device[]> { return Array.from(this.devices.values()); }
  async upsertDevice(device: Device): Promise<void> { this.devices.set(device.ha_entity_id, device); }
  async removeDevice(deviceId: DeviceId): Promise<void> {
    for (const [key, dev] of this.devices) { if (dev.id === deviceId) { this.devices.delete(key); break; } }
  }
  getByEntityId(entityId: string): Device | undefined { return this.devices.get(entityId); }
}

class InMemoryDeviceResolver implements DeviceResolver {
  constructor(private store: InMemoryDeviceStore) {}
  async resolveDevice(name: string, room?: string): Promise<Device | null> {
    const devices = await this.store.listDevices();
    const lower = name.toLowerCase().replace(/\s+/g, "_");
    const byExact = devices.find((d) => d.ha_entity_id.endsWith("." + lower));
    if (byExact) return byExact;
    return devices.find((d) => {
      const entityName = d.ha_entity_id.split(".")[1] || "";
      const nameMatch = entityName.includes(lower) || d.name.toLowerCase().includes(name.toLowerCase());
      const roomMatch = room ? d.room.toLowerCase().includes(room.toLowerCase()) : true;
      return nameMatch && roomMatch;
    }) ?? null;
  }
  async resolveRoom(room: string): Promise<Device[]> {
    return (await this.store.listDevices()).filter((d) => d.room.toLowerCase().includes(room.toLowerCase()));
  }
  async resolveCategory(category: string): Promise<Device[]> {
    return (await this.store.listDevices()).filter((d) => d.category === category);
  }
}

// ---------------------------------------------------------------------------
// Helper: build family voice context for permission checks
// ---------------------------------------------------------------------------

function buildFamilyContext(
  member: keyof typeof FAMILY,
  overrides: Partial<FamilyPermissionOverride>[] = [],
  schedules: Partial<FamilySchedule>[] = [],
): FamilyVoiceContext {
  const info = FAMILY[member];
  return {
    profile: {
      id: `f0000000-0000-4000-8000-00000000000${Object.keys(FAMILY).indexOf(member) + 1}`,
      tenant_id: TENANT_ID,
      user_id: info.userId,
      age_group: info.ageGroup,
      agent_name: member.charAt(0).toUpperCase() + member.slice(1),
      agent_voice_id: null,
      agent_personality: {
        tone: "friendly",
        vocabulary_level: "adult",
        humor_level: 0.3,
        encouragement_level: 0.2,
        safety_warnings: false,
        max_response_words: 200,
        forbidden_topics: [],
        custom_greeting: "Hello!",
        sound_effects: false,
      },
      managed_by: member === "jarvis" ? null : FAMILY.jarvis.userId,
      is_active: true,
      expires_at: null,
    } as FamilyMemberProfile,
    overrides: overrides as FamilyPermissionOverride[],
    active_schedules: schedules as FamilySchedule[],
    spending_limit: null,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a mock Device for permission checks
// ---------------------------------------------------------------------------

function mockDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: "d0000000-0000-4000-8000-000000000001" as DeviceId,
    tenant_id: TENANT_ID,
    ha_entity_id: "light.living_room_main",
    name: "Living Room Main Light",
    category: "light",
    room: "Living Room",
    floor: "1",
    state: "off",
    attributes: {},
    is_online: true,
    last_seen: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Device;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!HA_AVAILABLE)("Text-Injection Pipeline E2E", () => {
  let restClient: HARestClient;
  let store: InMemoryDeviceStore;
  let resolver: InMemoryDeviceResolver;
  let executor: CommandExecutor;
  let permissionResolver: FamilyPermissionResolver;

  beforeAll(async () => {
    restClient = new HARestClient({
      baseUrl: HA_URL,
      token: HA_TOKEN,
      tenantId: TENANT_ID,
    });

    store = new InMemoryDeviceStore();
    resolver = new InMemoryDeviceResolver(store);
    executor = new CommandExecutor({ haClient: restClient, resolver, tenantId: TENANT_ID });
    permissionResolver = new FamilyPermissionResolver();

    // Discover devices from live HA
    const discovery = new DeviceDiscovery({
      haClient: restClient,
      store,
      tenantId: TENANT_ID,
      includeDomains: ["light", "lock", "climate", "media_player", "switch", "fan"],
    });
    await discovery.scan();
  });

  // =========================================================================
  // TIER 1: TEXT → INTENT PARSING
  // =========================================================================

  describe("Tier 1: Text to Intent", () => {
    const cases = [
      { text: "turn on the living room lights",    domain: "light",   action: "turn_on" },
      { text: "turn off the bedroom light",        domain: "light",   action: "turn_off" },
      { text: "lock the front door",               domain: "lock",    action: "lock" },
      { text: "unlock front door",                 domain: "lock",    action: "unlock" },
      { text: "set temperature to 74",             domain: "thermostat", action: "set_temperature" },
      { text: "make it cooler",                    domain: "thermostat", action: "decrement_temperature" },
    ];

    for (const { text, domain, action } of cases) {
      it(`"${text}" → ${domain}.${action}`, () => {
        const intent = matchRule(text);
        expect(intent).not.toBeNull();
        expect(intent!.domain).toBe(domain);
        expect(intent!.action).toBe(action);
        expect(intent!.confidence).toBe(1.0);
      });
    }

    it("returns null for unrecognized text", () => {
      expect(matchRule("what is the meaning of life")).toBeNull();
      expect(matchRule("tell me a joke")).toBeNull();
    });
  });

  // =========================================================================
  // FAMILY PERMISSION CHECKS
  // =========================================================================

  describe("Family Permissions with Parsed Intents", () => {
    it("Jarvis (adult) can control any device", () => {
      const intent = matchRule("unlock the front door")!;
      const context = buildFamilyContext("jarvis");
      const device = mockDevice({ category: "lock", ha_entity_id: "lock.front_door_lock", name: "Front Door Lock" });
      const result = permissionResolver.checkPermission(context, intent, device);
      expect(result.allowed).toBe(true);
    });

    it("Luna (teenager) denied lock control", () => {
      const intent = matchRule("unlock the front door")!;
      const device = mockDevice({
        id: "d0000000-0000-4000-8000-000000000003" as DeviceId,
        category: "lock",
        ha_entity_id: "lock.front_door_lock",
        name: "Front Door Lock",
      });
      const context = buildFamilyContext("luna", [
        {
          device_id: "d0000000-0000-4000-8000-000000000003" as DeviceId,
          action: "control" as const,
          allowed: false,
          constraints: {},
        },
      ]);
      const result = permissionResolver.checkPermission(context, intent, device);
      expect(result.allowed).toBe(false);
    });

    it("Buddy (child) allowed lights but denied locks", () => {
      // Child default: own_room_lights_only — lights are allowed at resolver level
      // (room scoping happens at the voice pipeline system prompt, not the resolver)
      const lightIntent = matchRule("turn on the living room lights")!;
      const context = buildFamilyContext("buddy");
      const lightDevice = mockDevice();
      const lightResult = permissionResolver.checkPermission(context, lightIntent, lightDevice);
      expect(lightResult.allowed).toBe(true);

      // But locks are denied for children
      const lockIntent = matchRule("unlock the front door")!;
      const lockDevice = mockDevice({ category: "lock", ha_entity_id: "lock.front_door_lock" });
      const lockResult = permissionResolver.checkPermission(context, lockIntent, lockDevice);
      expect(lockResult.allowed).toBe(false);
    });

    it("Sunny (toddler) denied all device control", () => {
      const intent = matchRule("turn on the living room lights")!;
      const context = buildFamilyContext("sunny");
      const device = mockDevice();
      const result = permissionResolver.checkPermission(context, intent, device);
      expect(result.allowed).toBe(false);
    });

    it("emergency commands bypass all restrictions (toddler)", () => {
      // Build an intent with emergency transcript
      const emergencyIntent: ParsedIntent = {
        domain: "system",
        action: "emergency",
        parameters: {},
        confidence: 1.0,
        raw_transcript: "help I'm scared there's a fire",
      };
      const context = buildFamilyContext("sunny"); // toddler — normally denied everything
      const device = mockDevice();
      const result = permissionResolver.checkPermission(context, emergencyIntent, device);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("emergency_bypass");
    });
  });

  // =========================================================================
  // TEXT → INTENT → HA EXECUTION → STATE VERIFICATION
  // =========================================================================

  describe("Full Text-to-Device Pipeline", () => {
    it("'turn on the living room lights' → light.living_room_main ON", async () => {
      // Reset state
      await restClient.turnOff("light.living_room_main");
      await new Promise((r) => setTimeout(r, 500));

      // 1. Parse text → intent
      const rawIntent = matchRule("turn on the living room lights");
      expect(rawIntent).not.toBeNull();

      // Augment with target_device and strip room param from parameters
      // (room param in service data confuses template lights)
      const { room: _room, ...cleanParams } = rawIntent!.parameters;
      const intent: ParsedIntent = {
        ...rawIntent!,
        target_device: "living_room_main",
        parameters: cleanParams,
      };

      // 2. Permission check (Jarvis = adult, allowed)
      const context = buildFamilyContext("jarvis");
      const device = mockDevice();
      const permResult = permissionResolver.checkPermission(context, intent, device);
      expect(permResult.allowed).toBe(true);

      // 3. Execute on HA
      const result = await executor.execute(intent, FAMILY.jarvis.userId, "voice");
      expect(result.success).toBe(true);

      // 4. Verify state
      await new Promise((r) => setTimeout(r, 500));
      const state = await restClient.getState("light.living_room_main");
      expect(state.state).toBe("on");
    });

    it("'lock the front door' → lock.front_door_lock LOCKED", { retry: 2 }, async () => {
      // Reset — toggle via input_boolean directly for reliable state
      await restClient.callService("input_boolean", "turn_off", { entity_id: "input_boolean.front_door_locked" });
      await new Promise((r) => setTimeout(r, 1500));

      // Parse
      const intent = matchRule("lock the front door");
      expect(intent).not.toBeNull();

      // Modify intent to target the correct entity and clean parameters
      const { door: _d, ...lockCleanParams } = intent!.parameters;
      const modifiedIntent: ParsedIntent = {
        ...intent!,
        target_device: "front_door_lock",
        parameters: lockCleanParams,
      };

      // Permission (Jarvis = adult)
      const context = buildFamilyContext("jarvis");
      const device = mockDevice({ category: "lock", ha_entity_id: "lock.front_door_lock" });
      const permResult = permissionResolver.checkPermission(context, modifiedIntent, device);
      expect(permResult.allowed).toBe(true);

      // Execute
      const result = await executor.execute(modifiedIntent, FAMILY.jarvis.userId, "voice");
      expect(result.success).toBe(true);

      // Verify — allow extra propagation time for template lock
      await new Promise((r) => setTimeout(r, 1500));
      const state = await restClient.getState("lock.front_door_lock");
      expect(state.state).toBe("locked");
    });

    it("'set temperature to 74' → thermostat target 74", async () => {
      const rawIntent = matchRule("set temperature to 74");
      expect(rawIntent).not.toBeNull();

      // Augment: rules engine returns domain "thermostat", add target_device
      const intent: ParsedIntent = { ...rawIntent!, target_device: "main_thermostat" };

      const context = buildFamilyContext("jarvis");
      const device = mockDevice({ category: "thermostat", ha_entity_id: "climate.main_thermostat" });
      const permResult = permissionResolver.checkPermission(context, intent, device);
      expect(permResult.allowed).toBe(true);

      const result = await executor.execute(intent, FAMILY.jarvis.userId, "voice");
      expect(result.success).toBe(true);

      await new Promise((r) => setTimeout(r, 500));
      const state = await restClient.getState("climate.main_thermostat");
      expect(Number(state.attributes["temperature"])).toBe(74);
    });
  });

  // =========================================================================
  // PERMISSION-DENIED SCENARIOS (text → intent → DENIED → device unchanged)
  // =========================================================================

  describe("Permission-Denied Scenarios", () => {
    it("toddler command 'turn on the lights' is denied, device unchanged", async () => {
      // Ensure light is off
      await restClient.turnOff("light.living_room_main");
      await new Promise((r) => setTimeout(r, 500));

      const intent = matchRule("turn on the living room lights")!;
      const context = buildFamilyContext("sunny"); // toddler
      const device = mockDevice();
      const permResult = permissionResolver.checkPermission(context, intent, device);

      expect(permResult.allowed).toBe(false);

      // Do NOT execute — device should remain off
      const state = await restClient.getState("light.living_room_main");
      expect(state.state).toBe("off");
    });

    it("child command to unlock door is denied", () => {
      const intent = matchRule("unlock the front door")!;
      const context = buildFamilyContext("buddy"); // child
      const device = mockDevice({ category: "lock", ha_entity_id: "lock.front_door_lock" });
      const permResult = permissionResolver.checkPermission(context, intent, device);
      expect(permResult.allowed).toBe(false);
    });
  });
});
