// Browser-side Supabase client. Uses the anon key.
// Reads enforced via Row Level Security policies; do NOT use this for privileged operations.

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
