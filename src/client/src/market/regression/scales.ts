/**
 * Colours, scales and number formatting for the regression tab.
 *
 * Okabe-Ito throughout, and no meaning carried by hue alone: a vertical
 * outlier is a diamond, an influential point is a ring, the confidence band
 * is a filled area, the prediction band is a dashed pair of lines, the local
 * trend is a curve, and the density regions are nested outlines (the 95% one
 * dashed).
 */

export const REGRESSION_COLORS = {
  point: "#56B4E9",
  fit: "#E69F00",
  confidenceBand: "rgba(230, 159, 0, 0.26)",
  predictionBand: "#F0E442",
  verticalOutlier: "#D55E00",
  influential: "#CC79A7",
  refit: "#009E73",
  axis: "rgba(255, 255, 255, 0.38)",
  grid: "rgba(255, 255, 255, 0.07)",
  highlight: "#FFFFFF",
  /** LOESS local trend: a neutral curve, so it never competes with the orange straight line. */
  trend: "#F2F2F2",
  trendBand: "rgba(242, 242, 242, 0.10)",
  /** Highest-density regions, nested: each contour's fill stacks on the next. */
  densityFill: "rgba(255, 255, 255, 0.06)",
  densityLine: "rgba(255, 255, 255, 0.30)",
  marginal: "rgba(86, 180, 233, 0.55)",
  marginalActive: "rgba(86, 180, 233, 0.95)",
} as const;

/**
 * How many ordinary points a scatter draws; flagged points are always drawn on
 * top. Measured 2026-09-23 on real MNQ bars (1m and 1h, 20,000 and 16,727
 * bars; 5 variables × 3 Y modes; thumbnail and detail sizes), thinning exactly
 * as ScatterPlot does (lake: derived/regression_tab_performance):
 *   - "shape error" is the total-variation distance between a 30 × 20
 *     histogram of the drawn points and of all the points: the share of the
 *     cloud drawn in the wrong place. Under 0.05 the picture reads as the data.
 *   - at 2,000 points only 31% of variables are under 0.05; at 3,000, 73%;
 *     at 5,000, 90% — and the 90th-percentile error is itself under 0.05;
 *     at 10,000, all of them. Painted-pixel coverage keeps rising the whole
 *     way, so there is no earlier point where extra dots stop mattering.
 *   - canvas cost is about 1 µs a point (0.6-1.2 µs over three runs), so
 *     5,000 is 3-6 ms per thumbnail — fine once, too much for every frame of
 *     a panel drag across several panels, hence the resizing budget.
 */
export const THUMBNAIL_POINT_BUDGET = 5000;
export const DETAIL_POINT_BUDGET = 10000;
/** Points drawn while a panel's width is still changing; the full budget follows once it settles. */
export const RESIZING_POINT_BUDGET = 700;
export const RESIZE_SETTLE_MILLISECONDS = 150;

export interface LinearScale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
  invert(pixel: number): number;
}

export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;
  scale.domain = domain;
  scale.range = range;
  scale.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  return scale;
}

/** Round tick values covering [minimum, maximum], about `count` of them. */
export function niceTicks(minimum: number, maximum: number, count = 4): number[] {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [];
  if (minimum === maximum) return [minimum];
  const rawStep = (maximum - minimum) / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  const step = (residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let tick = Math.ceil(minimum / step) * step; tick <= maximum + step * 1e-9; tick += step) {
    ticks.push(Math.abs(tick) < step * 1e-9 ? 0 : tick);
  }
  return ticks;
}

/** Pad a [min, max] extent by a fraction of its width on both sides. */
export function paddedExtent(minimum: number, maximum: number, fraction = 0.04): [number, number] {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [0, 1];
  if (minimum === maximum) {
    const pad = Math.abs(minimum) * 0.01 || 1;
    return [minimum - pad, maximum + pad];
  }
  const pad = (maximum - minimum) * fraction;
  return [minimum - pad, maximum + pad];
}

/** Compact, magnitude-aware number: 24,812.5 · 0.0342 · 1.2e-7 · 3.4M. */
export function formatValue(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "−∞";
  const magnitude = Math.abs(value);
  if (magnitude === 0) return "0";
  if (magnitude >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (magnitude >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (magnitude >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: Math.max(0, digits - 1) });
  if (magnitude >= 1e-3) return value.toPrecision(digits);
  return value.toExponential(1);
}

/** p-values and q-values: exact to three figures, "< 1e-300" below double range. */
export function formatProbability(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value === 0) return "< 1e-300";
  if (value < 1e-4) return value.toExponential(1);
  return value.toFixed(value < 0.01 ? 4 : 3);
}

/**
 * Which clock the lake's timestamps are in, by asset class — measured, not
 * assumed. Futures (MNQ, ES) carry exchange wall-clock time in Pacific inside
 * UTC-typed timestamps: CME's daily 14:00-15:00 Pacific maintenance break is
 * the empty stamped hour 14 all year, and weeks open at Sunday 15:00. Forex
 * (EURUSD) is true UTC: its week opens at Sunday 21:00 or 22:00, moving with
 * daylight saving. The digits are printed as stored and labelled accordingly.
 */
export type StampClock = "Pacific" | "UTC";

export function stampClockFor(assetType: string): StampClock {
  return assetType === "futures" ? "Pacific" : "UTC";
}

export function formatTimestamp(milliseconds: number, clock: StampClock): string {
  return `${new Date(milliseconds).toISOString().slice(0, 16).replace("T", " ")} ${clock}`;
}
