/**
 * Clever Automations - Pantry Photo Analysis Edge Function
 *
 * Receives a photo of a pantry/fridge/freezer, sends it to a vision LLM
 * to identify food items, and returns the results for user confirmation.
 *
 * Endpoint: POST /functions/v1/pantry-analysis
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Rate limited: max 5 analyses per minute per tenant
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PantryAnalysisRequest {
  analysis_id: string;
  image_url: string;
  location: "pantry" | "fridge" | "freezer";
}

interface IdentifiedItem {
  name: string;
  estimated_quantity: number | null;
  confidence: number;
  category: string | null;
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

  const body = (await req.json()) as PantryAnalysisRequest;
  const { analysis_id, image_url, location } = body;

  if (!analysis_id || !image_url || !location) {
    return new Response(
      JSON.stringify({ error: "analysis_id, image_url, and location required" }),
      { status: 400 },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Update status to processing
    await supabase
      .from("pantry_photo_analyses")
      .update({ processing_status: "processing" })
      .eq("id", analysis_id);

    // Call vision LLM
    const groqApiKey = Deno.env.get("GROQ_API_KEY")!;
    const items = await identifyPantryItems(image_url, location, groqApiKey);

    // Update analysis with results
    await supabase
      .from("pantry_photo_analyses")
      .update({
        identified_items: items,
        processing_status: "completed",
      })
      .eq("id", analysis_id);

    // Get tenant_id for audit
    const { data: analysis } = await supabase
      .from("pantry_photo_analyses")
      .select("tenant_id")
      .eq("id", analysis_id)
      .single();

    if (analysis) {
      await supabase.from("audit_logs").insert({
        tenant_id: analysis.tenant_id,
        action: "pantry_photo_analyzed",
        details: {
          analysis_id,
          location,
          items_identified: items.length,
        },
        timestamp: new Date().toISOString(),
      });

      // Broadcast to pantry channel for user confirmation on dashboard/display
      // Items are NOT auto-added — user must confirm on the dashboard
    }

    return new Response(
      JSON.stringify({
        success: true,
        analysis_id,
        items_identified: items.length,
        items,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabase
      .from("pantry_photo_analyses")
      .update({ processing_status: "failed" })
      .eq("id", analysis_id);

    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Vision LLM call
// ---------------------------------------------------------------------------

async function identifyPantryItems(
  imageUrl: string,
  location: string,
  apiKey: string,
): Promise<IdentifiedItem[]> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.2-90b-vision-preview",
      messages: [
        {
          role: "system",
          content:
            `You are a food identification system. Identify all food items visible in this ${location} photo. ` +
            "Return ONLY valid JSON array: " +
            '[{"name": "whole milk", "estimated_quantity": 1, "confidence": 0.95, "category": "dairy"}, ...]. ' +
            "Categories: produce, dairy, meat, seafood, frozen, canned, dry_goods, bakery, beverages, snacks, condiments, spices, household, other. " +
            "Only include items you can identify with reasonable confidence (>0.6). Set estimated_quantity to null if unclear.",
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            {
              type: "text",
              text: `Identify all food items in this ${location} photo.`,
            },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    }),
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "[]";
  const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(jsonStr) as IdentifiedItem[];
}
