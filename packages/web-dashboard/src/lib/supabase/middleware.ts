import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Supabase auth middleware for Next.js.
 * Refreshes the session token on every request and protects
 * routes under /dashboard from unauthenticated access.
 *
 * Public routes: /auth/login, /auth/signup, /api/health
 * Auth-required but profile-optional: /auth/onboarding, /auth/callback
 * Protected routes (require auth + profile): /dashboard/*
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  /** Refresh the session — this is required to keep the JWT alive */
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isProtectedRoute = pathname.startsWith("/dashboard");
  const isAuthRoute = pathname.startsWith("/auth");
  const isOnboardingOrCallback = pathname.startsWith("/auth/onboarding") || pathname.startsWith("/auth/callback");

  /** Protected routes require authentication */
  if (isProtectedRoute && !user) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  /**
   * Redirect authenticated users away from login/signup pages,
   * but only if they have a complete profile (users table row).
   * Users who signed up but never completed onboarding should still
   * be able to visit login/signup without being bounced.
   */
  if (isAuthRoute && user && !isOnboardingOrCallback) {
    const { data: profile } = await supabase
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (profile) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return response;
}
