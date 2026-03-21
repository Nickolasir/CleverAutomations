/**
 * Pantry manager — CRUD operations on pantry_items via Supabase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TenantId,
  PantryItemCategory,
  PantryItemSource,
  PantryLocation,
} from "@clever/shared";
import type { Database, DbPantryItem } from "@clever/supabase-backend";

export interface AddPantryItemInput {
  name: string;
  quantity?: number;
  unit?: string;
  category?: PantryItemCategory;
  barcode?: string;
  brand?: string;
  expiry_date?: string;
  source: PantryItemSource;
  location?: PantryLocation;
  notes?: string;
  image_url?: string;
  min_stock_threshold?: number;
}

export class PantryManager {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly tenantId: TenantId,
  ) {}

  async addItem(input: AddPantryItemInput): Promise<DbPantryItem> {
    const { data, error } = await this.supabase
      .from("pantry_items")
      .insert({
        tenant_id: this.tenantId as unknown as string,
        name: input.name,
        quantity: input.quantity ?? 1,
        unit: input.unit ?? "item",
        category: input.category ?? "other",
        barcode: input.barcode ?? null,
        brand: input.brand ?? null,
        expiry_date: input.expiry_date ?? null,
        source: input.source,
        location: input.location ?? "pantry",
        notes: input.notes ?? null,
        image_url: input.image_url ?? null,
        min_stock_threshold: input.min_stock_threshold ?? null,
      })
      .select()
      .single();

    if (error) throw new Error(`Add pantry item failed: ${error.message}`);
    return data;
  }

  async removeItem(itemId: string): Promise<void> {
    const { error } = await this.supabase
      .from("pantry_items")
      .delete()
      .eq("id", itemId)
      .eq("tenant_id", this.tenantId as unknown as string);

    if (error) throw new Error(`Remove pantry item failed: ${error.message}`);
  }

  async decrementItem(itemId: string, amount: number = 1): Promise<void> {
    const { data: item, error: fetchError } = await this.supabase
      .from("pantry_items")
      .select("quantity")
      .eq("id", itemId)
      .eq("tenant_id", this.tenantId as unknown as string)
      .single();

    if (fetchError) throw new Error(fetchError.message);

    const newQty = item.quantity - amount;
    if (newQty <= 0) {
      await this.removeItem(itemId);
    } else {
      await this.supabase
        .from("pantry_items")
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq("id", itemId);
    }
  }

  async findByBarcode(barcode: string): Promise<DbPantryItem | null> {
    const { data, error } = await this.supabase
      .from("pantry_items")
      .select()
      .eq("tenant_id", this.tenantId as unknown as string)
      .eq("barcode", barcode)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  async findByName(name: string): Promise<DbPantryItem[]> {
    const { data, error } = await this.supabase
      .from("pantry_items")
      .select()
      .eq("tenant_id", this.tenantId as unknown as string)
      .ilike("name", `%${name}%`);

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async listAll(): Promise<DbPantryItem[]> {
    const { data, error } = await this.supabase
      .from("pantry_items")
      .select()
      .eq("tenant_id", this.tenantId as unknown as string)
      .order("category")
      .order("name");

    if (error) throw new Error(error.message);
    return data ?? [];
  }
}
