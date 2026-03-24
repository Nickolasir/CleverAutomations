import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
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
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const STATE_COLORS: Record<DeviceState, string> = {
  on: "#22c55e",
  off: "#94a3b8",
  locked: "#f59e0b",
  unlocked: "#ef4444",
  unknown: "#6b7280",
};

const ALL_CATEGORIES: DeviceCategory[] = [
  "light",
  "lock",
  "thermostat",
  "switch",
  "sensor",
  "camera",
  "cover",
  "media_player",
  "climate",
  "fan",
];

type StateFilter = "All" | DeviceState;
type OnlineFilter = "All" | "Online" | "Offline";

const STATE_FILTERS: StateFilter[] = ["All", "on", "off", "locked", "unlocked"];
const ONLINE_FILTERS: OnlineFilter[] = ["All", "Online", "Offline"];

const TOGGLEABLE_CATEGORIES: DeviceCategory[] = [
  "light",
  "switch",
  "fan",
  "media_player",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLastSeen(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function stateLabel(s: DeviceState): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DevicesListScreen() {
  const navigation = useNavigation<any>();
  const { tenant } = useAuthContext();

  // Data
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "All" | DeviceCategory
  >("All");
  const [stateFilter, setStateFilter] = useState<StateFilter>("All");
  const [onlineFilter, setOnlineFilter] = useState<OnlineFilter>("All");

  // ------------------------------------------------------------------
  // Fetch devices
  // ------------------------------------------------------------------

  const fetchDevices = useCallback(async () => {
    if (!tenant) return;
    try {
      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .eq("tenant_id", tenant.id as string);

      if (error) {
        console.error("Error fetching devices:", error.message);
        return;
      }
      setDevices((data as Device[]) ?? []);
    } catch (err) {
      console.error("Unexpected error fetching devices:", err);
    }
  }, [tenant]);

  // Initial load
  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      await fetchDevices();
      if (mounted) setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [fetchDevices]);

  // Realtime subscription
  useEffect(() => {
    if (!tenant) return;

    const channel = supabase
      .channel("devices-realtime")
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "devices",
          filter: `tenant_id=eq.${tenant.id}`,
        },
        (payload: any) => {
          const changed = payload.new as Device | undefined;
          const old = payload.old as { id?: string } | undefined;

          if (payload.eventType === "INSERT" && changed) {
            setDevices((prev) => [...prev, changed]);
          } else if (payload.eventType === "UPDATE" && changed) {
            setDevices((prev) =>
              prev.map((d) => (d.id === changed.id ? changed : d))
            );
          } else if (payload.eventType === "DELETE" && old?.id) {
            setDevices((prev) => prev.filter((d) => (d.id as string) !== old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant]);

  // ------------------------------------------------------------------
  // Pull-to-refresh
  // ------------------------------------------------------------------

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDevices();
    setRefreshing(false);
  }, [fetchDevices]);

  // ------------------------------------------------------------------
  // Toggle device
  // ------------------------------------------------------------------

  const handleToggle = useCallback(
    async (device: Device) => {
      const newState: DeviceState =
        device.state === "on" ? "off" : "on";

      // Optimistic update
      setDevices((prev) =>
        prev.map((d) =>
          d.id === device.id ? { ...d, state: newState } : d
        )
      );

      const { error } = await supabase
        .from("devices")
        .update({ state: newState, updated_at: new Date().toISOString() })
        .eq("id", device.id as string);

      if (error) {
        console.error("Toggle error:", error.message);
        // Revert on failure
        setDevices((prev) =>
          prev.map((d) =>
            d.id === device.id ? { ...d, state: device.state } : d
          )
        );
      }
    },
    []
  );

  // ------------------------------------------------------------------
  // Filtered list
  // ------------------------------------------------------------------

  const filtersActive =
    search.length > 0 ||
    categoryFilter !== "All" ||
    stateFilter !== "All" ||
    onlineFilter !== "All";

  const filtered = useMemo(() => {
    let list = devices;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.room.toLowerCase().includes(q) ||
          d.ha_entity_id.toLowerCase().includes(q)
      );
    }

    if (categoryFilter !== "All") {
      list = list.filter((d) => d.category === categoryFilter);
    }

    if (stateFilter !== "All") {
      list = list.filter((d) => d.state === stateFilter);
    }

    if (onlineFilter !== "All") {
      list = list.filter((d) =>
        onlineFilter === "Online" ? d.is_online : !d.is_online
      );
    }

    return list;
  }, [devices, search, categoryFilter, stateFilter, onlineFilter]);

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  const renderPill = (
    label: string,
    active: boolean,
    onPress: () => void
  ) => (
    <TouchableOpacity
      key={label}
      style={[styles.pill, active && styles.pillActive]}
      onPress={onPress}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderSkeletonCard = () => (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonIcon} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[styles.skeletonLine, { width: "60%" }]} />
        <View style={[styles.skeletonLine, { width: "40%" }]} />
        <View style={[styles.skeletonLine, { width: "30%" }]} />
      </View>
    </View>
  );

  const renderDevice = ({ item }: { item: Device }) => {
    const isToggleable = TOGGLEABLE_CATEGORIES.includes(item.category);

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() =>
          navigation.navigate("DeviceControl", {
            deviceId: item.id as string,
          })
        }
      >
        <View style={styles.cardRow}>
          {/* Icon */}
          <View style={styles.iconWrap}>
            <Ionicons
              name={CATEGORY_ICONS[item.category] ?? "help-outline"}
              size={28}
              color="#D4A843"
            />
          </View>

          {/* Info */}
          <View style={styles.cardInfo}>
            <Text style={styles.deviceName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.deviceRoom} numberOfLines={1}>
              {item.room} &middot; {item.floor}
            </Text>

            <View style={styles.metaRow}>
              {/* State badge */}
              <View
                style={[
                  styles.stateBadge,
                  { backgroundColor: STATE_COLORS[item.state] + "20" },
                ]}
              >
                <Text
                  style={[
                    styles.stateBadgeText,
                    { color: STATE_COLORS[item.state] },
                  ]}
                >
                  {stateLabel(item.state)}
                </Text>
              </View>

              {/* Online indicator */}
              <View style={styles.onlineWrap}>
                <View
                  style={[
                    styles.onlineDot,
                    {
                      backgroundColor: item.is_online
                        ? "#22c55e"
                        : "#94a3b8",
                    },
                  ]}
                />
                <Text style={styles.onlineText}>
                  {item.is_online ? "Online" : "Offline"}
                </Text>
              </View>
            </View>

            <Text style={styles.lastSeen}>
              Last seen: {formatLastSeen(item.last_seen)}
            </Text>
          </View>

          {/* Toggle button */}
          {isToggleable && (
            <TouchableOpacity
              style={[
                styles.toggleBtn,
                item.state === "on" && styles.toggleBtnOn,
              ]}
              onPress={(e) => {
                e.stopPropagation?.();
                handleToggle(item);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={item.state === "on" ? "power" : "power-outline"}
                size={20}
                color={item.state === "on" ? "#fff" : "#64748b"}
              />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ------------------------------------------------------------------
  // Main render
  // ------------------------------------------------------------------

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons
          name="search-outline"
          size={18}
          color="#94a3b8"
          style={{ marginRight: 8 }}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search devices..."
          placeholderTextColor="#94a3b8"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Ionicons name="close-circle" size={18} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* Category filter pills */}
      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>Category</Text>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={["All", ...ALL_CATEGORIES] as ("All" | DeviceCategory)[]}
          keyExtractor={(item) => item}
          renderItem={({ item }) =>
            renderPill(
              item === "All"
                ? "All"
                : item.charAt(0).toUpperCase() +
                  item.slice(1).replace("_", " "),
              categoryFilter === item,
              () => setCategoryFilter(item)
            )
          }
          contentContainerStyle={styles.pillRow}
        />
      </View>

      {/* State filter pills */}
      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>State</Text>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={STATE_FILTERS}
          keyExtractor={(item) => item}
          renderItem={({ item }) =>
            renderPill(
              item === "All" ? "All" : stateLabel(item),
              stateFilter === item,
              () => setStateFilter(item)
            )
          }
          contentContainerStyle={styles.pillRow}
        />
      </View>

      {/* Online filter pills */}
      <View style={styles.filterSection}>
        <Text style={styles.filterLabel}>Status</Text>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={ONLINE_FILTERS}
          keyExtractor={(item) => item}
          renderItem={({ item }) =>
            renderPill(
              item,
              onlineFilter === item,
              () => setOnlineFilter(item)
            )
          }
          contentContainerStyle={styles.pillRow}
        />
      </View>

      {/* Device list */}
      {loading ? (
        <View style={styles.skeletonWrap}>
          {renderSkeletonCard()}
          {renderSkeletonCard()}
          {renderSkeletonCard()}
          {renderSkeletonCard()}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id as string}
          renderItem={renderDevice}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#D4A843"
              colors={["#D4A843"]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons
                name={filtersActive ? "filter-outline" : "cube-outline"}
                size={48}
                color="#94a3b8"
              />
              <Text style={styles.emptyTitle}>
                {filtersActive ? "No matching devices" : "No devices yet"}
              </Text>
              <Text style={styles.emptySubtitle}>
                {filtersActive
                  ? "Try adjusting your search or filters."
                  : "Add a device from Home Assistant to get started."}
              </Text>
            </View>
          }
        />
      )}

      {/* Add Device FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate("AddDevice" as any)}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={28} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDF6E3",
  },

  // Search
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: "#2D2D2D",
    padding: 0,
  },

  // Filters
  filterSection: {
    marginTop: 8,
    paddingLeft: 16,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  pillRow: {
    paddingRight: 16,
    gap: 6,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  pillActive: {
    backgroundColor: "#D4A843",
    borderColor: "#D4A843",
  },
  pillText: {
    fontSize: 13,
    color: "#64748b",
    fontWeight: "500",
  },
  pillTextActive: {
    color: "#fff",
  },

  // List
  listContent: {
    padding: 16,
    paddingTop: 12,
  },

  // Card
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "#FFF8E1",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#2D2D2D",
  },
  deviceRoom: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 2,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 10,
  },
  stateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  stateBadgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  onlineWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  onlineText: {
    fontSize: 12,
    color: "#64748b",
  },
  lastSeen: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 4,
  },

  // Toggle button
  toggleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  toggleBtnOn: {
    backgroundColor: "#D4A843",
  },

  // Skeleton
  skeletonWrap: {
    padding: 16,
  },
  skeletonCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginBottom: 10,
  },
  skeletonIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "#e2e8f0",
    marginRight: 12,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: "#e2e8f0",
  },

  // Empty state
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#2D2D2D",
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#94a3b8",
    marginTop: 4,
    textAlign: "center",
    paddingHorizontal: 40,
  },

  // FAB
  fab: {
    position: "absolute",
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#D4A843",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#D4A843",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
});
