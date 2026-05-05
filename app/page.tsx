// Landing page. If signed in, send to /dashboard. Otherwise show the sign-in pitch.

import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { Footer } from "@/components/footer";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session.steamId) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const error = params.error;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
      <div className="max-w-2xl w-full text-center space-y-8">
        <div className="space-y-3">
          <h1 className="text-5xl font-bold tracking-tight">Bundler</h1>
          <p className="text-xl text-white/70">
            Find indie devs whose games would pair well with yours - for bundles, store-page links, news shoutouts, or any other cross-promotion.
          </p>
        </div>

        <div className="bg-bg-card border border-border rounded-xl p-8 space-y-6">
          <div className="space-y-2 text-left">
            <h2 className="text-lg font-semibold">How it works</h2>
            <ol className="text-white/70 space-y-1 list-decimal list-inside">
              <li>Sign in with Steam.</li>
              <li>Claim your game and verify ownership by posting a temporary short code in your game's Steam discussion forum (which carries your [developer] tag automatically). You can delete the post immediately after it's verified.</li>
              <li>Set the kind of games you'd cross-promote with - required tags, exclusions, minimum wishlist count.</li>
              <li>Browse or search the pool. Mark interest. When two devs both say yes, you both see each other's contact info and can take the conversation off-platform.</li>
            </ol>
          </div>

          <Link
            href="/api/auth/steam/login"
            className="inline-flex items-center justify-center gap-2 w-full bg-steam hover:bg-steam-accent transition-colors text-white font-medium py-3 px-6 rounded-lg"
          >
            Sign in through Steam
          </Link>

          {error && (
            <p className="text-sm text-red-400">
              {error === "steam_verification_failed"
                ? "Steam couldn't verify your sign-in. Try again."
                : error === "user_upsert_failed"
                  ? "We hit a database error. Try again in a moment."
                  : "Something went wrong. Try again."}
            </p>
          )}
        </div>

        <p className="text-sm text-white/40">
          Free. Open source. Built for indies.
        </p>

        <div className="pt-4">
          <Footer />
        </div>
      </div>
    </main>
  );
}
