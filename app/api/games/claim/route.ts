// POST /api/games/claim
// Body: { appId: string }
// Starts a claim for the given Steam app ID:
//   - Validates app ID format
//   - Fetches game metadata from Steam
//   - Creates or updates the games row
//   - Creates a game_owners row with a fresh verification_code
// Rejects if:
//   - The user already has a claim (V1: one game per user; they must abandon to switch)
//   - The game is already claimed by a different user (V1: one user per game)

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { upsertGameFromSteam } from "@/lib/db/games";
import { generateVerificationCode } from "@/lib/steam/forumVerify";

const APP_ID_RE = /^\d{1,12}$/;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const rawAppId = body?.appId;
  if (typeof rawAppId !== "string" || !APP_ID_RE.test(rawAppId.trim())) {
    return NextResponse.json({ error: "invalid_app_id" }, { status: 400 });
  }
  const appId = rawAppId.trim();

  const supabase = createServerClient();

  // Reject if this user already has a PENDING (unverified) claim. They should
  // either complete it or abandon it before starting another. This avoids
  // accumulating dead-end pending rows. Verified games coexist freely.
  const { data: existingPending } = await supabase
    .from("game_owners")
    .select("id, game_id")
    .eq("user_id", session.userId)
    .is("verified_at", null)
    .maybeSingle();

  if (existingPending) {
    return NextResponse.json(
      { error: "already_has_pending_claim" },
      { status: 409 }
    );
  }

  // Look up or create the game from Steam metadata.
  const result = await upsertGameFromSteam(appId);
  if ("error" in result) {
    if (result.error === "not_found") {
      return NextResponse.json(
        { error: "game_not_found_on_steam" },
        { status: 404 }
      );
    }
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }

  // Reject if some OTHER user already has this game claimed (V1 constraint).
  const { data: gameClaimedByOther } = await supabase
    .from("game_owners")
    .select("user_id")
    .eq("game_id", result.gameId)
    .maybeSingle();

  if (gameClaimedByOther) {
    return NextResponse.json(
      { error: "game_already_claimed" },
      { status: 409 }
    );
  }

  const verificationCode = generateVerificationCode();

  const { error: insertErr } = await supabase.from("game_owners").insert({
    user_id: session.userId,
    game_id: result.gameId,
    verification_code: verificationCode,
    verification_initiated_at: new Date().toISOString(),
  });

  if (insertErr) {
    console.error("claim: failed to insert game_owners", insertErr);
    return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    gameId: result.gameId,
    appId: result.info.appId,
    name: result.info.name,
    capsuleUrl: result.info.capsuleUrl,
    storeUrl: result.info.storeUrl,
    verificationCode,
  });
}

// DELETE /api/games/claim
// Abandons the user's pending claim. Used to "switch games" pre-verification.
export async function DELETE() {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const supabase = createServerClient();
  // Only allow deleting unverified claims. Verified claims should not be casually deleted.
  const { error } = await supabase
    .from("game_owners")
    .delete()
    .eq("user_id", session.userId)
    .is("verified_at", null);

  if (error) {
    console.error("claim DELETE: failed", error);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
