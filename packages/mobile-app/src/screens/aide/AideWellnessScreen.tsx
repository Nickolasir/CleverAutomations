import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthContext } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WellnessCheckin {
  id: string;
  checkin_type: string;
  status: string;
  mood_rating: number | null;
  pain_level: number | null;
  notes: string | null;
  flagged: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  completed: "#22c55e",
  no_response: "#94a3b8",
  concern_flagged: "#f59e0b",
  emergency: "#ef4444",
};

const STATUS_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  completed: "checkmark-circle",
  no_response: "time-outline",
  concern_flagged: "warning",
  emergency: "alert-circle",
};

const MOOD_EMOJIS: Record<number, string> = {
  1: "\u{1F622}", // crying
  2: "\u{1F641}", // frowning
  3: "\u{1F610}", // neutral
  4: "\u{1F642}", // slightly smiling
  5: "\u{1F60A}", // smiling
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AideWellnessScreen() {
  const { user } = useAuthContext();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [checkins, setCheckins] = useState<WellnessCheckin[]>([]);
  const [aideProfileId, setAideProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const tenantId = user?.tenant_id;

  const fetchAideProfileId = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase
      .from("aide_profiles")
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(1)
      .single();
    if (data) setAideProfileId(data.id);
  }, [tenantId]);

  const fetchCheckins = useCallback(async () => {
    if (!aideProfileId) return;
    try {
      const { data } = await supabase
        .from("aide_wellness_checkins")
        .select(
          "id, checkin_type, status, mood_rating, pain_level, notes, flagged, created_at",
        )
        .eq("aide_profile_id", aideProfileId)
        .order("created_at", { ascending: false });

      setCheckins(data ?? []);
    } catch (err) {
      console.error("Wellness fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [aideProfileId]);

  useEffect(() => {
    fetchAideProfileId();
  }, [fetchAideProfileId]);

  useEffect(() => {
    if (aideProfileId) fetchCheckins();
  }, [aideProfileId, fetchCheckins]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchCheckins();
  }, [fetchCheckins]);

  const formatDateTime = (dateStr: string): string => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const renderPainBar = (painLevel: number | null) => {
    if (painLevel == null) return null;
    const maxBars = 10;
    const filled = Math.min(painLevel, maxBars);
    const barColor =
      painLevel <= 3 ? "#22c55e" : painLevel <= 6 ? "#f59e0b" : "#ef4444";

    return (
      <View style={styles.painBarContainer}>
        <Text style={styles.painLabel}>Pain: {painLevel}/10</Text>
        <View style={styles.painBarTrack}>
          <View
            style={[
              styles.painBarFill,
              {
                width: `${(filled / maxBars) * 100}%`,
                backgroundColor: barColor,
              },
            ]}
          />
        </View>
      </View>
    );
  };

  const renderCheckin = ({ item }: { item: WellnessCheckin }) => {
    const statusColor = STATUS_COLORS[item.status] ?? "#94a3b8";
    const statusIcon = STATUS_ICONS[item.status] ?? "ellipse-outline";

    return (
      <View
        style={[
          styles.checkinCard,
          item.flagged && styles.checkinFlagged,
        ]}
      >
        {/* Timeline dot */}
        <View style={styles.timelineColumn}>
          <View
            style={[styles.timelineDot, { backgroundColor: statusColor }]}
          />
          <View style={styles.timelineLine} />
        </View>

        {/* Content */}
        <View style={styles.checkinContent}>
          <View style={styles.checkinHeader}>
            <Ionicons name={statusIcon} size={18} color={statusColor} />
            <Text style={styles.checkinType}>
              {item.checkin_type.replace(/_/g, " ")}
            </Text>
            <Text style={styles.checkinTime}>
              {formatDateTime(item.created_at)}
            </Text>
          </View>

          <View style={styles.statusRow}>
            <View
              style={[styles.statusBadge, { backgroundColor: statusColor }]}
            >
              <Text style={styles.statusText}>
                {item.status.replace(/_/g, " ")}
              </Text>
            </View>

            {item.mood_rating != null && (
              <Text style={styles.moodEmoji}>
                {MOOD_EMOJIS[item.mood_rating] ?? "\u{1F610}"}{" "}
                <Text style={styles.moodLabel}>{item.mood_rating}/5</Text>
              </Text>
            )}
          </View>

          {renderPainBar(item.pain_level)}

          {item.notes && (
            <Text style={styles.notesText}>{item.notes}</Text>
          )}

          {item.flagged && (
            <View style={styles.flaggedBadge}>
              <Ionicons name="flag" size={14} color="#b45309" />
              <Text style={styles.flaggedText}>Flagged for review</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.header}>Wellness Check-ins</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <Text style={styles.emptyText}>Loading check-ins...</Text>
      ) : checkins.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="heart-outline" size={48} color="#cbd5e1" />
          <Text style={styles.emptyText}>No wellness check-ins yet</Text>
        </View>
      ) : (
        <FlatList
          data={checkins}
          keyExtractor={(item) => item.id}
          renderItem={renderCheckin}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
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
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  header: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a1a1a",
    flex: 1,
    marginLeft: 12,
  },
  listContent: {
    paddingBottom: 16,
  },
  checkinCard: {
    flexDirection: "row",
    marginBottom: 4,
  },
  checkinFlagged: {
    backgroundColor: "#fffbeb",
    borderRadius: 12,
    marginBottom: 4,
  },
  timelineColumn: {
    width: 24,
    alignItems: "center",
    paddingTop: 4,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: "#e2e8f0",
    marginTop: 4,
  },
  checkinContent: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginLeft: 8,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  checkinHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  checkinType: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
    textTransform: "capitalize",
    flex: 1,
  },
  checkinTime: {
    fontSize: 11,
    color: "#94a3b8",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  moodEmoji: {
    fontSize: 18,
  },
  moodLabel: {
    fontSize: 12,
    color: "#64748b",
  },
  painBarContainer: {
    marginBottom: 8,
  },
  painLabel: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 4,
  },
  painBarTrack: {
    height: 8,
    backgroundColor: "#e2e8f0",
    borderRadius: 4,
    overflow: "hidden",
  },
  painBarFill: {
    height: "100%",
    borderRadius: 4,
  },
  notesText: {
    fontSize: 13,
    color: "#475569",
    fontStyle: "italic",
    marginTop: 4,
  },
  flaggedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    backgroundColor: "#fef3c7",
    padding: 6,
    borderRadius: 6,
  },
  flaggedText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#b45309",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: "#94a3b8",
    textAlign: "center",
    marginTop: 16,
  },
});
