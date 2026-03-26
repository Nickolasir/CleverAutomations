import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import BarcodeScannerView, { type ScannedProduct } from "./BarcodeScannerView";
import FoodPhotoCapture, { type IdentifiedFoodItem } from "./FoodPhotoCapture";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "drink";

interface Props {
  visible: boolean;
  onClose: () => void;
  onEntryAdded: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEAL_TYPES: { key: MealType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "breakfast", label: "Breakfast", icon: "sunny-outline" },
  { key: "lunch", label: "Lunch", icon: "restaurant-outline" },
  { key: "dinner", label: "Dinner", icon: "moon-outline" },
  { key: "snack", label: "Snack", icon: "cafe-outline" },
  { key: "drink", label: "Drink", icon: "beer-outline" },
];

type InputMode = "text" | "camera" | "barcode";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FoodEntryModal({ visible, onClose, onEntryAdded }: Props) {
  const [description, setDescription] = useState("");
  const [mealType, setMealType] = useState<MealType>("lunch");
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [submitting, setSubmitting] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);

  const resetForm = () => {
    setDescription("");
    setMealType("lunch");
    setInputMode("text");
    setSubmitting(false);
    setShowScanner(false);
    setShowPhotoCapture(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // -------------------------------------------------------------------------
  // Submit text entry
  // -------------------------------------------------------------------------

  const handleSubmit = async () => {
    if (!description.trim()) return;

    setSubmitting(true);
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
          description: description.trim(),
          meal_type: mealType,
          source: "text",
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to log entry: HTTP ${response.status}`);
      }

      handleClose();
      onEntryAdded();
    } catch (err) {
      Alert.alert("Error", "Failed to log food entry. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Barcode scanned item
  // -------------------------------------------------------------------------

  const handleBarcodeItem = async (product: ScannedProduct) => {
    setShowScanner(false);
    setSubmitting(true);

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
          description: product.name,
          meal_type: mealType,
          source: "barcode",
          barcode: product.barcode,
          calories: product.calories,
          protein_g: product.protein_g,
          carbs_g: product.carbs_g,
          fat_g: product.fat_g,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to log entry: HTTP ${response.status}`);
      }

      handleClose();
      onEntryAdded();
    } catch (err) {
      Alert.alert("Error", "Failed to log scanned item.");
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Photo-identified items
  // -------------------------------------------------------------------------

  const handlePhotoItems = async (items: IdentifiedFoodItem[]) => {
    setShowPhotoCapture(false);
    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL");

      for (const item of items) {
        const response = await fetch(`${supabaseUrl}/functions/v1/nutrition-log`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            description: item.name,
            meal_type: mealType,
            source: "photo",
            calories: item.calories,
            protein_g: item.protein_g,
            carbs_g: item.carbs_g,
            fat_g: item.fat_g,
          }),
        });

        if (!response.ok) {
          console.error(`Failed to log photo item: ${item.name}`);
        }
      }

      handleClose();
      onEntryAdded();
    } catch (err) {
      Alert.alert("Error", "Failed to log some photo-identified items.");
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (showScanner) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
        <BarcodeScannerView
          visible
          onClose={() => setShowScanner(false)}
          onLogItem={handleBarcodeItem}
        />
      </Modal>
    );
  }

  if (showPhotoCapture) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
        <FoodPhotoCapture
          onClose={() => setShowPhotoCapture(false)}
          onLogItems={handlePhotoItems}
        />
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Log Food</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={24} color="#64748b" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Description input */}
            <Text style={styles.formLabel}>What did you eat?</Text>
            <TextInput
              style={styles.formInput}
              placeholder="e.g., Grilled chicken with rice"
              placeholderTextColor="#94a3b8"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={2}
            />

            {/* Input mode row */}
            <Text style={styles.formLabel}>Or try</Text>
            <View style={styles.inputModeRow}>
              <TouchableOpacity
                style={[styles.inputModeBtn, inputMode === "text" && styles.inputModeBtnActive]}
                onPress={() => setInputMode("text")}
              >
                <Ionicons
                  name="create-outline"
                  size={20}
                  color={inputMode === "text" ? "#ffffff" : "#D4A843"}
                />
                <Text
                  style={[
                    styles.inputModeText,
                    inputMode === "text" && styles.inputModeTextActive,
                  ]}
                >
                  Type
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.inputModeBtn, inputMode === "camera" && styles.inputModeBtnActive]}
                onPress={() => {
                  setInputMode("camera");
                  setShowPhotoCapture(true);
                }}
              >
                <Ionicons
                  name="camera-outline"
                  size={20}
                  color={inputMode === "camera" ? "#ffffff" : "#D4A843"}
                />
                <Text
                  style={[
                    styles.inputModeText,
                    inputMode === "camera" && styles.inputModeTextActive,
                  ]}
                >
                  Camera
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.inputModeBtn, inputMode === "barcode" && styles.inputModeBtnActive]}
                onPress={() => {
                  setInputMode("barcode");
                  setShowScanner(true);
                }}
              >
                <Ionicons
                  name="barcode-outline"
                  size={20}
                  color={inputMode === "barcode" ? "#ffffff" : "#D4A843"}
                />
                <Text
                  style={[
                    styles.inputModeText,
                    inputMode === "barcode" && styles.inputModeTextActive,
                  ]}
                >
                  Barcode
                </Text>
              </TouchableOpacity>
            </View>

            {/* Meal type selector */}
            <Text style={styles.formLabel}>Meal Type</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pillRow}
            >
              {MEAL_TYPES.map((mt) => {
                const active = mealType === mt.key;
                return (
                  <TouchableOpacity
                    key={mt.key}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => setMealType(mt.key)}
                  >
                    <Ionicons
                      name={mt.icon}
                      size={14}
                      color={active ? "#ffffff" : "#64748b"}
                    />
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>
                      {mt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </ScrollView>

          {/* Submit button */}
          <TouchableOpacity
            style={[
              styles.submitBtn,
              (!description.trim() || submitting) && { opacity: 0.5 },
            ]}
            onPress={handleSubmit}
            disabled={!description.trim() || submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.submitBtnText}>Log Entry</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  formLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginTop: 12,
    marginBottom: 6,
  },
  formInput: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1a1a1a",
    backgroundColor: "#FDF6E3",
    minHeight: 56,
    textAlignVertical: "top",
  },
  inputModeRow: {
    flexDirection: "row",
    gap: 8,
  },
  inputModeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D4A843",
    backgroundColor: "#FFF8E1",
  },
  inputModeBtnActive: {
    backgroundColor: "#D4A843",
    borderColor: "#D4A843",
  },
  inputModeText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#D4A843",
  },
  inputModeTextActive: {
    color: "#ffffff",
  },
  pillRow: {
    gap: 6,
    paddingVertical: 4,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  pillActive: {
    backgroundColor: "#D4A843",
    borderColor: "#D4A843",
  },
  pillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
  },
  pillTextActive: {
    color: "#ffffff",
  },
  submitBtn: {
    backgroundColor: "#D4A843",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  submitBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
});
