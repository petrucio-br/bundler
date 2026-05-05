// GET /api/auth/steam/callback
// Steam redirects here with openid.* query params after the user signs in.
// We verify the signature with Steam, upsert the user in Supabase, set the session cookie, and redirect to /dashboard.

import { NextRequest, NextResponse } from "next/server";
import { verifySteamCallback } from "@/lib/auth/steam";
import { getSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const steamId = await verifySteamCallback(url.searchParams);

  if (!steamId) {
    return NextResponse.redirect(
      new URL("/?error=steam_verification_failed", req.url)
    );
  }

  // Upsert the user keyed by steam_id. Email and discord come later when they fill out their profile.
  const supabase = createServerClient();
  const { data: user, error } = await supabase
    .from("users")
    .upsert(
      { steam_id: steamId },
      { onConflict: "steam_id", ignoreDuplicates: false }
    )
    .select("id")
    .single();

  if (error || !user) {
    console.error("Failed to upsert user:", error);
    return NextResponse.redirect(
      new URL("/?error=user_upsert_failed", req.url)
    );
  }

  const session = await getSession();
  session.steamId = steamId;
  session.userId = user.id;
  session.signedInAt = Date.now();
  await session.save();

  return NextResponse.redirect(new URL("/dashboard", req.url));
}
