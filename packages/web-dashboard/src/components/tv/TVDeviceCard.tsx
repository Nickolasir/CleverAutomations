"use client";

import type { Device } from "@clever/shared";

/**
 * Large, focusable device card for TV remote control.
 * Shows category icon, name, room, state, and online status.
 * Enter/OK toggles the device.
 */

const CATEGORY_ICONS: Record<string, string> = {
  light: "💡",
  lock: "🔒",
  thermostat: "🌡️",
  climate: "❄️",
  switch: "🔌",
  fan: "🌀",
  media_player: "📺",
  camera: "📷",
  cover: "🪟",
  sensor: "📊",
};

const TOGGLEABLE = new Set([
  "light",
  "lock",
  "switch",
  "fan",
  "cover",
  "media_player",
]);

function stateLabel(device: Device): string {
  if (!device.is_online) return "Offline";
  switch (device.state) {
    case "on":
      return "On";
    case "off":
      return "Off";
    case "locked":
      return "Locked";
    case "unlocked":
      return "Unlocked";
    default:
      return "Unknown";
  }
}

function stateColor(device: Device): string {
  if (!device.is_online) return "#78716c";
  switch (device.state) {
    case "on":
    case "unlocked":
      return "#22c55e";
    case "off":
    case "locked":
      return "#A8A29E";
    default:
      return "#78716c";
  }
}

interface TVDeviceCardProps {
  device: Device;
  onToggle: (deviceId: string) => void;
}

export function TVDeviceCard({ device, onToggle }: TVDeviceCardProps) {
  const canToggle = TOGGLEABLE.has(device.category) && device.is_online;
  const icon = CATEGORY_ICONS[device.category] ?? "📦";

  const handleActivate = () => {
    if (canToggle) {
      onToggle(device.id);
    }
  };

  return (
    <button
      data-tv-focusable
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleActivate();
        }
      }}
      className={`
        flex flex-col items-start rounded-2xl bg-tv-surface px-6 py-5
        min-w-[200px] min-h-[120px] text-left transition-colors
        ${canToggle ? "hover:bg-tv-surface-hover" : "opacity-80"}
      `}
    >
      {/* Top row: icon + state indicator */}
      <div className="flex items-center justify-between w-full mb-3">
        <span className="text-3xl">{icon}</span>
        <span
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: stateColor(device) }}
        />
      </div>

      {/* Name */}
      <p className="text-xl font-semibold text-tv-text truncate w-full">
        {device.name}
      </p>

      {/* Room + state */}
      <div className="flex items-center justify-between w-full mt-1">
        <span className="text-base text-tv-muted truncate">{device.room}</span>
        <span
          className="text-base font-medium"
          style={{ color: stateColor(device) }}
        >
          {stateLabel(device)}
        </span>
      </div>
    </button>
  );
}
