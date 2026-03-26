/**
 * Home Assistant REST API client.
 *
 * Authenticates via long-lived access token, maps HA entity states to
 * our Device type, and provides typed methods for every service call
 * the platform needs (lights, locks, climate, media, covers, switches).
 */

import type {
  Device,
  DeviceId,
  DeviceCategory,
  DeviceState,
  TenantId,
  HACalendarEvent,
  HACalendarEventCreate,
} from "@clever/shared";
import { EMAIL_SEND_ENABLED } from "@clever/shared";

// ---------------------------------------------------------------------------
// HA REST data shapes
// ---------------------------------------------------------------------------

export interface HAEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context: { id: string; parent_id: string | null; user_id: string | null };
}

export interface HAConfig {
  latitude: number;
  longitude: number;
  elevation: number;
  unit_system: Record<string, string>;
  location_name: string;
  time_zone: string;
  version: string;
  components: string[];
  state: "RUNNING" | "NOT_RUNNING";
}

export interface HAServiceCallPayload {
  entity_id: string;
  [key: string]: unknown;
}

export interface HAAreaRegistryEntry {
  area_id: string;
  name: string;
  floor_id: string | null;
  aliases: string[];
}

export interface HAEntityRegistryEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
  name: string | null;
  original_name: string;
  platform: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface HARestClientConfig {
  /** Base URL of the Home Assistant instance (e.g. http://homeassistant.local:8123) */
  baseUrl: string;
  /** Long-lived access token generated from the HA user profile */
  token: string;
  /** Tenant this HA instance belongs to */
  tenantId: TenantId;
  /** Maximum number of retries on transient failures (default: 3) */
  maxRetries?: number;
  /** Base delay between retries in ms (default: 1000). Doubled on each retry. */
  retryBaseDelayMs?: number;
  /** Request timeout in ms (default: 10 000) */
  requestTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Derive DeviceCategory from an HA entity_id prefix. */
export function entityIdToCategory(entityId: string): DeviceCategory | null {
  const domain = entityId.split(".")[0];
  if (!domain) return null;

  const map: Record<string, DeviceCategory> = {
    light: "light",
    lock: "lock",
    climate: "climate",
    switch: "switch",
    sensor: "sensor",
    camera: "camera",
    cover: "cover",
    media_player: "media_player",
    fan: "fan",
    calendar: "calendar",
    // HA uses "climate" for thermostats; callers may also query "thermostat"
  };

  // IMAP / Outlook inbox sensors have specific naming patterns
  const suffix = entityId.split(".")[1] ?? "";
  if (
    domain === "sensor" &&
    (suffix.startsWith("imap_") ||
      suffix.startsWith("gmail_inbox") ||
      suffix.startsWith("outlook_inbox"))
  ) {
    return "email_sensor";
  }

  return map[domain] ?? null;
}

/** Map an HA entity state string to our canonical DeviceState. */
export function mapHAState(entityId: string, rawState: string): DeviceState {
  const domain = entityId.split(".")[0];

  if (domain === "lock") {
    return rawState === "locked" ? "locked" : "unlocked";
  }

  if (rawState === "on" || rawState === "playing" || rawState === "open") {
    return "on";
  }

  if (rawState === "off" || rawState === "idle" || rawState === "closed") {
    return "off";
  }

  if (rawState === "locked") return "locked";
  if (rawState === "unlocked") return "unlocked";

  return "unknown";
}

/** Extract a human-readable device name from HA attributes or entity_id. */
function friendlyName(entity: HAEntityState): string {
  if (typeof entity.attributes["friendly_name"] === "string") {
    return entity.attributes["friendly_name"];
  }
  // Fallback: "light.living_room_lamp" -> "Living Room Lamp"
  const suffix = entity.entity_id.split(".")[1] ?? entity.entity_id;
  return suffix
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class HARestClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly tenantId: TenantId;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly requestTimeoutMs: number;

  /** Cached area registry: area_id -> area info */
  private areaCache: Map<string, HAAreaRegistryEntry> = new Map();
  /** Cached entity registry: entity_id -> registry entry */
  private entityRegistryCache: Map<string, HAEntityRegistryEntry> = new Map();

  constructor(config: HARestClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.tenantId = config.tenantId;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 1_000;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 10_000;
  }

  // -----------------------------------------------------------------------
  // Low-level HTTP helpers
  // -----------------------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Execute an HTTP request with retries and exponential backoff.
   * Retries only on transient HTTP status codes and network errors.
   */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          this.requestTimeoutMs,
        );

        const res = await fetch(url, {
          method,
          headers: this.headers(),
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (res.ok) {
          return (await res.json()) as T;
        }

        // Non-retryable status -> fail immediately
        if (!RETRYABLE_STATUS_CODES.has(res.status)) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `HA API ${method} ${path} returned ${res.status}: ${text}`,
          );
        }

        lastError = new Error(
          `HA API ${method} ${path} returned ${res.status}`,
        );
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.startsWith("HA API") &&
          !err.message.includes("returned 5")
        ) {
          // Non-retryable application error — rethrow immediately
          throw err;
        }
        lastError =
          err instanceof Error ? err : new Error("Unknown fetch error");
      }

      if (attempt < this.maxRetries) {
        const delay = this.retryBaseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * delay * 0.3;
        await sleep(delay + jitter);
      }
    }

    throw new Error(
      `HA API ${method} ${path} failed after ${this.maxRetries + 1} attempts: ${lastError?.message}`,
    );
  }

  // -----------------------------------------------------------------------
  // Public REST endpoints
  // -----------------------------------------------------------------------

  /** GET /api/config -- returns the HA instance configuration. */
  async getConfig(): Promise<HAConfig> {
    return this.request<HAConfig>("GET", "/api/config");
  }

  /** GET /api/states -- list all entity states. */
  async getStates(): Promise<HAEntityState[]> {
    return this.request<HAEntityState[]>("GET", "/api/states");
  }

  /** GET /api/states/<entity_id> -- single entity state. */
  async getState(entityId: string): Promise<HAEntityState> {
    return this.request<HAEntityState>("GET", `/api/states/${entityId}`);
  }

  /**
   * POST /api/services/{domain}/{service} -- call a Home Assistant service.
   *
   * @param domain  e.g. "light", "lock", "climate"
   * @param service e.g. "turn_on", "turn_off", "lock", "set_temperature"
   * @param payload Service data including entity_id
   */
  async callService(
    domain: string,
    service: string,
    payload: HAServiceCallPayload,
  ): Promise<HAEntityState[]> {
    return this.request<HAEntityState[]>(
      "POST",
      `/api/services/${domain}/${service}`,
      payload,
    );
  }

  // -----------------------------------------------------------------------
  // Area & Entity Registry (used by device-discovery)
  // -----------------------------------------------------------------------

  /** Fetch the area registry via the REST API websocket-style template. */
  async getAreas(): Promise<HAAreaRegistryEntry[]> {
    const areas = await this.request<HAAreaRegistryEntry[]>(
      "GET",
      "/api/config/area_registry/list",
    ).catch(() => [] as HAAreaRegistryEntry[]);

    this.areaCache.clear();
    for (const area of areas) {
      this.areaCache.set(area.area_id, area);
    }
    return areas;
  }

  /** Fetch the entity registry. */
  async getEntityRegistry(): Promise<HAEntityRegistryEntry[]> {
    const entries = await this.request<HAEntityRegistryEntry[]>(
      "GET",
      "/api/config/entity_registry/list",
    ).catch(() => [] as HAEntityRegistryEntry[]);

    this.entityRegistryCache.clear();
    for (const entry of entries) {
      this.entityRegistryCache.set(entry.entity_id, entry);
    }
    return entries;
  }

  /** Return cached area name for an entity, or "Unknown". */
  getAreaForEntity(entityId: string): { room: string; floor: string } {
    const regEntry = this.entityRegistryCache.get(entityId);
    if (!regEntry?.area_id) {
      return { room: "Unknown", floor: "Unknown" };
    }
    const area = this.areaCache.get(regEntry.area_id);
    if (!area) {
      return { room: "Unknown", floor: "Unknown" };
    }
    return {
      room: area.name,
      floor: area.floor_id ?? "Unknown",
    };
  }

  // -----------------------------------------------------------------------
  // Device mapping
  // -----------------------------------------------------------------------

  /**
   * Map an HA entity state to our canonical Device interface.
   * Returns null if the entity domain is not a supported DeviceCategory.
   */
  mapEntityToDevice(entity: HAEntityState): Device | null {
    const category = entityIdToCategory(entity.entity_id);
    if (!category) return null;

    const { room, floor } = this.getAreaForEntity(entity.entity_id);

    return {
      id: entity.entity_id as unknown as DeviceId,
      tenant_id: this.tenantId,
      ha_entity_id: entity.entity_id,
      name: friendlyName(entity),
      category,
      room,
      floor,
      state: mapHAState(entity.entity_id, entity.state),
      attributes: { ...entity.attributes },
      is_online: entity.state !== "unavailable",
      last_seen: entity.last_updated,
      created_at: entity.last_changed,
      updated_at: entity.last_updated,
    };
  }

  /**
   * Convenience: fetch all states and return mapped Device objects for
   * every supported entity.
   */
  async getAllDevices(): Promise<Device[]> {
    await this.getAreas();
    await this.getEntityRegistry();

    const entities = await this.getStates();
    const devices: Device[] = [];

    for (const entity of entities) {
      const device = this.mapEntityToDevice(entity);
      if (device) {
        devices.push(device);
      }
    }

    return devices;
  }

  // -----------------------------------------------------------------------
  // Convenience service-call wrappers
  // -----------------------------------------------------------------------

  async turnOn(
    entityId: string,
    params?: Record<string, unknown>,
  ): Promise<HAEntityState[]> {
    const domain = entityId.split(".")[0] ?? "homeassistant";
    return this.callService(domain, "turn_on", {
      entity_id: entityId,
      ...params,
    });
  }

  async turnOff(entityId: string): Promise<HAEntityState[]> {
    const domain = entityId.split(".")[0] ?? "homeassistant";
    return this.callService(domain, "turn_off", { entity_id: entityId });
  }

  async lockEntity(entityId: string): Promise<HAEntityState[]> {
    return this.callService("lock", "lock", { entity_id: entityId });
  }

  async unlockEntity(entityId: string): Promise<HAEntityState[]> {
    return this.callService("lock", "unlock", { entity_id: entityId });
  }

  async setTemperature(
    entityId: string,
    temperature: number,
    hvacMode?: string,
  ): Promise<HAEntityState[]> {
    const payload: HAServiceCallPayload = {
      entity_id: entityId,
      temperature,
    };
    if (hvacMode) {
      payload["hvac_mode"] = hvacMode;
    }
    return this.callService("climate", "set_temperature", payload);
  }

  async setBrightness(
    entityId: string,
    brightnessPct: number,
  ): Promise<HAEntityState[]> {
    return this.callService("light", "turn_on", {
      entity_id: entityId,
      brightness_pct: brightnessPct,
    });
  }

  async setColor(
    entityId: string,
    rgb: [number, number, number],
  ): Promise<HAEntityState[]> {
    return this.callService("light", "turn_on", {
      entity_id: entityId,
      rgb_color: rgb,
    });
  }

  async setHvacMode(
    entityId: string,
    mode: string,
  ): Promise<HAEntityState[]> {
    return this.callService("climate", "set_hvac_mode", {
      entity_id: entityId,
      hvac_mode: mode,
    });
  }

  async openCover(entityId: string): Promise<HAEntityState[]> {
    return this.callService("cover", "open_cover", { entity_id: entityId });
  }

  async closeCover(entityId: string): Promise<HAEntityState[]> {
    return this.callService("cover", "close_cover", { entity_id: entityId });
  }

  async mediaPlay(entityId: string): Promise<HAEntityState[]> {
    return this.callService("media_player", "media_play", {
      entity_id: entityId,
    });
  }

  async mediaPause(entityId: string): Promise<HAEntityState[]> {
    return this.callService("media_player", "media_pause", {
      entity_id: entityId,
    });
  }

  async mediaSetVolume(
    entityId: string,
    volumeLevel: number,
  ): Promise<HAEntityState[]> {
    return this.callService("media_player", "volume_set", {
      entity_id: entityId,
      volume_level: volumeLevel,
    });
  }

  async playTts(
    entityId: string,
    message: string,
    engine?: string,
  ): Promise<HAEntityState[]> {
    return this.callService("tts", "speak", {
      entity_id: entityId,
      message,
      ...(engine ? { engine } : {}),
    });
  }

  /**
   * Open a URL in a Samsung Smart TV's built-in browser.
   * Uses the media_player.play_media service with content_type "url".
   * Works on Samsung TVs integrated via the samsungtv component.
   */
  async openTVBrowser(
    entityId: string,
    url: string,
  ): Promise<HAEntityState[]> {
    return this.callService("media_player", "play_media", {
      entity_id: entityId,
      media_content_type: "url",
      media_content_id: url,
    });
  }

  // -----------------------------------------------------------------------
  // Calendar service wrappers (HA Calendar API)
  // -----------------------------------------------------------------------

  /**
   * GET /api/calendars/{entity_id}?start={iso}&end={iso}
   * Returns events within the given time range for a calendar entity.
   */
  async getCalendarEvents(
    entityId: string,
    start: string,
    end: string,
  ): Promise<HACalendarEvent[]> {
    const params = new URLSearchParams({ start, end });
    return this.request<HACalendarEvent[]>(
      "GET",
      `/api/calendars/${entityId}?${params.toString()}`,
    );
  }

  /**
   * POST /api/services/calendar/create_event
   * Creates a new event on the specified calendar.
   */
  async createCalendarEvent(event: HACalendarEventCreate): Promise<void> {
    await this.callService("calendar", "create_event", {
      entity_id: event.entity_id,
      summary: event.summary,
      ...(event.start_date_time ? { start_date_time: event.start_date_time } : {}),
      ...(event.end_date_time ? { end_date_time: event.end_date_time } : {}),
      ...(event.start_date ? { start_date: event.start_date } : {}),
      ...(event.end_date ? { end_date: event.end_date } : {}),
      ...(event.description ? { description: event.description } : {}),
      ...(event.location ? { location: event.location } : {}),
    });
  }

  // -----------------------------------------------------------------------
  // Email service wrappers (GATED BY EMAIL_SEND_ENABLED)
  // -----------------------------------------------------------------------

  /**
   * Send an email via the Microsoft 365 (o365) HA integration.
   * HARD-GATED: throws immediately if EMAIL_SEND_ENABLED is false.
   */
  async sendOutlookEmail(
    account: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<void> {
    if (!EMAIL_SEND_ENABLED) {
      throw new Error(
        "Email sending is disabled. Change EMAIL_SEND_ENABLED in feature-flags.ts, rebuild, and redeploy to enable.",
      );
    }
    await this.callService("o365", "send_email", {
      entity_id: account,
      subject,
      body,
      target: to,
    });
  }

  /**
   * Send an email via the SMTP notify platform (Gmail).
   * HARD-GATED: throws immediately if EMAIL_SEND_ENABLED is false.
   */
  async sendGmailEmail(
    notifyService: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<void> {
    if (!EMAIL_SEND_ENABLED) {
      throw new Error(
        "Email sending is disabled. Change EMAIL_SEND_ENABLED in feature-flags.ts, rebuild, and redeploy to enable.",
      );
    }
    // notify services use POST /api/services/notify/{service_name}
    const serviceName = notifyService.replace("notify.", "");
    await this.callService("notify", serviceName, {
      entity_id: notifyService,
      message: body,
      title: subject,
      target: to,
    });
  }

  /** Health-check: returns true if HA is reachable and running. */
  async isHealthy(): Promise<boolean> {
    try {
      const config = await this.getConfig();
      return config.state === "RUNNING";
    } catch {
      return false;
    }
  }
}
