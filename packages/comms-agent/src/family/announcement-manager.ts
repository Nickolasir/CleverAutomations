/**
 * Announcement Manager
 *
 * Handles family-wide announcements. These are broadcast messages
 * visible to all household members (all users within the tenant).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantId, UserId } from "@clever/shared";

export class AnnouncementManager {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly tenantId: TenantId,
  ) {}

  /**
   * Post a family-wide announcement.
   */
  async postAnnouncement(
    senderId: UserId,
    content: string,
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    const { data: encrypted } = await this.supabase.rpc("encrypt_pii", {
      p_plaintext: content,
      p_tenant_id: this.tenantId,
    });

    if (!encrypted) return { success: false, error: "Encryption failed" };

    const { data, error } = await this.supabase
      .from("family_messages")
      .insert({
        tenant_id: this.tenantId,
        sender_user_id: senderId,
        channel_type: "family_announcement",
        content_encrypted: encrypted,
      })
      .select("id")
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, id: data.id };
  }

  /**
   * Get recent announcements.
   */
  async getAnnouncements(limit = 20): Promise<unknown[]> {
    const { data } = await this.supabase
      .from("family_messages")
      .select("*")
      .eq("tenant_id", this.tenantId)
      .eq("channel_type", "family_announcement")
      .order("created_at", { ascending: false })
      .limit(limit);

    return data ?? [];
  }
}
