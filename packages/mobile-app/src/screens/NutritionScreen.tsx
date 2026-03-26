import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ScrollView,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";
import NutritionProgressBars, {
  type DailyNutritionSummary,
  type NutritionGoals,
} from "../components/nutrition/NutritionProgressBars";
import WaterTracker from "../components/nutrition/WaterTracker";
import FoodEntryModal, {
  type MealType,
} from "../components/nutrition/FoodEntryModal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabKey = "log" | "summary" | "settings";

interface FoodLogEntry {
  id: string;
  user_id: string;
  tenant_id: string;
  meal_type: MealType;
  description: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  source: "text" | "barcode" | "photo" | "voice";
  logged_at: string;
}

interface WeeklyDay {
  label: string;
  calories: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS: { key: TabKey; label: string }[] = [
  { key: "log", label: "Log" },
  { key: "summary", label: "Summary" },
  { key: "settings", label: "Settings" },
];

const MEAL_ICONS: Record<MealType, keyof typeof Ionicons.glyphMap> = {
  breakfast: "sunny-outline",
  lunch: "restaurant-outline",
  dinner: "moon-outline",
  snack: "cafe-outline",
  drink: "beer-outline",
};

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
  drink: "Drink",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getWeekDates(): string[] {
  const dates: string[] = [];
  const today = new Date();
  const dayOfWeek = today.getDay();
  const start = new Date(today);
  start.setDate(today.getDate() - dayOfWeek);

  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NutritionScreen() {
  const { user } = useAuthContext();
  const insets = useSafeAreaInsets();
  const tenantId = user?.tenant_id;

  // Tab state
  const [activeTab, setActiveTab] = useState<TabKey>("log");

  // Data state
  const [entries, setEntries] = useState<FoodLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  // Summary state
  const [weeklySummary, setWeeklySummary] = useState<WeeklyDay[]>([]);

  // Settings state
  const [goals, setGoals] = useState<NutritionGoals | null>(null);
  const [goalCalories, setGoalCalories] = useState("2000");
  const [goalProtein, setGoalProtein] = useState("150");
  const [goalCarbs, setGoalCarbs] = useState("250");
  const [goalFat, setGoalFat] = useState("65");
  const [goalWater, setGoalWater] = useState("2500");
  const [consentEnabled, setConsentEnabled] = useState(false);
  const [savingGoals, setSavingGoals] = useState(false);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchEntries = useCallback(async () => {
    if (!tenantId) return;

    try {
      const today = todayISODate();
      const { data, error } = await supabase
        .from("nutrition_log")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("user_id", user?.id as string)
        .gte("logged_at", `${today}T00:00:00`)
        .lte("logged_at", `${today}T23:59:59`)
        .order("logged_at", { ascending: false });

      if (error) {
        console.error("Failed to fetch nutrition entries:", error.message);
        return;
      }

      setEntries((data as unknown as FoodLogEntry[]) ?? []);
    } catch (err) {
      console.error("Fetch nutrition entries error:", err);
    }
  }, [tenantId, user?.id]);

  const fetchWeeklySummary = useCallback(async () => {
    if (!tenantId) return;

    try {
      const weekDates = getWeekDates();
      const startDate = weekDates[0];
      const endDate = weekDates[6];

      const { data, error } = await supabase
        .from("nutrition_log")
        .select("logged_at, calories")
        .eq("tenant_id", tenantId as string)
        .eq("user_id", user?.id as string)
        .gte("logged_at", `${startDate}T00:00:00`)
        .lte("logged_at", `${endDate}T23:59:59`);

      if (error) {
        console.error("Failed to fetch weekly summary:", error.message);
        return;
      }

      const rows = (data ?? []) as unknown as { logged_at: string; calories: number | null }[];

      const dailyTotals: Record<string, number> = {};
      for (const row of rows) {
        const date = row.logged_at.slice(0, 10);
        dailyTotals[date] = (dailyTotals[date] ?? 0) + (row.calories ?? 0);
      }

      const weekly: WeeklyDay[] = weekDates.map((date, i) => ({
        label: DAY_NAMES[new Date(date).getDay()] ?? "",
        calories: dailyTotals[date] ?? 0,
      }));

      setWeeklySummary(weekly);
    } catch (err) {
      console.error("Fetch weekly summary error:", err);
    }
  }, [tenantId, user?.id]);

  const fetchGoals = useCallback(async () => {
    if (!tenantId) return;

    try {
      const { data, error } = await supabase
        .from("nutrition_goals")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("user_id", user?.id as string)
        .single();

      if (error && error.code !== "PGRST116") {
        console.error("Failed to fetch nutrition goals:", error.message);
        return;
      }

      if (data) {
        const g = data as unknown as NutritionGoals;
        setGoals(g);
        setGoalCalories(String(g.daily_calories));
        setGoalProtein(String(g.protein_g));
        setGoalCarbs(String(g.carbs_g));
        setGoalFat(String(g.fat_g));
        setGoalWater(String(g.water_ml));
      }
    } catch (err) {
      console.error("Fetch nutrition goals error:", err);
    }
  }, [tenantId, user?.id]);

  const fetchConsent = useCallback(async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from("consent_records")
        .select("*")
        .eq("user_id", user.id as string)
        .eq("consent_type", "nutrition_data")
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        console.error("Failed to fetch consent:", error.message);
        return;
      }

      setConsentEnabled(!!data);
    } catch (err) {
      console.error("Fetch consent error:", err);
    }
  }, [user?.id]);

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchEntries(), fetchWeeklySummary(), fetchGoals(), fetchConsent()]);
  }, [fetchEntries, fetchWeeklySummary, fetchGoals, fetchConsent]);

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    void fetchAll().finally(() => {
      setLoading(false);
      setRefreshing(false);
    });
  }, [tenantId, fetchAll]);

  const onRefresh = () => {
    setRefreshing(true);
    void fetchAll().finally(() => setRefreshing(false));
  };

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const todaySummary: DailyNutritionSummary = {
    calories: entries.reduce((s, e) => s + (e.calories ?? 0), 0),
    protein_g: entries.reduce((s, e) => s + (e.protein_g ?? 0), 0),
    carbs_g: entries.reduce((s, e) => s + (e.carbs_g ?? 0), 0),
    fat_g: entries.reduce((s, e) => s + (e.fat_g ?? 0), 0),
    water_ml: entries
      .filter((e) => e.meal_type === "drink")
      .reduce((s, e) => s + (e.calories ?? 0), 0), // water entries store ml in calories field
  };

  const maxWeeklyCalories = Math.max(
    ...weeklySummary.map((d) => d.calories),
    goals?.daily_calories ?? 2000,
    1,
  );

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleAddWater = async (ml: number) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL");

      const response = await fetch(`${supabaseUrl}/functions/v1/nutrition-log`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          description: `Water ${ml}ml`,
          meal_type: "drink",
          source: "text",
          calories: ml, // Water entries store ml in the calories field
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to log water: HTTP ${response.status}`);
      }

      void fetchEntries();
    } catch (err) {
      Alert.alert("Error", "Failed to log water intake.");
    }
  };

  const saveGoals = async () => {
    if (!tenantId) return;
    setSavingGoals(true);

    try {
      const payload = {
        tenant_id: tenantId as string,
        user_id: user?.id as string,
        daily_calories: parseInt(goalCalories, 10) || 2000,
        protein_g: parseInt(goalProtein, 10) || 150,
        carbs_g: parseInt(goalCarbs, 10) || 250,
        fat_g: parseInt(goalFat, 10) || 65,
        water_ml: parseInt(goalWater, 10) || 2500,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("nutrition_goals")
        .upsert(payload, { onConflict: "tenant_id,user_id" });

      if (error) {
        Alert.alert("Error", "Failed to save goals: " + error.message);
        return;
      }

      setGoals({
        daily_calories: payload.daily_calories,
        protein_g: payload.protein_g,
        carbs_g: payload.carbs_g,
        fat_g: payload.fat_g,
        water_ml: payload.water_ml,
      });

      Alert.alert("Saved", "Nutrition goals updated.");
    } catch (err) {
      Alert.alert("Error", "Failed to save goals.");
    } finally {
      setSavingGoals(false);
    }
  };

  const toggleConsent = async (value: boolean) => {
    if (!user?.id) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL");

      const response = await fetch(`${supabaseUrl}/functions/v1/gdpr-consent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          consent_type: "nutrition_data",
          granted: value,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update consent: HTTP ${response.status}`);
      }

      setConsentEnabled(value);
    } catch (err) {
      Alert.alert("Error", "Failed to update consent preference.");
    }
  };

  const deleteEntry = async (entryId: string) => {
    Alert.alert("Delete Entry", "Are you sure you want to delete this entry?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase
            .from("nutrition_log")
            .delete()
            .eq("id", entryId);

          if (error) {
            Alert.alert("Error", "Failed to delete entry.");
            return;
          }

          setEntries((prev) => prev.filter((e) => e.id !== entryId));
        },
      },
    ]);
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderLogEntry = ({ item }: { item: FoodLogEntry }) => {
    const time = new Date(item.logged_at).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <View style={styles.entryCard}>
        <View style={styles.entryIconBox}>
          <Ionicons
            name={MEAL_ICONS[item.meal_type] ?? "restaurant-outline"}
            size={20}
            color="#D4A843"
          />
        </View>
        <View style={styles.entryInfo}>
          <Text style={styles.entryDescription} numberOfLines={2}>
            {item.description}
          </Text>
          <View style={styles.entryMeta}>
            <Text style={styles.entryMealType}>
              {MEAL_LABELS[item.meal_type] ?? item.meal_type}
            </Text>
            <Text style={styles.entryTime}>{time}</Text>
          </View>
          {(item.calories != null || item.protein_g != null) && (
            <View style={styles.entryMacros}>
              {item.calories != null && (
                <Text style={styles.entryMacroText}>{item.calories} kcal</Text>
              )}
              {item.protein_g != null && (
                <Text style={styles.entryMacroText}>P:{item.protein_g}g</Text>
              )}
              {item.carbs_g != null && (
                <Text style={styles.entryMacroText}>C:{item.carbs_g}g</Text>
              )}
              {item.fat_g != null && (
                <Text style={styles.entryMacroText}>F:{item.fat_g}g</Text>
              )}
            </View>
          )}
        </View>
        <TouchableOpacity
          onPress={() => deleteEntry(item.id)}
          style={styles.deleteBtn}
        >
          <Ionicons name="trash-outline" size={18} color="#ef4444" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderWeeklyChart = () => {
    if (weeklySummary.length === 0) return null;

    const goalLine = goals?.daily_calories ?? 2000;

    return (
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>This Week</Text>
        <View style={styles.chartContainer}>
          {weeklySummary.map((day, i) => {
            const barHeight =
              maxWeeklyCalories > 0
                ? Math.max((day.calories / maxWeeklyCalories) * 120, 2)
                : 2;
            const isToday = i === new Date().getDay();

            return (
              <View key={day.label} style={styles.chartBarCol}>
                <Text style={styles.chartBarValue}>
                  {day.calories > 0 ? day.calories : ""}
                </Text>
                <View
                  style={[
                    styles.chartBar,
                    { height: barHeight },
                    isToday && styles.chartBarToday,
                  ]}
                />
                <Text
                  style={[styles.chartBarLabel, isToday && styles.chartBarLabelToday]}
                >
                  {day.label}
                </Text>
              </View>
            );
          })}
        </View>
        {/* Goal line indicator */}
        <View style={styles.chartGoalRow}>
          <View style={styles.chartGoalLine} />
          <Text style={styles.chartGoalText}>Goal: {goalLine} kcal</Text>
        </View>
      </View>
    );
  };

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#D4A843" />
        <Text style={styles.loadingText}>Loading nutrition data...</Text>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Segmented control */}
      <View style={styles.segmentedControl}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.segmentTab,
              activeTab === tab.key && styles.segmentTabActive,
            ]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text
              style={[
                styles.segmentTabText,
                activeTab === tab.key && styles.segmentTabTextActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ------------------------------------------------------------------- */}
      {/* Log Tab                                                              */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "log" && (
        <>
          <FlatList
            data={entries}
            keyExtractor={(item) => item.id}
            renderItem={renderLogEntry}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#D4A843"
              />
            }
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <View style={styles.logHeader}>
                <Text style={styles.logDateText}>
                  Today &middot; {entries.length} entries &middot;{" "}
                  {todaySummary.calories} kcal
                </Text>
              </View>
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="restaurant-outline" size={48} color="#94a3b8" />
                <Text style={styles.emptyText}>No food logged today</Text>
                <Text style={styles.emptySubtext}>
                  Tap the + button to add your first entry
                </Text>
              </View>
            }
          />

          {/* FAB */}
          <TouchableOpacity
            style={styles.fab}
            onPress={() => setModalVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={28} color="#ffffff" />
          </TouchableOpacity>

          <FoodEntryModal
            visible={modalVisible}
            onClose={() => setModalVisible(false)}
            onEntryAdded={() => {
              void fetchEntries();
              void fetchWeeklySummary();
            }}
          />
        </>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Summary Tab                                                          */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "summary" && (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#D4A843"
            />
          }
          contentContainerStyle={styles.summaryContent}
        >
          <Text style={styles.sectionTitle}>Today's Progress</Text>
          <NutritionProgressBars summary={todaySummary} goals={goals} />

          {renderWeeklyChart()}

          <Text style={styles.sectionTitle}>Water Intake</Text>
          <WaterTracker
            currentMl={todaySummary.water_ml}
            goalMl={goals?.water_ml ?? 2500}
            onAddWater={handleAddWater}
          />

          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Settings Tab                                                         */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "settings" && (
        <ScrollView contentContainerStyle={styles.settingsContent}>
          <Text style={styles.sectionTitle}>Daily Goals</Text>

          <View style={styles.settingsCard}>
            <View style={styles.goalRow}>
              <Text style={styles.goalLabel}>Calories (kcal)</Text>
              <TextInput
                style={styles.goalInput}
                keyboardType="numeric"
                value={goalCalories}
                onChangeText={setGoalCalories}
                placeholder="2000"
                placeholderTextColor="#94a3b8"
              />
            </View>
            <View style={styles.goalRow}>
              <Text style={styles.goalLabel}>Protein (g)</Text>
              <TextInput
                style={styles.goalInput}
                keyboardType="numeric"
                value={goalProtein}
                onChangeText={setGoalProtein}
                placeholder="150"
                placeholderTextColor="#94a3b8"
              />
            </View>
            <View style={styles.goalRow}>
              <Text style={styles.goalLabel}>Carbs (g)</Text>
              <TextInput
                style={styles.goalInput}
                keyboardType="numeric"
                value={goalCarbs}
                onChangeText={setGoalCarbs}
                placeholder="250"
                placeholderTextColor="#94a3b8"
              />
            </View>
            <View style={styles.goalRow}>
              <Text style={styles.goalLabel}>Fat (g)</Text>
              <TextInput
                style={styles.goalInput}
                keyboardType="numeric"
                value={goalFat}
                onChangeText={setGoalFat}
                placeholder="65"
                placeholderTextColor="#94a3b8"
              />
            </View>
            <View style={styles.goalRow}>
              <Text style={styles.goalLabel}>Water (ml)</Text>
              <TextInput
                style={styles.goalInput}
                keyboardType="numeric"
                value={goalWater}
                onChangeText={setGoalWater}
                placeholder="2500"
                placeholderTextColor="#94a3b8"
              />
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, savingGoals && { opacity: 0.5 }]}
              onPress={saveGoals}
              disabled={savingGoals}
            >
              {savingGoals ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.saveBtnText}>Save Goals</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionTitle}>Privacy</Text>

          <View style={styles.settingsCard}>
            <View style={styles.consentRow}>
              <View style={styles.consentInfo}>
                <Text style={styles.consentLabel}>Nutrition Data Processing</Text>
                <Text style={styles.consentDescription}>
                  Allow CleverHub to process your nutrition data for
                  personalized recommendations and health insights.
                </Text>
              </View>
              <Switch
                value={consentEnabled}
                onValueChange={toggleConsent}
                trackColor={{ false: "#e2e8f0", true: "#D4A843" }}
                thumbColor={consentEnabled ? "#ffffff" : "#f4f3f4"}
              />
            </View>
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
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
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FDF6E3",
  },
  loadingText: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 12,
  },

  // Segmented control
  segmentedControl: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  segmentTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  segmentTabActive: {
    backgroundColor: "#D4A843",
  },
  segmentTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  segmentTabTextActive: {
    color: "#ffffff",
  },

  // Log tab
  listContent: {
    paddingBottom: 80,
  },
  logHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  logDateText: {
    fontSize: 13,
    color: "#64748b",
    fontWeight: "500",
  },
  entryCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#ffffff",
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
  },
  entryIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#FFF8E1",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  entryInfo: {
    flex: 1,
  },
  entryDescription: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  entryMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  entryMealType: {
    fontSize: 12,
    color: "#D4A843",
    fontWeight: "600",
  },
  entryTime: {
    fontSize: 12,
    color: "#94a3b8",
  },
  entryMacros: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
    flexWrap: "wrap",
  },
  entryMacroText: {
    fontSize: 11,
    color: "#64748b",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  deleteBtn: {
    padding: 6,
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
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },

  // Empty state
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 64,
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
  },

  // Summary tab
  summaryContent: {
    paddingBottom: 32,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1a1a1a",
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
  },

  // Weekly chart
  chartCard: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 12,
  },
  chartContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    height: 150,
    paddingBottom: 20,
  },
  chartBarCol: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  chartBarValue: {
    fontSize: 9,
    color: "#94a3b8",
    marginBottom: 2,
  },
  chartBar: {
    width: 20,
    backgroundColor: "#FFF8E1",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#D4A843",
    minHeight: 2,
  },
  chartBarToday: {
    backgroundColor: "#D4A843",
  },
  chartBarLabel: {
    fontSize: 11,
    color: "#64748b",
    marginTop: 4,
  },
  chartBarLabelToday: {
    fontWeight: "700",
    color: "#D4A843",
  },
  chartGoalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  chartGoalLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#D4A843",
    borderStyle: "dashed",
  },
  chartGoalText: {
    fontSize: 11,
    color: "#D4A843",
    fontWeight: "600",
  },

  // Settings tab
  settingsContent: {
    paddingBottom: 32,
  },
  settingsCard: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginHorizontal: 16,
    marginTop: 8,
    padding: 14,
  },
  goalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  goalLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#1a1a1a",
  },
  goalInput: {
    width: 80,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    color: "#1a1a1a",
    backgroundColor: "#FDF6E3",
    textAlign: "right",
  },
  saveBtn: {
    backgroundColor: "#D4A843",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 12,
  },
  saveBtnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  consentInfo: {
    flex: 1,
    marginRight: 12,
  },
  consentLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  consentDescription: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 4,
    lineHeight: 18,
  },
});
