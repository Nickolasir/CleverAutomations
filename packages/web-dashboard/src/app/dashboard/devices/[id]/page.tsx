"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { createBrowserClient } from "@/lib/supabase/client";
import type {
  Device,
  DeviceId,
  DeviceState,
  DeviceStateChange,
  DeviceCommand,
} from "@clever/shared";

/**
 * Single device detail page.
 * Shows device info, current state, state change history,
 * command log, and interactive controls.
 */
export default function DeviceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { tenantId } = useAuth();
  const supabase = createBrowserClient();

  const [device, setDevice] = useState<Device | null>(null);
  const [stateHistory, setStateHistory] = useState<DeviceStateChange[]>([]);
  const [commandLog, setCommandLog] = useState<DeviceCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const deviceId = params?.id as unknown as DeviceId;

  /** Fetch device, state history, and command log */
  const fetchDeviceData = useCallback(async () => {
    if (!tenantId || !deviceId) return;

    try {
      setError(null);

      const [deviceRes, historyRes, commandsRes] = await Promise.all([
        supabase
          .from("devices")
          .select("*")
          .eq("id", deviceId as string)
          .eq("tenant_id", tenantId as string)
          .single(),
        supabase
          .from("device_state_changes")
          .select("*")
          .eq("device_id", deviceId as string)
          .eq("tenant_id", tenantId as string)
          .order("timestamp", { ascending: false })
          .limit(50),
        supabase
          .from("device_commands")
          .select("*")
          .eq("device_id", deviceId as string)
          .eq("tenant_id", tenantId as string)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      if (deviceRes.error) {
        setError(deviceRes.error.message);
        return;
      }

      setDevice(deviceRes.data as unknown as Device);
      setStateHistory(
        (historyRes.data as unknown as DeviceStateChange[]) ?? []
      );
      setCommandLog(
        (commandsRes.data as unknown as DeviceCommand[]) ?? []
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load device");
    } finally {
      setLoading(false);
    }
  }, [tenantId, deviceId, supabase]);

  useEffect(() => {
    void fetchDeviceData();

    /** Subscribe to realtime updates for this specific device */
    const channel = supabase
      .channel(`device:${deviceId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "devices",
          filter: `id=eq.${deviceId as string}`,
        },
        (payload) => {
          setDevice(payload.new as unknown as Device);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "device_state_changes",
          filter: `device_id=eq.${deviceId as string}`,
        },
        (payload) => {
          setStateHistory((prev) => [
            payload.new as unknown as DeviceStateChange,
            ...prev,
          ]);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [deviceId, tenantId, supabase, fetchDeviceData]);

  /** Toggle the device */
  const handleToggle = async () => {
    if (!device || !device.is_online) return;

    let targetState: DeviceState;
    if (device.category === "lock") {
      targetState = device.state === "locked" ? "unlocked" : "locked";
    } else {
      targetState = device.state === "on" ? "off" : "on";
    }

    /** Optimistic update */
    setDevice((prev) => (prev ? { ...prev, state: targetState } : prev));

    const { error: cmdError } = await supabase.from("device_commands").insert({
      device_id: deviceId,
      tenant_id: tenantId,
      action: device.category === "lock" ? targetState : `turn_${targetState}`,
      parameters: {},
      source: "dashboard",
    });

    if (cmdError) {
      /** Revert on error */
      void fetchDeviceData();
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
        <div className="card animate-pulse">
          <div className="space-y-4">
            <div className="h-6 w-32 rounded bg-slate-200" />
            <div className="h-4 w-64 rounded bg-slate-200" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !device) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.back()}
          className="btn-secondary text-sm"
        >
          Back to Devices
        </button>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-700">{error ?? "Device not found"}</p>
        </div>
      </div>
    );
  }

  const isActive = device.state === "on" || device.state === "unlocked";

  return (
    <div className="space-y-6">
      {/* Back button + title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="btn-secondary text-sm"
          >
            Back
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{device.name}</h2>
            <p className="text-sm text-slate-500">
              {device.room} &middot; {device.floor} &middot;{" "}
              <span className="font-mono text-xs">{device.ha_entity_id}</span>
            </p>
          </div>
        </div>

        {/* Toggle button */}
        {device.is_online && device.state !== "unknown" && (
          <button
            onClick={handleToggle}
            className={`rounded-xl px-6 py-3 text-sm font-semibold transition-colors ${
              isActive
                ? "bg-brand-600 text-white hover:bg-brand-700"
                : "bg-slate-200 text-slate-700 hover:bg-slate-300"
            }`}
          >
            {device.category === "lock" ? (isActive ? "Unlock" : "Lock") : (isActive ? "Turn Off" : "Turn On")}
          </button>
        )}
      </div>

      {/* Device info cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card">
          <p className="text-sm font-medium text-slate-500">Current State</p>
          <p className={`mt-1 text-2xl font-bold ${isActive ? "text-green-600" : "text-slate-600"}`}>
            {device.state.charAt(0).toUpperCase() + device.state.slice(1)}
          </p>
        </div>
        <div className="card">
          <p className="text-sm font-medium text-slate-500">Status</p>
          <p className={`mt-1 text-2xl font-bold ${device.is_online ? "text-green-600" : "text-red-600"}`}>
            {device.is_online ? "Online" : "Offline"}
          </p>
        </div>
        <div className="card">
          <p className="text-sm font-medium text-slate-500">Category</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {device.category.charAt(0).toUpperCase() + device.category.slice(1).replace("_", " ")}
          </p>
        </div>
      </div>

      {/* Attributes (e.g., thermostat temperature) */}
      {Object.keys(device.attributes).length > 0 && (
        <div className="card">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">Attributes</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {Object.entries(device.attributes).map(([key, value]) => (
              <div key={key}>
                <p className="text-xs font-medium text-slate-500">
                  {key.replace(/_/g, " ")}
                </p>
                <p className="mt-0.5 text-sm font-medium text-slate-900">
                  {String(value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* State History */}
      <div className="card">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">State History</h3>
        {stateHistory.length === 0 ? (
          <p className="text-sm text-slate-500">No state changes recorded</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Previous</th>
                  <th className="pb-2 pr-4">New</th>
                  <th className="pb-2 pr-4">Changed By</th>
                  <th className="pb-2">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stateHistory.map((change) => (
                  <tr key={change.id} className="text-slate-600">
                    <td className="py-2 pr-4 text-xs">
                      {new Date(change.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="badge-neutral">{change.previous_state}</span>
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={
                          change.new_state === "on" || change.new_state === "unlocked"
                            ? "badge-success"
                            : "badge-neutral"
                        }
                      >
                        {change.new_state}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-xs">{String(change.changed_by)}</td>
                    <td className="py-2 text-xs">{change.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Command Log */}
      <div className="card">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Command Log</h3>
        {commandLog.length === 0 ? (
          <p className="text-sm text-slate-500">No commands issued</p>
        ) : (
          <div className="space-y-2">
            {commandLog.map((cmd, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">{cmd.action}</p>
                  <p className="text-xs text-slate-500">
                    Source: {cmd.source}
                    {cmd.confidence != null && ` | Confidence: ${Math.round(cmd.confidence * 100)}%`}
                  </p>
                </div>
                {Object.keys(cmd.parameters).length > 0 && (
                  <span className="text-xs font-mono text-slate-400">
                    {JSON.stringify(cmd.parameters)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
