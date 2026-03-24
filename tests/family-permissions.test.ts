/**
 * Comprehensive tests for FamilyPermissionResolver
 *
 * Covers: emergency bypass, age-group defaults (allows + denials),
 * schedule blocking, constraint clamping, explicit per-device overrides,
 * per-category overrides, per-room overrides, and parental notifications.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { FamilyPermissionResolver } from "../packages/shared/src/permissions/family-permissions";
import { DEFAULT_PERMISSIONS, DENIAL_TEMPLATES } from "../packages/shared/src/permissions/default-matrices";

import type { ParsedIntent } from "../packages/shared/src/types/voice";
import type { Device, DeviceCategory, DeviceId } from "../packages/shared/src/types/device";
import type { TenantId, UserId } from "../packages/shared/src/types/tenant";
import type {
  FamilyMemberProfile,
  FamilyPermissionOverride,
  FamilySchedule,
  FamilyVoiceContext,
  FamilyAgeGroup,
  AgentPersonality,
  PermissionCheckResult,
  ParentalNotification,
  ParentalNotificationEventType,
} from "../packages/shared/src/types/family";

// ---------------------------------------------------------------------------
// Test helpers — factories for required objects
// ---------------------------------------------------------------------------

const TENANT_ID = "tenant-001" as TenantId;
const USER_ID = "user-001" as UserId;

const DEFAULT_PERSONALITY: AgentPersonality = {
  tone: "friendly",
  vocabulary_level: "adult",
  humor_level: 0.3,
  encouragement_level: 0.1,
  safety_warnings: false,
  max_response_words: 30,
  forbidden_topics: [],
  custom_greeting: "Hello",
  sound_effects: false,
};

function makeProfile(
  ageGroup: FamilyAgeGroup,
  overrides?: Partial<FamilyMemberProfile>,
): FamilyMemberProfile {
  return {
    id: "profile-001",
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    age_group: ageGroup,
    date_of_birth: null,
    agent_name: "TestAgent",
    agent_voice_id: null,
    agent_personality: DEFAULT_PERSONALITY,
    managed_by: null,
    is_active: true,
    expires_at: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDevice(
  category: DeviceCategory,
  room = "living_room",
  overrides?: Partial<Device>,
): Device {
  return {
    id: `device-${category}-001` as DeviceId,
    tenant_id: TENANT_ID,
    ha_entity_id: `switch.${category}_001`,
    name: `Test ${category}`,
    category,
    room,
    floor: "1",
    state: "on",
    attributes: {},
    is_online: true,
    last_seen: "2025-01-01T00:00:00Z",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeIntent(
  rawTranscript: string,
  overrides?: Partial<ParsedIntent>,
): ParsedIntent {
  return {
    domain: "light",
    action: "turn_on",
    parameters: {},
    confidence: 0.95,
    raw_transcript: rawTranscript,
    ...overrides,
  };
}

function makeContext(
  ageGroup: FamilyAgeGroup,
  opts?: {
    overrides?: FamilyPermissionOverride[];
    schedules?: FamilySchedule[];
    profileOverrides?: Partial<FamilyMemberProfile>;
  },
): FamilyVoiceContext {
  return {
    profile: makeProfile(ageGroup, opts?.profileOverrides),
    overrides: opts?.overrides ?? [],
    active_schedules: opts?.schedules ?? [],
    spending_limit: null,
  };
}

function makeOverride(
  opts: {
    deviceId?: string | null;
    deviceCategory?: DeviceCategory | null;
    room?: string | null;
    allowed: boolean;
    constraints?: FamilyPermissionOverride["constraints"];
  },
): FamilyPermissionOverride {
  return {
    id: `override-${Date.now()}-${Math.random()}`,
    tenant_id: TENANT_ID,
    profile_id: "profile-001",
    device_id: (opts.deviceId ?? null) as DeviceId | null,
    device_category: opts.deviceCategory ?? null,
    room: opts.room ?? null,
    action: "control",
    allowed: opts.allowed,
    constraints: opts.constraints ?? {},
    created_at: "2025-01-01T00:00:00Z",
  };
}

function makeSchedule(
  name: string,
  opts: {
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    timezone?: string;
    isActive?: boolean;
    blockedCategories?: DeviceCategory[];
    blockedRooms?: string[];
    volumeCap?: number;
    forceScene?: string;
    notificationMessage?: string;
  },
): FamilySchedule {
  return {
    id: `schedule-${Date.now()}-${Math.random()}`,
    tenant_id: TENANT_ID,
    profile_id: "profile-001",
    schedule_name: name,
    days_of_week: opts.daysOfWeek,
    start_time: opts.startTime,
    end_time: opts.endTime,
    timezone: opts.timezone ?? "America/Chicago",
    restrictions: {
      blocked_device_categories: opts.blockedCategories,
      blocked_rooms: opts.blockedRooms,
      volume_cap: opts.volumeCap,
      force_scene: opts.forceScene,
      notification_message: opts.notificationMessage,
    },
    is_active: opts.isActive ?? true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  };
}

/**
 * Create a Date from a UTC ISO string. The schedules use America/Chicago
 * (CDT = UTC-5 in summer). To get a desired *local* time in Chicago,
 * provide the corresponding UTC time.
 *
 * Examples (CDT, UTC-5):
 *   Wed Jun 4 2025 9:00 PM CDT  ->  "2025-06-05T02:00:00Z"
 *   Wed Jun 4 2025 3:00 PM CDT  ->  "2025-06-04T20:00:00Z"
 *   Mon Jun 2 2025 10:00 AM CDT ->  "2025-06-02T15:00:00Z"
 *   Mon Jun 2 2025 4:00 PM CDT  ->  "2025-06-02T21:00:00Z"
 *   Wed Jun 4 2025 9:30 PM CDT  ->  "2025-06-05T02:30:00Z"
 *   Wed Jun 4 2025 10:00 PM CDT ->  "2025-06-05T03:00:00Z"
 *   Wed Jun 4 2025 8:00 PM CDT  ->  "2025-06-05T01:00:00Z"
 */
