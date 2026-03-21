"use client";

import { createContext, useContext } from "react";
import type { User, Tenant } from "@clever/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Global auth context available throughout the app */
export interface AuthContextValue {
  user: User | null;
  tenant: Tenant | null;
  supabase: SupabaseClient;
  loading: boolean;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuthContext must be used within AuthProvider");
  }
  return ctx;
}
