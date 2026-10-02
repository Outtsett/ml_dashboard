/** Number formatting for values that span 1e-7 (a return's variance) to 1e5 (a price). */

/** Five significant digits, exponent form outside 0.001 to 100,000; "—" for an unknown. */
export function sig(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e5 || magnitude < 1e-3) return value.toExponential(3);
  return String(Number(value.toPrecision(5)));
}

/** A millisecond epoch as stamped digits (the lake stamps futures in Pacific wall clock). */
export function stamp(timestampMs: number | null | undefined): string {
  if (timestampMs === null || timestampMs === undefined) return "—";
  return new Date(timestampMs).toISOString().slice(0, 16).replace("T", " ");
}

export function stampDay(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}
