/**
 * Expiry tracker — daily check for pantry items expiring within 3 days.
 *
 * Broadcasts notifications via Supabase Realtime to the dashboard
 * and kitchen display. Also logs to console for voice alert integration.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantId } from "@clever/shared";
import type { Database } from "@clever/supabase-backend";

export class ExpiryTracker {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly tenantId: TenantId,
  ) {}

  /**
   * Check for items expiring within 3 days and broadcast notifications.
   */
  async checkAndNotify(): Promise<void> {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    const cutoff = threeDaysFromNow.toISOString().split("T")[0]!;

    const { data: expiringItems, error } = await this.supabase
      .from("pantry_items")
      .select("id, name, expiry_date, location, quantity, unit")
      .eq("tenant_id", this.tenantId as unknown as string)
      .not("expiry_date", "is", null)
      .lte("expiry_date", cutoff)
      .order("expiry_date", { ascending: true });

    if (error) {
      console.error(`[ExpiryTracker] Query error: ${error.message}`);
      return;
    }

    if (!expiringItems || expiringItems.length === 0) {
      console.log("[ExpiryTracker] No items expiring soon.");
      return;
    }

    console.log(
      `[ExpiryTracker] ${expiringItems.length} item(s) expiring within 3 days:`,
    );
    for (const item of expiringItems) {
      console.log(
        `  - ${item.name} (${item.quantity} ${item.unit}) expires ${item.expiry_date}`,
      );
    }

    // Broadcast to pantry Realtime channel
    const channel = this.supabase.channel(
      `pantry:${this.tenantId as string}`,
    );
    await channel.subscribe();
    await channel.send({
      type: "broadcast",
      event: "EXPIRY_WARNING",
      payload: {
        items: expiringItems,
        checked_at: new Date().toISOString(),
      },
    });
    this.supabase.removeChannel(channel);
  }
}
