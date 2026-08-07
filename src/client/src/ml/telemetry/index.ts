/**
 * Live telemetry surface for ML Studio — the components that make a running
 * pipeline visible as motion rather than as a static snapshot.
 *
 * All of these self-hide when they have nothing to say, so the shell can mount
 * them unconditionally without reserving dead vertical space.
 */

export { DeltaValue, type DeltaValueProps } from "./DeltaValue";
export { MetricTicker } from "./MetricTicker";
export { LoadGauge, type LoadGaugeProps } from "./LoadGauge";
export { SystemLoadStrip } from "./SystemLoadStrip";
export { StageProgressRibbon } from "./StageProgressRibbon";
export {
  estimateEtaSeconds,
  trailingMedianRate,
  pushSample,
  formatDuration,
  type ProgressSample,
} from "./eta";
export {
  resolveMetrics,
  isLowerBetter,
  prettifyMetricKey,
  type MetricDeclaration,
} from "./metricDeclarations";
