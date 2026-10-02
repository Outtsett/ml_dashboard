/**
 * One regression per X variable — the model behind every panel.
 *
 * Pure: bars and aligned columns in, fitted panels out. It runs in a Web
 * Worker (panels.worker.ts): on the main thread it froze every control for
 * the whole computation on each symbol, timeframe or setting change. Measured
 * 2026-09-23 in Node 22 for 49 panels with every context layer:
 * 247 ms at 5,000 bars and 1,285 ms at 20,000; colouring by group adds k-means
 * (529 ms and 1,895 ms). The page keeps the previous panels on screen, marked
 * updating, until the answer arrives.
 *
 * Beside each straight-line fit it builds the context the scatter draws: the
 * density of the cloud and its 50/80/95% contours, the histogram along each
 * axis, the local trend (LOESS) with its band, local slope and local spread
 * of misses, and — when points are coloured by group — k-means groups.
 */

import {
  benjaminiHochberg,
  buildPairs,
  clusterPoints,
  densityGrid,
  fitSimpleRegression,
  localLinearTrend,
  marginalHistogram,
  midranks,
  quantileBuckets,
  refitWithout,
  type ClusterSummary,
  type CookCutoffRule,
  type DensityGrid,
  type LocalTrend,
  type MarginalHistogram,
  type QuantileBuckets,
  type RegressionFit,
  type RegressionPairs,
  type RegressionResult,
  type ResponseMode,
} from "@shared/regression/index";
import type { RegressionVariable } from "@shared/regression/types";
import type { SeriesFamily } from "@shared/series/types";
import type { OhlcvData } from "@/market/components/types";
import { BAR_VARIABLES } from "./variables";

export interface PanelVariable {
  id: string;
  label: string;
  family: SeriesFamily;
  source: "bar" | "lake";
  /** Plain-words definition (bar variables) or the lake object it lives in. */
  detail: string;
  forwardLooking: boolean;
  priceLevel: boolean;
  containsClose: boolean;
  values: Array<number | null>;
  matchedBars: number;
  emptyReason?: string;
}

/** What a panel keeps of its variable once fitted — the values stay behind. */
export type PanelVariableSummary = Omit<PanelVariable, "values"> & {
  /** Bars the variable was aligned to. */
  barCount: number;
};

export interface PanelSettings {
  mode: ResponseMode;
  horizonBars: number;
  confidenceLevel: number;
  cookCutoff: CookCutoffRule;
  refitWithoutFlagged: boolean;
  /** Run k-means on every panel — only when the points are coloured by group. */
  computeClusters?: boolean;
}

/** What the scatter draws around the straight line. */
export interface PanelContext {
  /** 2-D kernel density and its 50/80/95% highest-density contours; null under DENSITY_MINIMUM_BARS. */
  density: DensityGrid | null;
  /** LOESS local trend with band, local slope and local spread of the line's misses; null with too few distinct X. */
  trend: LocalTrend | null;
  marginalX: MarginalHistogram | null;
  marginalY: MarginalHistogram | null;
  clusters: ClusterSummary | null;
  /**
   * The panel's Newey-West ÷ ordinary slope error, floored at 1. The local
   * trend's band and slope errors are multiplied by it: LOESS errors assume
   * independent bars, and neighbouring bars are not independent.
   */
  autocorrelationInflation: number;
}

export const DENSITY_MINIMUM_BARS = 30;
/** A local trend needs enough distinct X values to have a neighbourhood at all. */
export const TREND_MINIMUM_DISTINCT_X = 8;
/** Bars at which the smoother's self-weight is sampled to estimate its effective parameters. */
const TREND_PARAMETER_SAMPLES = 32;
/** Points the local trend is evaluated at — 48 across a thumbnail is under 10 px apart. */
export const TREND_EVALUATION_POINTS = 48;

function hasDistinctValues(values: ArrayLike<number>, wanted: number): boolean {
  const seen = new Set<number>();
  for (let index = 0; index < values.length && seen.size < wanted; index += 1) seen.add(values[index] as number);
  return seen.size >= wanted;
}

