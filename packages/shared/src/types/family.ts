/**
 * Family Subagent System Types
 *
 * Defines the type system for named personal agents with age-based permissions.
 * FamilyAgeGroup layers on top of the existing UserRole (owner/admin/manager/
 * resident/guest), providing finer-grained application-level permissions
 * resolved at command execution time.
 */

import type { TenantId, UserId } from "./tenant.js";
import type { DeviceCategory, DeviceId } from "./device.js";

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

export type FamilyAgeGroup =
  | "adult"            // 18+ parents/owners
  | "teenager"         // 15-17
  | "tween"            // 10-14
  | "child"            // 5-9
  | "toddler"          // 2-4
  | "adult_visitor"    // visiting adults, babysitters, grandparents
  | "assisted_living"; // elderly or disabled users with caregiver support

export type PermissionAction =
  | "control"        // operate the device
  | "view_state"     // see device state
  | "configure"      // change device settings
  | "view_history";  // see logs/history

// ---------------------------------------------------------------------------
// Agent personality
// ---------------------------------------------------------------------------

export interface AgentPersonality {
  /** Communication tone */
  tone: "formal" | "friendly" | "playful" | "educational" | "nurturing";
  /** Vocabulary complexity */
  vocabulary_level: "adult" | "teen" | "child" | "toddler";
  /** Humor frequency 0.0-1.0 */
  humor_level: number;
  /** Encouragement frequency 0.0-1.0 (higher for younger children) */
  encouragement_level: number;
  /** Whether to inject safety reminders */
  safety_warnings: boolean;
  /** Max words per spoken response */
  max_response_words: number;
  /** Topics the agent will refuse to discuss */
  forbidden_topics: string[];
  /** Custom greeting phrase */
  custom_greeting: string;
  /** Whether to include fun sound effects (for children) */
  sound_effects: boolean;
}

// ---------------------------------------------------------------------------
// Family member profile
// ---------------------------------------------------------------------------

