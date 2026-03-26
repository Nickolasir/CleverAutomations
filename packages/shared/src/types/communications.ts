/**
 * Communications Privacy & Family Messaging Types
 *
 * Type definitions for email privacy controls, OAuth token management,
 * parental monitoring, family messaging, and email delegation.
 */

import type { TenantId, UserId } from "./tenant.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type EmailAuthProvider = "gmail_oauth" | "outlook_oauth" | "imap_custom";

export type EmailAccessLevel = "full_private" | "parental_monitoring" | "parental_managed";

export type MessageChannelType = "family_announcement" | "private_message" | "email_delegation";

// ---------------------------------------------------------------------------
// Email OAuth tokens
// ---------------------------------------------------------------------------

export interface EmailOAuthToken {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  email_account_id: string;
  /** Encrypted with per-user key — only the owning user can decrypt */
  access_token_encrypted: string;
  /** Encrypted with per-user key — only the owning user can decrypt */
  refresh_token_encrypted: string;
  token_expiry: string | null;
  scopes: string[];
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Email access policies
// ---------------------------------------------------------------------------

export interface EmailAccessPolicy {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  profile_id: string | null;
  access_level: EmailAccessLevel;
  elevated_auth_required: boolean;
  session_duration_minutes: number;
  parent_monitoring_user_id: UserId | null;
  monitoring_notification_enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Email access audit log
// ---------------------------------------------------------------------------

export interface EmailAccessAuditEntry {
  id: string;
  tenant_id: TenantId;
  accessor_user_id: UserId;
  target_user_id: UserId;
  access_type: string;
  elevated_session_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  accessed_at: string;
}

// ---------------------------------------------------------------------------
// Family messages
// ---------------------------------------------------------------------------

export interface FamilyMessage {
  id: string;
  tenant_id: TenantId;
  sender_user_id: UserId;
  channel_type: MessageChannelType;
  recipient_user_id: UserId | null;
  /** Encrypted with tenant key (decrypt via decrypt_pii) */
  content_encrypted: string;
  /** Decrypted content (only available after client-side decryption) */
  content?: string;
  is_read: boolean;
  created_at: string;
}

export interface FamilyMessageCreateInput {
  channel_type: MessageChannelType;
  recipient_user_id?: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Email delegation grants
// ---------------------------------------------------------------------------

export interface EmailDelegationGrant {
  id: string;
  tenant_id: TenantId;
  parent_user_id: UserId;
  child_user_id: UserId;
  child_consent_recorded: boolean;
  granted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Email rate limits
// ---------------------------------------------------------------------------

export interface EmailRateLimit {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  profile_id: string | null;
  daily_send_limit: number;
  current_daily_count: number;
  count_reset_at: string;
}
