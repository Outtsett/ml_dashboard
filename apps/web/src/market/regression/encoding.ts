/**
 * What a point's colour and size say, beyond where it sits.
 *
 * Every encoding reads a value the bar already has — when it happened, how
 * volatile the market was around it, how much traded, how far it missed the
 * line, which group k-means put it in — so structure the X/Y position hides
 * (a regime, a volatility cluster, one busy session) shows as colour.
 *
 * Colour maps are colour-blind safe: cividis for time, viridis for magnitudes
 * (both perceptually uniform, both readable with deuteranopia), blue → grey →
 * orange for the signed residual (orange above the line, blue below), and
 * Okabe-Ito hues for groups, whose centres are also numbered on the plot.
 * Continuous values are coloured by PERCENTILE among the loaded bars, so one
 * extreme bar cannot wash every other point into a single colour.
 */

import { interpolateCividis, interpolateViridis } from "d3-scale-chromatic";
import type { RegressionFit, RegressionPairs } from "@shared/regression/types";
import type { ClusterSummary } from "@shared/regression/index";
import type { BarEncodings } from "./panels";
import { REGRESSION_COLORS } from "./scales";

export type ColorBy = "none" | "time" | "volatility" | "volume" | "residual" | "cluster";
export type SizeBy = "none" | "volatility" | "volume" | "residual";

export interface ScatterLayers {
  density: boolean;
  marginals: boolean;
  trend: boolean;
}

export interface PointEncodingInput {
  colorBy: ColorBy;
  sizeBy: SizeBy;
  encodings: BarEncodings | null;
}

export const COLOR_BY_OPTIONS: Array<{ value: ColorBy; label: string; title: string }> = [
  { value: "none", label: "none", title: "Every ordinary bar the same blue." },
  { value: "time", label: "time", title: "Bar order: dark blue the oldest loaded bar, yellow the newest. A cloud that sorts by colour has changed over time." },
  { value: "volatility", label: "volatility", title: "20-bar realized volatility of one-bar log returns, as a percentile of the loaded bars." },
  { value: "volume", label: "volume", title: "Contracts traded in the bar, as a percentile of the loaded bars." },
  { value: "residual", label: "residual", title: "Externally studentized residual: orange above the line, blue below, grey on it; full colour at ±3." },
  { value: "cluster", label: "group", title: "k-means groups on the standardized X and Y, k from 2 to 5 chosen by silhouette. Refits every panel when switched on." },
];

export const SIZE_BY_OPTIONS: Array<{ value: SizeBy; label: string; title: string }> = [
  { value: "none", label: "none", title: "Every point the same size." },
  { value: "volatility", label: "volatility", title: "Larger = higher 20-bar realized volatility (percentile)." },
  { value: "volume", label: "volume", title: "Larger = more contracts traded (percentile)." },
  { value: "residual", label: "|residual|", title: "Larger = farther from the line; full size at |studentized residual| 3." },
];

export const CLUSTER_COLORS = ["#56B4E9", "#E69F00", "#009E73", "#F0E442", "#CC79A7"] as const;
export const MISSING_COLOR = "rgba(150, 150, 150, 0.75)";
const SEQUENTIAL_BUCKETS = 24;
const DIVERGING_BUCKETS = 25;
/** The dark ends of cividis and viridis vanish on the dark background; start part way in. */
const SEQUENTIAL_FLOOR = 0.22;
/** A studentized residual this far from 0 takes the full colour and the full size. */
export const RESIDUAL_SATURATION = 3;
const SMALLEST = 0.55;
const SIZE_SPAN = 1.3;

export function sequentialColor(colorBy: "time" | "volatility" | "volume", fraction: number): string {
  const position = SEQUENTIAL_FLOOR + (1 - SEQUENTIAL_FLOOR) * Math.min(1, Math.max(0, fraction));
  return colorBy === "time" ? interpolateCividis(position) : interpolateViridis(position);
}

