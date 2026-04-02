"use client";

import { useCallback, type MouseEvent } from "react";
import type { Device, DeviceCategory, DeviceState } from "@clever/shared";

interface DeviceCardProps {
  device: Device;
  onToggle: (deviceId: Device["id"]) => void;
  compact?: boolean;
}

/** Icon mapping per device category */
const CATEGORY_ICONS: Record<DeviceCategory, string> = {
  light: "💡",
  lock: "🔒",
  thermostat: "🌡️",
  switch: "🔌",
  sensor: "📡",
  camera: "📷",
  cover: "🪟",
  media_player: "🎵",
  climate: "❄️",
  fan: "🌀",
  calendar: "📅",
  email_sensor: "📧",
};

/** State-to-display color mapping */
const STATE_COLORS: Record<DeviceState, string> = {
  on: "bg-green-500",
  off: "bg-slate-400",
  locked: "bg-amber-500",
  unlocked: "bg-red-500",
  unknown: "bg-slate-300",
};

/** Human-readable state labels */
const STATE_LABELS: Record<DeviceState, string> = {
  on: "On",
  off: "Off",
  locked: "Locked",
  unlocked: "Unlocked",
  unknown: "Unknown",
};

/**
 * Device status card with tap-to-toggle functionality.
 * Shows device name, room, category icon, current state, and online status.
 * Clicking the card toggles the device (on/off or lock/unlock).
 */
export function DeviceCard({ device, onToggle, compact = false }: DeviceCardProps) {
  const isToggleable =
    device.is_online &&
    device.state !== "unknown" &&
    ["light", "lock", "switch", "fan", "cover", "media_player"].includes(device.category);

  const handleClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      if (isToggleable) {
        onToggle(device.id);
      }
    },
    [device.id, isToggleable, onToggle]
  );

  const isActive = device.state === "on" || device.state === "unlocked";

  if (compact) {
    return (
      <button
        onClick={handleClick}
        disabled={!isToggleable}
        className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
          isActive
            ? "border-brand-200 bg-brand-50"
            : "border-slate-200 bg-white"
        } ${isToggleable ? "cursor-pointer hover:shadow-md" : "cursor-default"}`}
      >
        <span className="text-xl">{CATEGORY_ICONS[device.category]}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{device.name}</p>
          <p className="text-xs text-slate-500">{STATE_LABELS[device.state]}</p>
        </div>
        <span
          className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${
            device.is_online ? STATE_COLORS[device.state] : "bg-red-500"
          }`}
        />
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={!isToggleable}
      className={`group flex flex-col rounded-xl border p-5 text-left transition-all ${
        isActive
          ? "border-brand-200 bg-brand-50 shadow-sm"
          : "border-slate-200 bg-white"
      } ${isToggleable ? "cursor-pointer hover:shadow-lg" : "cursor-default"}`}
    >
      {/* Header: Icon + Online status */}
      <div className="mb-3 flex items-start justify-between">
        <span className="text-3xl">{CATEGORY_ICONS[device.category]}</span>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              device.is_online ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-xs text-slate-500">
            {device.is_online ? "Online" : "Offline"}
          </span>
        </div>
      </div>

      {/* Device name */}
      <h3 className="text-sm font-semibold text-slate-900">{device.name}</h3>
      <p className="mt-0.5 text-xs text-slate-500">{device.room}</p>

      {/* State + Toggle indicator */}
      <div className="mt-4 flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            isActive
              ? "bg-brand-100 text-brand-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${STATE_COLORS[device.state]}`} />
          {STATE_LABELS[device.state]}
        </span>

        {isToggleable && (
          <span className="text-xs text-slate-400 opacity-0 transition-opacity group-hover:opacity-100">
            Tap to toggle
          </span>
        )}
      </div>

      {/* Thermostat-specific: show temperature */}
      {device.category === "thermostat" && device.attributes["temperature"] != null && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-slate-900">
              {String(device.attributes["temperature"])}
            </span>
            <span className="text-sm text-slate-500">
              {String(device.attributes["unit"] ?? "°F")}
            </span>
          </div>
        </div>
      )}

      {/* Last seen timestamp */}
      <p className="mt-3 text-xs text-slate-400">
        Last seen: {new Date(device.last_seen).toLocaleString()}
      </p>
    </button>
  );
}
