/** Number formats for values that span 1e-7 to 1e6, and the Okabe-Ito glyph pairing for sign. */

import { fmt, fmtInt } from "@/studies/kit";

/** Scientific notation with `digits` decimals, "—" for a missing or non-finite value. */
export function sci(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toExponential(digits);
}

/** Fixed decimals, but scientific once the magnitude is too small to read at that precision. */
export function small(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value !== 0 && Math.abs(value) < 10 ** -digits) return sci(value, 3);
  return fmt(value, digits);
}

export type CellKind = "integer" | "timestamp" | "scientific" | "fixed";

export function formatCell(value: unknown, kind: CellKind): string {
  if (typeof value === "string") return kind === "timestamp" ? value.replace("+00:00", "") : value;
  if (typeof value !== "number") return "—";
  if (kind === "integer") return fmtInt(value);
  if (kind === "scientific") return sci(value, 3);
  return small(value, 4);
}

/** ▲ for a value above zero, ▼ below, ■ at zero: the sign without colour. */
export function signGlyph(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "■";
  return value > 0 ? "▲" : "▼";
}

/** A fraction as a percent with its unit, e.g. 0.25 -> "25%". */
export function percentOf(fraction: number): string {
  return `${(fraction * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}
