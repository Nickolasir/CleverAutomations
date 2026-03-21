"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { TenantId, ShoppingListItem } from "@clever/shared";
import { createBrowserClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface UseShoppingListReturn {
  items: ShoppingListItem[];
  uncheckedItems: ShoppingListItem[];
  checkedItems: ShoppingListItem[];
  loading: boolean;
  error: string | null;
  /** Add an item to the shopping list */
  addItem: (name: string, quantity?: number) => Promise<void>;
  /** Remove an item by ID */
  removeItem: (id: string) => Promise<void>;
  /** Mark an item as checked/purchased */
  checkItem: (id: string) => Promise<void>;
  /** Uncheck an item */
  uncheckItem: (id: string) => Promise<void>;
  /** Clear all checked items */
  clearChecked: () => Promise<void>;
  /** Refresh from database */
  refresh: () => Promise<void>;
}

export function useShoppingList(
  tenantId: TenantId | null,
): UseShoppingListReturn {
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const supabase = createBrowserClient();

  const fetchItems = useCallback(async () => {
    if (!tenantId) return;

    try {
      setError(null);
      const { data, error: fetchError } = await supabase
        .from("shopping_list_items")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("checked")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true });

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      setItems((data as unknown as ShoppingListItem[]) ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch shopping list",
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId, supabase]);

  // Subscribe to Realtime changes
  useEffect(() => {
    if (!tenantId) return;

    void fetchItems();

    const channel = supabase
      .channel(`shopping_list:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shopping_list_items",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => void fetchItems(),
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [tenantId, fetchItems, supabase]);

  const uncheckedItems = items.filter((i) => !i.checked);
  const checkedItems = items.filter((i) => i.checked);

  const addItem = useCallback(
    async (name: string, quantity: number = 1) => {
      if (!tenantId) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error: insertError } = await supabase
        .from("shopping_list_items")
        .insert({
          tenant_id: tenantId as string,
          name,
          quantity,
          checked: false,
          added_by: user?.id ?? "",
          added_via: "dashboard",
          priority: "normal",
        });

      if (insertError) throw new Error(insertError.message);
    },
    [tenantId, supabase],
  );

  const removeItem = useCallback(
    async (id: string) => {
      const { error: deleteError } = await supabase
        .from("shopping_list_items")
        .delete()
        .eq("id", id);

      if (deleteError) throw new Error(deleteError.message);
    },
    [supabase],
  );

  const checkItem = useCallback(
    async (id: string) => {
      const { error: updateError } = await supabase
        .from("shopping_list_items")
        .update({ checked: true, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (updateError) throw new Error(updateError.message);
    },
    [supabase],
  );

  const uncheckItem = useCallback(
    async (id: string) => {
      const { error: updateError } = await supabase
        .from("shopping_list_items")
        .update({ checked: false, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (updateError) throw new Error(updateError.message);
    },
    [supabase],
  );

  const clearChecked = useCallback(async () => {
    if (!tenantId) return;

    const { error: deleteError } = await supabase
      .from("shopping_list_items")
      .delete()
      .eq("tenant_id", tenantId as string)
      .eq("checked", true);

    if (deleteError) throw new Error(deleteError.message);
  }, [tenantId, supabase]);

  return {
    items,
    uncheckedItems,
    checkedItems,
    loading,
    error,
    addItem,
    removeItem,
    checkItem,
    uncheckItem,
    clearChecked,
    refresh: fetchItems,
  };
}
