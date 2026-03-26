"use client";

import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDevices } from "@/hooks/useDevices";
import { useVoiceLog } from "@/hooks/useVoiceLog";
import { useScenes } from "@/hooks/useScenes";
import { useTVAutoRefresh } from "@/hooks/useTVAutoRefresh";
import { TVMetricCard } from "@/components/tv/TVMetricCard";
import { TVDeviceCard } from "@/components/tv/TVDeviceCard";
import { TVSceneCard } from "@/components/tv/TVSceneCard";
import { TVAlertFeed } from "@/components/tv/TVAlertFeed";
import type { DeviceCategory } from "@clever/shared";

/**
 * TV Dashboard Home — the main always-on view.
 *
 * Layout:
 * - Top row: summary metric cards (total, online, active, climate temp)
 * - Middle: device grid with toggle support
 * - Bottom left: quick scene buttons
 * - Bottom right: recent activity feed
 */

export default function TVDashboardPage() {
  const { tenantId } = useAuth();
  const {
    devices,
    loading: devicesLoading,
    toggleDevice,
    refresh: refreshDevices,
  } = useDevices(tenantId);
  const { totalCount: voiceCount, avgLatencyMs } = useVoiceLog(tenantId);
  const {
    scenes,
    activateScene,
    activatingId,
    refresh: refreshScenes,
  } = useScenes(tenantId);

  // Auto-refresh for always-on display
  useTVAutoRefresh({
    refreshDevices,
    refreshScenes,
  });

  // Compute summary metrics
  const metrics = useMemo(() => {
    const total = devices.length;
    const online = devices.filter((d) => d.is_online).length;
    const active = devices.filter(
      (d) => d.state === "on" || d.state === "unlocked"
    ).length;

    // Find climate/thermostat temperature
    const climate = devices.find(
      (d) =>
        (d.category === "climate" || d.category === "thermostat") &&
        d.is_online
    );
    const temperature = climate?.attributes?.current_temperature as
      | number
      | undefined;

    return { total, online, active, temperature };
  }, [devices]);

  // Build device name map for the alert feed
  const deviceNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of devices) {
      map.set(d.id, d.name);
    }
    return map;
  }, [devices]);

  // Sort devices: online first, then by room, then by name
  const sortedDevices = useMemo(
    () =>
      [...devices].sort((a, b) => {
        if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
        if (a.room !== b.room) return a.room.localeCompare(b.room);
        return a.name.localeCompare(b.name);
      }),
    [devices]
  );

  if (devicesLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-tv-surface border-t-tv-focus" />
          <p className="text-xl text-tv-muted">Loading devices...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Metric cards row */}
      <section className="flex gap-6 flex-wrap">
        <TVMetricCard label="Devices" value={metrics.total} />
        <TVMetricCard
          label="Online"
          value={metrics.online}
          valueColor="#22c55e"
        />
        <TVMetricCard
          label="Active"
          value={metrics.active}
          valueColor="#D4A843"
        />
        {metrics.temperature != null && (
          <TVMetricCard
            label="Climate"
            value={metrics.temperature}
            suffix="°F"
          />
        )}
        {voiceCount > 0 && (
          <TVMetricCard
            label="Voice Cmds"
            value={voiceCount}
          />
        )}
        {avgLatencyMs > 0 && (
          <TVMetricCard
            label="Avg Latency"
            value={avgLatencyMs}
            suffix="ms"
          />
        )}
      </section>

      {/* Device grid */}
      <section>
        <h2 className="text-2xl font-bold text-tv-text mb-4">Devices</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
          {sortedDevices.map((device) => (
            <TVDeviceCard
              key={device.id}
              device={device}
              onToggle={(id) => void toggleDevice(id as never)}
            />
          ))}
        </div>
        {devices.length === 0 && (
          <p className="text-xl text-tv-muted py-8 text-center">
            No devices found. Add devices via Home Assistant.
          </p>
        )}
      </section>

      {/* Bottom section: scenes + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Quick scenes */}
        <section>
          <h2 className="text-2xl font-bold text-tv-text mb-4">
            Quick Scenes
          </h2>
          {scenes.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {scenes.map((scene) => (
                <TVSceneCard
                  key={scene.id}
                  scene={scene}
                  isActivating={activatingId === scene.id}
                  onActivate={(id) => void activateScene(id)}
                />
              ))}
            </div>
          ) : (
            <p className="text-lg text-tv-muted">
              No scenes configured. Create scenes in the dashboard.
            </p>
          )}
        </section>

        {/* Recent activity */}
        <section>
          <h2 className="text-2xl font-bold text-tv-text mb-4">
            Recent Activity
          </h2>
          <TVAlertFeed tenantId={tenantId} deviceNames={deviceNames} />
        </section>
      </div>
    </div>
  );
}
