// GET  /api/games/preferences  -> returns saved preferences OR smart defaults if no row yet.
// PUT  /api/games/preferences  -> upserts preferences for the user's verified game.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import {
  getPreferencesForUser,
  savePreferencesForUser,
  validatePreferences,
} from "@/lib/db/preferences";

export async function GET() {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const result = await getPreferencesForUser(session.userId);
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

  const body = await req.json().catch(() => null);
  const validation = validatePreferences(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const save = await savePreferencesForUser(session.userId, validation.value);
  if (!save.ok) {
    if (save.error === "no_verified_game") {
      return NextResponse.json({ error: "no_verified_game" }, { status: 403 });
    }
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
