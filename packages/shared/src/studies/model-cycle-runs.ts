/**
 * Model Cycle runs study: the body of GET /api/studies/model-cycle-runs,
 * shared by the handler and the page, plus the pure computations both agree on
 * (scope labels, the long-to-wide metric matrix, the all-run comparison, thinning,
 * equal-width grouped bins, the running Sharpe ratio and the expected calibration
 * error terms).
 *
 * The request has two parts so moving the histogram bins does not re-read the
 * run list and the audit:
 *   part=overview  every run, every recipe with folds, the all-run comparison, the audit
 *   part=run       one recipe: predictions, trades, folds, trials, epochs, the metric tables
 */

import type { LensEightNumberSummary } from "../lens/types";

/** The nineteen whole-run metrics the notebook compared across every run, in its order. */
export const COMPARISON_METRICS = [
  "net_profit_usd", "sharpe_ratio", "probabilistic_sharpe_ratio", "sharpe_ratio_standard_error", "maximum_drawdown_usd",
  "profit_factor", "win_rate", "trade_count", "expectancy_usd", "total_cost_usd", "net_profit_minus_buy_and_hold_usd",
  "accuracy", "balanced_accuracy", "roc_auc", "log_loss", "brier_skill_score", "expected_calibration_error",
  "matthews_correlation_coefficient", "price_forecast_skill",
] as const;

/** Prediction columns profiled with their eight numbers and a histogram (every numeric column of the frame). */
export const PREDICTION_COLUMNS = [
  "timestamp", "fold_index", "open", "high", "low", "close", "volume", "probability_up", "predicted_direction", "position",
  "equity_usd", "actual_direction", "predicted_move_points", "predicted_close", "forecast_timestamp", "forecast_error_points",
  "target_position", "position_held", "bar_net_profit_usd", "predicted_move_raw_points",
] as const;

/** Points drawn per chart: longer series are thinned by a fixed stride, keeping the first and last. */
export const EQUITY_POINT_LIMIT = 2_500;
export const SCATTER_POINT_LIMIT = 2_500;
/** Rows of one recipe's record tables sent to the page. */
export const RECORD_ROW_LIMIT = 5_000;

/** A run's `runs` row: the columns the notebook selected plus the error text. Any column can be null on an older run. */
export interface RunRecord {
  recipe: string;
  status: string | null;
  model_label: string | null;
  symbol: string | null;
  timeframe: string | null;
  net_profit_usd: number | null;
  sharpe_ratio: number | null;
  trade_count: number | null;
  accuracy: number | null;
  bars_per_year: number | null;
  tick_size: number | null;
  [column: string]: string | number | boolean | null;
}

/** One selectable recipe: a run with a full record, or an older recipe that has folds only. */
export interface RecipeOption {
  recipe: string;
  status: string;
  hasFullRecord: boolean;
  foldCount: number | null;
  /** Epoch seconds, stamped in the lake's wall clock. */
  firstTest: number | null;
  lastTest: number | null;
  testBars: number | null;
}

export interface ComparisonLongRow {
  recipe: string;
  metric_name: string;
  metric_value: number | null;
}

export interface AuditBody {
  findings: Array<Record<string, string | number | boolean | null>>;
  coverageByStatus: Array<{ status: string; specs: number }>;
  coverage: Array<Record<string, string | number | boolean | null>>;
  record: Array<Record<string, string | number | boolean | null>>;
}

export interface OverviewBody {
  runs: RunRecord[];
  recipes: RecipeOption[];
  /** Recipe opened by default: the newest run that has predictions. */
  defaultRecipe: string | null;
  comparison: ComparisonLongRow[];
  audit: AuditBody;
}

export interface HistogramBin {
  lower: number;
  upper: number;
  count: number;
}

export interface ColumnProfile {
  column: string;
  summary: LensEightNumberSummary;
  bins: HistogramBin[];
}

export type Row = Record<string, string | number | boolean | null>;

export interface MetricRow {
  /** Which table the metric came from. */
  kind: "model" | "trading";
  scope: string;
  fold_index: number | null;
  metric_family: string;
  metric_name: string;
  metric_label: string;
  metric_value: number | null;
  unit: string;
  better: string;
  sample_count: number | null;
  note: string | null;
  definition: string;
  formula: string;
  metric_order: number;
}

