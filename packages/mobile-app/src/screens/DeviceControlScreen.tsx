import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import type {
  Device,
  DeviceId,
  DeviceState,
  DeviceStateChange,
} from "@clever/shared";
import { useAuthContext, type RootStackParamList } from "../../App";
import { supabase } from "../lib/supabase";
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

/**
 * Device control screen with tap-to-toggle.
 * Shows device details, current state, attributes, and state history.
 * Subscribes to Realtime for live updates to this specific device.
 */
export default function DeviceControlScreen() {
  const route = useRoute<DeviceControlRouteProp>();
  const { user } = useAuthContext();
  const deviceId = route.params.deviceId as unknown as DeviceId;
  const tenantId = user?.tenant_id;

  const [device, setDevice] = useState<Device | null>(null);
  const [stateHistory, setStateHistory] = useState<DeviceStateChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  /** Fetch device data */
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

      if (deviceRes.data) {
        setDevice(deviceRes.data as unknown as Device);
      }
      if (historyRes.data) {
        setStateHistory(historyRes.data as unknown as DeviceStateChange[]);
      }
    } catch (err) {
      console.error("Failed to fetch device:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, deviceId]);

  /** Subscribe to realtime updates for this device */
  useEffect(() => {
    void fetchDevice();

    let channel: RealtimeChannel | null = null;

    if (tenantId && deviceId) {
      channel = supabase
        .channel(`mobile_device:${deviceId as string}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "devices",
            filter: `id=eq.${deviceId as string}`,
          },
          (payload) => {
            setDevice(payload.new as unknown as Device);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "device_state_changes",
            filter: `device_id=eq.${deviceId as string}`,
          },
          (payload) => {
            setStateHistory((prev) => [
              payload.new as unknown as DeviceStateChange,
              ...prev.slice(0, 19),
            ]);
          }
        )
        .subscribe();
    }

    return () => {
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [tenantId, deviceId, fetchDevice]);

  /** Toggle device state */
  const handleToggle = async () => {
    if (!device || !device.is_online || device.state === "unknown") return;

    setToggling(true);

    let targetState: DeviceState;
    if (device.category === "lock") {
      targetState = device.state === "locked" ? "unlocked" : "locked";
    } else {
      targetState = device.state === "on" ? "off" : "on";
    }

    /** Optimistic update */
    setDevice((prev) => (prev ? { ...prev, state: targetState } : prev));

    try {
      const { error } = await supabase.from("device_commands").insert({
        device_id: deviceId,
        tenant_id: tenantId,
        action:
          device.category === "lock" ? targetState : `turn_${targetState}`,
        parameters: {},
        source: "mobile",
      });

      if (error) {
        Alert.alert("Command Failed", error.message);
        void fetchDevice(); // Revert
      }
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to send command"
      );
      void fetchDevice();
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Device not found</Text>
      </View>
    );
  }

  const isActive = device.state === "on" || device.state === "unlocked";
  const isToggleable =
    device.is_online &&
    device.state !== "unknown" &&
    ["light", "lock", "switch", "fan", "cover", "media_player"].includes(
      device.category
    );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Device info header */}
      <View style={styles.headerCard}>
        <Text style={styles.deviceName}>{device.name}</Text>
        <Text style={styles.deviceMeta}>
          {device.room} - {device.floor} - {device.category}
        </Text>
        <Text style={styles.entityId}>{device.ha_entity_id}</Text>
      </View>

      {/* Current state + toggle button */}
      <View style={styles.stateCard}>
        <View style={styles.stateRow}>
          <View>
            <Text style={styles.stateLabel}>Current State</Text>
            <View style={styles.stateValueRow}>
              <View
                style={[
                  styles.stateDot,
                  { backgroundColor: STATE_COLORS[device.state] },
                ]}
              />
              <Text
                style={[styles.stateValue, { color: STATE_COLORS[device.state] }]}
              >
                {device.state.charAt(0).toUpperCase() + device.state.slice(1)}
              </Text>
            </View>
          </View>

          <View style={styles.onlineStatus}>
            <View
              style={[
                styles.onlineDot,
                {
                  backgroundColor: device.is_online ? "#22c55e" : "#dc2626",
                },
              ]}
            />
            <Text style={styles.onlineText}>
              {device.is_online ? "Online" : "Offline"}
            </Text>
          </View>
        </View>

        {/* Large toggle button */}
        {isToggleable && (
          <TouchableOpacity
            style={[
              styles.toggleButton,
              isActive ? styles.toggleButtonActive : styles.toggleButtonInactive,
            ]}
            onPress={handleToggle}
            disabled={toggling}
            activeOpacity={0.8}
          >
            {toggling ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.toggleButtonText}>
                {isActive ? "Turn Off" : "Turn On"}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {!device.is_online && (
          <View style={styles.offlineWarning}>
            <Text style={styles.offlineWarningText}>
              Device is offline. Commands cannot be sent.
            </Text>
          </View>
        )}
      </View>

      {/* Attributes */}
      {Object.keys(device.attributes).length > 0 && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Attributes</Text>
          {Object.entries(device.attributes).map(([key, value]) => (
            <View key={key} style={styles.attributeRow}>
              <Text style={styles.attributeKey}>
                {key.replace(/_/g, " ")}
              </Text>
              <Text style={styles.attributeValue}>{String(value)}</Text>
            </View>
          ))}
        </View>
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
                <Text
                  style={[
                    styles.historyState,
                    { color: STATE_COLORS[change.previous_state] },
                  ]}
                >
                  {change.previous_state}
                </Text>
                <Text style={styles.historyArrow}> → </Text>
                <Text
                  style={[
                    styles.historyState,
                    { color: STATE_COLORS[change.new_state] },
                  ]}
                >
                  {change.new_state}
                </Text>
              </View>
              <Text style={styles.historyMeta}>
                {change.source} - {new Date(change.timestamp).toLocaleString()}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Last seen */}
      <View style={styles.footerCard}>
        <Text style={styles.footerText}>
          Last seen: {new Date(device.last_seen).toLocaleString()}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8fafc",
  },
  errorText: {
    fontSize: 16,
    color: "#dc2626",
  },
  headerCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  deviceName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0f172a",
  },
  deviceMeta: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 4,
  },
  entityId: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  stateCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  stateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  stateLabel: {
    fontSize: 13,
    color: "#64748b",
    marginBottom: 4,
  },
  stateValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stateDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  stateValue: {
    fontSize: 28,
    fontWeight: "700",
  },
  onlineStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  onlineText: {
    fontSize: 13,
    color: "#64748b",
  },
  toggleButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 20,
  },
  toggleButtonActive: {
    backgroundColor: "#2563eb",
  },
  toggleButtonInactive: {
    backgroundColor: "#334155",
  },
  toggleButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },
  offlineWarning: {
    backgroundColor: "#fef2f2",
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
  },
  offlineWarningText: {
    fontSize: 13,
    color: "#dc2626",
    textAlign: "center",
  },
  sectionCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 12,
  },
  attributeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  attributeKey: {
    fontSize: 14,
    color: "#64748b",
    textTransform: "capitalize",
  },
  attributeValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  historyRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  historyStates: {
    flexDirection: "row",
    alignItems: "center",
  },
  historyState: {
    fontSize: 14,
    fontWeight: "600",
  },
  historyArrow: {
    fontSize: 14,
    color: "#94a3b8",
  },
  historyMeta: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    color: "#94a3b8",
    textAlign: "center",
    paddingVertical: 16,
  },
  footerCard: {
    alignItems: "center",
    paddingVertical: 8,
  },
  footerText: {
    fontSize: 12,
    color: "#94a3b8",
  },
});

/** Platform import for font family */
import { Platform } from "react-native";
