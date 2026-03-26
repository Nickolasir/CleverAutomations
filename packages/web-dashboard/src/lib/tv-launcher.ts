/**
 * TV Dashboard Launcher — opens the TV dashboard on the Samsung TV
 * without needing the remote.
 *
 * Flow:
 * 1. Send Wake-on-LAN magic packet (in case TV is in standby)
 * 2. Wait briefly for TV to wake
 * 3. Call HA media_player.play_media with the dashboard URL
 *    → Samsung TV opens its built-in browser to that URL
 *
 * Works because:
 * - The Samsung UN65NU6900 is integrated via HA's samsungtv component
 * - HA's play_media with content_type "url" opens the TV browser
 * - WoL server is on the same host, accessible from the LAN
 */

const HA_URL = process.env.NEXT_PUBLIC_HA_URL ?? "";
const HA_TOKEN = process.env.NEXT_PUBLIC_HA_TOKEN ?? "";

/** The Samsung TV entity in Home Assistant */
const TV_ENTITY_ID = "media_player.samsung_6_series_65_un65nu6900";

/** MAC address for Wake-on-LAN */
const TV_MAC = "fc:03:9f:3d:f8:e0";

/** WoL server runs on same host as HA, port 9199 */
const WOL_SERVER = HA_URL.replace(/:8123$/, ":9199");

async function haFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${HA_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${HA_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

/** Send WoL magic packet to wake the TV */
async function wakeTV(): Promise<boolean> {
  try {
    const res = await fetch(`${WOL_SERVER}/wol`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mac: TV_MAC }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Check if the TV is currently on */
async function isTVOn(): Promise<boolean> {
  try {
    const res = await haFetch(`/api/states/${TV_ENTITY_ID}`);
    if (!res.ok) return false;
    const state = await res.json();
    return state.state !== "off" && state.state !== "unavailable";
  } catch {
    return false;
  }
}

/** Open a URL in the TV browser via HA play_media */
async function openURLOnTV(url: string): Promise<boolean> {
  try {
    const res = await haFetch("/api/services/media_player/play_media", {
      method: "POST",
      body: JSON.stringify({
        entity_id: TV_ENTITY_ID,
        media_content_type: "url",
        media_content_id: url,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Delay helper */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LaunchResult {
  success: boolean;
  message: string;
}

/**
 * Launch the TV dashboard on the Samsung TV.
 * Handles waking the TV and opening the browser to the dashboard URL.
 *
 * @param dashboardUrl - Full URL to the TV dashboard (e.g., http://10.0.0.44:3000/tv)
 */
export async function launchTVDashboard(dashboardUrl: string): Promise<LaunchResult> {
  if (!HA_URL || !HA_TOKEN) {
    return { success: false, message: "Home Assistant not configured" };
  }

  // Step 1: Check if TV is on
  const tvOn = await isTVOn();

  if (!tvOn) {
    // Step 2: Wake the TV
    const woke = await wakeTV();
    if (!woke) {
      return { success: false, message: "Failed to send Wake-on-LAN packet" };
    }

    // Wait for TV to boot (Samsung TVs take ~10-15s to wake from WoL)
    await sleep(12_000);

    // Verify it's on now
    const nowOn = await isTVOn();
    if (!nowOn) {
      return { success: false, message: "TV did not wake up. It may be fully powered off (WoL only works from standby)." };
    }
  }

  // Step 3: Open the dashboard URL
  // Brief delay after wake to let Samsung TV services initialize
  if (!tvOn) {
    await sleep(3_000);
  }

  const opened = await openURLOnTV(dashboardUrl);
  if (!opened) {
    return { success: false, message: "Failed to open URL on TV. The samsungtv integration may need reconnecting." };
  }

  return { success: true, message: tvOn ? "Dashboard opened on TV" : "TV woke up and dashboard opened" };
}

/**
 * Get the TV dashboard URL for the current host.
 * Uses the web dashboard's own origin so the TV hits the same server.
 */
export function getTVDashboardURL(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/tv`;
  }
  return "http://10.0.0.44:3000/tv";
}
