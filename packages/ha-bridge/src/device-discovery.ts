/**
 * Device auto-discovery.
 *
 * Scans all HA entities, maps entity_id patterns to DeviceCategory,
 * extracts room/floor from the area registry, and syncs the canonical
 * Device records to Supabase via a backend client interface.
 */

import type {
  Device,
  DeviceId,
  DeviceCategory,
  TenantId,
} from "@clever/shared";
import { HARestClient, entityIdToCategory } from "./rest-client.js";
import type { HAEntityState } from "./rest-client.js";

// ---------------------------------------------------------------------------
// Backend client interface -- decoupled from Supabase implementation
// ---------------------------------------------------------------------------

/**
 * Abstraction for persisting device records. The pi-agent injects a
 * concrete Supabase-backed implementation at runtime.
 */
export interface DeviceStore {
  /** Return all devices known to the backend for this tenant. */
  listDevices(tenantId: TenantId): Promise<Device[]>;
  /** Insert or update a device record. */
  upsertDevice(device: Device): Promise<void>;
  /** Remove a device that no longer exists in HA. */
  removeDevice(deviceId: DeviceId, tenantId: TenantId): Promise<void>;
}

// ---------------------------------------------------------------------------
// Discovery configuration
// ---------------------------------------------------------------------------

export interface DeviceDiscoveryConfig {
  /** HA REST client instance. */
  haClient: HARestClient;
  /** Backend device store. */
  store: DeviceStore;
  /** Tenant that owns all discovered devices. */
  tenantId: TenantId;
  /** Entity domain prefixes to include. Defaults to all supported categories. */
  includeDomains?: string[];
  /** Entity IDs to explicitly exclude (e.g. internal sensors). */
  excludeEntityIds?: string[];
  /** Polling interval in ms for periodic re-scan (default: 60 000). */
  pollIntervalMs?: number;
}

/** Result of a single discovery run. */
export interface DiscoveryResult {
  added: Device[];
  updated: Device[];
  removed: DeviceId[];
  unchanged: number;
  totalEntities: number;
  totalSupported: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INCLUDE_DOMAINS: string[] = [
  "light",
  "lock",
  "climate",
  "switch",
  "sensor",
  "camera",
  "cover",
  "media_player",
  "fan",
  "calendar",
];

// ---------------------------------------------------------------------------
// Discovery service
// ---------------------------------------------------------------------------

export class DeviceDiscovery {
  private readonly haClient: HARestClient;
  private readonly store: DeviceStore;
  private readonly tenantId: TenantId;
  private readonly includeDomains: Set<string>;
  private readonly excludeEntityIds: Set<string>;
  private readonly pollIntervalMs: number;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: DeviceDiscoveryConfig) {
    this.haClient = config.haClient;
    this.store = config.store;
    this.tenantId = config.tenantId;
    this.includeDomains = new Set(
      config.includeDomains ?? DEFAULT_INCLUDE_DOMAINS,
    );
    this.excludeEntityIds = new Set(config.excludeEntityIds ?? []);
    this.pollIntervalMs = config.pollIntervalMs ?? 60_000;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Run a single discovery scan: fetch all HA entities, diff against
   * Supabase records, and upsert/remove as needed.
   */
  async scan(): Promise<DiscoveryResult> {
    const start = Date.now();

    // 1. Populate area and entity registry caches
    await this.haClient.getAreas();
    await this.haClient.getEntityRegistry();

    // 2. Fetch current HA entities
    const allEntities = await this.haClient.getStates();

    // 3. Filter to supported domains and non-excluded entities
    const supported = allEntities.filter((e) => this.isSupported(e));

    // 4. Map to Device objects
    const haDevices = new Map<string, Device>();
    for (const entity of supported) {
      const device = this.haClient.mapEntityToDevice(entity);
      if (device) {
        haDevices.set(device.ha_entity_id, device);
      }
    }

    // 5. Load existing devices from Supabase
    const existingDevices = await this.store.listDevices(this.tenantId);
    const existingMap = new Map<string, Device>();
    for (const d of existingDevices) {
      existingMap.set(d.ha_entity_id, d);
    }

    // 6. Diff
    const added: Device[] = [];
    const updated: Device[] = [];
    let unchanged = 0;

    for (const [entityId, haDevice] of haDevices) {
      const existing = existingMap.get(entityId);
      if (!existing) {
        added.push(haDevice);
      } else if (this.hasDeviceChanged(existing, haDevice)) {
        // Preserve the original DB id
        const merged: Device = { ...haDevice, id: existing.id };
        updated.push(merged);
      } else {
        unchanged += 1;
      }
    }

    // Devices in Supabase that no longer exist in HA
    const removed: DeviceId[] = [];
    for (const [entityId, existing] of existingMap) {
      if (!haDevices.has(entityId)) {
        removed.push(existing.id);
      }
    }

    // 7. Persist changes
    const upsertPromises: Promise<void>[] = [];
    for (const device of [...added, ...updated]) {
      upsertPromises.push(this.store.upsertDevice(device));
    }
    const removePromises: Promise<void>[] = [];
    for (const deviceId of removed) {
      removePromises.push(this.store.removeDevice(deviceId, this.tenantId));
    }
    await Promise.all([...upsertPromises, ...removePromises]);

    return {
      added,
      updated,
      removed,
      unchanged,
      totalEntities: allEntities.length,
      totalSupported: supported.length,
      durationMs: Date.now() - start,
    };
  }

  /** Start periodic discovery scans. */
  startPolling(): void {
    if (this.running) return;
    this.running = true;

    // Run an initial scan immediately
    void this.scan().catch((err) => {
      console.error("[DeviceDiscovery] Initial scan failed:", err);
    });

    this.pollTimer = setInterval(() => {
      void this.scan().catch((err) => {
        console.error("[DeviceDiscovery] Poll scan failed:", err);
      });
    }, this.pollIntervalMs);
  }

  /** Stop periodic scanning. */
  stopPolling(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /** Check if an entity should be included in discovery. */
  private isSupported(entity: HAEntityState): boolean {
    if (this.excludeEntityIds.has(entity.entity_id)) return false;

    const domain = entity.entity_id.split(".")[0];
    if (!domain) return false;

    return this.includeDomains.has(domain);
  }

  /** Determine whether a device's state or metadata has changed. */
  private hasDeviceChanged(existing: Device, incoming: Device): boolean {
    return (
      existing.state !== incoming.state ||
      existing.name !== incoming.name ||
      existing.room !== incoming.room ||
      existing.floor !== incoming.floor ||
      existing.is_online !== incoming.is_online ||
      existing.category !== incoming.category
    );
  }
}

// ---------------------------------------------------------------------------
// Utility: map entity domain to category (re-exported for convenience)
// ---------------------------------------------------------------------------

export { entityIdToCategory };
