"use client";

import { useContext } from "react";
import { AuthContext } from "@/lib/auth-context";
import type { User, Tenant, UserRole, TenantId, UserId } from "@clever/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Auth hook providing the current user, tenant, and role-based helpers.
 * Wraps AuthContext with convenience methods for permission checks.
 */
interface UseAuthReturn {
  user: User | null;
  tenant: Tenant | null;
  tenantId: TenantId | null;
  userId: UserId | null;
  supabase: SupabaseClient;
  role: UserRole | null;
  loading: boolean;
  isAuthenticated: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  isManager: boolean;
  canManageUsers: boolean;
  canManageDevices: boolean;
  canViewAuditLog: boolean;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error("useAuth must be used within the AuthProvider (RootLayout)");
  }

  const { user, tenant, supabase, loading, signOut } = ctx;
  const role = user?.role ?? null;

  /** Role hierarchy: owner > admin > manager > resident > guest */
  const roleWeight = (r: UserRole | null): number => {
    switch (r) {
      case "owner":
        return 5;
      case "admin":
        return 4;
      case "manager":
        return 3;
      case "resident":
        return 2;
      case "guest":
        return 1;
      default:
        return 0;
    }
  };

  const hasMinRole = (minRole: UserRole): boolean => roleWeight(role) >= roleWeight(minRole);

  return {
    user,
    tenant,
    tenantId: user?.tenant_id ?? null,
    userId: (user?.id as UserId) ?? null,
    supabase,
    role,
    loading,
    isAuthenticated: !!user,
    isOwner: role === "owner",
    isAdmin: hasMinRole("admin"),
    isManager: hasMinRole("manager"),
    canManageUsers: hasMinRole("admin"),
    canManageDevices: hasMinRole("manager"),
    canViewAuditLog: hasMinRole("admin"),
    signOut,
  };
}
