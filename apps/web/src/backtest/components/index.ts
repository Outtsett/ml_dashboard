/**
 * Barrel exports for the quant primitives. Consumers should import from
 * `@/components/quant` so the underlying file structure can be refactored
 * without churning callsites.
 */

export { PageShell } from "./PageShell";
export { PageHeader } from "./PageHeader";
export { KpiStrip } from "./KpiStrip";
export { KpiCard } from "./KpiCard";
export { MetricCell } from "./MetricCell";
export type { MetricTone } from "./MetricCell";
export { Sparkline } from "./Sparkline";
export type { SparkDirection } from "./Sparkline";
export { RegimeBadge } from "./RegimeBadge";
export type { RegimeState } from "./RegimeBadge";
export { DenseTable } from "./DenseTable";
export type { DenseTableColumnMeta } from "./DenseTable";
// ParallelCoords / ContourPlot / SlicePlot / BestSoFarLine were exported here
// for HpoDetailPage's Optuna trial drill-down, which was their only consumer.
// They went with it when the HPO route was removed.
export { DrawdownChart } from "./DrawdownChart";
export { ExposureBars } from "./ExposureBars";
export { CorrelationMatrix } from "./CorrelationMatrix";
export { RollingSharpe } from "./RollingSharpe";
export type {
  Kpi,
  PageHeaderAction,
  PageShellProps,
  PageStatusPill,
} from "./PageShell.types";
