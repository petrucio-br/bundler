"use client";

// Browse view: three tabs (Eligible / Maybe / No) over the user's pool.
// - Eligible: candidates that pass mutual filters and haven't been swiped on. Yes/No/Maybe buttons.
// - Maybe: games this user marked Maybe. "Move to Yes/No" + "Revert (back to eligible)" actions.
// - No: games this user marked No. "Revert (back to eligible)" action.
//
// Backend: GET /api/browse?tab=...&sort=...&page=...&search=...
// Actions: POST /api/swipes  /  DELETE /api/swipes?gameId=...

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInt } from "@/lib/format";
import { ShareBundler } from "@/components/share-bundler";
import { FLAGS } from "@/lib/featureFlags";

interface BrowseGame {
  gameId: string;
  steamAppId: string;
  name: string;
  capsuleUrl: string | null;
  storeUrl: string;
  tags: string[];
  wishlistCount: number | null;     // Self-reported by the candidate's dev.
  reviewCount: number | null;
  releaseDate: string | null;
  releaseStatus: "unreleased" | "early_access" | "released";
  firstUpdateDate: string | null;
  lastUpdateDate: string | null;
  notes: string | null;
  matchedRequiredTags: string[];
  matchedExcludedTags: string[];
}

type Tab = "eligible" | "yes" | "maybe" | "no";
type Sort = "tag-overlap" | "follower-count" | "recency";

const SORT_LABELS: Record<Sort, string> = {
  "tag-overlap": "Best tag overlap",
  "follower-count": "Most wishlists",
  recency: "Most recent activity",
};

const TAB_LABELS: Record<Tab, string> = {
  eligible: "Eligible",
  yes: "Yes (pending)",
  maybe: "Maybe",
  no: "No",
};

