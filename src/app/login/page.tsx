"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup" | "magic">("signin");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Fallback safety net: ensure a profile row exists (role assignment is
    // handled separately by the DB trigger / an admin via the Users tab).
    if (data.user) {
      const { data: existing } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", data.user.id)
        .maybeSingle();

      if (!existing) {
        await supabase.from("profiles").insert({ id: data.user.id, email });
      }
    }

    router.push("/dashboard");
    router.refresh();
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    // If email confirmation is required, there's no session yet.
    if (!data.session) {
      setInfo("Check your email to confirm your account, then sign in.");
      setMode("signin");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);

    // Magic link uses Supabase's default "Confirm signup"/"Magic Link"
    // email template as-is (no custom SMTP needed, unlike the numeric-code
    // OTP flow) and lands on /auth/callback to exchange the PKCE code.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setInfo("Check your email for a sign-in link.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-atlasnavy/10 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-atlasnavy">FreelanceAtlas Gen</h1>
        <p className="mt-1 text-sm text-atlasnavy/60">
          Internal content team sign-in
        </p>

        <form
          onSubmit={
            mode === "signin"
              ? handleSignIn
              : mode === "signup"
              ? handleSignUp
              : handleMagicLink
          }
          className="mt-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-atlasnavy">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-atlasteal"
            />
          </div>

          {mode !== "magic" && (
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-atlasnavy">Password</label>
                {mode === "signin" && (
                  <Link
                    href="/forgot-password"
                    className="text-xs text-atlasnavy/60 underline"
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-atlasteal"
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-atlasteal">{info}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-atlasteal py-2 text-sm font-semibold text-white hover:bg-atlasteal/90 disabled:opacity-50"
          >
            {loading
              ? mode === "signin"
                ? "Signing in…"
                : mode === "signup"
                ? "Creating account…"
                : "Sending link…"
              : mode === "signin"
              ? "Sign in"
              : mode === "signup"
              ? "Create account"
              : "Send sign-in link"}
          </button>

          <button
            type="button"
            className="w-full text-sm text-atlasnavy/60 underline"
            onClick={() => {
              setMode(mode === "magic" ? "signin" : "magic");
              setError(null);
              setInfo(null);
            }}
          >
            {mode === "magic" ? "Use a password instead" : "Email me a sign-in link instead"}
          </button>

          {mode !== "magic" && (
            <button
              type="button"
              className="w-full text-sm text-atlasnavy/60 underline"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
                setInfo(null);
              }}
            >
              {mode === "signin"
                ? "Need an account? Sign up"
                : "Already have an account? Sign in"}
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
