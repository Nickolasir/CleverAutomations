import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AuditLog, AuditAction } from "@clever/shared";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";

const PAGE_SIZE = 50;

/** Human-readable labels for each audit action */
const ACTION_LABELS: Record<AuditAction, string> = {
  device_state_change: "State Change",
  device_command_issued: "Command",
  user_login: "Login",
  user_logout: "Logout",
  guest_profile_created: "Guest Created",
  guest_profile_wiped: "Guest Wiped",
  scene_activated: "Scene Activated",
  automation_triggered: "Automation",
  voice_command_processed: "Voice Command",
  settings_changed: "Settings",
  user_created: "User Created",
  user_deleted: "User Deleted",
  device_registered: "Device Added",
  device_removed: "Device Removed",
  pantry_item_added: "Pantry Added",
  pantry_item_removed: "Pantry Removed",
  pantry_item_updated: "Pantry Updated",
  shopping_list_item_added: "Shopping Added",
  shopping_list_item_removed: "Shopping Removed",
  shopping_list_item_checked: "Shopping Checked",
  receipt_scanned: "Receipt Scanned",
  pantry_photo_analyzed: "Photo Analyzed",
};

/** Color for each action category */
function getActionColor(action: AuditAction): string {
  if (action.startsWith("user_")) return "#D4A843";
  if (action.startsWith("device_")) return "#16a34a";
  if (action.startsWith("guest_")) return "#d97706";
  if (action.startsWith("voice_")) return "#7c3aed";
  if (
    action.startsWith("pantry_") ||
    action.startsWith("shopping_") ||
    action === "receipt_scanned"
  )
    return "#ea580c";
  if (action === "scene_activated" || action === "automation_triggered")
    return "#0891b2";
  if (action === "settings_changed") return "#64748b";
  return "#64748b";
}

/** Background tint for each action badge */
function getActionBg(action: AuditAction): string {
  if (action.startsWith("user_")) return "#FFECB3";
  if (action.startsWith("device_")) return "#dcfce7";
  if (action.startsWith("guest_")) return "#fef3c7";
  if (action.startsWith("voice_")) return "#ede9fe";
  if (
    action.startsWith("pantry_") ||
    action.startsWith("shopping_") ||
    action === "receipt_scanned"
  )
    return "#ffedd5";
  if (action === "scene_activated" || action === "automation_triggered")
    return "#cffafe";
  if (action === "settings_changed") return "#f1f5f9";
  return "#f1f5f9";
}

/** All possible filter values (null = show all) */
const ALL_ACTIONS: AuditAction[] = [
  "device_state_change",
  "device_command_issued",
  "user_login",
  "user_logout",
  "guest_profile_created",
  "guest_profile_wiped",
  "scene_activated",
  "automation_triggered",
  "voice_command_processed",
  "settings_changed",
  "user_created",
  "user_deleted",
  "device_registered",
  "device_removed",
  "pantry_item_added",
  "pantry_item_removed",
  "pantry_item_updated",
  "shopping_list_item_added",
  "shopping_list_item_removed",
  "shopping_list_item_checked",
  "receipt_scanned",
  "pantry_photo_analyzed",
];

/**
 * Admin-only Audit Log screen.
 * Shows a paginated, filterable list of audit events for the current tenant.
 */
