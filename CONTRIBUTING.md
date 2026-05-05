# Contributing

Thanks for thinking about contributing. Bundler is small enough that I read every
PR personally - both because I want to keep the code coherent, and because parts
of this codebase touch user trust (auth, matching, contact reveal) where I can't
afford to merge the wrong thing.

## Before you start

For anything beyond a typo fix, please open a GitHub issue first to discuss.
Otherwise you might do an hour of work on a feature I have a different plan for,
and that's a waste of your time.

## Setting up locally

See `README.md` for the full local setup. Short version:

1. Clone the repo
2. `npm install`
3. Set up your own Supabase project (free tier), copy the SQL schema in, get keys
4. Get a Steam Web API key
5. `cp .env.example .env.local`, fill in values
6. `npm run dev`

You'll need to verify a real Steam game you have publisher access to in order to
test the full flow end-to-end. For testing the matching logic, you can manually
seed a second verified game via Supabase SQL Editor.

## What I look for in PRs

**Code that touches the security-sensitive paths gets extra scrutiny:**

- Anything in `lib/auth/`, `lib/email/`, `lib/db/matches.ts`
- The forum verification logic in `lib/steam/forumVerify.ts`
- Any new API route, especially ones that read or write per-user data
- Changes to the `swipes`, `matches`, `users`, `game_owners` schemas
- Anything that handles or displays another user's email, Discord, or other PII

**For these areas, expect:**

- Detailed PR descriptions explaining the threat model you considered
- Tests if at all possible (we don't have heavy test coverage yet, so even one happy-path test helps)
- Clear comments in the code about why certain checks exist

**For everything else (UI tweaks, copy edits, new tag suggestions, etc.):**

Just ship a clean PR with a sensible description. Match the existing code style
(no em-dashes, no emojis unless the surrounding code uses them, prose comments
that explain why rather than what).

## Anti-patterns I'll push back on

- New scraping endpoints that hit Steam or other third parties without rate limiting
- Removing or weakening any of the existing auth checks
- Introducing client-side fetches that send the service-role key to the browser
- Adding new dependencies for things we can do in 20 lines of vanilla code
- Tweaking the matching algorithm without explaining the change in the PR description

## Licensing of contributions

By submitting a PR, you agree that your contribution is licensed under the same
MIT license as the rest of the project. See `LICENSE` for the full text.

## Things you can help with even without writing code

- Try the hosted instance and report bugs (file as GitHub issues, except security - see `SECURITY.md`)
- Improve documentation
- Test the matching logic against your own game's profile and report odd behavior
- Suggest new sort options, filter options, or UX improvements

If you're a Steam dev who'd just like to be one of the first users on the hosted
instance, you don't need to contribute code at all - just sign up and start using
it. The most useful thing for V1 is having more devs in the pool.
