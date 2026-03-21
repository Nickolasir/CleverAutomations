import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Auth callback handler for Supabase Auth.
 * Exchanges the temporary code for a persistent session.
 * Redirects to onboarding if no profile exists, otherwise to dashboard.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/auth/login", origin));
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(new URL("/auth/login?error=config", origin));
  }

  // Build a temporary response to carry cookies from the code exchange
  const tempResponse = NextResponse.redirect(new URL("/dashboard", origin));

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        for (const { name, value, options } of cookiesToSet) {
          tempResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Auth callback error:", error.message);
    return NextResponse.redirect(
      new URL("/auth/login?error=" + encodeURIComponent(error.message), origin)
    );
  }

  // After email confirmation, check if user has a profile row.
  // If not, redirect to onboarding to collect property details.
  let finalRedirect = searchParams.get("redirect") ?? "/dashboard";

  if (data.session) {
    const { data: existingProfile } = await supabase
      .from("users")
      .select("id")
      .eq("id", data.session.user.id)
      .maybeSingle();

    if (!existingProfile) {
      finalRedirect = "/auth/onboarding";
    }
  }

  const response = NextResponse.redirect(new URL(finalRedirect, origin));
  // Copy cookies from the temp response to the final response
  for (const cookie of tempResponse.cookies.getAll()) {
    response.cookies.set(cookie.name, cookie.value);
  }

  return response;
}
