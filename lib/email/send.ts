// Transactional email via Resend.
// Used for match notifications. Designed to no-op cleanly when not configured,
// so local dev and unconfigured production environments don't blow up - they just
// skip sending and log a notice.

import { FLAGS } from "@/lib/featureFlags";
//
// Setup:
//   1. Sign up at https://resend.com (free 3k emails/month, no credit card).
//   2. Verify the bundler.games domain via the DNS records Resend gives you
//      (Cloudflare DNS makes this a 5-minute job).
//   3. Set RESEND_API_KEY and EMAIL_FROM in .env.local / Vercel env.
//   4. While the domain is being verified, set EMAIL_FROM to "Bundler <onboarding@resend.dev>"
//      to send from Resend's pre-verified domain (works for testing, not great for production
//      because deliverability is shared with everyone else using the test sender).

const RESEND_API_URL = "https://api.resend.com/emails";

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  ok: boolean;
  reason?: "not_configured" | "no_recipient" | "send_failed";
  detail?: string;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Bundler <onboarding@resend.dev>";

  if (!apiKey) {
    // Graceful skip: log so devs know it didn't fire, but don't fail the calling flow.
    console.info(
      `[email] RESEND_API_KEY not set, skipping email to ${params.to}: "${params.subject}"`
    );
    return { ok: false, reason: "not_configured" };
  }

  if (!params.to || !params.to.includes("@")) {
    console.warn(`[email] No recipient address: skipping "${params.subject}"`);
    return { ok: false, reason: "no_recipient" };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[email] Resend ${res.status}: ${detail}`);
      return { ok: false, reason: "send_failed", detail };
    }
    return { ok: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[email] threw: ${detail}`);
    return { ok: false, reason: "send_failed", detail };
  }
}

/**
 * Match notification email. Sent to both sides of a freshly-created match.
 */
export interface MatchEmailParams {
  recipientEmail: string;
  recipientGameName: string;       // their own game name (you)
  matchedGameName: string;         // the other game
  matchedGameStoreUrl: string;
  matchedDevEmail: string | null;
  matchedDevDiscord: string | null;
  matchedDevNotes: string | null;
  matchesPageUrl: string;          // link back to bundler.games matches view
}

export function renderMatchEmail(p: MatchEmailParams): { subject: string; html: string; text: string } {
  const subject = `You've matched with ${p.matchedGameName} on Bundler`;

  const contactLines: string[] = [];
  if (p.matchedDevEmail) contactLines.push(`Email: ${p.matchedDevEmail}`);
  if (p.matchedDevDiscord) contactLines.push(`Discord: ${p.matchedDevDiscord}`);
  if (contactLines.length === 0) contactLines.push("(no contact info provided)");

  const growthPsText = FLAGS.showGrowthNudges
    ? "PS: This match worked because both of you signed up. Want more matches like this? Share Bundler with another indie dev whose game would pair well with yours - bundler.games. Every new dev grows your pool, not just ours."
    : "";

  const text = [
    `Good news - your game ${p.recipientGameName} just matched with ${p.matchedGameName} on Bundler.`,
    "",
    "Both of you marked each other as interested in cross-promoting (bundle, store-page link swap, news-post shoutout, whatever you decide). Here's how to reach them:",
    ...contactLines,
    "",
    p.matchedDevNotes ? `Their notes: ${p.matchedDevNotes}` : "",
    "",
    `View this match on Bundler: ${p.matchesPageUrl}`,
    "",
    growthPsText,
    "",
    "- Bundler",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #222; max-width: 540px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 22px; margin: 0 0 12px;">You've matched on Bundler</h1>
      <p style="margin: 0 0 16px; line-height: 1.5;">
        Your game <strong>${escapeHtml(p.recipientGameName)}</strong> just matched with
        <strong><a href="${escapeAttr(p.matchedGameStoreUrl)}" style="color: #7c5cff;">${escapeHtml(p.matchedGameName)}</a></strong>.
        Both of you marked each other as interested in cross-promoting - bundle, store-page link swap, news-post shoutout, or whatever you decide together.
      </p>
      <h2 style="font-size: 16px; margin: 24px 0 8px;">Contact</h2>
      <ul style="margin: 0 0 16px 20px; padding: 0; line-height: 1.6;">
        ${p.matchedDevEmail ? `<li>Email: <a href="mailto:${escapeAttr(p.matchedDevEmail)}">${escapeHtml(p.matchedDevEmail)}</a></li>` : ""}
        ${p.matchedDevDiscord ? `<li>Discord: ${escapeHtml(p.matchedDevDiscord)}</li>` : ""}
        ${!p.matchedDevEmail && !p.matchedDevDiscord ? "<li>(no contact info provided)</li>" : ""}
      </ul>
      ${
        p.matchedDevNotes
          ? `<h2 style="font-size: 16px; margin: 24px 0 8px;">Their notes</h2>
             <p style="margin: 0 0 16px; line-height: 1.5; padding: 12px; background: #f4f4f6; border-radius: 6px;">${escapeHtml(p.matchedDevNotes)}</p>`
          : ""
      }
      <p style="margin: 24px 0 0;">
        <a href="${escapeAttr(p.matchesPageUrl)}" style="display: inline-block; background: #7c5cff; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">View match on Bundler</a>
      </p>
      ${
        FLAGS.showGrowthNudges
          ? `<p style="margin: 24px 0 0; padding: 12px; background: #f4f4f6; border-radius: 6px; color: #444; font-size: 13px; line-height: 1.5;">
              <strong>PS:</strong> This match worked because both of you signed up. Want more matches like this? Share <a href="https://bundler.games" style="color: #7c5cff;">bundler.games</a> with another indie dev whose game would pair well with yours. Every new dev grows your pool, not just ours.
            </p>`
          : ""
      }
      <p style="margin: 32px 0 0; color: #888; font-size: 12px;">
        You're getting this because both of you swiped Yes on each other's game on bundler.games.
      </p>
    </div>
  `;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
