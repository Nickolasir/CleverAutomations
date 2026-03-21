/**
 * Shopping list manager — CRUD operations on shopping_list_items via Supabase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TenantId,
  UserId,
  ShoppingListAddedVia,
  ShoppingListPriority,
  PantryItemCategory,
} from "@clever/shared";
import type { Database, DbShoppingListItem } from "@clever/supabase-backend";

export interface AddShoppingListItemInput {
  name: string;
  quantity?: number;
  unit?: string;
  category?: PantryItemCategory;
  added_by: UserId;
  added_via: ShoppingListAddedVia;
  notes?: string;
  priority?: ShoppingListPriority;
}

export class ShoppingListManager {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly tenantId: TenantId,
  ) {}

  async addItem(input: AddShoppingListItemInput): Promise<DbShoppingListItem> {
    const { data, error } = await this.supabase
      .from("shopping_list_items")
      .insert({
        tenant_id: this.tenantId as unknown as string,
        name: input.name,
        quantity: input.quantity ?? 1,
        unit: input.unit ?? null,
        category: input.category ?? null,
        checked: false,
        added_by: input.added_by as unknown as string,
        added_via: input.added_via,
        notes: input.notes ?? null,
        priority: input.priority ?? "normal",
      })
      .select()
      .single();

    if (error) throw new Error(`Add shopping list item failed: ${error.message}`);
    return data;
  }

  async removeItem(itemId: string): Promise<void> {
    const { error } = await this.supabase
      .from("shopping_list_items")
      .delete()
      .eq("id", itemId)
      .eq("tenant_id", this.tenantId as unknown as string);

    if (error) throw new Error(error.message);
  }

  async checkItem(itemId: string): Promise<void> {
    const { error } = await this.supabase
      .from("shopping_list_items")
      .update({
        checked: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId)
      .eq("tenant_id", this.tenantId as unknown as string);

    if (error) throw new Error(error.message);
  }

  async uncheckItem(itemId: string): Promise<void> {
    const { error } = await this.supabase
      .from("shopping_list_items")
      .update({
        checked: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId)
      .eq("tenant_id", this.tenantId as unknown as string);

    if (error) throw new Error(error.message);
  }

  async getUncheckedItems(): Promise<DbShoppingListItem[]> {
    const { data, error } = await this.supabase
      .from("shopping_list_items")
      .select()
      .eq("tenant_id", this.tenantId as unknown as string)
      .eq("checked", false)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getAllItems(): Promise<DbShoppingListItem[]> {
    const { data, error } = await this.supabase
      .from("shopping_list_items")
      .select()
      .eq("tenant_id", this.tenantId as unknown as string)
      .order("checked")
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async clearChecked(): Promise<void> {
    const { error } = await this.supabase
      .from("shopping_list_items")
      .delete()
      .eq("tenant_id", this.tenantId as unknown as string)
      .eq("checked", true);

    if (error) throw new Error(error.message);
  }
}
