// GET /api/browse
// Query params:
//   tab    : "eligible" | "maybe" | "no" - which set of games to return. Default "eligible".
//   sort   : "tag-overlap" | "follower-count" | "recency" - only used when tab=eligible.
//   page   : 0-indexed page number. Only used when tab=eligible.
//   search : substring filter on game name. Only used when tab=eligible.
//
// For tab=eligible: returns paginated eligible-pool result.
// For tab=maybe / tab=no: returns the full list of games this user has swiped that direction.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getEligiblePool, getSwipedGames, type SortOption } from "@/lib/db/browse";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const url = new URL(req.url);
  const tab = url.searchParams.get("tab") ?? "eligible";

  if (tab === "maybe" || tab === "no") {
    const result = await getSwipedGames(session.userId, tab);
    if ("error" in result) {
      if (result.error === "no_swiper_context") {
        return NextResponse.json({ error: "no_setup" }, { status: 403 });
      }
      return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    }
    return NextResponse.json({ games: result, total: result.length, page: 0, hasMore: false });
  }

  // Default: eligible.
  const sort = (url.searchParams.get("sort") as SortOption) || "tag-overlap";
  const page = Math.max(0, Number(url.searchParams.get("page") ?? "0") || 0);
  const search = url.searchParams.get("search") ?? undefined;
  const result = await getEligiblePool(session.userId, { sort, page, search });
  if ("error" in result) {
    if (result.error === "no_swiper_context") {
      return NextResponse.json({ error: "no_setup" }, { status: 403 });
    }
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  return NextResponse.json(result);
}
