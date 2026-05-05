// POST /api/games/verify
// Body: { postUrl: string }
// Verifies a pending claim by checking the user's Steam discussion-forum post.
// Loads the user's pending game_owners row, fetches the post, runs verifyForumPost,
// marks verified on success.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { verifyForumPost } from "@/lib/steam/forumVerify";
import { fetchFollowerCount } from "@/lib/steam/followers";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const postUrl = typeof body?.postUrl === "string" ? body.postUrl.trim() : "";
  if (!postUrl) {
    return NextResponse.json({ error: "missing_post_url" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Load the pending claim and the associated steam_app_id.
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
    .maybeSingle();

  if (error) {
    console.error("verify: claim lookup failed", error);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!claim) {
    return NextResponse.json({ error: "no_pending_claim" }, { status: 404 });
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
        // Include parsed values to help the user debug.
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
    .update({
      verified_at: new Date().toISOString(),
      // Keep the code on the row for audit but it's no longer needed - leaving it.
    })
    .eq("id", claim.id);

  if (updateErr) {
    console.error("verify: update failed", updateErr);
    return NextResponse.json({ error: "verify_save_failed" }, { status: 500 });
  }

  // Best-effort: fetch and store follower count so preferences can show smart defaults.
  // Do not fail verification if this errors - follower count is non-critical and the
  // weekly cron will fill it in eventually.
  try {
    const result = await fetchFollowerCount(game.steam_app_id);
    if (result.followerCount !== null) {
      await supabase
        .from("games")
        .update({
          follower_count: result.followerCount,
          follower_count_synced_at: new Date().toISOString(),
        })
        .eq("id", claim.game_id);
    } else {
      console.warn(
        `verify: follower count not found for app ${game.steam_app_id}.`,
        result.debugSnippet ? `Debug: ${result.debugSnippet}` : ""
      );
    }
  } catch (e) {
    console.warn("verify: follower fetch threw", e);
  }

  return NextResponse.json({ ok: true });
}
