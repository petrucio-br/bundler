// GET /api/matches - returns the user's matches with the OTHER game's contact info attached.
// PATCH /api/matches - dismiss a match (body: { matchId }).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { getMatchesForUser } from "@/lib/db/matches";

export async function GET() {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  const matches = await getMatchesForUser(session.userId);
  return NextResponse.json({ matches });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const matchId = typeof body?.matchId === "string" ? body.matchId : "";
  if (!matchId) {
    return NextResponse.json({ error: "missing_match_id" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Find the user's game.
  const { data: ownerRow } = await supabase
    .from("game_owners")
    .select("game_id")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!ownerRow) {
    return NextResponse.json({ error: "no_game" }, { status: 403 });
  }

  // Look up the match and figure out which side (a or b) the user is.
  const { data: match } = await supabase
    .from("matches")
    .select("id, game_a_id, game_b_id")
    .eq("id", matchId)
    .maybeSingle();
  if (!match) {
    return NextResponse.json({ error: "match_not_found" }, { status: 404 });
  }

  const update: Record<string, string> = {};
  const now = new Date().toISOString();
  if (match.game_a_id === ownerRow.game_id) {
    update.a_dismissed_at = now;
  } else if (match.game_b_id === ownerRow.game_id) {
    update.b_dismissed_at = now;
  } else {
    return NextResponse.json({ error: "not_your_match" }, { status: 403 });
  }

  const { error } = await supabase.from("matches").update(update).eq("id", matchId);
  if (error) {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
