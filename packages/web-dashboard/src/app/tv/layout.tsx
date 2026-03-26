"use client";

import { useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { TVFocusManager } from "@/components/tv/TVFocusManager";
import { TVNavBar } from "@/components/tv/TVNavBar";

/**
 * TV Dashboard layout — fullscreen dark theme, no sidebar.
 * Wraps content in TVFocusManager for D-pad navigation.
 * Uses the existing AuthProvider from the root layout.
 */

export default function TVLayout({ children }: { children: ReactNode }) {
  const { loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-tv-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-tv-surface border-t-tv-focus" />
          <p className="text-xl text-tv-muted">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <TVLoginScreen />;
  }

  return (
    <div className="flex flex-col h-screen bg-tv-bg overflow-hidden">
      <TVFocusManager>
        <TVNavBar />
        <main className="flex-1 overflow-y-auto px-12 py-8">
          {children}
        </main>
      </TVFocusManager>
    </div>
  );
}

/**
 * Simple login screen for TV (auto-login on LAN).
 * In v1, just prompts for email/password via the remote.
 * Supabase persists the session in localStorage for subsequent loads.
 */
function TVLoginScreen() {
  return (
    <div className="flex items-center justify-center h-screen bg-tv-bg">
      <div className="max-w-lg w-full px-12">
        <h1 className="text-4xl font-bold text-tv-focus mb-2 text-center">
          CleverHub
        </h1>
        <p className="text-xl text-tv-muted text-center mb-10">
          Sign in to your smart home dashboard
        </p>
        <TVLoginForm />
      </div>
    </div>
  );
}

function TVLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const { createBrowserClient } = await import("@/lib/supabase/client");
      const supabase = createBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
      } else {
        // Auth state change listener in root layout will update context
        window.location.reload();
      }
    } catch {
      setError("Failed to sign in");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-lg text-tv-text mb-2">Email</label>
        <input
          data-tv-focusable
          tabIndex={0}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-6 py-4 text-xl rounded-xl bg-tv-surface text-tv-text border-2 border-transparent focus:border-tv-focus outline-none"
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      </div>
      <div>
        <label className="block text-lg text-tv-text mb-2">Password</label>
        <input
          data-tv-focusable
          tabIndex={0}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-6 py-4 text-xl rounded-xl bg-tv-surface text-tv-text border-2 border-transparent focus:border-tv-focus outline-none"
          placeholder="Password"
          autoComplete="current-password"
          required
        />
      </div>
      {error && (
        <p className="text-lg text-tv-error">{error}</p>
      )}
      <button
        data-tv-focusable
        tabIndex={0}
        type="submit"
        disabled={submitting}
        className="w-full px-6 py-4 text-xl font-semibold rounded-xl bg-tv-focus text-tv-bg hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {submitting ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
}