export interface CalibrationBin {
  scope: string;
  fold_index: number | null;
  bin_number: number;
  probability_lower: number;
  probability_upper: number;
  scored_bar_count: number;
  mean_probability_up: number | null;
  observed_up_fraction: number | null;
  calibration_gap: number | null;
}

export interface ConfusionCell {
  scope: string;
  fold_index: number | null;
  actual_direction: string;
  predicted_direction: string;
  bar_count: number;
  share_of_scored_bars: number | null;
}

export interface DrawdownRow {
  scope: string;
  fold_index: number | null;
  drawdown_number: number;
  depth_rank: number;
  depth_usd: number;
  bars_to_trough: number | null;
  bars_to_recovery: number | null;
  underwater_bars: number | null;
  underwater_days: number | null;
  recovered: boolean;
}

export interface DistributionRow {
  scope: string;
  fold_index: number | null;
  quantity_name: string;
  quantity_label: string;
  unit: string;
  segment_value: string;
  count: number;
  mean: number | null;
  median: number | null;
  standard_deviation: number | null;
  skewness: number | null;
  kurtosis: number | null;
  percentile_25: number | null;
  percentile_75: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface DailyRow {
  session_day: string;
  fold_index: number | null;
  net_profit_usd: number;
  cumulative_net_profit_usd: number;
  [column: string]: string | number | boolean | null;
}

export interface TradeRow {
  trade_number: number;
  fold_index: number | null;
  side: string;
  net_profit_usd: number;
  [column: string]: string | number | boolean | null;
}

export interface EquityPoint {
  /** Epoch seconds, stamped in the lake's wall clock. */
  timestamp: number;
  equity: number | null;
  position: number | null;
  fold: number | null;
}

export interface ForecastPoint {
  move: number;
  error: number;
  forecast: number | null;
  close: number | null;
}

export interface PredictionSummary {
  count: number;
  forecastCount: number;
  resolvedForecastCount: number;
  /** Share of forecast closes that sit on the tick grid, or null when the run made no forecast. */
  onGridFraction: number | null;
  tickSize: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
}

export interface BarsSummaryRow {
  role: string;
  bars: number;
  first_bar: number | null;
  last_bar: number | null;
  roll_adjusted_bars: number;
}

export interface RunBody {
  recipe: string | null;
  record: RunRecord | null;
  /** Why a panel is empty, by panel name, for a run recorded before that table existed. */
  absent: Record<string, string>;
  predictionSummary: PredictionSummary | null;
  equity: EquityPoint[];
  /** Every processed bar's net profit in USD, in time order (the running-Sharpe stepper reads it). */
  barNetProfitUsd: number[];
  forecastScatter: ForecastPoint[];
  predictionProfile: ColumnProfile[];
  trades: TradeRow[];
  folds: Row[];
  trials: Row[];
  epochs: Row[];
  metricStream: Row[];
  barsSummary: BarsSummaryRow[];
  metrics: MetricRow[];
  calibration: CalibrationBin[];
  confusion: ConfusionCell[];
  daily: DailyRow[];
  drawdowns: DrawdownRow[];
  distributions: DistributionRow[];
}

export interface ModelCycleRunsBody {
  part: "overview" | "run";
  overview: OverviewBody | null;
  run: RunBody | null;
}

export const EMPTY_AUDIT: AuditBody = { findings: [], coverageByStatus: [], coverage: [], record: [] };

export const EMPTY_OVERVIEW: OverviewBody = { runs: [], recipes: [], defaultRecipe: null, comparison: [], audit: EMPTY_AUDIT };

export const EMPTY_RUN: RunBody = {
  recipe: null, record: null, absent: {}, predictionSummary: null, equity: [], barNetProfitUsd: [], forecastScatter: [],
  predictionProfile: [], trades: [], folds: [], trials: [], epochs: [], metricStream: [], barsSummary: [], metrics: [],
  calibration: [], confusion: [], daily: [], drawdowns: [], distributions: [],
};

// ─── pure computations ─────────────────────────────────────────────────────

/** "run", or "fold k" with folds counted from 1 (the notebook's scope_label). */
export function scopeLabel(scope: string, foldIndex: number | null): string {
  if (scope === "run") return "run";
  return `fold ${(foldIndex ?? 0) + 1}`;
}

function scopeOrder(label: string): number {
  return label === "run" ? -1 : Number(label.replace("fold ", ""));
}

export interface MatrixRow {
  metricName: string;
  kind: "model" | "trading";
  family: string;
  label: string;
  unit: string;
  better: string;
  definition: string;
  formula: string;
  order: number;
  /** One value per scope label; a scope with no value holds its reason in `notes`. */
  values: Record<string, number | null>;
  notes: Record<string, string | null>;
  samples: Record<string, number | null>;
}

/** Whole-scope rows pivoted to one row per metric and one column per scope ("run", "fold 1", ...), ordered as the notebook's matrix. */
export function pivotMatrix(rows: readonly MetricRow[], kind: "model" | "trading"): { scopes: string[]; rows: MatrixRow[] } {
  const scopes = new Set<string>();
  const byMetric = new Map<string, MatrixRow>();
  for (const row of rows) {
    if (row.kind !== kind) continue;
    const label = scopeLabel(row.scope, row.fold_index);
    scopes.add(label);
    let entry = byMetric.get(row.metric_name);
    if (!entry) {
      entry = {
        metricName: row.metric_name, kind, family: row.metric_family, label: row.metric_label, unit: row.unit, better: row.better,
        definition: row.definition, formula: row.formula, order: row.metric_order, values: {}, notes: {}, samples: {},
      };
      byMetric.set(row.metric_name, entry);
    }
    entry.values[label] = row.metric_value;
    entry.notes[label] = row.note;
    entry.samples[label] = row.sample_count;
  }
  return {
    scopes: [...scopes].sort((a, b) => scopeOrder(a) - scopeOrder(b)),
    rows: [...byMetric.values()].sort((a, b) => a.order - b.order),
  };
}

export interface ComparisonTable {
  columns: string[];
  rows: Array<Record<string, number | string | null>>;
}

/** One row per recipe, one column per compared metric, sorted by Sharpe ratio descending with nulls last. */
export function comparisonWide(long: readonly ComparisonLongRow[]): ComparisonTable {
  const byRecipe = new Map<string, Record<string, number | string | null>>();
  const present = new Set<string>();
  for (const row of long) {
    let entry = byRecipe.get(row.recipe);
    if (!entry) {
      entry = { recipe: row.recipe };
      byRecipe.set(row.recipe, entry);
    }
    if (!(row.metric_name in entry)) entry[row.metric_name] = row.metric_value;
    present.add(row.metric_name);
  }
  const columns = ["recipe", ...COMPARISON_METRICS.filter((name) => present.has(name))];
  const rows = [...byRecipe.values()].sort((a, b) => {
    const left = typeof a.sharpe_ratio === "number" ? a.sharpe_ratio : null;
    const right = typeof b.sharpe_ratio === "number" ? b.sharpe_ratio : null;
    if (left === null && right === null) return String(a.recipe).localeCompare(String(b.recipe));
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  });
  return { columns, rows };
}

/** At most `limit` items at a fixed stride, always keeping the first and the last. */
export function thin<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit || limit < 2) return [...items];
  const stride = (items.length - 1) / (limit - 1);
  const out: T[] = [];
  for (let i = 0; i < limit; i += 1) out.push(items[Math.round(i * stride)] as T);
  return out;
}