export default function AuditScreen() {
  const { user } = useAuthContext();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedAction, setSelectedAction] = useState<AuditAction | null>(
    null,
  );

  const isAdmin =
    user?.role === "admin" || user?.role === "owner";
  const tenantId = user?.tenant_id;

  /** Fetch a page of audit logs */
  const fetchLogs = useCallback(
    async (offset: number, replace: boolean) => {
      if (!tenantId) return;

      try {
        let query = supabase
          .from("audit_logs")
          .select("*")
          .eq("tenant_id", tenantId as string)
          .order("timestamp", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        if (selectedAction) {
          query = query.eq("action", selectedAction);
        }

        const { data, error } = await query;

        if (error) {
          console.error("Failed to fetch audit logs:", error.message);
          return;
        }

        const rows = (data as unknown as AuditLog[]) ?? [];
        setHasMore(rows.length === PAGE_SIZE);

        if (replace) {
          setLogs(rows);
        } else {
          setLogs((prev) => [...prev, ...rows]);
        }
      } catch (err) {
        console.error("Fetch audit logs error:", err);
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [tenantId, selectedAction],
  );

  /** Initial load and re-fetch when filter changes */
  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    setLogs([]);
    void fetchLogs(0, true);
  }, [fetchLogs, isAdmin]);

  /** Pull-to-refresh */
  const onRefresh = () => {
    setRefreshing(true);
    void fetchLogs(0, true);
  };

  /** Load next page */
  const onLoadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    void fetchLogs(logs.length, false);
  };

  /** Format details for display */
  const formatDetails = (details: Record<string, unknown>): string => {
    if (!details || Object.keys(details).length === 0) return "-";
    const raw = JSON.stringify(details);
    return raw.length > 120 ? raw.slice(0, 117) + "..." : raw;
  };

  // -------------------------------------------------------------------------
  // Access denied
  // -------------------------------------------------------------------------
  if (!isAdmin) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="lock-closed" size={48} color="#94a3b8" />
        <Text style={styles.accessDeniedTitle}>Access Denied</Text>
        <Text style={styles.accessDeniedText}>
          Only admins and owners can view the audit log.
        </Text>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------
  if (loading && logs.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#D4A843" />
        <Text style={styles.loadingText}>Loading audit logs...</Text>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------
  return (
    <View style={styles.container}>
      {/* Filter pills */}
      <View style={styles.filterContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          <TouchableOpacity
            style={[
              styles.filterPill,
              selectedAction === null && styles.filterPillActive,
            ]}
            onPress={() => setSelectedAction(null)}
          >
            <Text
              style={[
                styles.filterPillText,
                selectedAction === null && styles.filterPillTextActive,
              ]}
            >
              All
            </Text>
          </TouchableOpacity>
          {ALL_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action}
              style={[
                styles.filterPill,
                selectedAction === action && styles.filterPillActive,
              ]}
              onPress={() =>
                setSelectedAction(
                  selectedAction === action ? null : action,
                )
              }
            >
              <Text
                style={[
                  styles.filterPillText,
                  selectedAction === action && styles.filterPillTextActive,
                ]}
              >
                {ACTION_LABELS[action]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Log list */}
      <FlatList
        data={logs}
        keyExtractor={(item) => item.id as string}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#D4A843"
          />
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            {/* Timestamp row */}
            <View style={styles.cardTopRow}>
              <Ionicons name="time-outline" size={14} color="#94a3b8" />
              <Text style={styles.timestamp}>
                {new Date(item.timestamp).toLocaleString()}
              </Text>
            </View>

            {/* Action badge + user */}
            <View style={styles.cardMiddleRow}>
              <View
                style={[
                  styles.actionBadge,
                  { backgroundColor: getActionBg(item.action) },
                ]}
              >
                <Text
                  style={[
                    styles.actionBadgeText,
                    { color: getActionColor(item.action) },
                  ]}
                >
                  {ACTION_LABELS[item.action]}
                </Text>
              </View>
              <Text style={styles.userLabel}>
                {item.user_id ? String(item.user_id).slice(0, 8) + "..." : "System"}
              </Text>
            </View>

            {/* Details */}
            <Text style={styles.detailsText} numberOfLines={3}>
              {formatDetails(item.details)}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={48} color="#cbd5e1" />
            <Text style={styles.emptyText}>No audit logs found</Text>
            <Text style={styles.emptySubtext}>
              {selectedAction
                ? "Try removing the filter to see all events."
                : "Activity will appear here once events are recorded."}
            </Text>
          </View>
        }
        ListFooterComponent={
          hasMore && logs.length > 0 ? (
            <TouchableOpacity
              style={styles.loadMoreButton}
              onPress={onLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color="#D4A843" />
              ) : (
                <Text style={styles.loadMoreText}>Load More</Text>
              )}
            </TouchableOpacity>
          ) : null
        }
      />
    </View>
  );
}

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
    paddingHorizontal: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#64748b",
  },
  accessDeniedTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
    marginTop: 16,
  },
  accessDeniedText: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 6,
    textAlign: "center",
  },

  // Filter pills
  filterContainer: {
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 10,
  },
  filterScroll: {
    paddingHorizontal: 12,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  filterPillActive: {
    backgroundColor: "#D4A843",
    borderColor: "#D4A843",
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  filterPillTextActive: {
    color: "#ffffff",
  },

  // List
  listContent: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },

  // Card
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  timestamp: {
    fontSize: 12,
    color: "#94a3b8",
    marginLeft: 4,
  },
  cardMiddleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  actionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  actionBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  userLabel: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "500",
  },
  detailsText: {
    fontSize: 12,
    color: "#475569",
    lineHeight: 18,
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
    textAlign: "center",
    paddingHorizontal: 32,
  },

  // Load more
  loadMoreButton: {
    alignItems: "center",
    paddingVertical: 14,
    marginTop: 4,
    marginBottom: 16,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#D4A843",
  },
});
