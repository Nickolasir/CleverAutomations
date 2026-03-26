"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Scene, TenantId } from "@clever/shared";
import { createBrowserClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Real-time scenes hook.
 * Fetches scenes for the tenant and provides activation via device_commands.
 */
interface UseScenesReturn {
  scenes: Scene[];
  loading: boolean;
  error: string | null;
  /** Activate a scene — inserts commands for all scene actions */
  activateScene: (sceneId: string) => Promise<void>;
  /** Currently activating scene ID (for UI feedback) */
  activatingId: string | null;
  refresh: () => Promise<void>;
}

export function useScenes(tenantId: TenantId | null): UseScenesReturn {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const supabase = createBrowserClient();

  const fetchScenes = useCallback(async () => {
    if (!tenantId) return;

    try {
      setError(null);
      const { data, error: fetchError } = await supabase
        .from("scenes")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("name");

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      setScenes((data as unknown as Scene[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch scenes");
    } finally {
      setLoading(false);
    }
  }, [tenantId, supabase]);

  useEffect(() => {
    if (!tenantId) return;

    void fetchScenes();

    const channel = supabase
      .channel(`scenes:tenant:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scenes",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          void fetchScenes();
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
  }, [tenantId, supabase, fetchScenes]);

  const activateScene = useCallback(
    async (sceneId: string) => {
      const scene = scenes.find((s) => s.id === sceneId);
      if (!scene || !tenantId) return;

      setActivatingId(sceneId);

      try {
        // Insert a command for each action in the scene
        const commands = scene.actions.map((action) => ({
          device_id: action.device_id,
          tenant_id: tenantId,
          action: action.action,
          parameters: action.parameters,
          source: "dashboard" as const,
        }));

        const { error: cmdError } = await supabase
          .from("device_commands")
          .insert(commands);

        if (cmdError) {
          throw new Error(cmdError.message);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to activate scene");
      } finally {
        // Brief delay so the user sees the activation feedback
        setTimeout(() => setActivatingId(null), 1200);
      }
    },
    [scenes, tenantId, supabase]
  );

  return {
    scenes,
    loading,
    error,
    activateScene,
    activatingId,
    refresh: fetchScenes,
  };
}