function utcDate(isoString: string): Date {
  return new Date(isoString);
}

/**
 * Simulate parental notification generation.
 * The resolver itself returns PermissionCheckResult; the calling layer
 * is responsible for creating ParentalNotification records. This helper
 * mirrors that logic so we can verify the shape.
 */
function buildNotification(
  result: PermissionCheckResult,
  eventType: ParentalNotificationEventType,
  profileId = "profile-001",
): ParentalNotification {
  return {
    id: `notif-${Date.now()}`,
    tenant_id: TENANT_ID,
    profile_id: profileId,
    event_type: eventType,
    details: {
      allowed: result.allowed,
      reason: result.reason,
      constraints: result.constraints_applied,
    },
    acknowledged: false,
    created_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let resolver: FamilyPermissionResolver;

beforeEach(() => {
  resolver = new FamilyPermissionResolver();
});

// =========================================================================
// 1. Emergency Bypass (all ages)
// =========================================================================

describe("Emergency Bypass (all ages)", () => {
  const emergencyPhrases: Array<{ phrase: string; ageGroup: FamilyAgeGroup }> = [
    { phrase: "help", ageGroup: "adult" },
    { phrase: "there's a fire", ageGroup: "child" },
    { phrase: "I'm hurt", ageGroup: "toddler" },
    { phrase: "call 911", ageGroup: "teenager" },
  ];

  it("adult saying 'help' -> allowed with emergency_bypass reason", () => {
    const context = makeContext("adult");
    const intent = makeIntent("help");
    const device = makeDevice("light");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("emergency_bypass");
  });

  it("child saying 'there's a fire' -> allowed, bypasses all restrictions", () => {
    const context = makeContext("child");
    const intent = makeIntent("there's a fire");
    const device = makeDevice("lock"); // child normally can't touch locks
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("emergency_bypass");
  });

  it("toddler saying 'I'm hurt' -> allowed, bypasses all restrictions", () => {
    const context = makeContext("toddler");
    const intent = makeIntent("I'm hurt");
    const device = makeDevice("thermostat");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("emergency_bypass");
  });

  it("teenager saying 'call 911' -> allowed", () => {
    const context = makeContext("teenager");
    const intent = makeIntent("call 911");
    const device = makeDevice("camera"); // teenager normally can't access cameras
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("emergency_bypass");
  });

  it("emergency bypasses active schedule restrictions", () => {
    // Wednesday Jun 4 2025, 9PM CDT
    const now = utcDate("2025-06-05T02:00:00Z");
    const schedule = makeSchedule("bedtime", {
      startTime: "20:30",
      endTime: "06:30",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      blockedCategories: ["media_player", "light"],
    });
    const context = makeContext("child", { schedules: [schedule] });
    const intent = makeIntent("help there's a fire");
    const device = makeDevice("media_player");
    const result = resolver.checkPermission(context, intent, device, now);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("emergency_bypass");
  });
});

// =========================================================================
// 2. Age Group Default Denials
// =========================================================================

describe("Age Group Default Denials", () => {
  it("toddler trying to control any device -> denied (zero device control)", () => {
    const context = makeContext("toddler");
    const intent = makeIntent("turn on the lights");
    const device = makeDevice("light");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(DENIAL_TEMPLATES.toddler);
  });

  it("toddler trying to control a thermostat -> denied", () => {
    const context = makeContext("toddler");
    const intent = makeIntent("set temperature to 72");
    const device = makeDevice("thermostat");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(DENIAL_TEMPLATES.toddler);
  });

  it("child trying to unlock a door (lock category) -> denied", () => {
    const context = makeContext("child");
    const intent = makeIntent("unlock the front door");
    const device = makeDevice("lock");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(DENIAL_TEMPLATES.child);
  });

  it("child trying to control thermostat -> denied", () => {
    const context = makeContext("child");
    const intent = makeIntent("set temperature to 72", {
      domain: "climate",
      action: "set_temperature",
      parameters: { temperature: 72 },
    });
    const device = makeDevice("thermostat");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(false);
    // child thermostat is `false` => denied
    expect(result.reason).toBe(DENIAL_TEMPLATES.child);
  });

  it("tween trying to access cameras -> denied", () => {
    const context = makeContext("tween");
    const intent = makeIntent("show me the front camera");
    const device = makeDevice("camera");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(DENIAL_TEMPLATES.tween);
  });

  it("teenager trying to unlock door -> denied (lock_security = false)", () => {
    const context = makeContext("teenager");
    const intent = makeIntent("unlock front door");
    const device = makeDevice("lock");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(DENIAL_TEMPLATES.teenager);
  });

  it("adult visitor trying to control unassigned device -> denied", () => {
    // adult_visitor has device_control: "explicitly_allowed_only"
    // With no overrides, everything is denied
    const context = makeContext("adult_visitor");
    const intent = makeIntent("turn on kitchen lights");
    const device = makeDevice("light", "kitchen");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(DENIAL_TEMPLATES.adult_visitor);
  });

  it("child trying to control a media player -> denied (own_room_lights_only)", () => {
    const context = makeContext("child");
    const intent = makeIntent("play some music");
    const device = makeDevice("media_player", "bedroom");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(DENIAL_TEMPLATES.child);
  });
});

// =========================================================================
// 3. Age Group Default Allows
// =========================================================================

describe("Age Group Default Allows", () => {
  it("adult controlling anything -> allowed", () => {
    const context = makeContext("adult");
    const device = makeDevice("lock");
    const intent = makeIntent("unlock the front door");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("allowed");
  });

  it("adult controlling thermostat -> allowed with constraints", () => {
    const context = makeContext("adult");
    const device = makeDevice("thermostat");
    const intent = makeIntent("set temperature to 72", {
      domain: "climate",
      action: "set_temperature",
      parameters: { temperature: 72 },
    });
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
    // adult thermostat range: 60-85
    expect(result.constraints_applied.thermostat_min).toBe(60);
    expect(result.constraints_applied.thermostat_max).toBe(85);
  });

  it("teenager controlling lights -> allowed", () => {
    const context = makeContext("teenager");
    const device = makeDevice("light");
    const intent = makeIntent("turn on the lights");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
  });

  it("teenager controlling a fan -> allowed", () => {
    const context = makeContext("teenager");
    const device = makeDevice("fan", "bedroom");
    const intent = makeIntent("turn on the fan");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
  });

  it("child controlling own-room light -> allowed", () => {
    // child: own_room_lights_only — lights and fans pass the category check
    const context = makeContext("child");
    const device = makeDevice("light", "bedroom");
    const intent = makeIntent("turn on my light");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
  });

  it("tween controlling media_player in own room -> allowed", () => {
    // tween: own_room_only — any device in own room passes
    const context = makeContext("tween");
    const device = makeDevice("media_player", "bedroom");
    const intent = makeIntent("play some music");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
  });

  it("adult controlling cameras -> allowed (camera_access & lock_security true)", () => {
    const context = makeContext("adult");
    const device = makeDevice("camera");
    const intent = makeIntent("show front camera");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
  });
});

// =========================================================================
// 4. Schedule Blocking
// =========================================================================

describe("Schedule Blocking", () => {
  it("child with active bedtime schedule (8:30 PM - 6:30 AM) -> media_player blocked", () => {
    // Wednesday Jun 4 2025, 9PM CDT
    const now = utcDate("2025-06-05T02:00:00Z");
    const schedule = makeSchedule("bedtime", {
      startTime: "20:30",
      endTime: "06:30",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6], // every day
      blockedCategories: ["media_player"],
      notificationMessage: "It's bedtime! No more screen time.",
    });

    const context = makeContext("child", { schedules: [schedule] });
    const intent = makeIntent("play a movie");
    const device = makeDevice("media_player", "bedroom");
    const result = resolver.checkPermission(context, intent, device, now);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("It's bedtime! No more screen time.");
    expect(result.active_schedule).not.toBeNull();
    expect(result.active_schedule?.schedule_name).toBe("bedtime");
  });

  it("child outside bedtime window -> media_player allowed", () => {
    // Wednesday Jun 4 2025, 3PM CDT
    const now = utcDate("2025-06-04T20:00:00Z");
    const schedule = makeSchedule("bedtime", {
      startTime: "20:30",
      endTime: "06:30",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      blockedCategories: ["media_player"],
    });

    const context = makeContext("child", { schedules: [schedule] });
    // child can only do lights/fans by default, so use a light for the "allowed" test
    const intent = makeIntent("turn on light");
    const device = makeDevice("light", "bedroom");
    const result = resolver.checkPermission(context, intent, device, now);

    expect(result.allowed).toBe(true);
  });

  it("teenager with school hours schedule (8 AM - 3 PM weekdays) -> denied for non-essential devices", () => {
    // Monday Jun 2 2025, 10AM CDT
    const now = utcDate("2025-06-02T15:00:00Z");
    const schedule = makeSchedule("school_hours", {
      startTime: "08:00",
      endTime: "15:00",
      daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
      blockedCategories: ["media_player", "switch"],
      notificationMessage: "Focus on school! Media is blocked until 3 PM.",
    });

    const context = makeContext("teenager", { schedules: [schedule] });
    const intent = makeIntent("play music");
    const device = makeDevice("media_player");
    const result = resolver.checkPermission(context, intent, device, now);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Focus on school! Media is blocked until 3 PM.");
  });

  it("teenager outside school hours -> media_player allowed", () => {
    // Monday Jun 2 2025, 4PM CDT
    const now = utcDate("2025-06-02T21:00:00Z");
    const schedule = makeSchedule("school_hours", {
      startTime: "08:00",
      endTime: "15:00",
      daysOfWeek: [1, 2, 3, 4, 5],
      blockedCategories: ["media_player"],
    });

    const context = makeContext("teenager", { schedules: [schedule] });
    const intent = makeIntent("play music");
    const device = makeDevice("media_player");
    const result = resolver.checkPermission(context, intent, device, now);

    expect(result.allowed).toBe(true);
  });

  it("schedule with force_scene -> field is present on the schedule", () => {
    const schedule = makeSchedule("quiet_time", {
      startTime: "21:00",
      endTime: "07:00",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      blockedCategories: ["media_player"],
      forceScene: "night_mode",
    });

    expect(schedule.restrictions.force_scene).toBe("night_mode");

    // The blocking still works when force_scene is set
    // Wednesday Jun 4 2025, 10PM CDT
    const now = utcDate("2025-06-05T03:00:00Z");
    const context = makeContext("teenager", { schedules: [schedule] });
    const intent = makeIntent("play a movie");
    const device = makeDevice("media_player");
    const result = resolver.checkPermission(context, intent, device, now);

    expect(result.allowed).toBe(false);
    expect(result.active_schedule?.restrictions.force_scene).toBe("night_mode");
  });

  it("inactive schedule does not block", () => {
    // Wednesday Jun 4 2025, 9PM CDT
    const now = utcDate("2025-06-05T02:00:00Z");
    const schedule = makeSchedule("bedtime", {
      startTime: "20:30",
      endTime: "06:30",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      blockedCategories: ["media_player"],
      isActive: false, // disabled
    });

    const context = makeContext("teenager", { schedules: [schedule] });
    const intent = makeIntent("play music");
    const device = makeDevice("media_player");
    const result = resolver.checkPermission(context, intent, device, now);

    // Not blocked because schedule is inactive
    expect(result.allowed).toBe(true);
  });
});

// =========================================================================
// 5. Constraint Clamping
// =========================================================================

describe("Constraint Clamping", () => {
  it("teenager sets thermostat to 80 (max 78) -> allowed but clamped to 78", () => {
    const context = makeContext("teenager");
    const intent = makeIntent("set temperature to 80", {
      domain: "climate",
      action: "set_temperature",
      parameters: { temperature: 80 },
    });
    const device = makeDevice("thermostat");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
    expect(result.constraints_applied.thermostat_min).toBe(65);
    expect(result.constraints_applied.thermostat_max).toBe(78);

    // Apply clamping
    const clamped = resolver.applyConstraints(intent, result.constraints_applied);
    expect(intent.parameters.temperature).toBe(78);
    expect(clamped.length).toBeGreaterThan(0);
    expect(clamped[0]).toContain("78");
  });

  it("teenager sets thermostat to 60 (min 65) -> clamped to 65", () => {
    const context = makeContext("teenager");
    const intent = makeIntent("set temperature to 60", {
      domain: "climate",
      action: "set_temperature",
      parameters: { temperature: 60 },
    });
    const device = makeDevice("thermostat");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);

    const clamped = resolver.applyConstraints(intent, result.constraints_applied);
    expect(intent.parameters.temperature).toBe(65);
    expect(clamped.length).toBeGreaterThan(0);
  });

  it("child sets brightness to 100% (max 80%) -> clamped to 80%", () => {
    const context = makeContext("child");
    const intent = makeIntent("set brightness to 100", {
      domain: "light",
      action: "set_brightness",
      parameters: { brightness: 100 },
    });
    const device = makeDevice("light", "bedroom");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);

    // Manually apply brightness constraints (the resolver provides them
    // only when an override sets them; here we test applyConstraints directly)
    const clampedMessages = resolver.applyConstraints(intent, {
      brightness_max: 80,
    });

    expect(intent.parameters.brightness).toBe(80);
    expect(clampedMessages.length).toBeGreaterThan(0);
    expect(clampedMessages[0]).toContain("80");
  });

  it("adult visitor sets volume above cap -> clamped", () => {
    // Give the visitor an explicit allow on a device with a volume constraint
    const deviceId = "device-speaker-001" as DeviceId;
    const override = makeOverride({
      deviceId,
      allowed: true,
      constraints: { volume_max: 0.5 },
    });
    const context = makeContext("adult_visitor", { overrides: [override] });
    const intent = makeIntent("set volume to 90%", {
      domain: "media",
      action: "set_volume",
      parameters: { volume: 0.9 },
    });
    const device = makeDevice("media_player", "guest_room", {
      id: deviceId,
    });
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
    expect(result.constraints_applied.volume_max).toBe(0.5);

    const clamped = resolver.applyConstraints(intent, result.constraints_applied);
    expect(intent.parameters.volume).toBe(0.5);
    expect(clamped.length).toBeGreaterThan(0);
    expect(clamped[0]).toContain("50%");
  });

  it("value within range is not clamped", () => {
    const intent = makeIntent("set temp to 72", {
      domain: "climate",
      action: "set_temperature",
      parameters: { temperature: 72 },
    });

    const clamped = resolver.applyConstraints(intent, {
      thermostat_min: 65,
      thermostat_max: 78,
    });

    expect(intent.parameters.temperature).toBe(72);
    expect(clamped.length).toBe(0);
  });
});

