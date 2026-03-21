"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type {
  VoiceTranscriptRecord,
  VoiceTier,
  TenantId,
} from "@clever/shared";
import { createBrowserClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Real-time voice log hook.
 * Subscribes to the voice_transcripts table and provides
 * searchable transcript history, latency metrics, and tier breakdown.
 */
interface VoiceLogFilters {
  search?: string;
  tier?: VoiceTier;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

interface TierStats {
  tier: VoiceTier;
  count: number;
  avgLatencyMs: number;
  percentage: number;
}

interface UseVoiceLogReturn {
  transcripts: VoiceTranscriptRecord[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  avgLatencyMs: number;
  tierBreakdown: TierStats[];
  /** Apply filters and refresh */
  applyFilters: (filters: VoiceLogFilters) => Promise<void>;
  /** Load more transcripts (pagination) */
  loadMore: () => Promise<void>;
  hasMore: boolean;
}

const PAGE_SIZE = 50;

export function useVoiceLog(tenantId: TenantId | null): UseVoiceLogReturn {
  const [transcripts, setTranscripts] = useState<VoiceTranscriptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFilters] = useState<VoiceLogFilters>({});
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const supabase = createBrowserClient();

  /** Fetch voice transcripts with optional filters */
  const fetchTranscripts = useCallback(
    async (currentFilters: VoiceLogFilters, currentOffset: number, append = false) => {
      if (!tenantId) return;

      try {
        setError(null);
        const limit = currentFilters.limit ?? PAGE_SIZE;

        let query = supabase
          .from("voice_transcripts")
          .select("*", { count: "exact" })
          .eq("tenant_id", tenantId as string)
          .order("created_at", { ascending: false })
          .range(currentOffset, currentOffset + limit - 1);

        if (currentFilters.tier) {
          query = query.eq("tier_used", currentFilters.tier);
        }

        if (currentFilters.dateFrom) {
          query = query.gte("created_at", currentFilters.dateFrom);
        }

        if (currentFilters.dateTo) {
          query = query.lte("created_at", currentFilters.dateTo);
        }

        if (currentFilters.search) {
          query = query.ilike("intent_summary", `%${currentFilters.search}%`);
        }

        const { data, count, error: fetchError } = await query;

        if (fetchError) {
          setError(fetchError.message);
          return;
        }

        const records = (data as unknown as VoiceTranscriptRecord[]) ?? [];

        if (append) {
          setTranscripts((prev) => [...prev, ...records]);
        } else {
          setTranscripts(records);
        }

        setTotalCount(count ?? 0);
        setHasMore(records.length === limit);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch voice log");
      } finally {
        setLoading(false);
      }
    },
    [tenantId, supabase]
  );

  /** Subscribe to real-time new transcripts */
  useEffect(() => {
    if (!tenantId) return;

    void fetchTranscripts(filters, 0);

    const channel = supabase
      .channel(`voice_log:tenant:${tenantId}`)
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
          setTotalCount((prev) => prev + 1);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [tenantId, supabase, filters, fetchTranscripts]);

  /** Apply new filters */
  const applyFilters = useCallback(
    async (newFilters: VoiceLogFilters) => {
      setFilters(newFilters);
      setOffset(0);
      setLoading(true);
      await fetchTranscripts(newFilters, 0);
    },
    [fetchTranscripts]
  );

  /** Load more (pagination) */
  const loadMore = useCallback(async () => {
    const newOffset = offset + PAGE_SIZE;
    setOffset(newOffset);
    await fetchTranscripts(filters, newOffset, true);
  }, [offset, filters, fetchTranscripts]);

  /** Compute latency stats */
  const avgLatencyMs =
    transcripts.length > 0
      ? Math.round(
          transcripts.reduce((sum, t) => sum + t.latency_ms, 0) / transcripts.length
        )
      : 0;

  /** Compute tier breakdown */
  const tierBreakdown: TierStats[] = (
    ["tier1_rules", "tier2_cloud", "tier3_local"] as VoiceTier[]
  ).map((tier) => {
    const tierRecords = transcripts.filter((t) => t.tier_used === tier);
    return {
      tier,
      count: tierRecords.length,
      avgLatencyMs:
        tierRecords.length > 0
          ? Math.round(
              tierRecords.reduce((sum, t) => sum + t.latency_ms, 0) /
                tierRecords.length
            )
          : 0,
      percentage:
        transcripts.length > 0
          ? Math.round((tierRecords.length / transcripts.length) * 100)
          : 0,
    };
  });

  return {
    transcripts,
    loading,
    error,
    totalCount,
    avgLatencyMs,
    tierBreakdown,
    applyFilters,
    loadMore,
    hasMore,
  };
}
