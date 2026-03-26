/**
 * Nutrition Log Edge Function
 *
 * CRUD for food log entries and daily/weekly summaries.
 *
 * Endpoints:
 *   POST   /functions/v1/nutrition-log           — create food log entry
 *   GET    /functions/v1/nutrition-log?date=      — get daily summary
 *   GET    /functions/v1/nutrition-log?weekly=     — get weekly summary
 *   POST   /functions/v1/nutrition-log?action=water — log water intake
 *   GET    /functions/v1/nutrition-log?action=goals — get nutrition goals
 *   POST   /functions/v1/nutrition-log?action=goals — set nutrition goals
 *
 * Security:
 *   - Requires valid JWT with tenant_id claim
 *   - Requires active nutrition_data consent (GDPR Art 9)
 *   - User-only RLS: no admin access to personal food logs
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

interface FoodLogBody {
  meal_type: string;
  source: string;
  description: string;
  serving_quantity?: number;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  food_item_id?: string;
  photo_url?: string;
  pantry_item_id?: string;
  logged_at?: string;
  notes?: string;
}

interface WaterLogBody {
  amount_ml: number;
  source?: string;
}

interface GoalsBody {
  daily_calories?: number;
  daily_protein_g?: number;
  daily_carbs_g?: number;
  daily_fat_g?: number;
  daily_fiber_g?: number;
  daily_water_ml?: number;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
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

    // Check nutrition consent
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: hasConsent } = await admin.rpc("check_nutrition_consent", {
      p_user_id: userId,
    });

    if (!hasConsent) {
      return errorResponse(
        "Nutrition data consent required. Please enable nutrition tracking in Privacy settings.",
        403,
      );
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // -----------------------------------------------------------------------
    // GET requests
    // -----------------------------------------------------------------------
    if (req.method === "GET") {
      // Daily summary
      const dateParam = url.searchParams.get("date");
      if (dateParam || !action) {
        const date = dateParam || new Date().toISOString().split("T")[0];
        const { data: summary, error: summaryError } = await admin.rpc(
          "get_daily_nutrition_summary",
          { p_user_id: userId, p_tenant_id: tenantId, p_date: date },
        );

        if (summaryError) return errorResponse("Failed to get daily summary", 500);
        return jsonResponse({ success: true, data: { date, ...summary?.[0] } });
      }

      // Weekly summary
      if (url.searchParams.has("weekly")) {
        const start = url.searchParams.get("weekly") || undefined;
        const { data: weekly, error: weeklyError } = await admin.rpc(
          "get_weekly_nutrition_summary",
          { p_user_id: userId, p_tenant_id: tenantId, ...(start && { p_week_start: start }) },
        );

        if (weeklyError) return errorResponse("Failed to get weekly summary", 500);
        return jsonResponse({ success: true, data: weekly });
      }

      // Goals
      if (action === "goals") {
        const { data: goals, error: goalsError } = await supabase
          .from("nutrition_goals")
          .select("*")
          .eq("user_id", userId)
          .eq("tenant_id", tenantId)
          .maybeSingle();

        if (goalsError) return errorResponse("Failed to get goals", 500);
        return jsonResponse({ success: true, data: goals });
      }

      return errorResponse("Invalid GET request");
    }

    // -----------------------------------------------------------------------
    // POST requests
    // -----------------------------------------------------------------------
    if (req.method !== "POST") return errorResponse("Method not allowed", 405);

    const body = await req.json();

    // Water log
    if (action === "water") {
      const waterBody = body as WaterLogBody;
      if (!waterBody.amount_ml || waterBody.amount_ml <= 0) {
        return errorResponse("amount_ml must be a positive number");
      }

      const { data: waterLog, error: waterError } = await supabase
        .from("water_logs")
        .insert({
          tenant_id: tenantId,
          user_id: userId,
          amount_ml: waterBody.amount_ml,
          source: waterBody.source || "manual",
        })
        .select()
        .single();

      if (waterError) return errorResponse("Failed to log water", 500);
      return jsonResponse({ success: true, data: waterLog }, 201);
    }

    // Set goals
    if (action === "goals") {
      const goalsBody = body as GoalsBody;
      const { data: goals, error: goalsError } = await supabase
        .from("nutrition_goals")
        .upsert(
          {
            tenant_id: tenantId,
            user_id: userId,
            ...goalsBody,
          },
          { onConflict: "tenant_id,user_id" },
        )
        .select()
        .single();

      if (goalsError) return errorResponse("Failed to set goals", 500);

      // Audit log
      await admin.from("audit_logs").insert({
        tenant_id: tenantId,
        user_id: userId,
        action: "nutrition_goal_set",
        details: goalsBody,
      });

      return jsonResponse({ success: true, data: goals });
    }

    // Food log entry
    const logBody = body as FoodLogBody;
    if (!logBody.meal_type || !logBody.description) {
      return errorResponse("meal_type and description are required");
    }

    // Encrypt description and notes with per-user key
    const { data: descEncrypted } = await admin.rpc("encrypt_pii_user", {
      p_plaintext: logBody.description,
      p_tenant_id: tenantId,
      p_user_id: userId,
    });

    let notesEncrypted = null;
    if (logBody.notes) {
      const { data } = await admin.rpc("encrypt_pii_user", {
        p_plaintext: logBody.notes,
        p_tenant_id: tenantId,
        p_user_id: userId,
      });
      notesEncrypted = data;
    }

    const { data: foodLog, error: logError } = await admin
      .from("food_logs")
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        food_item_id: logBody.food_item_id || null,
        meal_type: logBody.meal_type,
        source: logBody.source || "manual",
        description_encrypted: descEncrypted,
        serving_quantity: logBody.serving_quantity ?? 1,
        calories: logBody.calories,
        protein_g: logBody.protein_g,
        carbs_g: logBody.carbs_g,
        fat_g: logBody.fat_g,
        fiber_g: logBody.fiber_g,
        photo_url: logBody.photo_url,
        pantry_item_id: logBody.pantry_item_id,
        logged_at: logBody.logged_at || new Date().toISOString(),
        notes_encrypted: notesEncrypted,
      })
      .select("id, meal_type, source, serving_quantity, calories, protein_g, carbs_g, fat_g, fiber_g, logged_at, created_at")
      .single();

    if (logError) {
      console.error("Food log insert error:", logError);
      return errorResponse("Failed to log food", 500);
    }

    // Audit log
    await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      user_id: userId,
      action: "nutrition_log_created",
      details: { meal_type: logBody.meal_type, source: logBody.source },
    });

    return jsonResponse({ success: true, data: foodLog }, 201);
  } catch (err) {
    console.error("nutrition-log error:", err);
    return errorResponse("Internal server error", 500);
  }
});
