import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  Modal,
  ScrollView,
} from "react-native";
import type {
  Reservation,
  GuestProfile,
  GuestWipeChecklist,
  GuestWipeCategory,
} from "@clever/shared";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";

type ReservationStatus = Reservation["status"];

/** Status color mapping */
const STATUS_COLORS: Record<ReservationStatus, string> = {
  upcoming: "#3b82f6",
  active: "#22c55e",
  completed: "#64748b",
  cancelled: "#dc2626",
};

const WIPE_CATEGORY_LABELS: Record<GuestWipeCategory, string> = {
  locks: "Door Codes & Locks",
  wifi: "WiFi Passwords",
  voice_history: "Voice Command History",
  tv_logins: "TV & Streaming Logins",
  preferences: "Guest Preferences",
  personal_data: "Personal Data",
};

/**
 * CleverHost guest management mobile view.
 * Shows reservation list, guest profiles, and turnover wipe status.
 * Only available for CleverHost vertical tenants.
 */
export default function GuestScreen() {
  const { user, tenant } = useAuthContext();
  const tenantId = user?.tenant_id;

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [guestProfile, setGuestProfile] = useState<GuestProfile | null>(null);
  const [wipeChecklist, setWipeChecklist] = useState<GuestWipeChecklist | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  /** Fetch reservations */
  const fetchReservations = useCallback(async () => {
    if (!tenantId) return;

    try {
      const { data, error } = await supabase
        .from("reservations")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("check_in", { ascending: true });

      if (error) {
        console.error("Failed to fetch reservations:", error.message);
        return;
      }

      setReservations((data as unknown as Reservation[]) ?? []);
    } catch (err) {
      console.error("Fetch reservations error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchReservations();
  }, [fetchReservations]);

  /** Load reservation details */
  const loadDetails = async (reservation: Reservation) => {
    setSelectedReservation(reservation);
    setGuestProfile(null);
    setWipeChecklist(null);
    setModalVisible(true);

    const [profileRes, wipeRes] = await Promise.all([
      supabase
        .from("guest_profiles")
        .select("*")
        .eq("reservation_id", reservation.id as string)
        .single(),
      supabase
        .from("guest_wipe_checklists")
        .select("*")
        .eq("reservation_id", reservation.id as string)
        .single(),
    ]);

    if (profileRes.data) {
      setGuestProfile(profileRes.data as unknown as GuestProfile);
    }
    if (wipeRes.data) {
      setWipeChecklist(wipeRes.data as unknown as GuestWipeChecklist);
    }
  };

  /** Initiate guest wipe */
  const initiateWipe = async (reservationId: string) => {
    if (!tenantId) return;

    Alert.alert(
      "Initiate Guest Wipe",
      "This will wipe all guest personal data: locks, WiFi, voice history, TV logins, preferences, and personal data. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Wipe",
          style: "destructive",
          onPress: async () => {
            try {
              const wipeCategories: GuestWipeCategory[] = [
                "locks",
                "wifi",
                "voice_history",
                "tv_logins",
                "preferences",
                "personal_data",
              ];

              const { error } = await supabase
                .from("guest_wipe_checklists")
                .insert({
                  reservation_id: reservationId,
                  tenant_id: tenantId,
                  items: wipeCategories.map((category) => ({
                    category,
                    description: `Wipe ${category.replace("_", " ")}`,
                    status: "pending",
                    completed_at: null,
                  })),
                  started_at: new Date().toISOString(),
                  completed_at: null,
                  is_complete: false,
                });

              if (error) {
                Alert.alert("Error", error.message);
                return;
              }

              Alert.alert("Success", "Guest wipe initiated successfully.");

              /** Reload details if this reservation is selected */
              if (selectedReservation?.id === reservationId) {
                await loadDetails(selectedReservation);
              }
            } catch (err) {
              Alert.alert(
                "Error",
                err instanceof Error ? err.message : "Failed to initiate wipe"
              );
            }
          },
        },
      ]
    );
  };

  /** Pull-to-refresh */
  const onRefresh = () => {
    setRefreshing(true);
    void fetchReservations();
  };

  /** Render reservation card */
  const renderReservation = ({ item }: { item: Reservation }) => {
    const checkIn = new Date(item.check_in);
    const checkOut = new Date(item.check_out);
    const nights = Math.ceil(
      (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)
    );

    return (
      <TouchableOpacity
        style={styles.reservationCard}
        onPress={() => loadDetails(item)}
        activeOpacity={0.7}
      >
        <View style={styles.reservationHeader}>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: `${STATUS_COLORS[item.status]}15` },
            ]}
          >
            <Text
              style={[
                styles.statusText,
                { color: STATUS_COLORS[item.status] },
              ]}
            >
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>
          <View style={styles.platformBadge}>
            <Text style={styles.platformText}>{item.platform}</Text>
          </View>
        </View>

        <Text style={styles.reservationDates}>
          {checkIn.toLocaleDateString()} - {checkOut.toLocaleDateString()}
        </Text>
        <Text style={styles.reservationMeta}>
          {nights} night{nights !== 1 ? "s" : ""} | {item.guest_count} guest
          {item.guest_count !== 1 ? "s" : ""}
        </Text>

        {item.status === "completed" && (
          <TouchableOpacity
            style={styles.wipeButton}
            onPress={(e) => {
              e.stopPropagation?.();
              void initiateWipe(item.id as string);
            }}
          >
            <Text style={styles.wipeButtonText}>Initiate Wipe</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  if (tenant?.vertical !== "clever_host") {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.unavailableText}>
          Guest management is available for CleverHost properties only.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Reservation list */}
      <FlatList
        data={reservations}
        keyExtractor={(item) => item.id as string}
        renderItem={renderReservation}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#D4A843"
          />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No reservations found</Text>
            <Text style={styles.emptySubtext}>
              Reservations will appear here once synced from your booking platform
            </Text>
          </View>
        }
      />

      {/* Detail modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <ScrollView style={styles.modalContent}>
          {/* Close button */}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setModalVisible(false)}
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>

          {selectedReservation && (
            <>
              {/* Reservation info */}
              <View style={styles.detailSection}>
                <Text style={styles.detailTitle}>Reservation Details</Text>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <Text
                    style={[
                      styles.detailValue,
                      { color: STATUS_COLORS[selectedReservation.status] },
                    ]}
                  >
                    {selectedReservation.status}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Check-in</Text>
                  <Text style={styles.detailValue}>
                    {new Date(selectedReservation.check_in).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Check-out</Text>
                  <Text style={styles.detailValue}>
                    {new Date(selectedReservation.check_out).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Platform</Text>
                  <Text style={styles.detailValue}>
                    {selectedReservation.platform}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Guests</Text>
                  <Text style={styles.detailValue}>
                    {selectedReservation.guest_count}
                  </Text>
                </View>
              </View>

              {/* Guest profile */}
              <View style={styles.detailSection}>
                <Text style={styles.detailTitle}>Guest Profile</Text>
                {guestProfile ? (
                  <>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Name</Text>
                      <Text style={styles.detailValue}>
                        {guestProfile.display_name}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Door Code</Text>
                      <Text style={[styles.detailValue, styles.monoText]}>
                        {guestProfile.door_code}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>WiFi</Text>
                      <Text style={[styles.detailValue, styles.monoText]}>
                        {guestProfile.wifi_password}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Expires</Text>
                      <Text style={styles.detailValue}>
                        {new Date(guestProfile.expires_at).toLocaleString()}
                      </Text>
                    </View>
                  </>
                ) : (
                  <Text style={styles.emptyDetailText}>
                    No guest profile created
                  </Text>
                )}
              </View>

              {/* Wipe checklist */}
              <View style={styles.detailSection}>
                <Text style={styles.detailTitle}>Turnover Wipe Status</Text>
                {wipeChecklist ? (
                  <>
                    {wipeChecklist.items.map((item, idx) => (
                      <View key={idx} style={styles.wipeItemRow}>
                        <View style={styles.wipeItemLeft}>
                          <View
                            style={[
                              styles.wipeStatusDot,
                              {
                                backgroundColor:
                                  item.status === "completed"
                                    ? "#22c55e"
                                    : item.status === "in_progress"
                                      ? "#f59e0b"
                                      : item.status === "failed"
                                        ? "#dc2626"
                                        : "#94a3b8",
                              },
                            ]}
                          />
                          <Text style={styles.wipeItemLabel}>
                            {WIPE_CATEGORY_LABELS[item.category]}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.wipeItemStatus,
                            {
                              color:
                                item.status === "completed"
                                  ? "#22c55e"
                                  : item.status === "failed"
                                    ? "#dc2626"
                                    : "#64748b",
                            },
                          ]}
                        >
                          {item.status}
                        </Text>
                      </View>
                    ))}
                    <View style={styles.wipeCompletionBar}>
                      <Text
                        style={[
                          styles.wipeCompletionText,
                          {
                            color: wipeChecklist.is_complete
                              ? "#22c55e"
                              : "#f59e0b",
                          },
                        ]}
                      >
                        {wipeChecklist.is_complete
                          ? "Wipe complete - Property ready"
                          : "Wipe in progress - DO NOT check in"}
                      </Text>
                    </View>
                  </>
                ) : (
                  <Text style={styles.emptyDetailText}>
                    No wipe initiated for this reservation
                  </Text>
                )}
              </View>
            </>
          )}
        </ScrollView>
      </Modal>
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
    padding: 24,
    backgroundColor: "#FDF6E3",
  },
  unavailableText: {
    fontSize: 14,
    color: "#64748b",
    textAlign: "center",
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  reservationCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 18,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  reservationHeader: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
  },
  platformBadge: {
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  platformText: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "600",
  },
  reservationDates: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  reservationMeta: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 2,
  },
  wipeButton: {
    marginTop: 12,
    backgroundColor: "#fef2f2",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  wipeButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#dc2626",
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 64,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#64748b",
  },
  emptySubtext: {
    fontSize: 13,
    color: "#94a3b8",
    marginTop: 4,
    textAlign: "center",
  },
  modalContent: {
    flex: 1,
    backgroundColor: "#FDF6E3",
    padding: 20,
  },
  closeButton: {
    alignSelf: "flex-end",
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#D4A843",
  },
  detailSection: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 14,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  detailLabel: {
    fontSize: 14,
    color: "#64748b",
  },
  detailValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  monoText: {
    fontFamily: "monospace",
  },
  emptyDetailText: {
    fontSize: 14,
    color: "#94a3b8",
    textAlign: "center",
    paddingVertical: 12,
  },
  wipeItemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  wipeItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  wipeStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  wipeItemLabel: {
    fontSize: 14,
    color: "#334155",
  },
  wipeItemStatus: {
    fontSize: 13,
    fontWeight: "600",
  },
  wipeCompletionBar: {
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#FDF6E3",
    alignItems: "center",
  },
  wipeCompletionText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
