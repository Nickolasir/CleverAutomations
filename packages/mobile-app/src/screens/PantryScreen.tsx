import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Modal,
  TextInput,
  ScrollView,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type {
  PantryItem,
  PantryItemId,
  PantryItemCategory,
  PantryLocation,
  PantryItemSource,
} from "@clever/shared";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES: PantryItemCategory[] = [
  "produce",
  "dairy",
  "meat",
  "seafood",
  "frozen",
  "canned",
  "dry_goods",
  "bakery",
  "beverages",
  "snacks",
  "condiments",
  "spices",
  "household",
  "personal_care",
  "other",
];

const CATEGORY_LABELS: Record<PantryItemCategory, string> = {
  produce: "Produce",
  dairy: "Dairy",
  meat: "Meat",
  seafood: "Seafood",
  frozen: "Frozen",
  canned: "Canned",
  dry_goods: "Dry Goods",
  bakery: "Bakery",
  beverages: "Beverages",
  snacks: "Snacks",
  condiments: "Condiments",
  spices: "Spices",
  household: "Household",
  personal_care: "Personal Care",
  other: "Other",
};

const LOCATIONS: PantryLocation[] = ["pantry", "fridge", "freezer", "other"];

const LOCATION_LABELS: Record<PantryLocation, string> = {
  pantry: "Pantry",
  fridge: "Fridge",
  freezer: "Freezer",
  other: "Other",
};

