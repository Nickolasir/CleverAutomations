/**
 * Family Permission Resolver
 *
 * Evaluates whether a family member is allowed to execute a given command,
 * applying the resolution priority chain:
 *
 *   1. Emergency commands → always pass (all ages)
 *   2. Explicit per-device override → parent specifically allowed/denied
 *   3. Active schedule restriction → bedtime/school blocks override defaults
 *   4. Per-category override → parent allowed/denied whole category
 *   5. Per-room override → parent allowed/denied all devices in room
 *   6. Age-group default matrix → baseline permissions
 *
 * When a command is allowed but constrained, parameters are silently clamped
 * (thermostat range, volume cap, brightness limits).
 */

import type { Device, ParsedIntent } from "@clever/shared";
import type {
  FamilyMemberProfile,
  FamilyPermissionOverride,
  FamilySchedule,
  FamilySpendingLimit,
  FamilyVoiceContext,
  PermissionCheckResult,
  PermissionConstraints,
  ScheduleRestrictions,
  FamilyAgeGroup,
} from "../types/family.js";
import type { AideProfile } from "../types/aide.js";
import type { DeviceCategory } from "../types/device.js";
import { DEFAULT_PERMISSIONS, DENIAL_TEMPLATES } from "./default-matrices.js";

// ---------------------------------------------------------------------------
// Safety-sensitive device categories (for confirmation_mode = "safety_only")
// ---------------------------------------------------------------------------

const SAFETY_CONFIRMATION_CATEGORIES: ReadonlySet<string> = new Set([
  "lock",
  "thermostat",
  "climate",
  "cover",
]);

// ---------------------------------------------------------------------------
// Emergency detection
// ---------------------------------------------------------------------------

