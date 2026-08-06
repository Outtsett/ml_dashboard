/**
 * Evaluate stage component barrel.
 *
 * Public API consumed by `EvaluateStage.tsx` (W6.d). Each export carries the
 * exact prop shape promised in the W6.c contract — keep this file in sync
 * when the underlying components evolve.
 */

export { ComparisonMatrix } from "./ComparisonMatrix";
export type {
  ComparisonExperiment,
  ComparisonMatrixProps,
} from "./ComparisonMatrix";

export { WalkForwardFoldOverlay } from "./WalkForwardFoldOverlay";
export type {
  FoldPoint,
  FoldOverlayExperiment,
  WalkForwardFoldOverlayProps,
} from "./WalkForwardFoldOverlay";

export { RegimeBreakdown } from "./RegimeBreakdown";
export type {
  RegimeBreakdownExperiment,
  RegimeBreakdownProps,
  RegimeBreakdownResponse,
  RegimeBreakdownRow,
} from "./RegimeBreakdown";

export { CalibrationPanel } from "./CalibrationPanel";
export type {
  CalibrationBucket,
  CalibrationData,
  CalibrationExperiment,
  CalibrationPanelProps,
} from "./CalibrationPanel";

export { BlockBootstrapCI } from "./BlockBootstrapCI";
export type {
  BlockBootstrapCIProps,
  BootstrapCiResult,
  BootstrapExperimentInput,
} from "./BlockBootstrapCI";

export { BaselineComparison } from "./BaselineComparison";
export type {
  BaselineComparisonExperiment,
  BaselineComparisonProps,
} from "./BaselineComparison";

export {
  METRICS,
  metricColorClass,
  readMetric,
  bestExperimentIndex,
} from "./thresholds";
export type { MetricKey, MetricLookup, MetricSpec } from "./thresholds";

export { paletteColor, WONG_PALETTE } from "./palette";
export { lttb } from "./lttb";
export type { Point } from "./lttb";
