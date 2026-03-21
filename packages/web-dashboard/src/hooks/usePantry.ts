"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { TenantId, PantryItem, PantryItemCategory, PantryLocation } from "@clever/shared";
import { createBrowserClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface UsePantryReturn {
  items: PantryItem[];
  loading: boolean;
  error: string | null;
  /** Items expiring within 3 days */
  expiringItems: PantryItem[];
  /** Items at or below their min_stock_threshold */
  lowStockItems: PantryItem[];
  /** Filter items by location */
  itemsByLocation: (location: PantryLocation) => PantryItem[];
  /** Filter items by category */
  itemsByCategory: (category: PantryItemCategory) => PantryItem[];
  /** Add an item manually */
  addItem: (item: {
    name: string;
    quantity?: number;
    unit?: string;
    category?: PantryItemCategory;
    location?: PantryLocation;
    expiry_date?: string;
  }) => Promise<void>;
  /** Remove an item by ID */
  removeItem: (id: string) => Promise<void>;
  /** Update item quantity */
  updateQuantity: (id: string, quantity: number) => Promise<void>;
  /** Refresh from database */
  refresh: () => Promise<void>;
}

export function usePantry(tenantId: TenantId | null): UsePantryReturn {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const supabase = createBrowserClient();

  const fetchItems = useCallback(async () => {
    if (!tenantId) return;

    try {
      setError(null);
      const { data, error: fetchError } = await supabase
        .from("pantry_items")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("category")
        .order("name");

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      setItems((data as unknown as PantryItem[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch pantry");
    } finally {
      setLoading(false);
    }
  }, [tenantId, supabase]);

  // Subscribe to Realtime changes
  useEffect(() => {
    if (!tenantId) return;

    void fetchItems();

    const channel = supabase
      .channel(`pantry_items:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pantry_items",
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

  const expiringItems = items.filter((item) => {
    if (!item.expiry_date) return false;
    const expiry = new Date(item.expiry_date);
    const threeDays = new Date();
    threeDays.setDate(threeDays.getDate() + 3);
    return expiry <= threeDays;
  });

  const lowStockItems = items.filter(
    (item) =>
      item.min_stock_threshold !== null &&
      item.quantity <= item.min_stock_threshold,
  );

  const itemsByLocation = useCallback(
    (location: PantryLocation) =>
      items.filter((item) => item.location === location),
    [items],
  );

  const itemsByCategory = useCallback(
    (category: PantryItemCategory) =>
      items.filter((item) => item.category === category),
    [items],
  );

  const addItem = useCallback(
    async (input: {
      name: string;
      quantity?: number;
      unit?: string;
      category?: PantryItemCategory;
      location?: PantryLocation;
      expiry_date?: string;
    }) => {
      if (!tenantId) return;

      const { error: insertError } = await supabase
        .from("pantry_items")
        .insert({
          tenant_id: tenantId as string,
          name: input.name,
          quantity: input.quantity ?? 1,
          unit: input.unit ?? "item",
          category: input.category ?? "other",
          location: input.location ?? "pantry",
          expiry_date: input.expiry_date ?? null,
          source: "manual",
        });

      if (insertError) throw new Error(insertError.message);
    },
    [tenantId, supabase],
  );

  const removeItem = useCallback(
    async (id: string) => {
      const { error: deleteError } = await supabase
        .from("pantry_items")
        .delete()
        .eq("id", id);

      if (deleteError) throw new Error(deleteError.message);
    },
    [supabase],
  );

  const updateQuantity = useCallback(
    async (id: string, quantity: number) => {
      if (quantity <= 0) {
        await removeItem(id);
        return;
      }

      const { error: updateError } = await supabase
        .from("pantry_items")
        .update({ quantity, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (updateError) throw new Error(updateError.message);
    },
    [supabase, removeItem],
  );

  return {
    items,
    loading,
    error,
    expiringItems,
    lowStockItems,
    itemsByLocation,
    itemsByCategory,
    addItem,
    removeItem,
    updateQuantity,
    refresh: fetchItems,
  };
}
