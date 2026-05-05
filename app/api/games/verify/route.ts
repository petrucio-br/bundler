// POST /api/games/verify
// Body: { postUrl: string, gameId?: string }
// Verifies a pending claim. If gameId is supplied, verifies that specific game's claim.
// Otherwise verifies the user's most recent pending (unverified) claim.
// On success: marks verified, fetches follower count + sets active game.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { verifyForumPost } from "@/lib/steam/forumVerify";
import { fetchFollowerCount } from "@/lib/steam/followers";
import { getPendingClaimForUser } from "@/lib/db/games";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const postUrl = typeof body?.postUrl === "string" ? body.postUrl.trim() : "";
  const requestedGameId = typeof body?.gameId === "string" ? body.gameId.trim() : "";
  if (!postUrl) {
    return NextResponse.json({ error: "missing_post_url" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Resolve which pending claim we're verifying.
  // If the request specifies gameId, look up that specific row. Otherwise grab the user's
  // most-recent pending claim (covers the typical "I just claimed, now I'm verifying" flow).
  let claimGameId: string | null = null;
  if (requestedGameId) {
    const { data: row } = await supabase
      .from("game_owners")
      .select("game_id, verified_at")
      .eq("user_id", session.userId)
      .eq("game_id", requestedGameId)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "no_pending_claim" }, { status: 404 });
    if (row.verified_at) return NextResponse.json({ error: "already_verified" }, { status: 409 });
    claimGameId = row.game_id;
  } else {
    const pending = await getPendingClaimForUser(session.userId);
    if (!pending) return NextResponse.json({ error: "no_pending_claim" }, { status: 404 });
    claimGameId = pending.gameId;
  }

  // Pull the verification code + steam_app_id for the chosen game.
  const { data: claim, error } = await supabase
    .from("game_owners")
    .select(
      `
      id,
      game_id,
      verification_code,
      verified_at,
      games:game_id ( steam_app_id )
    `
    )
    .eq("user_id", session.userId)
    .eq("game_id", claimGameId)
    .maybeSingle();

  if (error || !claim) {
    console.error("verify: claim lookup failed", error);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (claim.verified_at) {
    return NextResponse.json({ error: "already_verified" }, { status: 409 });
  }
  if (!claim.verification_code) {
    return NextResponse.json({ error: "no_code" }, { status: 500 });
  }

  const game = Array.isArray(claim.games) ? claim.games[0] : claim.games;
  if (!game?.steam_app_id) {
    return NextResponse.json({ error: "game_missing" }, { status: 500 });
  }

  const result = await verifyForumPost({
    postUrl,
    expectedAppId: game.steam_app_id,
    expectedSteamId: session.steamId,
    verificationCode: claim.verification_code,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: "verification_failed",
        reason: result.reason,
        debug: {
          parsedAuthorSteamId: result.parsedAuthorSteamId,
          parsedHasDeveloperTag: result.parsedHasDeveloperTag,
          parsedCodeFound: result.parsedCodeFound,
        },
      },
      { status: 400 }
    );
  }

  // Mark verified.
  const { error: updateErr } = await supabase
    .from("game_owners")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", claim.id);

  if (updateErr) {
    console.error("verify: update failed", updateErr);
    return NextResponse.json({ error: "verify_save_failed" }, { status: 500 });
  }

  // Best-effort follower count fetch.
  try {
    const fc = await fetchFollowerCount(game.steam_app_id);
    if (fc.followerCount !== null) {
      await supabase
        .from("games")
        .update({
          follower_count: fc.followerCount,
          follower_count_synced_at: new Date().toISOString(),
        })
        .eq("id", claim.game_id);
    } else {
      console.warn(
        `verify: follower count not found for app ${game.steam_app_id}.`,
        fc.debugSnippet ? `Debug: ${fc.debugSnippet}` : ""
      );
    }
  } catch (e) {
    console.warn("verify: follower fetch threw", e);
  }

  // Switch the session's active game to the freshly-verified one. Most recent verify =
  // the game the user is currently working on, so it's a sensible default.
  session.activeGameId = claim.game_id;
  await session.save();

  return NextResponse.json({ ok: true, gameId: claim.game_id });
}
