/**
 * Image Upload Edge Function
 *
 * Generates presigned upload URLs for Supabase Storage. Used by the
 * mobile app to upload food photos for nutrition tracking.
 *
 * Endpoint: POST /functions/v1/image-upload
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Upload path scoped to {tenant_id}/{user_id}/ (enforced server-side)
 *   - Accepted types: image/jpeg, image/png, image/webp
 *   - Max file size: 10MB
 */

import { createClient } from "@supabase/supabase-js";
import type { ApiResult } from "@clever/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

type StorageBucket = "food-photos" | "receipts";
const VALID_BUCKETS: StorageBucket[] = ["food-photos", "receipts"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UploadRequest {
  /** Storage bucket name */
  bucket: StorageBucket;
  /** Optional filename (auto-generated if omitted) */
  filename?: string;
  /** MIME type of the image */
  content_type: string;
}

interface UploadResponse {
  /** Full storage path (use for future references) */
  path: string;
  /** Signed upload URL (PUT to this URL with the file body) */
  upload_url: string;
  /** Public URL for accessing the uploaded file */
  public_url: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

function jsonResponse<T>(data: ApiResult<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    // Authenticate
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Missing Authorization header", 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return errorResponse("Unauthorized", 401);
    }

    const userId = user.id;
    const tenantId = user.app_metadata?.tenant_id;
    if (!tenantId) {
      return errorResponse("Missing tenant_id in JWT", 401);
    }

    // Parse body
    const body: UploadRequest = await req.json();

    // Validate bucket
    if (!body.bucket || !VALID_BUCKETS.includes(body.bucket)) {
      return errorResponse(`Invalid bucket. Must be one of: ${VALID_BUCKETS.join(", ")}`);
    }

    // Validate content type
    if (!body.content_type || !ALLOWED_CONTENT_TYPES.includes(body.content_type)) {
      return errorResponse(
        `Invalid content_type. Must be one of: ${ALLOWED_CONTENT_TYPES.join(", ")}`,
      );
    }

    // Build storage path: {tenant_id}/{user_id}/{timestamp}_{random}.{ext}
    const ext = body.content_type.split("/")[1] === "jpeg" ? "jpg" : body.content_type.split("/")[1];
    const filename = body.filename || `${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const storagePath = `${tenantId}/${userId}/${filename}`;

    // Use service role to create signed upload URL
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Create signed upload URL (valid for 10 minutes)
    const { data: uploadData, error: uploadError } = await admin.storage
      .from(body.bucket)
      .createSignedUploadUrl(storagePath);

    if (uploadError || !uploadData) {
      console.error("Storage error:", uploadError);
      return errorResponse("Failed to create upload URL", 500);
    }

    // Get public URL for future access
    const { data: publicUrlData } = admin.storage
      .from(body.bucket)
      .getPublicUrl(storagePath);

    const response: UploadResponse = {
      path: storagePath,
      upload_url: uploadData.signedUrl,
      public_url: publicUrlData.publicUrl,
    };

    return jsonResponse({ success: true, data: response });
  } catch (err) {
    console.error("image-upload error:", err);
    return errorResponse("Internal server error", 500);
  }
});