// =========================================================================
// 6. Explicit Per-Device Override
// =========================================================================

describe("Explicit Per-Device Override", () => {
  it("tween with explicit allow on a specific lock -> allowed despite default deny", () => {
    const lockId = "device-frontlock" as DeviceId;
    const override = makeOverride({
      deviceId: lockId,
      allowed: true,
    });
    const context = makeContext("tween", { overrides: [override] });
    const intent = makeIntent("unlock the front door");
    const device = makeDevice("lock", "hallway", { id: lockId });
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("allowed");
  });

  it("adult visitor with explicit allow on living room lights -> allowed", () => {
    const lightId = "device-lr-light" as DeviceId;
    const override = makeOverride({
      deviceId: lightId,
      allowed: true,
    });
    const context = makeContext("adult_visitor", { overrides: [override] });
    const intent = makeIntent("turn on the lights");
    const device = makeDevice("light", "living_room", { id: lightId });
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
  });

  it("child with explicit deny on a specific light -> denied despite default allow", () => {
    const lightId = "device-hallway-light" as DeviceId;
    const override = makeOverride({
      deviceId: lightId,
      allowed: false,
    });
    const context = makeContext("child", { overrides: [override] });
    const intent = makeIntent("turn on the hallway light");
    const device = makeDevice("light", "hallway", { id: lightId });
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(false);
  });

  it("per-device override takes priority over per-category override", () => {
    const lockId = "device-my-lock" as DeviceId;
    // Category deny for all locks
    const catDeny = makeOverride({
      deviceCategory: "lock",
      allowed: false,
    });
    // But specific device allowed
    const deviceAllow = makeOverride({
      deviceId: lockId,
      allowed: true,
    });
    const context = makeContext("teenager", {
      overrides: [catDeny, deviceAllow],
    });
    const intent = makeIntent("unlock my lock");
    const device = makeDevice("lock", "bedroom", { id: lockId });
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
  });
});

