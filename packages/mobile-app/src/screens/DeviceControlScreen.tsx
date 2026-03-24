import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import type {
  Device,
  DeviceId,
  DeviceState,
  DeviceStateChange,
} from "@clever/shared";
import { useAuthContext, type RootStackParamList } from "../lib/auth-context";
import { supabase } from "../lib/supabase";
import { callService, getStates } from "../lib/homeassistant";
import type { RealtimeChannel } from "@supabase/supabase-js";

type DeviceControlRouteProp = RouteProp<RootStackParamList, "DeviceControl">;

/** State color mapping */
const STATE_COLORS: Record<DeviceState, string> = {
  on: "#22c55e",
  off: "#94a3b8",
  locked: "#f59e0b",
  unlocked: "#ef4444",
  unknown: "#6b7280",
};

export default function DeviceControlScreen() {
  const route = useRoute<DeviceControlRouteProp>();
  const { user } = useAuthContext();
  const deviceId = route.params.deviceId as unknown as DeviceId;
  const tenantId = user?.tenant_id;

  const [device, setDevice] = useState<Device | null>(null);
  const [stateHistory, setStateHistory] = useState<DeviceStateChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  // Live HA state for media player
  const [haState, setHaState] = useState<{
    state: string;
    attributes: Record<string, unknown>;
  } | null>(null);

  /** Fetch device data from Supabase */
  const fetchDevice = useCallback(async () => {
    if (!tenantId || !deviceId) return;
    try {
      const [deviceRes, historyRes] = await Promise.all([
        supabase
          .from("devices")
          .select("*")
          .eq("id", deviceId as string)
          .eq("tenant_id", tenantId as string)
          .single(),
        supabase
          .from("device_state_changes")
          .select("*")
          .eq("device_id", deviceId as string)
          .eq("tenant_id", tenantId as string)
          .order("timestamp", { ascending: false })
          .limit(20),
      ]);
      if (deviceRes.data) setDevice(deviceRes.data as unknown as Device);
      if (historyRes.data) setStateHistory(historyRes.data as unknown as DeviceStateChange[]);
    } catch (err) {
      console.error("Failed to fetch device:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, deviceId]);

  /** Fetch live HA state */
  const fetchHaState = useCallback(async () => {
    if (!device?.ha_entity_id) return;
    try {
      const states = await getStates();
      const found = states.find((s) => s.entity_id === device.ha_entity_id);
      if (found) setHaState({ state: found.state, attributes: found.attributes });
    } catch {
      // HA might be unreachable
    }
  }, [device?.ha_entity_id]);

  useEffect(() => {
    void fetchDevice();
  }, [fetchDevice]);

  /** Fetch HA state once device is loaded, then poll every 5s */
  useEffect(() => {
    if (!device) return;
    void fetchHaState();
    const interval = setInterval(() => void fetchHaState(), 5000);
    return () => clearInterval(interval);
  }, [device, fetchHaState]);

  /** Subscribe to realtime updates */
  useEffect(() => {
    if (!tenantId || !deviceId) return;
    let channel: RealtimeChannel | null = null;
    channel = supabase
      .channel(`mobile_device:${deviceId as string}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "devices", filter: `id=eq.${deviceId as string}` },
        (payload) => setDevice(payload.new as unknown as Device))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "device_state_changes", filter: `device_id=eq.${deviceId as string}` },
        (payload) => setStateHistory((prev) => [payload.new as unknown as DeviceStateChange, ...prev.slice(0, 19)]))
      .subscribe();
    return () => { if (channel) void supabase.removeChannel(channel); };
  }, [tenantId, deviceId]);

  /** Send HA service call */
  const sendCommand = async (domain: string, service: string, data: Record<string, unknown> = {}) => {
    if (!device) return;
    try {
      await callService(domain, service, { entity_id: device.ha_entity_id, ...data });
      // Refresh HA state after a short delay
      setTimeout(() => void fetchHaState(), 1000);
    } catch (err) {
      Alert.alert("Command Failed", err instanceof Error ? err.message : "Unknown error");
    }
  };

  /** Toggle power */
  const handleToggle = async () => {
    if (!device || !device.is_online) return;
    setToggling(true);
    const domain = device.ha_entity_id.split(".")[0] ?? "";
    const isOn = (haState?.state ?? device.state) === "on" || haState?.state === "playing";
    try {
      await sendCommand(domain, isOn ? "turn_off" : "turn_on");
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return <View style={styles.centerContainer}><ActivityIndicator size="large" color="#D4A843" /></View>;
  }
  if (!device) {
    return <View style={styles.centerContainer}><Text style={styles.errorText}>Device not found</Text></View>;
  }

  const currentState = haState?.state ?? device.state;
  const isOn = currentState === "on" || currentState === "playing";
  const attrs = haState?.attributes ?? device.attributes;
  const isMediaPlayer = device.category === "media_player";
  const sourceList = (attrs.source_list as string[]) ?? [];
  const currentSource = attrs.source as string | undefined;
  const isMuted = attrs.is_volume_muted as boolean | undefined;
  const volume = attrs.volume_level as number | undefined;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.headerCard}>
        <Text style={styles.deviceName}>{device.name}</Text>
        <Text style={styles.deviceMeta}>{device.room} · {device.floor} · {device.category}</Text>
      </View>

      {/* Power + State */}
      <View style={styles.stateCard}>
        <View style={styles.stateRow}>
          <View>
            <Text style={styles.stateLabel}>Status</Text>
            <Text style={[styles.stateValue, { color: isOn ? "#22c55e" : "#94a3b8" }]}>
              {currentState.charAt(0).toUpperCase() + currentState.slice(1)}
            </Text>
          </View>
          <View style={styles.onlineStatus}>
            <View style={[styles.onlineDot, { backgroundColor: device.is_online ? "#22c55e" : "#dc2626" }]} />
            <Text style={styles.onlineText}>{device.is_online ? "Online" : "Offline"}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.powerButton, isOn ? styles.powerOn : styles.powerOff]}
          onPress={handleToggle}
          disabled={toggling}
          activeOpacity={0.8}
        >
          {toggling
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.powerButtonText}>{isOn ? "Power Off" : "Power On"}</Text>}
        </TouchableOpacity>
      </View>

      {/* Media Player Controls */}
      {isMediaPlayer && isOn && (
        <>
          {/* Volume */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Volume</Text>
            <View style={styles.volumeRow}>
              <TouchableOpacity style={styles.controlBtn} onPress={() => sendCommand("media_player", "volume_down")}>
                <Text style={styles.controlBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.volumeText}>
                {volume !== undefined ? `${Math.round(volume * 100)}%` : "—"}
              </Text>
              <TouchableOpacity style={styles.controlBtn} onPress={() => sendCommand("media_player", "volume_up")}>
                <Text style={styles.controlBtnText}>+</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.muteBtn, isMuted && styles.muteBtnActive]}
                onPress={() => sendCommand("media_player", "volume_mute", { is_volume_muted: !isMuted })}
              >
                <Text style={[styles.muteBtnText, isMuted && styles.muteBtnTextActive]}>
                  {isMuted ? "Unmute" : "Mute"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Media Controls */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Playback</Text>
            <View style={styles.mediaRow}>
              <TouchableOpacity style={styles.mediaBtn} onPress={() => sendCommand("media_player", "media_previous_track")}>
                <Text style={styles.mediaBtnText}>Prev</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.mediaBtn} onPress={() => sendCommand("media_player", "media_play_pause")}>
                <Text style={styles.mediaBtnText}>
                  {currentState === "playing" ? "Pause" : "Play"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.mediaBtn} onPress={() => sendCommand("media_player", "media_next_track")}>
                <Text style={styles.mediaBtnText}>Next</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Source / Input Selection */}
          {sourceList.length > 0 && (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Input Source</Text>
              {currentSource && (
                <Text style={styles.currentSource}>Current: {currentSource}</Text>
              )}
              <View style={styles.sourceGrid}>
                {sourceList.map((source) => (
                  <TouchableOpacity
                    key={source}
                    style={[styles.sourceBtn, currentSource === source && styles.sourceBtnActive]}
                    onPress={() => sendCommand("media_player", "select_source", { source })}
                  >
                    <Text style={[styles.sourceBtnText, currentSource === source && styles.sourceBtnTextActive]}>
                      {source}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </>
      )}

      {/* State history */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>State History</Text>
        {stateHistory.length === 0 ? (
          <Text style={styles.emptyText}>No state changes recorded</Text>
        ) : (
          stateHistory.map((change) => (
            <View key={change.id} style={styles.historyRow}>
              <View style={styles.historyStates}>
                <Text style={[styles.historyState, { color: STATE_COLORS[change.previous_state] }]}>
                  {change.previous_state}
                </Text>
                <Text style={styles.historyArrow}> → </Text>
                <Text style={[styles.historyState, { color: STATE_COLORS[change.new_state] }]}>
                  {change.new_state}
                </Text>
              </View>
              <Text style={styles.historyMeta}>
                {change.source} · {new Date(change.timestamp).toLocaleString()}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.footerCard}>
        <Text style={styles.footerText}>Last seen: {new Date(device.last_seen).toLocaleString()}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FDF6E3" },
  content: { padding: 16, paddingBottom: 32 },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#FDF6E3" },
  errorText: { fontSize: 16, color: "#dc2626" },

  headerCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 20, marginBottom: 12,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  deviceName: { fontSize: 22, fontWeight: "700", color: "#1a1a1a" },
  deviceMeta: { fontSize: 14, color: "#64748b", marginTop: 4 },

  stateCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 20, marginBottom: 12,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  stateRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  stateLabel: { fontSize: 13, color: "#64748b", marginBottom: 4 },
  stateValue: { fontSize: 28, fontWeight: "700" },
  onlineStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  onlineText: { fontSize: 13, color: "#64748b" },

  powerButton: { borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 20 },
  powerOn: { backgroundColor: "#D4A843" },
  powerOff: { backgroundColor: "#334155" },
  powerButtonText: { color: "#fff", fontSize: 18, fontWeight: "700" },

  sectionCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 20, marginBottom: 12,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#1a1a1a", marginBottom: 12 },

  // Volume
  volumeRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 },
  controlBtn: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: "#f1f5f9",
    justifyContent: "center", alignItems: "center",
  },
  controlBtnText: { fontSize: 24, fontWeight: "700", color: "#1a1a1a" },
  volumeText: { fontSize: 20, fontWeight: "600", color: "#1a1a1a", minWidth: 50, textAlign: "center" },
  muteBtn: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
    backgroundColor: "#f1f5f9", marginLeft: 8,
  },
  muteBtnActive: { backgroundColor: "#fef2f2" },
  muteBtnText: { fontSize: 14, fontWeight: "600", color: "#64748b" },
  muteBtnTextActive: { color: "#dc2626" },

  // Media controls
  mediaRow: { flexDirection: "row", justifyContent: "center", gap: 12 },
  mediaBtn: {
    paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12,
    backgroundColor: "#f1f5f9",
  },
  mediaBtnText: { fontSize: 15, fontWeight: "600", color: "#1a1a1a" },

  // Source selection
  currentSource: { fontSize: 14, color: "#D4A843", fontWeight: "600", marginBottom: 12 },
  sourceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sourceBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0",
  },
  sourceBtnActive: { backgroundColor: "#FFECB3", borderColor: "#D4A843" },
  sourceBtnText: { fontSize: 13, fontWeight: "500", color: "#334155" },
  sourceBtnTextActive: { color: "#D4A843", fontWeight: "600" },

  // History
  historyRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  historyStates: { flexDirection: "row", alignItems: "center" },
  historyState: { fontSize: 14, fontWeight: "600" },
  historyArrow: { fontSize: 14, color: "#94a3b8" },
  historyMeta: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  emptyText: { fontSize: 14, color: "#94a3b8", textAlign: "center", paddingVertical: 16 },

  footerCard: { alignItems: "center", paddingVertical: 8 },
  footerText: { fontSize: 12, color: "#94a3b8" },
});
