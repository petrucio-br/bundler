// POST /api/games/refresh-data
// Re-fetches the user's claimed game's metadata (Storefront + SteamSpy + follower count)
// and updates the games row + game_tags table. Used to backfill data and to refresh stale info.
// No rate limit in V1 - users are unlikely to hammer this.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { upsertGameFromSteam, resolveActiveGameForUser } from "@/lib/db/games";
import { fetchFollowerCount } from "@/lib/steam/followers";

export async function POST() {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  // Refresh the user's currently-active game. Multi-game: the user picks which one
  // to work with via the sidebar switcher; this respects that choice.
  const active = await resolveActiveGameForUser(session.userId, session.activeGameId);
  if (!active) {
    return NextResponse.json({ error: "no_claim" }, { status: 404 });
  }
  const appId = active.steamAppId;
  const supabase = createServerClient();

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
        .eq("id", active.gameId);
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
