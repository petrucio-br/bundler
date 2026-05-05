// Match detection + lookup helpers.
// On a mutual-yes swipe pair, create a single match row. Both sides see it on /matches.
//
// Match rows enforce game_a_id < game_b_id by SQL CHECK constraint, so the match has a
// canonical (sorted) representation regardless of which side swiped second. The unique
// constraint on (game_a_id, game_b_id) prevents duplicate matches.

import { createServerClient } from "@/lib/supabase/server";

export interface MatchedGameContact {
  userId: string;
  email: string | null;
  discordUsername: string | null;
  gameId: string;
  steamAppId: string;
  gameName: string;
  capsuleUrl: string | null;
  storeUrl: string;
  notes: string | null;
}

export interface MatchEntry {
  matchId: string;
  matchedAt: string;
  dismissed: boolean;
  // The OTHER game from the perspective of the requesting user.
  other: MatchedGameContact;
}

/**
 * If the given swiper just yes-swiped this target AND the target had previously yes-swiped them,
 * create a match row. Returns the match id when a new match was created (so the caller can
 * fire notifications), or null if either no reciprocal exists or the match already existed.
 */
export async function createMatchIfReciprocal(
  swiperGameId: string,
  targetGameId: string
): Promise<{ matchId: string; created: boolean } | null> {
  const supabase = createServerClient();

  // Check if the target already swiped yes back at us.
  const { data: reciprocal } = await supabase
    .from("swipes")
    .select("id")
    .eq("swiper_game_id", targetGameId)
    .eq("target_game_id", swiperGameId)
    .eq("direction", "yes")
    .maybeSingle();
  if (!reciprocal) return null;

  // Canonicalize ordering for the match row (game_a_id < game_b_id).
  const [a, b] = swiperGameId < targetGameId
    ? [swiperGameId, targetGameId]
    : [targetGameId, swiperGameId];

  // Try to insert. Unique constraint protects us from duplicates if both sides race.
  const { data: inserted, error } = await supabase
    .from("matches")
    .insert({ game_a_id: a, game_b_id: b })
    .select("id")
    .maybeSingle();

  if (inserted) return { matchId: inserted.id, created: true };

  // If insert hit the unique constraint, look up the existing match and return that.
  if (error) {
    const { data: existing } = await supabase
      .from("matches")
      .select("id")
      .eq("game_a_id", a)
      .eq("game_b_id", b)
      .maybeSingle();
    if (existing) return { matchId: existing.id, created: false };
  }
  return null;
}

/**
 * Load contact + game details for a specific game (for use in match notifications).
 */
export async function getGameContact(gameId: string): Promise<MatchedGameContact | null> {
  const supabase = createServerClient();
  // PostgREST can't traverse the indirect game_owners → games → bundle_preferences chain
  // in a single SELECT, so we run two queries.
  const { data } = await supabase
    .from("game_owners")
    .select(
      `
      user_id,
      users:user_id ( email, discord_username ),
      games:game_id ( id, steam_app_id, name, capsule_url, store_url )
    `
    )
    .eq("game_id", gameId)
    .maybeSingle();
  if (!data) return null;
  const user = Array.isArray(data.users) ? data.users[0] : data.users;
  const game = Array.isArray(data.games) ? data.games[0] : data.games;
  if (!user || !game) return null;

  const { data: prefsRow } = await supabase
    .from("bundle_preferences")
    .select("notes")
    .eq("game_id", gameId)
    .maybeSingle();

  return {
    userId: data.user_id,
    email: user.email ?? null,
    discordUsername: user.discord_username ?? null,
    gameId: game.id,
    steamAppId: game.steam_app_id,
    gameName: game.name,
    capsuleUrl: game.capsule_url ?? null,
    storeUrl: game.store_url ?? `https://store.steampowered.com/app/${game.steam_app_id}/`,
    notes: prefsRow?.notes ?? null,
  };
}

/**
 * Get all matches for a specific game owned by the user, with the OTHER game's
 * contact info attached. Filters out matches dismissed by this side.
 *
 * Multi-game: caller passes the gameId for which they want matches. Each of a
 * user's games has its own independent match relationships.
 */
export async function getMatchesForGame(
  userId: string,
  gameId: string
): Promise<MatchEntry[]> {
  const supabase = createServerClient();

  // Confirm the user actually owns this game before exposing its matches.
  const { data: ownerRow } = await supabase
    .from("game_owners")
    .select("game_id")
    .eq("user_id", userId)
    .eq("game_id", gameId)
    .maybeSingle();
  if (!ownerRow) return [];
  const myGameId = ownerRow.game_id;

  // Pull matches where this game is on either side.
  const { data: rows } = await supabase
    .from("matches")
    .select("id, game_a_id, game_b_id, matched_at, a_dismissed_at, b_dismissed_at")
    .or(`game_a_id.eq.${myGameId},game_b_id.eq.${myGameId}`)
    .order("matched_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  const out: MatchEntry[] = [];
  for (const m of rows) {
    const isASide = m.game_a_id === myGameId;
    const otherGameId = isASide ? m.game_b_id : m.game_a_id;
    const dismissed = isASide ? !!m.a_dismissed_at : !!m.b_dismissed_at;
    if (dismissed) continue;
    const other = await getGameContact(otherGameId);
    if (!other) continue;
    out.push({
      matchId: m.id,
      matchedAt: m.matched_at,
      dismissed: false,
      other,
    });
  }
  return out;
}
