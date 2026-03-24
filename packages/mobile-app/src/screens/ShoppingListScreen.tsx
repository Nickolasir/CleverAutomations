import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type {
  ShoppingListItem,
  ShoppingListItemId,
} from "@clever/shared";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADDED_VIA_LABELS: Record<string, string> = {
  voice: "Voice",
  dashboard: "Dashboard",
  mobile: "Mobile",
  auto_restock: "Auto",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ShoppingListScreen() {
  const { user } = useAuthContext();
  const tenantId = user?.tenant_id;

  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showChecked, setShowChecked] = useState(false);

  // Quick add state
  const [quickName, setQuickName] = useState("");
  const [quickQuantity, setQuickQuantity] = useState("1");

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
        .from("shopping_list_items")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to fetch shopping list:", error.message);
        return;
      }

      setItems((data as unknown as ShoppingListItem[]) ?? []);
    } catch (err) {
      console.error("Fetch shopping list error:", err);
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

  const uncheckedItems = items.filter((i) => !i.checked);
  const checkedItems = items.filter((i) => i.checked);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const addItem = async () => {
    if (!quickName.trim() || !tenantId || !user) return;

    const newItem = {
      tenant_id: tenantId,
      name: quickName.trim(),
      quantity: parseInt(quickQuantity, 10) || 1,
      unit: null,
      category: null,
      checked: false,
      added_by: user.id,
      added_via: "mobile" as const,
      notes: null,
      priority: "normal" as const,
    };

    const { error } = await supabase
      .from("shopping_list_items")
      .insert(newItem);

    if (error) {
      Alert.alert("Error", "Failed to add item: " + error.message);
      return;
    }

    setQuickName("");
    setQuickQuantity("1");
    void fetchItems();
  };

  const toggleChecked = async (item: ShoppingListItem) => {
    const newChecked = !item.checked;

    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, checked: newChecked } : i
      )
    );

    const { error } = await supabase
      .from("shopping_list_items")
      .update({ checked: newChecked })
      .eq("id", item.id as string);

    if (error) {
      void fetchItems();
    }
  };

  const removeItem = async (item: ShoppingListItem) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));

    const { error } = await supabase
      .from("shopping_list_items")
      .delete()
      .eq("id", item.id as string);

    if (error) {
      void fetchItems();
    }
  };

  const clearPurchased = async () => {
    const checkedIds = checkedItems.map((i) => i.id as string);
    if (checkedIds.length === 0) return;

    setItems((prev) => prev.filter((i) => !i.checked));

    const { error } = await supabase
      .from("shopping_list_items")
      .delete()
      .in("id", checkedIds);

    if (error) {
      void fetchItems();
    }
  };

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const renderQuickAdd = () => (
    <View style={styles.quickAddRow}>
      <TextInput
        style={styles.quickAddNameInput}
        placeholder="Add item..."
        placeholderTextColor="#94a3b8"
        value={quickName}
        onChangeText={setQuickName}
        onSubmitEditing={addItem}
        returnKeyType="done"
      />
      <TextInput
        style={styles.quickAddQtyInput}
        placeholder="1"
        placeholderTextColor="#94a3b8"
        keyboardType="numeric"
        value={quickQuantity}
        onChangeText={setQuickQuantity}
      />
      <TouchableOpacity
        style={[styles.quickAddBtn, !quickName.trim() && { opacity: 0.5 }]}
        onPress={addItem}
        disabled={!quickName.trim()}
      >
        <Ionicons name="add" size={22} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );

  const renderUncheckedItem = (item: ShoppingListItem) => (
    <View key={item.id as string} style={styles.itemCard}>
      <TouchableOpacity
        style={styles.checkbox}
        onPress={() => toggleChecked(item)}
      >
        <Ionicons name="square-outline" size={22} color="#94a3b8" />
      </TouchableOpacity>
      <View style={styles.itemInfo}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.name}
          {item.quantity > 1 ? (
            <Text style={styles.itemQty}> x{item.quantity}</Text>
          ) : null}
        </Text>
        {item.added_via ? (
          <View style={styles.addedViaBadge}>
            <Text style={styles.addedViaBadgeText}>
              {ADDED_VIA_LABELS[item.added_via] ?? item.added_via}
            </Text>
          </View>
        ) : null}
      </View>
      <TouchableOpacity
        style={styles.removeBtn}
        onPress={() => removeItem(item)}
      >
        <Ionicons name="close" size={18} color="#ef4444" />
      </TouchableOpacity>
    </View>
  );

  const renderCheckedItem = (item: ShoppingListItem) => (
    <View key={item.id as string} style={styles.checkedItemCard}>
      <TouchableOpacity
        style={styles.checkbox}
        onPress={() => toggleChecked(item)}
      >
        <Ionicons name="checkbox" size={22} color="#D4A843" />
      </TouchableOpacity>
      <View style={styles.itemInfo}>
        <Text style={styles.checkedItemName} numberOfLines={1}>
          {item.name}
          {item.quantity > 1 ? (
            <Text style={styles.itemQty}> x{item.quantity}</Text>
          ) : null}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.removeBtn}
        onPress={() => removeItem(item)}
      >
        <Ionicons name="close" size={16} color="#94a3b8" />
      </TouchableOpacity>
    </View>
  );

  const renderCheckedSection = () => {
    if (checkedItems.length === 0) return null;
    return (
      <View style={styles.checkedSection}>
        <TouchableOpacity
          style={styles.checkedToggle}
          onPress={() => setShowChecked((prev) => !prev)}
        >
          <Ionicons
            name={showChecked ? "chevron-down" : "chevron-forward"}
            size={18}
            color="#64748b"
          />
          <Text style={styles.checkedToggleText}>
            Purchased ({checkedItems.length})
          </Text>
        </TouchableOpacity>
        {showChecked && (
          <>
            {checkedItems.map(renderCheckedItem)}
            <TouchableOpacity
              style={styles.clearPurchasedBtn}
              onPress={clearPurchased}
            >
              <Ionicons name="trash-outline" size={16} color="#ef4444" />
              <Text style={styles.clearPurchasedText}>Clear Purchased</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  };

  // -------------------------------------------------------------------------
  // Loading / Empty states
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.loadingText}>Loading shopping list...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={uncheckedItems}
        keyExtractor={(item) => item.id as string}
        renderItem={({ item }) => renderUncheckedItem(item)}
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
            <Text style={styles.screenTitle}>Shopping List</Text>
            {renderQuickAdd()}
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="cart-outline" size={48} color="#94a3b8" />
            <Text style={styles.emptyText}>List is empty</Text>
            <Text style={styles.emptySubtext}>
              Add items using the field above
            </Text>
          </View>
        }
        ListFooterComponent={renderCheckedSection()}
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
  screenTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a1a1a",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },

  // Quick add
  quickAddRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  quickAddNameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
  },
  quickAddQtyInput: {
    width: 50,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
    textAlign: "center",
  },
  quickAddBtn: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: "#D4A843",
    justifyContent: "center",
    alignItems: "center",
  },

  // Unchecked item card
  itemCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
  },
  checkbox: {
    marginRight: 10,
  },
  itemInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  itemName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  itemQty: {
    fontWeight: "400",
    color: "#64748b",
    fontSize: 13,
  },
  addedViaBadge: {
    backgroundColor: "#FFF8E1",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  addedViaBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#D4A843",
  },
  removeBtn: {
    padding: 6,
  },

  // Checked section
  checkedSection: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    marginHorizontal: 16,
  },
  checkedToggle: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  checkedToggleText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748b",
    marginLeft: 6,
  },
  checkedItemCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FDF6E3",
    marginTop: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    padding: 10,
  },
  checkedItemName: {
    fontSize: 14,
    color: "#94a3b8",
    textDecorationLine: "line-through",
  },
  clearPurchasedBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
  },
  clearPurchasedText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#ef4444",
    marginLeft: 6,
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
});
