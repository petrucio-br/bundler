// Dashboard root.
// Two paths:
//   - User has not yet verified a game: render the ClaimFlow inline (no sidebar yet, since
//     there's nothing else to navigate to). Sign-out lives at the top right.
//   - User has a verified claim: render DashboardLayout with sidebar nav covering all sections.

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getGameOwnerStateForUser } from "@/lib/db/games";
import { ClaimFlow } from "@/components/claim-flow";
import { DashboardLayout } from "@/components/dashboard-layout";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    redirect("/");
  }

  const claim = await getGameOwnerStateForUser(session.userId);

  if (claim?.verifiedAt) {
    return <DashboardLayout claim={claim} steamId={session.steamId} />;
  }

  // Pre-verification: simple centered layout with the claim flow.
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

        <ClaimFlow initialClaim={claim} />
      </div>
    </main>
  );
}
