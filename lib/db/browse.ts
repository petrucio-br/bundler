// Eligible pool query - the heart of Bundler's matching.
// Given a signed-in user, returns games that:
//   1. Are owned by some other verified+active dev
//   2. Pass the user's preferences (their required tags overlap >= match count, etc.)
//   3. The user's game also passes THEIR preferences (mutual eligibility)
//   4. The user hasn't already swiped on
//   5. Aren't blocked either way
//
// V1 strategy: pull a moderate-size candidate pool from the DB (filtering only the
// trivially exact conditions there - verified, active, not-self, not-swiped, not-blocked),
// then apply the array-overlap filters in JS. This scales fine to a few thousand games;
// when we cross that we'll move the filter into Postgres array operators.

import { createServerClient } from "@/lib/supabase/server";

export type SortOption = "tag-overlap" | "follower-count" | "recency";

export interface BrowseGame {
  gameId: string;
  steamAppId: string;
  name: string;
  capsuleUrl: string | null;
  storeUrl: string;
  tags: string[];
  wishlistCount: number | null;       // Self-reported by the candidate's dev.
  reviewCount: number | null;
  releaseDate: string | null;
  releaseStatus: "unreleased" | "early_access" | "released";
  firstUpdateDate: string | null;
  lastUpdateDate: string | null;
  notes: string | null;
  // For each candidate, we compute and ship the overlap counts so the UI can
  // visually highlight which tags are matching the swiper's required filter.
  matchedRequiredTags: string[];
  matchedExcludedTags: string[]; // any excluded tag the candidate carries (informational)
}

