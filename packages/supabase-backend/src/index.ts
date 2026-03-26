/**
 * CleverHub - Supabase Backend Package Entry Point
 *
 * Exports a configured Supabase client factory, database type mappings,
 * and all realtime channel utilities. Every operation goes through the
 * Supabase client SDK — no raw SQL in application code.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  TenantId,
  UserId,
  DeviceId,
  VoiceSessionId,
  GuestProfileId,
  ReservationId,
  AuditLogId,
  PantryItemId,
  ShoppingListItemId,
  ReceiptId,
  PantryPhotoId,
  Tenant,
  User,
  Device,
  Room,
  Scene,
  VoiceSession,
  VoiceTranscriptRecord,
  AuditLog,
  SensorTelemetry,
  Reservation,
  GuestProfile,
  GuestWipeChecklist,
  PantryItem,
  ShoppingListItem,
  Receipt,
  PantryPhotoAnalysis,
} from "@clever/shared";

// ---------------------------------------------------------------------------
// Re-export shared types for convenience
// ---------------------------------------------------------------------------
export type {
  TenantId,
  UserId,
  DeviceId,
  VoiceSessionId,
  GuestProfileId,
  ReservationId,
  AuditLogId,
  PantryItemId,
  ShoppingListItemId,
  ReceiptId,
  PantryPhotoId,
  Tenant,
  User,
  Device,
  Room,
  Scene,
  VoiceSession,
  VoiceTranscriptRecord,
  AuditLog,
  SensorTelemetry,
  Reservation,
  GuestProfile,
  GuestWipeChecklist,
  PantryItem,
  ShoppingListItem,
  Receipt,
  PantryPhotoAnalysis,
} from "@clever/shared";

// Re-export realtime channel utilities
export {
  deviceStateChannelName,
  presenceChannelName,
  voiceLogChannelName,
  pantryChannelName,
  shoppingListChannelName,
  kitchenChannelName,
  subscribeToDeviceState,
  subscribeToDevicePresence,
  subscribeToVoiceLog,
  subscribeToPantry,
  subscribeToShoppingList,
  trackDevicePresence,
  untrackDevicePresence,
  broadcastDeviceStateChange,
  broadcastVoiceLog,
  broadcastPantryUpdate,
  broadcastShoppingListUpdate,
  unsubscribeAll,
  DEVICE_STATE_EVENTS,
  VOICE_LOG_EVENTS,
  PANTRY_EVENTS,
  SHOPPING_LIST_EVENTS,
} from "./realtime/channels.js";

export type {
  DeviceStatePayload,
  DevicePresenceState,
  VoiceLogPayload,
  PantryUpdatePayload,
  PantryExpiryWarningPayload,
  ShoppingListUpdatePayload,
} from "./realtime/channels.js";

// ---------------------------------------------------------------------------
// Database Schema Type (maps to Supabase client generics)
// ---------------------------------------------------------------------------

/**
 * Database type definition for the Supabase client.
 * Maps PostgreSQL table schemas to TypeScript types for full type safety.
 * Used as: createClient<Database>(url, key)
 */
