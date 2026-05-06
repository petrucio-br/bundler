"use client";

// Reusable share-Bundler component used in multiple "growth nudge" placements.
// Two variants:
//   - "full"    : prominent card with explainer + copy button. For empty Browse,
//                 yes-pending callout, post-save nudge.
//   - "compact" : single-line link with copy button. For sidebar permanent slot.
//
// All instances copy the same default share text. Users can edit the textarea
// before copying if they want to customize for the platform they're posting on.

import { useState } from "react";

const DEFAULT_SHARE_TEXT = `Bundler (https://bundler.games) is a free open-source tool for indie devs to find cross-promo partners on Steam - bundles, store-page links, news shoutouts, anything mutual. Sign in with Steam, claim your game, browse compatible devs. Mutual-yes matching, no middleman. Three minutes to set up.`;

export function ShareBundler({
  variant,
  context,
}: {
  variant: "full" | "compact";
  /**
   * Optional contextual lead-in shown above the share box. Different placements
   * have different reasons-to-share; the calling component picks the framing.
   * Examples:
   *  - "Pool feels small? Grow it - and your match probability with it."
   *  - "Waiting on them. Inviting another dev increases your match odds."
   */
  context?: string;
}) {
  const [text, setText] = useState(DEFAULT_SHARE_TEXT);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback: select the textarea for manual copy if clipboard API blocked.
      const ta = document.querySelector<HTMLTextAreaElement>("[data-share-textarea]");
      ta?.select();
    }
  }

  if (variant === "compact") {
    return (
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-white/40">
          Grow the pool
        </div>
        <button
          type="button"
          onClick={copy}
          className="w-full text-left text-sm text-white/70 hover:text-white border border-border rounded-lg px-3 py-2 transition-colors"
          title="Click to copy a ready-to-paste invite blurb"
        >
          {copied ? "Copied!" : "Copy invite text"}
        </button>
        <p className="text-xs text-white/40 leading-snug">
          More devs = more matches for you. Self-interest, not a favor.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-accent/5 border border-accent/30 rounded-lg p-4 space-y-3">
      {context && <p className="text-sm text-white/80">{context}</p>}
      <p className="text-xs text-white/60 leading-relaxed">
        Every indie dev who joins makes <strong className="text-white/80">your</strong> pool bigger
        and your matches more likely. Bundler's value scales with size - sharing it is a
        self-interested act, not a favor to the maintainer. Edit the text below if you want
        to customize for the platform you're posting on, then copy.
      </p>
      <textarea
        data-share-textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent resize-y"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={copy}
          className="bg-accent hover:bg-accent-hover transition-colors text-white text-sm font-medium py-1.5 px-4 rounded-lg"
        >
          {copied ? "Copied!" : "Copy invite text"}
        </button>
        <span className="text-xs text-white/40">
          Paste into Discord, X, email, anywhere indie devs hang out.
        </span>
      </div>
    </div>
  );
}
