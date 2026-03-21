"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { MarketVertical } from "@clever/shared";
import { createBrowserClient } from "@/lib/supabase/client";

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createBrowserClient();

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [displayName, setDisplayName] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [vertical, setVertical] = useState<MarketVertical>("clever_home");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const verticalOptions: { value: MarketVertical; label: string; description: string }[] = [
    { value: "clever_home", label: "CleverHome", description: "Smart home for new construction / homebuilders" },
    { value: "clever_host", label: "CleverHost", description: "Guest lifecycle automation for Airbnb / STR hosts" },
    { value: "clever_building", label: "CleverBuilding", description: "Multi-tenant smart building for apartment complexes" },
  ];

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/auth/login"); return; }

      const { data: existingProfile } = await supabase
        .from("users").select("id").eq("id", session.user.id).maybeSingle();

      if (existingProfile) { router.replace("/dashboard"); return; }

      setAuthUserId(session.user.id);
      setAuthEmail(session.user.email ?? "");
      setCheckingAuth(false);
    };
    void checkSession();
  }, [supabase, router]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (!authUserId || !authEmail) { setError("Session expired. Please sign in again."); return; }

      const { error: rpcError } = await supabase.rpc("create_tenant_with_owner", {
        p_auth_user_id: authUserId,
        p_tenant_name: propertyName,
        p_vertical: vertical,
        p_email: authEmail,
        p_display_name: displayName,
        p_tier: "starter",
      });

      if (rpcError) { setError("Failed to create property: " + rpcError.message); return; }

      await supabase.auth.refreshSession();
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally { setLoading(false); }
  };

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
          <p className="text-sm text-slate-500">Verifying your account...</p>
        </div>
      </div>
    );
  }

  const verticalClass = (isSelected: boolean) =>
    "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors " +
    (isSelected ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300");

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-brand-600 text-2xl font-bold text-white">
            CA
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Set up your property</h1>
          <p className="mt-2 text-sm text-slate-500">
            Welcome! Configure your smart home management.
          </p>
        </div>

        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">&#10003;</div>
            <span className="text-sm font-medium text-slate-500">Account</span>
          </div>
          <div className="h-px w-8 bg-brand-600" />
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">2</div>
            <span className="text-sm font-medium text-slate-900">Property Setup</span>
          </div>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <div>
              <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium text-slate-700">Your name</label>
              <input id="displayName" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Smith" required className="input-field" />
            </div>

            <div className="border-t border-slate-200 pt-5">
              <div className="space-y-4">
                <div>
                  <label htmlFor="propertyName" className="mb-1.5 block text-sm font-medium text-slate-700">Property name</label>
                  <input id="propertyName" type="text" value={propertyName} onChange={(e) => setPropertyName(e.target.value)} placeholder="My Smart Home" required className="input-field" />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Property type</label>
                  <div className="space-y-3">
                    {verticalOptions.map((opt) => (
                      <label key={opt.value} className={verticalClass(vertical === opt.value)}>
                        <input type="radio" name="vertical" value={opt.value} checked={vertical === opt.value} onChange={(e) => setVertical(e.target.value as MarketVertical)} className="mt-0.5 h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-600" />
                        <div>
                          <span className="block text-sm font-medium text-slate-900">{opt.label}</span>
                          <span className="block text-xs text-slate-500">{opt.description}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Setting up your property...
                </span>
              ) : "Complete setup"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
