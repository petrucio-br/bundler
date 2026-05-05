# Security Policy

## Reporting a vulnerability

If you find a security issue in Bundler, please report it privately rather than
opening a public GitHub issue. Public issues immediately tip off attackers before
the problem can be patched.

**Email: security@lonepiggy.com**

Please include:

- A description of the vulnerability
- Steps to reproduce (or a proof-of-concept if you have one)
- The impact you think it has (data exposure, account takeover, etc.)
- Whether you've shared this with anyone else

I'll acknowledge receipt within a few days. Bundler is a side project run by
one person, so I can't promise an SLA, but security issues get prioritized over
feature work.

## Scope

**In scope:**

- This repository's source code
- The hosted instance at https://bundler.games
- The matching algorithm, auth flow, swipe/match handling, contact-handoff logic

**Out of scope (report to the upstream vendor):**

- Steam OpenID, Steam Web API, Steam community pages: report to Valve
- Supabase platform issues: https://supabase.com/security
- Vercel platform issues: https://vercel.com/security
- Resend platform issues: https://resend.com/security
- Cloudflare DNS/proxy issues: https://www.cloudflare.com/trust-hub/

If you're not sure whether something is in scope, send the report anyway and
I'll route it.

## What counts as a vulnerability

Examples of things I want to know about:

- Anyone can read another user's email or Discord without matching
- Anyone can claim a game they don't own (bypassing the forum-post + [developer] tag check)
- Anyone can forge a session for another user
- The matching logic leaks the existence of games someone has filtered out
- The verify endpoint can be tricked into fetching arbitrary URLs (SSRF)
- The cron endpoint can be triggered without `CRON_SECRET`
- XSS in any user-input field (notes, tags, game names)
- SQL injection (we use Supabase parameterized queries, but report any case where raw input reaches SQL)

Examples of things that aren't vulnerabilities by design:

- Email addresses are not verified - we don't send confirmation, the match recipient is who cares about correctness
- Wishlist counts are self-reported - someone can lie about their wishlist count
- Tag lists are dev-editable - someone can claim tags their game doesn't actually have
- The hosted instance has no rate limiting on swipes - design choice for V1

If you think one of these "by design" things is actually a problem, send the report and we'll discuss.

## Disclosure timeline

For valid issues:

1. I confirm receipt within a few days
2. I patch and deploy a fix as fast as I can - usually within a week for high-severity issues
3. After the fix is live, I credit the reporter (with their permission) in the commit message and CHANGELOG
4. Public disclosure (issue or write-up) happens after the fix is deployed and any affected users are notified

If you don't get a response in two weeks, feel free to escalate by replying to your original email or pinging on social media.
