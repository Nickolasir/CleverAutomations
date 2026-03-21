"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type {
  Device,
  DeviceId,
  DeviceState,
  DeviceCommand,
  Room,
  TenantId,
} from "@clever/shared";
import { createBrowserClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Real-time device state hook.
 * Subscribes to Supabase Realtime on the `devices` table filtered by tenant_id.
 * Any INSERT/UPDATE/DELETE event updates the local state immediately.
 */
interface UseDevicesReturn {
  devices: Device[];
  rooms: Room[];
  loading: boolean;
  error: string | null;
  /** Get devices filtered by room */
  devicesByRoom: (roomName: string) => Device[];
  /** Get a single device by ID */
  getDevice: (id: DeviceId) => Device | undefined;
  /** Send a command to a device */
  sendCommand: (command: Omit<DeviceCommand, "tenant_id" | "issued_by">) => Promise<void>;
  /** Toggle a device on/off or lock/unlock */
  toggleDevice: (deviceId: DeviceId) => Promise<void>;
  /** Refresh devices from the database */
  refresh: () => Promise<void>;
}

export function useDevices(tenantId: TenantId | null): UseDevicesReturn {
  const [devices, setDevices] = useState<Device[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const supabase = createBrowserClient();

  /** Fetch all devices for the tenant */
  const fetchDevices = useCallback(async () => {
    if (!tenantId) return;

    try {
      setError(null);
      const { data, error: fetchError } = await supabase
        .from("devices")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("room", { ascending: true })
        .order("name", { ascending: true });

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      setDevices((data as unknown as Device[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch devices");
    } finally {
      setLoading(false);
    }
  }, [tenantId, supabase]);

  /** Fetch rooms */
  const fetchRooms = useCallback(async () => {
    if (!tenantId) return;

    const { data } = await supabase
      .from("rooms")
      .select("*")
      .eq("tenant_id", tenantId as string)
      .order("floor")
      .order("name");

    if (data) {
      setRooms(data as unknown as Room[]);
    }
  }, [tenantId, supabase]);

  /** Subscribe to real-time changes */
  useEffect(() => {
    if (!tenantId) return;

    void fetchDevices();
    void fetchRooms();

    /** Set up Realtime subscription on the devices table */
    const channel = supabase
      .channel(`devices:tenant:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "devices",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          switch (payload.eventType) {
            case "INSERT":
              setDevices((prev) => [...prev, payload.new as unknown as Device]);
              break;
            case "UPDATE":
              setDevices((prev) =>
                prev.map((d) =>
                  d.id === (payload.new as unknown as Device).id
                    ? (payload.new as unknown as Device)
                    : d
                )
              );
              break;
            case "DELETE":
              setDevices((prev) =>
                prev.filter(
                  (d) => d.id !== (payload.old as unknown as Device).id
                )
              );
              break;
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [tenantId, supabase, fetchDevices, fetchRooms]);

  /** Get devices filtered by room name */
  const devicesByRoom = useCallback(
    (roomName: string): Device[] =>
      devices.filter((d) => d.room === roomName),
    [devices]
  );

  /** Get a single device */
  const getDevice = useCallback(
    (id: DeviceId): Device | undefined => devices.find((d) => d.id === id),
    [devices]
  );

  /** Send a command to a device */
  const sendCommand = useCallback(
    async (command: Omit<DeviceCommand, "tenant_id" | "issued_by">) => {
      const { error: cmdError } = await supabase
        .from("device_commands")
        .insert({
          ...command,
          tenant_id: tenantId,
          source: "dashboard" as const,
        });

      if (cmdError) {
        throw new Error(cmdError.message);
      }
    },
    [tenantId, supabase]
  );

  /** Toggle device on/off or lock/unlock */
  const toggleDevice = useCallback(
    async (deviceId: DeviceId) => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return;

      let targetState: DeviceState;
      if (device.category === "lock") {
        targetState = device.state === "locked" ? "unlocked" : "locked";
      } else {
        targetState = device.state === "on" ? "off" : "on";
      }

      /** Optimistic update */
      setDevices((prev) =>
        prev.map((d) =>
          d.id === deviceId ? { ...d, state: targetState } : d
        )
      );

      try {
        await sendCommand({
          device_id: deviceId,
          action: device.category === "lock" ? targetState : `turn_${targetState}`,
          parameters: {},
          source: "dashboard",
        });
      } catch {
        /** Revert optimistic update on failure */
        void fetchDevices();
      }
    },
    [devices, sendCommand, fetchDevices]
  );

  return {
    devices,
    rooms,
    loading,
    error,
    devicesByRoom,
    getDevice,
    sendCommand,
    toggleDevice,
    refresh: fetchDevices,
  };
}
