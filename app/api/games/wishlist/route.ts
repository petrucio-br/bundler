// PUT /api/games/wishlist
// Body: { wishlistCount: number }
// Self-reports the user's current wishlist count for their verified game.
// Used as the audience-size signal in match filtering, since Steam doesn't expose
// wishlist counts via any public API (only the partner manager dashboard).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";

const MAX_WISHLISTS = 100_000_000; // sanity ceiling

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const raw = body?.wishlistCount;
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAX_WISHLISTS) {
    return NextResponse.json({ error: "invalid_wishlist_count" }, { status: 400 });
  }
  const wishlistCount = Math.floor(n);

  const supabase = createServerClient();

  const { data: ownerRow } = await supabase
    .from("game_owners")
    .select("game_id, verified_at")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!ownerRow || !ownerRow.verified_at) {
    return NextResponse.json({ error: "no_verified_game" }, { status: 403 });
  }

  const { error } = await supabase
    .from("games")
    .update({
      wishlist_count: wishlistCount,
      wishlist_count_updated_at: new Date().toISOString(),
    })
    .eq("id", ownerRow.game_id);

  if (error) {
    console.error("wishlist update failed", error);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, wishlistCount });
}
