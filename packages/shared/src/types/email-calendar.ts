/**
 * Email & Calendar Monitoring Types
 *
 * Type definitions for email/calendar accounts linked via Home Assistant
 * integrations (Microsoft 365, Google Calendar, IMAP/SMTP).
 */

import type { TenantId, UserId } from "./tenant.js";

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export type EmailProvider = "gmail" | "outlook";

export type CalendarProvider = "google_calendar" | "outlook_calendar";

// ---------------------------------------------------------------------------
// Alert types
// ---------------------------------------------------------------------------

export type EmailCalendarAlertType =
  | "unread_email"
  | "important_email"
  | "upcoming_event"
  | "event_reminder"
  | "event_started"
  | "daily_digest";

// ---------------------------------------------------------------------------
// Email accounts
// ---------------------------------------------------------------------------

export interface EmailAccountInfo {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  provider: EmailProvider;
  ha_inbox_entity_id: string;
  ha_notify_service: string | null;
  display_name: string;
  email_address: string;
  is_active: boolean;
  last_synced_at: string | null;
}

// ---------------------------------------------------------------------------
// Calendar accounts
// ---------------------------------------------------------------------------

export interface CalendarAccountInfo {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  provider: CalendarProvider;
  ha_entity_id: string;
  display_name: string;
  is_primary: boolean;
  sync_enabled: boolean;
  last_synced_at: string | null;
}

// ---------------------------------------------------------------------------
// Email summaries (from cache)
// ---------------------------------------------------------------------------

export interface EmailSummary {
  id: string;
  email_account_id: string;
  ha_message_id: string;
  subject: string;
  sender: string;
  snippet: string | null;
  is_read: boolean;
  is_important: boolean;
  received_at: string;
}

// ---------------------------------------------------------------------------
// Calendar events (from cache)
// ---------------------------------------------------------------------------

export interface CalendarEventInfo {
  id: string;
  calendar_account_id: string;
  ha_event_id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
}

// ---------------------------------------------------------------------------
// Alert rules
// ---------------------------------------------------------------------------

/** Conditions that trigger an alert. Shape depends on alert_type. */
export interface AlertRuleConditions {
  /** For important_email: match sender domain */
  from_domain?: string;
  /** For important_email: match sender address */
  from_address?: string;
  /** For upcoming_event / event_reminder: minutes before event start */
  minutes_before?: number;
  /** For unread_email: fire when unread count exceeds this */
  unread_threshold?: number;
  /** For important_email: subject keyword match */
  subject_contains?: string;
}

/** Action to execute when an alert fires. */
export interface AlertRuleAction {
  type: "activate_scene" | "notify" | "set_device";
  /** Scene name for activate_scene */
  scene?: string;
  /** Notification channel for notify */
  channel?: "push" | "telegram" | "whatsapp";
  /** Device entity_id + command for set_device */
  entity_id?: string;
  command?: string;
  parameters?: Record<string, unknown>;
}

export interface EmailCalendarAlertRule {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  alert_type: EmailCalendarAlertType;
  conditions: AlertRuleConditions;
  actions: AlertRuleAction[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

export interface EmailCalendarNotificationPrefs {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  email_digest_enabled: boolean;
  email_digest_time: string;
  calendar_reminder_minutes: number;
  notify_unread_threshold: number;
  preferred_channels: string[];
}

// ---------------------------------------------------------------------------
// HA Calendar API shapes (from Home Assistant REST API)
// ---------------------------------------------------------------------------

/** Calendar event as returned by HA GET /api/calendars/{entity_id} */
export interface HACalendarEvent {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  uid?: string;
  recurrence_id?: string;
  rrule?: string;
}

/** Payload for HA POST /api/services/calendar/create_event */
export interface HACalendarEventCreate {
  entity_id: string;
  summary: string;
  start_date_time?: string;
  end_date_time?: string;
  start_date?: string;
  end_date?: string;
  description?: string;
  location?: string;
}
