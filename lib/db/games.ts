// Game-related database operations.
// All Supabase calls use the service-role client - bypasses RLS, server-only.
// This module is responsible for keeping our `games`, `game_tags`, and `game_owners`
// rows in sync with what Steam reports.

import { createServerClient } from "@/lib/supabase/server";
import { fetchGameInfo, type SteamGameInfo } from "@/lib/steam/api";
import { fetchNewsActivityDates } from "@/lib/steam/news";

export interface GameOwnerState {
  gameId: string;
  steamAppId: string;
  name: string;
  capsuleUrl: string | null;
  storeUrl: string;
  verificationCode: string | null;
  verifiedAt: string | null;
  // Stats shown on the verified card. All optional - some games (especially unreleased) lack data.
  wishlistCount: number | null;       // Self-reported by the dev. Primary audience-size signal.
  wishlistCountUpdatedAt: string | null;
  reviewCount: number | null;
  releaseDate: string | null;          // ISO YYYY-MM-DD
  releaseStatus: "unreleased" | "early_access" | "released";
  firstUpdateDate: string | null;     // ISO YYYY-MM-DD - proxy for page-live date
  lastUpdateDate: string | null;      // ISO YYYY-MM-DD - dead-game detector
}

/**
 * Look up the game (by app ID), creating or refreshing it from Steam if needed.
 * Returns the games.id (uuid) plus the fresh metadata.
 */
export async function upsertGameFromSteam(
  appId: string
): Promise<{ gameId: string; info: SteamGameInfo } | { error: "not_found" | "fetch_failed" }> {
  const info = await fetchGameInfo(appId);
  if (!info) return { error: "not_found" };

  const supabase = createServerClient();

  const { data: existingGame, error: lookupError } = await supabase
    .from("games")
    .select("id")
    .eq("steam_app_id", appId)
    .maybeSingle();

  if (lookupError) {
    console.error("upsertGameFromSteam: lookup failed", lookupError);
    return { error: "fetch_failed" };
  }

  // Fire the news-activity fetch in parallel with the DB lookup. It's an extra
  // HTTP call to a different Steam endpoint and we don't want to serialize.
  const newsPromise = fetchNewsActivityDates(info.appId);

  // Build the base row WITHOUT tags_source - we'll apply that conditionally below
  // to avoid overwriting a user's 'manual' setting.
  const baseGameRow = {
    steam_app_id: info.appId,
    name: info.name,
    capsule_url: info.capsuleUrl,
    store_url: info.storeUrl,
    price_cents_usd: info.priceCentsUsd,
    release_status: info.releaseStatus,
    release_date: info.releaseDate,
    review_count: info.reviewCount,
    last_synced_at: new Date().toISOString(),
  };

  // Check existing tags_source FIRST so we can decide whether to keep the user's manual
  // tag override. Skipping the Steam-derived tag overwrite if tags_source is 'manual':
  // for unreleased games SteamSpy data is incomplete, and the user's hand-curated list
  // is more accurate. They can clear it back to Steam-sourced via the UI later.
  const { data: existingSource } = await supabase
    .from("games")
    .select("tags_source")
    .eq("id", existingGame?.id ?? "")
    .maybeSingle();
  const isManual = existingSource?.tags_source === "manual";

  // Build the row to write. Set tags_source to the freshly-fetched source only if
  // not manual; otherwise leave the manual value alone.
  const gameRow = isManual
    ? baseGameRow
    : { ...baseGameRow, tags_source: info.tagsSource };

  let gameId: string;
  if (existingGame) {
    const { error: updateErr } = await supabase
      .from("games")
      .update(gameRow)
      .eq("id", existingGame.id);
    if (updateErr) {
      console.error("upsertGameFromSteam: update failed", updateErr);
      return { error: "fetch_failed" };
    }
    gameId = existingGame.id;
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from("games")
      .insert(gameRow)
      .select("id")
      .single();
    if (insertErr || !inserted) {
      console.error("upsertGameFromSteam: insert failed", insertErr);
      return { error: "fetch_failed" };
    }
    gameId = inserted.id;
  }

  if (!isManual) {
    await supabase.from("game_tags").delete().eq("game_id", gameId);
    if (info.tags.length > 0) {
      const tagRows = info.tags.map((t) => ({ game_id: gameId, tag: t }));
      const { error: tagErr } = await supabase.from("game_tags").insert(tagRows);
      if (tagErr) {
        console.error("upsertGameFromSteam: tag insert failed", tagErr);
        // Non-fatal: we keep the game row, just without tags. User can re-trigger sync later.
      }
    }
  }

  // Apply news activity dates. Best-effort - if the news fetch returns nothing
  // (no news posts on the game's hub), leave the existing values alone.
  try {
    const news = await newsPromise;
    if (news.firstUpdateDate || news.lastUpdateDate) {
      await supabase
        .from("games")
        .update({
          first_update_date: news.firstUpdateDate,
          last_update_date: news.lastUpdateDate,
        })
        .eq("id", gameId);
    }
  } catch (e) {
    console.warn("upsertGameFromSteam: news fetch threw", e);
  }

  return { gameId, info };
}

/**
 * Get the current game-claim state for a user.
 * Returns null when the user has no claim.
 */
export async function getGameOwnerStateForUser(
  userId: string
): Promise<GameOwnerState | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("game_owners")
    .select(
      `
      game_id,
      verification_code,
      verified_at,
      games:game_id (steam_app_id, name, capsule_url, store_url, wishlist_count, wishlist_count_updated_at, review_count, release_date, release_status, first_update_date, last_update_date)
    `
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("getGameOwnerStateForUser: query failed", error);
    return null;
  }
  if (!data) return null;

  // Supabase returns the joined relation either as an object or as an array
  // depending on relationship inference. Normalize to a single object.
  const game = Array.isArray(data.games) ? data.games[0] : data.games;
  if (!game) return null;

  return {
    gameId: data.game_id,
    steamAppId: game.steam_app_id,
    name: game.name,
    capsuleUrl: game.capsule_url ?? null,
    storeUrl: game.store_url ?? `https://store.steampowered.com/app/${game.steam_app_id}/`,
    verificationCode: data.verification_code ?? null,
    verifiedAt: data.verified_at ?? null,
    wishlistCount: game.wishlist_count ?? null,
    wishlistCountUpdatedAt: game.wishlist_count_updated_at ?? null,
    reviewCount: game.review_count ?? null,
    releaseDate: game.release_date ?? null,
    releaseStatus: (game.release_status ?? "unreleased") as "unreleased" | "early_access" | "released",
    firstUpdateDate: game.first_update_date ?? null,
    lastUpdateDate: game.last_update_date ?? null,
  };
}
