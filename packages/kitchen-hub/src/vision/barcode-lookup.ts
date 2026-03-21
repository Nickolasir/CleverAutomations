/**
 * Barcode lookup.
 *
 * Scans a barcode using the camera + zbar, then looks up the product
 * via the barcode-lookup Edge Function (which uses Open Food Facts API).
 * Adds or removes the item from the pantry.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantId, UserId } from "@clever/shared";
import type { Database } from "@clever/supabase-backend";
import type { BarcodeScanner } from "../hardware/barcode-scanner.js";

export class BarcodeLookup {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly scanner: BarcodeScanner,
    private readonly tenantId: TenantId,
  ) {}

  /**
   * Scan a barcode and add the product to the pantry.
   */
  async scanAndAdd(userId: UserId): Promise<void> {
    const results = await this.scanner.scan();

    if (results.length === 0) {
      console.log("[BarcodeLookup] No barcode detected.");
      return;
    }

    const barcode = results[0]!.data;
    console.log(`[BarcodeLookup] Scanned: ${barcode} (${results[0]!.type})`);

    const { data, error } = await this.supabase.functions.invoke(
      "barcode-lookup",
      {
        body: {
          barcode,
          action: "add",
          tenant_id: this.tenantId,
          user_id: userId,
        },
      },
    );

    if (error) {
      console.error(`[BarcodeLookup] Lookup error: ${error.message}`);
      return;
    }

    console.log(
      `[BarcodeLookup] Added: ${(data as Record<string, unknown>)?.["name"] ?? barcode}`,
    );
  }

  /**
   * Scan a barcode and remove/decrement the product from the pantry.
   */
  async scanAndRemove(userId: UserId): Promise<void> {
    const results = await this.scanner.scan();

    if (results.length === 0) {
      console.log("[BarcodeLookup] No barcode detected.");
      return;
    }

    const barcode = results[0]!.data;
    console.log(`[BarcodeLookup] Scanned for removal: ${barcode}`);

    const { data, error } = await this.supabase.functions.invoke(
      "barcode-lookup",
      {
        body: {
          barcode,
          action: "remove",
          tenant_id: this.tenantId,
          user_id: userId,
        },
      },
    );

    if (error) {
      console.error(`[BarcodeLookup] Removal error: ${error.message}`);
      return;
    }

    console.log(
      `[BarcodeLookup] Removed: ${(data as Record<string, unknown>)?.["name"] ?? barcode}`,
    );
  }
}
