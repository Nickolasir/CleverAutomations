/**
 * Family Messenger
 *
 * Handles in-app family announcements and private messages.
 * Content encrypted with tenant-level key (readable by all family members).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantId, UserId } from "@clever/shared";

export class FamilyMessenger {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly tenantId: TenantId,
  ) {}

  /**
   * Send a family announcement or private message.
   */
  async sendMessage(
    senderId: UserId,
    content: string,
    recipientId?: UserId,
  ): Promise<{ success: boolean; error?: string }> {
    if (!content.trim()) {
      return { success: false, error: "Message content is required" };
    }

    if (content.length > 2000) {
      return { success: false, error: "Message too long (max 2000 characters)" };
    }

    const channelType = recipientId ? "private_message" : "family_announcement";

    // Encrypt with tenant key (not user key — all family members need to read it)
    const { data: encrypted, error: encError } = await this.supabase.rpc("encrypt_pii", {
      p_plaintext: content.trim(),
      p_tenant_id: this.tenantId,
    });

    if (encError || !encrypted) {
      return { success: false, error: "Encryption failed" };
    }

    const { error: insertError } = await this.supabase
      .from("family_messages")
      .insert({
        tenant_id: this.tenantId,
        sender_user_id: senderId,
        channel_type: channelType,
        recipient_user_id: recipientId ?? null,
        content_encrypted: encrypted,
      });

    if (insertError) {
      return { success: false, error: "Failed to send message" };
    }

    return { success: true };
  }

  /**
   * Get messages visible to a user (announcements + their private messages).
   */
  async getMessages(userId: UserId, limit = 50): Promise<unknown[]> {
    const { data, error } = await this.supabase
      .from("family_messages")
      .select("*")
      .eq("tenant_id", this.tenantId)
      .or(
        `channel_type.eq.family_announcement,sender_user_id.eq.${userId},recipient_user_id.eq.${userId}`,
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    // Decrypt content
    return Promise.all(
      data.map(async (msg) => {
        const { data: decrypted } = await this.supabase.rpc("decrypt_pii", {
          p_ciphertext: msg.content_encrypted,
          p_tenant_id: this.tenantId,
        });

        return {
          id: msg.id,
          sender_user_id: msg.sender_user_id,
          channel_type: msg.channel_type,
          recipient_user_id: msg.recipient_user_id,
          content: decrypted ?? "[encrypted]",
          is_read: msg.is_read,
          created_at: msg.created_at,
        };
      }),
    );
  }
}
