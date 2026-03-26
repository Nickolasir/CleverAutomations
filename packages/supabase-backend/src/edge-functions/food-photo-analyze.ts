/**
 * Food Photo Analysis Edge Function
 *
 * Uses Claude Vision to identify foods in a photo and estimate
 * nutritional values (calories, protein, carbs, fat).
 *
 * Endpoint: POST /functions/v1/food-photo-analyze
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Requires nutrition_data consent
 *   - Rate limited: 20 analyses per day per user (cost control)
 *   - Does NOT store raw AI response (data minimization)
 */

import { createClient } from "@supabase/supabase-js";
import type { ApiResult } from "@clever/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAILY_ANALYSIS_LIMIT = 20;

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

interface AnalyzeRequest {
  /** Supabase Storage URL or public URL of the food photo */
  image_url: string;
}

interface IdentifiedFood {
  name: string;
  estimated_portion: string;
  estimated_calories: number;
  estimated_protein_g: number;
  estimated_carbs_g: number;
  estimated_fat_g: number;
  confidence: number;
}

interface AnalysisResult {
  items: IdentifiedFood[];
  total_estimated_calories: number;
  total_estimated_protein_g: number;
  total_estimated_carbs_g: number;
  total_estimated_fat_g: number;
  meal_type_suggestion: string;
  analysis_notes: string;
}

// ---------------------------------------------------------------------------
// Vision analysis prompt
// ---------------------------------------------------------------------------

const VISION_SYSTEM_PROMPT = `You are a nutrition analysis AI. Analyze the food photo and identify all visible food items.

For each item, estimate:
- Name of the food
- Portion size (e.g., "1 cup", "2 slices", "medium bowl")
- Calories, protein (g), carbs (g), fat (g)
- Your confidence level (0.0-1.0)

Also suggest the most likely meal_type: breakfast, lunch, dinner, snack, or drink.

Respond with ONLY valid JSON:
{
  "items": [
    { "name": "scrambled eggs", "estimated_portion": "2 large eggs", "estimated_calories": 182, "estimated_protein_g": 12, "estimated_carbs_g": 2, "estimated_fat_g": 14, "confidence": 0.9 }
  ],
  "total_estimated_calories": 182,
  "total_estimated_protein_g": 12,
  "total_estimated_carbs_g": 2,
  "total_estimated_fat_g": 14,
  "meal_type_suggestion": "breakfast",
  "analysis_notes": "Brief notes about the analysis"
}

Be as accurate as possible with calorie and macro estimates. Use standard USDA values where applicable.
If you cannot identify a food item clearly, note it with low confidence.`;

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

    // Check consent
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: hasConsent } = await admin.rpc("check_nutrition_consent", {
      p_user_id: userId,
    });
    if (!hasConsent) return errorResponse("Nutrition data consent required", 403);

    // Rate limit: count today's photo analyses
    const today = new Date().toISOString().split("T")[0];
    const { count: todayCount } = await admin
      .from("food_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .eq("source", "photo")
      .gte("created_at", `${today}T00:00:00Z`);

    if ((todayCount ?? 0) >= DAILY_ANALYSIS_LIMIT) {
      return errorResponse(
        `Daily photo analysis limit reached (${DAILY_ANALYSIS_LIMIT}/day). Try logging food by text or barcode instead.`,
        429,
      );
    }

    // Parse body
    const body: AnalyzeRequest = await req.json();
    if (!body.image_url) return errorResponse("image_url is required");

    // Call Claude Vision API
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) return errorResponse("Vision AI not configured", 503);

    const visionResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: VISION_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "url", url: body.image_url },
              },
              {
                type: "text",
                text: "Analyze this food photo. Identify all foods and estimate their nutritional values.",
              },
            ],
          },
        ],
      }),
    });

    if (!visionResponse.ok) {
      console.error("Claude Vision error:", await visionResponse.text());
      return errorResponse("Food photo analysis failed", 500);
    }

    const visionResult = await visionResponse.json() as {
      content: Array<{ type: string; text: string }>;
    };

    const textContent = visionResult.content.find((c) => c.type === "text");
    if (!textContent?.text) return errorResponse("No analysis result", 500);

    // Parse the structured response
    const analysis: AnalysisResult = JSON.parse(textContent.text);

    // Audit log (no raw response stored — data minimization)
    await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      user_id: userId,
      action: "food_photo_analyzed",
      details: {
        items_count: analysis.items.length,
        total_calories: analysis.total_estimated_calories,
      },
    });

    return jsonResponse({ success: true, data: analysis });
  } catch (err) {
    console.error("food-photo-analyze error:", err);
    return errorResponse("Internal server error", 500);
  }
});