export interface GroupedBin {
  lower: number;
  upper: number;
  middle: number;
  counts: Record<string, number>;
  total: number;
}

/** Equal-width bins from the minimum to the maximum of `values`, counted per group; the maximum falls in the last bin. */
export function groupedBins(values: ReadonlyArray<{ value: number; group: string }>, binCount: number, groups: readonly string[]): GroupedBin[] {
  const finite = values.filter((item) => Number.isFinite(item.value));
  if (finite.length === 0 || binCount < 1) return [];
  let lower = Infinity;
  let upper = -Infinity;
  for (const item of finite) {
    if (item.value < lower) lower = item.value;
    if (item.value > upper) upper = item.value;
  }
  const count = upper > lower ? binCount : 1;
  const width = upper > lower ? (upper - lower) / count : 1;
  const bins: GroupedBin[] = Array.from({ length: count }, (_, index) => ({
    lower: lower + index * width,
    upper: lower + (index + 1) * width,
    middle: lower + (index + 0.5) * width,
    counts: Object.fromEntries(groups.map((group) => [group, 0])),
    total: 0,
  }));
  for (const item of finite) {
    const index = upper > lower ? Math.min(count - 1, Math.floor((item.value - lower) / width)) : 0;
    const bin = bins[index] as GroupedBin;
    bin.counts[item.group] = (bin.counts[item.group] ?? 0) + 1;
    bin.total += 1;
  }
  return bins;
}

