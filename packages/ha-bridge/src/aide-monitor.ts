/**
 * CleverAide Inactivity & Activity Monitor
 *
 * Subscribes to Home Assistant motion/door sensor events via WebSocket
 * and tracks activity patterns for assisted living users. Creates alerts
 * when inactivity exceeds configured thresholds or routines deviate.
 *
 * Runs on the Pi hub alongside the main HA WebSocket client.
 */

import type { TenantId } from "@clever/shared";
import type { INACTIVITY_THRESHOLD_MINUTES } from "@clever/shared";
import type { HAWebSocketClient, DeviceStateChangedEvent } from "./websocket-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AideMonitorConfig {
  tenantId: TenantId;
  /** HA WebSocket client to subscribe to events */
  wsClient: HAWebSocketClient;
  /** Callback to log activity events to the database */
  onActivityEvent: (event: AideActivityLogEntry) => Promise<void>;
  /** Callback to create a caregiver alert */
  onAlert: (alert: AideCaregiverAlertEntry) => Promise<void>;
  /** Interval to check for inactivity (ms). Default: 60000 (1 minute) */
  checkIntervalMs?: number;
  /** Inactivity threshold in minutes during waking hours. Default: 120 */
  inactivityThresholdMinutes?: number;
  /** Waking hours range [start, end] in 24h format. Default: [7, 22] */
  wakingHours?: [number, number];
}

export interface AideActivityLogEntry {
  tenant_id: TenantId;
  aide_profile_id: string;
  event_type: string;
  room: string | null;
  sensor_entity_id: string | null;
  details: Record<string, unknown>;
}

export interface AideCaregiverAlertEntry {
  tenant_id: TenantId;
  aide_profile_id: string;
  alert_type: string;
  severity: string;
  message: string;
  details: Record<string, unknown>;
  delivery_channels: string[];
}

// ---------------------------------------------------------------------------
// Per-profile tracking state
// ---------------------------------------------------------------------------

interface ProfileTracker {
  aideProfileId: string;
  /** Entity IDs of motion sensors in the user's home */
  motionSensorIds: Set<string>;
  /** Entity IDs of door sensors */
  doorSensorIds: Set<string>;
  /** Last motion timestamp per room */
  lastMotionPerRoom: Map<string, number>;
  /** Last motion timestamp anywhere */
  lastMotionAnywhere: number;
  /** Whether an inactivity alert has been sent (reset on motion) */
  inactivityAlertSent: boolean;
}

// ---------------------------------------------------------------------------
// Aide Monitor
// ---------------------------------------------------------------------------

export class AideMonitor {
  private readonly config: AideMonitorConfig;
  private readonly profiles: Map<string, ProfileTracker> = new Map();
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: AideMonitorConfig) {
    this.config = config;
  }

  /**
   * Register an assisted living profile for monitoring.
   * Call this when an aide profile is loaded or created.
   */
  registerProfile(
    aideProfileId: string,
    motionSensorIds: string[],
    doorSensorIds: string[],
  ): void {
    this.profiles.set(aideProfileId, {
      aideProfileId,
      motionSensorIds: new Set(motionSensorIds),
      doorSensorIds: new Set(doorSensorIds),
      lastMotionPerRoom: new Map(),
      lastMotionAnywhere: Date.now(),
      inactivityAlertSent: false,
    });
  }

  /** Remove a profile from monitoring. */
  unregisterProfile(aideProfileId: string): void {
    this.profiles.delete(aideProfileId);
  }

  /** Start listening to HA events and checking for inactivity. */
  start(): void {
    // Subscribe to state change events from the HA WebSocket client
    this.config.wsClient.on("state_changed", (event: DeviceStateChangedEvent) => {
      this.handleStateChange(event);
    });

    // Start periodic inactivity check
    const interval = this.config.checkIntervalMs ?? 60_000;
    this.checkInterval = setInterval(() => {
      this.checkInactivity();
    }, interval);
  }

  /** Stop monitoring. */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // -----------------------------------------------------------------------
  // Event handling
  // -----------------------------------------------------------------------

  private handleStateChange(event: DeviceStateChangedEvent): void {
    for (const [, tracker] of this.profiles) {
      const entityId = event.entityId;

      // Motion sensor triggered
      if (tracker.motionSensorIds.has(entityId) && event.newState === "on") {
        const room = this.extractRoom(event);
        tracker.lastMotionAnywhere = Date.now();
        tracker.lastMotionPerRoom.set(room, Date.now());
        tracker.inactivityAlertSent = false;

        // Log the motion event
        this.config.onActivityEvent({
          tenant_id: this.config.tenantId,
          aide_profile_id: tracker.aideProfileId,
          event_type: "motion_detected",
          room,
          sensor_entity_id: entityId,
          details: {},
        });
      }

      // Door sensor changed
      if (tracker.doorSensorIds.has(entityId)) {
        const room = this.extractRoom(event);
        const eventType = event.newState === "on" ? "door_opened" : "door_closed";
        tracker.lastMotionAnywhere = Date.now();

        this.config.onActivityEvent({
          tenant_id: this.config.tenantId,
          aide_profile_id: tracker.aideProfileId,
          event_type: eventType,
          room,
          sensor_entity_id: entityId,
          details: {},
        });
      }
    }
  }

  private checkInactivity(): void {
    const now = Date.now();
    const currentHour = new Date().getHours();
    const [wakingStart, wakingEnd] = this.config.wakingHours ?? [7, 22];

    // Only check during waking hours
    if (currentHour < wakingStart || currentHour >= wakingEnd) return;

    const thresholdMs =
      (this.config.inactivityThresholdMinutes ?? 120) * 60 * 1000;

    for (const [, tracker] of this.profiles) {
      const elapsed = now - tracker.lastMotionAnywhere;

      if (elapsed >= thresholdMs && !tracker.inactivityAlertSent) {
        tracker.inactivityAlertSent = true;

        const elapsedMinutes = Math.round(elapsed / 60_000);

        this.config.onAlert({
          tenant_id: this.config.tenantId,
          aide_profile_id: tracker.aideProfileId,
          alert_type: "inactivity",
          severity: "warning",
          message: `No activity detected for ${elapsedMinutes} minutes during waking hours.`,
          details: {
            last_motion_at: new Date(tracker.lastMotionAnywhere).toISOString(),
            elapsed_minutes: elapsedMinutes,
          },
          delivery_channels: ["push", "telegram", "whatsapp"],
        });

        // Also log the event
        this.config.onActivityEvent({
          tenant_id: this.config.tenantId,
          aide_profile_id: tracker.aideProfileId,
          event_type: "no_motion_alert",
          room: null,
          sensor_entity_id: null,
          details: {
            elapsed_minutes: elapsedMinutes,
          },
        });
      }
    }
  }

  private extractRoom(event: DeviceStateChangedEvent): string {
    // Use the device's room attribute, or extract from entity_id
    const attrs = event.attributes;
    if (typeof attrs["friendly_name"] === "string") {
      // Common HA pattern: "Living Room Motion"
      const name = attrs["friendly_name"] as string;
      const roomMatch = name.match(/^(.+?)\s+(motion|door|sensor)/i);
      if (roomMatch?.[1]) return roomMatch[1];
    }
    return "unknown";
  }
}
