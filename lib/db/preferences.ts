// Bundle preference helpers.
// Smart defaults: when a verified user opens preferences for the first time,
// pre-populate based on their own game (their tags, follower count, price)
// rather than showing zeros / empty fields.

import { createServerClient } from "@/lib/supabase/server";

export interface BundlePreferences {
  requiredTags: string[];
  /**
   * Other game must share AT LEAST this many of `requiredTags` to qualify. Range 1-5.
   * Default 3 (or fewer if requiredTags has fewer than 3 entries).
   */
  requiredTagsMatchCount: number;
  excludedTags: string[];
  /**
   * Other game is excluded if it has AT LEAST this many of `excludedTags`. Range 1-5.
   * Default 1.
   */
  excludedTagsMatchCount: number;
  minFollowerCount: number;
  priceBandMinCents: number;
  priceBandMaxCents: number;
  notes: string;
  isActive: boolean;
}

export interface BundlePreferencesResponse {
  gameId: string;
  preferences: BundlePreferences;
  // True when these are smart defaults derived from the user's game,
  // false when they're saved values pulled from bundle_preferences.
  isDefault: boolean;
  // The user's own game tags - shown in the UI as "Your tags" quick-add buttons.
  ownGameTags: string[];
  // Where ownGameTags came from. Used to render a "tags may be incomplete" warning
  // when SteamSpy didn't have data and we fell back to genres.
  tagsSource: "steamspy" | "genres" | "manual" | null;
}

const MAX_TAG_LENGTH = 64;
const MAX_TAGS = 20;
const MAX_NOTES_LENGTH = 500;
const MAX_PRICE_CENTS = 999999;
const MAX_FOLLOWER_COUNT = 100_000_000;
const MIN_MATCH_COUNT = 1;
const MAX_MATCH_COUNT = 5;
// Default required-tag match count: 2 is a useful middle ground while the userbase is small.
// 1 is too permissive (a single broad tag like "Indie" matches too much) and 3 is too strict
// when there are only a few dozen devs registered. We can raise this default later as the
// pool grows large enough that 2-tag matches return too many results.
const DEFAULT_REQUIRED_MATCH_COUNT = 2;
const DEFAULT_EXCLUDED_MATCH_COUNT = 1;

/**
 * Get preferences for a specific game owned by the given user.
 * Returns saved preferences if they exist, otherwise smart defaults derived from the game.
 * The userId parameter is used to confirm ownership before returning data.
 */
