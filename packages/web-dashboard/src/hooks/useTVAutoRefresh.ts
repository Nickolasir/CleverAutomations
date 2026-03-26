"use client";

import { useEffect, useRef, useCallback } from "react";

/**
 * Auto-refresh hook for always-on TV display.
 * Periodically calls refresh callbacks as a safety net in case
 * Supabase Realtime WebSocket misses events (e.g., after TV browser idle/sleep).
 * Also handles page visibility changes — triggers immediate refresh on wake.
 */
interface AutoRefreshCallbacks {
  /** Refresh device data (every 60s) */
  refreshDevices?: () => Promise<void>;
  /** Refresh scene data (every 120s) */
  refreshScenes?: () => Promise<void>;
}

const DEVICE_INTERVAL = 60_000;
const SCENE_INTERVAL = 120_000;

export function useTVAutoRefresh(callbacks: AutoRefreshCallbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const refreshAll = useCallback(async () => {
    await Promise.all([
      callbacksRef.current.refreshDevices?.(),
      callbacksRef.current.refreshScenes?.(),
    ]);
  }, []);

  useEffect(() => {
    // Periodic device refresh
    const deviceTimer = setInterval(() => {
      void callbacksRef.current.refreshDevices?.();
    }, DEVICE_INTERVAL);

    // Periodic scene refresh (less frequent)
    const sceneTimer = setInterval(() => {
      void callbacksRef.current.refreshScenes?.();
    }, SCENE_INTERVAL);

    return () => {
      clearInterval(deviceTimer);
      clearInterval(sceneTimer);
    };
  }, []);

  // Refresh immediately when page becomes visible again (TV wakes from idle)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshAll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [refreshAll]);
}
