/**
 * Email Delegation Manager
 *
 * Manages parent-child email delegation grants.
 * Parents can request access to their children's email accounts:
 *   - Child (5-9): automatic delegation
 *   - Tween (10-14): automatic monitoring
 *   - Teen (15-17): requires teen's explicit consent
 *   - Adult: not allowed
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantId, UserId } from "@clever/shared";

export class DelegationManager {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly tenantId: TenantId,
  ) {}

  /**
   * Request email delegation from parent to child.
   */
  async requestDelegation(
    parentId: UserId,
    childId: UserId,
  ): Promise<{ success: boolean; grant_id?: string; awaiting_consent?: boolean; error?: string }> {
    // Get child's age group
    const { data: profile } = await this.supabase
      .from("family_member_profiles")
      .select("age_group")
      .eq("user_id", childId)
      .eq("tenant_id", this.tenantId)
      .maybeSingle();

    if (!profile) return { success: false, error: "Child profile not found" };

    const ageGroup = profile.age_group;

    if (ageGroup === "adult" || ageGroup === "adult_visitor") {
      return { success: false, error: "Cannot delegate adult's email" };
    }

    const autoConsent = ageGroup === "child" || ageGroup === "toddler" || ageGroup === "tween";

    const { data: grant, error } = await this.supabase
      .from("email_delegation_grants")
      .insert({
        tenant_id: this.tenantId,
        parent_user_id: parentId,
        child_user_id: childId,
        child_consent_recorded: autoConsent,
        granted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      return { success: false, error: "Delegation already exists or failed" };
    }

    return {
      success: true,
      grant_id: grant.id,
      awaiting_consent: !autoConsent,
    };
  }

  /**
   * Teen responds to a delegation request.
   */
  async respondToRequest(
    childId: UserId,
    grantId: string,
    accepted: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    if (accepted) {
      const { error } = await this.supabase
        .from("email_delegation_grants")
        .update({ child_consent_recorded: true })
        .eq("id", grantId)
        .eq("child_user_id", childId)
        .eq("tenant_id", this.tenantId);

      if (error) return { success: false, error: error.message };
      return { success: true };
    }

    // Revoke
    const { error } = await this.supabase
      .from("email_delegation_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", grantId)
      .eq("child_user_id", childId)
      .eq("tenant_id", this.tenantId);

    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  /**
   * Revoke a delegation grant (by parent or child).
   */
  async revokeDelegation(
    userId: UserId,
    grantId: string,
  ): Promise<{ success: boolean }> {
    const { error } = await this.supabase
      .from("email_delegation_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", grantId)
      .eq("tenant_id", this.tenantId)
      .or(`parent_user_id.eq.${userId},child_user_id.eq.${userId}`);

    return { success: !error };
  }
}
