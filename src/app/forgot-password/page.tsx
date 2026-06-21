"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSent(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-atlasnavy/10 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-atlasnavy">Reset your password</h1>
        <p className="mt-1 text-sm text-atlasnavy/60">
          We&apos;ll email you a link to set a new password.
        </p>

        {sent ? (
          <p className="mt-6 text-sm text-atlasteal">
            Check your email for a reset link. It may take a minute to arrive.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-atlasteal py-2 text-sm font-semibold text-white hover:bg-atlasteal/90 disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <Link href="/login" className="mt-4 block text-center text-sm text-atlasnavy/60 underline">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
