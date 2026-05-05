// GET /api/steam-tags
// Returns Steam's full popular-tags list, sorted by Steam-internal popularity (most-used first).
// Used by the PreferencesForm tag inputs for autocomplete.
//
// Source: https://store.steampowered.com/tagdata/populartags/english
// This is an undocumented but very stable Steam endpoint that powers Steam's own tag UIs.
// We cache the response on Next's data cache (24h) and return a slim shape.

import { NextResponse } from "next/server";

const TAGS_URL = "https://store.steampowered.com/tagdata/populartags/english";

interface SteamTagEntry {
  tagid: number;
  name: string;
}

export async function GET() {
  try {
    const res = await fetch(TAGS_URL, {
      headers: {
        "User-Agent": "Bundler/0.1 (+https://bundler.games)",
        "Accept-Language": "en-US,en;q=0.9",
      },
      // Cache for 24h. Steam tag list rarely changes.
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) {
      return NextResponse.json({ error: "unexpected_format" }, { status: 502 });
    }
    const tags: string[] = [];
    for (const entry of raw as SteamTagEntry[]) {
      if (entry && typeof entry.name === "string" && entry.name.trim()) {
        tags.push(entry.name.trim());
      }
    }
    return NextResponse.json({ tags });
  } catch (e) {
    console.error("steam-tags: fetch threw", e);
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
}
