// PUT /api/profile/active-game
// Body: { gameId: string }
// Sets the user's active game in their session. Subsequent game-scoped requests
// (browse, prefs, swipes, matches, etc.) will operate on this game until changed.
//
// Only verified games may be set active. Pending claims can't be the active context
// because no preferences/matches/etc. exist for them yet.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const gameId = typeof body?.gameId === "string" ? body.gameId.trim() : "";
  if (!gameId) {
    return NextResponse.json({ error: "missing_game_id" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Confirm the user owns this game AND it's verified.
  const { data: ownerRow } = await supabase
    .from("game_owners")
    .select("game_id, verified_at")
    .eq("user_id", session.userId)
    .eq("game_id", gameId)
    .maybeSingle();

  if (!ownerRow) {
    return NextResponse.json({ error: "not_your_game" }, { status: 403 });
  }
  if (!ownerRow.verified_at) {
    return NextResponse.json({ error: "game_not_verified" }, { status: 400 });
  }

  session.activeGameId = ownerRow.game_id;
  await session.save();

  return NextResponse.json({ ok: true, activeGameId: ownerRow.game_id });
}
