/**
 * CleverHub - Realtime Channel Configuration
 *
 * Three tenant-scoped channels for live updates:
 *   1. device_state:{tenant_id}  - Live device state changes
 *   2. presence:{tenant_id}      - Online device presence tracking
 *   3. voice_log:{tenant_id}     - Voice activity feed
 *
 * All channels are scoped by tenant_id for multi-tenant isolation.
 * Clients subscribe using the Supabase client SDK with their JWT,
 * and the JWT's tenant_id claim determines which channel they access.
 */

import {
  createClient,
  type SupabaseClient,
  type RealtimeChannel,
} from "@supabase/supabase-js";
import type {
  TenantId,
  UserId,
  DeviceId,
  DeviceState,
  DeviceCategory,
  VoiceTier,
  PantryItemCategory,
  PantryItemSource,
  PantryLocation,
  ShoppingListAddedVia,
} from "@clever/shared";

// ---------------------------------------------------------------------------
// Channel Name Builders
// ---------------------------------------------------------------------------

/** Returns the channel name for device state updates */
export function deviceStateChannelName(tenantId: TenantId | string): string {
  return `device_state:${tenantId}`;
}

/** Returns the channel name for device presence tracking */
export function presenceChannelName(tenantId: TenantId | string): string {
  return `presence:${tenantId}`;
}

/** Returns the channel name for voice activity feed */
export function voiceLogChannelName(tenantId: TenantId | string): string {
  return `voice_log:${tenantId}`;
}

/** Returns the channel name for pantry updates */
export function pantryChannelName(tenantId: TenantId | string): string {
  return `pantry:${tenantId}`;
}

/** Returns the channel name for shopping list updates */
export function shoppingListChannelName(tenantId: TenantId | string): string {
  return `shopping_list:${tenantId}`;
}

/** Returns the channel name for kitchen hub commands/events */
export function kitchenChannelName(tenantId: TenantId | string): string {
  return `kitchen:${tenantId}`;
}

// ---------------------------------------------------------------------------
// Channel Payload Types
// ---------------------------------------------------------------------------

/**
 * Payload broadcast on device_state:{tenant_id} when a device changes state.
 * Subscribers use this to update dashboards and mobile apps in real-time.
 */
export interface DeviceStatePayload {
  /** The device that changed state */
  device_id: string;
  /** Home Assistant entity ID for cross-referencing */
  ha_entity_id: string;
  /** Device name for display */
  name: string;
  /** Device category */
  category: DeviceCategory;
  /** Room the device is in */
  room: string;
  /** Previous state before the change */
  previous_state: DeviceState;
  /** New current state */
  new_state: DeviceState;
  /** Updated device attributes (e.g., brightness, temperature) */
  attributes: Record<string, unknown>;
  /** What or who triggered the change */
  changed_by: string;
  /** Source of the change */
  source: "voice" | "dashboard" | "mobile" | "automation" | "api";
  /** ISO 8601 timestamp of the change */
  timestamp: string;
}

/**
 * Presence state tracked on presence:{tenant_id} for each online device.
 * Uses Supabase Realtime Presence to track which devices are currently online.
 */
export interface DevicePresenceState {
  /** Device UUID */
  device_id: string;
  /** Home Assistant entity ID */
  ha_entity_id: string;
  /** Device name */
  name: string;
  /** Device category */
  category: DeviceCategory;
  /** Current online status */
  is_online: boolean;
  /** Last seen timestamp (ISO 8601) */
  last_seen: string;
  /** IP address or connection identifier */
  connection_id: string;
}

/**
 * Payload broadcast on voice_log:{tenant_id} when a voice session completes.
 * Used for the real-time voice activity feed in the admin dashboard.
 */
