// GET  /api/games/preferences  -> returns saved preferences OR smart defaults if no row yet.
// PUT  /api/games/preferences  -> upserts preferences for the user's active game.
//
// Multi-game: scoped to the user's active game (session.activeGameId), or their most
// recently verified game if no active game is set.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import {
  getPreferencesForGame,
  savePreferencesForGame,
  validatePreferences,
} from "@/lib/db/preferences";
import { resolveActiveGameForUser } from "@/lib/db/games";

export async function GET() {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const active = await resolveActiveGameForUser(session.userId, session.activeGameId);
  if (!active) {
    return NextResponse.json({ error: "no_verified_game" }, { status: 403 });
  }

  const result = await getPreferencesForGame(session.userId, active.gameId);
  if ("error" in result) {
    if (result.error === "no_verified_game") {
      return NextResponse.json({ error: "no_verified_game" }, { status: 403 });
    }
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  return NextResponse.json(result);
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const active = await resolveActiveGameForUser(session.userId, session.activeGameId);
  if (!active) {
    return NextResponse.json({ error: "no_verified_game" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const validation = validatePreferences(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const save = await savePreferencesForGame(session.userId, active.gameId, validation.value);
  if (!save.ok) {
    if (save.error === "no_verified_game") {
      return NextResponse.json({ error: "no_verified_game" }, { status: 403 });
    }
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