export async function getPreferencesForGame(
  userId: string,
  gameId: string
): Promise<BundlePreferencesResponse | { error: "no_verified_game" | "lookup_failed" }> {
  const supabase = createServerClient();

  // Confirm the user owns this specific game and that it's verified.
  const { data: ownerRow, error: ownerErr } = await supabase
    .from("game_owners")
    .select("game_id, verified_at")
    .eq("user_id", userId)
    .eq("game_id", gameId)
    .maybeSingle();
  if (ownerErr) return { error: "lookup_failed" };
  if (!ownerRow || !ownerRow.verified_at) {
    return { error: "no_verified_game" };
  }

  // Game info + tags + tags_source - shared by both saved-prefs and smart-defaults branches.
  // We pull wishlist_count (self-reported, primary audience signal) for smart defaults.
  const { data: game } = await supabase
    .from("games")
    .select("id, wishlist_count, price_cents_usd, tags_source")
    .eq("id", gameId)
    .single();
  const { data: tagsRows } = await supabase
    .from("game_tags")
    .select("tag")
    .eq("game_id", gameId);

  const ownTags = (tagsRows ?? []).map((t) => t.tag);
  const tagsSource = (game?.tags_source ?? null) as
    | "steamspy"
    | "genres"
    | "manual"
    | null;

  // Look for existing preferences row.
  const { data: existing, error: prefErr } = await supabase
    .from("bundle_preferences")
    .select("*")
    .eq("game_id", gameId)
    .maybeSingle();
  if (prefErr) return { error: "lookup_failed" };

  if (existing) {
    return {
      gameId,
      preferences: {
        requiredTags: existing.required_tags ?? [],
        requiredTagsMatchCount: clampMatchCount(
          existing.required_tags_match_count ?? DEFAULT_REQUIRED_MATCH_COUNT
        ),
        excludedTags: existing.excluded_tags ?? [],
        excludedTagsMatchCount: clampMatchCount(
          existing.excluded_tags_match_count ?? DEFAULT_EXCLUDED_MATCH_COUNT
        ),
        minFollowerCount: existing.min_follower_count ?? 0,
        priceBandMinCents: existing.price_band_min_cents ?? 0,
        priceBandMaxCents: existing.price_band_max_cents ?? MAX_PRICE_CENTS,
        notes: existing.notes ?? "",
        isActive: existing.is_active ?? true,
      },
      isDefault: false,
      ownGameTags: ownTags,
      tagsSource,
    };
  }

  // No preferences yet, compute smart defaults.
  // Default required tags: top 3 from the game's own tags. SteamSpy returns tags sorted by vote
  // count, and we insert in that order, so ownTags[0..2] is the right slice.
  const defaultRequiredTags = ownTags.slice(0, 3);

  // Smart default for the audience-size threshold: half of own wishlist count, rounded.
  // Stored in min_follower_count column for backward compat (semantically a wishlist threshold now).
  const ownWishlists = game?.wishlist_count ?? null;
  const defaultMinWishlists = ownWishlists != null ? roundToNice(Math.floor(ownWishlists / 2)) : 0;

  const ownPrice = game?.price_cents_usd ?? null;
  let defaultMinPrice = 0;
  let defaultMaxPrice = MAX_PRICE_CENTS;
  if (ownPrice != null && ownPrice > 0) {
    // Round to whole dollars so the UI's integer display matches saved value.
    defaultMinPrice = Math.max(0, Math.round((ownPrice * 0.5) / 100) * 100);
    defaultMaxPrice = Math.min(MAX_PRICE_CENTS, Math.round((ownPrice * 2) / 100) * 100);
  } else if (ownPrice === 0) {
    // Free game owner. Default: bundle with anything up to $10.
    defaultMinPrice = 0;
    defaultMaxPrice = 1000;
  }

  return {
    gameId,
    preferences: {
      requiredTags: defaultRequiredTags,
      requiredTagsMatchCount: Math.min(
        DEFAULT_REQUIRED_MATCH_COUNT,
        Math.max(1, defaultRequiredTags.length)
      ),
      excludedTags: [],
      excludedTagsMatchCount: DEFAULT_EXCLUDED_MATCH_COUNT,
      minFollowerCount: defaultMinWishlists,
      priceBandMinCents: defaultMinPrice,
      priceBandMaxCents: defaultMaxPrice,
      notes: "",
      isActive: true,
    },
    isDefault: true,
    ownGameTags: ownTags,
    tagsSource,
  };
}

/**
 * Validate and normalize a preferences payload.
 */
