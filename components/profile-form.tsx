"use client";

// Profile form: email + Discord username for the contact handoff.
// Steam OpenID gives us only the SteamID, so we ask for these explicitly.
// Both are optional but at least one is strongly recommended - without contact info,
// matches can happen but neither side can reach the other.

import { useEffect, useState } from "react";

export function ProfileForm() {
  const [email, setEmail] = useState("");
  const [discord, setDiscord] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setEmail(data.email ?? "");
        setDiscord(data.discordUsername ?? "");
      })
      .catch(() => setError("Couldn't load profile."))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), discordUsername: discord.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === "invalid_email"
            ? "That doesn't look like a valid email."
            : data.error === "invalid_discord"
              ? "Discord usernames are 2-32 characters, letters/numbers/dots/underscores only."
              : "Save failed."
        );
        return;
      }
      setSavedAt(Date.now());
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="bg-bg-card border border-border rounded-xl p-6">
        <p className="text-white/50 text-sm">Loading profile...</p>
      </section>
    );
  }

  const hasContact = email.trim().length > 0 || discord.trim().length > 0;

  return (
    <section className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Contact info</h2>
          <p className="text-sm text-white/60 mt-1">
            Shared with matched devs so they can reach out about a cross-promo (bundle, link swap, news shoutout, whatever). Steam doesn't give us
            your email, so add it here. At least one (email or Discord) is strongly recommended.
          </p>
        </div>
        {!hasContact && (
          <span className="text-xs uppercase tracking-wide bg-amber-500/20 text-amber-300 px-2 py-1 rounded shrink-0">
            Add at least one
          </span>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full max-w-sm bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Discord username</label>
          <input
            type="text"
            value={discord}
            onChange={(e) => setDiscord(e.target.value)}
            placeholder="lone_piggy"
            className="w-full max-w-sm bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:border-accent"
          />
          <p className="text-xs text-white/40 mt-1">
            Just the username (no @ or discriminator).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-accent hover:bg-accent-hover disabled:bg-accent/40 disabled:cursor-not-allowed transition-colors text-white font-medium py-2 px-5 rounded-lg"
          >
            {saving ? "Saving..." : "Save contact info"}
          </button>
          {savedAt && Date.now() - savedAt < 4000 && (
            <span className="text-sm text-emerald-400">Saved.</span>
          )}
          {error && <span className="text-sm text-red-400">{error}</span>}
        </div>
      </form>
    </section>
  );
}
