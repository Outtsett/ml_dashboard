/**
 * Contract for the price-vs-variable regression tab.
 *
 * Two halves:
 *   - the statistics every panel reports (RegressionFit), computed by fit.ts
 *     from two aligned arrays, identically on server or client;
 *   - the wire shapes of GET /api/charts/regression/{variables,columns}, which
 *     hand the client lake columns aligned to the chart's own buckets.
 */

import type { LensEightNumberSummary } from "../lens/types";
import type { SeriesFamily, SeriesValueShape } from "../series/types";

// ─── What the Y axis measures ────────────────────────────────────────────────

/**
 *   level          — the close itself, what was asked for. Two trending series
 *                    regress on each other with a huge R² for no reason
 *                    (Granger-Newbold), which is why the other two exist.
 *   difference     — close minus the previous close, against X minus its
 *                    previous value. Removes the shared trend.
 *   forward_return — the log return from this bar's close to the close
 *                    `horizonBars` later, in basis points, against X now.
 *                    This is the tradable question: does X predict the move.
 */
export type ResponseMode = "level" | "difference" | "forward_return";

export interface PairOptions {
  mode: ResponseMode;
  /** Bars ahead for forward_return. Ignored by the other two modes. */
  horizonBars: number;
  /**
   * Bar open times, epoch ms, one per bar. With `barMilliseconds`, a change or
   * forward return is only formed across bars that are contiguous in time — a
   * "next 5 bars" return that spans a two-month hole in the data is not a
   * 5-bar return. Omitted: bars are taken as contiguous.
   */
  timestampsMilliseconds?: ArrayLike<number>;
  barMilliseconds?: number;
}

/** The (x, y) pairs one panel regresses, with the bar each pair came from. */
export interface RegressionPairs {
  x: Float64Array;
  y: Float64Array;
  /** Index into the bar array of the bar the X value was read on. */
  barIndex: Int32Array;
  /** Pairs left out because the bars they span straddle a gap in the data. */
  skippedAcrossGaps: number;
}

// ─── What one fit reports ────────────────────────────────────────────────────

export type CookCutoffRule = "four_over_n" | "one";

export interface RegressionOptions {
  /** Coverage of the slope interval and both bands. Default 0.95. */
  confidenceLevel?: number;
  /** Family-wise α for the Bonferroni studentized-residual test. Default 0.05. */
  outlierFamilyAlpha?: number;
  /** Cook's distance above which a point is called influential. Default 4/n. */
  cookCutoff?: CookCutoffRule;
  /** Points along X at which the bands are evaluated. Default 48. */
  bandSamples?: number;
  /** Newey-West lag. Default floor(4 · (n/100)^(2/9)). */
  neweyWestLag?: number;
}

export interface RegressionBand {
  x: number[];
  fitted: number[];
  meanLower: number[];
  meanUpper: number[];
  predictionLower: number[];
  predictionUpper: number[];
}

export interface RegressionFit {
  n: number;
  degreesOfFreedom: number;
  confidenceLevel: number;
  intercept: number;
  slope: number;
  interceptStandardError: number;
  slopeStandardError: number;
  slopeTStatistic: number;
  slopePValue: number;
  slopeConfidenceInterval: [number, number];
  /** Null when Y is constant. */
  rSquared: number | null;
  adjustedRSquared: number | null;
  pearsonCorrelation: number | null;
  spearmanCorrelation: number | null;
  residualStandardError: number;
  /** t quantile the slope interval and both bands are built from. */
  tCritical: number;
  meanX: number;
  meanY: number;
  sumSquaresX: number;
  minimumX: number;
  maximumX: number;

  /** Residual autocorrelation, in input (time) order. */
  durbinWatson: number;
  residualLagOneAutocorrelation: number;
  /** R² above Durbin-Watson: the Granger-Newbold rule of thumb for a spurious regression. */
  spuriousRegressionSuspected: boolean;

  /** Slope standard error robust to autocorrelation and heteroskedasticity. */
  neweyWestLag: number;
  slopeStandardErrorNeweyWest: number;
  slopeTStatisticNeweyWest: number;
  slopePValueNeweyWest: number;

  fitted: Float64Array;
  residuals: Float64Array;
  leverage: Float64Array;
  studentizedInternal: Float64Array;
  studentizedExternal: Float64Array;
  cookDistance: Float64Array;
  /** 1 where |externally studentized residual| exceeds the Bonferroni cut-off. */
  verticalOutlier: Uint8Array;
  /** 1 where Cook's distance exceeds the cut-off. */
  influential: Uint8Array;
  verticalOutlierCutoff: number;
  cookCutoff: number;
  verticalOutlierCount: number;
  influentialCount: number;

  band: RegressionBand;
  residualSummary: LensEightNumberSummary;
}

export type RegressionResult =
  | { ok: true; fit: RegressionFit }
  | { ok: false; n: number; reason: string };

// ─── Equal-count buckets of X: the mean Y in each ────────────────────────────

export interface QuantileBucket {
  count: number;
  minimumX: number;
  maximumX: number;
  meanY: number;
  standardError: number;
  lower: number;
  upper: number;
}

export interface QuantileBuckets {
  buckets: QuantileBucket[];
  /** Mean Y in the top bucket minus the bottom bucket. */
  spread: number;
  /** Welch's t test of that difference. */
  spreadTStatistic: number;
  spreadPValue: number;
}

// ─── Wire shapes ─────────────────────────────────────────────────────────────

/** One lake column offered as an X variable for the current symbol. */
export interface RegressionVariable {
  /** lake:<object>:<column> — the series catalog id. */
  id: string;
  object: string;
  column: string;
  label: string;
  family: SeriesFamily;
  valueShape: SeriesValueShape;
  /** Computed from bars after this one: using it to explain price is leakage. */
  forwardLooking: boolean;
  /** Values are prices. A price regressed on a price is close to an identity. */
  priceLevel: boolean;
  /** The object's native timeframe, e.g. "1m". */
  objectTimeframe: string | null;
  nullFraction: number;
  /**
   * How one chart bar's value is formed from the object's rows:
   *   exact    — the object's timeframe is the chart's, one row per bar;
   *   summed   — a volume, added up over the chart bar;
   *   last     — the value on the object's last row inside the chart bar
   *              (a 1-minute RSI read at the close of the hour, not an hourly RSI).
   */
  bucketing: "exact" | "summed" | "last";
  /** Plain-words version of `bucketing` for the label, null when exact. */
  bucketingNote: string | null;
}

export interface RegressionVariablesResponse {
  symbol: string;
  timeframe: string;
  variables: RegressionVariable[];
  /** Columns in the catalog left out for this symbol/timeframe, with why. */
  excludedCount: number;
  excludedReasons: Record<string, number>;
}

export interface RegressionColumnValues {
  id: string;
  /** Aligned to `bucketSeconds` of the object it came from. Null = no value. */
  values: Array<number | null>;
  emptyReason?: string;
}

export interface RegressionObjectBlock {
  object: string;
  /** Bucket start, epoch SECONDS, ascending. */
  bucketSeconds: number[];
  columns: RegressionColumnValues[];
}

export interface RegressionColumnsResponse {
  symbol: string;
  timeframe: string;
  fromSeconds: number;
  toSeconds: number;
  blocks: RegressionObjectBlock[];
  /** Ids that were requested but could not be read, with why. */
  failures: Array<{ id: string; reason: string }>;
}

export const REGRESSION_MAX_COLUMNS = 64;
/** Buckets per object a single request may return. */
export const REGRESSION_MAX_ROWS = 25_000;
