/**
 * Input Sanitization Utilities
 *
 * Shared sanitization functions for all communication ingress points.
 * Every external input (WhatsApp, Telegram, chat, voice, device commands)
 * MUST pass through these before storage or LLM processing.
 */

// ---------------------------------------------------------------------------
// Text sanitization
// ---------------------------------------------------------------------------

/** Maximum message length accepted from any external source. */
const MAX_MESSAGE_LENGTH = 4096;

/** Maximum length for short identifiers (alert IDs, tokens, button IDs). */
const MAX_ID_LENGTH = 128;

/** Maximum length for phone numbers. */
const MAX_PHONE_LENGTH = 20;

/** UUID v4 pattern. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** E.164 phone number pattern. */
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

/**
 * Sanitize free-text message input from an external source.
 *
 * - Trims whitespace
 * - Truncates to MAX_MESSAGE_LENGTH
 * - Strips null bytes (can break PostgreSQL TEXT columns)
 * - Strips control characters except newline and tab
 * - Does NOT strip HTML/markdown — that's handled at the display layer
 *
 * Safe for: database storage, LLM prompt injection (truncation limits
 * the attack surface; control char stripping prevents terminal injection).
 */
export function sanitizeMessageText(input: unknown): string {
  if (typeof input !== "string") return "";

  return input
    .slice(0, MAX_MESSAGE_LENGTH)
    .replace(/\0/g, "")                         // null bytes
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, "") // control chars (keep \n \r \t)
    .trim();
}

/**
 * Sanitize a short identifier (alert ID, button callback ID, link token).
 *
 * - Trims whitespace
 * - Truncates to MAX_ID_LENGTH
 * - Strips anything that isn't alphanumeric, dash, or underscore
 */
export function sanitizeId(input: unknown): string {
  if (typeof input !== "string") return "";

  return input
    .slice(0, MAX_ID_LENGTH)
    .trim()
    .replace(/[^a-zA-Z0-9\-_]/g, "");
}

/**
 * Validate that a string is a valid UUID v4. Returns the UUID or null.
 */
export function validateUUID(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().slice(0, 40);
  return UUID_REGEX.test(trimmed) ? trimmed : null;
}

/**
 * Validate an E.164 phone number. Returns the phone or null.
 */
export function validatePhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().slice(0, MAX_PHONE_LENGTH);
  return E164_REGEX.test(trimmed) ? trimmed : null;
}

/**
 * Sanitize a sender ID (numeric Telegram ID or phone number).
 * Strips non-digit/non-plus characters.
 */
export function sanitizeSenderId(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.slice(0, MAX_PHONE_LENGTH).replace(/[^0-9+]/g, "");
}

/**
 * Sanitize a username (Telegram username, display name).
 * Keeps alphanumeric, underscore, space, dash. Truncates.
 */
export function sanitizeUsername(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  return input.slice(0, 64).replace(/[^a-zA-Z0-9_ \-]/g, "").trim() || null;
}

/**
 * Strip a raw webhook payload of any deeply nested or excessively large data
 * before storing in JSONB. Prevents payload bombs.
 */
export function sanitizeRawPayload(
  payload: unknown,
  maxDepth = 5,
  maxSize = 8192,
): Record<string, unknown> {
  const json = JSON.stringify(payload ?? {});
  if (json.length > maxSize) {
    return { _truncated: true, _original_size: json.length };
  }

  return truncateDepth(payload, maxDepth) as Record<string, unknown>;
}

function truncateDepth(value: unknown, depth: number): unknown {
  if (depth <= 0) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => truncateDepth(v, depth - 1));
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [k, v] of entries.slice(0, 50)) {
    result[k] = truncateDepth(v, depth - 1);
  }
  return result;
}

/**
 * Sanitize device command action string.
 * Only allows known safe characters.
 */
export function sanitizeAction(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.slice(0, 64).replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
}

/**
 * Sanitize device command parameters.
 * Strips any string values of control chars and truncates.
 * Validates numeric values are finite.
 */
export function sanitizeParameters(
  params: unknown,
): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return {};
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(params as Record<string, unknown>);

  for (const [key, value] of entries.slice(0, 30)) {
    const safeKey = key.slice(0, 64).replace(/[^a-zA-Z0-9_]/g, "");
    if (!safeKey) continue;

    if (typeof value === "string") {
      result[safeKey] = sanitizeMessageText(value);
    } else if (typeof value === "number") {
      result[safeKey] = Number.isFinite(value) ? value : 0;
    } else if (typeof value === "boolean") {
      result[safeKey] = value;
    } else if (Array.isArray(value)) {
      // Allow simple arrays (e.g., rgb_color: [255, 0, 0])
      result[safeKey] = value.slice(0, 10).filter(
        (v) => typeof v === "number" || typeof v === "string" || typeof v === "boolean"
      );
    }
    // Skip nested objects and other types
  }

  return result;
}
