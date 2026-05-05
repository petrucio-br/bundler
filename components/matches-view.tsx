"use client";

// Matches view: list of mutual-yes matches with the OTHER dev's contact info.
// This is the contact-handoff: once you see your match here, you reach out via email/Discord
// and discuss the bundle outside of Bundler.

import { useEffect, useState } from "react";

interface MatchedGameContact {
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

interface MatchEntry {
  matchId: string;
  matchedAt: string;
  dismissed: boolean;
  other: MatchedGameContact;
}

export function MatchesView() {
  const [matches, setMatches] = useState<MatchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/matches")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setMatches(data.matches ?? []);
      })
      .catch(() => setError("Couldn't load matches."))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDismiss(matchId: string) {
    if (!confirm("Dismiss this match? The other side will still see it on their end.")) return;
    setDismissing(matchId);
    setError(null);
    try {
      const res = await fetch("/api/matches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      if (!res.ok) {
        setError("Dismiss failed.");
        return;
      }
      setMatches((m) => m.filter((x) => x.matchId !== matchId));
    } catch {
      setError("Network error.");
    } finally {
      setDismissing(null);
    }
  }

  return (
    <section className="bg-bg-card border border-border rounded-xl p-6 space-y-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Matches</h2>
          <p className="text-sm text-white/60 mt-1">
            Devs who said Yes to your game and you said Yes to theirs. Reach out via the contact
            info below to discuss the bundle. Bundler doesn't host the conversation.
          </p>
        </div>
        <span className="text-sm text-white/50">{matches.length} match{matches.length === 1 ? "" : "es"}</span>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-white/50 text-sm py-4">Loading...</p>
      ) : matches.length === 0 ? (
        <div className="bg-bg-elevated border border-dashed border-border rounded-lg p-6 text-center text-sm text-white/50">
          No matches yet. Browse eligible games above and mark Yes on the ones you'd bundle with.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {matches.map((m) => (
            <MatchCard key={m.matchId} match={m} busy={dismissing === m.matchId} onDismiss={handleDismiss} />
          ))}
        </div>
      )}
    </section>
  );
}

function MatchCard({
  match,
  busy,
  onDismiss,
}: {
  match: MatchEntry;
  busy: boolean;
  onDismiss: (matchId: string) => void;
}) {
  const o = match.other;
  return (
    <article className="bg-bg-elevated border border-border rounded-lg p-4 space-y-3">
      <div className="flex gap-3">
        {o.capsuleUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={o.capsuleUrl}
            alt={o.gameName}
            className="w-24 h-auto rounded border border-border self-start"
          />
        )}
        <div className="flex-1 min-w-0 space-y-1">
          <h3 className="font-semibold leading-tight">{o.gameName}</h3>
          <a
            href={o.storeUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-white/50 hover:text-white/80"
          >
            View on Steam ({o.steamAppId})
          </a>
          <div className="text-xs text-white/40">
            Matched {formatRelativeDate(match.matchedAt)}
          </div>
        </div>
      </div>

      <div className="space-y-1.5 text-sm">
        <div className="text-xs uppercase tracking-wide text-white/40">Contact</div>
        {o.email ? (
          <div>
            <a href={`mailto:${o.email}`} className="text-accent hover:text-accent-hover underline">
              {o.email}
            </a>
          </div>
        ) : (
          <div className="text-white/40 italic">Email not provided</div>
        )}
        {o.discordUsername ? (
          <div className="text-white/80">Discord: <span className="font-mono">{o.discordUsername}</span></div>
        ) : (
          <div className="text-white/40 italic">Discord not provided</div>
        )}
      </div>

      {o.notes && (
        <p className="text-xs text-white/60 italic border-l-2 border-border pl-2">
          “{o.notes}”
        </p>
      )}

      <div className="pt-2 border-t border-border flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => onDismiss(match.matchId)}
          className="text-xs text-white/40 hover:text-white/70 disabled:opacity-50"
        >
          Dismiss this match
        </button>
      </div>
    </article>
  );
}

function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) {
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (hours === 0) return "just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
