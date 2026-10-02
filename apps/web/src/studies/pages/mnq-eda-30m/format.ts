import { fmt, fmtTime } from "@/studies/kit";

/** Three significant figures, scientific notation for very small or very large magnitudes. */
export function sci(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude < 1e-3 || magnitude >= 1e6) return value.toExponential(digits - 1);
  return Number(value.toPrecision(digits)).toString();
}

/** A p-value: fixed below one, scientific when tiny, "0 (underflows)" when the double is zero. */
export function pText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "0 (below 1e-300)";
  return value < 1e-4 ? value.toExponential(2) : value.toFixed(4);
}

export function signed(value: number | null | undefined, decimals = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${fmt(Math.abs(value), decimals)}`;
}

/** Wall-clock date (the lake's Pacific-clock stamping). */
export function dayOf(timestamp: number | null | undefined): string {
  return timestamp === null || timestamp === undefined ? "—" : fmtTime(timestamp).slice(0, 10);
}

export function yearMonth(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 7);
}

export const DASHES = ["", "7 3", "2 3", "9 3 2 3", "1 4"] as const;
