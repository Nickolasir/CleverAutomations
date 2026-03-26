"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";

/**
 * Signup page: collects only email + password.
 * After email confirmation, the auth callback redirects to /auth/onboarding
 * where the user fills out their profile and property details.
 */
export default function SignupPage() {
  const supabase = createBrowserClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      if (!authData.user) {
        setError("Failed to create user account");
        return;
      }

      // If email confirmation is required, signUp returns a user but no session
      if (!authData.session) {
        setSuccess(
          "Check your email! We sent a confirmation link to " +
            email +
            ". After confirming, you'll set up your property."
        );
        return;
      }

      // If no email confirmation required (e.g. dev mode), go straight to onboarding
      window.location.href = "/auth/onboarding";
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo / Branding */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-brand-600 text-2xl font-bold text-white">
            CA
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            Create your account
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Sign up to get started with CleverHub
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleSignup} className="space-y-5">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {success && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                {success}
              </div>
            )}

            {!success && (
              <>
                <div>
                  <label htmlFor="signup-email" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Email address
                  </label>
                  <input
                    id="signup-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                    autoComplete="email"
                    className="input-field"
                  />
                </div>

                <div>
                  <label htmlFor="signup-password" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Password
                  </label>
                  <input
                    id="signup-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="input-field"
                  />
                </div>

                <div>
                  <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Confirm password
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="input-field"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Creating account...
                    </span>
                  ) : (
                    "Create account"
                  )}
                </button>
              </>
            )}
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link
            href="/auth/login"
            className="font-semibold text-brand-600 hover:text-brand-500"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
