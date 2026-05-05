// Steam game metadata fetchers.
// We use two sources because no single Steam endpoint gives us everything:
//   1. Steam Storefront API (store.steampowered.com/api/appdetails) - name, capsule, price, release date.
//      Undocumented but very stable, used widely by indie tooling.
//   2. SteamSpy API - tags. The Storefront API returns "categories" and "genres" but not user-facing tags;
//      SteamSpy aggregates tags from store pages. Has up to 24h lag but that's fine for our use case.

export interface SteamGameInfo {
  appId: string;
  name: string;
  capsuleUrl: string | null;
  storeUrl: string;
  priceCentsUsd: number | null;
  releaseStatus: "unreleased" | "early_access" | "released";
  releaseDate: string | null; // ISO date string (YYYY-MM-DD)
  reviewCount: number | null; // Total positive + negative recommendations from Storefront. Null/0 for unreleased.
  tags: string[];
  /**
   * Where the tags came from. SteamSpy returns user-voted Steam tags (the gold standard)
   * but lags for unreleased games. Storefront genres is a coarser fallback. UI uses this
   * to nudge users to refresh later when they first see a genres-derived list.
   */
  tagsSource: "steamspy" | "genres" | null;
}

const STOREFRONT_BASE = "https://store.steampowered.com/api/appdetails";
const STEAMSPY_BASE = "https://steamspy.com/api.php";

/**
 * Fetch full game metadata for an app ID. Combines Storefront + SteamSpy.
 * Returns null if the app doesn't exist or isn't a game.
 * Tags are best-effort: if SteamSpy fails or returns nothing, we return [].
 */
export async function fetchGameInfo(appId: string): Promise<SteamGameInfo | null> {
  // Storefront API. Use cc=us so we get USD prices.
  const storefrontUrl = `${STOREFRONT_BASE}?appids=${encodeURIComponent(appId)}&cc=us&l=english`;
  let storefrontJson: Record<string, { success: boolean; data?: StorefrontAppData }>;
  try {
    const res = await fetch(storefrontUrl, {
      headers: { "User-Agent": "Bundler/0.1 (https://bundler.games)" },
      next: { revalidate: 60 * 60 }, // cache 1h, store metadata doesn't change often
    });
    if (!res.ok) return null;
    storefrontJson = await res.json();
  } catch {
    return null;
  }

  const entry = storefrontJson[appId];
  if (!entry || !entry.success || !entry.data) return null;
  const d = entry.data;

  // Type filter. Storefront returns DLC, demo, soundtrack, etc. We only want games.
  if (d.type !== "game" && d.type !== "demo") {
    // Could relax this later. For V1: only games can be claimed for bundling.
    return null;
  }

  const releaseStatus: SteamGameInfo["releaseStatus"] = d.release_date?.coming_soon
    ? "unreleased"
    : d.genres?.some((g) => /early access/i.test(g.description))
      ? "early_access"
      : "released";

  // Try to parse release date. Steam returns localized strings like "Jun 15, 2026" or "Coming soon" - we tolerate failures.
  let releaseDate: string | null = null;
  if (d.release_date && !d.release_date.coming_soon && d.release_date.date) {
    const parsed = new Date(d.release_date.date);
    if (!isNaN(parsed.getTime())) {
      releaseDate = parsed.toISOString().slice(0, 10);
    }
  }

  // Price. final price is in cents. price_overview is missing for free games and unreleased games.
  let priceCentsUsd: number | null = null;
  if (d.price_overview && typeof d.price_overview.final === "number") {
    priceCentsUsd = d.price_overview.final;
  } else if (d.is_free) {
    priceCentsUsd = 0;
  }

  // Review count. The Storefront API USED to populate `recommendations.total` reliably,
  // but Steam appears to have deprecated that path - many released games now return no
  // recommendations field at all even when they have plenty of reviews. The canonical
  // source is the dedicated `appreviews` endpoint, which always returns a query_summary
  // with total_reviews. Fetch that in parallel with the Storefront / SteamSpy calls.
  // Falls back to recommendations.total if appreviews itself fails.
  const reviewCount = await fetchReviewCount(appId, d.recommendations?.total);

  // Tags. SteamSpy is the primary source (user-voted Steam tags), but it lags significantly
  // for unreleased / freshly-announced games - their crawler may take days/weeks to pick up
  // a new appid. When SteamSpy returns nothing, fall back to the Storefront's `genres` array,
  // which is always present and gives us coarser-but-real categorization (Indie, Strategy, RPG).
  let tags = await fetchSteamSpyTags(appId);
  let tagsSource: SteamGameInfo["tagsSource"] = tags.length > 0 ? "steamspy" : null;
  if (tags.length === 0 && d.genres && d.genres.length > 0) {
    tags = d.genres.map((g) => g.description).filter(Boolean);
    tagsSource = tags.length > 0 ? "genres" : null;
  }

  return {
    appId,
    name: d.name,
    capsuleUrl: d.header_image ?? null,
    storeUrl: `https://store.steampowered.com/app/${appId}/`,
    priceCentsUsd,
    releaseStatus,
    releaseDate,
    reviewCount,
    tags,
    tagsSource,
  };
}

