/**
 * Elevated Auth Edge Function
 *
 * Manages biometric/PIN elevated authentication sessions for accessing
 * sensitive data (email content, nutrition health data).
 *
 * Endpoints:
 *   POST /functions/v1/elevated-auth?action=verify          — verify biometric/PIN, create session
 *   POST /functions/v1/elevated-auth?action=check           — check if session is still valid
 *   POST /functions/v1/elevated-auth?action=revoke          — revoke active sessions
 *   POST /functions/v1/elevated-auth?action=set-pin         — set or update PIN (requires elevated session or current PIN)
 *   GET  /functions/v1/elevated-auth?action=pin-status      — check if user has a PIN set
 *   POST /functions/v1/elevated-auth?action=register-device — register device public key for biometric attestation
 *   POST /functions/v1/elevated-auth?action=challenge        — get a nonce for biometric attestation
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - PIN verification runs server-side (bcrypt)
 *   - Biometric verification requires device attestation (signed challenge-response)
 *   - Session tokens returned once, stored as SHA-256 hash server-side
 *   - Brute-force protection: 5 failed PIN attempts → 15 min lockout
 *   - Rate limiting: 10 requests/minute per user per action
 *   - All failed auth attempts are audit-logged
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TenantId, UserId, ApiResult } from "@clever/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuthAction =
  | "verify"
  | "check"
  | "revoke"
  | "set-pin"
  | "pin-status"
  | "register-device"
  | "challenge";

interface VerifyBody {
  method: "biometric" | "pin" | "device_passcode";
  credential_data?: string;
  duration_minutes?: number;
  device_id?: string;
  signed_challenge?: string;
}

interface CheckBody {
  session_token: string;
}

interface SetPinBody {
  pin: string;
  current_pin?: string;
  session_token?: string;
}

interface RegisterDeviceBody {
  device_id: string;
  public_key: string;
  platform: "ios" | "android";
  key_algorithm?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").filter(Boolean);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

// In-memory rate limit store (per-isolate; resets on cold start — acceptable
// for edge functions since Supabase isolates are short-lived)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders(origin?: string | null): Record<string, string> {
  // If ALLOWED_ORIGINS is configured, restrict to those origins (C4).
  // Falls back to wildcard only if no origins are configured (dev mode).
  let allowedOrigin = ALLOWED_ORIGINS.length === 0 ? "*" : "";
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    allowedOrigin = origin;
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...(allowedOrigin !== "*" ? { Vary: "Origin" } : {}),
  };
}

function jsonResponse<T>(data: ApiResult<T>, status = 200, origin?: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400, origin?: string | null): Response {
  return jsonResponse({ success: false, error: message }, status, origin);
}

// ---------------------------------------------------------------------------
// Rate limiting (H3)
// ---------------------------------------------------------------------------

function checkRateLimit(userId: string, action: string): { allowed: boolean; retryAfterMs: number } {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, retryAfterMs: 0 };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function getSupabaseAdmin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ---------------------------------------------------------------------------
// Audit logging helper (H1)
// ---------------------------------------------------------------------------

async function auditLog(
  admin: SupabaseClient,
  tenantId: string,
  userId: string,
  action: "elevated_auth_success" | "elevated_auth_failed" | "pin_lockout",
  details: Record<string, unknown>,
): Promise<void> {
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    user_id: userId,
    action,
    details,
  }).catch(() => { /* best-effort audit logging */ });
}

// ---------------------------------------------------------------------------
// Device attestation verification (C1)
// ---------------------------------------------------------------------------

