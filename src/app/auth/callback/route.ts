import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase (via @supabase/ssr) uses the PKCE flow by default, so links sent
// in emails (password reset, signup confirmation, etc.) carry a `?code=`
// param that must be exchanged server-side for a session cookie before the
// destination page can see the user as signed in.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  console.log("[auth/callback] hit", {
    hasCode: !!code,
    next,
    fullUrl: request.url,
  });

  if (!code) {
    console.log("[auth/callback] no code param present, redirecting with error");
    return NextResponse.redirect(`${origin}${next}?auth_error=no_code`);
  }

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] exchangeCodeForSession failed", {
      message: error.message,
      status: error.status,
      name: error.name,
    });
    return NextResponse.redirect(
      `${origin}${next}?auth_error=${encodeURIComponent(error.message)}`
    );
  }

  console.log("[auth/callback] exchange succeeded, redirecting to", next);
  return NextResponse.redirect(`${origin}${next}`);
}
