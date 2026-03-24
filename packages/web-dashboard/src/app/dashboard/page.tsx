"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDevices } from "@/hooks/useDevices";
import { useVoiceLog } from "@/hooks/useVoiceLog";
import { DeviceGrid } from "@/components/devices/DeviceGrid";
import { createBrowserClient } from "@/lib/supabase/client";
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
          {tenant?.vertical === "clever_host"
            ? `Welcome, ${tenant?.name ?? "Host"}`
            : tenant?.vertical === "clever_building"
              ? `${tenant?.name ?? "Building"} Dashboard`
              : `Welcome home${tenant?.name ? `, ${tenant.name}` : ""}`}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {tenant?.vertical === "clever_host"
            ? "Manage your rental property and guest experience"
            : tenant?.vertical === "clever_building"
              ? "Monitor your building systems and tenants"
              : "Real-time overview of your smart home"}
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

      {/* Vertical-specific sections */}
      {tenant?.vertical === "clever_home" && <FamilyActivitySection tenantId={tenantId} />}
      {tenant?.vertical === "clever_host" && <GuestSummarySection tenantId={tenantId} />}

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

/** CleverHome: Family activity summary */
function FamilyActivitySection({ tenantId }: { tenantId: string | null }) {
  const supabase = createBrowserClient();
  const [members, setMembers] = useState<{ id: string; agent_name: string; age_group: string; is_active: boolean; display_name?: string }[]>([]);
  const [scheduleCount, setScheduleCount] = useState(0);

  const fetchFamily = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase
      .from("family_member_profiles")
      .select("id, agent_name, age_group, is_active, users!inner(display_name)")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(6);

    if (data) {
      setMembers(data.map((m: any) => ({
        id: m.id,
        agent_name: m.agent_name,
        age_group: m.age_group,
        is_active: m.is_active,
        display_name: m.users?.display_name,
      })));
    }

    const { count } = await supabase
      .from("family_schedules")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_active", true);

    setScheduleCount(count ?? 0);
  }, [tenantId, supabase]);

  useEffect(() => { void fetchFamily(); }, [fetchFamily]);

  const ageColors: Record<string, string> = {
    adult: "bg-brand-100 text-brand-800",
    teenager: "bg-purple-100 text-purple-800",
    tween: "bg-blue-100 text-blue-800",
    child: "bg-green-100 text-green-800",
    toddler: "bg-pink-100 text-pink-800",
    adult_visitor: "bg-slate-100 text-slate-700",
    assisted_living: "bg-amber-100 text-amber-800",
  };

  if (members.length === 0) {
    return (
      <div className="card">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Family Members</h3>
        <p className="text-sm text-slate-500">
          No family profiles set up yet.{" "}
          <a href="/dashboard/family" className="font-medium text-brand-600 hover:text-brand-700">
            Add your first family member
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Family Members</h3>
        <a href="/dashboard/family" className="text-xs font-medium text-brand-600 hover:text-brand-700">
          Manage Family &rarr;
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 rounded-lg border border-slate-100 p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
              {(m.display_name ?? m.agent_name).split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{m.display_name ?? m.agent_name}</p>
              <div className="flex items-center gap-2">
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${ageColors[m.age_group] ?? "bg-slate-100 text-slate-600"}`}>
                  {m.age_group.replace("_", " ")}
                </span>
                <span className="text-[10px] text-slate-400">Hey {m.agent_name}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {scheduleCount > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          {scheduleCount} active schedule{scheduleCount !== 1 ? "s" : ""} running
        </p>
      )}
    </div>
  );
}

/** CleverHost: Guest summary */
function GuestSummarySection({ tenantId }: { tenantId: string | null }) {
  const supabase = createBrowserClient();
  const [activeGuests, setActiveGuests] = useState(0);
  const [upcomingCheckins, setUpcomingCheckins] = useState(0);

  const fetchGuests = useCallback(async () => {
    if (!tenantId) return;

    const { count: active } = await supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "checked_in");

    setActiveGuests(active ?? 0);

    const now = new Date().toISOString();
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();
    const { count: upcoming } = await supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "confirmed")
      .gte("check_in", now)
      .lte("check_in", nextWeek);

    setUpcomingCheckins(upcoming ?? 0);
  }, [tenantId, supabase]);

  useEffect(() => { void fetchGuests(); }, [fetchGuests]);

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Guest Activity</h3>
        <a href="/dashboard/guests" className="text-xs font-medium text-brand-600 hover:text-brand-700">
          Manage Guests &rarr;
        </a>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-green-50 p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{activeGuests}</p>
          <p className="text-xs text-green-600">Currently checked in</p>
        </div>
        <div className="rounded-lg bg-brand-50 p-4 text-center">
          <p className="text-2xl font-bold text-brand-700">{upcomingCheckins}</p>
          <p className="text-xs text-brand-600">Check-ins this week</p>
        </div>
      </div>
    </div>
  );
}