/** Widen a local trend's band and slope errors by `factor` around the same curve. */
export function inflateTrend(trend: LocalTrend, factor: number): LocalTrend {
  if (!(factor > 1)) return trend;
  return {
    ...trend,
    lower: trend.fitted.map((fitted, index) => fitted - factor * (fitted - (trend.lower[index] as number))),
    upper: trend.fitted.map((fitted, index) => fitted + factor * ((trend.upper[index] as number) - fitted)),
    slopeStandardError: trend.slopeStandardError.map((error) => error * factor),
  };
}

export function panelContext(pairs: RegressionPairs, fit: RegressionFit, computeClusters: boolean): PanelContext {
  const n = pairs.x.length;
  const ratio = fit.slopeStandardErrorNeweyWest / fit.slopeStandardError;
  const autocorrelationInflation = Number.isFinite(ratio) ? Math.max(1, ratio) : 1;
  const trend = hasDistinctValues(pairs.x, TREND_MINIMUM_DISTINCT_X)
    ? localLinearTrend(pairs.x, pairs.y, {
        residuals: fit.residuals,
        confidenceLevel: fit.confidenceLevel,
        parameterSamples: TREND_PARAMETER_SAMPLES,
        evaluationPoints: TREND_EVALUATION_POINTS,
      })
    : null;
  return {
    density: n >= DENSITY_MINIMUM_BARS ? densityGrid(pairs.x, pairs.y) : null,
    trend: trend ? inflateTrend(trend, autocorrelationInflation) : null,
    marginalX: marginalHistogram(pairs.x),
    marginalY: marginalHistogram(pairs.y),
    clusters: computeClusters ? clusterPoints(pairs.x, pairs.y) : null,
    autocorrelationInflation,
  };
}

const EMPTY_CONTEXT: PanelContext = {
  density: null, trend: null, marginalX: null, marginalY: null, clusters: null, autocorrelationInflation: 1,
};

export interface PanelModel {
  variable: PanelVariableSummary;
  pairs: RegressionPairs;
  result: RegressionResult;
  /** The fit with every flagged point removed, when that setting is on. */
  refit: RegressionResult | null;
  buckets: QuantileBuckets | null;
  /** Benjamini-Hochberg q-value of the Newey-West slope p-value, across the panels shown. */
  qValue: number | null;
  context: PanelContext;
}

export interface BarClock {
  /** Bar open times, epoch ms, in bar order. */
  timestampsMilliseconds: ReadonlyArray<number>;
  /** Length of one bar at the chart's timeframe. */
  barMilliseconds: number;
}

export function computePanels(
  close: ReadonlyArray<number>,
  variables: ReadonlyArray<PanelVariable>,
  settings: PanelSettings,
  clock?: BarClock,
): PanelModel[] {
  const options = { confidenceLevel: settings.confidenceLevel, cookCutoff: settings.cookCutoff };
  const panels: PanelModel[] = variables.map((variable) => {
    const pairs = buildPairs(close, variable.values, {
      mode: settings.mode,
      horizonBars: settings.horizonBars,
      ...(clock ? { timestampsMilliseconds: clock.timestampsMilliseconds, barMilliseconds: clock.barMilliseconds } : {}),
    });
    const result = fitSimpleRegression(pairs.x, pairs.y, options);
    let refit: RegressionResult | null = null;
    if (settings.refitWithoutFlagged && result.ok) {
      const flagged = new Uint8Array(result.fit.n);
      for (let index = 0; index < result.fit.n; index += 1) {
        flagged[index] = result.fit.verticalOutlier[index] || result.fit.influential[index] ? 1 : 0;
      }
      refit = refitWithout(pairs.x, pairs.y, flagged, options);
    }
    const buckets = result.ok ? quantileBuckets(pairs.x, pairs.y, 5, settings.confidenceLevel) : null;
    const context = result.ok ? panelContext(pairs, result.fit, settings.computeClusters ?? false) : EMPTY_CONTEXT;
    const { values, ...summary } = variable;
    return { variable: { ...summary, barCount: values.length }, pairs, result, refit, buckets, qValue: null, context };
  });

  const tested = panels.filter((panel) => panel.result.ok);
  const qValues = benjaminiHochberg(
    tested.map((panel) => (panel.result.ok ? panel.result.fit.slopePValueNeweyWest : 1)),
  );
  tested.forEach((panel, index) => {
    panel.qValue = qValues[index] ?? null;
  });
  return panels;
}