async function fetchReviewCount(
  appId: string,
  storefrontFallback: number | undefined
): Promise<number | null> {
  // Returns aggregate review count via the appreviews query_summary.
  // num_per_page=0 fetches just the summary (no review bodies), keeping the payload small.
  // language=all + purchase_type=all gives the global lifetime count, matching what Steam
  // displays on the public store page.
  const url = `https://store.steampowered.com/appreviews/${encodeURIComponent(
    appId
  )}?json=1&num_per_page=0&language=all&purchase_type=all`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Bundler/0.1 (https://bundler.games)" },
      next: { revalidate: 60 * 60 }, // 1h cache - reviews change slowly enough
    });
    if (res.ok) {
      const data: AppReviewsResponse = await res.json();
      if (data.success === 1) {
        const total = data.query_summary?.total_reviews;
        if (typeof total === "number" && total >= 0) return total;
      }
    }
  } catch {
    // Fall through to the fallback below.
  }
  // Fallback to whatever the storefront returned (for unreleased / non-game types where
  // appreviews may be unhelpful). Null if neither source has a number.
  return typeof storefrontFallback === "number" ? storefrontFallback : null;
}

async function fetchSteamSpyTags(appId: string): Promise<string[]> {
  const url = `${STEAMSPY_BASE}?request=appdetails&appid=${encodeURIComponent(appId)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Bundler/0.1 (https://bundler.games)" },
      next: { revalidate: 60 * 60 * 24 }, // SteamSpy data updates daily
    });
    if (!res.ok) return [];
    const data: SteamSpyResponse = await res.json();
    if (!data.tags || typeof data.tags !== "object") return [];
    // SteamSpy returns tags as { "Roguelike": 5234, "Deck Building": 4892, ... } - votes per tag.
    // We just want the names, sorted by vote count desc, capped at 20.
    return Object.entries(data.tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name]) => name);
  } catch {
    return [];
  }
}

// =============================================================================
// Internal types for Storefront and SteamSpy API responses.
// We only declare the fields we use; Storefront returns dozens we don't care about.
// =============================================================================

interface StorefrontAppData {
  type: string;
  name: string;
  is_free?: boolean;
  header_image?: string;
  release_date?: {
    coming_soon: boolean;
    date: string;
  };
  price_overview?: {
    final: number;
    currency: string;
  };
  genres?: { id: string; description: string }[];
  recommendations?: {
    total: number;
  };
}

interface SteamSpyResponse {
  tags?: Record<string, number>;
}

interface AppReviewsResponse {
  success?: number;
  query_summary?: {
    total_reviews?: number;
    total_positive?: number;
    total_negative?: number;
    review_score?: number;
    review_score_desc?: string;
  };
}
