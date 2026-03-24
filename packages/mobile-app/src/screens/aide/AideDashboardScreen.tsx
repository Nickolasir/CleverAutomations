import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthContext } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardData {
  profile: {
    id: string;
    mobility_level: string;
    cognitive_level: string;
    family_member_profiles: { agent_name: string; user_id: string };
  } | null;
  last_activity: { event_type: string; room: string; created_at: string } | null;
  last_checkin: {
    checkin_type: string;
    status: string;
    mood_rating: number | null;
    pain_level: number | null;
    created_at: string;
  } | null;
  active_alerts: Array<{
    id: string;
    alert_type: string;
    severity: string;
    message: string;
    created_at: string;
  }>;
  active_alert_count: number;
  medication_adherence_today: number | null;
  medications_due_today: number;
  medications_taken_today: number;
}

// ---------------------------------------------------------------------------
// Severity colors
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AideDashboardScreen() {
  const { user } = useAuthContext();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [aideProfileId, setAideProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const tenantId = user?.tenant_id;

  // Fetch the aide profile ID for this tenant (caregiver's managed profile)
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

  const fetchDashboard = useCallback(async () => {
    if (!aideProfileId) return;
    try {
      const response = await supabase.functions.invoke("aide-wellness", {
        body: null,
        method: "GET",
        headers: {},
      });

      // Alternative: direct queries for the dashboard
      const [profileRes, lastActivityRes, lastCheckinRes, alertsRes, todayLogsRes, medsRes] =
        await Promise.all([
          supabase
            .from("aide_profiles")
            .select("*, family_member_profiles!inner(agent_name, user_id)")
            .eq("id", aideProfileId)
            .single(),
          supabase
            .from("aide_activity_log")
            .select("event_type, room, created_at")
            .eq("aide_profile_id", aideProfileId)
            .order("created_at", { ascending: false })
            .limit(1)
            .single(),
          supabase
            .from("aide_wellness_checkins")
            .select("checkin_type, status, mood_rating, pain_level, created_at")
            .eq("aide_profile_id", aideProfileId)
            .order("created_at", { ascending: false })
            .limit(1)
            .single(),
          supabase
            .from("aide_caregiver_alerts")
            .select("id, alert_type, severity, message, created_at")
            .eq("aide_profile_id", aideProfileId)
            .eq("acknowledged", false)
            .order("created_at", { ascending: false }),
          supabase
            .from("aide_medication_logs")
            .select("medication_id, status")
            .eq("aide_profile_id", aideProfileId)
            .gte("scheduled_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
          supabase
            .from("aide_medications")
            .select("id")
            .eq("aide_profile_id", aideProfileId)
            .eq("is_active", true),
        ]);

      const totalMeds = medsRes.data?.length ?? 0;
      const takenToday = (todayLogsRes.data ?? []).filter(
        (l: { status: string }) => l.status === "taken",
      ).length;

      setDashboard({
        profile: profileRes.data,
        last_activity: lastActivityRes.data,
        last_checkin: lastCheckinRes.data,
        active_alerts: alertsRes.data ?? [],
        active_alert_count: alertsRes.data?.length ?? 0,
        medication_adherence_today:
          totalMeds > 0 ? Math.round((takenToday / totalMeds) * 100) : null,
        medications_due_today: totalMeds,
        medications_taken_today: takenToday,
      });
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [aideProfileId]);

  useEffect(() => {
    fetchAideProfileId();
  }, [fetchAideProfileId]);

  useEffect(() => {
    if (aideProfileId) fetchDashboard();
  }, [aideProfileId, fetchDashboard]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDashboard();
  }, [fetchDashboard]);

  const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  if (!aideProfileId) {
    return (
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <Text style={styles.emptyText}>
          No CleverAide profile found. Set up an assisted living profile first.
        </Text>
        <TouchableOpacity
          style={styles.setupButton}
          onPress={() => navigation.navigate("AideProfileSetup")}
          accessibilityLabel="Set up CleverAide profile"
          accessibilityRole="button"
        >
          <Text style={styles.setupButtonText}>Set Up CleverAide</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header */}
      <Text style={styles.header}>CleverAide Dashboard</Text>
      {dashboard?.profile && (
        <Text style={styles.subheader}>
          Monitoring: {dashboard.profile.family_member_profiles.agent_name}
        </Text>
      )}

      {/* Status Cards Row */}
      <View style={styles.cardRow}>
        {/* Last Activity */}
        <TouchableOpacity
          style={styles.card}
          accessibilityLabel={`Last activity: ${
            dashboard?.last_activity
              ? `${dashboard.last_activity.event_type} in ${dashboard.last_activity.room}`
              : "No data"
          }`}
        >
          <Ionicons name="footsteps-outline" size={24} color="#D4A843" />
          <Text style={styles.cardLabel}>Last Activity</Text>
          <Text style={styles.cardValue}>
            {dashboard?.last_activity
              ? timeAgo(dashboard.last_activity.created_at)
              : "—"}
          </Text>
          <Text style={styles.cardDetail}>
            {dashboard?.last_activity?.room ?? ""}
          </Text>
        </TouchableOpacity>

        {/* Medication Adherence */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate("AideMedications")}
          accessibilityLabel={`Medication adherence: ${
            dashboard?.medication_adherence_today ?? 0
          } percent`}
          accessibilityRole="button"
        >
          <Ionicons name="medical-outline" size={24} color="#22c55e" />
          <Text style={styles.cardLabel}>Meds Today</Text>
          <Text style={styles.cardValue}>
            {dashboard?.medication_adherence_today != null
              ? `${dashboard.medication_adherence_today}%`
              : "—"}
          </Text>
          <Text style={styles.cardDetail}>
            {dashboard ? `${dashboard.medications_taken_today}/${dashboard.medications_due_today}` : ""}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cardRow}>
        {/* Last Check-in */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate("AideWellness")}
          accessibilityLabel={`Last check-in: ${
            dashboard?.last_checkin?.status ?? "No data"
          }`}
          accessibilityRole="button"
        >
          <Ionicons name="heart-outline" size={24} color="#a855f7" />
          <Text style={styles.cardLabel}>Last Check-in</Text>
          <Text style={styles.cardValue}>
            {dashboard?.last_checkin
              ? dashboard.last_checkin.status === "completed"
                ? "OK"
                : dashboard.last_checkin.status
              : "—"}
          </Text>
          <Text style={styles.cardDetail}>
            {dashboard?.last_checkin
              ? timeAgo(dashboard.last_checkin.created_at)
              : ""}
          </Text>
        </TouchableOpacity>

        {/* Active Alerts */}
        <TouchableOpacity
          style={[
            styles.card,
            dashboard?.active_alert_count
              ? { borderColor: "#ef4444", borderWidth: 2 }
              : {},
          ]}
          onPress={() => navigation.navigate("AideAlerts")}
          accessibilityLabel={`${dashboard?.active_alert_count ?? 0} active alerts`}
          accessibilityRole="button"
        >
          <Ionicons
            name="notifications-outline"
            size={24}
            color={dashboard?.active_alert_count ? "#ef4444" : "#6b7280"}
          />
          <Text style={styles.cardLabel}>Alerts</Text>
          <Text
            style={[
              styles.cardValue,
              dashboard?.active_alert_count ? { color: "#ef4444" } : {},
            ]}
          >
            {dashboard?.active_alert_count ?? 0}
          </Text>
          <Text style={styles.cardDetail}>unacknowledged</Text>
        </TouchableOpacity>
      </View>

      {/* Active Alerts List */}
      {dashboard?.active_alerts && dashboard.active_alerts.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active Alerts</Text>
          {dashboard.active_alerts.slice(0, 5).map((alert) => (
            <View
              key={alert.id}
              style={[
                styles.alertItem,
                { borderLeftColor: SEVERITY_COLORS[alert.severity] ?? "#6b7280" },
              ]}
            >
              <View style={styles.alertHeader}>
                <Ionicons
                  name={SEVERITY_ICONS[alert.severity] ?? "information-circle-outline"}
                  size={18}
                  color={SEVERITY_COLORS[alert.severity] ?? "#6b7280"}
                />
                <Text style={styles.alertType}>
                  {alert.alert_type.replace(/_/g, " ")}
                </Text>
                <Text style={styles.alertTime}>{timeAgo(alert.created_at)}</Text>
              </View>
              <Text style={styles.alertMessage}>{alert.message}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate("AideMedications")}
            accessibilityLabel="View medications"
            accessibilityRole="button"
          >
            <Ionicons name="medical-outline" size={22} color="#fff" />
            <Text style={styles.actionText}>Medications</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate("AideWellness")}
            accessibilityLabel="View wellness history"
            accessibilityRole="button"
          >
            <Ionicons name="heart-outline" size={22} color="#fff" />
            <Text style={styles.actionText}>Wellness</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate("AideRoutines")}
            accessibilityLabel="View routines"
            accessibilityRole="button"
          >
            <Ionicons name="time-outline" size={22} color="#fff" />
            <Text style={styles.actionText}>Routines</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
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
  header: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  subheader: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: "#64748b",
    textAlign: "center",
    marginTop: 40,
  },
  setupButton: {
    backgroundColor: "#D4A843",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignSelf: "center",
    marginTop: 24,
  },
  setupButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  cardRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  card: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardLabel: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 8,
  },
  cardValue: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a1a1a",
    marginTop: 4,
  },
  cardDetail: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 12,
  },
  alertItem: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 4,
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  alertType: {
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
    flex: 1,
    textTransform: "capitalize",
  },
  alertTime: {
    fontSize: 11,
    color: "#94a3b8",
  },
  alertMessage: {
    fontSize: 13,
    color: "#475569",
    marginLeft: 26,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: "#D4A843",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    gap: 6,
  },
  actionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});
