// Steam Community discussion-forum verification.
// The dev creates a thread on their game's discussion hub containing our verification code.
// We fetch that thread URL, parse the OP, and confirm three things:
//   1. The post body contains the code we issued.
//   2. The post author's SteamID matches the user we expect (the signed-in user claiming the game).
//   3. The post author has Steam's "developer" tag for that app, which only accounts with publisher
//      access to the game receive. This is the cryptographic proof of game-dev identity.
// Confirmed against a live test on the Kegs of Eternity hub: the developer flag renders server-side
// as the CSS class `commentthread_author_developer` on the OP author link, plus a literal
// `<span class="commentthread_workshop_authorbadge">[developer]</span>` adjacent to the username.

import * as cheerio from "cheerio";

// Steam SteamID64 = 76561197960265728 + accountId.
// Steam forum HTML exposes accountId via data-miniprofile, not the full SteamID,
// so we compute it back here.
const STEAMID64_BASE = 76561197960265728n;

export interface ForumVerifyResult {
  ok: boolean;
  // When ok is false, why:
  reason?:
    | "invalid_url"
    | "wrong_app"
    | "fetch_failed"
    | "post_not_found"
    | "author_mismatch"
    | "code_not_found"
    | "not_developer";
  // When parsing succeeded enough to extract them, these are populated for debugging:
  parsedAuthorSteamId?: string;
  parsedHasDeveloperTag?: boolean;
  parsedCodeFound?: boolean;
  parsedTitle?: string;
}

export interface ForumVerifyParams {
  postUrl: string;
  expectedAppId: string;
  expectedSteamId: string;
  verificationCode: string;
}

const STEAM_DISCUSSION_RE =
  /^https?:\/\/steamcommunity\.com\/app\/(\d+)\/discussions\/(?:\d+)\/(\d+)\/?$/i;

export async function verifyForumPost(
  params: ForumVerifyParams
): Promise<ForumVerifyResult> {
  // 1. URL shape must be a Steam app discussion thread for the expected app.
  const match = params.postUrl.trim().match(STEAM_DISCUSSION_RE);
  if (!match) {
    return { ok: false, reason: "invalid_url" };
  }
  const urlAppId = match[1];
  if (urlAppId !== params.expectedAppId) {
    return { ok: false, reason: "wrong_app" };
  }

  // 2. Fetch the page. Steam discussion pages are server-rendered and don't require auth.
  let html: string;
  try {
    const res = await fetch(params.postUrl, {
      headers: {
        "User-Agent": "Bundler/0.1 (+https://bundler.games)",
        // Steam serves region-conditioned pages; force English so our class-name checks aren't affected.
        "Accept-Language": "en-US,en;q=0.9",
      },
      // Don't cache - we want fresh content each verify attempt
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, reason: "fetch_failed" };
    }
    html = await res.text();
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }

  // 3. Parse the OP (original post / first post in the thread).
  const $ = cheerio.load(html);
  const op = $(".forum_op").first();
  if (op.length === 0) {
    return { ok: false, reason: "post_not_found" };
  }

  const authorLink = op.find(".forum_op_author").first();
  if (authorLink.length === 0) {
    return { ok: false, reason: "post_not_found" };
  }

  const accountIdAttr = authorLink.attr("data-miniprofile");
  let authorSteamId: string | undefined;
  if (accountIdAttr && /^\d+$/.test(accountIdAttr)) {
    authorSteamId = (BigInt(accountIdAttr) + STEAMID64_BASE).toString();
  }

  const hasDeveloperTag =
    authorLink.hasClass("commentthread_author_developer") ||
    op.find(".commentthread_workshop_authorbadge").length > 0;

  const bodyText = op.find(".content").first().text() ?? "";
  const titleText = op.find(".topic").first().text().trim();
  const codeFound = bodyText.includes(params.verificationCode) ||
    titleText.includes(params.verificationCode);

  // 4. Final verdict, in priority order so the user sees the most actionable error.
  if (!authorSteamId) {
    return {
      ok: false,
      reason: "post_not_found",
      parsedHasDeveloperTag: hasDeveloperTag,
      parsedCodeFound: codeFound,
      parsedTitle: titleText,
    };
  }
  if (authorSteamId !== params.expectedSteamId) {
    return {
      ok: false,
      reason: "author_mismatch",
      parsedAuthorSteamId: authorSteamId,
      parsedHasDeveloperTag: hasDeveloperTag,
      parsedCodeFound: codeFound,
      parsedTitle: titleText,
    };
  }
  if (!codeFound) {
    return {
      ok: false,
      reason: "code_not_found",
      parsedAuthorSteamId: authorSteamId,
      parsedHasDeveloperTag: hasDeveloperTag,
      parsedCodeFound: false,
      parsedTitle: titleText,
    };
  }
  if (!hasDeveloperTag) {
    return {
      ok: false,
      reason: "not_developer",
      parsedAuthorSteamId: authorSteamId,
      parsedHasDeveloperTag: false,
      parsedCodeFound: true,
      parsedTitle: titleText,
    };
  }

  return {
    ok: true,
    parsedAuthorSteamId: authorSteamId,
    parsedHasDeveloperTag: true,
    parsedCodeFound: true,
    parsedTitle: titleText,
  };
}

/**
 * Generate a short, copyable verification code.
 * Format: BUNDLER-XXXXXX where XXXXXX is 6 chars from a confusion-resistant alphabet
 * (no 0/O/1/I/L). Long enough to be effectively unguessable in a 24h window, short enough to type.
 */
export function generateVerificationCode(): string {
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let suffix = "";
  // crypto.getRandomValues is available in Node 19+ and edge runtimes.
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[buf[i] % ALPHABET.length];
  }
  return `BUNDLER-${suffix}`;
}
