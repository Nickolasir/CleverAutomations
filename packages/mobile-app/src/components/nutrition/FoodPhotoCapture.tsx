import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../../lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  onClose: () => void;
  onLogItems: (items: IdentifiedFoodItem[]) => void;
}

export interface IdentifiedFoodItem {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FoodPhotoCapture({ onClose, onLogItems }: Props) {
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<"capture" | "review">("capture");
  const [identifiedItems, setIdentifiedItems] = useState<IdentifiedFoodItem[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Denied", "Camera access is required to take food photos.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: true,
      aspect: [4, 3],
    });

    if (result.canceled || !result.assets?.[0]) return;

    await processPhoto(result.assets[0].uri);
  };

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Denied", "Gallery access is required to select food photos.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: true,
      aspect: [4, 3],
    });

    if (result.canceled || !result.assets?.[0]) return;

    await processPhoto(result.assets[0].uri);
  };

  const processPhoto = async (uri: string) => {
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL");

      // Upload image to Supabase Storage
      const fileName = `food_${Date.now()}.jpg`;
      const formData = new FormData();
      formData.append("file", {
        uri,
        name: fileName,
        type: "image/jpeg",
      } as unknown as Blob);

      const uploadResponse = await fetch(
        `${supabaseUrl}/functions/v1/image-upload`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          body: formData,
        },
      );

      if (!uploadResponse.ok) {
        throw new Error(`Image upload failed: HTTP ${uploadResponse.status}`);
      }

      const uploadResult = await uploadResponse.json() as { data: { url: string } };
      const imageUrl = uploadResult.data.url;

      // Analyze the food photo
      const analyzeResponse = await fetch(
        `${supabaseUrl}/functions/v1/food-photo-analyze`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ image_url: imageUrl }),
        },
      );

      if (!analyzeResponse.ok) {
        throw new Error(`Photo analysis failed: HTTP ${analyzeResponse.status}`);
      }

      const analyzeResult = await analyzeResponse.json() as {
        data: { items: IdentifiedFoodItem[] };
      };

      const items = analyzeResult.data.items;
      setIdentifiedItems(items);
      // Select all items by default
      setSelectedIndices(new Set(items.map((_, i) => i)));
      setPhase("review");
    } catch (err) {
      Alert.alert("Error", "Failed to analyze food photo. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const toggleItem = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const selected = identifiedItems.filter((_, i) => selectedIndices.has(i));
    if (selected.length === 0) {
      Alert.alert("No Items Selected", "Please select at least one item to log.");
      return;
    }
    onLogItems(selected);
    onClose();
  };

  // -------------------------------------------------------------------------
  // Capture phase
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#D4A843" />
        <Text style={styles.loadingText}>Analyzing food photo...</Text>
        <Text style={styles.loadingSubtext}>
          Identifying items and estimating nutrition
        </Text>
      </View>
    );
  }

  if (phase === "capture") {
    return (
      <View style={styles.container}>
        <Ionicons name="camera-outline" size={56} color="#D4A843" />
        <Text style={styles.title}>Food Photo</Text>
        <Text style={styles.subtitle}>
          Take a photo of your food to automatically identify and log items
        </Text>

        <View style={styles.captureActions}>
          <TouchableOpacity style={styles.captureBtn} onPress={takePhoto}>
            <Ionicons name="camera" size={24} color="#ffffff" />
            <Text style={styles.captureBtnText}>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.galleryBtn} onPress={pickFromGallery}>
            <Ionicons name="images-outline" size={24} color="#D4A843" />
            <Text style={styles.galleryBtnText}>From Gallery</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Review phase
  // -------------------------------------------------------------------------

  return (
    <View style={styles.reviewContainer}>
      <View style={styles.reviewHeader}>
        <Text style={styles.reviewTitle}>Identified Items</Text>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={24} color="#64748b" />
        </TouchableOpacity>
      </View>
      <Text style={styles.reviewSubtitle}>
        Select items to log ({selectedIndices.size} of {identifiedItems.length})
      </Text>

      <FlatList
        data={identifiedItems}
        keyExtractor={(_, index) => String(index)}
        renderItem={({ item, index }) => {
          const selected = selectedIndices.has(index);
          return (
            <TouchableOpacity
              style={[styles.itemCard, selected && styles.itemCardSelected]}
              onPress={() => toggleItem(index)}
            >
              <Ionicons
                name={selected ? "checkbox" : "square-outline"}
                size={22}
                color={selected ? "#D4A843" : "#94a3b8"}
              />
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemMacros}>
                  {item.calories} kcal &middot; P:{item.protein_g}g C:{item.carbs_g}g F:
                  {item.fat_g}g
                </Text>
              </View>
              <Text style={styles.itemConfidence}>
                {Math.round(item.confidence * 100)}%
              </Text>
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={styles.reviewList}
      />

      <View style={styles.reviewActions}>
        <TouchableOpacity style={styles.retakeBtn} onPress={() => setPhase("capture")}>
          <Ionicons name="camera-outline" size={18} color="#D4A843" />
          <Text style={styles.retakeBtnText}>Retake</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.logBtn,
            selectedIndices.size === 0 && { opacity: 0.5 },
          ]}
          onPress={handleConfirm}
          disabled={selectedIndices.size === 0}
        >
          <Ionicons name="checkmark" size={18} color="#ffffff" />
          <Text style={styles.logBtnText}>
            Log {selectedIndices.size} Item{selectedIndices.size !== 1 ? "s" : ""}
          </Text>
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
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FDF6E3",
    padding: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a1a1a",
    marginTop: 16,
  },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 32,
    lineHeight: 20,
  },
  captureActions: {
    gap: 12,
    width: "100%",
  },
  captureBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#D4A843",
    paddingVertical: 14,
    borderRadius: 10,
  },
  captureBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  galleryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D4A843",
  },
  galleryBtnText: {
    color: "#D4A843",
    fontSize: 16,
    fontWeight: "700",
  },
  cancelBtn: {
    marginTop: 20,
  },
  cancelText: {
    fontSize: 14,
    color: "#64748b",
    fontWeight: "600",
  },
  loadingText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
    marginTop: 16,
  },
  loadingSubtext: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 4,
  },

  // Review phase
  reviewContainer: {
    flex: 1,
    backgroundColor: "#FDF6E3",
  },
  reviewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    paddingTop: 8,
  },
  reviewTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  reviewSubtitle: {
    fontSize: 13,
    color: "#64748b",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  reviewList: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  itemCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
    marginTop: 8,
    gap: 10,
  },
  itemCardSelected: {
    borderColor: "#D4A843",
    backgroundColor: "#FFFDF7",
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  itemMacros: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
  },
  itemConfidence: {
    fontSize: 12,
    fontWeight: "600",
    color: "#94a3b8",
  },
  reviewActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  retakeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D4A843",
  },
  retakeBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#D4A843",
  },
  logBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#D4A843",
  },
  logBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },
});