export function responseAxisLabel(settings: Pick<PanelSettings, "mode" | "horizonBars">): string {
  if (settings.mode === "level") return "Close price (points)";
  if (settings.mode === "difference") return "Change in close from the previous bar (points)";
  return `Log return over the next ${settings.horizonBars} bar${settings.horizonBars === 1 ? "" : "s"} (basis points)`;
}

export function predictorAxisLabel(label: string, mode: ResponseMode): string {
  return mode === "difference" ? `Change in ${label}` : label;
}

export type PanelSort = "q_value" | "spearman" | "r_squared" | "catalog";

export function sortPanels(panels: ReadonlyArray<PanelModel>, sort: PanelSort): PanelModel[] {
  const copy = [...panels];
  const score = (panel: PanelModel): number => {
    if (!panel.result.ok) return Number.NEGATIVE_INFINITY;
    const fit = panel.result.fit;
    if (sort === "q_value") return -(panel.qValue ?? 1);
    if (sort === "spearman") return Math.abs(fit.spearmanCorrelation ?? 0);
    if (sort === "r_squared") return fit.rSquared ?? 0;
    return 0;
  };
  if (sort === "catalog") return copy;
  return copy.sort((left, right) => score(right) - score(left));
}

// ─── Assembling the variables ────────────────────────────────────────────────

/**
 * Identifies a bar window. Aligned lake columns carry the key of the bars they
 * were aligned to and are only ever paired with bars that have the same key —
 * an array aligned to one window, indexed against another, would pair every
 * value with the wrong bar and nothing would look wrong.
 */
export function barsKey(bars: ReadonlyArray<OhlcvData> | undefined): string {
  if (!bars || bars.length === 0) return "empty";
  return `${bars.length}:${bars[0]!.timestamp}:${bars[bars.length - 1]!.timestamp}`;
}

export interface AlignedColumn {
  id: string;
  /** One value per bar, in bar order. Null where the lake has nothing for that bar. */
  values: Array<number | null>;
  /** Bars that found a value. */
  matchedBars: number;
  emptyReason?: string;
}

export interface AlignedColumns {
  barsKey: string;
  columns: Map<string, AlignedColumn>;
}

export interface VariableFilter {
  includeForwardLooking: boolean;
  includePriceLevel: boolean;
}

export function selectLakeVariables(
  variables: ReadonlyArray<RegressionVariable>,
  filter: VariableFilter,
): RegressionVariable[] {
  return variables.filter(
    (variable) =>
      (filter.includeForwardLooking || !variable.forwardLooking) &&
      (filter.includePriceLevel || !variable.priceLevel),
  );
}

/** The bar-derived variables, then every selected lake column aligned to these bars. */
export function assemblePanelVariables(
  bars: ReadonlyArray<OhlcvData>,
  lakeVariables: ReadonlyArray<RegressionVariable>,
  columns: AlignedColumns | undefined,
): PanelVariable[] {
  if (bars.length === 0) return [];
  const variables: PanelVariable[] = BAR_VARIABLES.map((variable) => ({
    id: variable.id,
    label: variable.label,
    family: variable.family,
    source: "bar",
    detail: variable.definition,
    forwardLooking: false,
    priceLevel: false,
    containsClose: variable.containsClose,
    values: variable.compute(bars),
    matchedBars: bars.length,
  }));
  if (!columns || columns.barsKey !== barsKey(bars)) return variables;
  for (const variable of lakeVariables) {
    const aligned = columns.columns.get(variable.id);
    if (!aligned) continue;
    variables.push({
      id: variable.id,
      label: variable.bucketingNote ? `${variable.label} (${variable.bucketingNote})` : variable.label,
      family: variable.family,
      source: "lake",
      detail: `${variable.object}.${variable.column}`,
      forwardLooking: variable.forwardLooking,
      priceLevel: variable.priceLevel,
      containsClose: false,
      values: aligned.values,
      matchedBars: aligned.matchedBars,
      ...(aligned.emptyReason ? { emptyReason: aligned.emptyReason } : {}),
    });
  }
  return variables;
}

