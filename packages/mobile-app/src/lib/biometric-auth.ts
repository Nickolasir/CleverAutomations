/**
 * Biometric / Elevated Auth Library
 *
 * Wraps expo-local-authentication and manages elevated auth sessions
 * for accessing sensitive data (email content, nutrition health data).
 *
 * Flow:
 *   1. Check for existing valid elevated session (cached token)
 *   2. If none: prompt biometric auth (Face ID / fingerprint)
 *   3. On biometric success: sign a server challenge with device key (attestation)
 *   4. If biometrics unavailable: fall back to PIN input
 *   5. On success: call elevated-auth edge function to get session token
 *   6. Cache token in SecureStore with TTL
 *
 * NOTE: expo-local-authentication requires a dev build (EAS Build).
 * It will not work in Expo Go.
 */

import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";
import type {
  BiometricCapability,
  ElevatedAuthMethod,
  ElevatedAuthVerifyResponse,
  PinStatus,
} from "@clever/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_TOKEN_KEY = "elevated_auth_session_token";
const SESSION_EXPIRY_KEY = "elevated_auth_session_expiry";
const DEVICE_ID_KEY = "elevated_auth_device_id";
const DEVICE_PRIVATE_KEY_KEY = "elevated_auth_device_private_key";
const DEFAULT_SESSION_DURATION = 15; // minutes

// ---------------------------------------------------------------------------
// Biometric capability detection
// ---------------------------------------------------------------------------

export async function checkBiometricAvailability(): Promise<{
  available: boolean;
  capability: BiometricCapability;
}> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      return { available: false, capability: "none" };
    }

    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) {
      return { available: false, capability: "none" };
    }

    const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

    if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return { available: true, capability: "face_id" };
    }
    if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return { available: true, capability: "fingerprint" };
    }
    if (supportedTypes.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      return { available: true, capability: "iris" };
    }

    return { available: false, capability: "none" };
  } catch {
    return { available: false, capability: "none" };
  }
}

// ---------------------------------------------------------------------------
// Local biometric prompt
// ---------------------------------------------------------------------------

/**
 * Prompt the user for biometric authentication via the OS native dialog.
 * Returns true if authentication succeeded.
 */
export async function requestBiometricAuth(reason: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: "Use PIN instead",
      disableDeviceFallback: true, // We handle PIN fallback ourselves
      fallbackLabel: "Use PIN",
    });

    return result.success;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Device attestation key management (C1)
// ---------------------------------------------------------------------------

/** Get or generate a stable device ID for attestation */
async function getDeviceId(): Promise<string> {
  let deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = Crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

/** Check if this device has registered an attestation key pair */
export async function isDeviceRegistered(): Promise<boolean> {
  const privateKey = await SecureStore.getItemAsync(DEVICE_PRIVATE_KEY_KEY);
  return !!privateKey;
}

/**
 * Register this device for biometric attestation.
 * Generates an EC P-256 key pair, stores the private key in SecureStore
 * (OS keychain), and sends the public key to the server.
 *
 * Must be called once during initial biometric setup (before first use).
 */
export async function registerDevice(platform: "ios" | "android"): Promise<boolean> {
  try {
    const deviceId = await getDeviceId();

    // Generate EC P-256 key pair using Web Crypto API
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true, // extractable so we can export
      ["sign", "verify"],
    );

    // Export private key as JWK for SecureStore storage
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    await SecureStore.setItemAsync(DEVICE_PRIVATE_KEY_KEY, JSON.stringify(privateKeyJwk));

    // Export public key as SPKI/PEM for server storage
    const publicKeyBuffer = await crypto.subtle.exportKey("spki", keyPair.publicKey);
    const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer)));
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKeyBase64}\n-----END PUBLIC KEY-----`;

    // Register with server
    const { data, error } = await supabase.functions.invoke("elevated-auth?action=register-device", {
      body: {
        device_id: deviceId,
        public_key: publicKeyPem,
        platform,
        key_algorithm: "ES256",
      },
    });

    if (error || !data?.success) {
      // Clean up on failure
      await SecureStore.deleteItemAsync(DEVICE_PRIVATE_KEY_KEY);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Sign a server challenge with the device private key.
 * The private key is stored in SecureStore (OS keychain), which on iOS
 * requires biometric/passcode to access, and on Android requires device
 * credentials.
 */
async function signChallenge(challenge: string): Promise<string | null> {
  try {
    const privateKeyJson = await SecureStore.getItemAsync(DEVICE_PRIVATE_KEY_KEY);
    if (!privateKeyJson) return null;

    const privateKeyJwk = JSON.parse(privateKeyJson);
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      privateKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );

    const challengeBytes = new TextEncoder().encode(challenge);
    const signatureBuffer = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      challengeBytes,
    );

    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

    // Return in challenge.signature format
    return `${challenge}.${signatureBase64}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Elevated session management
