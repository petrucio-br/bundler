// POST /api/swipes - record a swipe (yes/no/maybe), trigger match if mutual yes.
// DELETE /api/swipes?gameId=xxx - revert a no/maybe swipe. Yes is committed (use match dismiss).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { createMatchIfReciprocal, getGameContact } from "@/lib/db/matches";
import { renderMatchEmail, sendEmail } from "@/lib/email/send";
import { resolveActiveGameForUser } from "@/lib/db/games";

const VALID_DIRECTIONS = new Set(["yes", "no", "maybe"]);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const targetGameId = typeof body?.gameId === "string" ? body.gameId.trim() : "";
  const direction = typeof body?.direction === "string" ? body.direction : "";
  if (!targetGameId) {
    return NextResponse.json({ error: "missing_game_id" }, { status: 400 });
  }
  if (!VALID_DIRECTIONS.has(direction)) {
    return NextResponse.json({ error: "invalid_direction" }, { status: 400 });
  }

  // Multi-game: swiper = user's active game.
  const active = await resolveActiveGameForUser(session.userId, session.activeGameId);
  if (!active) {
    return NextResponse.json({ error: "no_verified_game" }, { status: 403 });
  }
  const swiperGameId = active.gameId;

  if (swiperGameId === targetGameId) {
    return NextResponse.json({ error: "cannot_swipe_self" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Don't allow re-swiping a game you've already locked Yes on. The Yes is the commitment.
  const { data: existingSwipe } = await supabase
    .from("swipes")
    .select("direction")
    .eq("swiper_game_id", swiperGameId)
    .eq("target_game_id", targetGameId)
    .maybeSingle();

  if (existingSwipe?.direction === "yes" && direction !== "yes") {
    return NextResponse.json({ error: "yes_is_committed" }, { status: 409 });
  }

  // Upsert the swipe row. Unique constraint on (swiper_game_id, target_game_id) handles
  // existing rows - we update the direction and bump created_at.
  const { error: upsertErr } = await supabase
    .from("swipes")
    .upsert(
      {
        swiper_game_id: swiperGameId,
        target_game_id: targetGameId,
        direction,
        created_at: new Date().toISOString(),
      },
      { onConflict: "swiper_game_id,target_game_id" }
    );

  if (upsertErr) {
    console.error("swipe upsert failed", upsertErr);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  // Match check only on yes-swipes.
  if (direction !== "yes") {
    return NextResponse.json({ ok: true, matched: false });
  }

  const matchResult = await createMatchIfReciprocal(swiperGameId, targetGameId);
  if (!matchResult || !matchResult.created) {
    // Either no reciprocal, or the match already existed (we re-yes'd, rare).
    return NextResponse.json({ ok: true, matched: !!matchResult });
  }

  // Fresh match - notify both sides. Best-effort, don't fail the swipe response.
  try {
    await fireMatchNotifications(swiperGameId, targetGameId);
  } catch (e) {
    console.warn("match notification failed", e);
  }

  return NextResponse.json({ ok: true, matched: true, matchId: matchResult.matchId });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  const url = new URL(req.url);
  const targetGameId = url.searchParams.get("gameId")?.trim();
  if (!targetGameId) {
    return NextResponse.json({ error: "missing_game_id" }, { status: 400 });
  }

  // Multi-game: revert is scoped to the user's active game.
  const active = await resolveActiveGameForUser(session.userId, session.activeGameId);
  if (!active) {
    return NextResponse.json({ error: "no_game" }, { status: 403 });
  }

  const supabase = createServerClient();
  // Look up the swipe; refuse to revert a Yes.
  const { data: existing } = await supabase
    .from("swipes")
    .select("id, direction")
    .eq("swiper_game_id", active.gameId)
    .eq("target_game_id", targetGameId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "no_swipe" }, { status: 404 });
  }
  if (existing.direction === "yes") {
    return NextResponse.json({ error: "yes_is_committed" }, { status: 409 });
  }

  const { error: deleteErr } = await supabase
    .from("swipes")
    .delete()
    .eq("id", existing.id);
  if (deleteErr) {
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// =============================================================================
// fireMatchNotifications - send the match email to both sides.
// =============================================================================

async function fireMatchNotifications(swiperGameId: string, targetGameId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://bundler.games";
  const matchesPageUrl = `${baseUrl}/dashboard`;

  const [swiper, target] = await Promise.all([
    getGameContact(swiperGameId),
    getGameContact(targetGameId),
  ]);
  if (!swiper || !target) return;

  // Email to the swiper telling them about target.
  if (swiper.email) {
    const { subject, html, text } = renderMatchEmail({
      recipientEmail: swiper.email,
      recipientGameName: swiper.gameName,
      matchedGameName: target.gameName,
      matchedGameStoreUrl: target.storeUrl,
      matchedDevEmail: target.email,
      matchedDevDiscord: target.discordUsername,
      matchedDevNotes: target.notes,
      matchesPageUrl,
    });
    await sendEmail({ to: swiper.email, subject, html, text });
  }

  // Email to the target telling them about the swiper.
  if (target.email) {
    const { subject, html, text } = renderMatchEmail({
      recipientEmail: target.email,
      recipientGameName: target.gameName,
      matchedGameName: swiper.gameName,
      matchedGameStoreUrl: swiper.storeUrl,
      matchedDevEmail: swiper.email,
      matchedDevDiscord: swiper.discordUsername,
      matchedDevNotes: swiper.notes,
      matchesPageUrl,
    });
    await sendEmail({ to: target.email, subject, html, text });
  }
}
