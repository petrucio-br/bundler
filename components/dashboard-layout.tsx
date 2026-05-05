"use client";

// Dashboard layout for verified users: sidebar on the left with section nav,
// main content area on the right showing the active section.
// Uses URL hash routing (#my-game, #profile, etc.) so refresh keeps the user where they were
// and the browser back button works as expected.

import { useEffect, useState } from "react";
import { ClaimFlow, type ClaimState } from "@/components/claim-flow";
import { ProfileForm } from "@/components/profile-form";
import { PreferencesForm } from "@/components/preferences-form";
import { GameTagsForm } from "@/components/game-tags-form";
import { BrowseView } from "@/components/browse-view";
import { MatchesView } from "@/components/matches-view";
import { Footer } from "@/components/footer";

type Section = "my-game" | "preferences" | "browse" | "matches";

const SECTIONS: { id: Section; label: string; description: string }[] = [
  { id: "my-game", label: "My Game", description: "Verified game, your tags, contact info" },
  { id: "preferences", label: "Match Preferences", description: "Required tags, exclusions, audience size" },
  { id: "browse", label: "Browse", description: "Eligible games, your Maybes and Nos" },
  { id: "matches", label: "Matches", description: "Mutual yes - the contact reveal" },
];

const VALID_SECTION_IDS = new Set<Section>(SECTIONS.map((s) => s.id));

export function DashboardLayout({
  claim,
  steamId,
}: {
  claim: ClaimState;
  steamId: string;
}) {
  const [section, setSection] = useState<Section>("my-game");

  // Read initial hash and listen for changes (browser back/forward + manual nav).
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
      // Update hash without triggering a page jump
      history.pushState(null, "", `#${s}`);
    }
  }

  return (
    // Outer wrapper centers the whole sidebar+content block so it doesn't pin to the
    // left edge on wide screens. Inner block has a max width so the layout doesn't
    // stretch endlessly on 4K.
    <div className="min-h-screen flex justify-center">
      <div className="w-full max-w-screen-2xl flex flex-col lg:flex-row gap-6 p-6 lg:p-10">
        {/* Sidebar - styled as a card so it visually matches the main section, not a
            floor-to-ceiling stripe. self-start + sticky keeps it pinned at the top of
            the viewport while the user scrolls long content sections. */}
        <aside className="lg:w-64 lg:shrink-0 lg:sticky lg:top-6 lg:self-start bg-bg-card border border-border rounded-xl">
          <div className="p-6 space-y-6">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">Bundler</h1>
              <p className="text-xs text-white/40 truncate" title={`Steam ID ${steamId}`}>
                SteamID {steamId}
              </p>
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

            <div className="pt-4 border-t border-border">
              <Footer />
            </div>
          </div>
        </aside>

        {/* Main content. All sections share the same available width now -
            forms have inputs that constrain themselves internally, grids fill the space. */}
        <main className="flex-1 min-w-0">
          {section === "my-game" && (
            <div className="space-y-6">
              <ClaimFlow initialClaim={claim} />
              <GameTagsForm />
              <ProfileForm />
            </div>
          )}
          {section === "preferences" && <PreferencesForm />}
          {section === "browse" && <BrowseView />}
          {section === "matches" && <MatchesView />}
        </main>
      </div>
    </div>
  );
}
