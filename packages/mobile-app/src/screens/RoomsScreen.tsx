import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type {
  Device,
  DeviceCategory,
  DeviceState,
  DeviceId,
} from "@clever/shared";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

/** Ionicons name mapping per device category */
const CATEGORY_ICONS: Record<DeviceCategory, keyof typeof Ionicons.glyphMap> = {
  light: "bulb-outline",
  lock: "lock-closed-outline",
  thermostat: "thermometer-outline",
  switch: "power-outline",
  sensor: "radio-outline",
  camera: "videocam-outline",
  cover: "albums-outline",
  media_player: "musical-notes-outline",
  climate: "snow-outline",
  fan: "leaf-outline",
};

/** State color mapping */
const STATE_COLORS: Record<DeviceState, string> = {
  on: "#22c55e",
  off: "#94a3b8",
  locked: "#f59e0b",
  unlocked: "#ef4444",
  unknown: "#6b7280",
};

/** Aggregated room data for display */
interface RoomSummary {
  name: string;
  floor: string;
  devices: Device[];
  deviceCount: number;
  onlineCount: number;
  activePercent: number;
}

/**
 * Rooms screen — mirrors the web dashboard's Rooms page.
 * Groups devices by room, shows floor filter tabs,
 * room summary cards in a grid, and device detail list
 * when a room is selected. Uses Supabase Realtime for live updates.
 */
