/**
 * Email Send Rate Limiter
 *
 * Enforces daily email send limits by age group:
 *   - Adult: 100/day
 *   - Teenager: 20/day
 *   - Tween: 10/day
 *   - Child: 5/day
 *   - Toddler: 0/day (blocked)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantId, UserId } from "@clever/shared";

export class RateLimiter {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly tenantId: TenantId,
  ) {}

  /**
   * Check if user is within their daily send limit and increment counter.
   * Returns false if the limit has been reached.
   */
  async checkAndIncrement(userId: UserId): Promise<boolean> {
    const { data: allowed } = await this.supabase.rpc("enforce_email_rate_limit", {
      p_user_id: userId,
      p_tenant_id: this.tenantId,
    });

    return !!allowed;
  }

  /**
   * Get remaining sends for today.
   */
  async getRemaining(userId: UserId): Promise<number> {
    const { data: remaining } = await this.supabase.rpc("get_email_rate_limit_remaining", {
      p_user_id: userId,
      p_tenant_id: this.tenantId,
    });

    return remaining ?? 0;
  }
}
