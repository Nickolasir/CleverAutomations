"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

/**
 * Email & Calendar monitoring dashboard page.
 *
 * Shows linked email/calendar accounts, unread email summaries,
 * upcoming calendar events, alert rules, and notification preferences.
 *
 * NOTE: Email sending is hard-disabled via EMAIL_SEND_ENABLED feature flag.
 * No compose/send UI is rendered.
 */

// ---------------------------------------------------------------------------
// Types (mirroring @clever/shared for the web dashboard)
// ---------------------------------------------------------------------------

interface EmailAccount {
  id: string;
  provider: "gmail" | "outlook";
  display_name_encrypted: string;
  email_address_encrypted: string;
  ha_inbox_entity_id: string;
  is_active: boolean;
  last_synced_at: string | null;
}

interface CalendarAccount {
  id: string;
  provider: "google_calendar" | "outlook_calendar";
  ha_entity_id: string;
  display_name: string;
  is_primary: boolean;
  sync_enabled: boolean;
  last_synced_at: string | null;
}

interface EmailCacheEntry {
  id: string;
  subject_encrypted: string;
  sender_encrypted: string;
  snippet_encrypted: string | null;
  is_read: boolean;
  is_important: boolean;
  received_at: string;
}

interface CalendarEventEntry {
  id: string;
  summary_encrypted: string;
  location_encrypted: string | null;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
}

interface AlertRule {
  id: string;
  alert_type: string;
  conditions: Record<string, unknown>;
  actions: Array<{ type: string; scene?: string; channel?: string }>;
  is_active: boolean;
}

interface NotificationPrefs {
  email_digest_enabled: boolean;
  email_digest_time: string;
  calendar_reminder_minutes: number;
  notify_unread_threshold: number;
  preferred_channels: string[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EmailCalendarPage() {
  const { tenantId, userId, supabase } = useAuth();

  const [activeTab, setActiveTab] = useState<"inbox" | "calendar" | "rules" | "settings">("inbox");
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [calendarAccounts, setCalendarAccounts] = useState<CalendarAccount[]>([]);
  const [emails, setEmails] = useState<EmailCacheEntry[]>([]);
  const [events, setEvents] = useState<CalendarEventEntry[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId || !userId || !supabase) return;
    loadData();
  }, [tenantId, userId, supabase]);

  async function loadData() {
    if (!supabase || !tenantId || !userId) return;
    setLoading(true);

    const [
      { data: eAccounts },
      { data: cAccounts },
      { data: emailData },
      { data: eventData },
      { data: rulesData },
      { data: prefsData },
    ] = await Promise.all([
      supabase.from("email_accounts").select("*").eq("tenant_id", tenantId).eq("user_id", userId),
      supabase.from("calendar_accounts").select("*").eq("tenant_id", tenantId).eq("user_id", userId),
      supabase.from("email_cache").select("*").eq("tenant_id", tenantId).order("received_at", { ascending: false }).limit(50),
      supabase.from("calendar_event_cache").select("*").eq("tenant_id", tenantId).gte("start_time", new Date().toISOString()).order("start_time", { ascending: true }).limit(20),
      supabase.from("email_calendar_alert_rules").select("*").eq("tenant_id", tenantId).eq("user_id", userId),
      supabase.from("email_calendar_notification_prefs").select("*").eq("tenant_id", tenantId).eq("user_id", userId).single(),
    ]);

    setEmailAccounts(eAccounts ?? []);
    setCalendarAccounts(cAccounts ?? []);
    setEmails(emailData ?? []);
    setEvents(eventData ?? []);
    setAlertRules(rulesData ?? []);
    setNotifPrefs(prefsData ?? null);
    setLoading(false);
  }

