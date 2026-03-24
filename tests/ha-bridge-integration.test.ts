/**
 * HA-Bridge Integration Test
 *
 * Tests the full pipeline against a live local Home Assistant instance:
 *   REST client → device discovery → command execution → state verification
 *
 * Prerequisites:
 *   - Home Assistant running at http://127.0.0.1:8123
 *   - Virtual devices configured (template lights, lock, climate, media player)
 *   - HA_URL and HA_LONG_LIVED_TOKEN env vars set
 *
 * Run: HA_URL=http://127.0.0.1:8123 HA_LONG_LIVED_TOKEN=<token> npx vitest run tests/ha-bridge-integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  HARestClient,
  HAWebSocketClient,
  CommandExecutor,
  DeviceDiscovery,
  mapHAState,
} from "../packages/ha-bridge/src/index.js";
import type {
  DeviceResolver,
  DeviceStore,
  HAEntityState,
} from "../packages/ha-bridge/src/index.js";
import type {
  Device,
  DeviceId,
  DeviceState,
  TenantId,
  UserId,
  ParsedIntent,
} from "../packages/shared/src/index.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HA_URL = process.env["HA_URL"] || "http://127.0.0.1:8123";
const HA_TOKEN = process.env["HA_LONG_LIVED_TOKEN"] || "";
const TENANT_ID = "a0000000-0000-4000-8000-000000000001" as TenantId;
const USER_ID = "b0000000-0000-4000-8000-000000000001" as UserId;

// Skip the entire suite if no HA token is provided
const HA_AVAILABLE = !!HA_TOKEN;

// ---------------------------------------------------------------------------
// In-memory DeviceStore & DeviceResolver for testing
// (no Supabase dependency — we resolve directly from HA entity states)
// ---------------------------------------------------------------------------

class InMemoryDeviceStore implements DeviceStore {
  private devices: Map<string, Device> = new Map();

  async listDevices(_tenantId: TenantId): Promise<Device[]> {
    return Array.from(this.devices.values());
  }

  async upsertDevice(device: Device): Promise<void> {
    this.devices.set(device.ha_entity_id, device);
  }

  async removeDevice(deviceId: DeviceId, _tenantId: TenantId): Promise<void> {
    for (const [key, dev] of this.devices) {
      if (dev.id === deviceId) {
        this.devices.delete(key);
        break;
      }
    }
  }

  getByEntityId(entityId: string): Device | undefined {
    return this.devices.get(entityId);
  }
}

class InMemoryDeviceResolver implements DeviceResolver {
  constructor(private store: InMemoryDeviceStore) {}

  async resolveDevice(
    name: string,
    room?: string,
    _tenantId?: TenantId,
  ): Promise<Device | null> {
    const devices = await this.store.listDevices(TENANT_ID);
    const lowerName = name.toLowerCase().replace(/\s+/g, "_");

    // Try exact entity ID match first (domain.name)
    const byExactEntity = devices.find(
      (d) => d.ha_entity_id.toLowerCase() === lowerName ||
        d.ha_entity_id.toLowerCase().endsWith("." + lowerName),
    );
    if (byExactEntity) return byExactEntity;

    // Try entity ID segment match (prefer longer/more specific matches)
    const candidates = devices
      .filter((d) => {
        const entityName = d.ha_entity_id.split(".")[1] || "";
        const nameMatch = entityName.includes(lowerName) ||
          d.name.toLowerCase().includes(name.toLowerCase());
        const roomMatch = room
          ? d.room.toLowerCase().includes(room.toLowerCase())
          : true;
        return nameMatch && roomMatch;
      })
      // Sort by entity ID length descending to prefer more specific matches
      // e.g., "lock.front_door_lock" over "lock.front_door" for "front_door"
      .sort((a, b) => b.ha_entity_id.length - a.ha_entity_id.length);

    return candidates[0] ?? null;
  }

  async resolveRoom(
    room: string,
    _tenantId?: TenantId,
  ): Promise<Device[]> {
    const devices = await this.store.listDevices(TENANT_ID);
    return devices.filter((d) =>
      d.room.toLowerCase().includes(room.toLowerCase()),
    );
  }

  async resolveCategory(
    category: string,
    _tenantId?: TenantId,
  ): Promise<Device[]> {
    const devices = await this.store.listDevices(TENANT_ID);
    return devices.filter((d) => d.category === category);
  }
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe.skipIf(!HA_AVAILABLE)("HA-Bridge Integration (Live HA)", () => {
  let restClient: HARestClient;
  let wsClient: HAWebSocketClient;
  let store: InMemoryDeviceStore;
  let resolver: InMemoryDeviceResolver;
  let executor: CommandExecutor;

  beforeAll(async () => {
    restClient = new HARestClient({
      baseUrl: HA_URL,
      token: HA_TOKEN,
      tenantId: TENANT_ID,
    });

    wsClient = new HAWebSocketClient({
      url: HA_URL.replace("http", "ws") + "/api/websocket",
      token: HA_TOKEN,
      tenantId: TENANT_ID,
    });

    store = new InMemoryDeviceStore();
    resolver = new InMemoryDeviceResolver(store);

    executor = new CommandExecutor({
      haClient: restClient,
      resolver,
      tenantId: TENANT_ID,
    });
  });

  afterAll(async () => {
    if (wsClient?.connected) {
      wsClient.disconnect();
    }
  });

  // =========================================================================
  // REST CLIENT
  // =========================================================================

  describe("REST Client", () => {
    it("health check returns true", async () => {
      const healthy = await restClient.isHealthy();
      expect(healthy).toBe(true);
    });

    it("fetches HA config", async () => {
      const config = await restClient.getConfig();
      expect(config).toBeDefined();
      expect(config.state).toBe("RUNNING");
      expect(config.version).toBeDefined();
    });

    it("fetches all entity states", async () => {
      const states = await restClient.getStates();
      expect(states.length).toBeGreaterThan(0);

      // Our virtual devices should be present
      const entityIds = states.map((s) => s.entity_id);
      expect(entityIds).toContain("light.living_room_main");
      expect(entityIds).toContain("light.master_bedroom");
      expect(entityIds).toContain("lock.front_door_lock");
      expect(entityIds).toContain("climate.main_thermostat");
    });

    it("fetches a single entity state", async () => {
      const state = await restClient.getState("light.living_room_main");
      expect(state).toBeDefined();
      expect(state.entity_id).toBe("light.living_room_main");
      expect(["on", "off"]).toContain(state.state);
    });

    it("maps HA states to canonical DeviceState", () => {
      // mapHAState takes (entityId, rawState)
      expect(mapHAState("light.test", "on")).toBe("on");
      expect(mapHAState("light.test", "off")).toBe("off");
      expect(mapHAState("lock.test", "locked")).toBe("locked");
      expect(mapHAState("lock.test", "unlocked")).toBe("unlocked");
      expect(mapHAState("media_player.test", "playing")).toBe("on");
      expect(mapHAState("media_player.test", "idle")).toBe("off");
      expect(mapHAState("sensor.test", "unavailable")).toBe("unknown");
    });
  });

  // =========================================================================
  // DEVICE DISCOVERY
  // =========================================================================

  describe("Device Discovery", () => {
    it("discovers virtual devices from HA", async () => {
      const discovery = new DeviceDiscovery({
        haClient: restClient,
        store,
        tenantId: TENANT_ID,
        includeDomains: ["light", "lock", "climate", "media_player", "switch", "fan"],
      });

      const result = await discovery.scan();

      expect(result.totalEntities).toBeGreaterThan(0);
      expect(result.totalSupported).toBeGreaterThan(0);
      expect(result.added.length).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThan(0);

      // Verify our key devices were discovered
      const allDevices = await store.listDevices(TENANT_ID);
      const entityIds = allDevices.map((d) => d.ha_entity_id);

      expect(entityIds).toContain("light.living_room_main");
      expect(entityIds).toContain("light.master_bedroom");
      expect(entityIds).toContain("lock.front_door_lock");
      expect(entityIds).toContain("climate.main_thermostat");
    });

    it("discovered devices have correct categories", async () => {
      const light = store.getByEntityId("light.living_room_main");
      expect(light?.category).toBe("light");

      const lock = store.getByEntityId("lock.front_door_lock");
      expect(lock?.category).toBe("lock");

      const climate = store.getByEntityId("climate.main_thermostat");
      expect(climate?.category).toMatch(/climate|thermostat/);
    });

    it("discovered devices are marked as online", async () => {
      const light = store.getByEntityId("light.living_room_main");
      expect(light?.is_online).toBe(true);
    });
  });

  // =========================================================================
  // COMMAND EXECUTION — LIGHTS
  // =========================================================================

  describe("Command Execution — Lights", () => {
    it("turns on the living room light", async () => {
      // Ensure it starts off
      await restClient.turnOff("light.living_room_main");
      await new Promise((r) => setTimeout(r, 500));

      const intent: ParsedIntent = {
        domain: "light",
        action: "turn_on",
        target_device: "living_room_main",
        parameters: {},
        confidence: 0.95,
        raw_transcript: "turn on the living room light",
      };

      const result = await executor.execute(intent, USER_ID, "voice");

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.permissionDenied).toBeFalsy();

      // Verify state changed in HA
      await new Promise((r) => setTimeout(r, 500));
      const state = await restClient.getState("light.living_room_main");
      expect(state.state).toBe("on");
    });

    it("turns off the living room light", async () => {
      // Ensure it starts on
      await restClient.turnOn("light.living_room_main");
      await new Promise((r) => setTimeout(r, 500));

      const intent: ParsedIntent = {
        domain: "light",
        action: "turn_off",
        target_device: "living_room_main",
        parameters: {},
        confidence: 0.9,
        raw_transcript: "turn off the living room light",
      };

      const result = await executor.execute(intent, USER_ID, "voice");

      expect(result.success).toBe(true);

      await new Promise((r) => setTimeout(r, 500));
      const state = await restClient.getState("light.living_room_main");
      expect(state.state).toBe("off");
    });

    it("sets brightness on the bedroom light", async () => {
      // Template lights in HA need turn_on first, then set_level separately
      // Or use turn_on without brightness_pct (template lights don't support it inline)
      const intent: ParsedIntent = {
        domain: "light",
        action: "turn_on",
        target_device: "master_bedroom",
        parameters: {},
        confidence: 0.88,
        raw_transcript: "turn on the bedroom light",
      };

      const result = await executor.execute(intent, USER_ID, "voice");

      expect(result.success).toBe(true);

      await new Promise((r) => setTimeout(r, 500));
      const state = await restClient.getState("light.master_bedroom");
      expect(state.state).toBe("on");

      // Now set brightness directly
      await restClient.setBrightness("light.master_bedroom", 60);
      await new Promise((r) => setTimeout(r, 500));
      const updated = await restClient.getState("light.master_bedroom");
      expect(updated.attributes["brightness"]).toBeDefined();
    });
  });

  // =========================================================================
  // COMMAND EXECUTION — LOCK
  // =========================================================================

  describe("Command Execution — Lock", () => {
    it("unlocks the front door", async () => {
      // Ensure locked first
      await restClient.callService("lock", "lock", {
        entity_id: "lock.front_door_lock",
      });
      await new Promise((r) => setTimeout(r, 1500));

      // Verify the lock is actually in "locked" state before proceeding
      const preState = await restClient.getState("lock.front_door_lock");
      expect(preState.state).toBe("locked");

      // Use exact entity_id to avoid resolving to the demo lock.front_door
      const intent: ParsedIntent = {
        domain: "lock",
        action: "unlock",
        target_device: "front_door_lock",
        parameters: {},
        confidence: 0.92,
        raw_transcript: "unlock the front door",
      };

      const result = await executor.execute(intent, USER_ID, "voice");

      expect(result.success).toBe(true);

      await new Promise((r) => setTimeout(r, 1000));
      const state = await restClient.getState("lock.front_door_lock");
      expect(state.state).toBe("unlocked");
    });

    it("locks the front door", async () => {
      // Ensure unlocked first
      await restClient.callService("lock", "unlock", {
        entity_id: "lock.front_door_lock",
      });
      await new Promise((r) => setTimeout(r, 1000));

      const intent: ParsedIntent = {
        domain: "lock",
        action: "lock",
        target_device: "front_door_lock",
        parameters: {},
        confidence: 0.95,
        raw_transcript: "lock the front door",
      };

      const result = await executor.execute(intent, USER_ID, "voice");

      expect(result.success).toBe(true);

      await new Promise((r) => setTimeout(r, 1000));
      const state = await restClient.getState("lock.front_door_lock");
      expect(state.state).toBe("locked");
    });
  });

  // =========================================================================
  // COMMAND EXECUTION — CLIMATE
  // =========================================================================

  describe("Command Execution — Climate", () => {
    it("sets the thermostat temperature", async () => {
      const intent: ParsedIntent = {
        domain: "climate",
        action: "set_temperature",
        target_device: "main_thermostat",
        parameters: { temperature: 74 },
        confidence: 0.91,
        raw_transcript: "set the thermostat to 74 degrees",
      };

      const result = await executor.execute(intent, USER_ID, "voice");

      expect(result.success).toBe(true);

      await new Promise((r) => setTimeout(r, 500));
      const state = await restClient.getState("climate.main_thermostat");
      expect(Number(state.attributes["temperature"])).toBe(74);
    });
  });

  // =========================================================================
  // WEBSOCKET — REAL-TIME STATE CHANGES
  // =========================================================================

  describe("WebSocket Real-Time Events", () => {
    it("connects and authenticates", async () => {
      await wsClient.connect();

      // Give it a moment to authenticate
      await new Promise((r) => setTimeout(r, 2000));

      expect(wsClient.connected).toBe(true);
    });

    it("receives state_changed events when a device is toggled", async () => {
      if (!wsClient.connected) {
        await wsClient.connect();
        await new Promise((r) => setTimeout(r, 2000));
      }

      const stateChanges: Array<{ entityId: string; newState: string }> = [];

      const handler = (event: { entityId: string; newState: DeviceState }) => {
        if (event.entityId === "light.living_room_main") {
          stateChanges.push({
            entityId: event.entityId,
            newState: event.newState,
          });
        }
      };

      wsClient.on("state_changed", handler);

      // Toggle the light
      await restClient.turnOn("light.living_room_main");
      await new Promise((r) => setTimeout(r, 1500));
      await restClient.turnOff("light.living_room_main");
      await new Promise((r) => setTimeout(r, 1500));

      wsClient.off("state_changed", handler);

      // Should have received at least 1 state change for our entity
      // (input_boolean changes may also fire; we filter to our entity)
      expect(stateChanges.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // COMMAND EXECUTION — ERROR HANDLING
  // =========================================================================

  describe("Command Execution — Edge Cases", () => {
    it("returns error for non-existent device", async () => {
      const intent: ParsedIntent = {
        domain: "light",
        action: "turn_on",
        target_device: "nonexistent_device_xyz",
        parameters: {},
        confidence: 0.95,
        raw_transcript: "turn on the nonexistent device",
      };

      const result = await executor.execute(intent, USER_ID, "voice");

      // Should either fail or return an error
      expect(result.success === false || result.errors.length > 0).toBe(true);
    });

    it("handles low confidence gracefully", async () => {
      const intent: ParsedIntent = {
        domain: "light",
        action: "turn_on",
        target_device: "living_room_main",
        parameters: {},
        confidence: 0.3, // Below 0.7 threshold
        raw_transcript: "mumble mumble light",
      };

      // Low confidence commands should still execute via executor
      // (confidence gating happens at the pipeline level, not executor)
      const result = await executor.execute(intent, USER_ID, "voice");
      expect(result).toBeDefined();
    });
  });

  // =========================================================================
  // FULL PIPELINE ROUND-TRIP
  // =========================================================================

  describe("Full Pipeline Round-Trip", () => {
    it("voice intent → resolve device → execute → verify state → audit record", async () => {
      // 1. Start with light OFF
      await restClient.turnOff("light.living_room_main");
      await new Promise((r) => setTimeout(r, 500));

      const beforeState = await restClient.getState("light.living_room_main");
      expect(beforeState.state).toBe("off");

      // 2. Simulate voice intent (no brightness_pct — template lights don't support inline)
      const intent: ParsedIntent = {
        domain: "light",
        action: "turn_on",
        target_device: "living_room_main",
        parameters: {},
        confidence: 0.95,
        raw_transcript: "turn on the living room light",
      };

      // 3. Execute via command executor (resolves device, calls HA)
      const result = await executor.execute(intent, USER_ID, "voice");

      // 4. Verify execution succeeded
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.durationMs).toBeLessThan(5000);
      expect(result.permissionDenied).toBeFalsy();

      // 5. Verify audit records
      expect(result.stateChanges.length).toBeGreaterThanOrEqual(1);
      const change = result.stateChanges[0];
      expect(change).toBeDefined();
      if (change) {
        expect(change.source).toBe("voice");
        expect(change.changed_by).toBe(USER_ID);
        expect(change.timestamp).toBeDefined();
      }

      // 6. Verify HA state changed
      await new Promise((r) => setTimeout(r, 500));
      const afterState = await restClient.getState("light.living_room_main");
      expect(afterState.state).toBe("on");
    });
  });
});
