"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { createBrowserClient } from "@/lib/supabase/client";
import type { TenantSettings, MarketVertical } from "@clever/shared";

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

/**
 * Tenant settings page.
 * Configure property settings, voice settings, and audit retention.
 * Only accessible to admin and owner roles.
 */
export default function SettingsPage() {
  const { tenant, tenantId, isAdmin } = useAuth();
  const supabase = createBrowserClient();

  const [settings, setSettings] = useState<TenantSettings>({
    voice_enabled: true,
    max_devices: 25,
    max_users: 5,
    guest_wipe_enabled: false,
    audit_retention_days: 90,
  });
  const [propertyName, setPropertyName] = useState("");
  const [vertical, setVertical] = useState<MarketVertical>("clever_home");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Messaging / Notifications state
  const [msgLoaded, setMsgLoaded] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramUsername, setTelegramUsername] = useState<string | null>(null);
  const [telegramLinkUrl, setTelegramLinkUrl] = useState<string | null>(null);
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [whatsappVerified, setWhatsappVerified] = useState(false);
  const [whatsappSent, setWhatsappSent] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);
  const [notifyDeviceOffline, setNotifyDeviceOffline] = useState(true);
  const [notifySecurityAlert, setNotifySecurityAlert] = useState(true);
  const [notifyGuestArrival, setNotifyGuestArrival] = useState(false);
  const [notifyMaintenanceDue, setNotifyMaintenanceDue] = useState(false);
  const [savingMsg, setSavingMsg] = useState(false);
  const [msgSuccess, setMsgSuccess] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Load current settings from tenant */
  useEffect(() => {
    if (tenant) {
      setPropertyName(tenant.name);
      setVertical(tenant.vertical);
      setSettings(tenant.settings);
    }
  }, [tenant]);

  /** Load messaging preferences */
  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data } = await supabase
        .from("user_messaging_preferences")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (data) {
        setTelegramLinked(!!data.telegram_verified);
        setTelegramUsername(data.telegram_username ?? null);
        setWhatsappPhone(data.whatsapp_phone ?? "");
        setWhatsappVerified(!!data.whatsapp_verified);
        setWhatsappSent(!!data.whatsapp_phone);
        setEmailNotifications(data.email_notifications ?? true);
        setPushNotifications(data.push_notifications ?? true);
        setNotifyDeviceOffline(data.notify_device_offline ?? true);
        setNotifySecurityAlert(data.notify_security_alert ?? true);
        setNotifyGuestArrival(data.notify_guest_arrival ?? false);
        setNotifyMaintenanceDue(data.notify_maintenance_due ?? false);
      }
      setMsgLoaded(true);
    })();
  }, [tenantId, supabase]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const updateSetting = <K extends keyof TenantSettings>(
    key: K,
    value: TenantSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSuccess(false);
  };

  /** Save settings to Supabase */
  const handleSave = async () => {
    if (!tenantId) return;

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const { error: updateError } = await supabase
        .from("tenants")
        .update({
          name: propertyName,
          vertical,
          settings,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tenantId as string);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  /** Link Telegram */
  const handleLinkTelegram = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/telegram-link/generate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );
      const json = await res.json();
      if (json.success && json.data?.deep_link_url) {
        setTelegramLinkUrl(json.data.deep_link_url);
        let elapsed = 0;
        pollRef.current = setInterval(async () => {
          elapsed += 3000;
          if (elapsed > 120_000) { if (pollRef.current) clearInterval(pollRef.current); return; }
          const statusRes = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/telegram-link/status`,
            { headers: { Authorization: `Bearer ${session.access_token}` } },
          );
          const statusJson = await statusRes.json();
          if (statusJson.data?.linked) {
            setTelegramLinked(true);
            setTelegramUsername(statusJson.data.telegram_username ?? null);
            setTelegramLinkUrl(null);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        }, 3000);
      }
    } catch { /* non-fatal */ }
  };

  /** Unlink Telegram */
  const handleUnlinkTelegram = async () => {
    await supabase
      .from("user_messaging_preferences")
      .update({ telegram_chat_id: null, telegram_verified: false, telegram_username: null })
      .eq("tenant_id", tenantId as string);
    setTelegramLinked(false);
    setTelegramUsername(null);
  };

  /** Verify WhatsApp */
  const handleVerifyWhatsApp = async () => {
    if (!E164_REGEX.test(whatsappPhone)) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/whatsapp-verify`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ phone: whatsappPhone }),
        },
      );
      const json = await res.json();
      if (json.success) {
        setWhatsappSent(true);
        let elapsed = 0;
        const waPoll = setInterval(async () => {
          elapsed += 3000;
          if (elapsed > 120_000) { clearInterval(waPoll); return; }
          const statusRes = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/whatsapp-verify/status`,
            { headers: { Authorization: `Bearer ${session.access_token}` } },
          );
          const statusJson = await statusRes.json();
          if (statusJson.data?.verified) {
            setWhatsappVerified(true);
            clearInterval(waPoll);
          }
        }, 3000);
      }
    } catch { /* non-fatal */ }
  };

  /** Remove WhatsApp */
  const handleRemoveWhatsApp = async () => {
    await supabase
      .from("user_messaging_preferences")
      .update({ whatsapp_phone: null, whatsapp_verified: false })
      .eq("tenant_id", tenantId as string);
    setWhatsappPhone("");
    setWhatsappVerified(false);
    setWhatsappSent(false);
  };

  /** Save notification preferences */
  const handleSaveNotifications = async () => {
    if (!tenantId) return;
    setSavingMsg(true);
    setMsgSuccess(false);

    const channels: string[] = [];
    if (pushNotifications) channels.push("push");
    if (telegramLinked) channels.push("telegram");
    if (whatsappVerified) channels.push("whatsapp");
    if (emailNotifications) channels.push("email");

    const payload = {
      email_notifications: emailNotifications,
      push_notifications: pushNotifications,
      preferred_channels: channels,
      notify_device_offline: notifyDeviceOffline,
      notify_security_alert: notifySecurityAlert,
      notify_guest_arrival: notifyGuestArrival,
      notify_maintenance_due: notifyMaintenanceDue,
    };

    try {
      const { data: existing } = await supabase
        .from("user_messaging_preferences")
        .select("id")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (existing) {
        const { error: updateError } = await supabase
          .from("user_messaging_preferences")
          .update(payload)
          .eq("id", existing.id);
        if (updateError) { setError(updateError.message); return; }
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { error: insertError } = await supabase
          .from("user_messaging_preferences")
          .insert({ tenant_id: tenantId, user_id: user.id, ...payload });
        if (insertError) { setError(insertError.message); return; }
      }
      setMsgSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save notifications");
    } finally {
      setSavingMsg(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg font-semibold text-slate-900">Access Denied</p>
        <p className="mt-1 text-sm text-slate-500">
          You need admin or owner access to manage settings.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Configure your property, voice pipeline, and data retention policies
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Settings saved successfully.
        </div>
      )}

      {/* Property Configuration */}
      <section className="card">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Property Configuration
        </h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Property Name
            </label>
            <input
              type="text"
              value={propertyName}
              onChange={(e) => {
                setPropertyName(e.target.value);
                setSuccess(false);
              }}
              className="input-field max-w-md"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Market Vertical
            </label>
            <select
              value={vertical}
              onChange={(e) => {
                setVertical(e.target.value as MarketVertical);
                setSuccess(false);
              }}
              className="input-field max-w-md"
            >
              <option value="clever_home">CleverHome (Homebuilder)</option>
              <option value="clever_host">CleverHost (Airbnb/STR)</option>
              <option value="clever_building">CleverBuilding (Apartments)</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Subscription Tier
            </label>
            <p className="text-sm font-medium text-slate-900">
              {tenant?.subscription_tier
                ? tenant.subscription_tier.charAt(0).toUpperCase() +
                  tenant.subscription_tier.slice(1)
                : "Starter"}
            </p>
            <p className="text-xs text-slate-500">
              Contact support to upgrade your plan
            </p>
          </div>
        </div>
      </section>

      {/* Device Limits */}
      <section className="card">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Device & User Limits
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Maximum Devices
            </label>
            <input
              type="number"
              value={settings.max_devices}
              onChange={(e) =>
                updateSetting("max_devices", parseInt(e.target.value, 10) || 0)
              }
              min={1}
              max={1000}
              className="input-field"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Maximum Users
            </label>
            <input
              type="number"
              value={settings.max_users}
              onChange={(e) =>
                updateSetting("max_users", parseInt(e.target.value, 10) || 0)
              }
              min={1}
              max={500}
              className="input-field"
            />
          </div>
        </div>
      </section>

      {/* Voice Settings */}
      <section className="card">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Voice Pipeline Settings
        </h3>
        <div className="space-y-4">
          <label className="flex cursor-pointer items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium text-slate-900">
                Enable Voice Pipeline
              </p>
              <p className="text-xs text-slate-500">
                Enables the 3-tier voice command system (rules, cloud, local fallback)
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.voice_enabled}
              onChange={(e) => updateSetting("voice_enabled", e.target.checked)}
              className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
          </label>

          {settings.voice_enabled && (
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-xs text-slate-500">
                Voice pipeline configuration:
              </p>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                <li>Tier 1: Rules engine (50-200ms) - handles ~70% of commands</li>
                <li>Tier 2: Cloud streaming via Deepgram + Groq + Cartesia (580-900ms)</li>
                <li>Tier 3: Local fallback via Faster-Whisper + llama.cpp + Piper (3-5s)</li>
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Guest Wipe Settings (CleverHost only) */}
      {(vertical === "clever_host" || settings.guest_wipe_enabled) && (
        <section className="card">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">
            Guest Wipe Settings
          </h3>
          <label className="flex cursor-pointer items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium text-slate-900">
                Enable Guest Profile Wipe
              </p>
              <p className="text-xs text-slate-500">
                Automatically wipe all guest data between reservations: locks, WiFi,
                voice history, TV logins, preferences, and personal data
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.guest_wipe_enabled}
              onChange={(e) =>
                updateSetting("guest_wipe_enabled", e.target.checked)
              }
              className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
          </label>
        </section>
      )}

      {/* Audit Retention */}
      <section className="card">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Audit & Data Retention
        </h3>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Audit Log Retention (days)
          </label>
          <input
            type="number"
            value={settings.audit_retention_days}
            onChange={(e) =>
              updateSetting(
                "audit_retention_days",
                parseInt(e.target.value, 10) || 30
              )
            }
            min={30}
            max={365}
            className="input-field max-w-xs"
          />
          <p className="mt-1 text-xs text-slate-500">
            Audit logs older than this will be automatically archived. Minimum 30 days.
          </p>
        </div>
      </section>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      {/* ================================================================= */}
      {/* Notifications & Messaging */}
      {/* ================================================================= */}
      <div className="mt-12 border-t pt-8">
        <h2 className="text-2xl font-bold text-slate-900">Notifications & Messaging</h2>
        <p className="mt-1 text-sm text-slate-500">
          Configure how you receive alerts from CleverHub
        </p>
      </div>

      {msgSuccess && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Notification settings saved.
        </div>
      )}

      {/* Messaging Channels */}
      <section className="card">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Messaging Channels
        </h3>
        <div className="space-y-4">
          {/* Telegram */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500 text-white text-sm font-bold">
                TG
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">Telegram</p>
                {telegramLinked ? (
                  <p className="text-xs text-green-600">
                    Linked{telegramUsername ? ` (@${telegramUsername})` : ""}
                  </p>
                ) : telegramLinkUrl ? (
                  <p className="text-xs text-amber-600">Waiting for link...</p>
                ) : (
                  <p className="text-xs text-slate-500">Not connected</p>
                )}
              </div>
            </div>
            {telegramLinked ? (
              <button onClick={handleUnlinkTelegram} className="text-xs font-medium text-red-600 hover:text-red-700">
                Unlink
              </button>
            ) : telegramLinkUrl ? (
              <a
                href={telegramLinkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                Open in Telegram
              </a>
            ) : (
              <button onClick={handleLinkTelegram} className="btn-secondary text-xs">
                Link
              </button>
            )}
          </div>

          {/* WhatsApp */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500 text-white text-sm font-bold">
                  WA
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">WhatsApp</p>
                  {whatsappVerified ? (
                    <p className="text-xs text-green-600">Verified ({whatsappPhone})</p>
                  ) : whatsappSent ? (
                    <p className="text-xs text-amber-600">Pending verification</p>
                  ) : (
                    <p className="text-xs text-slate-500">Not connected</p>
                  )}
                </div>
              </div>
              {whatsappVerified && (
                <button onClick={handleRemoveWhatsApp} className="text-xs font-medium text-red-600 hover:text-red-700">
                  Remove
                </button>
              )}
            </div>
            {!whatsappVerified && (
              <div className="mt-3 flex gap-2">
                <input
                  type="tel"
                  value={whatsappPhone}
                  onChange={(e) => { setWhatsappPhone(e.target.value); setMsgSuccess(false); }}
                  placeholder="+15551234567"
                  disabled={whatsappSent}
                  className="input-field flex-1"
                />
                <button
                  onClick={handleVerifyWhatsApp}
                  disabled={whatsappSent || !whatsappPhone}
                  className="btn-secondary text-sm"
                >
                  {whatsappSent ? "Sent" : "Verify"}
                </button>
              </div>
            )}
            {whatsappSent && !whatsappVerified && (
              <p className="mt-2 text-xs text-slate-500">
                Reply <strong>YES</strong> in WhatsApp to confirm.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Standard Channels */}
      <section className="card">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Standard Channels
        </h3>
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium text-slate-900">Push Notifications</p>
              <p className="text-xs text-slate-500">In-app and device push alerts</p>
            </div>
            <input
              type="checkbox"
              checked={pushNotifications}
              onChange={(e) => { setPushNotifications(e.target.checked); setMsgSuccess(false); }}
              className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium text-slate-900">Email Notifications</p>
              <p className="text-xs text-slate-500">Receive alert summaries via email</p>
            </div>
            <input
              type="checkbox"
              checked={emailNotifications}
              onChange={(e) => { setEmailNotifications(e.target.checked); setMsgSuccess(false); }}
              className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
          </label>
        </div>
      </section>

      {/* Alert Types */}
      <section className="card">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Alert Types
        </h3>
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium text-slate-900">Device Offline</p>
              <p className="text-xs text-slate-500">Alert when a device goes offline</p>
            </div>
            <input
              type="checkbox"
              checked={notifyDeviceOffline}
              onChange={(e) => { setNotifyDeviceOffline(e.target.checked); setMsgSuccess(false); }}
              className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium text-slate-900">Security Alerts</p>
              <p className="text-xs text-slate-500">Motion detection, door sensors, alarms</p>
            </div>
            <input
              type="checkbox"
              checked={notifySecurityAlert}
              onChange={(e) => { setNotifySecurityAlert(e.target.checked); setMsgSuccess(false); }}
              className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
          </label>
          {(vertical === "clever_host" || notifyGuestArrival) && (
            <label className="flex cursor-pointer items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium text-slate-900">Guest Arrival</p>
                <p className="text-xs text-slate-500">Notifications when guests check in</p>
              </div>
              <input
                type="checkbox"
                checked={notifyGuestArrival}
                onChange={(e) => { setNotifyGuestArrival(e.target.checked); setMsgSuccess(false); }}
                className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
            </label>
          )}
          {(vertical === "clever_building" || notifyMaintenanceDue) && (
            <label className="flex cursor-pointer items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium text-slate-900">Maintenance Due</p>
                <p className="text-xs text-slate-500">Building maintenance reminders</p>
              </div>
              <input
                type="checkbox"
                checked={notifyMaintenanceDue}
                onChange={(e) => { setNotifyMaintenanceDue(e.target.checked); setMsgSuccess(false); }}
                className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
            </label>
          )}
        </div>
      </section>

      {/* Save Notification Settings */}
      <div className="flex justify-end">
        <button
          onClick={handleSaveNotifications}
          disabled={savingMsg}
          className="btn-primary"
        >
          {savingMsg ? "Saving..." : "Save Notification Settings"}
        </button>
      </div>
    </div>
  );
}
