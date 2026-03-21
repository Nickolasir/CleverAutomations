/**
 * Stock monitor — checks pantry items against their minimum stock thresholds
 * and auto-generates shopping list entries for low-stock items.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantId } from "@clever/shared";
import type { Database } from "@clever/supabase-backend";

export class StockMonitor {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly tenantId: TenantId,
  ) {}

  /**
   * Check all pantry items with a min_stock_threshold.
   * For items below threshold that aren't already on the shopping list,
   * auto-add them with added_via = "auto_restock".
   */
  async checkAndAutoRestock(): Promise<void> {
    // 1. Get all items with a threshold set
    const { data: pantryItems, error: pantryError } = await this.supabase
      .from("pantry_items")
      .select("id, name, quantity, unit, min_stock_threshold, category")
      .eq("tenant_id", this.tenantId as unknown as string)
      .not("min_stock_threshold", "is", null);

    if (pantryError) {
      console.error(`[StockMonitor] Pantry query error: ${pantryError.message}`);
      return;
    }

    const lowItems = (pantryItems ?? []).filter(
      (i) =>
        i.min_stock_threshold !== null &&
        i.quantity <= i.min_stock_threshold,
    );

    if (lowItems.length === 0) return;

    // 2. Check which are already on the shopping list
    const { data: existingList, error: listError } = await this.supabase
      .from("shopping_list_items")
      .select("name")
      .eq("tenant_id", this.tenantId as unknown as string)
      .eq("checked", false);

    if (listError) {
      console.error(`[StockMonitor] List query error: ${listError.message}`);
      return;
    }

    const existingNames = new Set(
      (existingList ?? []).map((i) => i.name.toLowerCase()),
    );

    // 3. Add missing items to shopping list
    const toAdd = lowItems.filter(
      (i) => !existingNames.has(i.name.toLowerCase()),
    );

    if (toAdd.length === 0) return;

    const inserts = toAdd.map((item) => ({
      tenant_id: this.tenantId as unknown as string,
      name: item.name,
      quantity: (item.min_stock_threshold ?? 1) - item.quantity + 1,
      unit: item.unit,
      category: item.category,
      checked: false,
      added_by: "system" as string, // System-generated
      added_via: "auto_restock" as const,
      priority: "normal" as const,
    }));

    const { error: insertError } = await this.supabase
      .from("shopping_list_items")
      .insert(inserts);

    if (insertError) {
      console.error(`[StockMonitor] Auto-restock insert error: ${insertError.message}`);
      return;
    }

    console.log(
      `[StockMonitor] Auto-added ${toAdd.length} item(s) to shopping list: ${toAdd.map((i) => i.name).join(", ")}`,
    );
  }
}