// =========================================================================
// 7. Per-Category Override
// =========================================================================

describe("Per-Category Override", () => {
  it("teenager with explicit camera allow -> allowed despite default deny", () => {
    const override = makeOverride({
      deviceCategory: "camera",
      allowed: true,
    });
    const context = makeContext("teenager", { overrides: [override] });
    const intent = makeIntent("show the backyard camera");
    const device = makeDevice("camera", "backyard");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
  });

  it("child with media_player category denied -> denied", () => {
    const override = makeOverride({
      deviceCategory: "media_player",
      allowed: false,
    });
    const context = makeContext("child", { overrides: [override] });
    const intent = makeIntent("play music");
    const device = makeDevice("media_player", "bedroom");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(false);
  });

  it("per-category allow override with constraints preserves constraints", () => {
    const override = makeOverride({
      deviceCategory: "thermostat",
      allowed: true,
      constraints: { thermostat_min: 70, thermostat_max: 74 },
    });
    const context = makeContext("teenager", { overrides: [override] });
    const intent = makeIntent("set temp to 72", {
      domain: "climate",
      action: "set_temperature",
      parameters: { temperature: 72 },
    });
    const device = makeDevice("thermostat");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
    expect(result.constraints_applied.thermostat_min).toBe(70);
    expect(result.constraints_applied.thermostat_max).toBe(74);
  });
});