const LOCATION_FILTERS: Array<PantryLocation | "all"> = [
  "all",
  "pantry",
  "fridge",
  "freezer",
  "other",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isExpiringSoon(item: PantryItem): boolean {
  if (!item.expiry_date) return false;
  const now = new Date();
  const expiry = new Date(item.expiry_date);
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 3;
}

function isLowStock(item: PantryItem): boolean {
  if (item.min_stock_threshold == null) return false;
  return item.quantity <= item.min_stock_threshold;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "No expiry";
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PantryScreen() {
  const { user } = useAuthContext();
  const tenantId = user?.tenant_id;

  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [locationFilter, setLocationFilter] = useState<PantryLocation | "all">(
    "all"
  );
  const [modalVisible, setModalVisible] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formQuantity, setFormQuantity] = useState("1");
  const [formUnit, setFormUnit] = useState("pcs");
  const [formCategory, setFormCategory] = useState<PantryItemCategory>("other");
  const [formLocation, setFormLocation] = useState<PantryLocation>("pantry");
  const [formExpiry, setFormExpiry] = useState("");

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const fetchItems = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("pantry_items")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("name");

      if (error) {
        console.error("Failed to fetch pantry items:", error.message);
        return;
      }

      setItems((data as unknown as PantryItem[]) ?? []);
    } catch (err) {
      console.error("Fetch pantry items error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    void fetchItems();
  }, [tenantId, fetchItems]);

  const onRefresh = () => {
    setRefreshing(true);
    void fetchItems();
  };

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  const expiringSoonItems = items.filter(isExpiringSoon);
  const lowStockItems = items.filter(isLowStock);

  const filteredItems =
    locationFilter === "all"
      ? items
      : items.filter((i) => i.location === locationFilter);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const addItem = async () => {
    if (!formName.trim() || !tenantId) return;

    const newItem = {
      tenant_id: tenantId,
      name: formName.trim(),
      quantity: parseInt(formQuantity, 10) || 1,
      unit: formUnit.trim() || "pcs",
      category: formCategory,
      location: formLocation,
      expiry_date: formExpiry.trim() || null,
      source: "manual" as PantryItemSource,
      added_date: new Date().toISOString(),
      barcode: null,
      brand: null,
      notes: null,
      image_url: null,
      min_stock_threshold: null,
    };

    const { error } = await supabase.from("pantry_items").insert(newItem);

    if (error) {
      Alert.alert("Error", "Failed to add item: " + error.message);
      return;
    }

    setModalVisible(false);
    resetForm();
    void fetchItems();
  };

  const updateQuantity = async (item: PantryItem, delta: number) => {
    const newQty = Math.max(0, item.quantity + delta);

    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, quantity: newQty } : i))
    );

    const { error } = await supabase
      .from("pantry_items")
      .update({ quantity: newQty })
      .eq("id", item.id as string);

    if (error) {
      void fetchItems();
    }
  };

  const removeItem = async (item: PantryItem) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));

    const { error } = await supabase
      .from("pantry_items")
      .delete()
      .eq("id", item.id as string);

    if (error) {
      void fetchItems();
    }
  };

  const resetForm = () => {
    setFormName("");
    setFormQuantity("1");
    setFormUnit("pcs");
    setFormCategory("other");
    setFormLocation("pantry");
    setFormExpiry("");
  };

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const renderSummaryCards = () => (
    <View style={styles.summaryRow}>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryValue}>{items.length}</Text>
        <Text style={styles.summaryLabel}>Total Items</Text>
      </View>
      <View style={[styles.summaryCard, { borderColor: "#f59e0b" }]}>
        <Text style={[styles.summaryValue, { color: "#f59e0b" }]}>
          {expiringSoonItems.length}
        </Text>
        <Text style={styles.summaryLabel}>Expiring Soon</Text>
      </View>
      <View style={[styles.summaryCard, { borderColor: "#ef4444" }]}>
        <Text style={[styles.summaryValue, { color: "#ef4444" }]}>
          {lowStockItems.length}
        </Text>
        <Text style={styles.summaryLabel}>Low Stock</Text>
      </View>
    </View>
  );

  const renderExpiringAlert = () => {
    if (expiringSoonItems.length === 0) return null;
    return (
      <View style={styles.expiringAlert}>
        <View style={styles.expiringAlertHeader}>
          <Ionicons name="warning-outline" size={18} color="#f59e0b" />
          <Text style={styles.expiringAlertTitle}>Expiring Soon</Text>
        </View>
        {expiringSoonItems.map((item) => (
          <View key={item.id as string} style={styles.expiringAlertItem}>
            <Text style={styles.expiringAlertName}>{item.name}</Text>
            <Text style={styles.expiringAlertDate}>
              {formatDate(item.expiry_date)}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const renderLocationTabs = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.locationTabsContent}
      style={styles.locationTabs}
    >
      {LOCATION_FILTERS.map((loc) => {
        const active = locationFilter === loc;
        const label = loc === "all" ? "All" : LOCATION_LABELS[loc];
        return (
          <TouchableOpacity
            key={loc}
            style={[styles.locationTab, active && styles.locationTabActive]}
            onPress={() => setLocationFilter(loc)}
          >
            <Text
              style={[
                styles.locationTabText,
                active && styles.locationTabTextActive,
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const renderItem = ({ item }: { item: PantryItem }) => (
    <View style={styles.itemCard}>
      <View style={styles.itemTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemName} numberOfLines={1}>
            {item.name}
            {item.brand ? (
              <Text style={styles.itemBrand}> - {item.brand}</Text>
            ) : null}
          </Text>
          <View style={styles.itemMeta}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>
                {CATEGORY_LABELS[item.category]}
              </Text>
            </View>
            <Text style={styles.itemLocation}>
              {LOCATION_LABELS[item.location]}
            </Text>
            <Text style={styles.itemExpiry}>
              {formatDate(item.expiry_date)}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => removeItem(item)}
          style={styles.removeBtn}
        >
          <Ionicons name="trash-outline" size={18} color="#ef4444" />
        </TouchableOpacity>
      </View>
      <View style={styles.quantityRow}>
        <TouchableOpacity
          style={styles.qtyBtn}
          onPress={() => updateQuantity(item, -1)}
        >
          <Ionicons name="remove" size={18} color="#D4A843" />
        </TouchableOpacity>
        <Text style={styles.qtyText}>
          {item.quantity} {item.unit}
        </Text>
        <TouchableOpacity
          style={styles.qtyBtn}
          onPress={() => updateQuantity(item, 1)}
        >
          <Ionicons name="add" size={18} color="#D4A843" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderAddModal = () => (
    <Modal
      visible={modalVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Pantry Item</Text>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Ionicons name="close" size={24} color="#64748b" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Name */}
            <Text style={styles.formLabel}>Name</Text>
            <TextInput
              style={styles.formInput}
              placeholder="Item name"
              placeholderTextColor="#94a3b8"
              value={formName}
              onChangeText={setFormName}
            />

            {/* Quantity & Unit */}
            <View style={styles.formRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.formLabel}>Quantity</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="1"
                  placeholderTextColor="#94a3b8"
                  keyboardType="numeric"
                  value={formQuantity}
                  onChangeText={setFormQuantity}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.formLabel}>Unit</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="pcs"
                  placeholderTextColor="#94a3b8"
                  value={formUnit}
                  onChangeText={setFormUnit}
                />
              </View>
            </View>

            {/* Category picker */}
            <Text style={styles.formLabel}>Category</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pillRow}
            >
              {CATEGORIES.map((cat) => {
                const active = formCategory === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => setFormCategory(cat)}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        active && styles.pillTextActive,
                      ]}
                    >
                      {CATEGORY_LABELS[cat]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Location picker */}
            <Text style={styles.formLabel}>Location</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pillRow}
            >
              {LOCATIONS.map((loc) => {
                const active = formLocation === loc;
                return (
                  <TouchableOpacity
                    key={loc}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => setFormLocation(loc)}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        active && styles.pillTextActive,
                      ]}
                    >
                      {LOCATION_LABELS[loc]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Expiry date */}
            <Text style={styles.formLabel}>Expiry Date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="2026-04-15"
              placeholderTextColor="#94a3b8"
              value={formExpiry}
              onChangeText={setFormExpiry}
            />
          </ScrollView>

          <TouchableOpacity
            style={[
              styles.addButton,
              !formName.trim() && { opacity: 0.5 },
            ]}
            onPress={addItem}
            disabled={!formName.trim()}
          >
            <Text style={styles.addButtonText}>Add Item</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // -------------------------------------------------------------------------
  // Loading / Empty states
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.loadingText}>Loading pantry...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderAddModal()}

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id as string}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#D4A843"
          />
        }
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            {/* Add Item button */}
            <View style={styles.headerRow}>
              <Text style={styles.screenTitle}>Pantry</Text>
              <TouchableOpacity
                style={styles.addItemBtn}
                onPress={() => setModalVisible(true)}
              >
                <Ionicons name="add-circle-outline" size={20} color="#ffffff" />
                <Text style={styles.addItemBtnText}>Add Item</Text>
              </TouchableOpacity>
            </View>

            {renderSummaryCards()}
            {renderExpiringAlert()}
            {renderLocationTabs()}
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="nutrition-outline" size={48} color="#94a3b8" />
            <Text style={styles.emptyText}>No items found</Text>
            <Text style={styles.emptySubtext}>
              Tap "Add Item" to stock your pantry
            </Text>
          </View>
        }
      />
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
  },
  listContent: {
    paddingBottom: 32,
  },

  // Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  addItemBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#D4A843",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addItemBtnText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
    marginLeft: 6,
  },

  // Summary cards
  summaryRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingVertical: 12,
    alignItems: "center",
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  summaryLabel: {
    fontSize: 11,
    color: "#64748b",
    marginTop: 2,
  },

  // Expiring alert
  expiringAlert: {
    marginHorizontal: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#f59e0b",
    backgroundColor: "#fffbeb",
    borderRadius: 10,
    padding: 12,
  },
  expiringAlertHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  expiringAlertTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#92400e",
    marginLeft: 6,
  },
  expiringAlertItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  expiringAlertName: {
    fontSize: 13,
    color: "#78350f",
    fontWeight: "500",
  },
  expiringAlertDate: {
    fontSize: 12,
    color: "#92400e",
  },

  // Location filter tabs
  locationTabs: {
    marginTop: 8,
  },
  locationTabsContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  locationTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  locationTabActive: {
    backgroundColor: "#D4A843",
    borderColor: "#D4A843",
  },
  locationTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  locationTabTextActive: {
    color: "#ffffff",
  },

  // Item card
  itemCard: {
    backgroundColor: "#ffffff",
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
  },
  itemTop: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  itemName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  itemBrand: {
    fontWeight: "400",
    color: "#64748b",
    fontSize: 13,
  },
  itemMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    flexWrap: "wrap",
    gap: 6,
  },
  categoryBadge: {
    backgroundColor: "#FFF8E1",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#D4A843",
  },
  itemLocation: {
    fontSize: 12,
    color: "#64748b",
  },
  itemExpiry: {
    fontSize: 12,
    color: "#94a3b8",
  },
  removeBtn: {
    padding: 6,
  },

  // Quantity controls
  quantityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D4A843",
    justifyContent: "center",
    alignItems: "center",
  },
  qtyText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
    marginHorizontal: 16,
    minWidth: 60,
    textAlign: "center",
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

  // Modal
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
  },
  formRow: {
    flexDirection: "row",
  },
  pillRow: {
    gap: 6,
    paddingVertical: 4,
  },
  pill: {
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
  addButton: {
    backgroundColor: "#D4A843",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  addButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
});
