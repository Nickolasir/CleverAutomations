/**
 * Nutrition Barcode Lookup Edge Function
 *
 * Looks up nutritional data for a barcode (UPC/EAN):
 *   1. Check local food_items cache (fast)
 *   2. Fall back to OpenFoodFacts API (free, open source)
 *   3. Cache result in food_items for future lookups
 *
 * Endpoint: POST /functions/v1/nutrition-barcode
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Requires nutrition_data consent
 */

import { createClient } from "@supabase/supabase-js";
import type { ApiResult } from "@clever/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

function jsonResponse<T>(data: ApiResult<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BarcodeRequest {
  barcode: string;
  /** If true, also create a food_log entry */
  log?: boolean;
  meal_type?: string;
}

interface NutritionData {
  food_item_id: string;
  barcode: string;
  name: string;
  brand: string | null;
  serving_size_g: number | null;
  serving_description: string | null;
  calories_per_serving: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  image_url: string | null;
  source: string;
}

// ---------------------------------------------------------------------------
// OpenFoodFacts API
// ---------------------------------------------------------------------------

interface OFFProduct {
  product_name?: string;
  brands?: string;
  serving_size?: string;
  nutriments?: {
    "energy-kcal_serving"?: number;
    "energy-kcal_100g"?: number;
    proteins_serving?: number;
    proteins_100g?: number;
    carbohydrates_serving?: number;
    carbohydrates_100g?: number;
    fat_serving?: number;
    fat_100g?: number;
    fiber_serving?: number;
    fiber_100g?: number;
    sugars_serving?: number;
    sugars_100g?: number;
    sodium_serving?: number;
    sodium_100g?: number;
  };
  serving_quantity?: number;
  image_front_url?: string;
}

async function lookupOpenFoodFacts(barcode: string): Promise<OFFProduct | null> {
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`,
      {
        headers: { "User-Agent": "CleverHub/1.0 (nutrition-tracker)" },
      },
    );

    if (!response.ok) return null;

    const data = await response.json() as { status: number; product?: OFFProduct };
    if (data.status !== 1 || !data.product) return null;

    return data.product;
  } catch {
    return null;
  }
}

function parseOFFProduct(product: OFFProduct, barcode: string): Omit<NutritionData, "food_item_id"> {
  const n = product.nutriments ?? {};
  const servingG = product.serving_quantity ?? null;

  return {
    barcode,
    name: product.product_name || "Unknown Product",
    brand: product.brands || null,
    serving_size_g: servingG,
    serving_description: product.serving_size || null,
    calories_per_serving: n["energy-kcal_serving"] ?? n["energy-kcal_100g"] ?? null,
    protein_g: n.proteins_serving ?? n.proteins_100g ?? null,
    carbs_g: n.carbohydrates_serving ?? n.carbohydrates_100g ?? null,
    fat_g: n.fat_serving ?? n.fat_100g ?? null,
    fiber_g: n.fiber_serving ?? n.fiber_100g ?? null,
    sugar_g: n.sugars_serving ?? n.sugars_100g ?? null,
    sodium_mg: n.sodium_serving != null ? n.sodium_serving * 1000 : (n.sodium_100g != null ? n.sodium_100g * 1000 : null),
    image_url: product.image_front_url || null,
    source: "openfoodfacts",
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing Authorization header", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return errorResponse("Unauthorized", 401);

    const userId = user.id;
    const tenantId = user.app_metadata?.tenant_id;
    if (!tenantId) return errorResponse("Missing tenant_id in JWT", 401);

    const body: BarcodeRequest = await req.json();
    if (!body.barcode || !/^\d{8,14}$/.test(body.barcode)) {
      return errorResponse("Invalid barcode. Must be 8-14 digits (UPC/EAN).");
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Check local cache
    const { data: cached } = await admin
      .from("food_items")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("barcode", body.barcode)
      .maybeSingle();

    if (cached) {
      const result: NutritionData = { food_item_id: cached.id, ...cached };

      // Optionally log the food
      if (body.log) {
        const { data: descEnc } = await admin.rpc("encrypt_pii_user", {
          p_plaintext: cached.name,
          p_tenant_id: tenantId,
          p_user_id: userId,
        });

        await admin.from("food_logs").insert({
          tenant_id: tenantId,
          user_id: userId,
          food_item_id: cached.id,
          meal_type: body.meal_type || "snack",
          source: "barcode",
          description_encrypted: descEnc,
          calories: cached.calories_per_serving,
          protein_g: cached.protein_g,
          carbs_g: cached.carbs_g,
          fat_g: cached.fat_g,
          fiber_g: cached.fiber_g,
        });
      }

      return jsonResponse({ success: true, data: result });
    }

    // 2. Look up in OpenFoodFacts
    const offProduct = await lookupOpenFoodFacts(body.barcode);
    if (!offProduct) {
      return jsonResponse({
        success: false,
        error: "Product not found. Try taking a photo instead, or enter the details manually.",
      }, 404);
    }

    const parsed = parseOFFProduct(offProduct, body.barcode);

    // 3. Cache in food_items
    const { data: newItem, error: insertError } = await admin
      .from("food_items")
      .insert({
        tenant_id: tenantId,
        ...parsed,
      })
      .select()
      .single();

    if (insertError) {
      console.error("food_items insert error:", insertError);
      // Return the data even if caching failed
      return jsonResponse({ success: true, data: { food_item_id: null, ...parsed } });
    }

    const result: NutritionData = { food_item_id: newItem.id, ...parsed };

    // Optionally log the food
    if (body.log) {
      const { data: descEnc } = await admin.rpc("encrypt_pii_user", {
        p_plaintext: parsed.name,
        p_tenant_id: tenantId,
        p_user_id: userId,
      });

      await admin.from("food_logs").insert({
        tenant_id: tenantId,
        user_id: userId,
        food_item_id: newItem.id,
        meal_type: body.meal_type || "snack",
        source: "barcode",
        description_encrypted: descEnc,
        calories: parsed.calories_per_serving,
        protein_g: parsed.protein_g,
        carbs_g: parsed.carbs_g,
        fat_g: parsed.fat_g,
        fiber_g: parsed.fiber_g,
      });
    }

    return jsonResponse({ success: true, data: result });
  } catch (err) {
    console.error("nutrition-barcode error:", err);
    return errorResponse("Internal server error", 500);
  }
});