const EMERGENCY_PATTERNS = [
  /\b(help|emergency|fire|hurt|danger|911|ambulance|police|injured|bleeding)\b/i,
  /\b(i('m| am) (scared|hurt|in danger|not (okay|ok|safe)))\b/i,
  /\b(call (for )?(help|911|an ambulance|the police))\b/i,
  /\bsos\b/i,
];

function isEmergencyCommand(intent: ParsedIntent): boolean {
  return EMERGENCY_PATTERNS.some((p) => p.test(intent.raw_transcript));
}

// ---------------------------------------------------------------------------
// Security-sensitive device categories
// ---------------------------------------------------------------------------

const SECURITY_CATEGORIES: ReadonlySet<string> = new Set([
  "lock",
  "camera",
]);

// ---------------------------------------------------------------------------
// Schedule evaluation
// ---------------------------------------------------------------------------

function isScheduleActive(
  schedule: FamilySchedule,
  now: Date,
): boolean {
  if (!schedule.is_active) return false;

  // Convert to the schedule's timezone for day-of-week and time checks
  const localStr = now.toLocaleString("en-US", { timeZone: schedule.timezone });
  const local = new Date(localStr);
  const dow = local.getDay(); // 0=Sun, 6=Sat

  if (!schedule.days_of_week.includes(dow)) return false;

  const currentMinutes = local.getHours() * 60 + local.getMinutes();
  const [startH, startM] = schedule.start_time.split(":").map(Number);
  const [endH, endM] = schedule.end_time.split(":").map(Number);
  const startMinutes = (startH ?? 0) * 60 + (startM ?? 0);
  const endMinutes = (endH ?? 0) * 60 + (endM ?? 0);

  // Handle overnight schedules (e.g., 20:30 - 06:30)
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function getActiveSchedules(
  schedules: FamilySchedule[],
  now: Date,
): FamilySchedule[] {
  return schedules.filter((s) => isScheduleActive(s, now));
}

// ---------------------------------------------------------------------------
// Permission resolver
// ---------------------------------------------------------------------------

export class FamilyPermissionResolver {

  /**
   * Check whether a family member is allowed to execute a command on a device.
   *
   * @param context  The family voice context (profile, overrides, schedules)
   * @param intent   The parsed voice intent
   * @param device   The target device
   * @param now      Current time (injectable for testing)
   * @returns        PermissionCheckResult with decision, reason, and constraints
   */
  checkPermission(
    context: FamilyVoiceContext,
    intent: ParsedIntent,
    device: Device,
    now: Date = new Date(),
  ): PermissionCheckResult {
    const { profile, overrides, active_schedules } = context;
    const defaults = DEFAULT_PERMISSIONS[profile.age_group];

    // -----------------------------------------------------------------------
    // 1. Emergency bypass — always allowed, all ages
    // -----------------------------------------------------------------------
    if (isEmergencyCommand(intent)) {
      return {
        allowed: true,
        reason: "emergency_bypass",
        constraints_applied: {},
        requires_parent_approval: false,
        active_schedule: null,
      };
    }

    // -----------------------------------------------------------------------
    // 2. Toddler — zero device control (only emergency passes above)
    // -----------------------------------------------------------------------
    if (profile.age_group === "toddler") {
      return {
        allowed: false,
        reason: DENIAL_TEMPLATES.toddler,
        constraints_applied: {},
        requires_parent_approval: false,
        active_schedule: null,
      };
    }

    // -----------------------------------------------------------------------
    // 3. Check active schedule restrictions
    // -----------------------------------------------------------------------
    const activeSchedules = getActiveSchedules(active_schedules, now);
    const blockingSchedule = this.findBlockingSchedule(
      activeSchedules,
      device,
      intent,
    );

    if (blockingSchedule) {
      return {
        allowed: false,
        reason: blockingSchedule.restrictions.notification_message
          ?? `Blocked by "${blockingSchedule.schedule_name}" schedule.`,
        constraints_applied: {},
        requires_parent_approval: false,
        active_schedule: blockingSchedule,
      };
    }

    // -----------------------------------------------------------------------
    // 4. Explicit per-device override (highest specificity)
    // -----------------------------------------------------------------------
    const deviceOverride = overrides.find(
      (o) => o.device_id === device.id && o.action === "control",
    );

    if (deviceOverride) {
      if (!deviceOverride.allowed) {
        return this.denied(profile.age_group, activeSchedules[0] ?? null);
      }
      return this.allowed(deviceOverride.constraints, activeSchedules);
    }

    // -----------------------------------------------------------------------
    // 5. Per-category override
    // -----------------------------------------------------------------------
    const categoryOverride = overrides.find(
      (o) =>
        o.device_category === device.category &&
        o.device_id === null &&
        o.action === "control",
    );

    if (categoryOverride) {
      if (!categoryOverride.allowed) {
        return this.denied(profile.age_group, activeSchedules[0] ?? null);
      }
      return this.allowed(categoryOverride.constraints, activeSchedules);
    }

    // -----------------------------------------------------------------------
    // 6. Per-room override
    // -----------------------------------------------------------------------
    const roomOverride = overrides.find(
      (o) =>
        o.room === device.room &&
        o.device_id === null &&
        o.device_category === null &&
        o.action === "control",
    );

    if (roomOverride) {
      if (!roomOverride.allowed) {
        return this.denied(profile.age_group, activeSchedules[0] ?? null);
      }
      return this.allowed(roomOverride.constraints, activeSchedules);
    }

    // -----------------------------------------------------------------------
    // 7. Age-group default matrix
    // -----------------------------------------------------------------------
    const result = this.checkDefaultPermission(
      profile.age_group,
      defaults,
      device,
      intent,
      activeSchedules,
    );

    // -----------------------------------------------------------------------
    // 8. Assisted living confirmation mode
    // -----------------------------------------------------------------------
    if (result.allowed && profile.age_group === "assisted_living") {
      this.applyAideConfirmationMode(result, context.aide_profile, device);
    }

    return result;
  }

  /**
   * Apply constraints to an intent's parameters, clamping values to limits.
   * Mutates the intent's parameters in place.
   *
   * @returns Description of what was clamped (for the agent to communicate)
   */
  applyConstraints(
    intent: ParsedIntent,
    constraints: PermissionConstraints,
  ): string[] {
    const clamped: string[] = [];
    const params = intent.parameters;

    // Thermostat clamping
    if (constraints.thermostat_min !== undefined || constraints.thermostat_max !== undefined) {
      const tempKeys = ["temperature", "temp"];
      for (const key of tempKeys) {
        if (key in params && typeof params[key] === "number") {
          const original = params[key] as number;
          let value = original;
          if (constraints.thermostat_min !== undefined && value < constraints.thermostat_min) {
            value = constraints.thermostat_min;
          }
          if (constraints.thermostat_max !== undefined && value > constraints.thermostat_max) {
            value = constraints.thermostat_max;
          }
          if (value !== original) {
            params[key] = value;
            clamped.push(`Temperature adjusted to ${value}°F (your range is ${constraints.thermostat_min ?? "?"}–${constraints.thermostat_max ?? "?"}°F)`);
          }
        }
      }
    }

    // Volume clamping
    if (constraints.volume_max !== undefined) {
      const volKeys = ["volume", "volume_level"];
      for (const key of volKeys) {
        if (key in params && typeof params[key] === "number") {
          const original = params[key] as number;
          if (original > constraints.volume_max) {
            params[key] = constraints.volume_max;
            clamped.push(`Volume capped at ${Math.round(constraints.volume_max * 100)}%`);
          }
        }
      }
    }

    // Brightness clamping
    if (constraints.brightness_min !== undefined || constraints.brightness_max !== undefined) {
      const brightKeys = ["brightness", "brightness_pct", "value"];
      for (const key of brightKeys) {
        if (key in params && typeof params[key] === "number") {
          const original = params[key] as number;
          let value = original;
          if (constraints.brightness_min !== undefined && value < constraints.brightness_min) {
            value = constraints.brightness_min;
          }
          if (constraints.brightness_max !== undefined && value > constraints.brightness_max) {
            value = constraints.brightness_max;
          }
          if (value !== original) {
            params[key] = value;
            clamped.push(`Brightness adjusted to ${value}%`);
          }
        }
      }
    }

    return clamped;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private findBlockingSchedule(
    activeSchedules: FamilySchedule[],
    device: Device,
    _intent: ParsedIntent,
  ): FamilySchedule | null {
    for (const schedule of activeSchedules) {
      const r = schedule.restrictions;

      // Check blocked device categories
      if (r.blocked_device_categories?.includes(device.category as DeviceCategory)) {
        return schedule;
      }

      // Check blocked rooms
      if (r.blocked_rooms?.includes(device.room)) {
        return schedule;
      }
    }
    return null;
  }

  private checkDefaultPermission(
    ageGroup: FamilyAgeGroup,
    defaults: typeof DEFAULT_PERMISSIONS[FamilyAgeGroup],
    device: Device,
    intent: ParsedIntent,
    activeSchedules: FamilySchedule[],
  ): PermissionCheckResult {
    const firstSchedule = activeSchedules[0] ?? null;

    // Security categories (lock, camera)
    if (SECURITY_CATEGORIES.has(device.category)) {
      if (!defaults.lock_security) {
        return this.denied(ageGroup, firstSchedule);
      }
    }

    // Check device scope
    switch (defaults.device_control) {
      case "none":
        return this.denied(ageGroup, firstSchedule);

      case "explicitly_allowed_only":
        // adult_visitor: if no explicit override was found above, deny
        return this.denied(ageGroup, firstSchedule);

      case "own_room_lights_only":
        // child: only lights in their own room
        if (device.category !== "light" && device.category !== "fan") {
          return this.denied(ageGroup, firstSchedule);
        }
        // "own room" enforcement happens at the voice pipeline level
        // (the agent's system prompt only exposes own-room devices)
        break;

      case "own_room_only":
        // tween: any device in own room
        // Room enforcement via system prompt scoping
        break;

      case "own_room_plus_common":
        // teenager: own room + common areas
        break;

      case "all":
        // adult: everything
        break;
    }

    // Build constraints from defaults
    const constraints: PermissionConstraints = {};

    // Thermostat constraints
    if (
      (device.category === "thermostat" || device.category === "climate") &&
      intent.domain !== "scene"
    ) {
      if (defaults.thermostat === false) {
        return this.denied(ageGroup, firstSchedule);
      }
      constraints.thermostat_min = defaults.thermostat.min;
      constraints.thermostat_max = defaults.thermostat.max;
    }

    // Volume constraints from schedule
    for (const schedule of activeSchedules) {
      if (schedule.restrictions.volume_cap !== undefined) {
        constraints.volume_max = Math.min(
          constraints.volume_max ?? 1.0,
          schedule.restrictions.volume_cap,
        );
      }
    }

    // Media content rating
    if (device.category === "media_player") {
      constraints.media_content_rating = defaults.media_rating;
    }

    return this.allowed(constraints, activeSchedules);
  }

  private allowed(
    constraints: PermissionConstraints,
    activeSchedules: FamilySchedule[],
  ): PermissionCheckResult {
    return {
      allowed: true,
      reason: "allowed",
      constraints_applied: constraints,
      requires_parent_approval: false,
      active_schedule: activeSchedules[0] ?? null,
    };
  }

  /**
   * For assisted_living profiles, apply confirmation requirements based on
   * the aide profile's confirmation_mode setting.
   */
  private applyAideConfirmationMode(
    result: PermissionCheckResult,
    aideProfile: AideProfile | undefined,
    device: Device,
  ): void {
    if (!aideProfile) return;

    switch (aideProfile.confirmation_mode) {
      case "always":
        result.constraints_applied.requires_confirmation = true;
        break;
      case "safety_only":
        if (SAFETY_CONFIRMATION_CATEGORIES.has(device.category)) {
          result.constraints_applied.requires_confirmation = true;
        }
        break;
      case "never":
        break;
    }
  }

  private denied(
    ageGroup: FamilyAgeGroup,
    activeSchedule: FamilySchedule | null,
  ): PermissionCheckResult {
    return {
      allowed: false,
      reason: DENIAL_TEMPLATES[ageGroup],
      constraints_applied: {},
      requires_parent_approval: false,
      active_schedule: activeSchedule,
    };
  }
}
