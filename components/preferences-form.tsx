"use client";

// Bundle preferences editor.
// Loads via GET /api/games/preferences on mount (which returns smart defaults if no row yet),
// loads the full Steam popular-tags list via GET /api/steam-tags for autocomplete,
// saves via PUT on submit.
//
// Tag inputs feature an autocomplete dropdown that filters Steam's official tag list as
// you type, sorted by Steam-internal popularity. Enter selects the top match (or adds
// literal text if no matches). Esc closes the dropdown.

import { useEffect, useMemo, useRef, useState } from "react";

interface BundlePreferences {
  requiredTags: string[];
  requiredTagsMatchCount: number;
  excludedTags: string[];
  excludedTagsMatchCount: number;
  minFollowerCount: number;
  priceBandMinCents: number;
  priceBandMaxCents: number;
  notes: string;
  isActive: boolean;
}

const SAVE_ERROR_MESSAGES: Record<string, string> = {
  required_tags_empty: "Add at least one required tag before saving.",
  required_match_count_too_high: "Required match count can't exceed the number of required tags.",
  invalid_required_match_count: "Required match count must be between 1 and 5.",
  invalid_excluded_match_count: "Excluded match count must be between 1 and 5.",
  invalid_min_follower_count: "Minimum follower count must be a non-negative number.",
  invalid_price_band_min: "Price band minimum is invalid.",
  invalid_price_band_max: "Price band maximum is invalid.",
  price_band_min_above_max: "Price band minimum can't be higher than maximum.",
  no_verified_game: "You don't have a verified game yet.",
  save_failed: "Database error while saving. Try again.",
};

