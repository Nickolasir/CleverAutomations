import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Camera, CameraView } from "expo-camera";
import { supabase } from "../../lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  visible: boolean;
  onClose: () => void;
  onLogItem: (item: ScannedProduct) => void;
}

export interface ScannedProduct {
  barcode: string;
  name: string;
  brand: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  serving_size: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BarcodeScannerView({ visible, onClose, onLogItem }: Props) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<ScannedProduct | null>(null);

  useEffect(() => {
    if (visible) {
      void (async () => {
        const { status } = await Camera.requestCameraPermissionsAsync();
        setHasPermission(status === "granted");
      })();
      // Reset state when opening
      setScanned(false);
      setProduct(null);
    }
  }, [visible]);

  const handleBarCodeScanned = async ({ data }: { type: string; data: string }) => {
    if (scanned || loading) return;
    setScanned(true);
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL");

      const response = await fetch(`${supabaseUrl}/functions/v1/nutrition-barcode`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ barcode: data }),
      });

      if (!response.ok) {
        throw new Error(`Barcode lookup failed: HTTP ${response.status}`);
      }

      const result = await response.json() as { data: ScannedProduct };
      setProduct(result.data);
    } catch (err) {
      Alert.alert("Lookup Failed", "Could not find product for this barcode. Try again.");
      setScanned(false);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (product) {
      onLogItem(product);
      onClose();
    }
  };

  const handleScanAgain = () => {
    setScanned(false);
    setProduct(null);
  };

  if (!visible) return null;

  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#D4A843" />
        <Text style={styles.statusText}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <Ionicons name="camera-outline" size={48} color="#94a3b8" />
        <Text style={styles.statusText}>Camera permission denied</Text>
        <Text style={styles.statusSubtext}>
          Enable camera access in your device settings to scan barcodes.
        </Text>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera view */}
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{
          barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39"],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* Close button */}
      <TouchableOpacity style={styles.closeOverlay} onPress={onClose}>
        <Ionicons name="close-circle" size={36} color="#ffffff" />
      </TouchableOpacity>

      {/* Scanning indicator */}
      {!scanned && !loading && (
        <View style={styles.scanOverlay}>
          <View style={styles.scanFrame} />
          <Text style={styles.scanHint}>Point at a barcode</Text>
        </View>
      )}

      {/* Loading overlay */}
      {loading && (
        <View style={styles.resultOverlay}>
          <ActivityIndicator size="large" color="#D4A843" />
          <Text style={styles.loadingText}>Looking up product...</Text>
        </View>
      )}

      {/* Product result overlay */}
      {product && !loading && (
        <View style={styles.resultOverlay}>
          <View style={styles.productCard}>
            <Text style={styles.productName}>{product.name}</Text>
            {product.brand && (
              <Text style={styles.productBrand}>{product.brand}</Text>
            )}
            {product.serving_size && (
              <Text style={styles.productServing}>
                Serving: {product.serving_size}
              </Text>
            )}
            <View style={styles.macrosRow}>
              <View style={styles.macroItem}>
                <Text style={styles.macroValue}>{product.calories}</Text>
                <Text style={styles.macroLabel}>kcal</Text>
              </View>
              <View style={styles.macroItem}>
                <Text style={styles.macroValue}>{product.protein_g}g</Text>
                <Text style={styles.macroLabel}>Protein</Text>
              </View>
              <View style={styles.macroItem}>
                <Text style={styles.macroValue}>{product.carbs_g}g</Text>
                <Text style={styles.macroLabel}>Carbs</Text>
              </View>
              <View style={styles.macroItem}>
                <Text style={styles.macroValue}>{product.fat_g}g</Text>
                <Text style={styles.macroLabel}>Fat</Text>
              </View>
            </View>

            <View style={styles.productActions}>
              <TouchableOpacity style={styles.scanAgainBtn} onPress={handleScanAgain}>
                <Ionicons name="scan-outline" size={18} color="#D4A843" />
                <Text style={styles.scanAgainText}>Scan Again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
                <Ionicons name="checkmark" size={18} color="#ffffff" />
                <Text style={styles.confirmBtnText}>Confirm & Log</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
    justifyContent: "center",
    alignItems: "center",
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  closeOverlay: {
    position: "absolute",
    top: 56,
    right: 20,
    zIndex: 10,
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  scanFrame: {
    width: 260,
    height: 160,
    borderWidth: 2,
    borderColor: "#D4A843",
    borderRadius: 12,
    backgroundColor: "transparent",
  },
  scanHint: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 16,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  resultOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingBottom: 40,
  },
  loadingText: {
    color: "#ffffff",
    fontSize: 14,
    marginTop: 12,
  },
  productCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 20,
    width: "90%",
  },
  productName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  productBrand: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 2,
  },
  productServing: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 4,
  },
  macrosRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 16,
    marginBottom: 16,
    paddingVertical: 12,
    backgroundColor: "#FDF6E3",
    borderRadius: 10,
  },
  macroItem: {
    alignItems: "center",
  },
  macroValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#D4A843",
  },
  macroLabel: {
    fontSize: 11,
    color: "#64748b",
    marginTop: 2,
  },
  productActions: {
    flexDirection: "row",
    gap: 10,
  },
  scanAgainBtn: {
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
  scanAgainText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#D4A843",
  },
  confirmBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#D4A843",
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },
  statusText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
    marginTop: 16,
  },
  statusSubtext: {
    fontSize: 13,
    color: "#94a3b8",
    marginTop: 8,
    textAlign: "center",
    paddingHorizontal: 32,
  },
  closeBtn: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: "#D4A843",
    borderRadius: 8,
  },
  closeBtnText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
  },
});
