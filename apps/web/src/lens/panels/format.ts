/**
 * Formatting + color helpers shared by every Model Lens panel.
 *
 * Every number a panel prints goes through here so units, sign conventions
 * and null handling stay identical across HeadlineStrip / RollingPanel /
 * ScatterPanel / ConfusionPanel / AttributionPanel / RegimePanel /
 * DistributionPanel / VerificationList. Unknown values are always "—", never
 * 0 or blank.
 */

import type { LensEstimate, LensFeatureFamilyKey } from "@shared/lens/types";
import { LENS_FAMILY_LABELS } from "@shared/lens/types";
import { paletteColorDark, trendGlyph, trendTone, trendToneClass, type TrendTone } from "@/shared/theme/dataColors";

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** `$1,234.56`; negative values print `-$1,234.56`. */
export function formatUsd(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${value < 0 ? "-" : ""}$${magnitude}`;
}

/** Same as formatUsd but positive values carry an explicit `+`. */
export function formatUsdSigned(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const body = formatUsd(value, decimals);
  return value > 0 ? `+${body}` : body;
}

/** `fraction` is 0..1. */
export function formatPercent(fraction: number | null | undefined, decimals = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(decimals)}%`;
}

export function formatBp(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)} bp`;
}

/** Epoch seconds (UTC) -> `2019-05-21 19:39 UTC`. */
export function formatTimestamp(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const iso = new Date(seconds * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Compact axis tick: `05-21 19:39`. */
export function formatTimestampShort(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  const iso = new Date(seconds * 1000).toISOString();
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

export interface FormattedEstimate {
  display: string;
  title: string;
  tone: TrendTone;
}

/**
 * Render a LensEstimate as "value [ciLow, ciHigh]" plus a hover title giving
 * n and method, and a pos/neg/flat tone relative to `neutral` (e.g. 0.5 for a
 * hit rate, 1.0 for profit factor, 0 for a signed dollar amount).
 */
export function formatEstimate(
  estimate: LensEstimate,
  fmt: (value: number) => string,
  neutral = 0,
  epsilon = 0,
): FormattedEstimate {
  if (estimate.value === null) {
    return { display: "—", title: `n=${formatInt(estimate.n)}`, tone: "flat" };
  }
  const ci =
    estimate.ciLow !== null && estimate.ciHigh !== null
      ? ` [${fmt(estimate.ciLow)}, ${fmt(estimate.ciHigh)}]`
      : "";
  return {
    display: `${fmt(estimate.value)}${ci}`,
    title: `n=${formatInt(estimate.n)} · ${estimate.method}`,
    tone: trendTone(estimate.value - neutral, epsilon),
  };
}

export { trendGlyph, trendTone, trendToneClass };
export type { TrendTone };

/** Map the up/down/flat direction vocabulary onto StatCell's pos/neg/neutral tone prop. */
export function toStatTone(tone: TrendTone): "pos" | "neg" | "neutral" {
  if (tone === "up") return "pos";
  if (tone === "down") return "neg";
  return "neutral";
}

/** Fixed family -> color mapping, same order everywhere in the lens UI. */
const FAMILY_ORDER: LensFeatureFamilyKey[] = ["momentum", "volatility", "volume", "price_structure", "macro"];

export const FAMILY_COLORS: Record<LensFeatureFamilyKey, string> = Object.fromEntries(
  FAMILY_ORDER.map((family, index) => [family, paletteColorDark(index)]),
) as Record<LensFeatureFamilyKey, string>;

export function familyLabel(family: LensFeatureFamilyKey): string {
  return LENS_FAMILY_LABELS[family];
}

export { FAMILY_ORDER };

/**
 * A cividis-like sequential ramp (dark blue -> grey-teal -> yellow), used for
 * "low value -> high value" coloring (the attribution beeswarm) where a
 * diverging red/green scale would be unreadable to a deuteranope.
 */
const SEQUENTIAL_STOPS: Array<[number, number, number]> = [
  [0, 32, 77], // #00204D
  [124, 123, 120], // #7C7B78
  [255, 234, 70], // #FFEA46
];

export function sequentialColor(t: number): string {
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5;
  const scaled = clamped * (SEQUENTIAL_STOPS.length - 1);
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(SEQUENTIAL_STOPS.length - 1, lowerIndex + 1);
  const frac = scaled - lowerIndex;
  const lower = SEQUENTIAL_STOPS[lowerIndex]!;
  const upper = SEQUENTIAL_STOPS[upperIndex]!;
  const r = Math.round(lower[0] + (upper[0] - lower[0]) * frac);
  const g = Math.round(lower[1] + (upper[1] - lower[1]) * frac);
  const b = Math.round(lower[2] + (upper[2] - lower[2]) * frac);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Chart styling shared across the lens' recharts panels (theme-aware via CSS vars). */
export const LENS_CHART_GRID = { strokeDasharray: "3 3", stroke: "hsl(var(--border))" } as const;
export const LENS_CHART_AXIS = {
  stroke: "hsl(var(--muted-foreground))",
  fontSize: 10,
  tickLine: false,
} as const;
export const LENS_CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "6px",
    fontSize: "11px",
    color: "hsl(var(--foreground))",
  },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
} as const;
