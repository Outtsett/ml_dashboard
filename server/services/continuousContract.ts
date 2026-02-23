// ── Pure Functions ──────────────────────────────────────────────────────

/**
 * Determines if a symbol is a futures root (ES, NQ, MNQ) vs a specific
 * contract (ESH5, NQM25) or forex pair (EURUSD, GBPJPY).
 *
 * - Forex: exactly 6 uppercase letters -> false
 * - Specific contract: letters + month code [FGHJKMNQUVXZ] + 1-2 digits -> false
 * - Futures root: 1-4 uppercase letters, no digits -> true
 * - Default: false
 */
export function isFuturesRoot(symbol: string): boolean {
  const s = symbol.toUpperCase().trim();

  // Forex: exactly 6 uppercase letters (e.g. EURUSD, GBPJPY)
  if (/^[A-Z]{6}$/.test(s)) return false;

  // Specific contract: letters followed by a futures month code + 1-2 digits
  // e.g. ESH5, NQM25, MNQZ26
  if (/^[A-Z]+[FGHJKMNQUVXZ]\d{1,2}$/.test(s)) return false;

  // Futures root: 1-4 uppercase letters, no digits
  if (/^[A-Z]{1,4}$/.test(s)) return true;

  return false;
}

/**
 * Regex pattern matching contracts for a given futures root.
 * e.g. "ES" -> matches ESH5, ESM25, ESZ1 etc.
 */
export function contractPattern(root: string): string {
  return `^${root}[FGHJKMNQUVXZ][0-9]{1,2}$`;
}
