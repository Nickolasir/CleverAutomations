/**
 * Nutrition Tracking Types
 *
 * Type definitions for the nutrition tracking sub-agent: food logging,
 * daily goals, hydration, and vision AI food photo analysis.
 */

import type { TenantId, UserId } from "./tenant.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "drink";

export type NutritionLogSource =
  | "voice"
  | "chat"
  | "photo"
  | "barcode"
  | "manual"
  | "pantry_consumed";

// ---------------------------------------------------------------------------
// Food item (cached product reference)
// ---------------------------------------------------------------------------

export interface FoodItem {
  id: string;
  tenant_id: TenantId;
  barcode: string | null;
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
  source: string;
  openfoodfacts_id: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Food log (personal health data)
// ---------------------------------------------------------------------------

export interface FoodLog {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  food_item_id: string | null;
  meal_type: MealType;
  source: NutritionLogSource;
  /** Decrypted description (only available to the owning user) */
  description: string;
  serving_quantity: number;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  photo_url: string | null;
  pantry_item_id: string | null;
  logged_at: string;
  notes: string | null;
  created_at: string;
}

/** Input for creating a food log entry */
export interface FoodLogCreateInput {
  meal_type: MealType;
  source: NutritionLogSource;
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

// ---------------------------------------------------------------------------
// Nutrition goals
// ---------------------------------------------------------------------------

export interface NutritionGoals {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  daily_calories: number | null;
  daily_protein_g: number | null;
  daily_carbs_g: number | null;
  daily_fat_g: number | null;
  daily_fiber_g: number | null;
  daily_water_ml: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NutritionGoalsInput {
  daily_calories?: number;
  daily_protein_g?: number;
  daily_carbs_g?: number;
  daily_fat_g?: number;
  daily_fiber_g?: number;
  daily_water_ml?: number;
}

// ---------------------------------------------------------------------------
// Water log
// ---------------------------------------------------------------------------

export interface WaterLog {
  id: string;
  tenant_id: TenantId;
  user_id: UserId;
  amount_ml: number;
  logged_at: string;
  source: NutritionLogSource;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface DailyNutritionSummary {
  date: string;
  total_calories: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  total_fiber_g: number;
  total_water_ml: number;
  food_entries_count: number;
  water_entries_count: number;
  /** Percentage of goals met (null if no goals set) */
  goals_progress?: {
    calories_pct: number | null;
    protein_pct: number | null;
    carbs_pct: number | null;
    fat_pct: number | null;
    fiber_pct: number | null;
    water_pct: number | null;
  };
}

export interface WeeklyNutritionSummary {
  week_start: string;
  days: DailyNutritionSummary[];
  /** Average daily totals across the week */
  averages: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
    water_ml: number;
  };
}

// ---------------------------------------------------------------------------
// Vision AI food photo analysis
// ---------------------------------------------------------------------------

export interface IdentifiedFoodItem {
  name: string;
  estimated_portion: string;       // "1 cup", "2 slices", "medium bowl"
  estimated_calories: number;
  estimated_protein_g: number;
  estimated_carbs_g: number;
  estimated_fat_g: number;
  confidence: number;              // 0.0 - 1.0
}

export interface FoodPhotoAnalysisResult {
  items: IdentifiedFoodItem[];
  total_estimated_calories: number;
  total_estimated_protein_g: number;
  total_estimated_carbs_g: number;
  total_estimated_fat_g: number;
  meal_type_suggestion: MealType;
  analysis_notes: string;
}

// ---------------------------------------------------------------------------
// LLM intent extraction (from voice/chat)
// ---------------------------------------------------------------------------

export interface NutritionIntentData {
  /** Foods mentioned by the user */
  items: Array<{
    name: string;
    quantity?: number;
    unit?: string;                  // "cups", "slices", "pieces"
    estimated_calories?: number;
    estimated_protein_g?: number;
    estimated_carbs_g?: number;
    estimated_fat_g?: number;
  }>;
  meal_type: MealType;
  /** When the food was consumed (ISO timestamp or null for "just now") */
  consumed_at: string | null;
}