async function verifyDeviceAttestation(
  admin: SupabaseClient,
  userId: string,
  tenantId: string,
  deviceId: string,
  signedChallenge: string,
): Promise<boolean> {
  // 1. Look up the device's public key
  const { data: deviceKey, error: keyError } = await admin
    .from("user_device_attestation_keys")
    .select("public_key, key_algorithm")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("device_id", deviceId)
    .is("revoked_at", null)
    .single();

  if (keyError || !deviceKey) {
    return false;
  }

  // 2. Consume the challenge (ensures it's valid + single-use)
  const { data: challengeValid } = await admin.rpc("consume_attestation_challenge", {
    p_user_id: userId,
    p_tenant_id: tenantId,
    p_device_id: deviceId,
    p_challenge: signedChallenge.split(".")[0] ?? "", // challenge.signature format
  });

  if (!challengeValid) {
    return false;
  }

  // 3. Verify the signature using Web Crypto API
  try {
    const [challenge, signatureB64] = signedChallenge.split(".");
    if (!challenge || !signatureB64) return false;

    const publicKeyPem = deviceKey.public_key;
    const algorithm = deviceKey.key_algorithm === "ES256"
      ? { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" }
      : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

    // Import the public key from PEM
    const pemBody = publicKeyPem
      .replace(/-----BEGIN PUBLIC KEY-----/, "")
      .replace(/-----END PUBLIC KEY-----/, "")
      .replace(/\s/g, "");
    const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      keyBytes.buffer,
      algorithm,
      false,
      ["verify"],
    );

    const signatureBytes = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    const challengeBytes = new TextEncoder().encode(challenge);

    return await crypto.subtle.verify(
      algorithm.name === "ECDSA" ? { name: "ECDSA", hash: "SHA-256" } : algorithm,
      cryptoKey,
      signatureBytes,
      challengeBytes,
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleChallenge(
  admin: SupabaseClient,
  userId: string,
  tenantId: string,
  body: { device_id?: string },
  origin?: string | null,
): Promise<Response> {
  if (!body.device_id) {
    return errorResponse("device_id is required", 400, origin);
  }

  // Verify the device is registered
  const { data: device } = await admin
    .from("user_device_attestation_keys")
    .select("id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("device_id", body.device_id)
    .is("revoked_at", null)
    .single();

  if (!device) {
    return errorResponse("Device not registered", 404, origin);
  }

  const { data: challenge, error } = await admin.rpc("create_attestation_challenge", {
    p_user_id: userId,
    p_tenant_id: tenantId,
    p_device_id: body.device_id,
  });

  if (error || !challenge) {
    return errorResponse("Failed to create challenge", 500, origin);
  }

  return jsonResponse({ success: true, data: { challenge } }, 200, origin);
}

async function handleRegisterDevice(
  admin: SupabaseClient,
  userId: string,
  tenantId: string,
  body: RegisterDeviceBody,
  origin?: string | null,
): Promise<Response> {
  if (!body.device_id || !body.public_key || !body.platform) {
    return errorResponse("device_id, public_key, and platform are required", 400, origin);
  }

  if (!["ios", "android"].includes(body.platform)) {
    return errorResponse("platform must be 'ios' or 'android'", 400, origin);
  }

  const { error } = await admin
    .from("user_device_attestation_keys")
    .upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        device_id: body.device_id,
        public_key: body.public_key,
        platform: body.platform,
        key_algorithm: body.key_algorithm || "ES256",
        revoked_at: null,
      },
      { onConflict: "tenant_id,user_id,device_id" },
    );

  if (error) {
    return errorResponse("Failed to register device", 500, origin);
  }

  return jsonResponse({ success: true, data: { message: "Device registered" } }, 200, origin);
}

async function handleVerify(
  userId: string,
  tenantId: string,
  body: VerifyBody,
  origin?: string | null,
): Promise<Response> {
  const { method, credential_data, duration_minutes = 15 } = body;

  if (!["biometric", "pin", "device_passcode"].includes(method)) {
    return errorResponse("Invalid auth method", 400, origin);
  }

  if (duration_minutes < 1 || duration_minutes > 30) {
    return errorResponse("Duration must be between 1 and 30 minutes", 400, origin);
  }

  const admin = getSupabaseAdmin();

  // For PIN: verify server-side
  if (method === "pin") {
    if (!credential_data || !/^\d{4,6}$/.test(credential_data)) {
      return errorResponse("PIN must be 4-6 digits", 400, origin);
    }

    const { data: pinValid, error: pinError } = await admin.rpc("verify_user_pin", {
      p_user_id: userId,
      p_tenant_id: tenantId,
      p_pin: credential_data,
    });

    if (pinError) {
      return errorResponse("PIN verification failed", 500, origin);
    }

    if (!pinValid) {
      const { data: pinCred } = await admin
        .from("user_pin_credentials")
        .select("locked_until, failed_attempts")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .single();

      if (pinCred?.locked_until && new Date(pinCred.locked_until) > new Date()) {
        // Audit log lockout (H1)
        await auditLog(admin, tenantId, userId, "pin_lockout", { method });
        // Generic message — no exact time (M1)
        return errorResponse("PIN temporarily locked due to too many failed attempts", 429, origin);
      }

      // Audit log failed attempt (H1)
      await auditLog(admin, tenantId, userId, "elevated_auth_failed", {
        method,
        attempts_remaining: 5 - (pinCred?.failed_attempts ?? 0),
      });

      return errorResponse("Incorrect PIN", 401, origin);
    }
  }

  // For biometric / device_passcode: require device attestation (C1)
  if (method === "biometric" || method === "device_passcode") {
    if (!body.device_id || !body.signed_challenge) {
      return errorResponse(
        "device_id and signed_challenge are required for biometric/device_passcode verification",
        400,
        origin,
      );
    }

    const attestationValid = await verifyDeviceAttestation(
      admin,
      userId,
      tenantId,
      body.device_id,
      body.signed_challenge,
    );

    if (!attestationValid) {
      // Audit log failed attempt (H1)
      await auditLog(admin, tenantId, userId, "elevated_auth_failed", {
        method,
        reason: "attestation_failed",
        device_id: body.device_id,
      });
      return errorResponse("Device attestation verification failed", 401, origin);
    }
  }

  // Create elevated session
  const { data: sessionToken, error: sessionError } = await admin.rpc(
    "create_elevated_session",
    {
      p_user_id: userId,
      p_tenant_id: tenantId,
      p_auth_method: method,
      p_duration_minutes: duration_minutes,
    },
  );

  if (sessionError || !sessionToken) {
    return errorResponse("Failed to create elevated session", 500, origin);
  }

  const expiresAt = new Date(Date.now() + duration_minutes * 60 * 1000).toISOString();

  // Audit log success (H1)
  await auditLog(admin, tenantId, userId, "elevated_auth_success", {
    method,
    duration_minutes,
  });

  return jsonResponse(
    { success: true, data: { session_token: sessionToken, expires_at: expiresAt } },
    200,
    origin,
  );
}

async function handleCheck(
  userId: string,
  tenantId: string,
  body: CheckBody,
  origin?: string | null,
): Promise<Response> {
  if (!body.session_token) {
    return errorResponse("session_token is required", 400, origin);
  }

  const admin = getSupabaseAdmin();
  const { data: valid, error } = await admin.rpc("validate_elevated_session", {
    p_session_token: body.session_token,
    p_user_id: userId,
    p_tenant_id: tenantId,
  });

  if (error) {
    return errorResponse("Session validation failed", 500, origin);
  }

  return jsonResponse({ success: true, data: { valid: !!valid } }, 200, origin);
}

async function handleRevoke(
  userId: string,
  tenantId: string,
  origin?: string | null,
): Promise<Response> {
  const admin = getSupabaseAdmin();
  const { data: count, error } = await admin.rpc("revoke_elevated_sessions", {
    p_user_id: userId,
    p_tenant_id: tenantId,
  });

  if (error) {
    return errorResponse("Failed to revoke sessions", 500, origin);
  }

  return jsonResponse({ success: true, data: { revoked_count: count ?? 0 } }, 200, origin);
}

async function handleSetPin(
  userId: string,
  tenantId: string,
  body: SetPinBody,
  origin?: string | null,
): Promise<Response> {
  if (!body.pin || !/^\d{4,6}$/.test(body.pin)) {
    return errorResponse("PIN must be 4-6 digits", 400, origin);
  }

  const admin = getSupabaseAdmin();

  // Check if user already has a PIN set
  const { data: existingPin } = await admin
    .from("user_pin_credentials")
    .select("id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // H2: If user already has a PIN, require current PIN or active elevated session
  if (existingPin) {
    let authorized = false;

    // Option 1: Verify current PIN
    if (body.current_pin) {
      const { data: pinValid } = await admin.rpc("verify_user_pin", {
        p_user_id: userId,
        p_tenant_id: tenantId,
        p_pin: body.current_pin,
      });
      authorized = !!pinValid;
    }

    // Option 2: Verify active elevated session
    if (!authorized && body.session_token) {
      const { data: sessionValid } = await admin.rpc("validate_elevated_session", {
        p_session_token: body.session_token,
        p_user_id: userId,
        p_tenant_id: tenantId,
      });
      authorized = !!sessionValid;
    }

    if (!authorized) {
      return errorResponse(
        "Changing PIN requires current PIN or an active elevated session",
        403,
        origin,
      );
    }
  }

  const { error } = await admin.rpc("set_user_pin", {
    p_user_id: userId,
    p_tenant_id: tenantId,
    p_pin: body.pin,
  });

  if (error) {
    // L2: Don't leak internal error details
    return errorResponse("Failed to set PIN", 500, origin);
  }

  return jsonResponse({ success: true, data: { message: "PIN set successfully" } }, 200, origin);
}

async function handlePinStatus(
  userId: string,
  tenantId: string,
  origin?: string | null,
): Promise<Response> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("user_pin_credentials")
    .select("locked_until, failed_attempts")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    return errorResponse("Failed to check PIN status", 500, origin);
  }

  const isLocked = data?.locked_until ? new Date(data.locked_until) > new Date() : false;

  return jsonResponse(
    {
      success: true,
      data: {
        has_pin: !!data,
        is_locked: isLocked,
        locked_until: isLocked ? data!.locked_until : null,
      },
    },
    200,
    origin,
  );
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    // Authenticate via Supabase JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Missing Authorization header", 401, origin);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return errorResponse("Unauthorized", 401, origin);
    }

    const userId = user.id;
    const tenantId = user.app_metadata?.tenant_id;
    if (!tenantId) {
      return errorResponse("Missing tenant_id in JWT", 401, origin);
    }

    // Parse action from query params
    const url = new URL(req.url);
    const action = url.searchParams.get("action") as AuthAction | null;

    if (!action) {
      return errorResponse("Missing 'action' query parameter", 400, origin);
    }

    // Rate limiting (H3)
    const rateCheck = checkRateLimit(userId, action);
    if (!rateCheck.allowed) {
      const retryAfterSec = Math.ceil(rateCheck.retryAfterMs / 1000);
      return new Response(
        JSON.stringify({ success: false, error: "Too many requests" }),
        {
          status: 429,
          headers: {
            ...corsHeaders(origin),
            "Content-Type": "application/json",
            "Retry-After": String(retryAfterSec),
          },
        },
      );
    }

    // GET requests
    if (req.method === "GET") {
      if (action === "pin-status") {
        return handlePinStatus(userId, tenantId, origin);
      }
      return errorResponse("Invalid GET action", 405, origin);
    }

    // POST requests
    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405, origin);
    }

    const body = await req.json().catch(() => ({}));
    const admin = getSupabaseAdmin();

    switch (action) {
      case "verify":
        return handleVerify(userId, tenantId, body as VerifyBody, origin);
      case "check":
        return handleCheck(userId, tenantId, body as CheckBody, origin);
      case "revoke":
        return handleRevoke(userId, tenantId, origin);
      case "set-pin":
        return handleSetPin(userId, tenantId, body as SetPinBody, origin);
      case "register-device":
        return handleRegisterDevice(admin, userId, tenantId, body as RegisterDeviceBody, origin);
      case "challenge":
        return handleChallenge(admin, userId, tenantId, body as { device_id?: string }, origin);
      default:
        return errorResponse(`Unknown action: ${action}`, 400, origin);
    }
  } catch (err) {
    console.error("elevated-auth error:", err);
    return errorResponse("Internal server error", 500);
  }
});