export interface VoiceLogPayload {
  /** Voice session UUID */
  session_id: string;
  /** User who triggered the voice command */
  user_id: string;
  /** Device that captured the voice */
  device_id: string;
  /** Which processing tier was used */
  tier: VoiceTier;
  /** Processing status */
  status: "processing" | "completed" | "failed" | "confirmation_required";
  /** Confidence score (0-1) */
  confidence: number;
  /** Summary of the parsed intent (e.g., "light.turn_on") */
  intent_summary: string;
  /** Total processing latency in ms */
  total_latency_ms: number;
  /** ISO 8601 timestamp */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Channel Event Names
// ---------------------------------------------------------------------------

/** Events emitted on the device_state channel */
export const DEVICE_STATE_EVENTS = {
  /** A device's state has changed */
  STATE_CHANGE: "state_change",
  /** A device has been registered */
  DEVICE_REGISTERED: "device_registered",
  /** A device has been removed */
  DEVICE_REMOVED: "device_removed",
  /** A command was sent to a device */
  COMMAND_SENT: "command_sent",
} as const;

/** Events emitted on the voice_log channel */
export const VOICE_LOG_EVENTS = {
  /** A voice session result has arrived */
  VOICE_SESSION: "voice_session",
  /** A voice session is being processed (in-progress notification) */
  VOICE_PROCESSING: "voice_processing",
} as const;

// ---------------------------------------------------------------------------
// Channel Subscription Helpers
// ---------------------------------------------------------------------------

/**
 * Subscribe to real-time device state changes for a tenant.
 * Returns the channel for cleanup.
 */
export function subscribeToDeviceState(
  client: SupabaseClient,
  tenantId: TenantId | string,
  callbacks: {
    onStateChange?: (payload: DeviceStatePayload) => void;
    onDeviceRegistered?: (payload: DeviceStatePayload) => void;
    onDeviceRemoved?: (payload: { device_id: string }) => void;
    onCommandSent?: (payload: { device_id: string; action: string; source: string }) => void;
    onError?: (error: Error) => void;
  }
): RealtimeChannel {
  const channelName = deviceStateChannelName(tenantId);
  const channel = client.channel(channelName);

  if (callbacks.onStateChange) {
    channel.on("broadcast", { event: DEVICE_STATE_EVENTS.STATE_CHANGE }, ({ payload }) => {
      callbacks.onStateChange!(payload as DeviceStatePayload);
    });
  }

  if (callbacks.onDeviceRegistered) {
    channel.on("broadcast", { event: DEVICE_STATE_EVENTS.DEVICE_REGISTERED }, ({ payload }) => {
      callbacks.onDeviceRegistered!(payload as DeviceStatePayload);
    });
  }

  if (callbacks.onDeviceRemoved) {
    channel.on("broadcast", { event: DEVICE_STATE_EVENTS.DEVICE_REMOVED }, ({ payload }) => {
      callbacks.onDeviceRemoved!(payload as { device_id: string });
    });
  }

  if (callbacks.onCommandSent) {
    channel.on("broadcast", { event: DEVICE_STATE_EVENTS.COMMAND_SENT }, ({ payload }) => {
      callbacks.onCommandSent!(payload as { device_id: string; action: string; source: string });
    });
  }

  channel.subscribe((status) => {
    if (status === "CHANNEL_ERROR") {
      callbacks.onError?.(new Error(`Failed to subscribe to ${channelName}`));
    }
  });

  return channel;
}

/**
 * Subscribe to device presence tracking for a tenant.
 * Uses Supabase Realtime Presence for automatic join/leave tracking.
 */
export function subscribeToDevicePresence(
  client: SupabaseClient,
  tenantId: TenantId | string,
  callbacks: {
    onSync?: (presences: Record<string, DevicePresenceState[]>) => void;
    onJoin?: (key: string, currentPresences: DevicePresenceState[], newPresences: DevicePresenceState[]) => void;
    onLeave?: (key: string, currentPresences: DevicePresenceState[], leftPresences: DevicePresenceState[]) => void;
    onError?: (error: Error) => void;
  }
): RealtimeChannel {
  const channelName = presenceChannelName(tenantId);
  const channel = client.channel(channelName);

  if (callbacks.onSync) {
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<DevicePresenceState>();
      callbacks.onSync!(state);
    });
  }

  if (callbacks.onJoin) {
    channel.on("presence", { event: "join" }, ({ key, currentPresences, newPresences }) => {
      callbacks.onJoin!(
        key,
        currentPresences as unknown as DevicePresenceState[],
        newPresences as unknown as DevicePresenceState[]
      );
    });
  }

  if (callbacks.onLeave) {
    channel.on("presence", { event: "leave" }, ({ key, currentPresences, leftPresences }) => {
      callbacks.onLeave!(
        key,
        currentPresences as unknown as DevicePresenceState[],
        leftPresences as unknown as DevicePresenceState[]
      );
    });
  }

  channel.subscribe((status) => {
    if (status === "CHANNEL_ERROR") {
      callbacks.onError?.(new Error(`Failed to subscribe to ${channelName}`));
    }
  });

  return channel;
}

/**
 * Track a device's presence in the tenant's presence channel.
 * Called by the pi-agent or ha-bridge when a device comes online.
 */
export async function trackDevicePresence(
  channel: RealtimeChannel,
  device: DevicePresenceState
): Promise<void> {
  await channel.track(device);
}

/**
 * Remove a device from the presence channel.
 * Called when a device goes offline.
 */
export async function untrackDevicePresence(
  channel: RealtimeChannel
): Promise<void> {
  await channel.untrack();
}

/**
 * Subscribe to the voice activity log for a tenant.
 * Used by the admin dashboard to show a live feed of voice commands.
 */
