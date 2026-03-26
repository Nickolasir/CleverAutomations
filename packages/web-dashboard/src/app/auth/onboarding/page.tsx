"use client";

import React, { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { MarketVertical } from "@clever/shared";
import { createBrowserClient } from "@/lib/supabase/client";

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

const VERTICALS: {
  value: MarketVertical;
  label: string;
  tagline: string;
  features: string[];
  icon: React.ReactNode;
}[] = [
  {
    value: "clever_home",
    label: "CleverHome",
    tagline: "Smart Home for Families",
    features: [
      "Named voice agents per family member",
      "Age-based permissions & parental controls",
      "Bedtime & school-hour schedules",
      "Sub-1-second local voice processing",
    ],
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    value: "clever_host",
    label: "CleverHost",
    tagline: "Short-Term Rental Management",
    features: [
      "Guest lifecycle automation",
      "Automatic profile wipe between stays",
      "Staff role management",
      "WiFi, lock & media reset per turnover",
    ],
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
      </svg>
    ),
  },
  {
    value: "clever_building",
    label: "CleverBuilding",
    tagline: "Smart Building Management",
    features: [
      "Multi-tenant unit management",
      "Staff access controls",
      "Building-wide automations",
      "Centralized device monitoring",
    ],
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
      </svg>
    ),
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createBrowserClient();

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [vertical, setVertical] = useState<MarketVertical | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 3: Notification channel state
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [whatsappSent, setWhatsappSent] = useState(false);
  const [whatsappVerified, setWhatsappVerified] = useState(false);
  const [telegramLinkUrl, setTelegramLinkUrl] = useState<string | null>(null);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [notifyDeviceOffline, setNotifyDeviceOffline] = useState(true);
  const [notifySecurityAlert, setNotifySecurityAlert] = useState(true);
  const [notifyGuestArrival, setNotifyGuestArrival] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    if (!vertical) return;
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
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally { setLoading(false); }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  /** Generate a Telegram deep link and start polling for verification */
  const handleLinkTelegram = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/telegram-link/generate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );
      const json = await res.json();
      if (json.success && json.data?.deep_link_url) {
        setTelegramLinkUrl(json.data.deep_link_url);

        // Poll for verification every 3 seconds for up to 2 minutes
        let elapsed = 0;
        pollRef.current = setInterval(async () => {
          elapsed += 3000;
          if (elapsed > 120_000) {
            if (pollRef.current) clearInterval(pollRef.current);
            return;
          }
          const statusRes = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/telegram-link/status`,
            {
              headers: { Authorization: `Bearer ${session.access_token}` },
            },
          );
          const statusJson = await statusRes.json();
          if (statusJson.data?.linked) {
            setTelegramLinked(true);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        }, 3000);
      }
    } catch {
      // Silently fail — this step is optional
    }
  };

  /** Send WhatsApp verification and start polling */
  const handleVerifyWhatsApp = async () => {
    if (!E164_REGEX.test(whatsappPhone)) {
      setError("Phone must be in E.164 format (e.g. +15551234567)");
      return;
    }
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/whatsapp-verify`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ phone: whatsappPhone }),
        },
      );
      const json = await res.json();
      if (json.success) {
        setWhatsappSent(true);

        // Poll for verification every 3 seconds for up to 2 minutes
        const { data: { session: s } } = await supabase.auth.getSession();
        let elapsed = 0;
        const waPoll = setInterval(async () => {
          elapsed += 3000;
          if (elapsed > 120_000) { clearInterval(waPoll); return; }
          const statusRes = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/whatsapp-verify/status`,
            { headers: { Authorization: `Bearer ${s?.access_token ?? session.access_token}` } },
          );
          const statusJson = await statusRes.json();
          if (statusJson.data?.verified) {
            setWhatsappVerified(true);
            clearInterval(waPoll);
          }
        }, 3000);
      }
    } catch {
      // Silently fail — this step is optional
    }
  };

  /** Complete onboarding — save notification preferences and go to dashboard */
  const handleCompleteNotifications = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/dashboard"); return; }

      // Build preferred channels
      const channels: string[] = ["push"];
      if (telegramLinked) channels.push("telegram");
      if (whatsappVerified || whatsappSent) channels.push("whatsapp");

      // Check if preferences already exist (created by verify/link flows)
      const { data: existing } = await supabase
        .from("user_messaging_preferences")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();

      const payload = {
        notify_device_offline: notifyDeviceOffline,
        notify_security_alert: notifySecurityAlert,
        notify_guest_arrival: notifyGuestArrival,
        preferred_channels: channels,
      };

      if (existing) {
        await supabase
          .from("user_messaging_preferences")
          .update(payload)
          .eq("id", existing.id);
      }
      // If no row exists and no channels were linked, skip insert
    } catch {
      // Non-fatal — just proceed to dashboard
    }
    router.push("/dashboard");
    router.refresh();
  };

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-secondary">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
          <p className="text-sm text-slate-500">Verifying your account...</p>
        </div>
      </div>
    );
  }

  const stepLabels = ["Choose Experience", "Property Details", "Notifications"];
  const currentStep = step - 1;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-4 py-12">
      <div className={`w-full ${step === 1 ? "max-w-3xl" : "max-w-lg"}`}>
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-brand-600 text-2xl font-bold text-white">
            CA
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {step === 1
              ? "Choose Your Experience"
              : step === 2
                ? "Set Up Your Property"
                : "Set Up Notifications"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {step === 1
              ? "Select the scenario that best fits your needs."
              : step === 2
                ? `Setting up ${VERTICALS.find((v) => v.value === vertical)?.label ?? "your property"}`
                : "Connect your messaging apps to receive alerts (optional)"}
          </p>
        </div>

        {/* Step indicator */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {stepLabels.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && (
                <div className={`h-px w-8 ${i <= currentStep ? "bg-brand-600" : "bg-slate-200"}`} />
              )}
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                    i < currentStep
                      ? "bg-brand-600 text-white"
                      : i === currentStep
                        ? "bg-brand-600 text-white"
                        : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {i < currentStep ? "\u2713" : i + 1}
                </div>
                <span
                  className={`text-sm font-medium ${
                    i === currentStep ? "text-slate-900" : "text-slate-400"
                  }`}
                >
                  {label}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Step 1: Visual vertical selection */}
        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-3">
            {VERTICALS.map((v) => {
              const selected = vertical === v.value;
              return (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => setVertical(v.value)}
                  className={`group relative flex flex-col rounded-2xl border-2 p-6 text-left transition-all duration-200 ${
                    selected
                      ? "border-brand-500 bg-white shadow-lg ring-2 ring-brand-500/20"
                      : "border-slate-200 bg-white hover:border-brand-300 hover:shadow-md"
                  }`}
                >
                  {/* Icon */}
                  <div
                    className={`mb-4 flex h-14 w-14 items-center justify-center rounded-xl transition-colors ${
                      selected ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-600 group-hover:bg-brand-100"
                    }`}
                  >
                    {v.icon}
                  </div>

                  {/* Title */}
                  <h3 className="text-lg font-bold text-slate-900">{v.label}</h3>
                  <p className="mt-1 text-sm text-slate-500">{v.tagline}</p>

                  {/* Features */}
                  <ul className="mt-4 flex-1 space-y-2">
                    {v.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs text-slate-600">
                        <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>

                  {/* Selected indicator */}
                  {selected && (
                    <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white">
                      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Continue button for step 1 */}
        {step === 1 && (
          <div className="mt-6 text-center">
            <button
              type="button"
              disabled={!vertical}
              onClick={() => setStep(2)}
              className="btn-primary px-12"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 2: Property details */}
        {step === 2 && (
          <div className="card">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
              )}

              <div>
                <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Your name
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Jane Smith"
                  required
                  className="input-field"
                />
              </div>

              <div>
                <label htmlFor="propertyName" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Property name
                </label>
                <input
                  id="propertyName"
                  type="text"
                  value={propertyName}
                  onChange={(e) => setPropertyName(e.target.value)}
                  placeholder={
                    vertical === "clever_host"
                      ? "Beach House Retreat"
                      : vertical === "clever_building"
                        ? "Parkview Apartments"
                        : "My Smart Home"
                  }
                  required
                  className="input-field"
                />
              </div>

              {/* Selected vertical summary */}
              {vertical && (
                <div className="flex items-center gap-3 rounded-lg bg-brand-50 p-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white">
                    {VERTICALS.find((v) => v.value === vertical)?.icon}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {VERTICALS.find((v) => v.value === vertical)?.label}
                    </p>
                    <p className="text-xs text-slate-500">
                      {VERTICALS.find((v) => v.value === vertical)?.tagline}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="ml-auto text-xs font-medium text-brand-600 hover:text-brand-700"
                  >
                    Change
                  </button>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="btn-secondary"
                >
                  Back
                </button>
                <button type="submit" disabled={loading} className="btn-primary flex-1">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Setting up your property...
                    </span>
                  ) : (
                    "Complete setup"
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
        {/* Step 3: Notifications (optional) */}
        {step === 3 && (
          <div className="card space-y-6">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            {/* Telegram */}
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500 text-white">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Telegram</p>
                  <p className="text-xs text-slate-500">Receive instant alerts via Telegram bot</p>
                </div>
                {telegramLinked && (
                  <span className="ml-auto rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                    Linked
                  </span>
                )}
              </div>
              {!telegramLinked && !telegramLinkUrl && (
                <button type="button" onClick={handleLinkTelegram} className="btn-secondary text-sm">
                  Link Telegram
                </button>
              )}
              {!telegramLinked && telegramLinkUrl && (
                <div className="space-y-2">
                  <a
                    href={telegramLinkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
                  >
                    Open in Telegram
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                  </a>
                  <p className="text-xs text-slate-500">
                    Tap START in Telegram, then wait for confirmation here.
                  </p>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
                    Waiting for link...
                  </div>
                </div>
              )}
            </div>

            {/* WhatsApp */}
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500 text-white">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">WhatsApp</p>
                  <p className="text-xs text-slate-500">Receive alerts via WhatsApp messages</p>
                </div>
                {whatsappVerified && (
                  <span className="ml-auto rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                    Verified
                  </span>
                )}
                {whatsappSent && !whatsappVerified && (
                  <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                    Pending
                  </span>
                )}
              </div>
              {!whatsappVerified && (
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={whatsappPhone}
                    onChange={(e) => setWhatsappPhone(e.target.value)}
                    placeholder="+15551234567"
                    disabled={whatsappSent}
                    className="input-field flex-1"
                  />
                  <button
                    type="button"
                    onClick={handleVerifyWhatsApp}
                    disabled={whatsappSent || !whatsappPhone}
                    className="btn-secondary text-sm whitespace-nowrap"
                  >
                    {whatsappSent ? "Sent" : "Verify"}
                  </button>
                </div>
              )}
              {whatsappSent && !whatsappVerified && (
                <p className="mt-2 text-xs text-slate-500">
                  A message was sent to {whatsappPhone}. Reply <strong>YES</strong> in WhatsApp to confirm.
                </p>
              )}
            </div>

            {/* Notification types */}
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-900">Alert Types</p>
              <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3">
                <span className="text-sm text-slate-700">Device offline alerts</span>
                <input
                  type="checkbox"
                  checked={notifyDeviceOffline}
                  onChange={(e) => setNotifyDeviceOffline(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3">
                <span className="text-sm text-slate-700">Security alerts</span>
                <input
                  type="checkbox"
                  checked={notifySecurityAlert}
                  onChange={(e) => setNotifySecurityAlert(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                />
              </label>
              {vertical === "clever_host" && (
                <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3">
                  <span className="text-sm text-slate-700">Guest arrival notifications</span>
                  <input
                    type="checkbox"
                    checked={notifyGuestArrival}
                    onChange={(e) => setNotifyGuestArrival(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                  />
                </label>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  router.push("/dashboard");
                  router.refresh();
                }}
                className="btn-secondary"
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={handleCompleteNotifications}
                className="btn-primary flex-1"
              >
                Complete Setup
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
