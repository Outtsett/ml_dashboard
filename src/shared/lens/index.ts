/**
 * Model Lens shared compute — pure TypeScript, no I/O, no DOM, no Node APIs.
 * The Node server and the browser both import from here, so everything in this
 * barrel must run unchanged in either.
 *
 * The contract itself lives in ./types and is re-exported so a consumer needs
 * exactly one import path.
 */

export * from "./types";

export { clampLensParams, isDefaultLensParams } from "./params";
export { resolveRange, coverageQuantileIndices, readLabel, readNullable, MEDIAN_QUANTILE_INDEX } from "./series";
export type { LensRowRange } from "./series";
export { simulateTrades, tradeCostUsd } from "./simulate";
export type { LensSimulation } from "./simulate";
export { computeBarState } from "./state";
export type { LensBarState } from "./state";
export {
  classifyRegimes,
  regimeDefinition,
  regimePerformance,
  regimeSegments,
  regimeRunsWereCoarsened,
  MAX_REGIME_SEGMENTS,
  regimeShare,
  stampTradeRegimes,
  LENS_REGIME_ORDER,
} from "./regime";
export { computeRolling, LENS_MAX_ROLLING_POINTS } from "./rolling";
export { pageHinkleyDrift, PAGE_HINKLEY_DELTA_MULTIPLE, PAGE_HINKLEY_LAMBDA_MULTIPLE } from "./drift";
export type { LensDrift } from "./drift";
export { computeConfusion } from "./confusion";
export { computeScatter, LENS_MAX_SCATTER_POINTS, LENS_DECILE_COUNT, LENS_RELIABILITY_BIN_COUNT } from "./scatter";
export {
  computeDistribution,
  LENS_HISTOGRAM_BIN_COUNT,
  LENS_HISTOGRAM_LOWER_PERCENTILE,
  LENS_HISTOGRAM_UPPER_PERCENTILE,
} from "./distribution";
export {
  computeAttribution,
  unavailableAttribution,
  LENS_BEESWARM_FEATURE_COUNT,
  LENS_BEESWARM_POINTS_PER_FEATURE,
  LENS_MAX_TIMELINE_STEPS,
} from "./attribution";
export {
  blockBootstrap,
  bootstrapBlockLength,
  createRandom,
  BOOTSTRAP_RESAMPLE_COUNT,
  BOOTSTRAP_SEED,
} from "./bootstrap";
export type { BlockBootstrapResult, BlockBootstrapStatistic } from "./bootstrap";
export { bucketLastIndices, extremeIndices, samplingStride } from "./downsample";
export {
  areaUnderCurve,
  clipProbability,
  eightNumberSummary,
  emptyEstimate,
  finiteValues,
  mean,
  meanEstimate,
  ordinaryLeastSquares,
  proportionEstimate,
  quantileSorted,
  sortedFinite,
  standardDeviation,
  NORMAL_95,
  PROBABILITY_CLIP,
} from "./stats";
export { evaluateLens, logLossOverRange, LENS_MAX_EQUITY_POINTS, LENS_MAX_TRADES } from "./evaluate";
export { buildBarWindow } from "./window";
