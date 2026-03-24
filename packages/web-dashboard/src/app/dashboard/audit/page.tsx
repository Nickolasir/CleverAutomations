"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { createBrowserClient } from "@/lib/supabase/client";
import type { AuditLog, AuditAction } from "@clever/shared";

const ACTION_LABELS: Record<AuditAction, string> = {
  device_state_change: "Device State Change",
  device_command_issued: "Command Issued",
  device_registered: "Device Registered",
  device_removed: "Device Removed",
  user_login: "User Login",
  user_logout: "User Logout",
  user_created: "User Created",
  user_deleted: "User Deleted",
  scene_activated: "Scene Activated",
  automation_triggered: "Automation Triggered",
  guest_profile_created: "Guest Profile Created",
  guest_profile_wiped: "Guest Profile Wiped",
  voice_command_processed: "Voice Command",
  settings_changed: "Settings Changed",
  pantry_item_added: "Pantry Item Added",
  pantry_item_removed: "Pantry Item Removed",
  pantry_item_updated: "Pantry Item Updated",
  shopping_list_item_added: "Shopping List Item Added",
  shopping_list_item_removed: "Shopping List Item Removed",
  shopping_list_item_checked: "Shopping List Item Checked",
  receipt_scanned: "Receipt Scanned",
  pantry_photo_analyzed: "Pantry Photo Analyzed",
};

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const { tenantId, canViewAuditLog } = useAuth();
  const supabase = createBrowserClient();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);

  const [actionFilter, setActionFilter] = useState<AuditAction | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchLogs = useCallback(
    async (currentOffset: number, append = false) => {
      if (!tenantId) return;
      try {
        setError(null);
        let query = supabase
          .from("audit_logs")
          .select("*", { count: "exact" })
          .eq("tenant_id", tenantId as string)
          .order("timestamp", { ascending: false })
          .range(currentOffset, currentOffset + PAGE_SIZE - 1);

        if (actionFilter) {
          query = query.eq("action", actionFilter);
        }
        if (dateFrom) {
          query = query.gte("timestamp", dateFrom);
        }
        if (dateTo) {
          query = query.lte("timestamp", dateTo);
        }

        const { data, count, error: fetchError } = await query;
        if (fetchError) { setError(fetchError.message); return; }

        const records = (data as unknown as AuditLog[]) ?? [];
        if (append) { setLogs((prev) => [...prev, ...records]); }
        else { setLogs(records); }
        setTotalCount(count ?? 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch audit logs");
      } finally {
        setLoading(false);
      }
    },
    [tenantId, supabase, actionFilter, dateFrom, dateTo]
  );

  useEffect(() => {
    setOffset(0);
    setLoading(true);
    void fetchLogs(0);
  }, [fetchLogs]);

  const loadMore = async () => {
    const newOffset = offset + PAGE_SIZE;
    setOffset(newOffset);
    await fetchLogs(newOffset, true);
  };

  const hasMore = logs.length < totalCount;

  const actionBadgeColor = (action: AuditAction): string => {
    if (action.startsWith("user_")) return "badge-info";
    if (action.startsWith("device_")) return "badge-success";
    if (action.startsWith("guest_")) return "badge-warning";
    if (action.startsWith("voice_")) return "badge-info";
    return "badge-neutral";
  };

  if (!canViewAuditLog) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg font-semibold text-slate-900">Access Denied</p>
        <p className="mt-1 text-sm text-slate-500">You need admin access to view audit logs.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-900">Audit Log</h2>
        <div className="card animate-pulse">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 rounded bg-slate-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Audit Log</h2>
        <p className="mt-1 text-sm text-slate-500">
          {totalCount} event{totalCount !== 1 ? "s" : ""} recorded
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Action Type</label>
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value as AuditAction | "")} className="input-field">
              <option value="">All actions</option>
              {(Object.keys(ACTION_LABELS) as AuditAction[]).map((action) => (
                <option key={action} value={action}>{ACTION_LABELS[action]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" />
          </div>
        </div>
      </div>

      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3">Timestamp</th>
                <th className="px-6 py-3">Action</th>
                <th className="px-6 py-3">User</th>
                <th className="px-6 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4 text-xs text-slate-500">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="px-6 py-4">
                    <span className={actionBadgeColor(log.action)}>{ACTION_LABELS[log.action] ?? log.action}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{log.user_id ? String(log.user_id) : "System"}</td>
                  <td className="px-6 py-4 text-xs text-slate-500">
                    {log.details ? (typeof log.details === "string" ? log.details : JSON.stringify(log.details)) : "-"}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-sm text-slate-500">No audit events found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {hasMore && logs.length > 0 && (
        <div className="text-center">
          <button onClick={loadMore} className="btn-secondary">Load more</button>
        </div>
      )}
    </div>
  );
}