export default function RoomsScreen() {
  const { user } = useAuthContext();

  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFloor, setSelectedFloor] = useState<string>("All");
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

  const tenantId = user?.tenant_id;

  // ---------- Data fetching ----------

  const fetchDevices = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("room")
        .order("name");

      if (error) {
        console.error("[Rooms] Failed to fetch devices:", error.message);
        return;
      }

      setDevices((data as unknown as Device[]) ?? []);
    } catch (err) {
      console.error("[Rooms] Fetch devices error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tenantId]);

  // ---------- Realtime subscription ----------

  useEffect(() => {
    if (!tenantId) return;

    void fetchDevices();

    let channel: RealtimeChannel | null = null;

    channel = supabase
      .channel(`rooms_devices:${tenantId}`)
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

    return () => {
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [tenantId, fetchDevices]);

  // ---------- Derived data ----------

  /** Unique floors extracted from devices */
  const floors = useMemo(() => {
    const floorSet = new Set<string>();
    for (const d of devices) {
      if (d.floor) floorSet.add(d.floor);
    }
    return ["All", ...Array.from(floorSet).sort()];
  }, [devices]);

  /** Devices filtered by selected floor */
  const filteredDevices = useMemo(() => {
    if (selectedFloor === "All") return devices;
    return devices.filter((d) => d.floor === selectedFloor);
  }, [devices, selectedFloor]);

  /** Room summaries built from filtered devices */
  const rooms = useMemo<RoomSummary[]>(() => {
    const roomMap = new Map<string, Device[]>();
    for (const d of filteredDevices) {
      const existing = roomMap.get(d.room) ?? [];
      existing.push(d);
      roomMap.set(d.room, existing);
    }

    return Array.from(roomMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, roomDevices]) => {
        const onlineCount = roomDevices.filter((d) => d.is_online).length;
        const activeCount = roomDevices.filter(
          (d) => d.state === "on" || d.state === "unlocked"
        ).length;
        return {
          name,
          floor: roomDevices[0]?.floor ?? "",
          devices: roomDevices,
          deviceCount: roomDevices.length,
          onlineCount,
          activePercent:
            roomDevices.length > 0
              ? Math.round((activeCount / roomDevices.length) * 100)
              : 0,
        };
      });
  }, [filteredDevices]);

  /** Devices belonging to the selected room */
  const selectedRoomDevices = useMemo(() => {
    if (!selectedRoom) return [];
    const room = rooms.find((r) => r.name === selectedRoom);
    return room?.devices ?? [];
  }, [rooms, selectedRoom]);

  // ---------- Handlers ----------

  const onRefresh = () => {
    setRefreshing(true);
    void fetchDevices();
  };

  const handleFloorPress = (floor: string) => {
    setSelectedFloor(floor);
    setSelectedRoom(null);
  };

  const handleRoomPress = (roomName: string) => {
    setSelectedRoom((prev) => (prev === roomName ? null : roomName));
  };

  // ---------- Skeleton loader ----------

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.skeletonHeader}>
          <View style={styles.skeletonTab} />
          <View style={[styles.skeletonTab, { width: 72 }]} />
          <View style={[styles.skeletonTab, { width: 88 }]} />
        </View>
        <View style={styles.skeletonGrid}>
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <View style={styles.skeletonLine} />
              <View style={[styles.skeletonLine, { width: "60%" }]} />
              <View style={[styles.skeletonLine, { width: "80%", marginTop: 12 }]} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  // ---------- Empty state ----------

  if (devices.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="home-outline" size={48} color="#94a3b8" />
        <Text style={styles.emptyText}>No rooms yet</Text>
        <Text style={styles.emptySubtext}>
          Add devices to see them organized by room
        </Text>
      </View>
    );
  }

  // ---------- Render ----------

  return (
    <View style={styles.container}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#D4A843"
          />
        }
      >
        {/* Floor filter tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.floorTabsContainer}
          style={styles.floorTabsScroll}
        >
          {floors.map((floor) => (
            <TouchableOpacity
              key={floor}
              onPress={() => handleFloorPress(floor)}
              style={[
                styles.floorTab,
                selectedFloor === floor && styles.floorTabActive,
              ]}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.floorTabText,
                  selectedFloor === floor && styles.floorTabTextActive,
                ]}
              >
                {floor}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Room cards grid */}
        <View style={styles.roomGrid}>
          {rooms.map((room) => (
            <TouchableOpacity
              key={room.name}
              style={[
                styles.roomCard,
                selectedRoom === room.name && styles.roomCardSelected,
              ]}
              onPress={() => handleRoomPress(room.name)}
              activeOpacity={0.7}
            >
              <View style={styles.roomCardHeader}>
                <Text style={styles.roomName} numberOfLines={1}>
                  {room.name}
                </Text>
                <Ionicons
                  name={selectedRoom === room.name ? "chevron-up" : "chevron-down"}
                  size={16}
                  color="#64748b"
                />
              </View>

              <Text style={styles.roomFloor}>{room.floor}</Text>

              <View style={styles.roomStats}>
                <View style={styles.roomStatItem}>
                  <Ionicons name="hardware-chip-outline" size={14} color="#64748b" />
                  <Text style={styles.roomStatText}>
                    {room.deviceCount} device{room.deviceCount !== 1 ? "s" : ""}
                  </Text>
                </View>
                <View style={styles.roomStatItem}>
                  <View
                    style={[
                      styles.onlineDot,
                      {
                        backgroundColor:
                          room.onlineCount > 0 ? "#22c55e" : "#94a3b8",
                      },
                    ]}
                  />
                  <Text style={styles.roomStatText}>
                    {room.onlineCount} online
                  </Text>
                </View>
              </View>

              {/* Active percentage bar */}
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${room.activePercent}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressLabel}>
                {room.activePercent}% active
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Selected room device list */}
        {selectedRoom && selectedRoomDevices.length > 0 && (
          <View style={styles.deviceListSection}>
            <Text style={styles.deviceListTitle}>
              {selectedRoom} — Devices
            </Text>
            {selectedRoomDevices.map((device) => (
              <View key={device.id as string} style={styles.deviceCard}>
                <View style={styles.deviceLeft}>
                  <View
                    style={[
                      styles.deviceIconBadge,
                      {
                        backgroundColor:
                          device.state === "on" || device.state === "unlocked"
                            ? "#FFECB3"
                            : "#f1f5f9",
                      },
                    ]}
                  >
                    <Ionicons
                      name={CATEGORY_ICONS[device.category]}
                      size={20}
                      color={
                        device.state === "on" || device.state === "unlocked"
                          ? "#D4A843"
                          : "#64748b"
                      }
                    />
                  </View>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName} numberOfLines={1}>
                      {device.name}
                    </Text>
                    <View style={styles.deviceMeta}>
                      <View
                        style={[
                          styles.stateBadge,
                          { backgroundColor: STATE_COLORS[device.state] + "1a" },
                        ]}
                      >
                        <Text
                          style={[
                            styles.stateBadgeText,
                            { color: STATE_COLORS[device.state] },
                          ]}
                        >
                          {device.state.charAt(0).toUpperCase() +
                            device.state.slice(1)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
                <View
                  style={[
                    styles.onlineStatusDot,
                    {
                      backgroundColor: device.is_online ? "#22c55e" : "#dc2626",
                    },
                  ]}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ---------- Styles ----------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDF6E3",
  },

  // Floor tabs
  floorTabsScroll: {
    maxHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  floorTabsContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  floorTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#f1f5f9",
    marginRight: 8,
  },
  floorTabActive: {
    backgroundColor: "#D4A843",
  },
  floorTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  floorTabTextActive: {
    color: "#ffffff",
  },

  // Room grid
  roomGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
  },
  roomCard: {
    width: "47%",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 14,
    margin: "1.5%",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  roomCardSelected: {
    borderColor: "#D4A843",
    backgroundColor: "#FFF8E1",
  },
  roomCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  roomName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1a1a1a",
    flex: 1,
    marginRight: 4,
  },
  roomFloor: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 10,
  },
  roomStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  roomStatItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  roomStatText: {
    fontSize: 11,
    color: "#64748b",
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: "#e2e8f0",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 6,
    backgroundColor: "#D4A843",
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: 10,
    color: "#94a3b8",
    marginTop: 4,
    textAlign: "right",
  },

  // Device list for selected room
  deviceListSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  deviceListTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 12,
  },
  deviceCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  deviceLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  deviceIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  deviceMeta: {
    flexDirection: "row",
    alignItems: "center",
  },
  stateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  stateBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  onlineStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: 8,
  },

  // Skeleton loading
  skeletonHeader: {
    flexDirection: "row",
    padding: 12,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    gap: 8,
  },
  skeletonTab: {
    width: 64,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#e2e8f0",
  },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
  },
  skeletonCard: {
    width: "47%",
    height: 130,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 14,
    margin: "1.5%",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: "#e2e8f0",
    marginBottom: 8,
    width: "100%",
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FDF6E3",
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#64748b",
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: "#94a3b8",
    marginTop: 4,
    textAlign: "center",
  },
});
