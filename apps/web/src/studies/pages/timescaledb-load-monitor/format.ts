/** Shared formatting for the load-monitor panels. */

/** "2010-06" from an epoch-millisecond month label (stored as a UTC calendar month). */
export function monthLabel(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString().slice(0, 7);
}

export function yearLabel(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString().slice(0, 4);
}

/** "2026-09-12 13:31:01" in UTC, from an epoch-millisecond instant. */
export function instantLabel(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString().slice(0, 19).replace("T", " ");
}
