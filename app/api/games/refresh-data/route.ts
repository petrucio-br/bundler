// POST /api/games/refresh-data
// Re-fetches the user's claimed game's metadata (Storefront + SteamSpy + follower count)
// and updates the games row + game_tags table. Used to backfill data and to refresh stale info.
// No rate limit in V1 - users are unlikely to hammer this.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { upsertGameFromSteam } from "@/lib/db/games";
import { fetchFollowerCount } from "@/lib/steam/followers";

export async function POST() {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const supabase = createServerClient();

  // Find the user's claim and the underlying steam_app_id.
  const { data: ownerRow, error: ownerErr } = await supabase
    .from("game_owners")
    .select("game_id, verified_at, games:game_id ( steam_app_id )")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (ownerErr || !ownerRow) {
    return NextResponse.json({ error: "no_claim" }, { status: 404 });
  }
  const game = Array.isArray(ownerRow.games) ? ownerRow.games[0] : ownerRow.games;
  const appId = game?.steam_app_id;
  if (!appId) {
    return NextResponse.json({ error: "no_app_id" }, { status: 500 });
  }

  // Re-pull Storefront + SteamSpy metadata.
  const refresh = await upsertGameFromSteam(appId);
  if ("error" in refresh) {
    return NextResponse.json({ error: refresh.error }, { status: 502 });
  }

  // Re-pull follower count. Best-effort; we still return success even if this fails,
  // because the metadata refresh is the primary thing the user is paying attention to.
  let followerCount: number | null = null;
  let followerDebug: string | undefined;
  try {
    const result = await fetchFollowerCount(appId);
    followerCount = result.followerCount;
    followerDebug = result.debugSnippet;
    if (followerCount !== null) {
      await supabase
        .from("games")
        .update({
          follower_count: followerCount,
          follower_count_synced_at: new Date().toISOString(),
        })
        .eq("id", ownerRow.game_id);
    }
  } catch (e) {
    console.warn("refresh-data: follower fetch threw", e);
  }

  return NextResponse.json({
    ok: true,
    info: refresh.info,
    followerCount,
    followerCountDebug: followerCount === null ? followerDebug : undefined,
  });
}