export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: DbTenant;
        Insert: Omit<DbTenant, "id" | "tenant_id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DbTenant, "id" | "tenant_id" | "created_at">>;
      };
      users: {
        Row: DbUser;
        Insert: Omit<DbUser, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<DbUser, "id" | "created_at">>;
      };
      devices: {
        Row: DbDevice;
        Insert: Omit<DbDevice, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Omit<DbDevice, "id" | "created_at">>;
      };
      rooms: {
        Row: DbRoom;
        Insert: Omit<DbRoom, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DbRoom, "id" | "created_at">>;
      };
      scenes: {
        Row: DbScene;
        Insert: Omit<DbScene, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DbScene, "id" | "created_at">>;
      };
      voice_sessions: {
        Row: DbVoiceSession;
        Insert: Omit<DbVoiceSession, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DbVoiceSession, "id" | "created_at">>;
      };
      voice_transcripts: {
        Row: DbVoiceTranscript;
        Insert: Omit<DbVoiceTranscript, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DbVoiceTranscript, "id" | "created_at">>;
      };
      audit_logs: {
        Row: DbAuditLog;
        Insert: Omit<DbAuditLog, "id" | "timestamp">;
        Update: never; // Immutable
      };
      sensor_telemetry: {
        Row: DbSensorTelemetry;
        Insert: DbSensorTelemetry;
        Update: never; // Append-only
      };
      reservations: {
        Row: DbReservation;
        Insert: Omit<DbReservation, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DbReservation, "id" | "created_at">>;
      };
      guest_profiles: {
        Row: DbGuestProfile;
        Insert: Omit<DbGuestProfile, "id" | "created_at">;
        Update: Partial<Omit<DbGuestProfile, "id" | "created_at">>;
      };
      guest_wipe_checklists: {
        Row: DbGuestWipeChecklist;
        Insert: Omit<DbGuestWipeChecklist, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DbGuestWipeChecklist, "id" | "created_at">>;
      };
      device_commands: {
        Row: DbDeviceCommand;
        Insert: Omit<DbDeviceCommand, "id" | "created_at">;
        Update: Partial<Omit<DbDeviceCommand, "id" | "created_at">>;
      };
      pantry_items: {
        Row: DbPantryItem;
        Insert: Omit<DbPantryItem, "id" | "created_at" | "updated_at" | "added_date">;
        Update: Partial<Omit<DbPantryItem, "id" | "created_at">>;
      };
      shopping_list_items: {
        Row: DbShoppingListItem;
        Insert: Omit<DbShoppingListItem, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DbShoppingListItem, "id" | "created_at">>;
      };
      receipts: {
        Row: DbReceipt;
        Insert: Omit<DbReceipt, "id" | "created_at">;
        Update: Partial<Omit<DbReceipt, "id" | "created_at">>;
      };
      pantry_photo_analyses: {
        Row: DbPantryPhotoAnalysis;
        Insert: Omit<DbPantryPhotoAnalysis, "id" | "created_at">;
        Update: Partial<Omit<DbPantryPhotoAnalysis, "id" | "created_at">>;
      };
    };
    Functions: {
      create_user_with_tenant: {
        Args: {
          p_auth_user_id: string;
          p_tenant_id: string;
          p_email: string;
          p_role?: string;
          p_display_name?: string;
        };
        Returns: string;
      };
      create_tenant_with_owner: {
        Args: {
          p_auth_user_id: string;
          p_tenant_name: string;
          p_vertical: string;
          p_email: string;
          p_display_name?: string;
          p_tier?: string;
        };
        Returns: string;
      };
      validate_device_scoped_token: {
        Args: {
          p_device_id: string;
          p_tenant_id: string;
        };
        Returns: boolean;
      };
      check_device_command_rate_limit: {
        Args: {
          p_user_id: string;
          p_tenant_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      market_vertical: "clever_home" | "clever_host" | "clever_building";
      subscription_tier: "starter" | "professional" | "enterprise";
      user_role: "owner" | "admin" | "manager" | "resident" | "guest";
      device_category:
        | "light" | "lock" | "thermostat" | "switch" | "sensor"
        | "camera" | "cover" | "media_player" | "climate" | "fan";
      device_state: "on" | "off" | "locked" | "unlocked" | "unknown";
      voice_tier: "tier1_rules" | "tier2_cloud" | "tier3_local";
      voice_session_status: "processing" | "completed" | "failed" | "confirmation_required";
      reservation_status: "upcoming" | "active" | "completed" | "cancelled";
      reservation_platform: "airbnb" | "vrbo" | "direct" | "other";
      scene_trigger: "manual" | "schedule" | "voice" | "geofence";
      audit_action:
        | "device_state_change" | "device_command_issued"
        | "user_login" | "user_logout"
        | "guest_profile_created" | "guest_profile_wiped"
        | "scene_activated" | "automation_triggered"
        | "voice_command_processed" | "settings_changed"
        | "user_created" | "user_deleted"
        | "device_registered" | "device_removed"
        | "pantry_item_added" | "pantry_item_removed" | "pantry_item_updated"
        | "shopping_list_item_added" | "shopping_list_item_removed" | "shopping_list_item_checked"
        | "receipt_scanned" | "pantry_photo_analyzed";
      pantry_item_category:
        | "produce" | "dairy" | "meat" | "seafood" | "frozen" | "canned"
        | "dry_goods" | "bakery" | "beverages" | "snacks" | "condiments"
        | "spices" | "household" | "personal_care" | "other";
      pantry_item_source:
        | "receipt_scan" | "barcode_scan" | "photo_analysis"
        | "voice" | "manual" | "shopping_list_purchased";
      pantry_location: "pantry" | "fridge" | "freezer" | "other";
      processing_status: "pending" | "processing" | "completed" | "failed";
    };
  };
}

