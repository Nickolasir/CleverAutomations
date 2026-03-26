"use client";

import { useEffect, useState, useRef } from "react";
import type { DeviceStateChange, TenantId } from "@clever/shared";
import { createBrowserClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Recent activity feed for the TV dashboard.
 * Shows the last N device state changes in real-time.
 */

const MAX_ITEMS = 6;

const STATE_LABELS: Record<string, string> = {
  on: "turned on",
  off: "turned off",
  locked: "locked",
  unlocked: "unlocked",
};

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface TVAlertFeedProps {
  tenantId: TenantId | null;
  /** Optional map of device_id → device name for display */
  deviceNames?: Map<string, string>;
}

export function TVAlertFeed({ tenantId, deviceNames }: TVAlertFeedProps) {
  const [changes, setChanges] = useState<DeviceStateChange[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!tenantId) return;

    const supabase = createBrowserClient();

    // Fetch recent changes
    void (async () => {
      const { data } = await supabase
        .from("device_state_changes")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("timestamp", { ascending: false })
        .limit(MAX_ITEMS);

      if (data) {
        setChanges(data as unknown as DeviceStateChange[]);
      }
    })();

    // Subscribe to new changes
    const channel = supabase
      .channel(`state_changes:tv:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "device_state_changes",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const newChange = payload.new as unknown as DeviceStateChange;
          setChanges((prev) => [newChange, ...prev].slice(0, MAX_ITEMS));
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
  }, [tenantId]);

  if (changes.length === 0) {
    return (
      <div className="text-tv-muted text-lg py-4">
        No recent activity
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {changes.map((change) => {
        const deviceName = deviceNames?.get(change.device_id) ?? change.device_id;
        const action = STATE_LABELS[change.new_state] ?? change.new_state;

        return (
          <div
            key={change.id}
            className="flex items-center justify-between py-2 border-b border-tv-surface last:border-0"
          >
            <span className="text-lg text-tv-text">
              <span className="font-medium">{deviceName}</span>{" "}
              <span className="text-tv-muted">{action}</span>
            </span>
            <span className="text-base text-tv-muted tabular-nums">
              {timeAgo(change.timestamp)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