  const totalUnread = emails.filter((e) => !e.is_read).length;

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-slate-900">Email & Calendar</h2>
        <div className="card animate-pulse">
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 rounded bg-slate-200" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">Email & Calendar</h2>
        <div className="flex gap-2 text-sm">
          <span className="badge badge-amber">{totalUnread} unread</span>
          <span className="badge badge-neutral">{events.length} upcoming</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {(["inbox", "calendar", "rules", "settings"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-white text-amber-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tab === "inbox" ? "Inbox" : tab === "calendar" ? "Calendar" : tab === "rules" ? "Alert Rules" : "Settings"}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "inbox" && (
        <div className="space-y-4">
          {/* Linked accounts summary */}
          <div className="flex gap-4">
            {emailAccounts.map((acc) => (
              <div key={acc.id} className="card flex items-center gap-3 px-4 py-3">
                <div className={`h-3 w-3 rounded-full ${acc.is_active ? "bg-green-500" : "bg-slate-300"}`} />
                <span className="text-sm font-medium">
                  {acc.provider === "outlook" ? "Outlook" : "Gmail"}
                </span>
                <span className="text-xs text-slate-500">
                  {acc.last_synced_at ? `Synced ${new Date(acc.last_synced_at).toLocaleTimeString()}` : "Not synced"}
                </span>
              </div>
            ))}
            {emailAccounts.length === 0 && (
              <div className="card w-full py-8 text-center text-slate-500">
                No email accounts linked. Configure in Home Assistant first.
              </div>
            )}
          </div>

          {/* Email list */}
          <div className="card divide-y">
            {emails.length === 0 ? (
              <div className="py-8 text-center text-slate-500">No emails in cache.</div>
            ) : (
              emails.map((email) => (
                <div
                  key={email.id}
                  className={`flex items-center gap-4 px-4 py-3 ${!email.is_read ? "bg-amber-50" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {!email.is_read && <span className="h-2 w-2 rounded-full bg-amber-500" />}
                      {email.is_important && <span className="text-xs text-red-600 font-bold">!</span>}
                      <span className={`text-sm truncate ${!email.is_read ? "font-semibold" : ""}`}>
                        {email.sender_encrypted}
                      </span>
                    </div>
                    <div className="text-sm text-slate-600 truncate">{email.subject_encrypted}</div>
                    {email.snippet_encrypted && (
                      <div className="text-xs text-slate-400 truncate">{email.snippet_encrypted}</div>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 whitespace-nowrap">
                    {new Date(email.received_at).toLocaleDateString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === "calendar" && (
        <div className="space-y-4">
          {/* Linked calendars */}
          <div className="flex gap-4">
            {calendarAccounts.map((cal) => (
              <div key={cal.id} className="card flex items-center gap-3 px-4 py-3">
                <div className={`h-3 w-3 rounded-full ${cal.sync_enabled ? "bg-green-500" : "bg-slate-300"}`} />
                <span className="text-sm font-medium">{cal.display_name}</span>
                {cal.is_primary && <span className="badge badge-amber text-xs">Primary</span>}
              </div>
            ))}
            {calendarAccounts.length === 0 && (
              <div className="card w-full py-8 text-center text-slate-500">
                No calendar accounts linked. Configure in Home Assistant first.
              </div>
            )}
          </div>

          {/* Event list */}
          <div className="card divide-y">
            {events.length === 0 ? (
              <div className="py-8 text-center text-slate-500">No upcoming events.</div>
            ) : (
              events.map((event) => (
                <div key={event.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="flex flex-col items-center justify-center rounded-lg bg-amber-100 px-3 py-2 text-amber-800">
                    <span className="text-xs font-medium">
                      {new Date(event.start_time).toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                    <span className="text-lg font-bold">
                      {new Date(event.start_time).getDate()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{event.summary_encrypted}</div>
                    {event.is_all_day ? (
                      <div className="text-xs text-slate-500">All day</div>
                    ) : (
                      <div className="text-xs text-slate-500">
                        {new Date(event.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {" - "}
                        {new Date(event.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                    {event.location_encrypted && (
                      <div className="text-xs text-slate-400">{event.location_encrypted}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === "rules" && (
        <div className="space-y-4">
          <div className="card divide-y">
            {alertRules.length === 0 ? (
              <div className="py-8 text-center text-slate-500">
                No alert rules configured. Add rules to trigger automations based on email/calendar events.
              </div>
            ) : (
              alertRules.map((rule) => (
                <div key={rule.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">
                      {rule.alert_type.replace(/_/g, " ")}
                    </div>
                    <div className="text-xs text-slate-500">
                      {rule.actions.map((a) => a.type.replace(/_/g, " ")).join(", ")}
                    </div>
                  </div>
                  <div className={`h-3 w-3 rounded-full ${rule.is_active ? "bg-green-500" : "bg-slate-300"}`} />
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === "settings" && (
        <div className="space-y-4">
          <div className="card space-y-6 p-6">
            <h3 className="text-lg font-semibold">Notification Preferences</h3>

            <div className="space-y-4">
              <label className="flex items-center justify-between">
                <span className="text-sm">Email digest enabled</span>
                <input
                  type="checkbox"
                  checked={notifPrefs?.email_digest_enabled ?? true}
                  className="toggle toggle-amber"
                  readOnly
                />
              </label>

              <label className="flex items-center justify-between">
                <span className="text-sm">Digest time</span>
                <input
                  type="time"
                  value={notifPrefs?.email_digest_time ?? "08:00"}
                  className="input input-sm w-32"
                  readOnly
                />
              </label>

              <label className="flex items-center justify-between">
                <span className="text-sm">Calendar reminder (minutes before)</span>
                <input
                  type="number"
                  value={notifPrefs?.calendar_reminder_minutes ?? 15}
                  className="input input-sm w-20"
                  readOnly
                />
              </label>

              <label className="flex items-center justify-between">
                <span className="text-sm">Unread threshold for alert</span>
                <input
                  type="number"
                  value={notifPrefs?.notify_unread_threshold ?? 5}
                  className="input input-sm w-20"
                  readOnly
                />
              </label>

              <div className="flex items-center justify-between">
                <span className="text-sm">Preferred channels</span>
                <span className="text-sm text-slate-500">
                  {notifPrefs?.preferred_channels?.join(", ") ?? "push"}
                </span>
              </div>
            </div>
          </div>

          {/* Account linking info */}
          <div className="card space-y-4 p-6">
            <h3 className="text-lg font-semibold">Linked Accounts</h3>
            <p className="text-sm text-slate-500">
              Email and calendar accounts are managed through Home Assistant integrations.
              To add or remove accounts, use your HA Settings &gt; Integrations page.
            </p>
            <div className="space-y-2">
              <div className="text-sm font-medium">Email: {emailAccounts.length} linked</div>
              <div className="text-sm font-medium">Calendar: {calendarAccounts.length} linked</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