// =========================================================================
// 8. Per-Room Override
// =========================================================================

describe("Per-Room Override", () => {
  it("child with explicit allow for 'bedroom' room -> lights allowed there", () => {
    const override = makeOverride({
      room: "bedroom",
      allowed: true,
    });
    const context = makeContext("child", { overrides: [override] });
    const intent = makeIntent("turn on the light");
    const device = makeDevice("light", "bedroom");
    const result = resolver.checkPermission(context, intent, device);

    // Per-room override (priority 5) fires before default matrix (priority 6)
    expect(result.allowed).toBe(true);
  });

  it("tween with all devices in 'guest_room' denied -> denied", () => {
    const override = makeOverride({
      room: "guest_room",
      allowed: false,
    });
    const context = makeContext("tween", { overrides: [override] });
    const intent = makeIntent("turn on the light");
    const device = makeDevice("light", "guest_room");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(false);
  });

  it("per-room deny does not affect other rooms", () => {
    const override = makeOverride({
      room: "guest_room",
      allowed: false,
    });
    const context = makeContext("tween", { overrides: [override] });
    const intent = makeIntent("turn on the light");
    const device = makeDevice("light", "bedroom");
    const result = resolver.checkPermission(context, intent, device);

    // tween: own_room_only -> allowed in own room, override only applies to guest_room
    expect(result.allowed).toBe(true);
  });

  it("per-category override takes priority over per-room override", () => {
    // Room allows everything
    const roomAllow = makeOverride({
      room: "bedroom",
      allowed: true,
    });
    // But category denies locks
    const catDeny = makeOverride({
      deviceCategory: "lock",
      allowed: false,
    });
    const context = makeContext("tween", {
      overrides: [catDeny, roomAllow],
    });
    const intent = makeIntent("unlock bedroom door");
    const device = makeDevice("lock", "bedroom");
    const result = resolver.checkPermission(context, intent, device);

    // Per-category (priority 4) beats per-room (priority 5)
    expect(result.allowed).toBe(false);
  });
});

