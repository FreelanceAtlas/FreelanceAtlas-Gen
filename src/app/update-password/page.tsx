"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  // By the time the user lands here, /auth/callback has already exchanged
  // the PKCE code for a session and set the cookie, so getSession() should
  // resolve immediately. We also listen for onAuthStateChange as a safety
  // net in case the session is still settling on first render.
  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        setReady(true);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) setReady(true);
    });

    const timeout = setTimeout(() => {
      if (active && !ready) {
        setError(
          "This reset link is invalid or has expired. Request a new one from the Forgot password page."
        );
      }
    }, 3000);

    return () => {
      active = false;
      clearTimeout(timeout);
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-atlasnavy/10 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-atlasnavy">Set a new password</h1>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-atlasnavy">New password</label>
            <input
              type="password"
              required
              minLength={6}
              disabled={!ready}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-atlasteal disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-atlasnavy">Confirm password</label>
            <input
              type="password"
              required
              minLength={6}
              disabled={!ready}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-atlasnavy/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-atlasteal disabled:opacity-50"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading || !ready}
            className="w-full rounded-md bg-atlasteal py-2 text-sm font-semibold text-white hover:bg-atlasteal/90 disabled:opacity-50"
          >
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </main>
  );
}
