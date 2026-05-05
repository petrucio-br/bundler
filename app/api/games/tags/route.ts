// GET /api/games/tags - returns the user's game's current tags + tags_source.
// PUT /api/games/tags - replaces the tags array with the user's manual list.
//   Sets games.tags_source = 'manual' so future Refresh-from-Steam calls preserve them.
//
// Why a manual editor exists at all: SteamSpy lags days/weeks for newly-announced
// games, so unreleased games often have only Storefront genre data (3-5 broad tags
// like "Indie", "Strategy") rather than user-voted Steam tags. The mutual matching
// logic compares each game's actual tags against the other side's required tags,
// so missing tags = missing matches. The dev knows their game's real tags from
// the partner manager and can fill them in here.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";

const MAX_TAGS = 30;
const MAX_TAG_LENGTH = 64;

export async function GET() {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  const supabase = createServerClient();

  const { data: ownerRow } = await supabase
    .from("game_owners")
    .select("game_id")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!ownerRow) {
    return NextResponse.json({ error: "no_game" }, { status: 403 });
  }

  const [{ data: tags }, { data: game }] = await Promise.all([
    supabase.from("game_tags").select("tag").eq("game_id", ownerRow.game_id),
    supabase.from("games").select("tags_source").eq("id", ownerRow.game_id).maybeSingle(),
  ]);

  return NextResponse.json({
    tags: (tags ?? []).map((t) => t.tag),
    tagsSource: game?.tags_source ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const rawTags = body?.tags;
  if (!Array.isArray(rawTags)) {
    return NextResponse.json({ error: "invalid_tags" }, { status: 400 });
  }

  // Normalize: trim, dedupe (case-insensitive), cap length and count.
  const seen = new Set<string>();
  const cleanTags: string[] = [];
  for (const t of rawTags) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim().slice(0, MAX_TAG_LENGTH);
    if (!trimmed) continue;
    const lc = trimmed.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    cleanTags.push(trimmed);
    if (cleanTags.length >= MAX_TAGS) break;
  }

  const supabase = createServerClient();

  const { data: ownerRow } = await supabase
    .from("game_owners")
    .select("game_id, verified_at")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!ownerRow || !ownerRow.verified_at) {
    return NextResponse.json({ error: "no_verified_game" }, { status: 403 });
  }

  // Replace the tags atomically (best-effort: delete + insert).
  const { error: delErr } = await supabase
    .from("game_tags")
    .delete()
    .eq("game_id", ownerRow.game_id);
  if (delErr) {
    console.error("tags PUT: delete failed", delErr);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  if (cleanTags.length > 0) {
    const rows = cleanTags.map((t) => ({ game_id: ownerRow.game_id, tag: t }));
    const { error: insErr } = await supabase.from("game_tags").insert(rows);
    if (insErr) {
      console.error("tags PUT: insert failed", insErr);
      return NextResponse.json({ error: "save_failed" }, { status: 500 });
    }
  }

  // Mark as manual so the next Refresh-from-Steam doesn't clobber the user's edits.
  const { error: srcErr } = await supabase
    .from("games")
    .update({ tags_source: "manual" })
    .eq("id", ownerRow.game_id);
  if (srcErr) {
    console.error("tags PUT: source update failed", srcErr);
    // Non-fatal - tags are saved, just the source flag wasn't updated.
  }

  return NextResponse.json({ ok: true, tags: cleanTags });
}
