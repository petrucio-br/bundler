"use client";

// Dashboard layout for users with at least one verified game.
//
// Multi-game model:
//   - The sidebar shows a "game switcher" - a dropdown of the user's verified games
//   - Clicking one updates session.activeGameId and reloads the dashboard with that game's context
//   - Below the switcher is "+ Add another game" which routes to the Add Game section
//   - The Add Game section renders the ClaimFlow; once verified there, the user is auto-switched
//     to the new game (the verify endpoint sets session.activeGameId)

import { useEffect, useState } from "react";
import { ClaimFlow, type ClaimState } from "@/components/claim-flow";
import { ProfileForm } from "@/components/profile-form";
import { PreferencesForm } from "@/components/preferences-form";
import { GameTagsForm } from "@/components/game-tags-form";
import { BrowseView } from "@/components/browse-view";
import { MatchesView } from "@/components/matches-view";
import { Footer } from "@/components/footer";
import { ShareBundler } from "@/components/share-bundler";
import { FLAGS } from "@/lib/featureFlags";

type Section = "my-game" | "preferences" | "browse" | "matches" | "add-game";

const SECTIONS: { id: Section; label: string; description: string }[] = [
  { id: "my-game", label: "My Game", description: "Verified game, your tags, contact info" },
  { id: "preferences", label: "Match Preferences", description: "Required tags, exclusions, audience size" },
  { id: "browse", label: "Browse", description: "Eligible games, your Maybes and Nos" },
  { id: "matches", label: "Matches", description: "Mutual yes - the contact reveal" },
  { id: "add-game", label: "+ Add another game", description: "Claim and verify another title" },
];

const VALID_SECTION_IDS = new Set<Section>(SECTIONS.map((s) => s.id));

export function DashboardLayout({
  activeGame,
  allGames,
  steamId,
}: {
  activeGame: ClaimState;
  allGames: ClaimState[];
  steamId: string;
}) {
  const [section, setSection] = useState<Section>("my-game");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    function syncFromHash() {
      const h = window.location.hash.slice(1);
      if (VALID_SECTION_IDS.has(h as Section)) {
        setSection(h as Section);
      }
    }
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  function navTo(s: Section) {
    setSection(s);
    if (typeof window !== "undefined") {
      history.pushState(null, "", `#${s}`);
    }
  }

  async function switchTo(gameId: string) {
    if (gameId === activeGame.gameId || switching) return;
    setSwitching(true);
    try {
      const res = await fetch("/api/profile/active-game", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId }),
      });
      if (!res.ok) {
        setSwitching(false);
        return;
      }
      // Full reload so all sections re-fetch with the new active game's data.
      window.location.reload();
    } catch {
      setSwitching(false);
    }
  }

  const verifiedGames = allGames.filter((g) => g.verifiedAt);
  const pendingClaim = allGames.find((g) => !g.verifiedAt) ?? null;

  return (
    <div className="min-h-screen flex justify-center">
      <div className="w-full max-w-screen-2xl flex flex-col lg:flex-row gap-6 p-6 lg:p-10">
        {/* Sidebar */}
        <aside className="lg:w-64 lg:shrink-0 lg:sticky lg:top-6 lg:self-start bg-bg-card border border-border rounded-xl">
          <div className="p-6 space-y-6">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">Bundler</h1>
              <p className="text-xs text-white/40 truncate" title={`Steam ID ${steamId}`}>
                SteamID {steamId}
              </p>
            </div>

            {/* Game switcher */}
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-white/40">Active game</div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSwitcherOpen((o) => !o)}
                  disabled={switching}
                  className="w-full text-left bg-bg-elevated hover:bg-border border border-border rounded-lg px-3 py-2 flex items-center gap-2 transition-colors"
                >
                  {activeGame.capsuleUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={activeGame.capsuleUrl}
                      alt=""
                      className="w-8 h-4 object-cover rounded shrink-0"
                    />
                  )}
                  <span className="text-sm flex-1 truncate">{activeGame.name}</span>
                  <span className="text-xs text-white/40">▼</span>
                </button>
                {switcherOpen && (
                  <div
                    className="absolute left-0 right-0 top-full mt-1 bg-bg-elevated border border-border rounded-lg shadow-lg z-20 py-1 max-h-64 overflow-auto"
                    onMouseLeave={() => setSwitcherOpen(false)}
                  >
                    {verifiedGames.map((g) => (
                      <button
                        key={g.gameId}
                        type="button"
                        onClick={() => {
                          setSwitcherOpen(false);
                          switchTo(g.gameId);
                        }}
                        className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-border transition-colors text-sm ${
                          g.gameId === activeGame.gameId ? "text-white" : "text-white/70"
                        }`}
                      >
                        {g.capsuleUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={g.capsuleUrl} alt="" className="w-8 h-4 object-cover rounded shrink-0" />
                        )}
                        <span className="flex-1 truncate">{g.name}</span>
                        {g.gameId === activeGame.gameId && <span className="text-xs text-emerald-400">active</span>}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setSwitcherOpen(false);
                        navTo("add-game");
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-border transition-colors text-sm text-accent border-t border-border"
                    >
                      + Add another game
                    </button>
                  </div>
                )}
              </div>
              {pendingClaim && (
                <p className="text-xs text-amber-300/70 leading-snug">
                  Pending claim: <span className="font-medium">{pendingClaim.name}</span> -{" "}
                  <button
                    type="button"
                    onClick={() => navTo("add-game")}
                    className="underline hover:text-amber-200"
                  >
                    finish verification
                  </button>
                </p>
              )}
            </div>

            <nav className="space-y-1">
              {SECTIONS.map((s) => {
                const active = s.id === section;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => navTo(s.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                      active
                        ? "bg-accent/20 text-white"
                        : "text-white/70 hover:bg-bg-elevated hover:text-white"
                    }`}
                  >
                    <div className="text-sm font-medium">{s.label}</div>
                    <div className="text-xs text-white/40 leading-snug">{s.description}</div>
                  </button>
                );
              })}
            </nav>

            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="w-full text-sm text-white/50 hover:text-white border border-border rounded-lg px-3 py-2 transition-colors"
              >
                Sign out
              </button>
            </form>

            {FLAGS.showGrowthNudges && (
              <div className="pt-4 border-t border-border">
                <ShareBundler variant="compact" />
              </div>
            )}

            <div className="pt-4 border-t border-border">
              <Footer />
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {section === "my-game" && (
            <div className="space-y-6">
              <ClaimFlow initialClaim={activeGame} />
              <GameTagsForm />
              <ProfileForm />
            </div>
          )}
          {section === "preferences" && <PreferencesForm />}
          {section === "browse" && <BrowseView />}
          {section === "matches" && <MatchesView />}
          {section === "add-game" && (
            <div className="space-y-4">
              <div className="bg-bg-card border border-border rounded-xl p-6">
                <h2 className="text-xl font-semibold">Add another game</h2>
                <p className="text-sm text-white/60 mt-1">
                  Claim and verify another title. Each game gets its own preferences, tags,
                  matches, and contact reveals - they're fully independent. Once verified, you can
                  switch between games via the picker at the top of the sidebar.
                </p>
              </div>
              <ClaimFlow initialClaim={pendingClaim} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
