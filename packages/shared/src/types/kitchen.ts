/** Kitchen Sub-Hub types — ePantry, shopping list, receipt scanning, timers */

import type { TenantId, UserId } from "./tenant.js";

// ---------------------------------------------------------------------------
// Branded IDs
// ---------------------------------------------------------------------------

export type PantryItemId = string & { readonly __brand: "PantryItemId" };
export type ShoppingListItemId = string & {
  readonly __brand: "ShoppingListItemId";
};
export type ReceiptId = string & { readonly __brand: "ReceiptId" };
export type PantryPhotoId = string & { readonly __brand: "PantryPhotoId" };

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type PantryItemCategory =
  | "produce"
  | "dairy"
  | "meat"
  | "seafood"
  | "frozen"
  | "canned"
  | "dry_goods"
  | "bakery"
  | "beverages"
  | "snacks"
  | "condiments"
  | "spices"
  | "household"
  | "personal_care"
  | "other";

export type PantryItemSource =
  | "receipt_scan"
  | "barcode_scan"
  | "photo_analysis"
  | "voice"
  | "manual"
  | "shopping_list_purchased";

export type PantryLocation = "pantry" | "fridge" | "freezer" | "other";

export type ShoppingListAddedVia =
  | "voice"
  | "dashboard"
  | "mobile"
  | "auto_restock";

export type ShoppingListPriority = "low" | "normal" | "high";

export type ProcessingStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

// ---------------------------------------------------------------------------
// Pantry
// ---------------------------------------------------------------------------

export interface PantryItem {
  id: PantryItemId;
  tenant_id: TenantId;
  name: string;
  quantity: number;
  unit: string;
  category: PantryItemCategory;
  barcode: string | null;
  brand: string | null;
  expiry_date: string | null;
  added_date: string;
  source: PantryItemSource;
  location: PantryLocation;
  notes: string | null;
  image_url: string | null;
  min_stock_threshold: number | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Shopping List
// ---------------------------------------------------------------------------

export interface ShoppingListItem {
  id: ShoppingListItemId;
  tenant_id: TenantId;
  name: string;
  quantity: number;
  unit: string | null;
  category: PantryItemCategory | null;
  checked: boolean;
  added_by: UserId;
  added_via: ShoppingListAddedVia;
  notes: string | null;
  priority: ShoppingListPriority;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Receipt Scanning
// ---------------------------------------------------------------------------

export interface ReceiptLineItem {
  name: string;
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
  barcode: string | null;
  category: PantryItemCategory | null;
  matched_pantry_item_id: PantryItemId | null;
}

export interface Receipt {
  id: ReceiptId;
  tenant_id: TenantId;
  image_url: string;
  store_name: string | null;
  purchase_date: string | null;
  total: number | null;
  items_extracted: ReceiptLineItem[];
  processing_status: ProcessingStatus;
  error_message: string | null;
  scanned_by: UserId;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Pantry Photo Analysis
// ---------------------------------------------------------------------------

export interface IdentifiedItem {
  name: string;
  estimated_quantity: number | null;
  confidence: number;
  category: PantryItemCategory | null;
}

export interface PantryPhotoAnalysis {
  id: PantryPhotoId;
  tenant_id: TenantId;
  image_url: string;
  location: PantryLocation;
  identified_items: IdentifiedItem[];
  processing_status: ProcessingStatus;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Kitchen Timers (local to kitchen hub, not persisted to DB)
// ---------------------------------------------------------------------------

export interface KitchenTimer {
  id: string;
  label: string | null;
  duration_seconds: number;
  remaining_seconds: number;
  started_at: number;
  status: "running" | "paused" | "completed";
}

// ---------------------------------------------------------------------------
// Recipe Suggestions
// ---------------------------------------------------------------------------

export interface RecipeSuggestion {
  title: string;
  ingredients_used: string[];
  missing_ingredients: string[];
  prep_time_minutes: number;
  difficulty: "easy" | "medium" | "hard";
  instructions_summary: string;
}