/** Every typed-array buffer in the panels, so the worker can transfer rather than copy them. */
export function panelBuffers(panels: ReadonlyArray<PanelModel>): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const add = (array: { buffer: ArrayBufferLike }) => {
    if (array.buffer instanceof ArrayBuffer) buffers.add(array.buffer);
  };
  for (const panel of panels) {
    add(panel.pairs.x);
    add(panel.pairs.y);
    add(panel.pairs.barIndex);
    for (const result of [panel.result, panel.refit]) {
      if (!result || !result.ok) continue;
      const fit = result.fit;
      for (const array of [
        fit.fitted, fit.residuals, fit.leverage, fit.studentizedInternal, fit.studentizedExternal,
        fit.cookDistance, fit.verticalOutlier, fit.influential,
      ]) add(array);
    }
    const { density, marginalX, marginalY, clusters } = panel.context;
    if (density) {
      add(density.values);
      add(density.pointPercentiles);
    }
    if (marginalX) add(marginalX.counts);
    if (marginalY) add(marginalY.counts);
    if (clusters) add(clusters.labels);
  }
  return [...buffers];
}

// ─── Per-bar encodings ───────────────────────────────────────────────────────

/**
 * Values every panel can colour or size its points by. They belong to the
 * BAR, not to a panel, so one legend holds for the whole page: a bar's
 * volatility is the same in every scatter it appears in.
 */
export interface BarEncodings {
  /** 20-bar realized volatility of one-bar log returns, basis points; NaN during warm-up. */
  volatility: Float64Array;
  volume: Float64Array;
  /** Percentile rank among the loaded bars, 0 (lowest) to 1 (highest); NaN where the value is missing. */
  volatilityRank: Float64Array;
  volumeRank: Float64Array;
}

const VOLATILITY_VARIABLE_ID = "bar:realized_volatility_20_bars_basis_points";

function percentileRanks(values: Float64Array): Float64Array {
  const finite: number[] = [];
  const positions: number[] = [];
  values.forEach((value, index) => {
    if (Number.isFinite(value)) {
      finite.push(value);
      positions.push(index);
    }
  });
  const ranks = new Float64Array(values.length).fill(Number.NaN);
  if (finite.length === 0) return ranks;
  const midrank = midranks(finite);
  const denominator = Math.max(1, finite.length - 1);
  positions.forEach((position, index) => {
    ranks[position] = ((midrank[index] as number) - 1) / denominator;
  });
  return ranks;
}

export function barEncodings(bars: ReadonlyArray<OhlcvData>): BarEncodings {
  const volatilityVariable = BAR_VARIABLES.find((variable) => variable.id === VOLATILITY_VARIABLE_ID);
  const volatility = Float64Array.from(volatilityVariable ? volatilityVariable.compute(bars) : [], (value) => value ?? Number.NaN);
  const volume = Float64Array.from(bars, (bar) => (Number.isFinite(bar.volume) ? bar.volume : Number.NaN));
  return { volatility, volume, volatilityRank: percentileRanks(volatility), volumeRank: percentileRanks(volume) };
}

export function encodingBuffers(encodings: BarEncodings): ArrayBuffer[] {
  return [encodings.volatility, encodings.volume, encodings.volatilityRank, encodings.volumeRank]
    .map((array) => array.buffer)
    .filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
}
