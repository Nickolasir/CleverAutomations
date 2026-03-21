"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDevices } from "@/hooks/useDevices";
import { DeviceGrid } from "@/components/devices/DeviceGrid";
import type { Device } from "@clever/shared";

/**
 * Room-based view with device grouping.
 * Shows devices organized by room with floor-level navigation.
 * Each room section includes device count, online count, and active count.
 */
export default function RoomsPage() {
  const { tenantId } = useAuth();
  const { devices, rooms, loading, error, toggleDevice } = useDevices(tenantId);

  const [selectedFloor, setSelectedFloor] = useState<string | "all">("all");
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

  /** Extract unique floors from devices */
  const floors = useMemo(() => {
    const floorSet = new Set<string>();
    for (const d of devices) {
      if (d.floor) floorSet.add(d.floor);
    }
    return Array.from(floorSet).sort();
  }, [devices]);

  /** Build room-to-devices map */
  const roomDeviceMap = useMemo(() => {
    const map = new Map<string, Device[]>();
    for (const d of devices) {
      if (selectedFloor !== "all" && d.floor !== selectedFloor) continue;
      const existing = map.get(d.room) ?? [];
      existing.push(d);
      map.set(d.room, existing);
    }
    return map;
  }, [devices, selectedFloor]);

  /** Sorted room names */
  const roomNames = useMemo(
    () => Array.from(roomDeviceMap.keys()).sort(),
    [roomDeviceMap]
  );

  /** Devices for the selected room (or all rooms) */
  const displayDevices = useMemo(() => {
    if (selectedRoom) {
      return roomDeviceMap.get(selectedRoom) ?? [];
    }
    const allDevices: Device[] = [];
    for (const roomDevices of roomDeviceMap.values()) {
      allDevices.push(...roomDevices);
    }
    return allDevices;
  }, [selectedRoom, roomDeviceMap]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-900">Rooms</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-4 w-20 rounded bg-slate-200" />
              <div className="mt-3 h-6 w-16 rounded bg-slate-200" />
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
        <h2 className="text-2xl font-bold text-slate-900">Rooms</h2>
        <p className="mt-1 text-sm text-slate-500">
          {rooms.length} rooms across {floors.length} floors
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Floor filter tabs */}
      {floors.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => {
              setSelectedFloor("all");
              setSelectedRoom(null);
            }}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              selectedFloor === "all"
                ? "bg-brand-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            All Floors
          </button>
          {floors.map((floor) => (
            <button
              key={floor}
              onClick={() => {
                setSelectedFloor(floor);
                setSelectedRoom(null);
              }}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                selectedFloor === floor
                  ? "bg-brand-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {floor}
            </button>
          ))}
        </div>
      )}

      {/* Room cards grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {roomNames.map((roomName) => {
          const roomDevices = roomDeviceMap.get(roomName) ?? [];
          const onlineCount = roomDevices.filter((d) => d.is_online).length;
          const activeCount = roomDevices.filter(
            (d) => d.state === "on" || d.state === "unlocked"
          ).length;
          const isSelected = selectedRoom === roomName;

          return (
            <button
              key={roomName}
              onClick={() =>
                setSelectedRoom(isSelected ? null : roomName)
              }
              className={`card cursor-pointer text-left transition-all hover:shadow-md ${
                isSelected ? "ring-2 ring-brand-500" : ""
              }`}
            >
              <h3 className="text-sm font-semibold text-slate-900">{roomName}</h3>
              {roomDevices[0]?.floor && (
                <p className="text-xs text-slate-400">{roomDevices[0].floor}</p>
              )}
              <div className="mt-3 flex items-center gap-3 text-xs">
                <span className="text-slate-500">{roomDevices.length} devices</span>
                <span className="text-green-600">{onlineCount} online</span>
              </div>
              <div className="mt-2">
                <div className="h-1.5 w-full rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{
                      width: `${roomDevices.length > 0 ? (activeCount / roomDevices.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {activeCount} of {roomDevices.length} active
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Devices for selected room (or grouped by room) */}
      <div>
        {selectedRoom ? (
          <div>
            <h3 className="mb-4 text-lg font-semibold text-slate-900">
              {selectedRoom} Devices
            </h3>
            <DeviceGrid
              devices={displayDevices}
              onToggle={toggleDevice}
              emptyMessage={`No devices in ${selectedRoom}`}
            />
          </div>
        ) : (
          <DeviceGrid
            devices={displayDevices}
            onToggle={toggleDevice}
            groupByRoom
            emptyMessage="No devices found for the selected floor"
          />
        )}
      </div>
    </div>
  );
}
