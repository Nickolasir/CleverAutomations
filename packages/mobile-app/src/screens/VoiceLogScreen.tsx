import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { VoiceTranscriptRecord, VoiceTier } from "@clever/shared";
import { useAuthContext } from "../lib/auth-context";
import { supabase } from "../lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

/* ── constants ─────────────────────────────────────────── */

const PAGE_SIZE = 50;

const TIER_COLORS: Record<VoiceTier, string> = {
  tier1_rules: "#22c55e",
  tier2_cloud: "#3b82f6",
  tier3_local: "#f59e0b",
};

const TIER_LABELS: Record<VoiceTier, string> = {
  tier1_rules: "Rules Engine",
  tier2_cloud: "Cloud Streaming",
  tier3_local: "Local Fallback",
};

const ALL_TIERS: VoiceTier[] = ["tier1_rules", "tier2_cloud", "tier3_local"];

/* ── helpers ───────────────────────────────────────────── */

interface TierStats {
  tier: VoiceTier;
  count: number;
  avgLatencyMs: number;
  percentage: number;
}

function computeStats(records: VoiceTranscriptRecord[]) {
  const total = records.length;
  const avgLatency =
    total > 0
      ? Math.round(records.reduce((s, r) => s + r.latency_ms, 0) / total)
      : 0;

  const breakdown: TierStats[] = ALL_TIERS.map((tier) => {
    const subset = records.filter((r) => r.tier_used === tier);
    return {
      tier,
      count: subset.length,
      avgLatencyMs:
        subset.length > 0
          ? Math.round(subset.reduce((s, r) => s + r.latency_ms, 0) / subset.length)
          : 0,
      percentage: total > 0 ? Math.round((subset.length / total) * 100) : 0,
    };
  });

  return { totalCount: total, avgLatency, breakdown };
}

