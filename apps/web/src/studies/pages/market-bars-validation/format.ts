/** Number and status formatting shared by the validation page's sections. */

import { fmtInt } from "@/studies/kit";

/** A statistic of any magnitude: plain with decimals in a readable range, scientific outside it. */
export function compact(value: number | null | undefined, decimals = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9 || magnitude < 1e-3) return value.toExponential(3);
  if (Number.isInteger(value)) return fmtInt(value);
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

/** The outcome as a glyph plus a word, never colour alone. */
export function outcomeLabel(matched: boolean): string {
  return matched ? "✓ passed" : "✕ failed";
}

export function stamp(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined || timestamp === 0) return "—";
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}