export function PreferencesForm() {
  const [prefs, setPrefs] = useState<BundlePreferences | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [ownGameTags, setOwnGameTags] = useState<string[]>([]);
  const [tagsSource, setTagsSource] = useState<"steamspy" | "genres" | "manual" | null>(null);
  const [popularTags, setPopularTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Load preferences + Steam tag list in parallel on mount.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/games/preferences").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/steam-tags")
        .then((r) => (r.ok ? r.json() : { tags: [] }))
        .catch(() => ({ tags: [] })),
    ])
      .then(([prefsData, tagsData]) => {
        if (cancelled) return;
        if (!prefsData) {
          setError("Couldn't load preferences.");
          return;
        }
        setPrefs(prefsData.preferences);
        setIsDefault(prefsData.isDefault);
        setOwnGameTags(prefsData.ownGameTags ?? []);
        setTagsSource(prefsData.tagsSource ?? null);
        setPopularTags(tagsData.tags ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Network error while loading preferences.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!prefs) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/games/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(SAVE_ERROR_MESSAGES[data.error] ?? `Save failed: ${data.error ?? "unknown"}`);
        return;
      }
      setIsDefault(false);
      setSavedAt(Date.now());
    } catch {
      setError("Network error during save.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="bg-bg-card border border-border rounded-xl p-6">
        <p className="text-white/50 text-sm">Loading preferences...</p>
      </section>
    );
  }

  if (!prefs) {
    return (
      <section className="bg-bg-card border border-border rounded-xl p-6">
        <p className="text-red-400 text-sm">{error ?? "Couldn't load preferences."}</p>
      </section>
    );
  }

  // Match count maxes can't exceed the number of tags - otherwise the constraint is
  // impossible. Required can also be 0 (no tag filter, bundle with anything).
  const requiredMatchMax = Math.min(5, prefs.requiredTags.length);
  const excludedMatchMax = Math.max(1, Math.min(5, prefs.excludedTags.length || 1));

  // Auto-clamp values when tag arrays shrink. For required, 0 is valid; for excluded,
  // floor is 1 (because 0 excluded matches doesn't make semantic sense).
  const requiredMatchValue = Math.min(
    prefs.requiredTagsMatchCount,
    requiredMatchMax || 0
  );
  const excludedMatchValue = Math.min(prefs.excludedTagsMatchCount, excludedMatchMax);

  const canSave = !saving;

  return (
    <section className="bg-bg-card border border-border rounded-xl p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Match preferences</h2>
          <p className="text-sm text-white/60 mt-1">
            What kind of games would you cross-promote with? Bundles, store-page link swaps,
            news-post shoutouts - anything mutual. Other devs whose games match your filters
            (and who have you in their filters) will see your game in their pool.
          </p>
        </div>
        {isDefault && (
          <span className="text-xs uppercase tracking-wide bg-amber-500/20 text-amber-300 px-2 py-1 rounded shrink-0">
            Defaults - save to apply
          </span>
        )}
      </div>

      {tagsSource === "genres" && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-200">
          <strong className="font-semibold">Heads up:</strong> we couldn't get user-voted Steam tags
          for your game yet (this is normal for newly-announced games - SteamSpy can take days or
          weeks to crawl). The list below is from Steam's coarser genre data instead. Click "Refresh
          from Steam" above periodically; once SteamSpy has your game, your tags here will become
          much more specific.
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-7">
        <ChipInput
          label="Required tags"
          help={
            requiredMatchValue === 0
              ? "No tag filter active - any game can appear in your pool. Set the slider below above 0 to enforce tag matching."
              : `Other games must share at least ${requiredMatchValue} of these tags to appear in your pool.`
          }
          tags={prefs.requiredTags}
          onChange={(t) => setPrefs({ ...prefs, requiredTags: t })}
          autocompleteOptions={popularTags}
          quickAddOptions={ownGameTags}
          quickAddLabel="Your tags"
        />

        <SliderInput
          label="Required tags - match count"
          help={
            prefs.requiredTags.length === 0
              ? "Add some required tags above to enable filtering, or leave at 0 to bundle with any game regardless of tags."
              : `Set to 0 to ignore tags entirely (bundle with any game). Otherwise the other game must share at least this many of your required tags. Max ${requiredMatchMax} (limited by required tag count).`
          }
          value={requiredMatchValue}
          min={0}
          max={Math.max(0, requiredMatchMax)}
          disabled={prefs.requiredTags.length === 0}
          onChange={(v) => setPrefs({ ...prefs, requiredTagsMatchCount: v })}
        />

        <ChipInput
          label="Excluded tags"
          help="Games with too many of these tags will not appear in your pool."
          tags={prefs.excludedTags}
          onChange={(t) => setPrefs({ ...prefs, excludedTags: t })}
          autocompleteOptions={popularTags}
        />

        <SliderInput
          label="Excluded tags - match count"
          help={`Exclude games that have at least this many of your excluded tags. Max ${excludedMatchMax} (limited by excluded tag count).`}
          value={excludedMatchValue}
          min={1}
          max={excludedMatchMax}
          disabled={prefs.excludedTags.length === 0}
          onChange={(v) => setPrefs({ ...prefs, excludedTagsMatchCount: v })}
        />

        <div>
          <label className="block text-sm font-medium mb-1">Minimum wishlist count</label>
          <p className="text-xs text-white/50 mb-2">
            Games with fewer wishlists won't appear in your pool. Wishlists are the canonical
            pre-launch audience metric - higher means a larger built-in audience that may convert on launch.
          </p>
          <input
            type="number"
            min={0}
            step={1}
            value={prefs.minFollowerCount}
            onChange={(e) =>
              setPrefs({ ...prefs, minFollowerCount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
            }
            className="w-40 bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
          <p className="text-xs text-white/40 mt-2 leading-relaxed">
            <strong className="text-white/60">Self-reported numbers.</strong> Steam doesn't expose
            wishlist counts via any public API - only each dev's own partner manager dashboard does.
            Bundler asks devs to report their own number and trust each other. If a number looks
            suspicious, eyeball the game's store page, follower count from SteamDB extension, and
            social presence to gut-check before committing to anything.
          </p>
        </div>

        <div className="bg-bg-elevated/50 border border-border/60 rounded-lg p-3 text-xs text-white/50 leading-relaxed">
          <strong className="text-white/70">No price filter for now.</strong> Most unreleased indie
          games don't have prices set yet (Steam's pre-purchase feature is invite-only and only top-tier
          studios use it), so a price band would just exclude the bulk of the bundle pool. We'll bring this
          back.
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Notes (optional)</label>
          <p className="text-xs text-white/50 mb-2">
            Anything you want a potential cross-promo partner to know. Shown in the match handoff. Max 500 chars.
          </p>
          <textarea
            rows={3}
            maxLength={500}
            value={prefs.notes}
            onChange={(e) => setPrefs({ ...prefs, notes: e.target.value })}
            className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent resize-y"
            placeholder="e.g. Open to bundles, store-page link swaps, news-post shoutouts. EU timezone, prefer fast email replies."
          />
          <p className="text-xs text-white/40 mt-1 text-right">{prefs.notes.length} / 500</p>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={prefs.isActive}
            onChange={(e) => setPrefs({ ...prefs, isActive: e.target.checked })}
            className="rounded border-border bg-bg-elevated"
          />
          <span className="text-sm">
            Active - my game appears in other devs' pools
          </span>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSave}
            className="bg-accent hover:bg-accent-hover disabled:bg-accent/40 disabled:cursor-not-allowed transition-colors text-white font-medium py-2 px-5 rounded-lg"
            title={
              prefs.requiredTags.length === 0
                ? "Add at least one required tag before saving"
                : ""
            }
          >
            {saving ? "Saving..." : "Save preferences"}
          </button>
          {savedAt && Date.now() - savedAt < 4000 && (
            <span className="text-sm text-emerald-400">Saved.</span>
          )}
          {prefs.requiredTags.length === 0 && !error && (
            <span className="text-sm text-white/50">
              No tag filter active - your pool will include any game (subject to wishlist threshold and excluded tags).
            </span>
          )}
          {error && <span className="text-sm text-red-400">{error}</span>}
        </div>
      </form>
    </section>
  );
}

// =============================================================================
// SliderInput - native range slider styled to match the rest of the form.
// =============================================================================

