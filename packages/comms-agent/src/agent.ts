/**
 * Communications Agent
 *
 * Cloud-only sub-agent (no hardware) that manages email, calendar,
 * and family messaging for the CleverHub household.
 *
 * Key design principles:
 *   - Email content is NEVER stored in the database
 *   - Fetched on-demand via OAuth, summarized by LLM, returned to user
 *   - Only metadata (subject, sender, timestamp) cached in email_cache
 *   - Per-user encryption for OAuth tokens
 *   - Strict age-based privacy controls
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TenantId, UserId } from "@clever/shared";
import { createEmailProvider, type EmailProvider } from "./email/email-provider.js";
import { EmailSummarizer } from "./email/email-summarizer.js";
import { FamilyMessenger } from "./family/family-messenger.js";
import { AccessChecker } from "./privacy/access-checker.js";
import { RateLimiter } from "./privacy/rate-limiter.js";
import { AuditLogger } from "./privacy/audit-logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CommsAgentConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  tenantId: TenantId;
  groqApiKey?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class CommsAgent {
  private readonly supabase: SupabaseClient;
  private readonly tenantId: TenantId;
  private readonly accessChecker: AccessChecker;
  private readonly rateLimiter: RateLimiter;
  private readonly auditLogger: AuditLogger;
  private readonly emailSummarizer: EmailSummarizer;
  private readonly familyMessenger: FamilyMessenger;

  constructor(config: CommsAgentConfig) {
    this.supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
    this.tenantId = config.tenantId;
    this.accessChecker = new AccessChecker(this.supabase, config.tenantId);
    this.rateLimiter = new RateLimiter(this.supabase, config.tenantId);
    this.auditLogger = new AuditLogger(this.supabase, config.tenantId);
    this.emailSummarizer = new EmailSummarizer(config.groqApiKey);
    this.familyMessenger = new FamilyMessenger(this.supabase, config.tenantId);
  }

  /**
   * Check if a user requires elevated authentication to access email.
   */
  async requiresElevatedAuth(userId: UserId): Promise<boolean> {
    return this.accessChecker.requiresElevatedAuth(userId);
  }

  /**
   * Check if accessor can view target user's email.
   */
  async checkEmailAccess(
    accessorId: UserId,
    targetId: UserId,
  ): Promise<{ allowed: boolean; reason?: string }> {
    return this.accessChecker.checkAccess(accessorId, targetId);
  }

  /**
   * Fetch and summarize a user's inbox (on-demand, never cached).
   * Requires a valid elevated auth session.
   */
  async getInboxSummary(
    userId: UserId,
    elevatedSessionToken: string,
    limit = 20,
  ): Promise<{ summaries: string[]; unread_count: number } | null> {
    // Validate elevated session
    const { data: valid } = await this.supabase.rpc("validate_elevated_session", {
      p_session_token: elevatedSessionToken,
      p_user_id: userId,
      p_tenant_id: this.tenantId,
    });

    if (!valid) return null;

    // Log access
    await this.auditLogger.logAccess(userId, userId, "self", "view_inbox");

    // Get email provider for this user
    const provider = await this.getEmailProvider(userId);
    if (!provider) return null;

    // Fetch emails via OAuth (on-demand)
    const emails = await provider.getRecentEmails(limit);

    // Summarize via LLM
    const summaries = await this.emailSummarizer.summarizeEmails(emails);

    return {
      summaries,
      unread_count: emails.filter((e) => !e.is_read).length,
    };
  }

  /**
   * Send an email on behalf of a user (with rate limiting).
   */
  async sendEmail(
    userId: UserId,
    to: string,
    subject: string,
    body: string,
  ): Promise<{ success: boolean; error?: string }> {
    // Check rate limit
    const withinLimit = await this.rateLimiter.checkAndIncrement(userId);
    if (!withinLimit) {
      const remaining = await this.rateLimiter.getRemaining(userId);
      return { success: false, error: `Daily send limit reached. ${remaining} sends remaining.` };
    }

    // Get email provider
    const provider = await this.getEmailProvider(userId);
    if (!provider) {
      return { success: false, error: "No email account linked" };
    }

    // Send via OAuth
    try {
      await provider.sendEmail(to, subject, body);
      await this.auditLogger.logAccess(userId, userId, "self", "send_email", { to, subject });
      return { success: true };
    } catch (err) {
      return { success: false, error: "Failed to send email" };
    }
  }

  /**
   * Send a family announcement or private message.
   */
  async sendFamilyMessage(
    userId: UserId,
    content: string,
    recipientId?: UserId,
  ): Promise<{ success: boolean; error?: string }> {
    return this.familyMessenger.sendMessage(userId, content, recipientId);
  }

  /**
   * Get family messages for a user.
   */
  async getFamilyMessages(
    userId: UserId,
    limit = 50,
  ): Promise<unknown[]> {
    return this.familyMessenger.getMessages(userId, limit);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async getEmailProvider(userId: UserId): Promise<EmailProvider | null> {
    // Get the user's primary email account
    const { data: account } = await this.supabase
      .from("email_accounts")
      .select("id, provider")
      .eq("user_id", userId)
      .eq("tenant_id", this.tenantId)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!account) return null;

    // Get OAuth tokens
    const { data: tokens } = await this.supabase
      .from("email_oauth_tokens")
      .select("access_token_encrypted, refresh_token_encrypted, token_expiry")
      .eq("email_account_id", account.id)
      .eq("user_id", userId)
      .single();

    if (!tokens) return null;

    // Decrypt access token
    const { data: accessToken } = await this.supabase.rpc("decrypt_pii_user", {
      p_ciphertext: tokens.access_token_encrypted,
      p_tenant_id: this.tenantId,
      p_user_id: userId,
    });

    if (!accessToken) return null;

    return createEmailProvider(account.provider, accessToken);
  }
}