export interface FamilyMemberProfile {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  age_group: FamilyAgeGroup;
  date_of_birth: string | null;
  /** The wake word / agent name (e.g., "Jarvis", "Luna", "Buddy") */
  agent_name: string;
  /** Cartesia voice ID for TTS responses */
  agent_voice_id: string | null;
  agent_personality: AgentPersonality;
  /** Parent user who manages this profile (null for adults) */
  managed_by: UserId | null;
  is_active: boolean;
  /** Optional expiration for temporary profiles (babysitters, visitors) */
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Permission constraints
// ---------------------------------------------------------------------------

/** Parameter limits applied when a command is allowed but constrained. */
export interface PermissionConstraints {
  /** Minimum temperature the user can set (Fahrenheit) */
  thermostat_min?: number;
  /** Maximum temperature the user can set (Fahrenheit) */
  thermostat_max?: number;
  /** Maximum volume level 0.0-1.0 */
  volume_max?: number;
  /** Minimum brightness percentage */
  brightness_min?: number;
  /** Maximum brightness percentage */
  brightness_max?: number;
  /** Content rating filter: "G", "PG", "PG-13", "R" */
  media_content_rating?: "G" | "PG" | "PG-13" | "R";
  /** Time-of-day restrictions for this specific permission */
  time_restrictions?: TimeWindow[];
  /** Whether this action requires explicit confirmation before executing */
  requires_confirmation?: boolean;
}

export interface TimeWindow {
  days_of_week: number[]; // 0=Sun, 6=Sat
  start_time: string;     // "HH:MM"
  end_time: string;       // "HH:MM"
  timezone: string;
}

// ---------------------------------------------------------------------------
// Permission override
// ---------------------------------------------------------------------------

export interface FamilyPermissionOverride {
  id: string;
  tenant_id: TenantId;
  profile_id: string;
  /** Specific device (null = all devices matching other criteria) */
  device_id: DeviceId | null;
  /** Device category scope (null = all categories) */
  device_category: DeviceCategory | null;
  /** Room scope (null = all rooms) */
  room: string | null;
  action: PermissionAction;
  /** true = explicitly allow, false = explicitly deny */
  allowed: boolean;
  constraints: PermissionConstraints;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Schedule system
// ---------------------------------------------------------------------------

export interface ScheduleRestrictions {
  /** Device categories blocked during this schedule window */
  blocked_device_categories?: DeviceCategory[];
  /** Rooms blocked during this schedule window */
  blocked_rooms?: string[];
  /** Volume cap during this window (0.0-1.0) */
  volume_cap?: number;
  /** Scene to auto-activate when schedule starts */
  force_scene?: string;
  /** Message the agent speaks when the schedule is active */
  notification_message?: string;
}

export interface FamilySchedule {
  id: string;
  tenant_id: TenantId;
  profile_id: string;
  schedule_name: string;
  days_of_week: number[]; // 0=Sun, 6=Sat
  start_time: string;     // "HH:MM"
  end_time: string;       // "HH:MM"
  timezone: string;
  restrictions: ScheduleRestrictions;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Spending limits
// ---------------------------------------------------------------------------

export interface FamilySpendingLimit {
  id: string;
  tenant_id: TenantId;
  profile_id: string;
  /** Max spending per day. 0 = no purchasing allowed. */
  daily_limit: number;
  /** Max spending per month. 0 = no purchasing allowed. */
  monthly_limit: number;
  /** Purchases above this amount require parent approval. null = all need approval. */
  requires_approval_above: number | null;
  /** Product categories the user is allowed to purchase from */
  approved_categories: string[];
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Parental notifications
// ---------------------------------------------------------------------------

export type ParentalNotificationEventType =
  | "permission_denied"
  | "bedtime_override_attempt"
  | "emergency"
  | "spending_request"
  | "schedule_triggered"
  | "override_attempt";

export interface ParentalNotification {
  id: string;
  tenant_id: TenantId;
  profile_id: string;
  event_type: ParentalNotificationEventType;
  details: Record<string, unknown>;
  acknowledged: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Permission check result
// ---------------------------------------------------------------------------

export interface PermissionCheckResult {
  /** Whether the command is allowed */
  allowed: boolean;
  /** Human-readable reason for the decision */
  reason: string;
  /** Constraints to apply if allowed (temp clamping, volume cap, etc.) */
  constraints_applied: PermissionConstraints;
  /** Whether the command needs parent approval before executing */
  requires_parent_approval: boolean;
  /** The schedule that is currently restricting this user, if any */
  active_schedule: FamilySchedule | null;
}

// ---------------------------------------------------------------------------
// Voice context (passed through the voice pipeline)
// ---------------------------------------------------------------------------

/** Carries the resolved family profile and permissions for the current speaker. */
export interface FamilyVoiceContext {
  profile: FamilyMemberProfile;
  /** Pre-loaded permission overrides for this profile */
  overrides: FamilyPermissionOverride[];
  /** Currently active schedule restrictions, if any */
  active_schedules: FamilySchedule[];
  /** Spending limits for this profile */
  spending_limit: FamilySpendingLimit | null;
  /** Aide profile for assisted_living users (loaded when age_group is assisted_living) */
  aide_profile?: import("./aide.js").AideProfile;
}

// ---------------------------------------------------------------------------
// Wake word registry entry
// ---------------------------------------------------------------------------

export interface WakeWordEntry {
  /** The wake word (e.g., "jarvis", "luna") — always lowercase */
  wake_word: string;
  user_id: UserId;
  profile_id: string;
  agent_name: string;
  /** Cartesia voice ID for TTS responses in this agent's voice */
  voice_id: string | null;
  personality: AgentPersonality;
  age_group: FamilyAgeGroup;
}

// ---------------------------------------------------------------------------
// Default permission set (used by default-matrices.ts)
// ---------------------------------------------------------------------------

export type DeviceScope =
  | "all"
  | "own_room_plus_common"
  | "own_room_only"
  | "own_room_lights_only"
  | "explicitly_allowed_only"
  | "none";

export interface ThermostatPermission {
  min: number;
  max: number;
}

export interface DefaultPermissionSet {
  /** Which devices the user can control */
  device_control: DeviceScope;
  /** Whether the user can control locks/security */
  lock_security: boolean;
  /** Thermostat constraints, or false to block entirely */
  thermostat: ThermostatPermission | false;
  /** Whether the user can view camera feeds */
  camera_access: boolean;
  /** Maximum content rating allowed */
  media_rating: "G" | "PG" | "PG-13" | "R";
  /** Whether the user can make purchases */
  purchase_enabled: boolean;
  /** Voice history visibility: "all", "own", "none" */
  voice_history_access: "all" | "own" | "none";
  /** Scene names the user can activate, or "all" */
  scene_activation: string[] | "all";
  /** Max commands per minute */
  rate_limit: number;
  /** Emergency commands always work (should always be true) */
  emergency: boolean;
  /** Whether this user can override other users' restrictions */
  override_others: boolean;
  /** Data visibility level */
  data_visibility: "full" | "limited" | "minimal" | "none";
}
