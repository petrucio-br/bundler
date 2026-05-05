// Steam News API - used to derive first/last update dates for a game.
// "First update" approximates "when did dev activity start on this page" - a useful proxy
// for "page-live date" that we can't get cleanly from any official endpoint.
// "Last update" tells us if the game looks alive or dead. A game whose last news post is
// from two years ago is probably not someone you want to bundle with.
//
// Endpoint: https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=X&count=N
// Returns posts newest-first. We pull a large count and look at first + last.

const NEWS_URL = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/";

export interface NewsActivityDates {
  firstUpdateDate: string | null; // ISO YYYY-MM-DD
  lastUpdateDate: string | null;  // ISO YYYY-MM-DD
}

interface SteamNewsItem {
  date: number; // unix seconds
}

interface SteamNewsResponse {
  appnews?: {
    newsitems?: SteamNewsItem[];
  };
}

export async function fetchNewsActivityDates(appId: string): Promise<NewsActivityDates> {
  // count=500 is the API's effective max for a single call. Indie games rarely have more
  // posts than this; if they do we'd undershoot the actual first post by some weeks, but
  // the dead-game signal (last update) is unaffected.
  const url = `${NEWS_URL}?appid=${encodeURIComponent(appId)}&count=500&format=json`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Bundler/0.1 (+https://bundler.games)" },
      next: { revalidate: 60 * 60 * 6 }, // 6h cache
    });
    if (!res.ok) return { firstUpdateDate: null, lastUpdateDate: null };
    const data: SteamNewsResponse = await res.json();
    const items = data.appnews?.newsitems ?? [];
    if (items.length === 0) return { firstUpdateDate: null, lastUpdateDate: null };

    // The API typically returns newest-first, but don't trust ordering - sort defensively.
    const dates = items
      .map((item) => Number(item.date))
      .filter((d) => Number.isFinite(d) && d > 0)
      .sort((a, b) => a - b);

    if (dates.length === 0) return { firstUpdateDate: null, lastUpdateDate: null };

    const firstUpdateDate = unixToIsoDate(dates[0]);
    const lastUpdateDate = unixToIsoDate(dates[dates.length - 1]);
    return { firstUpdateDate, lastUpdateDate };
  } catch {
    return { firstUpdateDate: null, lastUpdateDate: null };
  }
}

function unixToIsoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