// =========================================================================
// 9. Parental Notification Generation
// =========================================================================

describe("Parental Notification Generation", () => {
  it("denied command generates notification with correct event_type", () => {
    const context = makeContext("child");
    const intent = makeIntent("unlock the front door");
    const device = makeDevice("lock");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(false);

    // The calling layer would generate a notification like this:
    const notification = buildNotification(result, "permission_denied");

    expect(notification.event_type).toBe("permission_denied");
    expect(notification.profile_id).toBe("profile-001");
    expect(notification.acknowledged).toBe(false);
    expect(notification.details.allowed).toBe(false);
    expect(notification.details.reason).toBe(DENIAL_TEMPLATES.child);
  });

  it("emergency command generates notification with emergency event_type", () => {
    const context = makeContext("child");
    const intent = makeIntent("help I'm scared");
    const device = makeDevice("light");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("emergency_bypass");

    const notification = buildNotification(result, "emergency");

    expect(notification.event_type).toBe("emergency");
    expect(notification.details.allowed).toBe(true);
    expect(notification.details.reason).toBe("emergency_bypass");
  });

  it("schedule override attempt generates bedtime_override_attempt notification", () => {
    // Wednesday Jun 4 2025, 9:30PM CDT
    const now = utcDate("2025-06-05T02:30:00Z");
    const schedule = makeSchedule("bedtime", {
      startTime: "20:30",
      endTime: "06:30",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      blockedCategories: ["media_player"],
      notificationMessage: "It's bedtime!",
    });
    const context = makeContext("teenager", { schedules: [schedule] });
    const intent = makeIntent("play a movie");
    const device = makeDevice("media_player");
    const result = resolver.checkPermission(context, intent, device, now);

    expect(result.allowed).toBe(false);

    const notification = buildNotification(result, "bedtime_override_attempt");
    expect(notification.event_type).toBe("bedtime_override_attempt");
    expect(notification.details.reason).toBe("It's bedtime!");
  });
});

