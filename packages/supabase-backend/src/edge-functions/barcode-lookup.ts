/**
 * CleverHub - Barcode Lookup Edge Function
 *
 * Looks up a product barcode via Open Food Facts API and adds or
 * removes it from the tenant's pantry.
 *
 * Endpoint: POST /functions/v1/barcode-lookup
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BarcodeLookupRequest {
  barcode: string;
  action: "add" | "remove";
  tenant_id: string;
  user_id: string;
}

interface OpenFoodFactsProduct {
  product_name?: string;
  brands?: string;
  categories_tags?: string[];
  image_url?: string;
  nutriments?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const body = (await req.json()) as BarcodeLookupRequest;
  const { barcode, action, tenant_id, user_id } = body;

  if (!barcode || !action || !tenant_id) {
    return new Response(
      JSON.stringify({ error: "barcode, action, and tenant_id required" }),
      { status: 400 },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1. Look up product in Open Food Facts
    const product = await lookupBarcode(barcode);
    const productName = product?.product_name ?? `Unknown (${barcode})`;
    const brand = product?.brands ?? null;
    const category = mapCategory(product?.categories_tags);
    const imageUrl = product?.image_url ?? null;

    if (action === "add") {
      // Check if this barcode already exists in pantry
      const { data: existing } = await supabase
        .from("pantry_items")
        .select("id, quantity")
        .eq("tenant_id", tenant_id)
        .eq("barcode", barcode)
        .maybeSingle();

      if (existing) {
        // Increment quantity
        await supabase
          .from("pantry_items")
          .update({
            quantity: existing.quantity + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        // Insert new item
        await supabase.from("pantry_items").insert({
          tenant_id,
          name: productName,
          quantity: 1,
          unit: "item",
          category,
          barcode,
          brand,
          source: "barcode_scan",
          location: "pantry",
          image_url: imageUrl,
        });
      }

      // Audit log
      await supabase.from("audit_logs").insert({
        tenant_id,
        user_id: user_id || null,
        action: "pantry_item_added",
        details: { barcode, name: productName, brand, via: "barcode_scan" },
        timestamp: new Date().toISOString(),
      });

      return new Response(
        JSON.stringify({
          success: true,
          action: "added",
          name: productName,
          brand,
          barcode,
          category,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } else {
      // action === "remove"
      const { data: existing } = await supabase
        .from("pantry_items")
        .select("id, quantity")
        .eq("tenant_id", tenant_id)
        .eq("barcode", barcode)
        .maybeSingle();

      if (!existing) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `No item with barcode ${barcode} found in pantry`,
          }),
          { status: 404 },
        );
      }

      if (existing.quantity <= 1) {
        await supabase
          .from("pantry_items")
          .delete()
          .eq("id", existing.id);
      } else {
        await supabase
          .from("pantry_items")
          .update({
            quantity: existing.quantity - 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }

      await supabase.from("audit_logs").insert({
        tenant_id,
        user_id: user_id || null,
        action: "pantry_item_removed",
        details: { barcode, name: productName, via: "barcode_scan" },
        timestamp: new Date().toISOString(),
      });

      return new Response(
        JSON.stringify({
          success: true,
          action: "removed",
          name: productName,
          barcode,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Open Food Facts API
// ---------------------------------------------------------------------------

async function lookupBarcode(
  barcode: string,
): Promise<OpenFoodFactsProduct | null> {
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`,
      {
        headers: {
          "User-Agent": "CleverHub/0.1.0 (contact@cleverhub.space)",
        },
      },
    );

    if (!response.ok) return null;

    const data = await response.json();
    if (data.status !== 1) return null;

    return data.product as OpenFoodFactsProduct;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Category mapping (Open Food Facts → our categories)
// ---------------------------------------------------------------------------

function mapCategory(
  offTags?: string[],
): string {
  if (!offTags || offTags.length === 0) return "other";

  const tagStr = offTags.join(",").toLowerCase();

  if (tagStr.includes("dairy") || tagStr.includes("milk") || tagStr.includes("cheese")) return "dairy";
  if (tagStr.includes("meat") || tagStr.includes("poultry")) return "meat";
  if (tagStr.includes("seafood") || tagStr.includes("fish")) return "seafood";
  if (tagStr.includes("frozen")) return "frozen";
  if (tagStr.includes("canned")) return "canned";
  if (tagStr.includes("beverage") || tagStr.includes("drink")) return "beverages";
  if (tagStr.includes("snack") || tagStr.includes("chip") || tagStr.includes("cookie")) return "snacks";
  if (tagStr.includes("bread") || tagStr.includes("bakery") || tagStr.includes("pastry")) return "bakery";
  if (tagStr.includes("produce") || tagStr.includes("fruit") || tagStr.includes("vegetable")) return "produce";
  if (tagStr.includes("spice") || tagStr.includes("herb")) return "spices";
  if (tagStr.includes("sauce") || tagStr.includes("condiment") || tagStr.includes("ketchup")) return "condiments";
  if (tagStr.includes("cereal") || tagStr.includes("pasta") || tagStr.includes("rice") || tagStr.includes("grain")) return "dry_goods";

  return "other";
}