export function subscribeToVoiceLog(
  client: SupabaseClient,
  tenantId: TenantId | string,
  callbacks: {
    onVoiceSession?: (payload: VoiceLogPayload) => void;
    onVoiceProcessing?: (payload: VoiceLogPayload) => void;
    onError?: (error: Error) => void;
  }
): RealtimeChannel {
  const channelName = voiceLogChannelName(tenantId);
  const channel = client.channel(channelName);

  if (callbacks.onVoiceSession) {
    channel.on("broadcast", { event: VOICE_LOG_EVENTS.VOICE_SESSION }, ({ payload }) => {
      callbacks.onVoiceSession!(payload as VoiceLogPayload);
    });
  }

  if (callbacks.onVoiceProcessing) {
    channel.on("broadcast", { event: VOICE_LOG_EVENTS.VOICE_PROCESSING }, ({ payload }) => {
      callbacks.onVoiceProcessing!(payload as VoiceLogPayload);
    });
  }

  channel.subscribe((status) => {
    if (status === "CHANNEL_ERROR") {
      callbacks.onError?.(new Error(`Failed to subscribe to ${channelName}`));
    }
  });

  return channel;
}

// ---------------------------------------------------------------------------
// Broadcast Helpers (server-side)
// ---------------------------------------------------------------------------

/**
 * Broadcast a device state change event. Called from the HA bridge
 * or edge functions when a device changes state.
 */
export async function broadcastDeviceStateChange(
  client: SupabaseClient,
  tenantId: TenantId | string,
  payload: DeviceStatePayload
): Promise<void> {
  const channelName = deviceStateChannelName(tenantId);
  const channel = client.channel(channelName);

  await channel.send({
    type: "broadcast",
    event: DEVICE_STATE_EVENTS.STATE_CHANGE,
    payload,
  });

  await client.removeChannel(channel);
}

/**
 * Broadcast a voice log event. Called from the voice webhook
 * edge function after processing a voice session.
 */
export async function broadcastVoiceLog(
  client: SupabaseClient,
  tenantId: TenantId | string,
  payload: VoiceLogPayload
): Promise<void> {
  const channelName = voiceLogChannelName(tenantId);
  const channel = client.channel(channelName);

  await channel.send({
    type: "broadcast",
    event: VOICE_LOG_EVENTS.VOICE_SESSION,
    payload,
  });

  await client.removeChannel(channel);
}

// ---------------------------------------------------------------------------
// Pantry Channel
// ---------------------------------------------------------------------------

/** Payload broadcast on pantry:{tenant_id} for pantry inventory changes. */
export interface PantryUpdatePayload {
  item_id: string;
  name: string;
  action: "added" | "removed" | "updated";
  quantity: number;
  unit: string;
  category: PantryItemCategory;
  source: PantryItemSource;
  location: PantryLocation;
  timestamp: string;
}

/** Payload for expiry warnings on the pantry channel. */
export interface PantryExpiryWarningPayload {
  items: Array<{
    id: string;
    name: string;
    expiry_date: string;
    location: string;
    quantity: number;
    unit: string;
  }>;
  checked_at: string;
}

/** Events emitted on the pantry channel */
export const PANTRY_EVENTS = {
  ITEM_ADDED: "ITEM_ADDED",
  ITEM_REMOVED: "ITEM_REMOVED",
  ITEM_UPDATED: "ITEM_UPDATED",
  EXPIRY_WARNING: "EXPIRY_WARNING",
} as const;

/** Subscribe to pantry updates for a tenant. */
export function subscribeToPantry(
  client: SupabaseClient,
  tenantId: TenantId | string,
  callbacks: {
    onItemAdded?: (payload: PantryUpdatePayload) => void;
    onItemRemoved?: (payload: PantryUpdatePayload) => void;
    onItemUpdated?: (payload: PantryUpdatePayload) => void;
    onExpiryWarning?: (payload: PantryExpiryWarningPayload) => void;
    onError?: (error: Error) => void;
  }
): RealtimeChannel {
  const channelName = pantryChannelName(tenantId);
  const channel = client.channel(channelName);

  if (callbacks.onItemAdded) {
    channel.on("broadcast", { event: PANTRY_EVENTS.ITEM_ADDED }, ({ payload }) => {
      callbacks.onItemAdded!(payload as PantryUpdatePayload);
    });
  }
  if (callbacks.onItemRemoved) {
    channel.on("broadcast", { event: PANTRY_EVENTS.ITEM_REMOVED }, ({ payload }) => {
      callbacks.onItemRemoved!(payload as PantryUpdatePayload);
    });
  }
  if (callbacks.onItemUpdated) {
    channel.on("broadcast", { event: PANTRY_EVENTS.ITEM_UPDATED }, ({ payload }) => {
      callbacks.onItemUpdated!(payload as PantryUpdatePayload);
    });
  }
  if (callbacks.onExpiryWarning) {
    channel.on("broadcast", { event: PANTRY_EVENTS.EXPIRY_WARNING }, ({ payload }) => {
      callbacks.onExpiryWarning!(payload as PantryExpiryWarningPayload);
    });
  }

  channel.subscribe((status) => {
    if (status === "CHANNEL_ERROR") {
      callbacks.onError?.(new Error(`Failed to subscribe to ${channelName}`));
    }
  });

  return channel;
}

