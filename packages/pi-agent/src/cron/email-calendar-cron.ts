/**
 * Email & Calendar Alert Cron
 *
 * Runs on the Pi Agent at regular intervals. Handles three tasks:
 *   1. Email digest — sends daily email summary at user's configured time
 *   2. Calendar reminders — alerts users N minutes before upcoming events
 *   3. Event-triggered automations — executes scene/device actions based on alert rules
 *
 * Uses HA entity states for real-time inbox/calendar data and the local cache
 * for enriched summaries. Delivers notifications via the existing MessagingGateway.
 */

import type { createClient } from "@supabase/supabase-js";
import type {
  EmailCalendarAlertRule,
  AlertRuleAction,
  CalendarEventInfo,
} from "@clever/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailCalendarCronConfig {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  /** Send a notification via the user's preferred channel. */
  sendNotification: (
    userId: string,
    channels: string[],
    title: string,
    body: string,
  ) => Promise<void>;
  /** Activate a Home Assistant scene by name. */
  activateScene: (sceneName: string) => Promise<void>;
  /** Get the current unread count from an HA inbox sensor entity. */
  getHAEntityState: (entityId: string) => Promise<{ state: string; attributes: Record<string, unknown> } | null>;
}

// Track sent reminders to avoid duplicates within same cron cycle
const sentCalendarReminders = new Set<string>();
const sentDigests = new Set<string>();

// ---------------------------------------------------------------------------
// Email digest cron — runs every minute, fires at user's configured time
// ---------------------------------------------------------------------------

export async function emailDigestTick(config: EmailCalendarCronConfig): Promise<void> {
  const { supabase, tenantId } = config;

  // 1. Get all users with email digest enabled
  const { data: prefs } = await (supabase.from("email_calendar_notification_prefs") as any)
    .select("user_id, email_digest_time, preferred_channels")
    .eq("tenant_id", tenantId)
    .eq("email_digest_enabled", true);

  if (!prefs?.length) return;

  const now = new Date();
  const currentHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  for (const pref of prefs) {
    // Check if current time matches digest time (within same minute)
    if (pref.email_digest_time !== currentHHMM) continue;

    // Prevent duplicate sends within same minute
    const digestKey = `${pref.user_id}-${currentHHMM}-${now.toISOString().slice(0, 10)}`;
    if (sentDigests.has(digestKey)) continue;
    sentDigests.add(digestKey);

    // 2. Get user's email accounts
    const { data: accounts } = await (supabase.from("email_accounts") as any)
      .select("id, display_name_encrypted, ha_inbox_entity_id, provider")
      .eq("tenant_id", tenantId)
      .eq("user_id", pref.user_id)
      .eq("is_active", true);

    if (!accounts?.length) continue;

    // 3. Build digest from HA sensor states
    const digestLines: string[] = [];
    let totalUnread = 0;

    for (const account of accounts) {
      const sensorState = await config.getHAEntityState(account.ha_inbox_entity_id);
      if (!sensorState) continue;

      const unread = parseInt(sensorState.state, 10) || 0;
      totalUnread += unread;

      if (unread > 0) {
        digestLines.push(
          `${account.provider === "outlook" ? "Outlook" : "Gmail"}: ${unread} unread`,
        );
      }
    }

    if (totalUnread === 0) continue; // Nothing to report

    // 4. Get recent cached emails for summary
    const { data: recentEmails } = await (supabase.from("email_cache") as any)
      .select("subject_encrypted, sender_encrypted, is_important")
      .eq("tenant_id", tenantId)
      .in(
        "email_account_id",
        accounts.map((a: any) => a.id),
      )
      .eq("is_read", false)
      .order("received_at", { ascending: false })
      .limit(5);

    if (recentEmails?.length) {
      digestLines.push("");
      digestLines.push("Latest unread:");
      for (const email of recentEmails) {
        const flag = email.is_important ? "[!] " : "";
        // Note: subject/sender are encrypted — the notification service
        // will need to decrypt via the edge function or pass through
        digestLines.push(`  ${flag}${email.sender_encrypted}: ${email.subject_encrypted}`);
      }
    }

    // 5. Send notification
    const title = `Email Digest — ${totalUnread} unread`;
    const body = digestLines.join("\n");

    await config.sendNotification(
      pref.user_id,
      pref.preferred_channels,
      title,
      body,
    );
  }
}

// ---------------------------------------------------------------------------
// Calendar reminder cron — runs every minute
// ---------------------------------------------------------------------------

