/**
 * CleverHub - Device Command Edge Function
 *
 * Receives device command requests, validates JWT + rate limiting,
 * enforces confidence threshold for voice-sourced commands,
 * creates an audit log entry, and returns the command payload
 * for the HA bridge to execute.
 *
 * Endpoint: POST /functions/v1/device-command
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Rate limited: max 60 commands/minute per user
 *   - Voice commands below 0.7 confidence are rejected
 *   - Device-scoped tokens validated against target device
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  TenantId,
  UserId,
  DeviceId,
  DeviceCommand,
  DeviceCategory,
  ApiResult,
} from "@clever/shared";

// ---------------------------------------------------------------------------
// Input sanitization (inline for Deno edge function — mirrors @clever/shared)
// ---------------------------------------------------------------------------

function sanitizeAction(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.slice(0, 64).replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
}

function sanitizeParams(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) return {};
  const result: Record<string, unknown> = {};
  const entries = Object.entries(params as Record<string, unknown>);
  for (const [key, value] of entries.slice(0, 30)) {
    const safeKey = key.slice(0, 64).replace(/[^a-zA-Z0-9_]/g, "");
    if (!safeKey) continue;
    if (typeof value === "string") {
      result[safeKey] = value.slice(0, 4096).replace(/\0/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, "").trim();
    } else if (typeof value === "number") {
      result[safeKey] = Number.isFinite(value) ? value : 0;
    } else if (typeof value === "boolean") {
      result[safeKey] = value;
    } else if (Array.isArray(value)) {
      result[safeKey] = value.slice(0, 10).filter(
        (v: unknown) => typeof v === "number" || typeof v === "string" || typeof v === "boolean"
      );
    }
  }
  return result;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUUID(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().slice(0, 40);
  return UUID_REGEX.test(trimmed) ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum commands per user per minute */
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;

/** Voice commands below this confidence are rejected */
const CONFIDENCE_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceCommandRequest {
  /** Target device UUID */
  device_id: string;
  /** Action to perform (e.g., "turn_on", "set_temperature", "lock") */
  action: string;
  /** Action parameters (e.g., { temperature: 72, unit: "F" }) */
  parameters: Record<string, unknown>;
  /** How this command was triggered */
  source: "voice" | "dashboard" | "mobile" | "automation" | "api";
  /** Confidence score — required when source is "voice" */
  confidence?: number;
  /** Voice session ID for traceability */
  voice_session_id?: string;
}

interface DeviceCommandResponse {
  /** Command ID for tracking */
  command_id: string;
  /** Target device HA entity ID */
  ha_entity_id: string;
  /** Device category for HA service routing */
  category: DeviceCategory;
  /** Action to execute */
  action: string;
  /** Parameters for the action */
  parameters: Record<string, unknown>;
  /** Whether this command requires user confirmation first */
  requires_confirmation: boolean;
}

