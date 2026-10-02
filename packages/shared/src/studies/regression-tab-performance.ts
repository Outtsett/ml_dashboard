/**
 * Response body and pure compute for the regression-tab-performance study
 * (apps/api/studies/handlers/regression-tab-performance.ts, page in
 * apps/web/src/studies/pages/regression-tab-performance/).
 *
 * The numbers are the 2026-09-23 measurements behind the Price Regression tab,
 * landed under s3://derived/regression_tab_performance/recipe=measured_2026_09_23/
 * and served as derived_regression_tab_performance_<table>. They are frozen
 * measurements: nothing here re-measures.
 */

/** A variable's histogram is "faithful" when its shape error (total variation) is under this. */
export const FAITHFUL_SHAPE_ERROR = 0.05;
/** One 60 Hz screen frame, in milliseconds. */
export const FRAME_MILLISECONDS = 16.7;
/** The grid the shape error compares histograms on: 30 x 20 cells. */
export const GRID_COLUMNS = 30;
export const GRID_ROWS = 20;

/** The timeframe whose latency rows compare the three read rules. */
export const RULE_TIMEFRAME = "1d";

/** The three read rules and what each one is called on the page. */
export const RULE_LABELS: Readonly<Record<string, string>> = {
  original_rule_reads_one_second_table: "first version (before the whole-table catalog bounds)",
  regression_columns_one_minute_copy_only: "anatomy from the one-minute copy only (loses 2019-2024)",
  regression_columns_all_current_rule: "as the tab reads it now (both anatomy tables)",
};
export const RULE_MEASUREMENT_SETS = Object.keys(RULE_LABELS);
/** The layer of each rule's whole-request reading: the first rule's is `regression_columns_all`. */
export const RULE_LAYERS = ["regression_columns_all", "regression_columns_one_minute_copy_only", "regression_columns_all_current_rule"] as const;
export const OBJECT_LAYER = "regression_columns_object";

export interface RenderSeriesRow {
  /** bar series, mode and variable joined: one faint line per value. */
  series_label: string;
  bar_series: string;
  timeframe: string;
  mode: string;
  variable: string;
  geometry: string;
  plot_width_pixels: number;
  plot_height_pixels: number;
  radius_pixels: number;
  series_points: number;
  requested_budget: number;
  points_drawn: number;
  covered_pixels: number;
  coverage_fraction: number;
  marginal_new_pixels_per_added_point: number | null;
  histogram_total_variation: number;
}

export interface BudgetSummary {
  requested_budget: number;
  median_coverage_fraction: number | null;
  median_shape_error: number | null;
  ninetieth_percentile_shape_error: number | null;
  share_of_variables_faithful: number | null;
  median_points_drawn: number | null;
  series_count: number;
}

export interface CanvasDrawRow {
  run_index: number;
  surface: string;
  plot_width_pixels: number;
  plot_height_pixels: number;
  radius_pixels: number;
  points_drawn: number;
  median_draw_milliseconds: number;
  microseconds_per_point: number;
  note: string;
}

export interface LatencyRow {
  layer: string;
  endpoint: string;
  symbol: string;
  timeframe: string;
  bars_requested: number;
  object: string | null;
  cache_state: string;
  run_index: number;
  time_to_first_byte_milliseconds: number;
  total_milliseconds: number;
  payload_bytes: number;
  measurement_set: string;
}

export interface LatencyGroup {
  layer: string;
  measurement_set: string;
  object: string | null;
  cache_state: string;
  timeframe: string;
  measurement_count: number;
  median_total_milliseconds: number | null;
  median_time_to_first_byte_milliseconds: number | null;
}

export interface ObjectLatency {
  object: string;
  cache_state: string;
  median_milliseconds: number | null;
}

export interface RuleLatency {
  measurement_set: string;
  cache_state: string;
  median_milliseconds: number | null;
}

export interface ClientFitRow {
  where: string;
  bars: number;
  variables: number;
  milliseconds: number;
  note: string;
}

export interface CacheOptionRow {
  option: string;
  payload_megabytes: number;
  milliseconds: number;
  source: string;
}

export interface RegressionTabPerformanceBody {
  geometry: string;
  mode: string;
  geometries: string[];
  modes: string[];
  /** Every budget level that was measured, ascending. */
  budgets: number[];
  renderRows: RenderSeriesRow[];
  byBudget: BudgetSummary[];
  canvasDraw: CanvasDrawRow[];
  /** Median canvas microseconds per point over the steady thumbnail runs (run 1 was taken while the page was busy). */
  steadyMicrosecondsPerPoint: number | null;
  steadyRange: { minimum: number; maximum: number } | null;
  latencyRows: LatencyRow[];
  latencyGroups: LatencyGroup[];
  latencyByObject: ObjectLatency[];
  latencyByRule: RuleLatency[];
  clientFit: ClientFitRow[];
  cacheOptions: CacheOptionRow[];
}

export const EMPTY_BODY: RegressionTabPerformanceBody = {
  geometry: "thumbnail@panel700",
  mode: "all",
  geometries: [],
  modes: [],
  budgets: [],
  renderRows: [],
  byBudget: [],
  canvasDraw: [],
  steadyMicrosecondsPerPoint: null,
  steadyRange: null,
  latencyRows: [],
  latencyGroups: [],
  latencyByObject: [],
  latencyByRule: [],
  clientFit: [],
  cacheOptions: [],
};

/** The measured level nearest `value`, so a link with a stale budget still lands on a real level. */
export function nearestLevel(levels: readonly number[], value: number): number | null {
  let best: number | null = null;
  for (const level of levels) {
    if (best === null || Math.abs(level - value) < Math.abs(best - value)) best = level;
  }
  return best;
}