// =========================================================================
// 10. Edge Cases & Priority Chain Verification
// =========================================================================

describe("Priority Chain & Edge Cases", () => {
  it("schedule blocking takes priority over per-device allow", () => {
    // Wednesday Jun 4 2025, 9PM CDT
    const now = utcDate("2025-06-05T02:00:00Z");
    const deviceId = "device-tv-001" as DeviceId;

    const deviceAllow = makeOverride({
      deviceId,
      allowed: true,
    });
    const schedule = makeSchedule("bedtime", {
      startTime: "20:30",
      endTime: "06:30",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      blockedCategories: ["media_player"],
    });

    const context = makeContext("child", {
      overrides: [deviceAllow],
      schedules: [schedule],
    });
    const intent = makeIntent("play a movie");
    const device = makeDevice("media_player", "bedroom", { id: deviceId });
    const result = resolver.checkPermission(context, intent, device, now);

    // Schedule (priority 3) blocks before per-device override (priority 4)
    expect(result.allowed).toBe(false);
  });

  it("schedule with blocked_rooms blocks devices in that room", () => {
    // Wednesday Jun 4 2025, 10PM CDT
    const now = utcDate("2025-06-05T03:00:00Z");
    const schedule = makeSchedule("quiet_hours", {
      startTime: "21:00",
      endTime: "07:00",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      blockedRooms: ["bedroom"],
    });
    const context = makeContext("teenager", { schedules: [schedule] });
    const intent = makeIntent("turn on bedroom lights");
    const device = makeDevice("light", "bedroom");
    const result = resolver.checkPermission(context, intent, device, now);

    expect(result.allowed).toBe(false);
  });

  it("volume_cap from schedule is applied as constraint", () => {
    // Wednesday Jun 4 2025, 8PM CDT (inside 7PM-10PM window)
    const now = utcDate("2025-06-05T01:00:00Z");
    const schedule = makeSchedule("quiet_evening", {
      startTime: "19:00",
      endTime: "22:00",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      volumeCap: 0.4,
      // No blocked categories — just a volume cap
    });
    const context = makeContext("teenager", { schedules: [schedule] });
    const intent = makeIntent("play music", {
      domain: "media",
      action: "play",
      parameters: { volume: 0.8 },
    });
    const device = makeDevice("media_player");
    const result = resolver.checkPermission(context, intent, device, now);

    expect(result.allowed).toBe(true);
    expect(result.constraints_applied.volume_max).toBe(0.4);

    // Apply clamping
    const clamped = resolver.applyConstraints(intent, result.constraints_applied);
    expect(intent.parameters.volume).toBe(0.4);
    expect(clamped.length).toBeGreaterThan(0);
  });

  it("multiple emergency keywords all trigger bypass", () => {
    const keywords = [
      "help",
      "emergency",
      "fire in the kitchen",
      "I'm hurt",
      "I am in danger",
      "call an ambulance",
      "call the police",
      "SOS",
      "I'm bleeding",
    ];

    for (const keyword of keywords) {
      const context = makeContext("toddler");
      const intent = makeIntent(keyword);
      const device = makeDevice("light");
      const result = resolver.checkPermission(context, intent, device);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("emergency_bypass");
    }
  });

  it("non-emergency transcript for toddler is denied", () => {
    const context = makeContext("toddler");
    const intent = makeIntent("turn on the TV please");
    const device = makeDevice("media_player");
    const result = resolver.checkPermission(context, intent, device);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(DENIAL_TEMPLATES.toddler);
  });

  it("applyConstraints handles brightness_min clamping", () => {
    const intent = makeIntent("dim the lights", {
      parameters: { brightness: 5 },
    });

    const clamped = resolver.applyConstraints(intent, {
      brightness_min: 20,
      brightness_max: 80,
    });

    expect(intent.parameters.brightness).toBe(20);
    expect(clamped.length).toBeGreaterThan(0);
  });
});
