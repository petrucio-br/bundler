"use client";

// Editor for the user's own game tags.
// SteamSpy lags days/weeks for unreleased games, so newly-announced games often have only
// Storefront genre data ("Indie", "Strategy"). The mutual matching logic compares each
// game's actual tags against the OTHER side's required tags, so missing tags = missing
// matches. This editor lets the dev fill in their game's real tags from the partner
// manager - especially the user-voted tags that SteamSpy hasn't picked up yet.
//
// Saving sets games.tags_source = 'manual' so future Refresh-from-Steam calls don't
// overwrite the user's edits.

import { useEffect, useMemo, useRef, useState } from "react";

export function GameTagsForm() {
  const [tags, setTags] = useState<string[]>([]);
  const [tagsSource, setTagsSource] = useState<"steamspy" | "genres" | "manual" | null>(null);
  const [popularTags, setPopularTags] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/games/tags").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/steam-tags").then((r) => (r.ok ? r.json() : { tags: [] })).catch(() => ({ tags: [] })),
    ])
      .then(([t, p]) => {
        if (cancelled) return;
        if (t) {
          setTags(t.tags ?? []);
          setTagsSource(t.tagsSource ?? null);
        }
        setPopularTags(p?.tags ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const lcTags = useMemo(() => new Set(tags.map((t) => t.toLowerCase())), [tags]);
  const filteredOptions = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed) return [];
    const lc = trimmed.toLowerCase();
    const exact: string[] = [];
    const prefix: string[] = [];
    const contains: string[] = [];
    for (const opt of popularTags) {
      if (lcTags.has(opt.toLowerCase())) continue;
      const optLc = opt.toLowerCase();
      if (optLc === lc) exact.push(opt);
      else if (optLc.startsWith(lc)) prefix.push(opt);
      else if (optLc.includes(lc)) contains.push(opt);
      if (exact.length + prefix.length + contains.length >= 30) break;
    }
    return [...exact, ...prefix, ...contains].slice(0, 8);
  }, [input, popularTags, lcTags]);

  function addTag(rawTag: string) {
    const clean = rawTag.trim();
    if (!clean) return;
    if (lcTags.has(clean.toLowerCase())) return;
    if (tags.length >= 30) return;
    setTags((t) => [...t, clean]);
    setInput("");
    setActiveIndex(0);
  }

  function removeTag(tag: string) {
    setTags((t) => t.filter((x) => x !== tag));
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
      setTags((t) => t.slice(0, -1));
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

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/games/tags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      setTagsSource("manual");
      setSavedAt(Date.now());
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="bg-bg-card border border-border rounded-xl p-6">
        <p className="text-white/50 text-sm">Loading tags...</p>
      </section>
    );
  }

  return (
    <section className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Your game's tags</h2>
          <p className="text-sm text-white/60 mt-1">
            These are the tags Bundler uses when matching your game against other devs' filters.
            Edit them to reflect what your game actually is. For unreleased games, SteamSpy hasn't
            picked up your user-voted tags yet, so the list often starts as just your Steam genres.
          </p>
        </div>
        {tagsSource && (
          <span
            className={`text-xs uppercase tracking-wide px-2 py-1 rounded shrink-0 ${
              tagsSource === "manual"
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-amber-500/20 text-amber-300"
            }`}
          >
            {tagsSource === "manual" ? "Manual" : tagsSource === "steamspy" ? "SteamSpy" : "Genres only"}
          </span>
        )}
      </div>

      <div ref={containerRef}>
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
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="bg-accent hover:bg-accent-hover disabled:bg-accent/40 disabled:cursor-not-allowed transition-colors text-white font-medium py-2 px-5 rounded-lg"
        >
          {saving ? "Saving..." : "Save tags"}
        </button>
        {savedAt && Date.now() - savedAt < 4000 && (
          <span className="text-sm text-emerald-400">Saved.</span>
        )}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      <p className="text-xs text-white/40 leading-relaxed">
        Saving here marks your tags as <strong className="text-white/60">manual</strong> - they
        won't be overwritten on Refresh from Steam. Bundler will keep your hand-curated list as
        the source of truth for matching, even after SteamSpy eventually catches up. To revert
        to Steam-sourced tags later, clear this list and refresh.
      </p>
    </section>
  );
}