export interface BrowseResult {
  games: BrowseGame[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

interface SwiperContext {
  gameId: string;
  steamAppId: string;
  name: string;
  wishlistCount: number | null;
  tags: Set<string>;
  prefs: {
    requiredTags: string[];
    requiredTagsMatchCount: number;
    excludedTags: string[];
    excludedTagsMatchCount: number;
    /** Stored in bundle_preferences.min_follower_count for legacy reasons; semantically this is the min wishlist threshold now. */
    minWishlistCount: number;
    isActive: boolean;
  };
}

interface CandidateRow {
  gameId: string;
  steamAppId: string;
  name: string;
  capsuleUrl: string | null;
  storeUrl: string;
  wishlistCount: number | null;
  reviewCount: number | null;
  releaseDate: string | null;
  releaseStatus: "unreleased" | "early_access" | "released";
  firstUpdateDate: string | null;
  lastUpdateDate: string | null;
  createdAt: string;
  tags: string[];
  prefs: {
    requiredTags: string[];
    requiredTagsMatchCount: number;
    excludedTags: string[];
    excludedTagsMatchCount: number;
    minWishlistCount: number;
    notes: string | null;
    isActive: boolean;
  };
}

const DEFAULT_PAGE_SIZE = 16;

/**
 * Get the eligible pool from the perspective of a specific game owned by the user.
 * See module comment for filter semantics.
 */
export async function getEligiblePool(
  userId: string,
  swiperGameId: string,
  options: { sort?: SortOption; page?: number; pageSize?: number; search?: string } = {}
): Promise<BrowseResult | { error: "no_swiper_context" | "lookup_failed" }> {
  const sort = options.sort ?? "tag-overlap";
  const page = Math.max(0, options.page ?? 0);
  const pageSize = Math.min(50, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE));
  const searchQuery = (options.search ?? "").trim().toLowerCase();

  const swiper = await getSwiperContext(userId, swiperGameId);
  if (!swiper) return { error: "no_swiper_context" };
  if (!swiper.prefs.isActive) {
    // Swiper is paused. We still let them browse - but in this V1 we treat their pool as empty
    // because mutual eligibility requires them to be active. Actually the swiper's own active
    // status only matters for whether they SHOW UP in others' pools, so they can still browse.
    // Keeping this branch as a placeholder if we change the semantics.
  }

  const candidates = await getCandidatePool(userId);
  if (candidates === null) return { error: "lookup_failed" };

  const swipedSet = await getSwipedGameIds(swiper.gameId);
  const blockedSet = await getBlockedGameIds(swiper.gameId);

  const eligible: BrowseGame[] = [];
  for (const c of candidates) {
    if (swipedSet.has(c.gameId)) continue;
    if (blockedSet.has(c.gameId)) continue;
    if (!c.prefs.isActive) continue;
    if (searchQuery && !c.name.toLowerCase().includes(searchQuery)) continue;

    const candidateTagSet = new Set(c.tags.map((t) => t.toLowerCase()));
    const swiperTagSet = swiper.tags;

    // Swiper's required-tag filter on the candidate.
    const matchedRequired = swiper.prefs.requiredTags.filter((t) =>
      candidateTagSet.has(t.toLowerCase())
    );
    // Match count of 0 means "no required-tag filter" - experienced bundlers want this.
    if (
      swiper.prefs.requiredTagsMatchCount > 0 &&
      matchedRequired.length < swiper.prefs.requiredTagsMatchCount
    )
      continue;

    // Swiper's excluded-tag filter on the candidate.
    const matchedExcluded = swiper.prefs.excludedTags.filter((t) =>
      candidateTagSet.has(t.toLowerCase())
    );
    if (matchedExcluded.length >= swiper.prefs.excludedTagsMatchCount) continue;

    // Swiper's wishlist-count filter on the candidate. Treats null as 0
    // (candidate hasn't self-reported yet -> below any threshold).
    const candidateWishlists = c.wishlistCount ?? 0;
    if (candidateWishlists < swiper.prefs.minWishlistCount) continue;

    // Mutual: candidate's required-tag filter on the swiper.
    const candidateRequiredHits = c.prefs.requiredTags.filter((t) =>
      swiperTagSet.has(t.toLowerCase())
    ).length;
    // Mutual: same "0 means no filter" rule applies to the candidate's required tags.
    if (
      c.prefs.requiredTagsMatchCount > 0 &&
      candidateRequiredHits < c.prefs.requiredTagsMatchCount
    )
      continue;

    // Mutual: candidate's excluded-tag filter on the swiper.
    const candidateExcludedHits = c.prefs.excludedTags.filter((t) =>
      swiperTagSet.has(t.toLowerCase())
    ).length;
    if (candidateExcludedHits >= c.prefs.excludedTagsMatchCount) continue;

    // Mutual: candidate's wishlist-count filter on the swiper.
    const swiperWishlists = swiper.wishlistCount ?? 0;
    if (swiperWishlists < c.prefs.minWishlistCount) continue;

    eligible.push({
      gameId: c.gameId,
      steamAppId: c.steamAppId,
      name: c.name,
      capsuleUrl: c.capsuleUrl,
      storeUrl: c.storeUrl,
      tags: c.tags,
      wishlistCount: c.wishlistCount,
      reviewCount: c.reviewCount,
      releaseDate: c.releaseDate,
      releaseStatus: c.releaseStatus,
      firstUpdateDate: c.firstUpdateDate,
      lastUpdateDate: c.lastUpdateDate,
      notes: c.prefs.notes,
      matchedRequiredTags: matchedRequired,
      matchedExcludedTags: matchedExcluded,
    });
  }

  // Sort.
  switch (sort) {
    case "follower-count":
      // Sort key kept as "follower-count" for URL stability; semantically sorts by self-reported wishlist count now.
      eligible.sort((a, b) => (b.wishlistCount ?? 0) - (a.wishlistCount ?? 0));
      break;
    case "recency":
      // Most-recently-added games first. We'd need createdAt on BrowseGame; using
      // first_update_date as a proxy ("dev activity recency") is more useful anyway.
      eligible.sort((a, b) => (b.firstUpdateDate ?? "").localeCompare(a.firstUpdateDate ?? ""));
      break;
    case "tag-overlap":
    default:
      eligible.sort((a, b) => {
        const overlapDiff = b.matchedRequiredTags.length - a.matchedRequiredTags.length;
        if (overlapDiff !== 0) return overlapDiff;
        // Tiebreaker: more wishlists first.
        return (b.wishlistCount ?? 0) - (a.wishlistCount ?? 0);
      });
      break;
  }

  const total = eligible.length;
  const start = page * pageSize;
  const slice = eligible.slice(start, start + pageSize);

  return {
    games: slice,
    total,
    page,
    pageSize,
    hasMore: start + slice.length < total,
  };
}

/**
 * Get games this user's specific game has swiped in a specific direction.
 * Used for the Yes / Maybe / No tabs.
 * For direction='yes', games that already have a match are filtered out - those live in
 * the Matches section, not Yes (Yes = "I said yes, waiting on them").
 */
export async function getSwipedGames(
  userId: string,
  swiperGameId: string,
  direction: "yes" | "no" | "maybe"
): Promise<BrowseGame[] | { error: "no_swiper_context" | "lookup_failed" }> {
  const swiper = await getSwiperContext(userId, swiperGameId);
  if (!swiper) return { error: "no_swiper_context" };

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("swipes")
    .select(
      `
      target_game_id,
      created_at,
      games:target_game_id (
        id, steam_app_id, name, capsule_url, store_url,
        wishlist_count, review_count, release_date, release_status,
        first_update_date, last_update_date,
        bundle_preferences:bundle_preferences ( notes, required_tags, excluded_tags ),
        game_tags ( tag )
      )
    `
    )
    .eq("swiper_game_id", swiper.gameId)
    .eq("direction", direction)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getSwipedGames: query failed", error);
    return { error: "lookup_failed" };
  }

