"use client";

// Claim flow UI: handles the three states of a user's game claim:
//   - State A: No claim yet. Show app-id input + "Claim" button.
//   - State B: Pending claim. Show fetched game + verification code + post-URL input + "Verify" button.
//   - State C: Verified. Show the claimed game card with a "Refresh from Steam" button.
// Backend is /api/games/claim (POST to start, DELETE to abandon), /api/games/verify (POST),
// and /api/games/refresh-data (POST to re-pull Steam metadata + follower count).

import { useState } from "react";
import { formatInt } from "@/lib/format";

export interface ClaimState {
  gameId: string;
  steamAppId: string;
  name: string;
  capsuleUrl: string | null;
  storeUrl: string;
  verificationCode: string | null;
  verifiedAt: string | null;
  // Stats shown on the verified card. All optional - some games (especially unreleased) lack data.
  wishlistCount?: number | null;          // Self-reported by the dev.
  wishlistCountUpdatedAt?: string | null;
  reviewCount?: number | null;
  releaseDate?: string | null;
  releaseStatus?: "unreleased" | "early_access" | "released";
  firstUpdateDate?: string | null;
  lastUpdateDate?: string | null;
}

interface ClaimFlowProps {
  initialClaim: ClaimState | null;
}

const CLAIM_ERROR_MESSAGES: Record<string, string> = {
  invalid_app_id: "That doesn't look like a valid Steam app ID. App IDs are numeric (e.g. 4641550).",
  game_not_found_on_steam:
    "Steam doesn't recognize that app ID, or it's not a game (DLC, soundtracks, etc. can't be claimed).",
  fetch_failed: "Couldn't reach Steam right now. Try again in a moment.",
  game_already_claimed:
    "This game has already been claimed by another Bundler user. If you're the actual developer, contact support.",
  already_has_claim: "You already have a claim in progress. Abandon it first to claim a different game.",
  not_signed_in: "Your session expired. Reload the page and sign in again.",
  claim_failed: "Database error while saving your claim. Try again.",
};

const VERIFY_ERROR_MESSAGES: Record<string, string> = {
  missing_post_url: "Paste the URL of the Steam discussion thread you posted in.",
  invalid_url:
    "That URL doesn't look like a Steam discussion thread. It should be of the form https://steamcommunity.com/app/<APPID>/discussions/0/<THREADID>/.",
  wrong_app: "The post URL is for a different game than the one you're trying to claim.",
  fetch_failed: "Couldn't load that thread page. Make sure the URL is correct and the post is public.",
  post_not_found: "Couldn't find a post on that page. Did you paste the right URL?",
  author_mismatch: "The post on that page was made by a different Steam account than you're signed in as.",
  code_not_found: "Your verification code wasn't found in the post body. Did you include it?",
  not_developer:
    "That post doesn't carry the [developer] tag - which means Steam doesn't recognize you as a publisher of this game. Make sure you posted from the partner manager-linked Steam account.",
  no_pending_claim: "No pending claim found. Refresh the page.",
  already_verified: "This claim is already verified. Refresh the page.",
};

