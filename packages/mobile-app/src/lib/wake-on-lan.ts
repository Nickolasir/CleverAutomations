/**
 * Wake-on-LAN client.
 *
 * Sends WoL requests to the host WoL server (not Docker HA,
 * since Docker can't send UDP broadcasts to the LAN).
 * The WoL server runs on the host at port 9199.
 */

// WoL server runs on the same host as HA, just different port
const WOL_SERVER = (process.env.EXPO_PUBLIC_HA_URL ?? "").replace(/:8123$/, ":9199");

/**
 * Known device MAC addresses for WoL.
 * In production, these come from the device registry in Supabase.
 */
const KNOWN_MACS: Record<string, string> = {
  "media_player.samsung_6_series_65_un65nu6900": "fc:03:9f:3d:f8:e0",
};

/**
 * Send a WoL magic packet to wake a device from standby.
 */
export async function wakeDevice(entityId: string): Promise<boolean> {
  const mac = KNOWN_MACS[entityId];
  if (!mac) return false;

  try {
    const res = await fetch(`${WOL_SERVER}/wol`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mac }),
    });

    if (res.ok) {
      console.log("[WoL] Sent magic packet to", mac);
      return true;
    }

    console.warn("[WoL] Server returned", res.status);
    return false;
  } catch (err) {
    console.error("[WoL] Failed:", err);
    return false;
  }
}

export function canWake(entityId: string): boolean {
  return entityId in KNOWN_MACS;
}

export function registerMac(entityId: string, mac: string): void {
  KNOWN_MACS[entityId] = mac;
}
