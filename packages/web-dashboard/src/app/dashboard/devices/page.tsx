"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDevices } from "@/hooks/useDevices";
import type { Device, DeviceCategory, DeviceState } from "@clever/shared";

/**
 * Device list/management page.
 * Shows a searchable, filterable table of all devices with status,
 * room, category, and last seen information.
 */
export default function DevicesPage() {
  const { tenantId } = useAuth();
  const { devices, loading, error, toggleDevice } = useDevices(tenantId);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<DeviceCategory | "all">("all");
  const [stateFilter, setStateFilter] = useState<DeviceState | "all">("all");
  const [onlineFilter, setOnlineFilter] = useState<"all" | "online" | "offline">("all");

  /** Apply filters */
  const filteredDevices = useMemo(() => {
    let result = devices;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.room.toLowerCase().includes(q) ||
          d.ha_entity_id.toLowerCase().includes(q)
      );
    }

    if (categoryFilter !== "all") {
      result = result.filter((d) => d.category === categoryFilter);
    }

    if (stateFilter !== "all") {
      result = result.filter((d) => d.state === stateFilter);
    }

    if (onlineFilter !== "all") {
      result = result.filter((d) =>
        onlineFilter === "online" ? d.is_online : !d.is_online
      );
    }

    return result;
  }, [devices, search, categoryFilter, stateFilter, onlineFilter]);

  /** Unique categories from devices */
  const categories = useMemo(
    () => Array.from(new Set(devices.map((d) => d.category))).sort(),
    [devices]
  );

  const stateColorClass = (state: DeviceState): string => {
    switch (state) {
      case "on":
        return "badge-success";
      case "off":
        return "badge-neutral";
      case "locked":
        return "badge-warning";
      case "unlocked":
        return "badge-error";
      default:
        return "badge-neutral";
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-slate-900">Devices</h2>
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Devices</h2>
          <p className="mt-1 text-sm text-slate-500">
            {devices.length} devices registered
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, room, or entity ID..."
              className="input-field"
            />
          </div>

          {/* Category filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as DeviceCategory | "all")}
            className="input-field w-auto"
          >
            <option value="all">All categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat.charAt(0).toUpperCase() + cat.slice(1).replace("_", " ")}
              </option>
            ))}
          </select>

          {/* State filter */}
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as DeviceState | "all")}
            className="input-field w-auto"
          >
            <option value="all">All states</option>
            <option value="on">On</option>
            <option value="off">Off</option>
            <option value="locked">Locked</option>
            <option value="unlocked">Unlocked</option>
          </select>

          {/* Online filter */}
          <select
            value={onlineFilter}
            onChange={(e) =>
              setOnlineFilter(e.target.value as "all" | "online" | "offline")
            }
            className="input-field w-auto"
          >
            <option value="all">All</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Device table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3">Device</th>
                <th className="px-6 py-3">Category</th>
                <th className="px-6 py-3">Room</th>
                <th className="px-6 py-3">State</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Last Seen</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDevices.map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  onToggle={toggleDevice}
                  stateColorClass={stateColorClass}
                />
              ))}
              {filteredDevices.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-12 text-center text-sm text-slate-500"
                  >
                    {search || categoryFilter !== "all" || stateFilter !== "all"
                      ? "No devices match your filters"
                      : "No devices registered yet"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DeviceRow({
  device,
  onToggle,
  stateColorClass,
}: {
  device: Device;
  onToggle: (id: Device["id"]) => void;
  stateColorClass: (state: DeviceState) => string;
}) {
  const isToggleable =
    device.is_online &&
    device.state !== "unknown" &&
    ["light", "lock", "switch", "fan", "cover", "media_player"].includes(device.category);

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-6 py-4">
        <a
          href={`/dashboard/devices/${device.id}`}
          className="text-sm font-medium text-brand-600 hover:text-brand-500"
        >
          {device.name}
        </a>
        <p className="text-xs text-slate-400">{device.ha_entity_id}</p>
      </td>
      <td className="px-6 py-4">
        <span className="badge-neutral">
          {device.category.replace("_", " ")}
        </span>
      </td>
      <td className="px-6 py-4 text-sm text-slate-600">
        {device.room}
        {device.floor && (
          <span className="block text-xs text-slate-400">{device.floor}</span>
        )}
      </td>
      <td className="px-6 py-4">
        <span className={stateColorClass(device.state)}>
          {device.state}
        </span>
      </td>
      <td className="px-6 py-4">
        <span
          className={`inline-flex items-center gap-1.5 text-xs ${
            device.is_online ? "text-green-600" : "text-red-500"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              device.is_online ? "bg-green-500" : "bg-red-500"
            }`}
          />
          {device.is_online ? "Online" : "Offline"}
        </span>
      </td>
      <td className="px-6 py-4 text-xs text-slate-500">
        {new Date(device.last_seen).toLocaleString()}
      </td>
      <td className="px-6 py-4">
        {isToggleable && (
          <button
            onClick={() => onToggle(device.id)}
            className="btn-secondary text-xs"
          >
            Toggle
          </button>
        )}
      </td>
    </tr>
  );
}