  // For Yes tab: filter out games that have an active match. Matched games
  // belong in the Matches section; the Yes tab is for "pending" yes-swipes.
  let matchedGameIds: Set<string> | null = null;
  if (direction === "yes") {
    const { data: matchRows } = await supabase
      .from("matches")
      .select("game_a_id, game_b_id")
      .or(`game_a_id.eq.${swiper.gameId},game_b_id.eq.${swiper.gameId}`);
    matchedGameIds = new Set<string>();
    for (const m of matchRows ?? []) {
      const otherId = m.game_a_id === swiper.gameId ? m.game_b_id : m.game_a_id;
      matchedGameIds.add(otherId);
    }
  }

  const games: BrowseGame[] = [];
  for (const row of data ?? []) {
    const game = Array.isArray(row.games) ? row.games[0] : row.games;
    if (!game) continue;
    if (matchedGameIds && matchedGameIds.has(game.id)) continue;
    const prefs = Array.isArray(game.bundle_preferences)
      ? game.bundle_preferences[0]
      : game.bundle_preferences;
    const tags: string[] = (game.game_tags ?? []).map((t: { tag: string }) => t.tag);
    const candidateTagSet = new Set(tags.map((t) => t.toLowerCase()));
    const matchedRequired = swiper.prefs.requiredTags.filter((t) =>
      candidateTagSet.has(t.toLowerCase())
    );
    const matchedExcluded = swiper.prefs.excludedTags.filter((t) =>
      candidateTagSet.has(t.toLowerCase())
    );

    games.push({
      gameId: game.id,
      steamAppId: game.steam_app_id,
      name: game.name,
      capsuleUrl: game.capsule_url ?? null,
      storeUrl: game.store_url ?? `https://store.steampowered.com/app/${game.steam_app_id}/`,
      tags,
      wishlistCount: game.wishlist_count ?? null,
      reviewCount: game.review_count ?? null,
      releaseDate: game.release_date ?? null,
      releaseStatus: (game.release_status ?? "unreleased") as "unreleased" | "early_access" | "released",
      firstUpdateDate: game.first_update_date ?? null,
      lastUpdateDate: game.last_update_date ?? null,
      notes: prefs?.notes ?? null,
      matchedRequiredTags: matchedRequired,
      matchedExcludedTags: matchedExcluded,
    });
  }

  return games;
}

// =============================================================================
// Internal helpers
// =============================================================================

async function getSwiperContext(
  userId: string,
  gameId: string
): Promise<SwiperContext | null> {
  const supabase = createServerClient();

  // Confirm the user owns this specific gameId, then load its prefs + tags.
  // PostgREST can't traverse the indirect game_owners → games → bundle_preferences chain
  // in a single SELECT, so we run two queries: cleaner and rock-solid.
  const { data: ownerRow } = await supabase
    .from("game_owners")
    .select(
      `
      game_id,
      verified_at,
      games:game_id ( steam_app_id, name, wishlist_count, game_tags ( tag ) )
    `
    )
    .eq("user_id", userId)
    .eq("game_id", gameId)
    .maybeSingle();

  if (!ownerRow || !ownerRow.verified_at) return null;
  const game = Array.isArray(ownerRow.games) ? ownerRow.games[0] : ownerRow.games;
  if (!game) return null;

  const { data: prefsRaw } = await supabase
    .from("bundle_preferences")
    .select(
      "required_tags, required_tags_match_count, excluded_tags, excluded_tags_match_count, min_follower_count, is_active"
    )
    .eq("game_id", ownerRow.game_id)
    .maybeSingle();
  if (!prefsRaw) return null;

  const tags = (game.game_tags ?? []).map((t: { tag: string }) => t.tag.toLowerCase());

  return {
    gameId: ownerRow.game_id,
    steamAppId: game.steam_app_id,
    name: game.name,
    wishlistCount: game.wishlist_count ?? null,
    tags: new Set(tags),
    prefs: {
      requiredTags: prefsRaw.required_tags ?? [],
      requiredTagsMatchCount: prefsRaw.required_tags_match_count ?? 1,
      excludedTags: prefsRaw.excluded_tags ?? [],
      excludedTagsMatchCount: prefsRaw.excluded_tags_match_count ?? 1,
      // bundle_preferences.min_follower_count column kept for backward compat;
      // semantics flipped to "minimum wishlist count" with the wishlist pivot.
      minWishlistCount: prefsRaw.min_follower_count ?? 0,
      isActive: prefsRaw.is_active ?? true,
    },
  };
}

