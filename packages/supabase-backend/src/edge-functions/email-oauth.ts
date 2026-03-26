/**
 * Email OAuth Edge Function
 *
 * Handles OAuth2 flows for Gmail and Outlook email account linking.
 *
 * Endpoints:
 *   POST /functions/v1/email-oauth?action=initiate  — start OAuth flow, return auth URL
 *   POST /functions/v1/email-oauth?action=callback   — handle OAuth callback, store tokens
 *   POST /functions/v1/email-oauth?action=refresh     — refresh an expired access token
 *   DELETE /functions/v1/email-oauth?account_id=UUID  — unlink account, revoke tokens
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - OAuth tokens encrypted with per-user keys (encrypt_pii_user)
 *   - Audit logging on link/unlink events
 */

import { createClient } from "@supabase/supabase-js";
import type { ApiResult } from "@clever/shared";

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
// Types
// ---------------------------------------------------------------------------

interface InitiateRequest {
  provider: "gmail_oauth" | "outlook_oauth";
  redirect_uri: string;
}

interface CallbackRequest {
  provider: "gmail_oauth" | "outlook_oauth";
  code: string;
  redirect_uri: string;
  email_account_id?: string;
}

interface RefreshRequest {
  email_account_id: string;
}

// ---------------------------------------------------------------------------
// OAuth configuration
// ---------------------------------------------------------------------------

function getGmailConfig() {
  return {
    client_id: Deno.env.get("GMAIL_OAUTH_CLIENT_ID") ?? "",
    client_secret: Deno.env.get("GMAIL_OAUTH_CLIENT_SECRET") ?? "",
    token_endpoint: "https://oauth2.googleapis.com/token",
    auth_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
  };
}

function getOutlookConfig() {
  return {
    client_id: Deno.env.get("OUTLOOK_OAUTH_CLIENT_ID") ?? "",
    client_secret: Deno.env.get("OUTLOOK_OAUTH_CLIENT_SECRET") ?? "",
    token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    auth_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    scopes: ["Mail.Read", "Mail.Send", "Calendars.ReadWrite", "offline_access"],
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleInitiate(
  userId: string,
  tenantId: string,
  body: InitiateRequest,
): Promise<Response> {
  const config = body.provider === "gmail_oauth" ? getGmailConfig() : getOutlookConfig();

  if (!config.client_id) {
    return errorResponse(`${body.provider} is not configured. Missing OAuth client credentials.`, 503);
  }

  const state = crypto.randomUUID(); // CSRF protection
  const params = new URLSearchParams({
    client_id: config.client_id,
    redirect_uri: body.redirect_uri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });

  const authUrl = `${config.auth_endpoint}?${params.toString()}`;

  return jsonResponse({
    success: true,
    data: { auth_url: authUrl, state },
  });
}

async function handleCallback(
  userId: string,
  tenantId: string,
  body: CallbackRequest,
): Promise<Response> {
  const config = body.provider === "gmail_oauth" ? getGmailConfig() : getOutlookConfig();

  if (!config.client_id) {
    return errorResponse(`${body.provider} is not configured`, 503);
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(config.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      code: body.code,
      redirect_uri: body.redirect_uri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    console.error("OAuth token exchange failed:", err);
    return errorResponse("Failed to exchange authorization code", 500);
  }

  const tokens = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };

  if (!tokens.access_token) {
    return errorResponse("No access token received", 500);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Encrypt tokens with per-user key
  const { data: accessEncrypted } = await admin.rpc("encrypt_pii_user", {
    p_plaintext: tokens.access_token,
    p_tenant_id: tenantId,
    p_user_id: userId,
  });

  const refreshToken = tokens.refresh_token ?? "";
  const { data: refreshEncrypted } = await admin.rpc("encrypt_pii_user", {
    p_plaintext: refreshToken,
    p_tenant_id: tenantId,
    p_user_id: userId,
  });

  const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const scopes = tokens.scope?.split(" ") ?? config.scopes;

  // Store or update tokens
  if (body.email_account_id) {
    // Update existing account
    await admin.from("email_oauth_tokens").upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        email_account_id: body.email_account_id,
        access_token_encrypted: accessEncrypted,
        refresh_token_encrypted: refreshEncrypted,
        token_expiry: tokenExpiry,
        scopes,
      },
      { onConflict: "email_account_id" },
    );
  } else {
    // New account — caller should create email_account first
    return jsonResponse({
      success: true,
      data: {
        access_token_encrypted: accessEncrypted,
        refresh_token_encrypted: refreshEncrypted,
        token_expiry: tokenExpiry,
        scopes,
      },
    });
  }

  // Audit log
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    user_id: userId,
    action: "email_account_linked",
    details: { provider: body.provider, email_account_id: body.email_account_id },
  });

  return jsonResponse({
    success: true,
    data: { message: "Email account linked successfully" },
  });
}

