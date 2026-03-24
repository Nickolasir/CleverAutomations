import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  FlatList,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthContext } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoutineStep {
  id: string;
  step_order: number;
  description: string;
  action_type: string;
}

interface Routine {
  id: string;
  routine_name: string;
  scheduled_time: string;
  days_of_week: number[];
  is_active: boolean;
  steps: RoutineStep[];
  expanded: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_ABBREVS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AideRoutinesScreen() {
  const { user } = useAuthContext();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [routines, setRoutines] = useState<Routine[]>([]);
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

  const fetchRoutines = useCallback(async () => {
    if (!aideProfileId) return;
    try {
      const { data: routineRows } = await supabase
        .from("aide_routines")
        .select("id, routine_name, scheduled_time, days_of_week, is_active")
        .eq("aide_profile_id", aideProfileId)
        .order("scheduled_time", { ascending: true });

      if (!routineRows || routineRows.length === 0) {
        setRoutines([]);
        return;
      }

      // Fetch steps for all routines
      const routineIds = routineRows.map((r) => r.id);
      const { data: stepRows } = await supabase
        .from("aide_routine_steps")
        .select("id, routine_id, step_order, description, action_type")
        .in("routine_id", routineIds)
        .order("step_order", { ascending: true });

      const stepsMap: Record<string, RoutineStep[]> = {};
      (stepRows ?? []).forEach((s: any) => {
        if (!stepsMap[s.routine_id]) stepsMap[s.routine_id] = [];
        stepsMap[s.routine_id].push(s);
      });

      setRoutines(
        routineRows.map((r) => ({
          ...r,
          steps: stepsMap[r.id] ?? [],
          expanded: false,
        })),
      );
    } catch (err) {
      console.error("Routines fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [aideProfileId]);

  useEffect(() => {
    fetchAideProfileId();
  }, [fetchAideProfileId]);

  useEffect(() => {
    if (aideProfileId) fetchRoutines();
  }, [aideProfileId, fetchRoutines]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRoutines();
  }, [fetchRoutines]);

  const toggleActive = useCallback(
    async (routineId: string, currentValue: boolean) => {
      const newValue = !currentValue;
      // Optimistic update
      setRoutines((prev) =>
        prev.map((r) =>
          r.id === routineId ? { ...r, is_active: newValue } : r,
        ),
      );

      const { error } = await supabase
        .from("aide_routines")
        .update({ is_active: newValue })
        .eq("id", routineId);

      if (error) {
        // Revert on failure
        setRoutines((prev) =>
          prev.map((r) =>
            r.id === routineId ? { ...r, is_active: currentValue } : r,
          ),
        );
      }
    },
    [],
  );

  const toggleExpand = useCallback((routineId: string) => {
    setRoutines((prev) =>
      prev.map((r) =>
        r.id === routineId ? { ...r, expanded: !r.expanded } : r,
      ),
    );
  }, []);

  const formatTime = (timeStr: string): string => {
    // timeStr is expected as "HH:MM" or "HH:MM:SS"
    const parts = timeStr.split(":");
    if (parts.length < 2) return timeStr;
    const h = parseInt(parts[0], 10);
    const m = parts[1];
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${m} ${ampm}`;
  };

  const renderDays = (daysOfWeek: number[]) => {
    return (
      <View style={styles.daysRow}>
        {DAY_ABBREVS.map((day, idx) => {
          const active = daysOfWeek.includes(idx);
          return (
            <View
              key={idx}
              style={[styles.dayBadge, active && styles.dayBadgeActive]}
            >
              <Text
                style={[
                  styles.dayBadgeText,
                  active && styles.dayBadgeTextActive,
                ]}
              >
                {day}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  const renderRoutine = ({ item }: { item: Routine }) => (
    <View style={[styles.card, !item.is_active && styles.cardInactive]}>
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={() => toggleExpand(item.id)}
        accessibilityLabel={`${item.expanded ? "Collapse" : "Expand"} ${item.routine_name} routine`}
        accessibilityRole="button"
      >
        <View style={styles.cardTitleSection}>
          <Ionicons
            name="time-outline"
            size={20}
            color={item.is_active ? "#D4A843" : "#94a3b8"}
          />
          <View style={styles.cardTitleCol}>
            <Text
              style={[
                styles.routineName,
                !item.is_active && styles.textInactive,
              ]}
            >
              {item.routine_name}
            </Text>
            <Text style={styles.routineTime}>
              {formatTime(item.scheduled_time)}
            </Text>
          </View>
        </View>

        <View style={styles.cardRight}>
          <View style={styles.stepCountBadge}>
            <Text style={styles.stepCountText}>
              {item.steps.length} step{item.steps.length !== 1 ? "s" : ""}
            </Text>
          </View>
          <Switch
            value={item.is_active}
            onValueChange={() => toggleActive(item.id, item.is_active)}
            trackColor={{ false: "#e2e8f0", true: "#E8C86A" }}
            thumbColor={item.is_active ? "#D4A843" : "#94a3b8"}
            accessibilityLabel={`${item.is_active ? "Deactivate" : "Activate"} ${item.routine_name}`}
            accessibilityRole="switch"
          />
        </View>
      </TouchableOpacity>

      {renderDays(item.days_of_week)}

      {/* Expanded steps */}
      {item.expanded && item.steps.length > 0 && (
        <View style={styles.stepsContainer}>
          <View style={styles.stepsDivider} />
          {item.steps.map((step, idx) => (
            <View key={step.id} style={styles.stepRow}>
              <View style={styles.stepNumberCircle}>
                <Text style={styles.stepNumberText}>{idx + 1}</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepDescription}>
                  {step.description}
                </Text>
                {step.action_type && (
                  <Text style={styles.stepAction}>
                    {step.action_type.replace(/_/g, " ")}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {item.expanded && item.steps.length === 0 && (
        <View style={styles.stepsContainer}>
          <View style={styles.stepsDivider} />
          <Text style={styles.noStepsText}>No steps configured</Text>
        </View>
      )}

      {item.expanded && (
        <Ionicons
          name="chevron-up"
          size={18}
          color="#94a3b8"
          style={styles.chevron}
        />
      )}
      {!item.expanded && (
        <Ionicons
          name="chevron-down"
          size={18}
          color="#94a3b8"
          style={styles.chevron}
        />
      )}
    </View>
  );

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
        <Text style={styles.header}>Routines</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <Text style={styles.emptyText}>Loading routines...</Text>
      ) : routines.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="time-outline" size={48} color="#cbd5e1" />
          <Text style={styles.emptyText}>No routines configured</Text>
        </View>
      ) : (
        <FlatList
          data={routines}
          keyExtractor={(item) => item.id}
          renderItem={renderRoutine}
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
  listContent: {
    paddingBottom: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardInactive: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  cardTitleSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  cardTitleCol: {
    flex: 1,
  },
  routineName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  routineTime: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 2,
  },
  textInactive: {
    color: "#94a3b8",
  },
  cardRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepCountBadge: {
    backgroundColor: "#FFF8E1",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  stepCountText: {
    fontSize: 11,
    color: "#D4A843",
    fontWeight: "600",
  },
  daysRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 4,
  },
  dayBadge: {
    width: 36,
    height: 26,
    borderRadius: 6,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  dayBadgeActive: {
    backgroundColor: "#D4A843",
  },
  dayBadgeText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#94a3b8",
  },
  dayBadgeTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  stepsContainer: {
    marginTop: 8,
  },
  stepsDivider: {
    height: 1,
    backgroundColor: "#e2e8f0",
    marginBottom: 10,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  },
  stepNumberCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FFF8E1",
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#D4A843",
  },
  stepContent: {
    flex: 1,
  },
  stepDescription: {
    fontSize: 14,
    color: "#334155",
  },
  stepAction: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
    textTransform: "capitalize",
  },
  noStepsText: {
    fontSize: 13,
    color: "#94a3b8",
    textAlign: "center",
    paddingVertical: 8,
  },
  chevron: {
    alignSelf: "center",
    marginTop: 4,
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
