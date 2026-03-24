/** Multi-tenant types — every DB row includes tenant_id for RLS */

export type TenantId = string & { readonly __brand: "TenantId" };
export type UserId = string & { readonly __brand: "UserId" };

export type MarketVertical = "clever_home" | "clever_host" | "clever_building";

export type UserRole = "owner" | "admin" | "manager" | "resident" | "guest";

export interface Tenant {
  id: TenantId;
  name: string;
  vertical: MarketVertical;
  subscription_tier: "starter" | "professional" | "enterprise";
  settings: TenantSettings;
  created_at: string;
  updated_at: string;
}

export interface TenantSettings {
  voice_enabled: boolean;
  max_devices: number;
  max_users: number;
  guest_wipe_enabled: boolean;
  audit_retention_days: number;
}

export interface User {
  id: UserId;
  tenant_id: TenantId;
  email: string;
  role: UserRole;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface JwtClaims {
  sub: UserId;
  tenant_id: TenantId;
  user_role: UserRole;
  device_scope?: string;
  /** Family age group (set when user has a family_member_profile) */
  family_age_group?: import("./family.js").FamilyAgeGroup;
  /** Family member profile ID */
  family_profile_id?: string;
  /** Personal agent wake word name (e.g., "Jarvis", "Luna") */
  agent_name?: string;
  iat: number;
  exp: number;
}
