/**
 * Labels, number formatting and two small hooks shared by the sections of the
 * slope study. Every label a reader sees is spelled out in full words with its
 * unit; the payload's column keys (`slope_20_z`) never reach the screen bare.
 */

import { useEffect, useState } from "react";
import { fmt } from "@/studies/kit";

/** Signal colours and glyphs: long is orange with an up triangle, short is blue with a down triangle, flat is grey with a dash. */
export const SIGNAL = {
  long: { color: "#E69F00", glyph: "▲", label: "long" },
  short: { color: "#0072B2", glyph: "▼", label: "short" },
  flat: { color: "#8a8a8a", glyph: "—", label: "flat" },
} as const;

export function signalOf(value: number): (typeof SIGNAL)[keyof typeof SIGNAL] {
  if (value > 0) return SIGNAL.long;
  if (value < 0) return SIGNAL.short;
  return SIGNAL.flat;
}

/** The full-word name of a frame column, e.g. `slope_20_z` -> "slope over 20 bars, z-score". */
export function columnLabel(column: string): string {
  const zScore = /^slope_(\d+)_z$/.exec(column);
  if (zScore) return `slope over ${zScore[1]} bars, z-score`;
  const slope = /^slope_(\d+)$/.exec(column);
  if (slope) return `slope over ${slope[1]} bars`;
  switch (column) {
    case "open": return "open price";
    case "high": return "high price";
    case "low": return "low price";
    case "close": return "close price";
    case "volume": return "volume";
    case "slope_threshold": return "signal threshold";
    case "log_return": return "log return of the bar";
    case "strategy_return_before_cost": return "strategy return before cost";
    case "cost": return "cost charged";
    case "strategy_net": return "strategy return after cost";
    default: return column.replaceAll("_", " ");
  }
}

/** A number that may be a price (25,548.99) or a per-bar log return (0.0000123): fixed decimals above a thousandth, exponent form below. */
export function fmtAuto(value: number | null | undefined, decimals = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && magnitude < 1e-3) return value.toExponential(3);
  if (magnitude >= 1000) return fmt(value, 2);
  return fmt(value, decimals);
}

export function fmtSigned(value: number | null | undefined, decimals = 2, suffix = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${fmt(value, decimals)}${suffix}`;
}

/** Month-day hour:minute of a stamped instant, for axis ticks. */
export function fmtTick(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toISOString().slice(5, 16).replace("T", " ");
}

/** Cumulative log return shown either as it is or as a percent change, (e^x - 1) x 100. */
export function logToUnit(value: number, unit: string): number {
  return unit === "percent" ? (Math.exp(value) - 1) * 100 : value;
}

/**
 * A text value that follows its input only after it has been still for
 * `delayMilliseconds`, so a slider drag sends one request and not one per step.
 * It takes text because equal text does not re-render; an object would be a
 * new value every render.
 */
export function useSettledText(value: string, delayMilliseconds: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMilliseconds);
    return () => clearTimeout(timer);
  }, [value, delayMilliseconds]);
  return settled;
}

/** The index of the first point at or after `timestamp`, or -1 when every point is earlier. */
export function indexAtOrAfter(points: ReadonlyArray<{ t: number }>, timestamp: number): number {
  for (let i = 0; i < points.length; i += 1) if ((points[i] as { t: number }).t >= timestamp) return i;
  return -1;
}