function SliderInput({
  label,
  help,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  help?: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className="flex items-baseline justify-between">
        <label className="block text-sm font-medium">{label}</label>
        <span className="text-sm text-white/70">
          {value} of {max}
        </span>
      </div>
      {help && <p className="text-xs text-white/50 mb-2">{help}</p>}
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent disabled:cursor-not-allowed"
      />
    </div>
  );
}

// =============================================================================
// ChipInput - tag editor with autocomplete dropdown and optional quick-add row.
// Behaviour:
//   - Type to filter `autocompleteOptions` by case-insensitive contains match,
//     ranked by exact-match > prefix > contains, then by the underlying list order
//     (which is Steam popularity).
//   - Enter: add the top dropdown match if any, else add the literal trimmed text.
//   - ArrowDown / ArrowUp: navigate dropdown.
//   - Esc: close dropdown.
//   - Backspace at empty: remove last chip.
//   - quickAddOptions are shown as a row of chip-buttons below the input
//     (separate UX from the autocomplete dropdown).
// =============================================================================

function ChipInput({
  label,
  help,
  tags,
  onChange,
  autocompleteOptions,
  quickAddOptions,
  quickAddLabel,
}: {
  label: string;
  help?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  autocompleteOptions?: string[];
  quickAddOptions?: string[];
  quickAddLabel?: string;
}) {
  const [input, setInput] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const lcTags = useMemo(() => new Set(tags.map((t) => t.toLowerCase())), [tags]);

  const filteredOptions = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed) return [];
    if (!autocompleteOptions || autocompleteOptions.length === 0) return [];
    const lc = trimmed.toLowerCase();
    const exact: string[] = [];
    const prefix: string[] = [];
    const contains: string[] = [];
    for (const opt of autocompleteOptions) {
      if (lcTags.has(opt.toLowerCase())) continue;
      const optLc = opt.toLowerCase();
      if (optLc === lc) exact.push(opt);
      else if (optLc.startsWith(lc)) prefix.push(opt);
      else if (optLc.includes(lc)) contains.push(opt);
      if (exact.length + prefix.length + contains.length >= 30) break;
    }
    return [...exact, ...prefix, ...contains].slice(0, 8);
  }, [input, autocompleteOptions, lcTags]);

  // Close dropdown on click outside.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function addTag(rawTag: string) {
    const clean = rawTag.trim();
    if (!clean) return;
    if (lcTags.has(clean.toLowerCase())) return;
    if (tags.length >= 20) return;
    onChange([...tags, clean]);
    setInput("");
    setActiveIndex(0);
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filteredOptions.length > 0) {
        addTag(filteredOptions[Math.min(activeIndex, filteredOptions.length - 1)]);
      } else {
        addTag(input);
      }
      setDropdownOpen(false);
    } else if (e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    } else if (e.key === "ArrowDown" && filteredOptions.length > 0) {
      e.preventDefault();
      setDropdownOpen(true);
      setActiveIndex((i) => Math.min(i + 1, filteredOptions.length - 1));
    } else if (e.key === "ArrowUp" && filteredOptions.length > 0) {
      e.preventDefault();
      setDropdownOpen(true);
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      setDropdownOpen(false);
    }
  }

  const visibleQuickAdd = useMemo(() => {
    if (!quickAddOptions) return [];
    return quickAddOptions.filter((o) => !lcTags.has(o.toLowerCase()));
  }, [quickAddOptions, lcTags]);

  return (
    <div ref={containerRef}>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {help && <p className="text-xs text-white/50 mb-2">{help}</p>}
      <div
        className="bg-bg-elevated border border-border rounded-lg px-3 py-2 flex flex-wrap gap-2 focus-within:border-accent relative"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 bg-accent/20 text-accent rounded px-2 py-0.5 text-sm"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              className="text-accent/70 hover:text-accent"
              aria-label={`Remove ${tag}`}
            >
              x
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setActiveIndex(0);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          onKeyDown={handleKey}
          placeholder={tags.length === 0 ? "Type a tag, press Enter..." : ""}
          className="flex-1 min-w-[120px] bg-transparent text-sm focus:outline-none"
        />
        {dropdownOpen && filteredOptions.length > 0 && (
          <ul className="absolute left-0 right-0 top-full mt-1 bg-bg-elevated border border-border rounded-lg shadow-lg z-10 max-h-64 overflow-auto py-1">
            {filteredOptions.map((opt, i) => (
              <li
                key={opt}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(opt);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`px-3 py-1.5 text-sm cursor-pointer ${
                  i === activeIndex ? "bg-accent/20 text-white" : "text-white/80"
                }`}
              >
                {opt}
              </li>
            ))}
          </ul>
        )}
      </div>

      {visibleQuickAdd.length > 0 && tags.length < 20 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {quickAddLabel && (
            <span className="text-xs text-white/50 mr-1">{quickAddLabel}:</span>
          )}
          {visibleQuickAdd.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              className="text-xs bg-bg-elevated hover:bg-border border border-border rounded px-2 py-0.5"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