export async function calendarReminderTick(config: EmailCalendarCronConfig): Promise<void> {
  const { supabase, tenantId } = config;

  // 1. Get all users with calendar reminder preferences
  const { data: prefs } = await (supabase.from("email_calendar_notification_prefs") as any)
    .select("user_id, calendar_reminder_minutes, preferred_channels")
    .eq("tenant_id", tenantId);

  if (!prefs?.length) return;

  const now = new Date();

  for (const pref of prefs) {
    const reminderMinutes = pref.calendar_reminder_minutes ?? 15;

    // 2. Get upcoming events that start within the reminder window
    const windowStart = now.toISOString();
    const windowEnd = new Date(now.getTime() + reminderMinutes * 60_000).toISOString();

    const { data: events } = await (supabase.from("calendar_event_cache") as any)
      .select(`
        id, summary_encrypted, location_encrypted, start_time, end_time, is_all_day,
        calendar_account_id,
        calendar_accounts!inner(user_id, tenant_id)
      `)
      .eq("calendar_accounts.user_id", pref.user_id)
      .eq("calendar_accounts.tenant_id", tenantId)
      .gte("start_time", windowStart)
      .lte("start_time", windowEnd)
      .eq("is_all_day", false);

    if (!events?.length) continue;

    for (const event of events) {
      // Prevent duplicate reminders for same event
      const reminderKey = `${event.id}-${now.toISOString().slice(0, 16)}`;
      if (sentCalendarReminders.has(reminderKey)) continue;
      sentCalendarReminders.add(reminderKey);

      const minutesUntil = Math.round(
        (new Date(event.start_time).getTime() - now.getTime()) / 60_000,
      );

      const location = event.location_encrypted ? ` @ ${event.location_encrypted}` : "";
      const title = "Calendar Reminder";
      const body = `"${event.summary_encrypted}" starts in ${minutesUntil} minutes${location}`;

      await config.sendNotification(
        pref.user_id,
        pref.preferred_channels,
        title,
        body,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Event-triggered automation cron — runs every minute
// ---------------------------------------------------------------------------

export async function eventAutomationTick(config: EmailCalendarCronConfig): Promise<void> {
  const { supabase, tenantId } = config;

  // 1. Get all active alert rules
  const { data: rules } = await (supabase.from("email_calendar_alert_rules") as any)
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  if (!rules?.length) return;

  const now = new Date();

  for (const rule of rules as EmailCalendarAlertRule[]) {
    switch (rule.alert_type) {
      case "event_started": {
        // Check if any event is starting right now (within 1 minute)
        const windowStart = new Date(now.getTime() - 30_000).toISOString();
        const windowEnd = new Date(now.getTime() + 30_000).toISOString();

        const { data: startingEvents } = await (supabase.from("calendar_event_cache") as any)
          .select("id, summary_encrypted, calendar_account_id, calendar_accounts!inner(user_id)")
          .eq("calendar_accounts.user_id", rule.user_id)
          .gte("start_time", windowStart)
          .lte("start_time", windowEnd);

        if (startingEvents?.length) {
          for (const action of rule.actions) {
            await executeAlertAction(action, config);
          }
        }
        break;
      }

      case "unread_email": {
        const threshold = rule.conditions.unread_threshold ?? 10;

        // Get user's email accounts
        const { data: accounts } = await (supabase.from("email_accounts") as any)
          .select("ha_inbox_entity_id")
          .eq("tenant_id", tenantId)
          .eq("user_id", rule.user_id)
          .eq("is_active", true);

        if (!accounts?.length) break;

        let totalUnread = 0;
        for (const acc of accounts) {
          const state = await config.getHAEntityState(acc.ha_inbox_entity_id);
          if (state) {
            totalUnread += parseInt(state.state, 10) || 0;
          }
        }

        if (totalUnread >= threshold) {
          for (const action of rule.actions) {
            await executeAlertAction(action, config);
          }
        }
        break;
      }

      // Other alert types (important_email, upcoming_event, daily_digest)
      // can be added here following the same pattern
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Execute an alert rule action
// ---------------------------------------------------------------------------

async function executeAlertAction(
  action: AlertRuleAction,
  config: EmailCalendarCronConfig,
): Promise<void> {
  switch (action.type) {
    case "activate_scene":
      if (action.scene) {
        await config.activateScene(action.scene);
      }
      break;

    case "notify":
      // Notification actions are handled by the reminder/digest crons
      break;

    case "set_device":
      // Device actions could be routed through the command executor
      // For now, log that it was triggered
      console.log(
        `[EmailCalendarCron] set_device action triggered: ${action.entity_id} ${action.command}`,
      );
      break;
  }
}

// ---------------------------------------------------------------------------
// Combined tick — call this from the Pi Agent's main cron loop
// ---------------------------------------------------------------------------

export async function emailCalendarCronTick(config: EmailCalendarCronConfig): Promise<void> {
  await Promise.all([
    emailDigestTick(config).catch((err) =>
      console.error("[EmailCalendarCron] Digest tick failed:", err),
    ),
    calendarReminderTick(config).catch((err) =>
      console.error("[EmailCalendarCron] Reminder tick failed:", err),
    ),
    eventAutomationTick(config).catch((err) =>
      console.error("[EmailCalendarCron] Automation tick failed:", err),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Cleanup stale tracking data (call periodically, e.g., every hour)
// ---------------------------------------------------------------------------

export function cleanupStaleTrackingData(): void {
  // These sets grow over time; clear them periodically
  sentCalendarReminders.clear();
  sentDigests.clear();
}
