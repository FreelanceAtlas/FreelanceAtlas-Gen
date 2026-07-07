import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  return createSupabaseClient(url, key, {
    auth: { persistSession: false },
    // Bypass Next.js's fetch Data Cache. Without this, server-component reads
    // (e.g. the clusters/keyword bank, articles list) get cached and keep showing
    // stale data after the DB changes outside a revalidated server action — which
    // made reverted keywords still read as "Used" on the live page.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