export interface PivotSeries {
  key: string;
  label: string;
  barSeries: string;
}

/**
 * One row per budget, one column per series (its metric at that budget), so a
 * chart draws every series from a single data array and a tooltip can read the
 * whole budget from one row. A budget a series was not measured at is null.
 */
export function pivotByBudget(
  rows: readonly RenderSeriesRow[],
  metric: "coverage_fraction" | "histogram_total_variation",
): { series: PivotSeries[]; data: Array<Record<string, number | null>> } {
  const series: PivotSeries[] = [];
  const keyOf = new Map<string, string>();
  const byBudget = new Map<number, Record<string, number | null>>();
  for (const row of rows) {
    let key = keyOf.get(row.series_label);
    if (key === undefined) {
      key = `series_${series.length}`;
      keyOf.set(row.series_label, key);
      series.push({ key, label: row.series_label, barSeries: row.bar_series });
    }
    const entry = byBudget.get(row.requested_budget) ?? { requested_budget: row.requested_budget };
    entry[key] = row[metric];
    byBudget.set(row.requested_budget, entry);
  }
  const data = [...byBudget.values()].sort((a, b) => (a.requested_budget as number) - (b.requested_budget as number));
  for (const entry of data) for (const item of series) if (!(item.key in entry)) entry[item.key] = null;
  return { series, data };
}

/** One row per points-drawn level, one column per (surface, run). */
export function pivotCanvas(rows: readonly CanvasDrawRow[]): { keys: Array<{ key: string; surface: string; run: number }>; data: Array<Record<string, number | null>> } {
  const keys: Array<{ key: string; surface: string; run: number }> = [];
  const seen = new Set<string>();
  const byPoints = new Map<number, Record<string, number | null>>();
  for (const row of rows) {
    const key = `${row.surface} · run ${row.run_index}`;
    if (!seen.has(key)) {
      seen.add(key);
      keys.push({ key, surface: row.surface, run: row.run_index });
    }
    const entry = byPoints.get(row.points_drawn) ?? { points_drawn: row.points_drawn };
    entry[key] = row.median_draw_milliseconds;
    byPoints.set(row.points_drawn, entry);
  }
  const data = [...byPoints.values()].sort((a, b) => (a.points_drawn as number) - (b.points_drawn as number));
  for (const entry of data) for (const item of keys) if (!(item.key in entry)) entry[item.key] = null;
  return { keys, data };
}

/** Canvas time of one panel and of `panels` panels, at `microsecondsPerPoint` a point. */
export function canvasMilliseconds(microsecondsPerPoint: number, pointsDrawn: number, panels: number): { panel: number; frame: number } {
  const panel = (microsecondsPerPoint * pointsDrawn) / 1000;
  return { panel, frame: panel * panels };
}

/** The smallest measured budget whose median shape error is under the faithful line, or null when none is. */
export function smallestFaithfulBudget(summaries: readonly BudgetSummary[]): number | null {
  for (const summary of [...summaries].sort((a, b) => a.requested_budget - b.requested_budget)) {
    if (summary.median_shape_error !== null && summary.median_shape_error < FAITHFUL_SHAPE_ERROR) return summary.requested_budget;
  }
  return null;
}

/** Whether the median coverage rises at every step up in budget. */
export function coverageRisesEveryStep(summaries: readonly BudgetSummary[]): boolean {
  const ordered = [...summaries].sort((a, b) => a.requested_budget - b.requested_budget);
  for (let i = 1; i < ordered.length; i += 1) {
    const before = ordered[i - 1]?.median_coverage_fraction;
    const after = ordered[i]?.median_coverage_fraction;
    if (before === null || after === null || before === undefined || after === undefined || after <= before) return false;
  }
  return ordered.length > 1;
}

/** Budgets where the number of series shrinks (short series drop out), so a median there compares a different set. */
export function seriesDropOutBudgets(summaries: readonly BudgetSummary[]): number[] {
  const ordered = [...summaries].sort((a, b) => a.requested_budget - b.requested_budget);
  const out: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    if ((ordered[i] as BudgetSummary).series_count < (ordered[i - 1] as BudgetSummary).series_count) out.push((ordered[i] as BudgetSummary).requested_budget);
  }
  return out;
}

export interface TotalVariationStep {
  index: number;
  reference: number;
  drawn: number;
  term: number;
  runningSum: number;
  /** Half the running sum: the total variation if the remaining cells agreed. */
  runningTotalVariation: number;
}

/** TV = 1/2 sum |p_i - q_i|, term by term. The two share vectors are each normalised to sum to 1. */
export function totalVariationSteps(reference: readonly number[], drawn: readonly number[]): TotalVariationStep[] {
  const refTotal = reference.reduce((a, b) => a + b, 0) || 1;
  const drawnTotal = drawn.reduce((a, b) => a + b, 0) || 1;
  const steps: TotalVariationStep[] = [];
  let running = 0;
  for (let i = 0; i < reference.length; i += 1) {
    const p = (reference[i] as number) / refTotal;
    const q = ((drawn[i] ?? 0) as number) / drawnTotal;
    const term = Math.abs(p - q);
    running += term;
    steps.push({ index: i + 1, reference: p, drawn: q, term, runningSum: running, runningTotalVariation: running / 2 });
  }
  return steps;
}

/** The cache-option rows marked "(published)" are benchmark figures from elsewhere, not measured here. */
export function isPublishedFigure(option: string): boolean {
  return option.includes("(published)");
}
