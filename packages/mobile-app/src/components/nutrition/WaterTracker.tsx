import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  currentMl: number;
  goalMl: number;
  onAddWater: (ml: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const PRESETS: { label: string; ml: number; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: "Glass", ml: 250, icon: "water-outline" },
  { label: "Bottle", ml: 500, icon: "water" },
  { label: "Large", ml: 750, icon: "beaker-outline" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WaterTracker({ currentMl, goalMl, onAddWater }: Props) {
  const [customAmount, setCustomAmount] = useState("");
  const [adding, setAdding] = useState(false);

  const pct = goalMl > 0 ? Math.min((currentMl / goalMl) * 100, 100) : 0;

  const handleAdd = async (ml: number) => {
    if (ml <= 0) return;
    setAdding(true);
    try {
      await onAddWater(ml);
    } catch (err) {
      Alert.alert("Error", "Failed to log water intake.");
    } finally {
      setAdding(false);
    }
  };

  const handleCustomAdd = () => {
    const ml = parseInt(customAmount, 10);
    if (isNaN(ml) || ml <= 0) {
      Alert.alert("Invalid Amount", "Please enter a valid amount in ml.");
      return;
    }
    setCustomAmount("");
    void handleAdd(ml);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="water" size={20} color="#3B82F6" />
        <Text style={styles.title}>Water Intake</Text>
      </View>

      {/* Progress */}
      <View style={styles.progressRow}>
        <Text style={styles.progressText}>
          {currentMl} / {goalMl} ml
        </Text>
        <Text style={styles.progressPct}>{Math.round(pct)}%</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>

      {/* Preset buttons */}
      <View style={styles.presetsRow}>
        {PRESETS.map((preset) => (
          <TouchableOpacity
            key={preset.label}
            style={styles.presetBtn}
            onPress={() => handleAdd(preset.ml)}
            disabled={adding}
          >
            <Ionicons name={preset.icon} size={18} color="#D4A843" />
            <Text style={styles.presetLabel}>{preset.label}</Text>
            <Text style={styles.presetMl}>{preset.ml}ml</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Custom input */}
      <View style={styles.customRow}>
        <TextInput
          style={styles.customInput}
          placeholder="Custom ml"
          placeholderTextColor="#94a3b8"
          keyboardType="numeric"
          value={customAmount}
          onChangeText={setCustomAmount}
        />
        <TouchableOpacity
          style={[styles.customBtn, !customAmount.trim() && { opacity: 0.5 }]}
          onPress={handleCustomAdd}
          disabled={!customAmount.trim() || adding}
        >
          <Ionicons name="add" size={18} color="#ffffff" />
          <Text style={styles.customBtnText}>Add</Text>
        </TouchableOpacity>
      </View>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  progressRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  progressText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  progressPct: {
    fontSize: 12,
    color: "#64748b",
  },
  barTrack: {
    height: 10,
    backgroundColor: "#DBEAFE",
    borderRadius: 5,
    overflow: "hidden",
    marginBottom: 12,
  },
  barFill: {
    height: "100%",
    backgroundColor: "#3B82F6",
    borderRadius: 5,
  },
  presetsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  presetBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#FFF8E1",
    borderWidth: 1,
    borderColor: "#D4A843",
  },
  presetLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1a1a1a",
    marginTop: 2,
  },
  presetMl: {
    fontSize: 11,
    color: "#64748b",
  },
  customRow: {
    flexDirection: "row",
    gap: 8,
  },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: "#1a1a1a",
    backgroundColor: "#FDF6E3",
  },
  customBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#D4A843",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  customBtnText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 13,
  },
});
