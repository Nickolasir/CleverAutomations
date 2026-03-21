import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  SectionList,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Device, DeviceCategory, DeviceState, DeviceId } from "@clever/shared";
import { useAuthContext, type RootStackParamList } from "../../App";
import { supabase } from "../lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

/** Device category icons (text-based for cross-platform compatibility) */
const CATEGORY_ICONS: Record<DeviceCategory, string> = {
  light: "L",
  lock: "K",
  thermostat: "T",
  switch: "S",
  sensor: "N",
  camera: "C",
  cover: "V",
  media_player: "M",
  climate: "A",
  fan: "F",
};

/** State color mapping */
const STATE_COLORS: Record<DeviceState, string> = {
  on: "#22c55e",
  off: "#94a3b8",
  locked: "#f59e0b",
  unlocked: "#ef4444",
  unknown: "#6b7280",
};

/**
 * Mobile device dashboard with room-based layout.
 * Uses SectionList to group devices by room.
 * Subscribes to Supabase Realtime for live device state updates.
 * Tap a device card to navigate to DeviceControlScreen.
 */
export default function DashboardScreen() {
  const { user, tenant } = useAuthContext();
  const navigation = useNavigation<NavigationProp>();

  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const tenantId = user?.tenant_id;

  /** Fetch all devices */
  const fetchDevices = useCallback(async () => {
    if (!tenantId) return;

    try {
      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("room")
        .order("name");

      if (error) {
        console.error("Failed to fetch devices:", error.message);
        return;
      }

      setDevices((data as unknown as Device[]) ?? []);
    } catch (err) {
      console.error("Fetch devices error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tenantId]);

  /** Subscribe to realtime updates */
  useEffect(() => {
    if (!tenantId) return;

    void fetchDevices();

    let channel: RealtimeChannel | null = null;

    channel = supabase
      .channel(`mobile_devices:${tenantId}`)
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

  /** Toggle device state */
  const toggleDevice = async (device: Device) => {
    if (!device.is_online || device.state === "unknown") return;

    let targetState: DeviceState;
    if (device.category === "lock") {
      targetState = device.state === "locked" ? "unlocked" : "locked";
    } else {
      targetState = device.state === "on" ? "off" : "on";
    }

    /** Optimistic update */
    setDevices((prev) =>
      prev.map((d) =>
        d.id === device.id ? { ...d, state: targetState } : d
      )
    );

    const { error } = await supabase.from("device_commands").insert({
      device_id: device.id,
      tenant_id: tenantId,
      action: device.category === "lock" ? targetState : `turn_${targetState}`,
      parameters: {},
      source: "mobile",
    });

    if (error) {
      /** Revert on failure */
      void fetchDevices();
    }
  };

  /** Build sections grouped by room */
  const sections = React.useMemo(() => {
    const roomMap = new Map<string, Device[]>();
    for (const device of devices) {
      const existing = roomMap.get(device.room) ?? [];
      existing.push(device);
      roomMap.set(device.room, existing);
    }

    return Array.from(roomMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([room, roomDevices]) => ({
        title: room,
        data: roomDevices,
      }));
  }, [devices]);

  /** Pull-to-refresh */
  const onRefresh = () => {
    setRefreshing(true);
    void fetchDevices();
  };

  /** Render a single device card */
  const renderDevice = ({ item: device }: { item: Device }) => {
    const isActive = device.state === "on" || device.state === "unlocked";
    const isToggleable =
      device.is_online &&
      device.state !== "unknown" &&
      ["light", "lock", "switch", "fan", "cover", "media_player"].includes(
        device.category
      );

    return (
      <TouchableOpacity
        style={[
          styles.deviceCard,
          isActive && styles.deviceCardActive,
          !device.is_online && styles.deviceCardOffline,
        ]}
        onPress={() =>
          navigation.navigate("DeviceControl", {
            deviceId: device.id as string,
          })
        }
        onLongPress={() => {
          if (isToggleable) void toggleDevice(device);
        }}
        activeOpacity={0.7}
      >
        <View style={styles.deviceHeader}>
          <View
            style={[
              styles.categoryBadge,
              { backgroundColor: isActive ? "#dbeafe" : "#f1f5f9" },
            ]}
          >
            <Text
              style={[
                styles.categoryIcon,
                { color: isActive ? "#2563eb" : "#64748b" },
              ]}
            >
              {CATEGORY_ICONS[device.category]}
            </Text>
          </View>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: device.is_online
                  ? STATE_COLORS[device.state]
                  : "#dc2626",
              },
            ]}
          />
        </View>

        <Text style={styles.deviceName} numberOfLines={1}>
          {device.name}
        </Text>

        <View style={styles.deviceFooter}>
          <Text
            style={[
              styles.stateLabel,
              { color: STATE_COLORS[device.state] },
            ]}
          >
            {device.state.charAt(0).toUpperCase() + device.state.slice(1)}
          </Text>
          {isToggleable && (
            <Text style={styles.tapHint}>Long press to toggle</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  /** Render room section header */
  const renderSectionHeader = ({
    section,
  }: {
    section: { title: string; data: Device[] };
  }) => {
    const onlineCount = section.data.filter((d) => d.is_online).length;
    return (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Text style={styles.sectionMeta}>
          {section.data.length} device{section.data.length !== 1 ? "s" : ""} /{" "}
          {onlineCount} online
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.loadingText}>Loading devices...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Summary bar */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{devices.length}</Text>
          <Text style={styles.summaryLabel}>Devices</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: "#22c55e" }]}>
            {devices.filter((d) => d.is_online).length}
          </Text>
          <Text style={styles.summaryLabel}>Online</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: "#2563eb" }]}>
            {devices.filter((d) => d.state === "on" || d.state === "unlocked").length}
          </Text>
          <Text style={styles.summaryLabel}>Active</Text>
        </View>
      </View>

      {/* Device list grouped by room */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id as string}
        renderItem={renderDevice}
        renderSectionHeader={renderSectionHeader}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#2563eb"
          />
        }
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No devices registered</Text>
            <Text style={styles.emptySubtext}>
              Connect a Raspberry Pi hub to get started
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8fafc",
  },
  loadingText: {
    fontSize: 14,
    color: "#64748b",
  },
  summaryBar: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a",
  },
  summaryLabel: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: "#e2e8f0",
    marginVertical: 4,
  },
  listContent: {
    paddingBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#f8fafc",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  sectionMeta: {
    fontSize: 12,
    color: "#64748b",
  },
  deviceCard: {
    backgroundColor: "#ffffff",
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  deviceCardActive: {
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
  },
  deviceCardOffline: {
    opacity: 0.6,
  },
  deviceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  categoryBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  categoryIcon: {
    fontSize: 16,
    fontWeight: "700",
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
    marginBottom: 6,
  },
  deviceFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stateLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  tapHint: {
    fontSize: 11,
    color: "#94a3b8",
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 64,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#64748b",
  },
  emptySubtext: {
    fontSize: 13,
    color: "#94a3b8",
    marginTop: 4,
  },
});
