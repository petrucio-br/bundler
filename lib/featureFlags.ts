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
   * On by default - enabled for the public launch. Set the env var to "false"
   * to disable (e.g. for a quiet dev environment with a handful of testers
   * where the prompts would read awkward).
   */
  showGrowthNudges: process.env.NEXT_PUBLIC_SHOW_GROWTH_NUDGES !== "false",
};