async function getCandidatePool(swiperUserId: string): Promise<CandidateRow[] | null> {
  // Exclude games owned by the swiper's own user (covers self + any other games they own).
  // Self-matching is meaningless and confusing UX; a dev can't bundle with themselves.
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("game_owners")
    .select(
      `
      game_id,
      verified_at,
      games:game_id (
        id, steam_app_id, name, capsule_url, store_url,
        wishlist_count, review_count, release_date, release_status,
        first_update_date, last_update_date, created_at,
        game_tags ( tag ),
        bundle_preferences:bundle_preferences (
          required_tags, required_tags_match_count,
          excluded_tags, excluded_tags_match_count,
          min_follower_count, notes, is_active
        )
      )
    `
    )
    .not("verified_at", "is", null)
    .neq("user_id", swiperUserId);

  if (error) {
    console.error("getCandidatePool: query failed", error);
    return null;
  }

  const out: CandidateRow[] = [];
  for (const row of data ?? []) {
    const game = Array.isArray(row.games) ? row.games[0] : row.games;
    if (!game) continue;
    const prefs = Array.isArray(game.bundle_preferences)
      ? game.bundle_preferences[0]
      : game.bundle_preferences;
    if (!prefs) continue; // candidate hasn't saved preferences yet - skip

    const tags = (game.game_tags ?? []).map((t: { tag: string }) => t.tag);

    out.push({
      gameId: game.id,
      steamAppId: game.steam_app_id,
      name: game.name,
      capsuleUrl: game.capsule_url ?? null,
      storeUrl: game.store_url ?? `https://store.steampowered.com/app/${game.steam_app_id}/`,
      wishlistCount: game.wishlist_count ?? null,
      reviewCount: game.review_count ?? null,
      releaseDate: game.release_date ?? null,
      releaseStatus: (game.release_status ?? "unreleased") as "unreleased" | "early_access" | "released",
      firstUpdateDate: game.first_update_date ?? null,
      lastUpdateDate: game.last_update_date ?? null,
      createdAt: game.created_at ?? new Date(0).toISOString(),
      tags,
      prefs: {
        requiredTags: prefs.required_tags ?? [],
        requiredTagsMatchCount: prefs.required_tags_match_count ?? 1,
        excludedTags: prefs.excluded_tags ?? [],
        excludedTagsMatchCount: prefs.excluded_tags_match_count ?? 1,
        minWishlistCount: prefs.min_follower_count ?? 0,
        notes: prefs.notes ?? null,
        isActive: prefs.is_active ?? true,
      },
    });
  }
  return out;
}

async function getSwipedGameIds(swiperGameId: string): Promise<Set<string>> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("swipes")
    .select("target_game_id")
    .eq("swiper_game_id", swiperGameId);
  return new Set((data ?? []).map((s) => s.target_game_id));
}

async function getBlockedGameIds(swiperGameId: string): Promise<Set<string>> {
  const supabase = createServerClient();
  const [{ data: blocking }, { data: blockedBy }] = await Promise.all([
    supabase.from("blocks").select("blocked_game_id").eq("blocker_game_id", swiperGameId),
    supabase.from("blocks").select("blocker_game_id").eq("blocked_game_id", swiperGameId),
  ]);
  const set = new Set<string>();
  for (const r of blocking ?? []) set.add(r.blocked_game_id);
  for (const r of blockedBy ?? []) set.add(r.blocker_game_id);
  return set;
}