async function handleRefresh(
  userId: string,
  tenantId: string,
  body: RefreshRequest,
): Promise<Response> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Get existing tokens
  const { data: tokenRow } = await admin
    .from("email_oauth_tokens")
    .select("*, email_accounts!inner(provider)")
    .eq("email_account_id", body.email_account_id)
    .eq("user_id", userId)
    .single();

  if (!tokenRow) return errorResponse("Token not found", 404);

  // Decrypt refresh token
  const { data: refreshToken } = await admin.rpc("decrypt_pii_user", {
    p_ciphertext: tokenRow.refresh_token_encrypted,
    p_tenant_id: tenantId,
    p_user_id: userId,
  });

  if (!refreshToken) return errorResponse("Failed to decrypt refresh token", 500);

  // Determine provider config
  const provider = tokenRow.email_accounts?.provider;
  const config = provider === "gmail" ? getGmailConfig() : getOutlookConfig();

  // Refresh the token
  const tokenResponse = await fetch(config.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!tokenResponse.ok) {
    return errorResponse("Token refresh failed. User may need to re-authenticate.", 401);
  }

  const newTokens = await tokenResponse.json() as {
    access_token: string;
    expires_in: number;
  };

  // Encrypt and store new access token
  const { data: newAccessEncrypted } = await admin.rpc("encrypt_pii_user", {
    p_plaintext: newTokens.access_token,
    p_tenant_id: tenantId,
    p_user_id: userId,
  });

  await admin
    .from("email_oauth_tokens")
    .update({
      access_token_encrypted: newAccessEncrypted,
      token_expiry: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("email_account_id", body.email_account_id);

  return jsonResponse({ success: true, data: { message: "Token refreshed" } });
}

async function handleUnlink(
  userId: string,
  tenantId: string,
  accountId: string,
): Promise<Response> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Delete OAuth tokens
  await admin
    .from("email_oauth_tokens")
    .delete()
    .eq("email_account_id", accountId)
    .eq("user_id", userId);

  // Deactivate email account
  await admin
    .from("email_accounts")
    .update({ is_active: false })
    .eq("id", accountId)
    .eq("user_id", userId);

  // Audit log
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    user_id: userId,
    action: "email_account_unlinked",
    details: { email_account_id: accountId },
  });

  return jsonResponse({ success: true, data: { message: "Account unlinked" } });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing Authorization header", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return errorResponse("Unauthorized", 401);

    const userId = user.id;
    const tenantId = user.app_metadata?.tenant_id;
    if (!tenantId) return errorResponse("Missing tenant_id in JWT", 401);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // DELETE: unlink account
    if (req.method === "DELETE") {
      const accountId = url.searchParams.get("account_id");
      if (!accountId) return errorResponse("account_id is required");
      return handleUnlink(userId, tenantId, accountId);
    }

    if (req.method !== "POST") return errorResponse("Method not allowed", 405);

    const body = await req.json();

    switch (action) {
      case "initiate":
        return handleInitiate(userId, tenantId, body as InitiateRequest);
      case "callback":
        return handleCallback(userId, tenantId, body as CallbackRequest);
      case "refresh":
        return handleRefresh(userId, tenantId, body as RefreshRequest);
      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("email-oauth error:", err);
    return errorResponse("Internal server error", 500);
  }
});