export function validatePreferences(
  raw: unknown
): { ok: true; value: BundlePreferences } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "invalid_payload" };
  }
  const r = raw as Record<string, unknown>;

  const requiredTags = sanitizeTagArray(r.requiredTags);
  if (!requiredTags.ok) return { ok: false, error: requiredTags.error };
  if (requiredTags.value.length === 0) {
    return { ok: false, error: "required_tags_empty" };
  }

  const excludedTags = sanitizeTagArray(r.excludedTags);
  if (!excludedTags.ok) return { ok: false, error: excludedTags.error };

  const requiredTagsMatchCount = sanitizeInt(
    r.requiredTagsMatchCount,
    MIN_MATCH_COUNT,
    MAX_MATCH_COUNT
  );
  if (requiredTagsMatchCount === null) {
    return { ok: false, error: "invalid_required_match_count" };
  }
  // Match count can't exceed the number of tags - that would make matching impossible.
  if (requiredTagsMatchCount > requiredTags.value.length) {
    return { ok: false, error: "required_match_count_too_high" };
  }

  const excludedTagsMatchCount = sanitizeInt(
    r.excludedTagsMatchCount,
    MIN_MATCH_COUNT,
    MAX_MATCH_COUNT
  );
  if (excludedTagsMatchCount === null) {
    return { ok: false, error: "invalid_excluded_match_count" };
  }

  const minFollowerCount = sanitizeInt(r.minFollowerCount, 0, MAX_FOLLOWER_COUNT);
  if (minFollowerCount === null) return { ok: false, error: "invalid_min_follower_count" };

  const priceBandMinCents = sanitizeInt(r.priceBandMinCents, 0, MAX_PRICE_CENTS);
  if (priceBandMinCents === null) return { ok: false, error: "invalid_price_band_min" };

  const priceBandMaxCents = sanitizeInt(r.priceBandMaxCents, 0, MAX_PRICE_CENTS);
  if (priceBandMaxCents === null) return { ok: false, error: "invalid_price_band_max" };

  if (priceBandMinCents > priceBandMaxCents) {
    return { ok: false, error: "price_band_min_above_max" };
  }

  const notes = typeof r.notes === "string" ? r.notes.slice(0, MAX_NOTES_LENGTH) : "";
  const isActive = Boolean(r.isActive ?? true);

  return {
    ok: true,
    value: {
      requiredTags: requiredTags.value,
      requiredTagsMatchCount,
      excludedTags: excludedTags.value,
      excludedTagsMatchCount,
      minFollowerCount,
      priceBandMinCents,
      priceBandMaxCents,
      notes,
      isActive,
    },
  };
}

/**
 * Save preferences for a specific verified game owned by the given user.
 * Upserts the row.
 */
export async function savePreferencesForGame(
  userId: string,
  gameId: string,
  prefs: BundlePreferences
): Promise<{ ok: true } | { ok: false; error: "no_verified_game" | "save_failed" }> {
  const supabase = createServerClient();

  const { data: ownerRow } = await supabase
    .from("game_owners")
    .select("game_id, verified_at")
    .eq("user_id", userId)
    .eq("game_id", gameId)
    .maybeSingle();
  if (!ownerRow || !ownerRow.verified_at) {
    return { ok: false, error: "no_verified_game" };
  }

  const { error } = await supabase.from("bundle_preferences").upsert(
    {
      game_id: ownerRow.game_id,
      required_tags: prefs.requiredTags,
      required_tags_match_count: prefs.requiredTagsMatchCount,
      excluded_tags: prefs.excludedTags,
      excluded_tags_match_count: prefs.excludedTagsMatchCount,
      min_follower_count: prefs.minFollowerCount,
      price_band_min_cents: prefs.priceBandMinCents,
      price_band_max_cents: prefs.priceBandMaxCents,
      notes: prefs.notes,
      is_active: prefs.isActive,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "game_id" }
  );

  if (error) {
    console.error("savePreferencesForUser: upsert failed", error);
    return { ok: false, error: "save_failed" };
  }
  return { ok: true };
}

// =============================================================================
// Internal helpers
// =============================================================================

function sanitizeTagArray(
  raw: unknown
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "tags_must_be_array" };
  const clean: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim().slice(0, MAX_TAG_LENGTH);
    if (!trimmed) continue;
    const lc = trimmed.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    clean.push(trimmed);
    if (clean.length >= MAX_TAGS) break;
  }
  return { ok: true, value: clean };
}

function sanitizeInt(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === "string" ? Number(raw) : (raw as number);
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) return null;
  return Math.floor(n);
}

function clampMatchCount(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_REQUIRED_MATCH_COUNT;
  return Math.min(MAX_MATCH_COUNT, Math.max(MIN_MATCH_COUNT, Math.floor(n)));
}

function roundToNice(n: number): number {
  if (n <= 10) return n;
  if (n <= 100) return Math.round(n / 10) * 10;
  if (n <= 1000) return Math.round(n / 50) * 50;
  if (n <= 10000) return Math.round(n / 100) * 100;
  return Math.round(n / 1000) * 1000;
}
