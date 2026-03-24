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

interface Medication {
  id: string;
  medication_name: string;
  dosage: string;
  scheduled_times: string[];
  refill_date: string | null;
  is_active: boolean;
  adherence_7d: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AideMedicationsScreen() {
  const { user } = useAuthContext();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [medications, setMedications] = useState<Medication[]>([]);
  const [aideProfileId, setAideProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  const fetchMedications = useCallback(async () => {
    if (!aideProfileId) return;
    try {
      const { data: meds } = await supabase
        .from("aide_medications")
        .select("id, medication_name, dosage, scheduled_times, refill_date, is_active")
        .eq("aide_profile_id", aideProfileId)
        .eq("is_active", true)
        .order("medication_name", { ascending: true });

      if (!meds || meds.length === 0) {
        setMedications([]);
        return;
      }

      // Fetch 7-day adherence from aide_medication_logs
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: logs } = await supabase
        .from("aide_medication_logs")
        .select("medication_id, status, scheduled_at")
        .eq("aide_profile_id", aideProfileId)
        .gte("scheduled_at", sevenDaysAgo.toISOString());

      const medsWithAdherence: Medication[] = meds.map((med) => {
        const medLogs = (logs ?? []).filter(
          (l: { medication_id: string }) => l.medication_id === med.id,
        );
        const totalLogs = medLogs.length;
        const takenLogs = medLogs.filter(
          (l: { status: string }) => l.status === "taken",
        ).length;
        const adherence =
          totalLogs > 0 ? Math.round((takenLogs / totalLogs) * 100) : 100;

        return {
          ...med,
          adherence_7d: adherence,
        };
      });

      setMedications(medsWithAdherence);
    } catch (err) {
      console.error("Medications fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [aideProfileId]);

  useEffect(() => {
    fetchAideProfileId();
  }, [fetchAideProfileId]);

  useEffect(() => {
    if (aideProfileId) fetchMedications();
  }, [aideProfileId, fetchMedications]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchMedications();
  }, [fetchMedications]);

  const isRefillSoon = (refillDate: string | null): boolean => {
    if (!refillDate) return false;
    const diff = new Date(refillDate).getTime() - Date.now();
    return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
  };

  const formatDate = (dateStr: string): string => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const adherenceColor = (pct: number): string => {
    if (pct >= 90) return "#22c55e";
    if (pct >= 70) return "#f59e0b";
    return "#ef4444";
  };

  const renderMedication = ({ item }: { item: Medication }) => {
    const refillWarning = isRefillSoon(item.refill_date);

    return (
      <View style={[styles.card, refillWarning && styles.cardRefillWarning]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="medical-outline" size={20} color="#D4A843" />
            <Text style={styles.medName}>{item.medication_name}</Text>
          </View>
          <View
            style={[
              styles.adherenceBadge,
              { backgroundColor: adherenceColor(item.adherence_7d) },
            ]}
          >
            <Text style={styles.adherenceText}>{item.adherence_7d}%</Text>
          </View>
        </View>

        <Text style={styles.dosageText}>{item.dosage}</Text>

        <View style={styles.timesRow}>
          <Ionicons name="time-outline" size={14} color="#64748b" />
          <Text style={styles.timesText}>
            {(item.scheduled_times ?? []).join(", ") || "No times set"}
          </Text>
        </View>

        {refillWarning && item.refill_date && (
          <View style={styles.refillWarningRow}>
            <Ionicons name="alert-circle" size={16} color="#f59e0b" />
            <Text style={styles.refillWarningText}>
              Refill due {formatDate(item.refill_date)}
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
        <Text style={styles.header}>Medications</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => navigation.navigate("AideAddMedication")}
          accessibilityLabel="Add medication"
          accessibilityRole="button"
        >
          <Ionicons name="add-circle" size={28} color="#D4A843" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <Text style={styles.emptyText}>Loading medications...</Text>
      ) : medications.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="medical-outline" size={48} color="#cbd5e1" />
          <Text style={styles.emptyText}>No active medications</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate("AideAddMedication")}
            accessibilityLabel="Add first medication"
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Add Medication</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={medications}
          keyExtractor={(item) => item.id}
          renderItem={renderMedication}
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
  addButton: {
    padding: 4,
  },
  listContent: {
    paddingBottom: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardRefillWarning: {
    borderColor: "#f59e0b",
    borderWidth: 1.5,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  medName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  adherenceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  adherenceText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  dosageText: {
    fontSize: 14,
    color: "#475569",
    marginBottom: 8,
    marginLeft: 28,
  },
  timesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 28,
  },
  timesText: {
    fontSize: 13,
    color: "#64748b",
  },
  refillWarningRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    backgroundColor: "#fffbeb",
    padding: 8,
    borderRadius: 8,
  },
  refillWarningText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#b45309",
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
  primaryButton: {
    backgroundColor: "#D4A843",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 8,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
