// Dashboard root.
// Three states:
//   - Not signed in: redirect to /
//   - Signed in, no verified games yet: render the ClaimFlow inline (sidebar would have nothing to navigate)
//   - Signed in, has at least one verified game: render the full DashboardLayout with sidebar + game switcher

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getAllGamesForUser, getPendingClaimForUser, resolveActiveGameForUser } from "@/lib/db/games";
import { ClaimFlow } from "@/components/claim-flow";
import { DashboardLayout } from "@/components/dashboard-layout";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    redirect("/");
  }

  const allGames = await getAllGamesForUser(session.userId);
  const verifiedGames = allGames.filter((g) => g.verifiedAt);
  const activeGame = await resolveActiveGameForUser(session.userId, session.activeGameId);

  if (verifiedGames.length > 0 && activeGame) {
    // Has at least one verified game - show the full dashboard with sidebar.
    return (
      <DashboardLayout
        activeGame={activeGame}
        allGames={allGames}
        steamId={session.steamId}
      />
    );
  }

  // Pre-verification: simple centered layout with the claim flow for the user's
  // pending (or first-time) claim.
  const pending = await getPendingClaimForUser(session.userId);
  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Bundler</h1>
            <p className="text-sm text-white/50">
              Signed in as Steam ID {session.steamId}
            </p>
          </div>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="text-sm text-white/60 hover:text-white border border-border rounded-lg px-3 py-1.5"
            >
              Sign out
            </button>
          </form>
        </header>

        <ClaimFlow initialClaim={pending} />
      </div>
    </main>
  );
}