function latencyColor(ms: number): string {
  if (ms < 200) return "#22c55e";
  if (ms < 500) return "#3b82f6";
  if (ms < 1000) return "#f59e0b";
  return "#ef4444";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* ── component ─────────────────────────────────────────── */

export default function VoiceLogScreen() {
  const { tenant } = useAuthContext();
  const tenantId = tenant?.id ?? null;

  const [transcripts, setTranscripts] = useState<VoiceTranscriptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<VoiceTier | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  /* ── fetch ──────────────────────────────────────────── */

  const fetchTranscripts = useCallback(
    async (opts: { offset?: number; append?: boolean; silent?: boolean } = {}) => {
      if (!tenantId) return;
      const { offset = 0, append = false, silent = false } = opts;

      if (!silent) setLoading(true);

      try {
        let query = supabase
          .from("voice_transcripts")
          .select("*")
          .eq("tenant_id", tenantId as string)
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        if (tierFilter) {
          query = query.eq("tier_used", tierFilter);
        }

        if (search.trim()) {
          query = query.ilike("intent_summary", `%${search.trim()}%`);
        }

        const { data, error } = await query;

        if (error) {
          console.error("VoiceLog fetch error:", error.message);
          return;
        }

        const records = (data as unknown as VoiceTranscriptRecord[]) ?? [];

        if (append) {
          setTranscripts((prev) => [...prev, ...records]);
        } else {
          setTranscripts(records);
        }

        setHasMore(records.length === PAGE_SIZE);
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [tenantId, tierFilter, search],
  );

  /* ── initial load + realtime ────────────────────────── */

  useEffect(() => {
    if (!tenantId) return;

    void fetchTranscripts();

    const channel = supabase
      .channel(`voice_log:mobile:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "voice_transcripts",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const newRecord = payload.new as unknown as VoiceTranscriptRecord;
          setTranscripts((prev) => [newRecord, ...prev]);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [tenantId, fetchTranscripts]);

  /* ── actions ────────────────────────────────────────── */

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchTranscripts({ silent: true });
  }, [fetchTranscripts]);

  const onLoadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    void fetchTranscripts({ offset: transcripts.length, append: true, silent: true });
  }, [loadingMore, hasMore, transcripts.length, fetchTranscripts]);

  const onSearch = useCallback(() => {
    void fetchTranscripts();
  }, [fetchTranscripts]);

  /* ── derived stats ──────────────────────────────────── */

  const { totalCount, avgLatency, breakdown } = computeStats(transcripts);
  const tier1Pct = breakdown.find((b) => b.tier === "tier1_rules")?.percentage ?? 0;
  const tier2Pct = breakdown.find((b) => b.tier === "tier2_cloud")?.percentage ?? 0;

  /* ── loading state ──────────────────────────────────── */

  if (loading && transcripts.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#D4A843" />
        <Text style={styles.loadingText}>Loading voice log...</Text>
      </View>
    );
  }

  /* ── render ─────────────────────────────────────────── */

  const ListHeader = (
    <>
      {/* ── Summary metric cards ──────────────────────── */}
      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Total Commands</Text>
          <Text style={styles.metricValue}>{totalCount}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Avg Latency</Text>
          <Text style={[styles.metricValue, { color: latencyColor(avgLatency) }]}>
            {avgLatency}ms
          </Text>
        </View>
      </View>
      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Tier 1 %</Text>
          <Text style={[styles.metricValue, { color: TIER_COLORS.tier1_rules }]}>
            {tier1Pct}%
          </Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Tier 2 %</Text>
          <Text style={[styles.metricValue, { color: TIER_COLORS.tier2_cloud }]}>
            {tier2Pct}%
          </Text>
        </View>
      </View>

      {/* ── Tier distribution bar ─────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tier Distribution</Text>
        <View style={styles.tierBar}>
          {breakdown.map((b) => {
            const width = `${Math.max(b.percentage, 2)}%` as `${number}%`;
            return (
              <View
                key={b.tier}
                style={[
                  styles.tierBarSegment,
                  { width, backgroundColor: TIER_COLORS[b.tier] },
                ]}
              >
                {b.percentage > 10 && (
                  <Text style={styles.tierBarLabel}>{b.percentage}%</Text>
                )}
              </View>
            );
          })}
        </View>
        <View style={styles.tierLegend}>
          {breakdown.map((b) => (
            <View key={b.tier} style={styles.tierLegendItem}>
              <View
                style={[styles.tierLegendDot, { backgroundColor: TIER_COLORS[b.tier] }]}
              />
              <Text style={styles.tierLegendText}>
                {TIER_LABELS[b.tier]}: {b.count}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Search filter ─────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.searchRow}>
          <View style={styles.searchInputWrap}>
            <Ionicons name="search" size={18} color="#94a3b8" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by intent..."
              placeholderTextColor="#94a3b8"
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={onSearch}
              returnKeyType="search"
            />
          </View>
          <TouchableOpacity style={styles.searchButton} onPress={onSearch}>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Tier filter pills ─────────────────────────── */}
      <View style={styles.pillRow}>
        <TouchableOpacity
          style={[styles.pill, !tierFilter && styles.pillActive]}
          onPress={() => setTierFilter(null)}
        >
          <Text style={[styles.pillText, !tierFilter && styles.pillTextActive]}>All</Text>
        </TouchableOpacity>
        {ALL_TIERS.map((tier) => (
          <TouchableOpacity
            key={tier}
            style={[
              styles.pill,
              tierFilter === tier && {
                backgroundColor: TIER_COLORS[tier],
                borderColor: TIER_COLORS[tier],
              },
            ]}
            onPress={() => setTierFilter(tierFilter === tier ? null : tier)}
          >
            <Text
              style={[styles.pillText, tierFilter === tier && styles.pillTextActive]}
            >
              {TIER_LABELS[tier]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );

  const renderItem = ({ item }: { item: VoiceTranscriptRecord }) => (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.rowTime}>{formatTime(item.created_at)}</Text>
        <View
          style={[
            styles.tierBadge,
            { backgroundColor: TIER_COLORS[item.tier_used] + "1a", borderColor: TIER_COLORS[item.tier_used] },
          ]}
        >
          <Text style={[styles.tierBadgeText, { color: TIER_COLORS[item.tier_used] }]}>
            {TIER_LABELS[item.tier_used]}
          </Text>
        </View>
      </View>
      <Text style={styles.rowIntent} numberOfLines={2}>
        {item.intent_summary}
      </Text>
      <Text style={[styles.rowLatency, { color: latencyColor(item.latency_ms) }]}>
        {item.latency_ms}ms
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={transcripts}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Ionicons name="mic-off-outline" size={48} color="#cbd5e1" />
            <Text style={styles.emptyText}>No voice commands recorded yet</Text>
          </View>
        }
        ListFooterComponent={
          hasMore && transcripts.length > 0 ? (
            <TouchableOpacity style={styles.loadMoreButton} onPress={onLoadMore}>
              {loadingMore ? (
                <ActivityIndicator size="small" color="#D4A843" />
              ) : (
                <Text style={styles.loadMoreText}>Load more</Text>
              )}
            </TouchableOpacity>
          ) : null
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A843" />
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

/* ── styles ──────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDF6E3",
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#64748b",
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: "#94a3b8",
  },

  /* ── metric cards ───────────────────────────────────── */
  metricsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 16,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#64748b",
  },
  metricValue: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1a1a1a",
    marginTop: 4,
  },

  /* ── card ────────────────────────────────────────────── */
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 12,
  },

  /* ── tier distribution bar ──────────────────────────── */
  tierBar: {
    flexDirection: "row",
    height: 28,
    borderRadius: 14,
    overflow: "hidden",
  },
  tierBarSegment: {
    alignItems: "center",
    justifyContent: "center",
  },
  tierBarLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
  },
  tierLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 10,
    gap: 12,
  },
  tierLegendItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  tierLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  tierLegendText: {
    fontSize: 11,
    color: "#64748b",
  },

  /* ── search ──────────────────────────────────────────── */
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f1f5f9",
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 14,
    color: "#1a1a1a",
  },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#D4A843",
    alignItems: "center",
    justifyContent: "center",
  },

  /* ── tier filter pills ──────────────────────────────── */
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#fff",
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
    color: "#fff",
  },

  /* ── transcript row ──────────────────────────────────── */
  row: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginBottom: 8,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  rowTime: {
    fontSize: 11,
    color: "#94a3b8",
  },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  tierBadgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  rowIntent: {
    fontSize: 14,
    color: "#1a1a1a",
    marginBottom: 4,
  },
  rowLatency: {
    fontSize: 13,
    fontWeight: "600",
  },

  /* ── load more ───────────────────────────────────────── */
  loadMoreButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    marginTop: 4,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#D4A843",
  },
});
