// GET /api/cron/refresh-followers
// Weekly cron job: refresh follower count for every game that has a verified owner.
// Triggered by Vercel Cron (see vercel.json). Authentication via the CRON_SECRET env var
// that Vercel automatically generates and includes in the Authorization header.
//
// Rate-limited at ~1 request/second to avoid hammering Steam. With ~100 games this takes
// under 2 minutes; we'll need to revisit pagination/queueing if the userbase grows past
// what fits in a single Vercel function execution (~10s on Hobby, 60s on Pro).

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchFollowerCount } from "@/lib/steam/followers";
import { fetchNewsActivityDates } from "@/lib/steam/news";

// 1 second between fetches.
const REQUEST_DELAY_MS = 1000;

export async function GET(req: NextRequest) {
  // Vercel cron auth check.
  // In production, Vercel injects `Authorization: Bearer <CRON_SECRET>`.
  // Locally and on other hosts, we accept the same env-driven token.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // No secret configured - refuse to run rather than allow unauthenticated triggering.
    return NextResponse.json({ error: "cron_not_configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();

  // Pull every game that has a verified owner. We don't refresh games no one has claimed -
  // they're just store metadata that nobody cares about until someone claims them.
  const { data: games, error } = await supabase
    .from("game_owners")
    .select("game_id, games:game_id ( id, steam_app_id )")
    .not("verified_at", "is", null);

  if (error) {
    console.error("cron: failed to load games", error);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  type Row = { gameId: string; appId: string };
  const targets: Row[] = (games ?? [])
    .map((row) => {
      const game = Array.isArray(row.games) ? row.games[0] : row.games;
      if (!game?.id || !game?.steam_app_id) return null;
      return { gameId: game.id, appId: game.steam_app_id } as Row;
    })
    .filter((r): r is Row => r !== null);

  let updated = 0;
  let failed = 0;

  for (const target of targets) {
    const updates: Record<string, string | number> = {};
    let anyUpdate = false;

    try {
      const followerResult = await fetchFollowerCount(target.appId);
      if (followerResult.followerCount !== null) {
        updates.follower_count = followerResult.followerCount;
        updates.follower_count_synced_at = new Date().toISOString();
        anyUpdate = true;
      }
    } catch (e) {
      console.warn(`cron: follower fetch threw for ${target.appId}`, e);
    }

    try {
      const news = await fetchNewsActivityDates(target.appId);
      if (news.firstUpdateDate) {
        updates.first_update_date = news.firstUpdateDate;
        anyUpdate = true;
      }
      if (news.lastUpdateDate) {
        updates.last_update_date = news.lastUpdateDate;
        anyUpdate = true;
      }
    } catch (e) {
      console.warn(`cron: news fetch threw for ${target.appId}`, e);
    }

    if (anyUpdate) {
      const { error: updateErr } = await supabase
        .from("games")
        .update(updates)
        .eq("id", target.gameId);
      if (updateErr) {
        console.warn(`cron: update failed for ${target.appId}`, updateErr);
        failed++;
      } else {
        updated++;
      }
    } else {
      console.warn(`cron: nothing parseable for ${target.appId}`);
      failed++;
    }

    // Crude rate limit. fetch() time itself adds delay too, so this is a floor.
    await sleep(REQUEST_DELAY_MS);
  }

  return NextResponse.json({
    ok: true,
    total: targets.length,
    updated,
    failed,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
