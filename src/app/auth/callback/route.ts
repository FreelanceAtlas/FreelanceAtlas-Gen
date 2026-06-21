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

  if (code) {
    const supabase = createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
