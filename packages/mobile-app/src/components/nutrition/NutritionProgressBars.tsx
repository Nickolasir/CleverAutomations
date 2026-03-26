import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyNutritionSummary {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  water_ml: number;
}

export interface NutritionGoals {
  daily_calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  water_ml: number;
}

interface Props {
  summary: DailyNutritionSummary;
  goals: NutritionGoals | null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_GOALS: NutritionGoals = {
  daily_calories: 2000,
  protein_g: 150,
  carbs_g: 250,
  fat_g: 65,
  water_ml: 2500,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NutritionProgressBars({ summary, goals }: Props) {
  const g = goals ?? DEFAULT_GOALS;

  const bars: {
    label: string;
    current: number;
    goal: number;
    unit: string;
    icon: keyof typeof Ionicons.glyphMap;
  }[] = [
    {
      label: "Calories",
      current: summary.calories,
      goal: g.daily_calories,
      unit: "kcal",
      icon: "flame-outline",
    },
    {
      label: "Protein",
      current: summary.protein_g,
      goal: g.protein_g,
      unit: "g",
      icon: "fish-outline",
    },
    {
      label: "Carbs",
      current: summary.carbs_g,
      goal: g.carbs_g,
      unit: "g",
      icon: "nutrition-outline",
    },
    {
      label: "Fat",
      current: summary.fat_g,
      goal: g.fat_g,
      unit: "g",
      icon: "water-outline",
    },
    {
      label: "Water",
      current: summary.water_ml,
      goal: g.water_ml,
      unit: "ml",
      icon: "water",
    },
  ];

  return (
    <View style={styles.container}>
      {bars.map((bar) => {
        const pct = bar.goal > 0 ? Math.min((bar.current / bar.goal) * 100, 100) : 0;
        const overGoal = bar.goal > 0 && bar.current > bar.goal;

        return (
          <View key={bar.label} style={styles.barRow}>
            <View style={styles.barHeader}>
              <View style={styles.barLabelRow}>
                <Ionicons name={bar.icon} size={16} color="#D4A843" />
                <Text style={styles.barLabel}>{bar.label}</Text>
              </View>
              <Text style={[styles.barValues, overGoal && styles.barValuesOver]}>
                {Math.round(bar.current)} / {bar.goal} {bar.unit}
              </Text>
            </View>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  { width: `${pct}%` },
                  overGoal && styles.barFillOver,
                ]}
              />
            </View>
            <Text style={styles.barPct}>{Math.round(pct)}%</Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
  },
  barRow: {
    marginBottom: 12,
  },
  barHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  barLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  barLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  barValues: {
    fontSize: 12,
    color: "#64748b",
  },
  barValuesOver: {
    color: "#ef4444",
    fontWeight: "600",
  },
  barTrack: {
    height: 8,
    backgroundColor: "#f1f5f9",
    borderRadius: 4,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    backgroundColor: "#D4A843",
    borderRadius: 4,
  },
  barFillOver: {
    backgroundColor: "#ef4444",
  },
  barPct: {
    fontSize: 11,
    color: "#94a3b8",
    textAlign: "right",
    marginTop: 2,
  },
});
