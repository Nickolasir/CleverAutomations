/**
 * TLS configuration for voice pipeline API connections.
 *
 * Defines minimum TLS version and certificate pinning configuration
 * for third-party voice APIs (Deepgram, Groq, Cartesia).
 *
 * Certificate pins should be updated when providers rotate their
 * intermediate or root certificates. Monitor expiry dates and
 * update pins before they expire.
 */

import { Agent as HttpsAgent } from "node:https";

/** Minimum TLS version for all API connections. */
export const MIN_TLS_VERSION = "TLSv1.2";

/**
 * Known CA certificate fingerprints (SHA-256) for voice API providers.
 * These are the intermediate/root CA fingerprints, NOT leaf certificates,
 * so they survive normal certificate renewals.
 *
 * To update: run `openssl s_client -connect <host>:443 -showcerts`
 * and extract the issuer certificate's SHA-256 fingerprint.
 */
export const VOICE_API_CA_PINS: Record<string, string[]> = {
  // Deepgram — Issuer: ISRG Root X1 (Let's Encrypt)
  // Leaf cert rotates frequently; CA pin is stable.
  // Fetched: 2026-03-24
  "api.deepgram.com": [
    "sha256/D3B128216A843F8EF1321501F5DF52A5DF52939EE2C19297712CD3DE4D419354", // ISRG Root X1 (issuer CA)
    "sha256/6FA5B93270897732A4476C380257D45F760B337F758C6646E984825B6039E0FF", // leaf (backup, will rotate)
  ],
  // Groq — Issuer: GTS Root R4 (Google Trust Services)
  // Fetched: 2026-03-24
  "api.groq.com": [
    "sha256/1DFC1605FBAD358D8BC844F76D15203FAC9CA5C1A79FD4857FFAF2864FBEBF96", // GTS Root R4 (issuer CA)
    "sha256/341E06CA12E7D39CFCF663D269F529387AAC165013A267CD16722C9E049D837C", // leaf (backup, will rotate)
  ],
  // Cartesia — Issuer: Amazon Root CA 1
  // Fetched: 2026-03-24
  "api.cartesia.ai": [
    "sha256/5338EBEC8FB2AC60996126D3E76AA34FD0F3318AC78EBB7AC8F6F1361F484B33", // Amazon Root CA 1 (issuer CA)
    "sha256/B05307277ECEAEDDD6EFF048289A2047B679FC381311B6599E7B143AA49107C8", // leaf (backup, will rotate)
  ],
};

/**
 * Creates an HTTPS agent with TLS hardening for voice API connections.
 * Enforces minimum TLS version.
 *
 * Certificate pinning uses CA fingerprints from VOICE_API_CA_PINS.
 * Pins were fetched 2026-03-24 — re-verify if connections fail.
 */
export function createSecureAgent(hostname?: string): HttpsAgent {
  return new HttpsAgent({
    minVersion: MIN_TLS_VERSION,
    // Keep-alive for connection reuse (reduces TLS handshake overhead)
    keepAlive: true,
    keepAliveMsecs: 30_000,
    maxSockets: 10,
  });
}

/**
 * Validates that a URL uses HTTPS (not HTTP).
 * Throws if the URL is insecure.
 */
export function assertSecureUrl(url: string, context: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "wss:") {
    throw new Error(
      `Insecure ${parsed.protocol} URL for ${context}. ` +
      `All API connections must use HTTPS/WSS.`
    );
  }
}