// ---------------------------------------------------------------------------

/** Check if there's a valid cached elevated session */
export async function getElevatedSession(): Promise<string | null> {
  try {
    const token = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
    const expiry = await SecureStore.getItemAsync(SESSION_EXPIRY_KEY);

    if (!token || !expiry) return null;

    // Check if expired
    if (new Date(expiry) <= new Date()) {
      await clearElevatedSession();
      return null;
    }

    // Validate server-side (session may have been revoked) — M4 fix: use query param
    const { data } = await supabase.functions.invoke("elevated-auth?action=check", {
      method: "POST",
      body: { session_token: token },
    });

    if (data?.success && data?.data?.valid) {
      return token;
    }

    await clearElevatedSession();
    return null;
  } catch {
    return null;
  }
}

/** Store an elevated session token */
async function cacheElevatedSession(token: string, expiresAt: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
  await SecureStore.setItemAsync(SESSION_EXPIRY_KEY, expiresAt);
}

/** Clear the cached elevated session */
export async function clearElevatedSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  await SecureStore.deleteItemAsync(SESSION_EXPIRY_KEY);
}

// ---------------------------------------------------------------------------
// Server-side session creation
// ---------------------------------------------------------------------------

async function createServerSession(
  method: ElevatedAuthMethod,
  credentialData?: string,
  durationMinutes = DEFAULT_SESSION_DURATION,
  deviceId?: string,
  signedChallenge?: string,
): Promise<ElevatedAuthVerifyResponse | null> {
  try {
    const { data, error } = await supabase.functions.invoke("elevated-auth?action=verify", {
      body: {
        method,
        credential_data: credentialData,
        duration_minutes: durationMinutes,
        device_id: deviceId,
        signed_challenge: signedChallenge,
      },
    });

    if (error || !data?.success) {
      console.error("Failed to create elevated session:", error || data?.error);
      return null;
    }

    return data.data as ElevatedAuthVerifyResponse;
  } catch (err) {
    console.error("Elevated auth error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// PIN helpers
// ---------------------------------------------------------------------------

export async function getPinStatus(): Promise<PinStatus> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "elevated-auth?action=pin-status",
      { method: "GET" },
    );

    if (error || !data?.success) {
      return { has_pin: false, is_locked: false, locked_until: null };
    }

    return data.data as PinStatus;
  } catch {
    return { has_pin: false, is_locked: false, locked_until: null };
  }
}

