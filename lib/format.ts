// Deterministic number formatting helpers.
//
// Why not toLocaleString()? Node.js (especially the small-icu builds) and the browser
// disagree on default-locale formatting, which causes React hydration mismatches when
// SSR-rendered numbers don't match the client-rendered version. This module produces
// the same string regardless of environment.

/**
 * Format an integer with comma thousand separators. Always uses commas regardless of
 * server/client locale, so SSR matches CSR.
 *
 * formatInt(7281) === "7,281"
 * formatInt(0) === "0"
 * formatInt(1234567) === "1,234,567"
 */
export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.floor(Math.abs(n)).toString();
  // Insert commas every three digits from the right. Pure regex, no Intl required.
  return sign + abs.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
