/**
 * How the audit's vocabulary is drawn. Severity is carried by colour AND marker
 * shape AND its word, so no reader depends on telling two hues apart
 * (Okabe-Ito: vermillion, orange, sky blue, blue; never red against green).
 */

import type { Severity } from "@shared/studies/data-lifecycle-audit";

export type MarkShape = "diamond" | "triangle" | "circle" | "square";

export const SEVERITY_STYLE: Record<Severity, { colour: string; shape: MarkShape; glyph: string; ink: string }> = {
  critical: { colour: "#D55E00", shape: "diamond", glyph: "◆", ink: "#0a0a0a" },
  high: { colour: "#E69F00", shape: "triangle", glyph: "▲", ink: "#0a0a0a" },
  medium: { colour: "#56B4E9", shape: "circle", glyph: "●", ink: "#0a0a0a" },
  low: { colour: "#0072B2", shape: "square", glyph: "■", ink: "#fafafa" },
};

export function severityStyle(severity: string) {
  return SEVERITY_STYLE[severity as Severity] ?? SEVERITY_STYLE.low;
}

/** A number for a table cell: whole numbers with separators, fractions to six significant digits. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (Number.isInteger(value)) return value.toLocaleString("en-US");
    return Number(value.toPrecision(6)).toLocaleString("en-US", { maximumFractionDigits: 12 });
  }
  return String(value);
}

/** A statistic for a compact summary: thousands rounded, small values to three significant digits. */
export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return Math.round(value).toLocaleString("en-US");
  if (magnitude >= 1) return value.toFixed(3).replace(/\.?0+$/, "");
  if (magnitude === 0) return "0";
  return value.toPrecision(3);
}

/** A statistic for a narrow panel: millions and up in compact notation (1.79B), so the eight numbers never overlap. */
export function compactPanel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1e6) return new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 4 }).format(value);
  return compact(value);
}
