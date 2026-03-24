import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthContext } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CaregiverAlert {
  id: string;
  alert_type: string;
  severity: "info" | "warning" | "urgent" | "critical";
  message: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

type FilterTab = "all" | "unacknowledged";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, string> = {
  info: "#3b82f6",
  warning: "#f59e0b",
  urgent: "#f97316",
  critical: "#ef4444",
};

const SEVERITY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  info: "information-circle-outline",
  warning: "warning-outline",
  urgent: "alert-circle-outline",
  critical: "flame-outline",
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  urgent: 1,
  warning: 2,
  info: 3,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AideAlertsScreen() {
  const { user } = useAuthContext();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [alerts, setAlerts] = useState<CaregiverAlert[]>([]);
  const [aideProfileId, setAideProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>("unacknowledged");

  const tenantId = user?.tenant_id;

  const fetchAideProfileId = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase
      .from("aide_profiles")
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(1)
      .single();
    if (data) setAideProfileId(data.id);
  }, [tenantId]);

  const fetchAlerts = useCallback(async () => {
    if (!aideProfileId) return;
    try {
      const { data } = await supabase
        .from("aide_caregiver_alerts")
        .select(
          "id, alert_type, severity, message, acknowledged, acknowledged_by, acknowledged_at, created_at",
        )
        .eq("aide_profile_id", aideProfileId)
        .order("created_at", { ascending: false });

      if (data) {
        // Sort by severity then created_at (newest first within same severity)
        const sorted = [...data].sort((a, b) => {
          const sevDiff =
            (SEVERITY_ORDER[a.severity] ?? 4) -
            (SEVERITY_ORDER[b.severity] ?? 4);
          if (sevDiff !== 0) return sevDiff;
          return (
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
          );
        });
        setAlerts(sorted);
      }
    } catch (err) {
      console.error("Alerts fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [aideProfileId]);

  useEffect(() => {
    fetchAideProfileId();
  }, [fetchAideProfileId]);

  useEffect(() => {
    if (aideProfileId) fetchAlerts();
  }, [aideProfileId, fetchAlerts]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAlerts();
  }, [fetchAlerts]);

  const acknowledgeAlert = useCallback(
    async (alertId: string) => {
      if (!user) return;
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("aide_caregiver_alerts")
        .update({
          acknowledged: true,
          acknowledged_by: user.id ?? user.email ?? "caregiver",
          acknowledged_at: now,
        })
        .eq("id", alertId);

      if (!error) {
        setAlerts((prev) =>
          prev.map((a) =>
            a.id === alertId
              ? {
                  ...a,
                  acknowledged: true,
                  acknowledged_by: user.id ?? user.email ?? "caregiver",
                  acknowledged_at: now,
                }
              : a,
          ),
        );
      }
    },
    [user],
  );

  const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const filteredAlerts =
    activeTab === "unacknowledged"
      ? alerts.filter((a) => !a.acknowledged)
      : alerts;

  const renderAlert = ({ item }: { item: CaregiverAlert }) => {
    const color = SEVERITY_COLORS[item.severity] ?? "#6b7280";
    const icon = SEVERITY_ICONS[item.severity] ?? "information-circle-outline";

    return (
      <View
        style={[
          styles.alertCard,
          { borderLeftColor: color },
          item.acknowledged && styles.alertAcknowledged,
        ]}
      >
        <View style={styles.alertHeader}>
          <Ionicons name={icon} size={20} color={color} />
          <View style={styles.alertTitleCol}>
            <Text style={styles.alertType}>
              {item.alert_type.replace(/_/g, " ")}
            </Text>
            <Text style={styles.alertTime}>{timeAgo(item.created_at)}</Text>
          </View>
          <View style={[styles.severityBadge, { backgroundColor: color }]}>
            <Text style={styles.severityText}>{item.severity}</Text>
          </View>
        </View>

        <Text style={styles.alertMessage}>{item.message}</Text>

        {!item.acknowledged ? (
          <TouchableOpacity
            style={[styles.ackButton, { borderColor: color }]}
            onPress={() => acknowledgeAlert(item.id)}
            accessibilityLabel={`Acknowledge ${item.alert_type} alert`}
            accessibilityRole="button"
          >
            <Ionicons name="checkmark-circle-outline" size={18} color={color} />
            <Text style={[styles.ackButtonText, { color }]}>Acknowledge</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.ackInfo}>
            <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
            <Text style={styles.ackInfoText}>
              Acknowledged{" "}
              {item.acknowledged_at ? timeAgo(item.acknowledged_at) : ""}
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.header}>Alerts</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "all" && styles.tabActive]}
          onPress={() => setActiveTab("all")}
          accessibilityLabel="Show all alerts"
          accessibilityRole="button"
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "all" && styles.tabTextActive,
            ]}
          >
            All ({alerts.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === "unacknowledged" && styles.tabActive,
          ]}
          onPress={() => setActiveTab("unacknowledged")}
          accessibilityLabel="Show unacknowledged alerts"
          accessibilityRole="button"
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "unacknowledged" && styles.tabTextActive,
            ]}
          >
            Unacknowledged ({alerts.filter((a) => !a.acknowledged).length})
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <Text style={styles.emptyText}>Loading alerts...</Text>
      ) : filteredAlerts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="checkmark-circle-outline" size={48} color="#22c55e" />
          <Text style={styles.emptyText}>
            {activeTab === "unacknowledged"
              ? "All alerts acknowledged"
              : "No alerts"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredAlerts}
          keyExtractor={(item) => item.id}
          renderItem={renderAlert}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
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
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  header: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a1a1a",
    flex: 1,
    marginLeft: 12,
  },
  tabRow: {
    flexDirection: "row",
    backgroundColor: "#e2e8f0",
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#64748b",
  },
  tabTextActive: {
    color: "#1a1a1a",
    fontWeight: "600",
  },
  listContent: {
    paddingBottom: 16,
  },
  alertCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  alertAcknowledged: {
    opacity: 0.7,
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  alertTitleCol: {
    flex: 1,
  },
  alertType: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
    textTransform: "capitalize",
  },
  alertTime: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  severityText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  alertMessage: {
    fontSize: 13,
    color: "#475569",
    marginLeft: 28,
    marginBottom: 10,
  },
  ackButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  ackButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  ackInfo: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 4,
  },
  ackInfoText: {
    fontSize: 12,
    color: "#22c55e",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: "#94a3b8",
    textAlign: "center",
    marginTop: 16,
  },
});