// ---------------------------------------------------------------------------
// Edge Function handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonError("METHOD_NOT_ALLOWED", "Only POST is accepted", 405);
  }

  try {
    // -----------------------------------------------------------------------
    // 1. Extract and validate JWT
    // -----------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("UNAUTHORIZED", "Missing or invalid Authorization header", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      return jsonError("SERVER_ERROR", "Missing Supabase environment configuration", 500);
    }

    const userToken = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser(userToken);
    if (authError || !user) {
      return jsonError("UNAUTHORIZED", "Invalid or expired JWT", 401);
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Extract claims
    const tenantId = extractClaim(user, "tenant_id");
    const userRole = extractClaim(user, "user_role");
    const userId = user.id;

    if (!tenantId) {
      return jsonError("FORBIDDEN", "No tenant_id found in JWT claims", 403);
    }

    // -----------------------------------------------------------------------
    // 2. Parse and validate request
    // -----------------------------------------------------------------------
    const rawPayload: DeviceCommandRequest = await req.json();
    const validationError = validatePayload(rawPayload);
    if (validationError) {
      return jsonError("VALIDATION_ERROR", validationError, 400);
    }

    // Sanitize all external inputs
    const deviceId = validateUUID(rawPayload.device_id);
    if (!deviceId) {
      return jsonError("VALIDATION_ERROR", "device_id must be a valid UUID", 400);
    }
    const payload: DeviceCommandRequest = {
      ...rawPayload,
      device_id: deviceId,
      action: sanitizeAction(rawPayload.action),
      parameters: sanitizeParams(rawPayload.parameters),
      voice_session_id: rawPayload.voice_session_id ? (validateUUID(rawPayload.voice_session_id) ?? undefined) : undefined,
    };

    if (!payload.action) {
      return jsonError("VALIDATION_ERROR", "action contains invalid characters", 400);
    }

    // -----------------------------------------------------------------------
    // 3. Confidence threshold check for voice commands
    // -----------------------------------------------------------------------
    let requiresConfirmation = false;

    if (payload.source === "voice") {
      if (typeof payload.confidence !== "number") {
        return jsonError(
          "VALIDATION_ERROR",
          "confidence is required for voice-sourced commands",
          400
        );
      }

      if (payload.confidence < CONFIDENCE_THRESHOLD) {
        return jsonError(
          "LOW_CONFIDENCE",
          `Voice command confidence ${payload.confidence.toFixed(3)} is below threshold ${CONFIDENCE_THRESHOLD}. ` +
            "User confirmation required.",
          422
        );
      }

      // Commands between threshold and 0.85 get a soft confirmation flag
      if (payload.confidence < 0.85) {
        requiresConfirmation = true;
      }
    }

    // -----------------------------------------------------------------------
    // 4. Rate limit check
    // -----------------------------------------------------------------------
    const rateLimitOk = await checkRateLimit(serviceClient, userId, tenantId);
    if (!rateLimitOk.allowed) {
      return new Response(
        JSON.stringify({
          data: null,
          error: {
            code: "RATE_LIMITED",
            message: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX} commands per minute.`,
            details: { retry_after_seconds: rateLimitOk.retryAfterSeconds },
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(rateLimitOk.retryAfterSeconds),
            "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    // -----------------------------------------------------------------------
    // 5. Validate device-scoped token (if applicable)
    // -----------------------------------------------------------------------
    const deviceScopeValid = await validateDeviceScope(
      serviceClient,
      payload.device_id,
      tenantId,
      user
    );
    if (!deviceScopeValid) {
      return jsonError(
        "FORBIDDEN",
        "Device-scoped token does not have access to this device",
        403
      );
    }

    // -----------------------------------------------------------------------
    // 6. Fetch device details for HA bridge
    // -----------------------------------------------------------------------
    const { data: device, error: deviceError } = await userClient
      .from("devices")
      .select("id, ha_entity_id, category, name, tenant_id, is_online")
      .eq("id", payload.device_id)
      .eq("tenant_id", tenantId)
      .single();

    if (deviceError || !device) {
      return jsonError(
        "NOT_FOUND",
        `Device ${payload.device_id} not found in tenant`,
        404
      );
    }

    if (!device.is_online) {
      return jsonError(
        "DEVICE_OFFLINE",
        `Device "${device.name}" is currently offline`,
        503
      );
    }

    // -----------------------------------------------------------------------
    // 7. Create audit log entry
    // -----------------------------------------------------------------------
    const commandId = crypto.randomUUID();

    await serviceClient.from("audit_logs").insert({
      tenant_id: tenantId,
      user_id: userId,
      device_id: payload.device_id,
      voice_session_id: payload.voice_session_id ?? null,
      action: "device_command_issued" as const,
      details: {
        command_id: commandId,
        action: payload.action,
        parameters: payload.parameters,
        source: payload.source,
        confidence: payload.confidence ?? null,
        ha_entity_id: device.ha_entity_id,
        requires_confirmation: requiresConfirmation,
      },
      ip_address: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null,
    });

    // -----------------------------------------------------------------------
    // 8. Return command for HA bridge execution
    // -----------------------------------------------------------------------
    const response: ApiResult<DeviceCommandResponse> = {
      data: {
        command_id: commandId,
        ha_entity_id: device.ha_entity_id as string,
        category: device.category as DeviceCategory,
        action: payload.action,
        parameters: payload.parameters,
        requires_confirmation: requiresConfirmation,
      },
      error: null,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
        "X-RateLimit-Remaining": String(rateLimitOk.remaining),
      },
    });
  } catch (err) {
    console.error("Device command error:", err);
    return jsonError("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function extractClaim(
  user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> },
  claim: string
): string | null {
  return (
    (user.app_metadata?.[claim] as string | undefined) ??
    (user.user_metadata?.[claim] as string | undefined) ??
    null
  );
}

function validatePayload(payload: DeviceCommandRequest): string | null {
  if (!payload.device_id) return "device_id is required";
  if (!payload.action) return "action is required";
  if (!payload.source) return "source is required";

  const validSources = ["voice", "dashboard", "mobile", "automation", "api"];
  if (!validSources.includes(payload.source)) {
    return `source must be one of: ${validSources.join(", ")}`;
  }

  if (payload.confidence !== undefined) {
    if (typeof payload.confidence !== "number" || payload.confidence < 0 || payload.confidence > 1) {
      return "confidence must be a number between 0 and 1";
    }
  }

  return null;
}

async function checkRateLimit(
  client: SupabaseClient,
  userId: string,
  tenantId: string
): Promise<{ allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number }> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString();

  const { count, error } = await client
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("action", "device_command_issued")
    .gte("timestamp", windowStart);

  if (error) {
    // If we can't check rate limits, fail open but log it
    console.error("Rate limit check failed:", error.message);
    return { allowed: true, remaining: RATE_LIMIT_MAX };
  }

  const currentCount = count ?? 0;

  if (currentCount >= RATE_LIMIT_MAX) {
    // Calculate approximate retry time
    // In production, we'd query the oldest entry in the window for precision
    return { allowed: false, retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS };
  }

  return { allowed: true, remaining: RATE_LIMIT_MAX - currentCount - 1 };
}

async function validateDeviceScope(
  client: SupabaseClient,
  deviceId: string,
  tenantId: string,
  user: { app_metadata?: Record<string, unknown> }
): Promise<boolean> {
  const deviceScope = user.app_metadata?.["device_scope"] as string | undefined;

  // No device_scope claim means this is a regular user token — allowed
  if (!deviceScope) return true;

  // Device-scoped token: must match the target device
  if (deviceScope !== deviceId) return false;

  // Verify device exists in tenant
  const { data } = await client
    .from("devices")
    .select("id")
    .eq("id", deviceId)
    .eq("tenant_id", tenantId)
    .single();

  return data !== null;
}

function jsonError(code: string, message: string, status: number): Response {
  const body: ApiResult<never> = {
    data: null,
    error: { code, message },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