export async function setupPin(
  pin: string,
  currentPin?: string,
  sessionToken?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("elevated-auth?action=set-pin", {
      body: {
        pin,
        current_pin: currentPin,
        session_token: sessionToken,
      },
    });

    if (error || !data?.success) {
      return { success: false, error: data?.error || "Failed to set PIN" };
    }

    return { success: true };
  } catch {
    return { success: false, error: "Network error" };
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator: requireElevatedAuth
// ---------------------------------------------------------------------------

export interface ElevatedAuthResult {
  success: boolean;
  sessionToken?: string;
  method?: ElevatedAuthMethod;
  error?: string;
  /** True if the user needs to set up a PIN (no biometrics, no PIN) */
  needsPinSetup?: boolean;
  /** True if the device needs to be registered for biometric attestation */
  needsDeviceRegistration?: boolean;
}

/**
 * Orchestrates elevated authentication:
 *   1. Check for existing valid session
 *   2. Try biometric auth if available (with device attestation)
 *   3. Fall back to PIN if biometrics unavailable/failed
 *   4. Returns session token on success
 *
 * The caller should show a PIN input UI if result.needsPinSetup is true,
 * or if the user's device has no biometric hardware.
 */
export async function requireElevatedAuth(
  reason: string,
  durationMinutes = DEFAULT_SESSION_DURATION,
): Promise<ElevatedAuthResult> {
  // 1. Check existing session
  const existingToken = await getElevatedSession();
  if (existingToken) {
    return { success: true, sessionToken: existingToken, method: "biometric" };
  }

  // 2. Try biometric auth
  const biometricInfo = await checkBiometricAvailability();

  if (biometricInfo.available) {
    // Check if device is registered for attestation
    if (!await isDeviceRegistered()) {
      return {
        success: false,
        needsDeviceRegistration: true,
        error: "Device needs to be registered for biometric authentication",
      };
    }

    const biometricSuccess = await requestBiometricAuth(reason);

    if (biometricSuccess) {
      const deviceId = await getDeviceId();

      // Get a challenge nonce from the server
      const { data: challengeData } = await supabase.functions.invoke(
        "elevated-auth?action=challenge",
        { body: { device_id: deviceId } },
      );

      if (!challengeData?.success || !challengeData?.data?.challenge) {
        return { success: false, error: "Failed to get attestation challenge" };
      }

      // Sign the challenge with the device private key
      const signed = await signChallenge(challengeData.data.challenge);
      if (!signed) {
        return { success: false, error: "Failed to sign attestation challenge" };
      }

      const session = await createServerSession(
        "biometric",
        undefined,
        durationMinutes,
        deviceId,
        signed,
      );

      if (session) {
        await cacheElevatedSession(session.session_token, session.expires_at);
        return {
          success: true,
          sessionToken: session.session_token,
          method: "biometric",
        };
      }
      return { success: false, error: "Failed to create session after biometric verification" };
    }

    // Biometric failed/cancelled — fall through to PIN
  }

  // 3. Check if user has a PIN set up
  const pinStatus = await getPinStatus();

  if (!pinStatus.has_pin) {
    // No biometrics and no PIN — user needs to set up a PIN first
    return {
      success: false,
      needsPinSetup: true,
      error: "Please set up a PIN to access this feature",
    };
  }

  if (pinStatus.is_locked) {
    return {
      success: false,
      error: "PIN is temporarily locked due to too many failed attempts",
    };
  }

  // 4. PIN auth — caller must show PIN input UI and call verifyWithPin()
  return {
    success: false,
    error: "PIN required",
    needsPinSetup: false,
  };
}

/**
 * Verify with PIN after the user enters it in the UI.
 * Call this from the PIN input modal's submit handler.
 */
export async function verifyWithPin(
  pin: string,
  durationMinutes = DEFAULT_SESSION_DURATION,
): Promise<ElevatedAuthResult> {
  const session = await createServerSession("pin", pin, durationMinutes);

  if (session) {
    await cacheElevatedSession(session.session_token, session.expires_at);
    return {
      success: true,
      sessionToken: session.session_token,
      method: "pin",
    };
  }

  return { success: false, error: "Invalid PIN" };
}

/**
 * Revoke all elevated sessions for the current user.
 * Call on logout or when the user explicitly locks sensitive data.
 */
export async function revokeElevatedAuth(): Promise<void> {
  try {
    await supabase.functions.invoke("elevated-auth?action=revoke", {
      body: {},
    });
  } catch {
    // Best effort
  }
  await clearElevatedSession();
}
