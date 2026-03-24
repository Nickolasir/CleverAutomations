import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  SectionList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { Device, DeviceCategory, DeviceState, VoiceTier } from "@clever/shared";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

/** Device category icons using Ionicons */
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

const TIER_COLORS: Record<VoiceTier, string> = {
  tier1_rules: "#22c55e",
  tier2_cloud: "#3b82f6",
  tier3_local: "#f59e0b",
};

const TIER_LABELS: Record<VoiceTier, string> = {
  tier1_rules: "Rules",
  tier2_cloud: "Cloud",
  tier3_local: "Local",
};

export default function DashboardScreen() {
  const { user, tenant, signOut } = useAuthContext();
  const navigation = useNavigation<any>();

  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Voice stats
  const [voiceCount, setVoiceCount] = useState(0);
  const [avgLatency, setAvgLatency] = useState(0);
  const [tierBreakdown, setTierBreakdown] = useState<{ tier: VoiceTier; count: number; percentage: number; avgLatencyMs: number }[]>([]);

  const tenantId = user?.tenant_id;

  /** Fetch all devices */
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

  /** Fetch voice stats */
  const fetchVoiceStats = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error } = await supabase
        .from("voice_transcripts")
        .select("tier_used, latency_ms")
        .eq("tenant_id", tenantId as string);

      if (error || !data) return;

      const transcripts = data as unknown as { tier_used: VoiceTier; latency_ms: number }[];
      setVoiceCount(transcripts.length);

      if (transcripts.length > 0) {
        const totalLatency = transcripts.reduce((sum, t) => sum + t.latency_ms, 0);
        setAvgLatency(Math.round(totalLatency / transcripts.length));

        const tierMap = new Map<VoiceTier, { count: number; totalLatency: number }>();
        for (const t of transcripts) {
          const existing = tierMap.get(t.tier_used) ?? { count: 0, totalLatency: 0 };
          existing.count++;
          existing.totalLatency += t.latency_ms;
          tierMap.set(t.tier_used, existing);
        }

        const breakdown = Array.from(tierMap.entries()).map(([tier, stats]) => ({
          tier,
          count: stats.count,
          percentage: Math.round((stats.count / transcripts.length) * 100),
          avgLatencyMs: Math.round(stats.totalLatency / stats.count),
        }));
        setTierBreakdown(breakdown);
      }
    } catch (err) {
      console.error("Fetch voice stats error:", err);
    }
  }, [tenantId]);

  /** Subscribe to realtime updates */
  useEffect(() => {
    if (!tenantId) return;

    void fetchDevices();
    void fetchVoiceStats();

    let channel: RealtimeChannel | null = null;

    channel = supabase
      .channel(`mobile_dashboard:${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "devices", filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          switch (payload.eventType) {
            case "INSERT":
              setDevices((prev) => [...prev, payload.new as unknown as Device]);
              break;
            case "UPDATE":
              setDevices((prev) =>
                prev.map((d) =>
                  d.id === (payload.new as unknown as Device).id ? (payload.new as unknown as Device) : d
                )
              );
              break;
            case "DELETE":
              setDevices((prev) => prev.filter((d) => d.id !== (payload.old as unknown as Device).id));
              break;
          }
        }
      )
      .subscribe();

    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [tenantId, fetchDevices, fetchVoiceStats]);

  /** Compute metrics */
  const metrics = useMemo(() => {
    const total = devices.length;
    const online = devices.filter((d) => d.is_online).length;
    const active = devices.filter((d) => d.state === "on" || d.state === "unlocked").length;
    const rooms = new Set(devices.map((d) => d.room));
    return { total, online, active, offline: total - online, roomCount: rooms.size };
  }, [devices]);

  /** Toggle device state */
  const toggleDevice = async (device: Device) => {
    if (!device.is_online || device.state === "unknown") return;

    const targetState: DeviceState =
      device.category === "lock"
        ? device.state === "locked" ? "unlocked" : "locked"
        : device.state === "on" ? "off" : "on";

    setDevices((prev) =>
      prev.map((d) => (d.id === device.id ? { ...d, state: targetState } : d))
    );

    const { error } = await supabase.from("device_commands").insert({
      device_id: device.id,
      tenant_id: tenantId,
      action: device.category === "lock" ? targetState : `turn_${targetState}`,
      parameters: {},
      source: "mobile",
    });

    if (error) void fetchDevices();
  };

  /** Build sections grouped by room */
  const sections = useMemo(() => {
    const roomMap = new Map<string, Device[]>();
    for (const device of devices) {
      const existing = roomMap.get(device.room) ?? [];
      existing.push(device);
      roomMap.set(device.room, existing);
    }

    return Array.from(roomMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([room, roomDevices]) => ({ title: room, data: roomDevices }));
  }, [devices]);

  const onRefresh = () => {
    setRefreshing(true);
    void fetchDevices();
    void fetchVoiceStats();
  };

  /** Render a single device card */
  const renderDevice = ({ item: device }: { item: Device }) => {
    const isActive = device.state === "on" || device.state === "unlocked";
    const isToggleable =
      device.is_online &&
      device.state !== "unknown" &&
      ["light", "lock", "switch", "fan", "cover", "media_player"].includes(device.category);

    return (
      <TouchableOpacity
        style={[
          styles.deviceCard,
          isActive && styles.deviceCardActive,
          !device.is_online && styles.deviceCardOffline,
        ]}
        onPress={() => navigation.navigate("DeviceControl", { deviceId: device.id as string })}
        onLongPress={() => {
          if (isToggleable) void toggleDevice(device);
        }}
        activeOpacity={0.7}
      >
        <View style={styles.deviceHeader}>
          <View style={[styles.categoryBadge, { backgroundColor: isActive ? "#FFECB3" : "#f1f5f9" }]}>
            <Ionicons
              name={CATEGORY_ICONS[device.category]}
              size={18}
              color={isActive ? "#D4A843" : "#64748b"}
            />
          </View>
          <View style={styles.onlineRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: device.is_online ? STATE_COLORS[device.state] : "#dc2626" },
              ]}
            />
            <Text style={styles.onlineLabel}>
              {device.is_online ? "Online" : "Offline"}
            </Text>
          </View>
        </View>

        <Text style={styles.deviceName} numberOfLines={1}>
          {device.name}
        </Text>
        <Text style={styles.deviceRoom}>{device.room}</Text>

        <View style={styles.deviceFooter}>
          <View style={[styles.statePill, { backgroundColor: isActive ? "#FFECB3" : "#f1f5f9" }]}>
            <View style={[styles.statePillDot, { backgroundColor: STATE_COLORS[device.state] }]} />
            <Text style={[styles.stateLabel, { color: isActive ? "#D4A843" : "#64748b" }]}>
              {device.state.charAt(0).toUpperCase() + device.state.slice(1)}
            </Text>
          </View>
          {isToggleable && (
            <Text style={styles.tapHint}>Hold to toggle</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  /** Render room section header */
  const renderSectionHeader = ({ section }: { section: { title: string; data: Device[] } }) => {
    const onlineCount = section.data.filter((d) => d.is_online).length;
    const activeCount = section.data.filter((d) => d.state === "on" || d.state === "unlocked").length;
    return (
      <View style={styles.sectionHeader}>
        <View style={styles.sectionLeft}>
          <Ionicons name="home-outline" size={16} color="#64748b" />
          <Text style={styles.sectionTitle}>{section.title}</Text>
        </View>
        <View style={styles.sectionRight}>
          <Text style={styles.sectionMeta}>{section.data.length} devices</Text>
          <View style={styles.sectionDivider} />
          <Text style={[styles.sectionMeta, { color: "#22c55e" }]}>{onlineCount} online</Text>
          <View style={styles.sectionDivider} />
          <Text style={[styles.sectionMeta, { color: "#D4A843" }]}>{activeCount} active</Text>
        </View>
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
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id as string}
        renderItem={renderDevice}
        renderSectionHeader={renderSectionHeader}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A843" />
        }
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled
        ListHeaderComponent={
          <View>
            {/* Page title + Add Device */}
            <View style={styles.pageHeader}>
              <View style={styles.pageHeaderTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pageTitle}>{tenant?.name ?? "Dashboard"}</Text>
                  <Text style={styles.pageSubtitle}>Real-time overview of your smart home devices</Text>
                </View>
                <TouchableOpacity
                  style={styles.addDeviceBtn}
                  onPress={() => navigation.navigate("AddDevice" as any)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="add" size={18} color="#ffffff" />
                  <Text style={styles.addDeviceBtnText}>Add Device</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Summary metric cards */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Total Devices</Text>
                <Text style={styles.metricValue}>{metrics.total}</Text>
                <Text style={styles.metricSub}>across {metrics.roomCount} rooms</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Online</Text>
                <Text style={[styles.metricValue, { color: "#22c55e" }]}>{metrics.online}</Text>
                <Text style={styles.metricSub}>
                  {metrics.offline > 0 ? `${metrics.offline} offline` : "All connected"}
                </Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Active</Text>
                <Text style={[styles.metricValue, { color: "#D4A843" }]}>{metrics.active}</Text>
                <Text style={styles.metricSub}>on or unlocked</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Voice Cmds</Text>
                <Text style={styles.metricValue}>{voiceCount}</Text>
                <Text style={styles.metricSub}>avg {avgLatency}ms</Text>
              </View>
            </View>

            {/* Tier distribution bar */}
            {tierBreakdown.length > 0 && (
              <View style={styles.tierCard}>
                <Text style={styles.tierTitle}>Voice Pipeline Tiers</Text>
                <View style={styles.tierBar}>
                  {tierBreakdown.map((tier) => (
                    <View
                      key={tier.tier}
                      style={[
                        styles.tierSegment,
                        { backgroundColor: TIER_COLORS[tier.tier], flex: tier.percentage },
                      ]}
                    >
                      {tier.percentage > 15 && (
                        <Text style={styles.tierBarLabel}>{tier.percentage}%</Text>
                      )}
                    </View>
                  ))}
                </View>
                <View style={styles.tierLegend}>
                  {tierBreakdown.map((tier) => (
                    <View key={tier.tier} style={styles.tierLegendItem}>
                      <View style={[styles.tierLegendDot, { backgroundColor: TIER_COLORS[tier.tier] }]} />
                      <Text style={styles.tierLegendText}>
                        {TIER_LABELS[tier.tier]} {tier.percentage}%
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Section heading */}
            <View style={styles.allDevicesHeader}>
              <Ionicons name="grid-outline" size={18} color="#1a1a1a" />
              <Text style={styles.allDevicesTitle}>All Devices</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="cube-outline" size={48} color="#94a3b8" />
            <Text style={styles.emptyText}>No devices yet</Text>
            <Text style={styles.emptySubtext}>
              Add devices via the Devices tab to get started
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FDF6E3" },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#FDF6E3" },
  loadingText: { fontSize: 14, color: "#64748b" },
  listContent: { paddingBottom: 24 },

  // Page header
  pageHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  pageHeaderTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  pageTitle: { fontSize: 24, fontWeight: "700", color: "#1a1a1a" },
  pageSubtitle: { fontSize: 14, color: "#64748b", marginTop: 2 },
  addDeviceBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#D4A843", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  addDeviceBtnText: { fontSize: 13, fontWeight: "600", color: "#ffffff" },

  // Metric cards
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 8, marginBottom: 12 },
  metricCard: {
    flexBasis: "47%", flexGrow: 1, backgroundColor: "#ffffff", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  metricLabel: { fontSize: 12, fontWeight: "500", color: "#64748b" },
  metricValue: { fontSize: 28, fontWeight: "700", color: "#1a1a1a", marginTop: 4 },
  metricSub: { fontSize: 11, color: "#94a3b8", marginTop: 2 },

  // Tier card
  tierCard: {
    backgroundColor: "#ffffff", borderRadius: 14, padding: 16, marginHorizontal: 12, marginBottom: 16,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  tierTitle: { fontSize: 14, fontWeight: "700", color: "#1a1a1a", marginBottom: 12 },
  tierBar: { flexDirection: "row", height: 24, borderRadius: 12, overflow: "hidden" },
  tierSegment: { justifyContent: "center", alignItems: "center" },
  tierBarLabel: { fontSize: 11, fontWeight: "700", color: "#ffffff" },
  tierLegend: { flexDirection: "row", marginTop: 10, gap: 16 },
  tierLegendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  tierLegendDot: { width: 8, height: 8, borderRadius: 4 },
  tierLegendText: { fontSize: 12, color: "#64748b" },

  // All devices header
  allDevicesHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  allDevicesTitle: { fontSize: 18, fontWeight: "700", color: "#1a1a1a" },

  // Section header
  sectionHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#FDF6E3",
    borderBottomWidth: 1, borderBottomColor: "#e2e8f0",
  },
  sectionLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#1a1a1a" },
  sectionRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionMeta: { fontSize: 11, color: "#64748b" },
  sectionDivider: { width: 1, height: 12, backgroundColor: "#cbd5e1" },

  // Device card
  deviceCard: {
    backgroundColor: "#ffffff", marginHorizontal: 16, marginTop: 8, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "#e2e8f0",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 2, elevation: 1,
  },
  deviceCardActive: { borderColor: "#FFE082", backgroundColor: "#FFF8E1" },
  deviceCardOffline: { opacity: 0.6 },
  deviceHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  categoryBadge: { width: 36, height: 36, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  onlineRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  onlineLabel: { fontSize: 12, color: "#64748b" },
  deviceName: { fontSize: 15, fontWeight: "600", color: "#1a1a1a" },
  deviceRoom: { fontSize: 12, color: "#64748b", marginTop: 2 },
  deviceFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  statePill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statePillDot: { width: 6, height: 6, borderRadius: 3 },
  stateLabel: { fontSize: 12, fontWeight: "600" },
  tapHint: { fontSize: 11, color: "#94a3b8" },

  // Empty
  emptyContainer: { alignItems: "center", paddingVertical: 64 },
  emptyText: { fontSize: 16, fontWeight: "600", color: "#64748b", marginTop: 12 },
  emptySubtext: { fontSize: 13, color: "#94a3b8", marginTop: 4 },
});
