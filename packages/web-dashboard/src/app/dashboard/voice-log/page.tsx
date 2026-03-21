"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useVoiceLog } from "@/hooks/useVoiceLog";
import type { VoiceTier } from "@clever/shared";

/**
 * Voice command log viewer.
 * Searchable transcript history with latency metrics and tier breakdown.
 * Displays real-time voice pipeline performance data.
 */
export default function VoiceLogPage() {
  const { tenantId } = useAuth();
  const {
    transcripts,
    loading,
    error,
    totalCount,
    avgLatencyMs,
    tierBreakdown,
    applyFilters,
    loadMore,
    hasMore,
  } = useVoiceLog(tenantId);

  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<VoiceTier | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const handleSearch = async () => {
    await applyFilters({
      search: search || undefined,
      tier: tierFilter || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
  };

  /** Tier display config */
  const tierConfig: Record<VoiceTier, { label: string; color: string; bgColor: string }> = {
    tier1_rules: {
      label: "Tier 1: Rules",
      color: "text-green-700",
      bgColor: "bg-green-50 ring-green-600/20",
    },
    tier2_cloud: {
      label: "Tier 2: Cloud",
      color: "text-blue-700",
      bgColor: "bg-blue-50 ring-blue-600/20",
    },
    tier3_local: {
      label: "Tier 3: Local",
      color: "text-amber-700",
      bgColor: "bg-amber-50 ring-amber-600/20",
    },
  };

  /** Latency color based on value */
  const latencyColor = (ms: number): string => {
    if (ms < 200) return "text-green-600";
    if (ms < 500) return "text-blue-600";
    if (ms < 1000) return "text-amber-600";
    return "text-red-600";
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-900">Voice Log</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Voice Command Log</h2>
        <p className="mt-1 text-sm text-slate-500">
          Searchable transcript history with latency metrics
        </p>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="card">
          <p className="text-sm font-medium text-slate-500">Total Commands</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{totalCount}</p>
        </div>
        <div className="card">
          <p className="text-sm font-medium text-slate-500">Avg Latency</p>
          <p className={`mt-1 text-3xl font-bold ${latencyColor(avgLatencyMs)}`}>
            {avgLatencyMs}ms
          </p>
        </div>
        {tierBreakdown.slice(0, 2).map((tier) => {
          const config = tierConfig[tier.tier];
          return (
            <div key={tier.tier} className="card">
              <p className="text-sm font-medium text-slate-500">
                {config?.label ?? tier.tier}
              </p>
              <p className="mt-1 text-3xl font-bold text-slate-900">
                {tier.percentage}%
              </p>
              <p className="text-xs text-slate-400">
                avg {tier.avgLatencyMs}ms
              </p>
            </div>
          );
        })}
      </div>

      {/* Tier breakdown bar chart */}
      <div className="card">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">
          Tier Distribution
        </h3>
        <div className="flex h-8 w-full overflow-hidden rounded-full">
          {tierBreakdown.map((tier) => {
            const colors: Record<VoiceTier, string> = {
              tier1_rules: "bg-green-500",
              tier2_cloud: "bg-blue-500",
              tier3_local: "bg-amber-500",
            };
            return (
              <div
                key={tier.tier}
                className={`${colors[tier.tier]} flex items-center justify-center text-xs font-semibold text-white transition-all`}
                style={{ width: `${Math.max(tier.percentage, 2)}%` }}
                title={`${tierConfig[tier.tier]?.label}: ${tier.percentage}%`}
              >
                {tier.percentage > 10 ? `${tier.percentage}%` : ""}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex justify-between text-xs">
          {tierBreakdown.map((tier) => {
            const config = tierConfig[tier.tier];
            return (
              <span key={tier.tier} className={config?.color ?? "text-slate-500"}>
                {config?.label}: {tier.count} ({tier.avgLatencyMs}ms avg)
              </span>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Search
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by intent or transcript..."
              className="input-field"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSearch();
              }}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Tier
            </label>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as VoiceTier | "")}
              className="input-field"
            >
              <option value="">All tiers</option>
              <option value="tier1_rules">Tier 1: Rules</option>
              <option value="tier2_cloud">Tier 2: Cloud</option>
              <option value="tier3_local">Tier 3: Local</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              From
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              To
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="input-field"
            />
          </div>
          <button onClick={handleSearch} className="btn-primary">
            Search
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Transcript list */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3">Time</th>
                <th className="px-6 py-3">Intent Summary</th>
                <th className="px-6 py-3">Tier</th>
                <th className="px-6 py-3">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transcripts.map((record) => {
                const config = tierConfig[record.tier_used];
                return (
                  <tr key={record.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {new Date(record.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-slate-900">{record.intent_summary}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${config?.bgColor ?? ""} ${config?.color ?? ""}`}
                      >
                        {config?.label ?? record.tier_used}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`text-sm font-medium ${latencyColor(record.latency_ms)}`}
                      >
                        {record.latency_ms}ms
                      </span>
                    </td>
                  </tr>
                );
              })}
              {transcripts.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-12 text-center text-sm text-slate-500"
                  >
                    No voice commands recorded yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Load more */}
      {hasMore && transcripts.length > 0 && (
        <div className="text-center">
          <button onClick={loadMore} className="btn-secondary">
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
