"use client";

import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDevices } from "@/hooks/useDevices";
import { useVoiceLog } from "@/hooks/useVoiceLog";
import { DeviceGrid } from "@/components/devices/DeviceGrid";
import type { DeviceCategory } from "@clever/shared";

/**
 * Main dashboard page: real-time device status grid with summary metrics.
 * Shows live device states via Supabase Realtime subscription.
 */
export default function DashboardPage() {
  const { tenantId, tenant } = useAuth();
  const { devices, loading, error, toggleDevice } = useDevices(tenantId);
  const { totalCount: voiceCount, avgLatencyMs, tierBreakdown } = useVoiceLog(tenantId);

  /** Compute summary metrics */
  const metrics = useMemo(() => {
    const total = devices.length;
    const online = devices.filter((d) => d.is_online).length;
    const active = devices.filter((d) => d.state === "on" || d.state === "unlocked").length;
    const offline = total - online;

    /** Count by category */
    const categories = new Map<DeviceCategory, number>();
    for (const d of devices) {
      categories.set(d.category, (categories.get(d.category) ?? 0) + 1);
    }

    /** Unique rooms */
    const rooms = new Set(devices.map((d) => d.room));

    return { total, online, active, offline, categories, roomCount: rooms.size };
  }, [devices]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-4 w-20 rounded bg-slate-200" />
              <div className="mt-3 h-8 w-16 rounded bg-slate-200" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h3 className="text-sm font-semibold text-red-800">Error loading devices</h3>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page title */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          {tenant?.name ?? "Dashboard"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Real-time overview of your smart home devices
        </p>
      </div>

      {/* Summary metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <p className="text-sm font-medium text-slate-500">Total Devices</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{metrics.total}</p>
          <p className="mt-1 text-xs text-slate-400">
            across {metrics.roomCount} rooms
          </p>
        </div>

        <div className="card">
          <p className="text-sm font-medium text-slate-500">Online</p>
          <p className="mt-1 text-3xl font-bold text-green-600">{metrics.online}</p>
          <p className="mt-1 text-xs text-slate-400">
            {metrics.offline > 0 && (
              <span className="text-red-500">{metrics.offline} offline</span>
            )}
            {metrics.offline === 0 && "All devices connected"}
          </p>
        </div>

        <div className="card">
          <p className="text-sm font-medium text-slate-500">Active</p>
          <p className="mt-1 text-3xl font-bold text-brand-600">{metrics.active}</p>
          <p className="mt-1 text-xs text-slate-400">
            devices currently on or unlocked
          </p>
        </div>

        <div className="card">
          <p className="text-sm font-medium text-slate-500">Voice Commands</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{voiceCount}</p>
          <p className="mt-1 text-xs text-slate-400">
            avg {avgLatencyMs}ms latency
          </p>
        </div>
      </div>

      {/* Voice tier breakdown */}
      {tierBreakdown.length > 0 && (
        <div className="card">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">
            Voice Pipeline Tier Distribution
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {tierBreakdown.map((tier) => {
              const tierLabels: Record<string, string> = {
                tier1_rules: "Tier 1: Rules Engine",
                tier2_cloud: "Tier 2: Cloud Streaming",
                tier3_local: "Tier 3: Local Fallback",
              };
              const tierColors: Record<string, string> = {
                tier1_rules: "bg-green-500",
                tier2_cloud: "bg-blue-500",
                tier3_local: "bg-amber-500",
              };

              return (
                <div key={tier.tier} className="text-center">
                  <div className="mx-auto mb-2 h-2 w-full rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${tierColors[tier.tier] ?? "bg-slate-400"}`}
                      style={{ width: `${tier.percentage}%` }}
                    />
                  </div>
                  <p className="text-xs font-medium text-slate-700">
                    {tierLabels[tier.tier] ?? tier.tier}
                  </p>
                  <p className="text-lg font-bold text-slate-900">{tier.percentage}%</p>
                  <p className="text-xs text-slate-400">
                    {tier.count} commands, avg {tier.avgLatencyMs}ms
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Device grid */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-slate-900">All Devices</h3>
        <DeviceGrid
          devices={devices}
          onToggle={toggleDevice}
          groupByRoom
          emptyMessage="No devices registered yet. Connect a Raspberry Pi hub to get started."
        />
      </div>
    </div>
  );
}