/** Broadcast a pantry update event. */
export async function broadcastPantryUpdate(
  client: SupabaseClient,
  tenantId: TenantId | string,
  event: keyof typeof PANTRY_EVENTS,
  payload: PantryUpdatePayload | PantryExpiryWarningPayload
): Promise<void> {
  const channelName = pantryChannelName(tenantId);
  const channel = client.channel(channelName);
  await channel.send({ type: "broadcast", event: PANTRY_EVENTS[event], payload });
  await client.removeChannel(channel);
}

// ---------------------------------------------------------------------------
// Shopping List Channel
// ---------------------------------------------------------------------------

/** Payload broadcast on shopping_list:{tenant_id} for list changes. */
export interface ShoppingListUpdatePayload {
  item_id: string;
  name: string;
  action: "added" | "removed" | "checked" | "unchecked" | "cleared";
  quantity: number;
  added_via: ShoppingListAddedVia | null;
  timestamp: string;
}

/** Events emitted on the shopping list channel */
export const SHOPPING_LIST_EVENTS = {
  ITEM_ADDED: "ITEM_ADDED",
  ITEM_REMOVED: "ITEM_REMOVED",
  ITEM_CHECKED: "ITEM_CHECKED",
  ITEM_UNCHECKED: "ITEM_UNCHECKED",
  LIST_CLEARED: "LIST_CLEARED",
} as const;

/** Subscribe to shopping list updates for a tenant. */
export function subscribeToShoppingList(
  client: SupabaseClient,
  tenantId: TenantId | string,
  callbacks: {
    onItemAdded?: (payload: ShoppingListUpdatePayload) => void;
    onItemRemoved?: (payload: ShoppingListUpdatePayload) => void;
    onItemChecked?: (payload: ShoppingListUpdatePayload) => void;
    onItemUnchecked?: (payload: ShoppingListUpdatePayload) => void;
    onListCleared?: (payload: { timestamp: string }) => void;
    onError?: (error: Error) => void;
  }
): RealtimeChannel {
  const channelName = shoppingListChannelName(tenantId);
  const channel = client.channel(channelName);

  if (callbacks.onItemAdded) {
    channel.on("broadcast", { event: SHOPPING_LIST_EVENTS.ITEM_ADDED }, ({ payload }) => {
      callbacks.onItemAdded!(payload as ShoppingListUpdatePayload);
    });
  }
  if (callbacks.onItemRemoved) {
    channel.on("broadcast", { event: SHOPPING_LIST_EVENTS.ITEM_REMOVED }, ({ payload }) => {
      callbacks.onItemRemoved!(payload as ShoppingListUpdatePayload);
    });
  }
  if (callbacks.onItemChecked) {
    channel.on("broadcast", { event: SHOPPING_LIST_EVENTS.ITEM_CHECKED }, ({ payload }) => {
      callbacks.onItemChecked!(payload as ShoppingListUpdatePayload);
    });
  }
  if (callbacks.onItemUnchecked) {
    channel.on("broadcast", { event: SHOPPING_LIST_EVENTS.ITEM_UNCHECKED }, ({ payload }) => {
      callbacks.onItemUnchecked!(payload as ShoppingListUpdatePayload);
    });
  }
  if (callbacks.onListCleared) {
    channel.on("broadcast", { event: SHOPPING_LIST_EVENTS.LIST_CLEARED }, ({ payload }) => {
      callbacks.onListCleared!(payload as { timestamp: string });
    });
  }

  channel.subscribe((status) => {
    if (status === "CHANNEL_ERROR") {
      callbacks.onError?.(new Error(`Failed to subscribe to ${channelName}`));
    }
  });

  return channel;
}

/** Broadcast a shopping list update event. */
export async function broadcastShoppingListUpdate(
  client: SupabaseClient,
  tenantId: TenantId | string,
  event: keyof typeof SHOPPING_LIST_EVENTS,
  payload: ShoppingListUpdatePayload | { timestamp: string }
): Promise<void> {
  const channelName = shoppingListChannelName(tenantId);
  const channel = client.channel(channelName);
  await channel.send({ type: "broadcast", event: SHOPPING_LIST_EVENTS[event], payload });
  await client.removeChannel(channel);
}

/**
 * Unsubscribe from all CleverHub channels.
 * Convenience cleanup function for client teardown.
 */
export async function unsubscribeAll(
  client: SupabaseClient,
  channels: RealtimeChannel[]
): Promise<void> {
  for (const channel of channels) {
    await client.removeChannel(channel);
  }
}
