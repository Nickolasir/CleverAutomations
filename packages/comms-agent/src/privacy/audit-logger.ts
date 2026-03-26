/**
 * Email Access Audit Logger
 *
 * Logs every email access event for transparency and dispute resolution.
 * Both the accessor and the target user can view their own audit entries.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantId, UserId } from "@clever/shared";

export class AuditLogger {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly tenantId: TenantId,
  ) {}

  /**
   * Log an email access event.
   */
  async logAccess(
    accessorId: UserId,
    targetId: UserId,
    accessType: string,
    action: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.supabase.from("email_access_audit_log").insert({
      tenant_id: this.tenantId,
      accessor_user_id: accessorId,
      target_user_id: targetId,
      access_type: accessType,
      action,
      metadata: metadata ?? {},
    });
  }

  /**
   * Get audit log entries for a user (as accessor or target).
   */
  async getEntries(userId: UserId, limit = 50): Promise<unknown[]> {
    const { data } = await this.supabase
      .from("email_access_audit_log")
      .select("*")
      .eq("tenant_id", this.tenantId)
      .or(`accessor_user_id.eq.${userId},target_user_id.eq.${userId}`)
      .order("accessed_at", { ascending: false })
      .limit(limit);

    return data ?? [];
  }
}
