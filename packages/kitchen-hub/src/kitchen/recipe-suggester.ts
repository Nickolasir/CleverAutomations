/**
 * Recipe suggester.
 *
 * Queries current pantry contents and sends to the recipe-suggest
 * Edge Function for AI-powered recipe recommendations.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantId, RecipeSuggestion } from "@clever/shared";
import type { Database } from "@clever/supabase-backend";

export class RecipeSuggester {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly tenantId: TenantId,
  ) {}

  /**
   * Fetch pantry contents and request recipe suggestions from the AI.
   */
  async suggestFromPantry(): Promise<RecipeSuggestion[]> {
    // 1. Get current pantry items
    const { data: pantryItems, error: pantryError } = await this.supabase
      .from("pantry_items")
      .select("name, quantity, unit, category")
      .eq("tenant_id", this.tenantId as unknown as string)
      .gt("quantity", 0);

    if (pantryError) {
      console.error(
        `[RecipeSuggester] Pantry query error: ${pantryError.message}`,
      );
      return [];
    }

    if (!pantryItems || pantryItems.length === 0) {
      console.log("[RecipeSuggester] Pantry is empty, no recipes to suggest.");
      return [];
    }

    // 2. Call recipe-suggest Edge Function
    const { data, error: fnError } = await this.supabase.functions.invoke(
      "recipe-suggest",
      {
        body: {
          ingredients: pantryItems.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unit: i.unit,
          })),
          tenant_id: this.tenantId,
        },
      },
    );

    if (fnError) {
      console.error(
        `[RecipeSuggester] Function error: ${fnError.message}`,
      );
      return [];
    }

    const suggestions = (data as { recipes: RecipeSuggestion[] })?.recipes ?? [];

    console.log(
      `[RecipeSuggester] Got ${suggestions.length} recipe suggestion(s).`,
    );

    // 3. Broadcast to kitchen display via Realtime
    const channel = this.supabase.channel(
      `kitchen:${this.tenantId as string}`,
    );
    await channel.subscribe();
    await channel.send({
      type: "broadcast",
      event: "recipe_suggestions",
      payload: { recipes: suggestions, timestamp: new Date().toISOString() },
    });
    this.supabase.removeChannel(channel);

    return suggestions;
  }
}
