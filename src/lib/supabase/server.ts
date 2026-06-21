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
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      "[supabase/server] missing env vars",
      JSON.stringify({
        SUPABASE_URL_present: !!url,
        SUPABASE_URL_length: url?.length ?? 0,
        SUPABASE_SERVICE_ROLE_KEY_present: !!key,
        SUPABASE_SERVICE_ROLE_KEY_length: key?.length ?? 0,
        all_env_keys_containing_supabase: Object.keys(process.env).filter((k) =>
          k.toLowerCase().includes("supabase")
        ),
      })
    );
  }

  return createSupabaseClient(url!, key!, { auth: { persistSession: false } });
}
