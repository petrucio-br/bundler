// Steam follower count fetcher.
// Steam doesn't expose follower count via any official Web API endpoint, so we scrape
// the public community hub page (https://steamcommunity.com/app/{appid}).
// This is the fragile-but-necessary part of the system flagged in the V1 plan -
// if Steam changes the page structure, this returns null and we keep the last-known value.
//
// Strategy: try multiple parse strategies, return the first one that yields a number.
// Strategies (in order of expected reliability):
//   1. Look for an explicit "<N> followers" textual pattern anywhere in the page.
//   2. Look for known apphub stat divs (e.g., apphub_NumInApp, apphub_NumOnlineNow are
//      for active player stats, but follower-related divs exist too).
//   3. Parse from any embedded JSON-LD structured data.
// All strategies use cheerio + regex on the raw HTML.

import * as cheerio from "cheerio";

export interface FetchFollowerCountResult {
  followerCount: number | null;
  // For debugging when we return null - tells us what the page looked like.
  debugSnippet?: string;
}

// Be strict here. Earlier versions matched "in group" and "members" too, which produced
// false positives on stat blocks like "0 In Group Chat" or "0 Members Online". Only match
// the literal word "follower(s)" with explicit context - either preceded by a number or
// followed by a colon/dash and number.
const FOLLOWER_TEXT_PATTERNS: RegExp[] = [
  // "1,234 Followers" or "1234 followers" - number followed by the word followers
  /\b([\d,]+)\s+followers?\b/i,
  // "Followers: 1,234" or "Followers - 1,234"
  /\bfollowers?\s*[:\-]\s*([\d,]+)\b/i,
];

const NUMBER_RE = /^[\d,]+$/;

export async function fetchFollowerCount(
  appId: string
): Promise<FetchFollowerCountResult> {
  const url = `https://steamcommunity.com/app/${encodeURIComponent(appId)}/`;
  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Bundler/0.1 (+https://bundler.games)",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return { followerCount: null };
    }
    html = await res.text();
  } catch {
    return { followerCount: null };
  }

  const $ = cheerio.load(html);

  // Strategy 1: Look in known apphub stat blocks. Steam labels these with class
  // names like apphub_HeaderStandardTop or apphub_StoreInfoLabel paired with values.
  // Following pattern: <div class="apphub_HeaderStandardTop"><div class="apphub_StoreInfo">...</div></div>
  // We grab all small/numeric stat blocks and try to find one labeled as followers.
  const statBlocks = $(".apphub_StoreInfoLabel, .apphub_HeaderStandardTop, .apphub_GroupStats, .group_summary");
  for (const block of statBlocks.toArray()) {
    const text = $(block).text();
    for (const pattern of FOLLOWER_TEXT_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const n = parseNumber(match[1]);
        if (n !== null) return { followerCount: n };
      }
    }
  }

  // Strategy 2: Search the entire body text for follower patterns.
  // This is the broad-strokes fallback when class-based selectors don't catch it.
  const bodyText = $("body").text();
  for (const pattern of FOLLOWER_TEXT_PATTERNS) {
    const match = bodyText.match(pattern);
    if (match) {
      const n = parseNumber(match[1]);
      // Sanity check: if a game claims 100M followers, something parsed wrong.
      if (n !== null && n < 100_000_000) {
        return { followerCount: n };
      }
    }
  }

  // Strategy 3: JSON-LD or other embedded JSON.
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const json = JSON.parse($(script).text());
      // Steam doesn't currently expose follower counts in JSON-LD, but check fields
      // like memberCount or numFollowers in case the data is there.
      const candidates = [
        json?.memberCount,
        json?.numFollowers,
        json?.interactionStatistic?.userInteractionCount,
      ];
      for (const c of candidates) {
        if (typeof c === "number" && c >= 0) {
          return { followerCount: c };
        }
      }
    } catch {
      // ignore JSON-LD parse failures
    }
  }

  // Couldn't find anything. Return a debug snippet so we can iterate on the parser.
  const headerText = $(".apphub_HomeHeaderContent").text() || $("body").text().slice(0, 500);
  return {
    followerCount: null,
    debugSnippet: headerText.slice(0, 400),
  };
}

function parseNumber(raw: string): number | null {
  if (!NUMBER_RE.test(raw)) return null;
  const cleaned = raw.replace(/,/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}
