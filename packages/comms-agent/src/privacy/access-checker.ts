/**
 * Email Access Checker
 *
 * Enforces per-user email privacy policies based on age group:
 *   - Adult: full_private (only self, biometric required)
 *   - Teenager: full_private (parent needs teen's permission)
 *   - Tween: parental_monitoring (parent can view)
 *   - Child: parental_managed (parent has full access)
 *   - Toddler: no email access
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantId, UserId } from "@clever/shared";

export class AccessChecker {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly tenantId: TenantId,
  ) {}

  /**
   * Check if a user requires elevated auth for email access.
   */
  async requiresElevatedAuth(userId: UserId): Promise<boolean> {
    const { data: policy } = await this.supabase
      .from("email_access_policies")
      .select("elevated_auth_required")
      .eq("user_id", userId)
      .eq("tenant_id", this.tenantId)
      .maybeSingle();

    // Default to requiring elevated auth
    return policy?.elevated_auth_required ?? true;
  }

  /**
   * Check if accessor can view target user's email.
   */
  async checkAccess(
    accessorId: UserId,
    targetId: UserId,
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Self-access is always allowed
    if (accessorId === targetId) {
      return { allowed: true };
    }

    // Check target's age group
    const { data: targetProfile } = await this.supabase
      .from("family_member_profiles")
      .select("age_group")
      .eq("user_id", targetId)
      .eq("tenant_id", this.tenantId)
      .maybeSingle();

    const ageGroup = targetProfile?.age_group ?? "adult";

    // Adults: no one else can access
    if (ageGroup === "adult" || ageGroup === "adult_visitor") {
      return { allowed: false, reason: "Cannot access another adult's email" };
    }

    // Check accessor's role (must be admin/owner to be a parent)
    const { data: accessorUser } = await this.supabase
      .from("users")
      .select("role")
      .eq("id", accessorId)
      .eq("tenant_id", this.tenantId)
      .single();

    if (!accessorUser || !["owner", "admin"].includes(accessorUser.role)) {
      return { allowed: false, reason: "Only parents can access family members' email" };
    }

    // Check target's access policy
    const { data: policy } = await this.supabase
      .from("email_access_policies")
      .select("access_level")
      .eq("user_id", targetId)
      .eq("tenant_id", this.tenantId)
      .maybeSingle();

    const accessLevel = policy?.access_level ??
      (ageGroup === "child" ? "parental_managed" :
       ageGroup === "tween" ? "parental_monitoring" :
       "full_private");

    // Child: parent has full access
    if (accessLevel === "parental_managed") {
      return { allowed: true };
    }

    // Tween: parent can monitor
    if (accessLevel === "parental_monitoring") {
      return { allowed: true };
    }

    // Teenager: check for delegation grant with consent
    if (accessLevel === "full_private") {
      const { data: grant } = await this.supabase
        .from("email_delegation_grants")
        .select("child_consent_recorded")
        .eq("parent_user_id", accessorId)
        .eq("child_user_id", targetId)
        .eq("tenant_id", this.tenantId)
        .is("revoked_at", null)
        .maybeSingle();

      if (grant?.child_consent_recorded) {
        return { allowed: true };
      }

      return {
        allowed: false,
        reason: "Teen has not granted email access. Send an access request first.",
      };
    }

    return { allowed: false, reason: "Access denied" };
  }
}