export function BrowseView() {
  const [tab, setTab] = useState<Tab>("eligible");
  const [sort, setSort] = useState<Sort>("tag-overlap");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [games, setGames] = useState<BrowseGame[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null); // gameId being acted on
  const [matchToast, setMatchToast] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  // Reset page when changing tab/sort/search.
  useEffect(() => {
    setPage(0);
  }, [tab, sort, search]);

  // Fetch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (tab === "eligible") {
      params.set("sort", sort);
      params.set("page", String(page));
      if (search.trim()) params.set("search", search.trim());
    }
    fetch(`/api/browse?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          if (data.error === "no_setup") {
            setError("Save your match preferences above to start browsing.");
            return null;
          }
          setError("Couldn't load games.");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (cancelled || !data) return;
        setGames(data.games ?? []);
        setTotal(data.total ?? 0);
        setHasMore(!!data.hasMore);
      })
      .catch(() => {
        if (!cancelled) setError("Network error.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, sort, search, page, reloadToken]);

  async function handleSwipe(gameId: string, direction: "yes" | "no" | "maybe") {
    setActionPending(gameId);
    setError(null);
    try {
      const res = await fetch("/api/swipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, direction }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(`Action failed: ${data.error ?? "unknown"}`);
        return;
      }
      if (data.matched) {
        setMatchToast("It's a match! Check the Matches section below.");
        setTimeout(() => setMatchToast(null), 6000);
      }
      // Optimistic remove from current view, then refetch.
      setGames((g) => g.filter((x) => x.gameId !== gameId));
      reload();
    } catch {
      setError("Network error.");
    } finally {
      setActionPending(null);
    }
  }

  async function handleRevert(gameId: string) {
    setActionPending(gameId);
    setError(null);
    try {
      const res = await fetch(`/api/swipes?gameId=${encodeURIComponent(gameId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(`Revert failed: ${data.error ?? "unknown"}`);
        return;
      }
      setGames((g) => g.filter((x) => x.gameId !== gameId));
      reload();
    } catch {
      setError("Network error.");
    } finally {
      setActionPending(null);
    }
  }

  return (
    <section className="bg-bg-card border border-border rounded-xl p-6 space-y-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold">Browse</h2>
        <div className="text-sm text-white/50">
          {tab === "eligible"
            ? total > 0
              ? `${total} game${total === 1 ? "" : "s"} match your filters`
              : ""
            : `${total} game${total === 1 ? "" : "s"} in this list`}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-accent text-white"
                : "border-transparent text-white/50 hover:text-white/80"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Controls (only when tab=eligible) */}
      {tab === "eligible" && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by game name..."
            className="flex-1 min-w-[200px] bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:border-accent"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
          >
            {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      )}

      {matchToast && (
        <div className="bg-emerald-500/15 border border-emerald-400/40 text-emerald-200 rounded-lg px-3 py-2 text-sm">
          {matchToast}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Game list */}
      {loading ? (
        <p className="text-white/50 text-sm py-6">Loading...</p>
      ) : games.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {games.map((g) => (
              <GameCard
                key={g.gameId}
                game={g}
                tab={tab}
                busy={actionPending === g.gameId}
                onSwipe={handleSwipe}
                onRevert={handleRevert}
              />
            ))}
          </div>
          {FLAGS.showGrowthNudges && tab === "yes" && (
            <div className="mt-6">
              <ShareBundler
                variant="full"
                context="Waiting on these devs to swipe back? While you're here - inviting another dev to Bundler increases the size of YOUR future match pool. Any indie dev in your network who isn't on Bundler yet is leaving a match-multiplier on the table for both of you."
              />
            </div>
          )}
        </>
      )}

      {/* Pagination (only on eligible) */}
      {tab === "eligible" && (page > 0 || hasMore) && (
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="text-sm text-white/70 hover:text-white disabled:text-white/30 disabled:cursor-not-allowed border border-border rounded-lg px-3 py-1.5"
          >
            ← Previous
          </button>
          <span className="text-xs text-white/40">Page {page + 1}</span>
          <button
            type="button"
            disabled={!hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
            className="text-sm text-white/70 hover:text-white disabled:text-white/30 disabled:cursor-not-allowed border border-border rounded-lg px-3 py-1.5"
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
}

// =============================================================================
// GameCard
// =============================================================================

function GameCard({
  game,
  tab,
  busy,
  onSwipe,
  onRevert,
}: {
  game: BrowseGame;
  tab: Tab;
  busy: boolean;
  onSwipe: (gameId: string, dir: "yes" | "no" | "maybe") => void;
  onRevert: (gameId: string) => void;
}) {
  const matchedRequired = useMemo(
    () => new Set(game.matchedRequiredTags.map((t) => t.toLowerCase())),
    [game.matchedRequiredTags]
  );
  const matchedExcluded = useMemo(
    () => new Set(game.matchedExcludedTags.map((t) => t.toLowerCase())),
    [game.matchedExcludedTags]
  );

  return (
    <article className="bg-bg-elevated border border-border rounded-lg p-4 space-y-3">
      <div className="flex gap-3">
        {game.capsuleUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.capsuleUrl}
            alt={game.name}
            className="w-24 h-auto rounded border border-border self-start"
          />
        )}
        <div className="flex-1 min-w-0 space-y-1">
          <h3 className="font-semibold leading-tight">{game.name}</h3>
          <a
            href={game.storeUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-white/50 hover:text-white/80"
          >
            View on Steam ({game.steamAppId})
          </a>
          <div className="flex flex-wrap gap-3 pt-1 text-xs text-white/60">
            <span title="Self-reported by this game's developer">
              <span className="text-white/40">Wishlists:</span>{" "}
              <span className="text-white/80">
                {game.wishlistCount != null ? formatInt(game.wishlistCount) : "-"}
              </span>
            </span>
            <span>
              <span className="text-white/40">Reviews:</span>{" "}
              <span className="text-white/80">
                {game.reviewCount != null ? formatInt(game.reviewCount) : "-"}
              </span>
            </span>
            <span>
              <span className="text-white/40">Last update:</span>{" "}
              <span className="text-white/80">{game.lastUpdateDate ?? "-"}</span>
            </span>
          </div>
        </div>
      </div>

      {game.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {game.tags.slice(0, 8).map((t) => {
            const isMatched = matchedRequired.has(t.toLowerCase());
            const isExcluded = matchedExcluded.has(t.toLowerCase());
            const cls = isMatched
              ? "bg-emerald-500/20 text-emerald-200"
              : isExcluded
                ? "bg-red-500/20 text-red-200"
                : "bg-bg-card text-white/60";
            return (
              <span key={t} className={`text-xs rounded px-2 py-0.5 ${cls}`}>
                {t}
              </span>
            );
          })}
        </div>
      )}

      {game.notes && (
        <p className="text-xs text-white/60 italic border-l-2 border-border pl-2">
          “{game.notes}”
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        {tab === "eligible" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSwipe(game.gameId, "yes")}
              className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-sm font-medium py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Yes
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSwipe(game.gameId, "maybe")}
              className="flex-1 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 text-sm font-medium py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Maybe
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSwipe(game.gameId, "no")}
              className="flex-1 bg-red-500/15 hover:bg-red-500/25 text-red-200 text-sm font-medium py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              No
            </button>
          </>
        ) : tab === "yes" ? (
          <div className="flex-1 text-xs text-white/50 italic text-center py-1.5">
            Waiting on them. They&apos;ll appear in Matches if they say Yes back.
          </div>
        ) : tab === "maybe" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSwipe(game.gameId, "yes")}
              className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-sm font-medium py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Move to Yes
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSwipe(game.gameId, "no")}
              className="flex-1 bg-red-500/15 hover:bg-red-500/25 text-red-200 text-sm font-medium py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Move to No
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRevert(game.gameId)}
              className="flex-1 bg-bg-card hover:bg-border text-white/70 hover:text-white text-sm font-medium py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Back to pool
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRevert(game.gameId)}
              className="flex-1 bg-bg-card hover:bg-border text-white/70 hover:text-white text-sm font-medium py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Back to pool
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const message =
    tab === "eligible"
      ? "No eligible games right now. Either no other devs have signed up yet, or your filters are too narrow. Try widening your required-tag list or lowering the match count."
      : tab === "yes"
        ? "No pending Yes swipes. Games you say Yes to that haven't reciprocated yet will appear here. Once they Yes you back, they move to Matches."
        : tab === "maybe"
          ? "Nothing here yet. Games you mark Maybe in Eligible will land here."
          : "Nothing here yet. Games you mark No in Eligible will land here.";
  return (
    <div className="space-y-4">
      <div className="bg-bg-elevated border border-dashed border-border rounded-lg p-6 text-center text-sm text-white/50">
        {message}
      </div>
      {FLAGS.showGrowthNudges && tab === "eligible" && (
        <ShareBundler
          variant="full"
          context="Pool feels small? It is - Bundler is brand new. Every indie dev who joins because of you increases YOUR match probability."
        />
      )}
    </div>
  );
}
