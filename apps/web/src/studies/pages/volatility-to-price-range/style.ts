/**
 * The page's fixed encodings: one Okabe-Ito colour AND one marker shape per
 * timeframe (the shape carries the identity when the hue cannot), the cividis
 * ramp for the matrices, and the few number formats the tables share.
 */

import type { Timeframe } from "@shared/studies/volatility-to-price-range";

export const TIMEFRAME_COLOR: Record<Timeframe, string> = {
  "1m": "#0072B2",
  "5m": "#E69F00",
  "15m": "#56B4E9",
  "30m": "#009E73",
  "45m": "#CC79A7",
  "1h": "#D55E00",
};

export type MarkerShape = "circle" | "square" | "diamond" | "triangle" | "cross" | "star";

export const TIMEFRAME_SHAPE: Record<Timeframe, MarkerShape> = {
  "1m": "circle",
  "5m": "square",
  "15m": "diamond",
  "30m": "triangle",
  "45m": "cross",
  "1h": "star",
};

export const SHAPE_GLYPH: Record<MarkerShape, string> = {
  circle: "●",
  square: "■",
  diamond: "◆",
  triangle: "▲",
  cross: "✚",
  star: "★",
};

export function timeframeLabel(timeframe: Timeframe): string {
  return `${SHAPE_GLYPH[TIMEFRAME_SHAPE[timeframe]]} ${timeframe}`;
}

/** A light neutral for reference lines and the e^v curve on the dark background. */
export const INK = "#d4d4d4";

const CIVIDIS: Array<[number, [number, number, number]]> = [
  [0, [0, 34, 78]],
  [0.25, [53, 69, 108]],
  [0.5, [127, 124, 117]],
  [0.75, [188, 175, 111]],
  [1, [254, 232, 56]],
];

/** Cividis at t ∈ [0, 1]: a background colour and a legible text colour on it. */
export function cividis(t: number): { background: string; text: string } {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  let index = 0;
  while (index < CIVIDIS.length - 2 && clamped > (CIVIDIS[index + 1] as [number, [number, number, number]])[0]) index += 1;
  const [t0, c0] = CIVIDIS[index] as [number, [number, number, number]];
  const [t1, c1] = CIVIDIS[index + 1] as [number, [number, number, number]];
  const w = t1 > t0 ? (clamped - t0) / (t1 - t0) : 0;
  const rgb = c0.map((value, channel) => Math.round(value + ((c1[channel] as number) - value) * w)) as [number, number, number];
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return { background: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`, text: luminance > 140 ? "#111" : "#f5f5f5" };
}

/** A number with a fixed count of decimals, "—" when it is not finite. */
export function fixed(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function signed(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${fixed(value, decimals)}`;
}

export function day(epochMs: number): string {
  return Number.isFinite(epochMs) ? new Date(epochMs).toISOString().slice(0, 10) : "—";
}