// ---------------------------------------------------------------------------
// Database Row Types (direct DB representation, snake_case, no branded types)
// ---------------------------------------------------------------------------

export interface DbTenant {
  id: string;
  tenant_id: string;
  name: string;
  vertical: Database["public"]["Enums"]["market_vertical"];
  subscription_tier: Database["public"]["Enums"]["subscription_tier"];
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbUser {
  id: string;
  tenant_id: string;
  email: string;
  role: Database["public"]["Enums"]["user_role"];
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface DbDevice {
  id: string;
  tenant_id: string;
  ha_entity_id: string;
  name: string;
  category: Database["public"]["Enums"]["device_category"];
  room: string;
  floor: string;
  state: Database["public"]["Enums"]["device_state"];
  attributes: Record<string, unknown>;
  is_online: boolean;
  last_seen: string;
  created_at: string;
  updated_at: string;
}

export interface DbRoom {
  id: string;
  tenant_id: string;
  name: string;
  floor: string;
  created_at: string;
  updated_at: string;
}

export interface DbScene {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  actions: Record<string, unknown>[];
  trigger: Database["public"]["Enums"]["scene_trigger"] | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DbVoiceSession {
  id: string;
  tenant_id: string;
  user_id: string;
  device_id: string;
  tier: Database["public"]["Enums"]["voice_tier"];
  transcript_encrypted: string;
  parsed_intent: Record<string, unknown> | null;
  response_text: string;
  stages: Record<string, unknown>[];
  total_latency_ms: number;
  confidence: number;
  status: Database["public"]["Enums"]["voice_session_status"];
  created_at: string;
  updated_at: string;
}

export interface DbVoiceTranscript {
  id: string;
  session_id: string;
  tenant_id: string;
  user_id: string;
  transcript_encrypted: string;
  intent_summary: string;
  tier_used: Database["public"]["Enums"]["voice_tier"];
  latency_ms: number;
  created_at: string;
  updated_at: string;
}

export interface DbAuditLog {
  id: string;
  tenant_id: string;
  user_id: string | null;
  device_id: string | null;
  voice_session_id: string | null;
  action: Database["public"]["Enums"]["audit_action"];
  details: Record<string, unknown>;
  ip_address: string | null;
  timestamp: string;
}

export interface DbSensorTelemetry {
  time: string;
  tenant_id: string;
  device_id: string;
  metric: string;
  value: number;
  unit: string;
}

export interface DbReservation {
  id: string;
  tenant_id: string;
  property_id: string;
  guest_profile_id: string | null;
  platform: Database["public"]["Enums"]["reservation_platform"];
  external_reservation_id: string | null;
  check_in: string;
  check_out: string;
  guest_count: number;
  status: Database["public"]["Enums"]["reservation_status"];
  created_at: string;
  updated_at: string;
}

export interface DbGuestProfile {
  id: string;
  tenant_id: string;
  reservation_id: string;
  display_name: string;
  wifi_password_encrypted: string | null;
  door_code_encrypted: string | null;
  voice_preferences: Record<string, unknown>;
  tv_logins_encrypted: Record<string, unknown>[];
  custom_preferences: Record<string, unknown>;
  created_at: string;
  expires_at: string;
}

export interface DbGuestWipeChecklist {
  id: string;
  reservation_id: string;
  tenant_id: string;
  items: Record<string, unknown>[];
  started_at: string | null;
  completed_at: string | null;
  is_complete: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbDeviceCommand {
  id: string;
  tenant_id: string;
  device_id: string;
  user_id: string;
  action: string;
  parameters: Record<string, unknown>;
  source: string;
  confidence: number;
  status: "pending" | "executing" | "completed" | "failed";
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  executed_at: string | null;
  completed_at: string | null;
}

export interface DbPantryItem {
  id: string;
  tenant_id: string;
  name: string;
  quantity: number;
  unit: string;
  category: Database["public"]["Enums"]["pantry_item_category"];
  barcode: string | null;
  brand: string | null;
  expiry_date: string | null;
  added_date: string;
  source: Database["public"]["Enums"]["pantry_item_source"];
  location: Database["public"]["Enums"]["pantry_location"];
  notes: string | null;
  image_url: string | null;
  min_stock_threshold: number | null;
  created_at: string;
  updated_at: string;
}

export interface DbShoppingListItem {
  id: string;
  tenant_id: string;
  name: string;
  quantity: number;
  unit: string | null;
  category: Database["public"]["Enums"]["pantry_item_category"] | null;
  checked: boolean;
  added_by: string;
  added_via: string;
  notes: string | null;
  priority: string;
  created_at: string;
  updated_at: string;
}

export interface DbReceipt {
  id: string;
  tenant_id: string;
  image_url: string;
  store_name: string | null;
  purchase_date: string | null;
  total: number | null;
  items_extracted: Record<string, unknown>[];
  processing_status: Database["public"]["Enums"]["processing_status"];
  error_message: string | null;
  scanned_by: string;
  created_at: string;
}

export interface DbPantryPhotoAnalysis {
  id: string;
  tenant_id: string;
  image_url: string;
  location: Database["public"]["Enums"]["pantry_location"];
  identified_items: Record<string, unknown>[];
  processing_status: Database["public"]["Enums"]["processing_status"];
  created_at: string;
}

// ---------------------------------------------------------------------------
// Client Factory
// ---------------------------------------------------------------------------

export interface SupabaseClientOptions {
  /** Supabase project URL (e.g., https://xxxx.supabase.co) */
  url: string;
  /** Supabase anon key (for user-authenticated requests with RLS) */
  anonKey: string;
  /** Optional: service role key for admin operations (bypasses RLS) */
  serviceRoleKey?: string;
}

/**
 * Create a typed Supabase client for user-authenticated operations.
 * RLS policies are enforced based on the JWT's tenant_id and user_role claims.
 */
export function createSupabaseClient(options: SupabaseClientOptions): SupabaseClient<Database> {
  return createClient<Database>(options.url, options.anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
}

/**
 * Create a Supabase service client that bypasses RLS.
 * Use ONLY for server-side admin operations: migrations, seed data,
 * edge function internals, audit log writes.
 *
 * NEVER expose the service role key to the client.
 */
export function createServiceClient(options: SupabaseClientOptions): SupabaseClient<Database> {
  if (!options.serviceRoleKey) {
    throw new Error(
      "Service role key is required for createServiceClient. " +
      "This key must NEVER be exposed to client-side code."
    );
  }

  return createClient<Database>(options.url, options.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Create a Supabase client with a specific user JWT for impersonation.
 * Used in edge functions to run queries scoped to a specific user.
 */
export function createClientWithToken(
  options: SupabaseClientOptions,
  accessToken: string
): SupabaseClient<Database> {
  return createClient<Database>(options.url, options.anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// ---------------------------------------------------------------------------
// Environment Helpers
// ---------------------------------------------------------------------------

/**
 * Read Supabase configuration from environment variables.
 * Throws if required variables are missing.
 */
export function getSupabaseConfigFromEnv(): SupabaseClientOptions {
  const url = process.env["SUPABASE_URL"];
  const anonKey = process.env["SUPABASE_ANON_KEY"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!url) {
    throw new Error("SUPABASE_URL environment variable is required");
  }

  if (!anonKey) {
    throw new Error("SUPABASE_ANON_KEY environment variable is required");
  }

  return {
    url,
    anonKey,
    serviceRoleKey,
  };
}
