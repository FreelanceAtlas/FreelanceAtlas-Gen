import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the service-role key. There is no more
 * per-request user session (auth is gone in favor of the shared access
 * code), so every server read/write runs as the service role, which
 * bypasses RLS. RLS itself stays enabled on every table with no
 * anon/authenticated policies left, so this service-role client is the
 * only path into the data — and it must never be imported into a client
 * component or exposed to the browser.
 */
export function createClient() {
  return createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
