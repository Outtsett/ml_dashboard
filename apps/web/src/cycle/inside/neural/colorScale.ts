/**
 * Sequential colour scales for the neural view's heatmaps: cividis for
 * activations and inputs, viridis for attention. Both are perceptually
 * uniform and readable with deuteranopia (no red/green axis).
 *
 * The ramps are 32 samples of matplotlib 3.11's own colormaps
 * (`colormaps["cividis"](i / 31)`), so every colour this view paints is one
 * of these exact hex strings — `apps/web/tests/cycle-inside-neural.test.tsx`
 * checks the rendered view against them.
 */

export const CIVIDIS_RAMP: readonly string[] = [
  "#00224E", "#00285B", "#002E6A", "#053371", "#1C396F", "#293F6E", "#33446D", "#3C4A6C",
  "#45506C", "#4D556C", "#555B6D", "#5C616E", "#646770", "#6B6D72", "#727274", "#787877",
  "#807F78", "#888578", "#908B78", "#979177", "#A09875", "#A89E73", "#B0A571", "#B9AB6D",
  "#C2B369", "#CBB965", "#D3C05F", "#DCC859", "#E6D051", "#EFD748", "#F8DF3C", "#FEE838",
];

export const VIRIDIS_RAMP: readonly string[] = [
  "#440154", "#470D60", "#48186A", "#482374", "#472E7C", "#453882", "#424186", "#3E4A89",
  "#3A548C", "#365D8D", "#32658E", "#2E6D8E", "#2B758E", "#287D8E", "#25848E", "#228C8D",
  "#1F948C", "#1E9C89", "#20A386", "#25AB82", "#2EB37C", "#3ABA76", "#48C16E", "#58C765",
  "#6CCD5A", "#7FD34E", "#93D741", "#A8DB34", "#C0DF25", "#D5E21A", "#EAE51A", "#FDE725",
];

/** The neutral grey a missing value (z-score warm-up) is painted with, beside a "missing" hover. */
export const MISSING_COLOR = "#B8BEC8";

/** A value range; `low === high` (a constant layer) maps everything to the middle of the ramp. */
export interface ColorDomain {
  low: number;
  high: number;
}

/** 0..1 position of `value` in the domain, clamped. */
export function domainPosition(value: number, domain: ColorDomain): number {
  const span = domain.high - domain.low;
  if (!Number.isFinite(span) || span <= 0) return 0.5;
  return Math.min(1, Math.max(0, (value - domain.low) / span));
}

/** The ramp colour for `value`; null / NaN → the missing grey. */
export function rampColor(ramp: readonly string[], value: number | null, domain: ColorDomain): string {
  if (value === null || !Number.isFinite(value)) return MISSING_COLOR;
  const index = Math.round(domainPosition(value, domain) * (ramp.length - 1));
  return ramp[index] ?? MISSING_COLOR;
}

/** Smallest and largest finite value; a list with none gives {0, 0}. */
export function finiteDomain(values: Iterable<number | null>): ColorDomain {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  return Number.isFinite(low) ? { low, high } : { low: 0, high: 0 };
}

/** CSS linear-gradient over a ramp, for the legend strip. */
export function rampGradient(ramp: readonly string[]): string {
  const stops = [0, 8, 16, 24, 31].map((index) => `${ramp[index] ?? MISSING_COLOR} ${Math.round((index / (ramp.length - 1)) * 100)}%`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
