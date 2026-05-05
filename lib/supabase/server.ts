// Server-side Supabase client. Uses the service role key.
// This bypasses Row Level Security, so ONLY call it from server code (route handlers, server components, server actions).
// We're authenticating through Steam OpenID + iron-session, NOT through Supabase Auth, so the service role key plus our own session checks is the security model.

import { createClient } from "@supabase/supabase-js";

export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}
