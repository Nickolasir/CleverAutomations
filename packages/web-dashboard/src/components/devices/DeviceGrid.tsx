"use client";

import type { Device, DeviceId } from "@clever/shared";
import { DeviceCard } from "./DeviceCard";

interface DeviceGridProps {
  devices: Device[];
  onToggle: (deviceId: DeviceId) => void;
  /** Group devices by room */
  groupByRoom?: boolean;
  /** Use compact card layout */
  compact?: boolean;
  /** Empty state message */
  emptyMessage?: string;
}

/**
 * Grid layout of DeviceCards. Supports grouping by room and
 * compact mode for sidebar/widget views.
 */
export function DeviceGrid({
  devices,
  onToggle,
  groupByRoom = false,
  compact = false,
  emptyMessage = "No devices found",
}: DeviceGridProps) {
  if (devices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-16">
        <p className="text-sm text-slate-500">{emptyMessage}</p>
        <p className="mt-1 text-xs text-slate-400">
          Devices will appear here once connected via Home Assistant
        </p>
      </div>
    );
  }

  if (!groupByRoom) {
    return (
      <div
        className={
          compact
            ? "grid grid-cols-1 gap-2 sm:grid-cols-2"
            : "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        }
      >
        {devices.map((device) => (
          <DeviceCard
            key={device.id}
            device={device}
            onToggle={onToggle}
            compact={compact}
          />
        ))}
      </div>
    );
  }

  /** Group devices by room */
  const roomGroups = new Map<string, Device[]>();
  for (const device of devices) {
    const roomDevices = roomGroups.get(device.room) ?? [];
    roomDevices.push(device);
    roomGroups.set(device.room, roomDevices);
  }

  /** Sort rooms alphabetically, but put devices with floor info first */
  const sortedRooms = Array.from(roomGroups.entries()).sort(
    ([roomA, devicesA], [roomB, devicesB]) => {
      const floorA = devicesA[0]?.floor ?? "";
      const floorB = devicesB[0]?.floor ?? "";
      if (floorA !== floorB) return floorA.localeCompare(floorB);
      return roomA.localeCompare(roomB);
    }
  );

  return (
    <div className="space-y-8">
      {sortedRooms.map(([room, roomDevices]) => {
        const floor = roomDevices[0]?.floor;
        const onlineCount = roomDevices.filter((d) => d.is_online).length;
        const activeCount = roomDevices.filter(
          (d) => d.state === "on" || d.state === "unlocked"
        ).length;

        return (
          <section key={room}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{room}</h3>
                {floor && (
                  <p className="text-xs text-slate-500">{floor}</p>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>{roomDevices.length} devices</span>
                <span className="h-3 w-px bg-slate-300" />
                <span className="text-green-600">{onlineCount} online</span>
                <span className="h-3 w-px bg-slate-300" />
                <span className="text-brand-600">{activeCount} active</span>
              </div>
            </div>

            <div
              className={
                compact
                  ? "grid grid-cols-1 gap-2 sm:grid-cols-2"
                  : "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              }
            >
              {roomDevices.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  onToggle={onToggle}
                  compact={compact}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