export interface RunningSharpe {
  barCount: number;
  mean: number | null;
  standardDeviation: number | null;
  sharpe: number | null;
}

/** Sharpe ratio of the first `barCount` per-bar net profits: mean / standard deviation (n - 1) * sqrt(bars per year). */
export function runningSharpe(profits: readonly number[], barsPerYear: number, barCount: number): RunningSharpe {
  const n = Math.min(Math.max(0, Math.floor(barCount)), profits.length);
  if (n < 2) return { barCount: n, mean: n === 1 ? (profits[0] ?? null) : null, standardDeviation: null, sharpe: null };
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += profits[i] as number;
  const mean = sum / n;
  let squares = 0;
  for (let i = 0; i < n; i += 1) squares += ((profits[i] as number) - mean) ** 2;
  const deviation = Math.sqrt(squares / (n - 1));
  const sharpe = deviation > 0 && Number.isFinite(barsPerYear) && barsPerYear > 0 ? (mean / deviation) * Math.sqrt(barsPerYear) : null;
  return { barCount: n, mean, standardDeviation: deviation, sharpe };
}

export interface CalibrationTerm {
  binNumber: number;
  weight: number;
  meanProbability: number;
  observedFraction: number;
  term: number;
  running: number;
}

/** Expected calibration error terms of the run-scope bins: sum over bins of (bars in bin / scored bars) * |observed share - mean P(up)|. */
export function calibrationTerms(bins: readonly CalibrationBin[]): { terms: CalibrationTerm[]; scoredBars: number; total: number } {
  const usable = bins
    .filter((bin) => bin.scope === "run" && bin.scored_bar_count > 0 && bin.mean_probability_up !== null && bin.observed_up_fraction !== null)
    .sort((a, b) => a.bin_number - b.bin_number);
  const scoredBars = usable.reduce((sum, bin) => sum + bin.scored_bar_count, 0);
  let running = 0;
  const terms = usable.map((bin) => {
    const weight = scoredBars > 0 ? bin.scored_bar_count / scoredBars : 0;
    const term = weight * Math.abs((bin.observed_up_fraction as number) - (bin.mean_probability_up as number));
    running += term;
    return { binNumber: bin.bin_number, weight, meanProbability: bin.mean_probability_up as number, observedFraction: bin.observed_up_fraction as number, term, running };
  });
  return { terms, scoredBars, total: running };
}

/** Cividis, sampled at five stops and blended (the notebook's heatmap scheme; colour-blind safe). */
const CIVIDIS_STOPS: Array<[number, number, number]> = [
  [0, 32, 77], [60, 76, 108], [124, 123, 120], [187, 175, 113], [255, 234, 70],
];

export function cividis(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (CIVIDIS_STOPS.length - 1);
  const index = Math.min(CIVIDIS_STOPS.length - 2, Math.floor(x));
  const fraction = x - index;
  const a = CIVIDIS_STOPS[index] as [number, number, number];
  const b = CIVIDIS_STOPS[index + 1] as [number, number, number];
  const channel = (k: 0 | 1 | 2) => Math.round(a[k] + (b[k] - a[k]) * fraction);
  return `rgb(${channel(0)},${channel(1)},${channel(2)})`;
}

/** Parses the folds table's parameter JSON into "key=value, key=value" (empty when absent or not JSON). */
export function parametersUsed(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return "";
    return Object.entries(parsed).map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(", ");
  } catch {
    return "";
  }
}
