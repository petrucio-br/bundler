// Feature flags read from NEXT_PUBLIC_ env vars so they're accessible from both
// server and client code. Toggle in .env.local for dev, in Vercel project settings
// for production. Add new flags by extending this object.

export const FLAGS = {
  /**
   * Network-effects "share Bundler" prompts across the app:
   * - Empty Browse state callout
   * - Yes-pending tab callout
   * - Sidebar persistent share slot
   * - Post-save-preferences nudge
   * - Match notification email PS line
   *
   * Off by default while the userbase is small - the prompts read awkward when
   * you're one of three users testing each other's flows. Flip to true when you
   * actually want to start growing.
   */
  showGrowthNudges: process.env.NEXT_PUBLIC_SHOW_GROWTH_NUDGES === "true",
};