export function ClaimFlow({ initialClaim }: ClaimFlowProps) {
  const [claim, setClaim] = useState<ClaimState | null>(initialClaim);
  const [appIdInput, setAppIdInput] = useState("");
  const [postUrlInput, setPostUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClaim(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/games/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: appIdInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(CLAIM_ERROR_MESSAGES[data.error] ?? "Something went wrong. Try again.");
        return;
      }
      setClaim({
        gameId: data.gameId,
        steamAppId: data.appId,
        name: data.name,
        capsuleUrl: data.capsuleUrl ?? null,
        storeUrl: data.storeUrl,
        verificationCode: data.verificationCode,
        verifiedAt: null,
      });
      setAppIdInput("");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAbandon() {
    if (!confirm("Abandon this pending claim? You'll be able to start a new one.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/games/claim", { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't abandon claim. Try again.");
        return;
      }
      setClaim(null);
      setPostUrlInput("");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/games/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postUrl: postUrlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        const reason = data.reason ?? data.error ?? "";
        setError(VERIFY_ERROR_MESSAGES[reason] ?? `Verification failed: ${reason || "unknown"}`);
        return;
      }
      // Verified! Update state.
      setClaim((c) => (c ? { ...c, verifiedAt: new Date().toISOString() } : c));
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // ---------- State C: verified ----------
  if (claim?.verifiedAt) {
    return <VerifiedCard claim={claim} />;
  }

  // ---------- State B: pending verification ----------
  if (claim) {
    const verifyExampleUrl = `https://steamcommunity.com/app/${claim.steamAppId}/discussions/`;
    return (
      <section className="bg-bg-card border border-border rounded-xl p-6 space-y-6">
        <div className="flex items-center gap-4">
          {claim.capsuleUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={claim.capsuleUrl}
              alt={claim.name}
              className="w-32 h-auto rounded border border-border"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wide text-amber-400 font-semibold">
              Pending verification
            </div>
            <h2 className="text-2xl font-semibold truncate">{claim.name}</h2>
            <a
              href={claim.storeUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-white/60 hover:text-white"
            >
              View on Steam ({claim.steamAppId})
            </a>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold">How to verify</h3>
          <ol className="text-sm text-white/70 space-y-2 list-decimal list-inside">
            <li>
              Go to your game's discussion forum:{" "}
              <a
                href={verifyExampleUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:text-accent-hover underline"
              >
                {verifyExampleUrl}
              </a>
            </li>
            <li>
              Create a new thread (any title, any subforum) and paste this code in the body:
              <div className="mt-2 bg-bg-elevated border border-border rounded px-3 py-2 font-mono text-base text-white">
                {claim.verificationCode}
              </div>
            </li>
            <li>Make sure you're posting from the Steam account that has publisher access (you'll see a [developer] tag next to your username on the thread).</li>
            <li>Copy the URL of the thread you posted, paste it below, click Verify.</li>
            <li>Once verified, you can delete the thread - we don't need it anymore.</li>
          </ol>
        </div>

        <form onSubmit={handleVerify} className="space-y-3">
          <label className="block">
            <span className="block text-sm font-medium mb-1">Thread URL</span>
            <input
              type="url"
              required
              value={postUrlInput}
              onChange={(e) => setPostUrlInput(e.target.value)}
              placeholder={`https://steamcommunity.com/app/${claim.steamAppId}/discussions/0/...`}
              className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:border-accent"
              disabled={busy}
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !postUrlInput.trim()}
              className="bg-accent hover:bg-accent-hover disabled:bg-accent/40 disabled:cursor-not-allowed transition-colors text-white font-medium py-2 px-5 rounded-lg"
            >
              {busy ? "Verifying..." : "Verify"}
            </button>
            <button
              type="button"
              onClick={handleAbandon}
              disabled={busy}
              className="text-sm text-white/50 hover:text-white/80 underline"
            >
              Abandon and start over
            </button>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>
      </section>
    );
  }

  // ---------- State A: no claim yet ----------
  return (
    <section className="bg-bg-card border border-border rounded-xl p-6 space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Claim your game</h2>
        <p className="text-white/70">
          Enter the Steam app ID of the game you'd like to register on Bundler. Find it in your game's Steam URL: <span className="font-mono text-white/90">store.steampowered.com/app/<span className="text-accent">4641550</span>/...</span> - the number is the app ID.
        </p>
      </div>

      <form onSubmit={handleClaim} className="space-y-3">
        <label className="block">
          <span className="block text-sm font-medium mb-1">Steam App ID</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="\d+"
            required
            value={appIdInput}
            onChange={(e) => setAppIdInput(e.target.value)}
            placeholder="e.g. 4641550"
            className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:border-accent"
            disabled={busy}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !appIdInput.trim()}
          className="bg-accent hover:bg-accent-hover disabled:bg-accent/40 disabled:cursor-not-allowed transition-colors text-white font-medium py-2 px-5 rounded-lg"
        >
          {busy ? "Looking up game..." : "Claim"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </section>
  );
}

// =============================================================================
// VerifiedCard - shown when the user has a verified game claim.
// Includes a "Refresh from Steam" button that re-pulls metadata + follower count,
// then reloads the page so PreferencesForm picks up fresh smart defaults.
// =============================================================================

function VerifiedCard({ claim }: { claim: ClaimState }) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/games/refresh-data", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(`Refresh failed: ${data.error ?? "unknown"}`);
        return;
      }
      // Build a short status line. Useful for confirming what came through.
      const tagsCount = data.info?.tags?.length ?? 0;
      const followers = data.followerCount;
      const followerLabel =
        followers === null ? "follower count not detected" : `${formatInt(followers)} followers`;
      setInfo(`Refreshed: ${tagsCount} tags, ${followerLabel}.`);
      // Reload after a short pause so the user sees the toast, and PreferencesForm
      // re-fetches with the new defaults if they haven't saved yet.
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setError("Network error during refresh.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-4">
        {claim.capsuleUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={claim.capsuleUrl}
            alt={claim.name}
            className="w-32 h-auto rounded border border-border"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-emerald-400 font-semibold">
            Verified
          </div>
          <h2 className="text-2xl font-semibold truncate">{claim.name}</h2>
          <a
            href={claim.storeUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-white/60 hover:text-white"
          >
            View on Steam ({claim.steamAppId})
          </a>
        </div>
      </div>

      <GameStats claim={claim} />

      <div className="flex items-center gap-3 pt-2 border-t border-border">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-sm bg-bg-elevated hover:bg-border border border-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white/80 hover:text-white py-1.5 px-3 rounded-lg"
        >
          {refreshing ? "Refreshing..." : "Refresh from Steam"}
        </button>
        <span className="text-xs text-white/40">
          Re-pulls game metadata, tags, and follower count from Steam.
        </span>
      </div>

      {info && <p className="text-sm text-emerald-400">{info}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <p className="text-xs text-white/30 italic leading-relaxed">
        Stats refresh automatically once a week. Tags come from SteamSpy and can lag days or weeks
        for newly-announced games. Wishlist count is self-reported by you above (Steam doesn't
        expose wishlist counts via any public API, only the partner manager dashboard does).
        Hit Refresh from Steam any time to pull fresh review and update-date data manually.
      </p>
    </section>
  );
}

// =============================================================================
// GameStats - small row of metrics for the verified card.
// We show what we have. Missing values render as "-" with a hover hint.
// Page-live date is intentionally absent in V1 - no clean way to source it
// without scraping SteamDB, which we don't do.
// =============================================================================

function GameStats({ claim }: { claim: ClaimState }) {
  const reviewLabel =
    claim.reviewCount == null
      ? claim.releaseStatus === "unreleased"
        ? "-"
        : "0"
      : formatInt(claim.reviewCount);
  const releaseLabel = formatReleaseLabel(claim.releaseDate, claim.releaseStatus);
  const firstUpdateLabel = formatDateLabel(claim.firstUpdateDate);
  const lastUpdateLabel = formatDateLabel(claim.lastUpdateDate);

  return (
    <div className="pt-2 border-t border-border space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <WishlistStat
          wishlistCount={claim.wishlistCount ?? null}
          updatedAt={claim.wishlistCountUpdatedAt ?? null}
        />
        <Stat
          label="Reviews"
          value={reviewLabel}
          hint={claim.releaseStatus === "unreleased" ? "No reviews until the game is released" : undefined}
        />
        <Stat label="Release" value={releaseLabel} />
        <Stat
          label="First update"
          value={firstUpdateLabel}
          hint="Earliest news/announcement post on the game's hub. Approximates when the page first went live."
        />
        <Stat
          label="Last update"
          value={lastUpdateLabel}
          hint="Most recent news post. A long gap signals the game may be inactive."
        />
      </div>
      <p className="text-xs text-white/40 leading-relaxed">
        <strong className="text-white/60">Why these matter:</strong> Wishlists are the canonical
        pre-launch audience metric. First update approximates when the page went live - a low
        wishlist count on a page that's only days old is a sign of newness, not low interest, since
        wishlists need time to accumulate. Last update is the dead-game signal: long gaps suggest
        the dev has moved on and is unlikely to be looking for cross-promo partners.
      </p>
    </div>
  );
}

// =============================================================================
// WishlistStat - the wishlist field is self-reported, so we render it as an inline
// editable input. Steam doesn't expose wishlist counts via any public API; the dev
// sees the real number in their partner manager and types it here.
// =============================================================================

function WishlistStat({
  wishlistCount,
  updatedAt,
}: {
  wishlistCount: number | null;
  updatedAt: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(wishlistCount?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const n = Math.floor(Number(value) || 0);
      const res = await fetch("/api/games/wishlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wishlistCount: n }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Save failed");
        return;
      }
      // Reload to refresh display values across the dashboard.
      window.location.reload();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      title="Self-reported by you. Steam doesn't expose wishlist counts via any public API."
      className="space-y-0.5"
    >
      <div className="text-xs uppercase tracking-wide text-white/40 flex items-center gap-1">
        Wishlists
        <span className="text-[10px] normal-case tracking-normal text-white/30">(self-reported)</span>
      </div>
      {!editing ? (
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-white/90 font-medium">
            {wishlistCount == null ? "Not set" : formatInt(wishlistCount)}
          </span>
          <button
            type="button"
            onClick={() => {
              setValue(wishlistCount?.toString() ?? "");
              setEditing(true);
            }}
            className="text-xs text-white/40 hover:text-white/70 underline"
          >
            edit
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              step={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              className="w-20 bg-bg-elevated border border-border rounded px-2 py-0.5 text-sm focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="text-xs text-emerald-400 hover:text-emerald-300 px-1"
            >
              {saving ? "..." : "save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="text-xs text-white/40 hover:text-white/60 px-1"
            >
              cancel
            </button>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
      )}
      {!editing && updatedAt && (
        <div className="text-[10px] text-white/30">Updated {formatDateLabel(updatedAt.slice(0, 10))}</div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div title={hint} className="space-y-0.5">
      <div className="text-xs uppercase tracking-wide text-white/40">{label}</div>
      <div className="text-sm text-white/90 font-medium">{value}</div>
    </div>
  );
}

function formatReleaseLabel(
  date: string | null | undefined,
  status: ClaimState["releaseStatus"]
): string {
  if (!date) {
    if (status === "early_access") return "Early Access";
    return "Unreleased";
  }
  return formatDateLabel(date);
}

function formatDateLabel(date: string | null | undefined): string {
  if (!date) return "-";
  // ISO YYYY-MM-DD - render as e.g. "Jun 15, 2026" without timezone shenanigans.
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}, ${y}`;
}