function mix(from: [number, number, number], to: [number, number, number], fraction: number): string {
  const channel = (index: number) => Math.round(from[index]! + (to[index]! - from[index]!) * fraction);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

const BELOW: [number, number, number] = [0x56, 0xb4, 0xe9];
const ON_LINE: [number, number, number] = [0x9a, 0x9a, 0x9a];
const ABOVE: [number, number, number] = [0xe6, 0x9f, 0x00];

/** −1 (far below the line) … 0 (on it) … +1 (far above). */
export function divergingColor(signed: number): string {
  const value = Math.min(1, Math.max(-1, signed));
  return value < 0 ? mix(ON_LINE, BELOW, -value) : mix(ON_LINE, ABOVE, value);
}

export interface PointStyle {
  /** Buckets, drawn in `drawOrder`; -1 from bucketOf means "value missing". */
  bucketCount: number;
  bucketOf(pairIndex: number): number;
  colorOf(bucket: number): string;
  drawOrder: number[];
  /** Radius multiplier, 1 when size encodes nothing. */
  sizeOf(pairIndex: number): number;
}

function rankAt(array: Float64Array | undefined, barIndex: number): number {
  const value = array?.[barIndex];
  return value === undefined ? Number.NaN : value;
}

export function pointStyle(
  input: PointEncodingInput | null | undefined,
  pairs: RegressionPairs,
  fit: RegressionFit,
  clusters: ClusterSummary | null,
): PointStyle {
  const colorBy = input?.colorBy ?? "none";
  const sizeBy = input?.sizeBy ?? "none";
  const encodings = input?.encodings ?? null;
  const barCount = encodings ? encodings.volume.length : 0;

  const fraction = (pairIndex: number): number => {
    const barIndex = pairs.barIndex[pairIndex] as number;
    if (colorBy === "time") return barCount > 1 ? barIndex / (barCount - 1) : Number.NaN;
    if (colorBy === "volatility") return rankAt(encodings?.volatilityRank, barIndex);
    if (colorBy === "volume") return rankAt(encodings?.volumeRank, barIndex);
    return Number.NaN;
  };

  let bucketCount = 1;
  let bucketOf: (pairIndex: number) => number = () => 0;
  let colorOf: (bucket: number) => string = () => REGRESSION_COLORS.point;
  let drawOrder = [0];

  if ((colorBy === "time" || colorBy === "volatility" || colorBy === "volume") && encodings) {
    bucketCount = SEQUENTIAL_BUCKETS;
    bucketOf = (pairIndex) => {
      const value = fraction(pairIndex);
      return Number.isFinite(value) ? Math.min(SEQUENTIAL_BUCKETS - 1, Math.floor(value * SEQUENTIAL_BUCKETS)) : -1;
    };
    colorOf = (bucket) => sequentialColor(colorBy, (bucket + 0.5) / SEQUENTIAL_BUCKETS);
    // Newest / highest on top.
    drawOrder = Array.from({ length: SEQUENTIAL_BUCKETS }, (_, bucket) => bucket);
  } else if (colorBy === "residual") {
    bucketCount = DIVERGING_BUCKETS;
    const middle = (DIVERGING_BUCKETS - 1) / 2;
    bucketOf = (pairIndex) => {
      const value = (fit.studentizedExternal[pairIndex] as number) / RESIDUAL_SATURATION;
      if (!Number.isFinite(value)) return -1;
      return Math.round(middle + Math.min(1, Math.max(-1, value)) * middle);
    };
    colorOf = (bucket) => divergingColor((bucket - middle) / middle);
    // The biggest misses on top.
    drawOrder = Array.from({ length: DIVERGING_BUCKETS }, (_, bucket) => bucket).sort(
      (left, right) => Math.abs(left - middle) - Math.abs(right - middle),
    );
  } else if (colorBy === "cluster" && clusters) {
    bucketCount = clusters.k;
    bucketOf = (pairIndex) => clusters.labels[pairIndex] ?? -1;
    colorOf = (bucket) => CLUSTER_COLORS[bucket % CLUSTER_COLORS.length] as string;
    drawOrder = Array.from({ length: clusters.k }, (_, bucket) => bucket);
  }

  let sizeOf: (pairIndex: number) => number = () => 1;
  if (sizeBy === "residual") {
    sizeOf = (pairIndex) => {
      const value = Math.abs(fit.studentizedExternal[pairIndex] as number) / RESIDUAL_SATURATION;
      return Number.isFinite(value) ? SMALLEST + SIZE_SPAN * Math.min(1, value) : SMALLEST;
    };
  } else if ((sizeBy === "volatility" || sizeBy === "volume") && encodings) {
    const ranks = sizeBy === "volatility" ? encodings.volatilityRank : encodings.volumeRank;
    sizeOf = (pairIndex) => {
      const value = rankAt(ranks, pairs.barIndex[pairIndex] as number);
      return Number.isFinite(value) ? SMALLEST + SIZE_SPAN * value : SMALLEST;
    };
  }

  return { bucketCount, bucketOf, colorOf, drawOrder, sizeOf };
}

/** Finite values of an encoding at a few percentiles, for the legend. */
export function encodingPercentiles(values: Float64Array, percentiles: number[]): number[] {
  const finite = Array.from(values).filter(Number.isFinite).sort((left, right) => left - right);
  if (finite.length === 0) return percentiles.map(() => Number.NaN);
  return percentiles.map((percentile) => {
    const position = percentile * (finite.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(finite.length - 1, lower + 1);
    return finite[lower]! + (finite[upper]! - finite[lower]!) * (position - lower);
  });
}
