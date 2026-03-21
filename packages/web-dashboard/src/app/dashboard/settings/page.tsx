"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { createBrowserClient } from "@/lib/supabase/client";
import type { TenantSettings, MarketVertical } from "@clever/shared";

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

  /** Load current settings from tenant */
  useEffect(() => {
    if (tenant) {
      setPropertyName(tenant.name);
      setVertical(tenant.vertical);
      setSettings(tenant.settings);
    }
  }, [tenant]);

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
    </div>
  );
}
