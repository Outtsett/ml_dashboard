/**
 * Model Cycle in-depth metric tables — the wire shape of
 * `GET /api/training/cycle/:modelId/metrics`.
 *
 * Built by `src/ml/cycle/report.py` from a run's own record and landed beside it
 * as `derived_model_cycle_runs_<table>` (model_metrics, trading_metrics,
 * calibration_bins, confusion_matrix, distributions, drawdowns, daily_results);
 * the server reads them back and renames the columns to camelCase. Every metric
 * row carries its label, unit, better direction, definition and formula, so the
 * client renders what it is sent and keeps no list of its own. An undefined
 * value is null with the reason in `note`, never 0.
 */
import { z } from "zod";

const nullableNumber = z.number().nullable();
const nullableInteger = z.number().int().nullable();

export const REPORT_SCOPES = ["run", "fold"] as const;
export const REPORT_UNITS = ["usd", "ratio", "fraction", "count", "points", "bars", "days", "probability", "correlation"] as const;
export const REPORT_BETTER = ["higher", "lower", "closer_to_zero", "none"] as const;

export const reportMetricRowSchema = z.object({
  scope: z.enum(REPORT_SCOPES),
  foldIndex: nullableInteger,
  segmentKind: z.string(),
  segmentValue: z.string(),
  family: z.string(),
  name: z.string(),
  label: z.string(),
  value: nullableNumber,
  unit: z.enum(REPORT_UNITS),
  better: z.enum(REPORT_BETTER),
  sampleCount: nullableInteger,
  note: z.string().nullable(),
  definition: z.string(),
  formula: z.string(),
  order: z.number().int(),
});
export type ReportMetricRow = z.infer<typeof reportMetricRowSchema>;

export const reportCalibrationBinSchema = z.object({
  scope: z.enum(REPORT_SCOPES),
  foldIndex: nullableInteger,
  binNumber: z.number().int(),
  probabilityLower: z.number(),
  probabilityUpper: z.number(),
  scoredBarCount: z.number().int(),
  meanProbabilityUp: nullableNumber,
  observedUpFraction: nullableNumber,
  calibrationGap: nullableNumber,
});
export type ReportCalibrationBin = z.infer<typeof reportCalibrationBinSchema>;

export const reportConfusionCellSchema = z.object({
  scope: z.enum(REPORT_SCOPES),
  foldIndex: nullableInteger,
  actualDirection: z.enum(["up", "down"]),
  predictedDirection: z.enum(["up", "down"]),
  barCount: z.number().int(),
  shareOfScoredBars: nullableNumber,
});
export type ReportConfusionCell = z.infer<typeof reportConfusionCellSchema>;

export const reportDistributionRowSchema = z.object({
  scope: z.enum(REPORT_SCOPES),
  foldIndex: nullableInteger,
  quantityName: z.string(),
  quantityLabel: z.string(),
  unit: z.enum(REPORT_UNITS),
  segmentValue: z.string(),
  count: z.number().int(),
  mean: nullableNumber,
  median: nullableNumber,
  standardDeviation: nullableNumber,
  skewness: nullableNumber,
  kurtosis: nullableNumber,
  percentile25: nullableNumber,
  percentile75: nullableNumber,
  minimum: nullableNumber,
  maximum: nullableNumber,
});
export type ReportDistributionRow = z.infer<typeof reportDistributionRowSchema>;

export const reportDrawdownRowSchema = z.object({
  scope: z.enum(REPORT_SCOPES),
  foldIndex: nullableInteger,
  drawdownNumber: z.number().int(),
  depthRank: z.number().int(),
  peakTimestamp: z.number().int(),
  troughTimestamp: z.number().int(),
  recoveryTimestamp: nullableInteger,
  depthUsd: z.number(),
  barsToTrough: z.number().int(),
  barsToRecovery: nullableInteger,
  underwaterBars: z.number().int(),
  underwaterDays: nullableNumber,
  recovered: z.boolean(),
});
export type ReportDrawdownRow = z.infer<typeof reportDrawdownRowSchema>;

export const reportDailyRowSchema = z.object({
  sessionDay: z.string(),
  foldIndex: nullableInteger,
  barCount: z.number().int(),
  exposedBarCount: nullableInteger,
  netProfitUsd: z.number(),
  cumulativeNetProfitUsd: z.number(),
  intradayMaximumDrawdownUsd: nullableNumber,
  tradeCount: z.number().int(),
  winningTradeCount: z.number().int(),
  tradeNetProfitUsd: z.number(),
  totalCostUsd: z.number(),
  scoredBarCount: z.number().int(),
  correctBarCount: z.number().int(),
  accuracy: nullableNumber,
});
export type ReportDailyRow = z.infer<typeof reportDailyRowSchema>;

export const cycleReportSchema = z.object({
  modelId: z.string(),
  modelMetrics: z.array(reportMetricRowSchema),
  tradingMetrics: z.array(reportMetricRowSchema),
  calibrationBins: z.array(reportCalibrationBinSchema),
  confusionMatrix: z.array(reportConfusionCellSchema),
  distributions: z.array(reportDistributionRowSchema),
  drawdowns: z.array(reportDrawdownRowSchema),
  dailyResults: z.array(reportDailyRowSchema),
});
export type CycleReport = z.infer<typeof cycleReportSchema>;
