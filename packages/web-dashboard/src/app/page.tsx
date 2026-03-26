"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/lib/auth-context";

/**
 * Root page: redirects authenticated users to the dashboard,
 * unauthenticated users to the login page.
 */
export default function RootPage() {
  const { user, loading } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (user) {
      router.replace("/dashboard");
    } else {
      router.replace("/auth/login");
    }
  }, [user, loading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        <p className="text-sm text-slate-500">Loading CleverHub...</p>
      </div>
    </div>
  );
}
