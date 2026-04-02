"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { User, Tenant, TenantId, UserId } from "@clever/shared";
import { createBrowserClient } from "@/lib/supabase/client";
import { AuthContext } from "@/lib/auth-context";

/** Applies CSS custom properties from tenant branding config */
function applyTenantTheme(tenant: Tenant): void {
  const settings = tenant.settings as unknown as Record<string, unknown>;
  const branding = settings?.branding as Record<string, string> | undefined;
  if (!branding) return;

  const root = document.documentElement;
  for (const [key, value] of Object.entries(branding)) {
    if (typeof value === "string" && key.startsWith("color-")) {
      root.style.setProperty("--" + key, value);
    }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createBrowserClient());
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const loadSession = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user) {
          const { data: profile } = await supabase
            .from("users")
            .select("*")
            .eq("id", session.user.id as unknown as UserId)
            .maybeSingle();

          if (!profile) {
            if (pathname.startsWith("/dashboard")) {
              router.replace("/auth/onboarding");
            }
            return;
          }
          setUser(profile as unknown as User);

          const { data: tenantData } = await supabase
            .from("tenants")
            .select("*")
            .eq("id", profile.tenant_id as unknown as TenantId)
            .maybeSingle();

          if (tenantData) {
            setTenant(tenantData as unknown as Tenant);
            applyTenantTheme(tenantData as unknown as Tenant);
          }
        }
      } catch (error) {
        console.error("Failed to load session:", error);
      } finally {
        setLoading(false);
      }
    };

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setTenant(null);
      } else if (session?.user) {
        void loadSession();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, router, pathname]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setTenant(null);
  };

  return (
    <AuthContext.Provider value={{ user, tenant, supabase, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
