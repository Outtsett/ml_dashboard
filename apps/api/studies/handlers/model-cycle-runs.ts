/**
 * Model Cycle runs: every recorded run, and for one chosen recipe every bar it
 * predicted, every trade, fold, tuning trial, training epoch and in-depth
 * metric, from the lake. Replaced notebooks/model_cycle_runs.py.
 *
 * Reads the serving views the dashboard already has (no build step):
 *   derived_model_cycle_runs_{runs,bars,predictions,trades,folds,epochs,trials,metrics}     the eight-table record
 *   derived_model_cycle_runs_{model_metrics,trading_metrics,calibration_bins,confusion_matrix,
 *                             distributions,drawdowns,daily_results}                        cycle/report.py's tables
 *   derived_model_cycle_audit_{findings,coverage,record}                                    the 2026-09-26 audit
 *
 * `part=overview` holds what does not depend on the run (the run list, the
 * all-run comparison, the audit); `part=run` holds one recipe and takes the
 * histogram bin count, so the bins slider re-reads one recipe, not the audit.
 * A recipe has at most a few thousand predictions, so its series are read in
 * full and thinned here; the eight numbers and histograms of the prediction
 * columns are aggregated in DuckDB so the page never holds a frame of them.
 */

import { z } from "zod";
import { ident, num, text, textList } from "../sql";
import type { StudyContext, StudyHandler } from "../types";
import type { LensEightNumberSummary } from "@shared/lens/types";
import {
  COMPARISON_METRICS,
  EMPTY_RUN,
  EQUITY_POINT_LIMIT,
  PREDICTION_COLUMNS,
  RECORD_ROW_LIMIT,
  SCATTER_POINT_LIMIT,
  parametersUsed,
  thin,
  type AuditBody,
  type BarsSummaryRow,
  type CalibrationBin,
  type ColumnProfile,
  type ComparisonLongRow,
  type ConfusionCell,
  type DailyRow,
  type DistributionRow,
  type DrawdownRow,
  type EquityPoint,
  type ForecastPoint,
  type HistogramBin,
  type MetricRow,
  type ModelCycleRunsBody,
  type OverviewBody,
  type PredictionSummary,
  type RecipeOption,
  type Row,
  type RunBody,
  type RunRecord,
  type TradeRow,
} from "@shared/studies/model-cycle-runs";

const PREFIX = "derived_model_cycle_runs_";
const AUDIT_PREFIX = "derived_model_cycle_audit_";
const RECIPE_PATTERN = /^[A-Za-z0-9_.-]{1,160}$/;
const DEFAULT_TICK_SIZE = 0.25;

export const RUN_VIEWS = [
  "runs", "bars", "predictions", "trades", "folds", "epochs", "trials", "metrics",
  "model_metrics", "trading_metrics", "calibration_bins", "confusion_matrix", "distributions", "drawdowns", "daily_results",
] as const;
export const AUDIT_VIEWS = ["findings", "coverage", "record"] as const;

const view = (table: string): string => ident(`${PREFIX}${table}`);
const DATASETS = [...RUN_VIEWS.map((table) => `${PREFIX}${table}`), ...AUDIT_VIEWS.map((table) => `${AUDIT_PREFIX}${table}`)];

export const modelCycleRunsQuery = z.object({
  part: z.enum(["overview", "run"]).default("overview"),
  recipe: z.string().regex(RECIPE_PATTERN).optional(),
  bins: z.coerce.number().int().min(10).max(80).default(40),
});
export type ModelCycleRunsQuery = z.infer<typeof modelCycleRunsQuery>;

/** The runs columns the notebook's run table and scatter read, plus the failure text and the year length the Sharpe stepper needs. */
const RUN_COLUMNS = [
  "recipe", "model_id", "status", "error", "symbol", "timeframe", "model_key", "model_label", "implementation", "direction_mode",
  "started_at_timestamp", "elapsed_seconds", "bar_count", "bars_processed", "fold_count", "folds_completed", "tuning_mode",
  "tuning_enabled", "tuning_trials_per_fold", "tuning_objective", "tuning_pinned_parameters", "label_horizon_bars",
  "label_gap_multiple", "gap_crossing_bar_count", "tick_size", "round_trip_cost_usd", "bars_per_year", "net_profit_usd",
  "sharpe_ratio", "sortino_ratio", "maximum_drawdown_usd", "profit_factor", "win_rate", "trade_count", "accuracy", "f1_score",
  "roc_auc", "log_loss", "brier_score", "buy_and_hold_net_profit_usd", "price_forecast_mean_absolute_error_points",
  "persistence_mean_absolute_error_points", "price_forecast_skill",
] as const;

/** The folds columns the notebook kept. */
const FOLD_COLUMNS = [
  "fold_index", "status", "train_bar_count", "validation_bar_count", "test_bar_count", "training_seconds", "testing_seconds",
  "tuning_objective", "tuning_trial_count", "tuning_best_trial", "tuning_best_value", "parameters", "metrics",
] as const;

const ABSENT = {
  predictions: "Nothing landed for this recipe: no predictions table rows.",
  trades: "No trade landed for this recipe (it closed none, or it predates the trades table).",
  folds: "No fold landed for this recipe.",
  trials: "No tuning trial landed (the run was not tuned, or it predates the record).",
  epochs: "No training epoch landed (the run trained no network, or it predates the record, recorded since 2026-09-27).",
  metricStream: "No emitted metric value landed (it predates the record, recorded since 2026-09-27).",
  bars: "Not landed for this run (the bars the model read are recorded since 2026-09-27).",
  metrics: "The in-depth metric tables are not landed for this run yet (scripts/land_model_cycle_metrics.py back-fills them).",
  calibration: "No scored probability landed, so there is no reliability curve.",
  daily: "No session day landed.",
  drawdowns: "No drawdown landed.",
  distributions: "No distribution landed.",
} as const;

// ─── SQL (exported so the parity check runs exactly these strings) ──────────

const recipeFilter = (recipe: string): string => `"recipe" = ${text(recipe)}`;

/** The nine-step profile of the chosen columns as doubles, one row per (column, finite value). */
function longValues(table: string, recipe: string, columns: readonly string[]): string {
  const projection = columns.map((column) => `CAST(${ident(column)} AS DOUBLE) AS ${ident(column)}`).join(", ");
  return `base AS (SELECT ${projection} FROM ${view(table)} WHERE ${recipeFilter(recipe)}),
  long AS (UNPIVOT base ON COLUMNS(*) INTO NAME column_name VALUE v),
  clean AS (SELECT column_name, v FROM long WHERE isfinite(v))`;
}

/** Eight numbers (plus the count) per column. Skewness and kurtosis are DuckDB's sample-adjusted forms, as the dashboard's eightNumberSummary. */
export function summarySql(recipe: string, columns: readonly string[]): string {
  return `WITH ${longValues("predictions", recipe, columns)}
SELECT column_name, count(*) AS count, avg(v) AS mean, median(v) AS median, stddev_samp(v) AS standard_deviation,
  skewness(v) AS skewness, kurtosis(v) AS kurtosis, quantile_cont(v, 0.25) AS percentile_25, quantile_cont(v, 0.75) AS percentile_75,
  min(v) AS minimum, max(v) AS maximum
FROM clean GROUP BY column_name`;
}

/** Equal-width bins between each column's minimum and maximum; the maximum falls in the last bin. */
export function histogramSql(recipe: string, columns: readonly string[], bins: number): string {
  const count = num(bins);
  return `WITH ${longValues("predictions", recipe, columns)},
  bounds AS (SELECT column_name, min(v) AS lo, max(v) AS hi FROM clean GROUP BY column_name)
SELECT c.column_name, b.lo, b.hi,
  CASE WHEN b.hi > b.lo THEN LEAST(CAST(floor((c.v - b.lo) / ((b.hi - b.lo) / ${count})) AS BIGINT), ${count} - 1) ELSE 0 END AS bin,
  count(*) AS rows
FROM clean c JOIN bounds b USING (column_name)
GROUP BY ALL`;
}

export function predictionSummarySql(recipe: string, tickSize: number): string {
  const tick = num(tickSize);
  return `SELECT count(*) AS count, count("predicted_close") AS forecast_count, count("forecast_error_points") AS resolved_forecast_count,
  avg(CASE WHEN "predicted_close" IS NOT NULL THEN CASE WHEN abs("predicted_close" / ${tick} - round("predicted_close" / ${tick})) < 1e-9 THEN 1.0 ELSE 0.0 END END) AS on_grid_fraction,
  min("timestamp") AS first_timestamp, max("timestamp") AS last_timestamp
FROM ${view("predictions")} WHERE ${recipeFilter(recipe)}`;
}

export function equitySql(recipe: string): string {
  return `SELECT "timestamp", "fold_index", "equity_usd", "position_held", "bar_net_profit_usd"
FROM ${view("predictions")} WHERE ${recipeFilter(recipe)} ORDER BY "timestamp"`;
}

export function forecastScatterSql(recipe: string): string {
  return `SELECT "predicted_move_points" AS move, "forecast_error_points" AS error, "predicted_close" AS forecast, "close" AS close
FROM ${view("predictions")}
WHERE ${recipeFilter(recipe)} AND "forecast_error_points" IS NOT NULL AND "predicted_move_points" IS NOT NULL ORDER BY "timestamp"`;
}

export function barsSummarySql(recipe: string): string {
  return `SELECT role, count(*) AS bars, min("timestamp") AS first_bar, max("timestamp") AS last_bar,
  sum(CASE WHEN "roll_adjustment_points" <> 0 THEN 1 ELSE 0 END) AS roll_adjusted_bars
FROM ${view("bars")} WHERE ${recipeFilter(recipe)} GROUP BY role ORDER BY role`;
}

/** Whole-scope metric rows (segment_kind = 'all') of one table, run first then each fold. */
export function metricsSql(table: "model_metrics" | "trading_metrics", kind: "model" | "trading", recipe: string): string {
  return `SELECT ${text(kind)} AS kind, "scope", "fold_index", "metric_family", "metric_name", "metric_label", "metric_value", "unit", "better",
  "sample_count", "note", "definition", "formula", "metric_order"
FROM ${view(table)} WHERE ${recipeFilter(recipe)} AND "segment_kind" = 'all'
ORDER BY "scope" DESC, "fold_index" NULLS FIRST, "metric_order"`;
}

/** A record table of one recipe without its bookkeeping columns. */
function recipeRowsSql(table: string, recipe: string, order: string, exclude: readonly string[] = ["recipe"]): string {
  return `SELECT * EXCLUDE (${exclude.map(ident).join(", ")}) FROM ${view(table)} WHERE ${recipeFilter(recipe)} ORDER BY ${order} LIMIT ${RECORD_ROW_LIMIT}`;
}

export function comparisonSql(tables: ReadonlyArray<"trading_metrics" | "model_metrics">): string {
  const names = textList(COMPARISON_METRICS);
  return tables
    .map((table) => `SELECT "recipe", "metric_name", "metric_value" FROM ${view(table)} WHERE "scope" = 'run' AND "segment_kind" = 'all' AND "metric_name" IN (${names})`)
    .join("\nUNION ALL\n");
}

export const DEFAULT_RECIPE_SQL = `SELECT p."recipe" AS recipe FROM (SELECT "recipe", max("timestamp") AS last_bar FROM ${view("predictions")} GROUP BY "recipe") p
LEFT JOIN ${view("runs")} r ON r."recipe" = p."recipe" ORDER BY r."started_at_timestamp" DESC NULLS LAST, p.last_bar DESC LIMIT 1`;

export const DEFAULT_RECIPE_WITHOUT_RUNS_SQL = `SELECT "recipe" AS recipe FROM ${view("predictions")} GROUP BY "recipe" ORDER BY max("timestamp") DESC LIMIT 1`;

// ─── reading ────────────────────────────────────────────────────────────────

/** Rows of one read, or [] (with one note) when the view is not in the lake. */
async function readOr<T>(context: StudyContext, viewName: string, sql: string): Promise<T[]> {
  if (!(await context.lake.hasView(viewName))) {
    const note = `Not in the lake yet: ${viewName}.`;
    if (!context.notes.includes(note)) context.notes.push(note);
    return [];
  }
  return context.lake.query<T>(sql);
}

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function plainValue(value: unknown): string | number | boolean | null {
  return typeof value === "number" || typeof value === "string" || typeof value === "boolean" ? value : null;
}

function asRecord(row: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) out[key] = plainValue(value);
  return out;
}

async function auditBody(context: StudyContext): Promise<AuditBody> {
  const table = (name: string) => `${AUDIT_PREFIX}${name}`;
  const findings = await readOr<Record<string, unknown>>(context, table("findings"),
    `SELECT finding_number, area, severity, location, finding, status, what_was_done FROM ${ident(table("findings"))} ORDER BY finding_number`);
  const byStatus = await readOr<{ status: string; specs: number }>(context, table("coverage"),
    `SELECT status, count(*) AS specs FROM ${ident(table("coverage"))} GROUP BY status ORDER BY specs DESC`);
  const coverage = await readOr<Record<string, unknown>>(context, table("coverage"),
    `SELECT catalog_spec_id, category, subcategory, status, registry_key, implementation, adapter, reason FROM ${ident(table("coverage"))} ORDER BY status, category, catalog_spec_id`);
  const record = await readOr<Record<string, unknown>>(context, table("record"),
    `SELECT table_name, one_row_per, columns, landed_at_every_fold FROM ${ident(table("record"))}`);
  return {
    findings: findings.map(asRecord),
    coverageByStatus: byStatus.map((row) => ({ status: String(row.status), specs: Number(row.specs) })),
    coverage: coverage.map(asRecord),
    record: record.map(asRecord),
  };
}

async function overviewBody(context: StudyContext): Promise<OverviewBody> {
  const runsView = `${PREFIX}runs`;
  let runs: RunRecord[] = [];
  if (await context.lake.hasView(runsView)) {
    const present = new Set(await context.lake.columns(runsView));
    const columns = RUN_COLUMNS.filter((column) => present.has(column));
    runs = (await context.lake.query<Record<string, unknown>>(
      `SELECT ${columns.map(ident).join(", ")} FROM ${ident(runsView)} ORDER BY "started_at_timestamp" DESC NULLS LAST`,
    )).map((row) => asRecord(row) as RunRecord);
  } else {
    context.notes.push(`Not in the lake yet: ${runsView}.`);
  }

  const foldRecipes = await readOr<{ recipe: string; fold_count: number; first_test: number | null; last_test: number | null; test_bars: number | null }>(
    context, `${PREFIX}folds`,
    `SELECT "recipe", count(*) AS fold_count, min("test_start") AS first_test, max("test_end") AS last_test, CAST(sum("test_bar_count") AS BIGINT) AS test_bars
FROM ${view("folds")} GROUP BY "recipe" ORDER BY last_test DESC`);
  const foldsByRecipe = new Map(foldRecipes.map((row) => [row.recipe, row]));

  const recipes: RecipeOption[] = runs.map((run) => {
    const folds = foldsByRecipe.get(run.recipe);
    return {
      recipe: run.recipe, status: String(run.status ?? "unknown"), hasFullRecord: true,
      foldCount: folds ? Number(folds.fold_count) : null, firstTest: finite(folds?.first_test), lastTest: finite(folds?.last_test), testBars: finite(folds?.test_bars),
    };
  });
  const known = new Set(recipes.map((option) => option.recipe));
  for (const row of foldRecipes) {
    if (known.has(row.recipe)) continue;
    recipes.push({ recipe: row.recipe, status: "folds only", hasFullRecord: false, foldCount: Number(row.fold_count), firstTest: finite(row.first_test), lastTest: finite(row.last_test), testBars: finite(row.test_bars) });
  }

  const hasRuns = runs.length > 0;
  const defaults = await readOr<{ recipe: string }>(context, `${PREFIX}predictions`, hasRuns ? DEFAULT_RECIPE_SQL : DEFAULT_RECIPE_WITHOUT_RUNS_SQL);

  const comparisonTables = (await Promise.all(
    (["trading_metrics", "model_metrics"] as const).map(async (table) => ((await context.lake.hasView(`${PREFIX}${table}`)) ? table : null)),
  )).filter((table): table is "trading_metrics" | "model_metrics" => table !== null);
  if (comparisonTables.length < 2) context.notes.push("The metric tables are not all in the lake yet, so the all-run comparison is partial.");
  const comparison = comparisonTables.length > 0 ? await context.lake.query<ComparisonLongRow>(comparisonSql(comparisonTables)) : [];

  return {
    runs,
    recipes,
    defaultRecipe: defaults[0]?.recipe ?? recipes[0]?.recipe ?? null,
    comparison: comparison.map((row) => ({ recipe: String(row.recipe), metric_name: String(row.metric_name), metric_value: finite(row.metric_value) })),
    audit: await auditBody(context),
  };
}

function summaryOf(row: Record<string, unknown>): LensEightNumberSummary {
  return {
    count: Number(row.count),
    mean: finite(row.mean),
    median: finite(row.median),
    standardDeviation: finite(row.standard_deviation),
    skewness: finite(row.skewness),
    kurtosis: finite(row.kurtosis),
    percentile25: finite(row.percentile_25),
    percentile75: finite(row.percentile_75),
    minimum: finite(row.minimum),
    maximum: finite(row.maximum),
  };
}

/** Equal-width bins from (bin, rows) pairs and the column's bounds; a constant column is one bin. */
export function binsFromRows(rows: ReadonlyArray<{ lo: number; hi: number; bin: number; rows: number }>, binCount: number): HistogramBin[] {
  const first = rows[0];
  if (!first) return [];
  const lower = Number(first.lo);
  const upper = Number(first.hi);
  if (!(upper > lower)) return [{ lower, upper, count: rows.reduce((sum, row) => sum + Number(row.rows), 0) }];
  const width = (upper - lower) / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, index) => ({ lower: lower + index * width, upper: lower + (index + 1) * width, count: 0 }));
  for (const row of rows) {
    const index = Math.min(binCount - 1, Math.max(0, Number(row.bin)));
    (bins[index] as HistogramBin).count += Number(row.rows);
  }
  return bins;
}

export async function predictionProfiles(context: StudyContext, recipe: string, bins: number): Promise<ColumnProfile[]> {
  const present = new Set(await context.lake.columns(`${PREFIX}predictions`));
  const columns = PREDICTION_COLUMNS.filter((column) => present.has(column));
  if (columns.length === 0) return [];
  const summaries = await context.lake.query<Record<string, unknown>>(summarySql(recipe, columns));
  const histograms = await context.lake.query<{ column_name: string; lo: number; hi: number; bin: number; rows: number }>(histogramSql(recipe, columns, bins));
  const binsByColumn = new Map<string, Array<{ lo: number; hi: number; bin: number; rows: number }>>();
  for (const row of histograms) {
    const list = binsByColumn.get(String(row.column_name)) ?? [];
    list.push(row);
    binsByColumn.set(String(row.column_name), list);
  }
  const byColumn = new Map(summaries.map((row) => [String(row.column_name), row]));
  // In the frame's own column order; a column with no finite value has no row and is left out.
  return columns
    .filter((column) => byColumn.has(column))
    .map((column) => ({
      column,
      summary: summaryOf(byColumn.get(column) as Record<string, unknown>),
      bins: binsFromRows(binsByColumn.get(column) ?? [], bins),
    }));
}

async function runBody(context: StudyContext, requested: string | undefined, bins: number): Promise<RunBody> {
  let recipe = requested ?? null;
  if (!recipe) {
    const hasRuns = await context.lake.hasView(`${PREFIX}runs`);
    const defaults = await readOr<{ recipe: string }>(context, `${PREFIX}predictions`, hasRuns ? DEFAULT_RECIPE_SQL : DEFAULT_RECIPE_WITHOUT_RUNS_SQL);
    recipe = defaults[0]?.recipe ?? null;
  }
  if (!recipe) {
    context.notes.push("No recipe has landed predictions yet; start a run from the Model Cycle page.");
    return EMPTY_RUN;
  }
  const chosen = recipe;
  const absent: Record<string, string> = {};

  let record: RunRecord | null = null;
  if (await context.lake.hasView(`${PREFIX}runs`)) {
    const present = new Set(await context.lake.columns(`${PREFIX}runs`));
    const columns = RUN_COLUMNS.filter((column) => present.has(column));
    const rows = await context.lake.query<Record<string, unknown>>(
      `SELECT ${columns.map(ident).join(", ")} FROM ${view("runs")} WHERE ${recipeFilter(chosen)} LIMIT 1`,
    );
    record = rows[0] ? (asRecord(rows[0]) as RunRecord) : null;
  }
  const tickSize = finite(record?.tick_size) ?? DEFAULT_TICK_SIZE;

  // predictions
  let predictionSummary: PredictionSummary | null = null;
  let equity: EquityPoint[] = [];
  let barNetProfitUsd: number[] = [];
  let forecastScatter: ForecastPoint[] = [];
  let predictionProfile: ColumnProfile[] = [];
  if (await context.lake.hasView(`${PREFIX}predictions`)) {
    const [summaryRow] = await context.lake.query<Record<string, unknown>>(predictionSummarySql(chosen, tickSize));
    const count = Number(summaryRow?.count ?? 0);
    if (count > 0 && summaryRow) {
      predictionSummary = {
        count,
        forecastCount: Number(summaryRow.forecast_count),
        resolvedForecastCount: Number(summaryRow.resolved_forecast_count),
        onGridFraction: finite(summaryRow.on_grid_fraction),
        tickSize,
        firstTimestamp: finite(summaryRow.first_timestamp),
        lastTimestamp: finite(summaryRow.last_timestamp),
      };
      const series = await context.lake.query<Record<string, unknown>>(equitySql(chosen));
      equity = thin(
        series.map((row) => ({ timestamp: Number(row.timestamp), equity: finite(row.equity_usd), position: finite(row.position_held), fold: finite(row.fold_index) })),
        EQUITY_POINT_LIMIT,
      );
      const profits = series.map((row) => finite(row.bar_net_profit_usd));
      barNetProfitUsd = profits.every((value) => value !== null) ? (profits as number[]) : [];
      forecastScatter = thin(
        (await context.lake.query<Record<string, unknown>>(forecastScatterSql(chosen))).map((row) => ({
          move: Number(row.move), error: Number(row.error), forecast: finite(row.forecast), close: finite(row.close),
        })),
        SCATTER_POINT_LIMIT,
      );
      predictionProfile = await predictionProfiles(context, chosen, bins);
    } else {
      absent.predictions = ABSENT.predictions;
    }
  } else {
    absent.predictions = ABSENT.predictions;
    context.notes.push(`Not in the lake yet: ${PREFIX}predictions.`);
  }

  // the record tables and the report tables: independent reads, issued together
  const reportOrder = `"scope" DESC, "fold_index" NULLS FIRST`;
  const reportExclude = ["recipe", "model_id"] as const;
  const [
    tradeRows, foldRows, trialRows, epochRows, streamRows, barRows, modelRows, tradingRows,
    calibrationRows, confusionRows, dailyRows, drawdownRows, distributionRows,
  ] = await Promise.all([
    readOr<Record<string, unknown>>(context, `${PREFIX}trades`, recipeRowsSql("trades", chosen, `"trade_number"`)),
    readOr<Record<string, unknown>>(context, `${PREFIX}folds`, recipeRowsSql("folds", chosen, `"fold_index"`)),
    readOr<Record<string, unknown>>(context, `${PREFIX}trials`, recipeRowsSql("trials", chosen, `"fold_index", "trial"`)),
    readOr<Record<string, unknown>>(context, `${PREFIX}epochs`, recipeRowsSql("epochs", chosen, `"fold_index", "trial" NULLS LAST, "epoch"`)),
    readOr<Record<string, unknown>>(context, `${PREFIX}metrics`, recipeRowsSql("metrics", chosen, `"fold_index", "iteration"`)),
    readOr<Record<string, unknown>>(context, `${PREFIX}bars`, barsSummarySql(chosen)),
    readOr<MetricRow>(context, `${PREFIX}model_metrics`, metricsSql("model_metrics", "model", chosen)),
    readOr<MetricRow>(context, `${PREFIX}trading_metrics`, metricsSql("trading_metrics", "trading", chosen)),
    readOr<CalibrationBin>(context, `${PREFIX}calibration_bins`, recipeRowsSql("calibration_bins", chosen, `${reportOrder}, "bin_number"`, reportExclude)),
    readOr<ConfusionCell>(context, `${PREFIX}confusion_matrix`, recipeRowsSql("confusion_matrix", chosen, reportOrder, reportExclude)),
    readOr<DailyRow>(context, `${PREFIX}daily_results`, recipeRowsSql("daily_results", chosen, `"session_day"`, reportExclude)),
    readOr<DrawdownRow>(context, `${PREFIX}drawdowns`, recipeRowsSql("drawdowns", chosen, `${reportOrder}, "drawdown_number"`, reportExclude)),
    readOr<DistributionRow>(context, `${PREFIX}distributions`, recipeRowsSql("distributions", chosen, `${reportOrder}, "quantity_name", "segment_value"`, reportExclude)),
  ]);

  const trades = tradeRows.map((row) => asRecord(row) as TradeRow);
  const folds: Row[] = foldRows.map((row) => {
    const out: Row = {};
    for (const column of FOLD_COLUMNS) {
      if (!(column in row)) continue;
      if (column === "parameters") out.parameters_used = parametersUsed(row.parameters);
      else out[column] = plainValue(row[column]);
    }
    return out;
  });
  const trials = trialRows.map(asRecord);
  const epochs = epochRows.map(asRecord);
  const metricStream = streamRows.map(asRecord);
  const barsSummary = barRows.map((row): BarsSummaryRow => ({
    role: String(row.role), bars: Number(row.bars), first_bar: finite(row.first_bar), last_bar: finite(row.last_bar), roll_adjusted_bars: Number(row.roll_adjusted_bars ?? 0),
  }));
  const metrics = [...tradingRows, ...modelRows].map((row) => ({
    ...row, fold_index: finite(row.fold_index), metric_value: finite(row.metric_value), sample_count: finite(row.sample_count), metric_order: Number(row.metric_order),
  }));
  const calibration = calibrationRows.map((row) => ({ ...row, fold_index: finite(row.fold_index) }));
  const confusion = confusionRows.map((row) => ({ ...row, fold_index: finite(row.fold_index) }));
  const daily = dailyRows;
  const drawdowns = drawdownRows.map((row) => ({ ...row, fold_index: finite(row.fold_index) }));
  const distributions = distributionRows.map((row) => ({ ...row, fold_index: finite(row.fold_index) }));

  if (trades.length === 0) absent.trades = ABSENT.trades;
  if (folds.length === 0) absent.folds = ABSENT.folds;
  if (trials.length === 0) absent.trials = ABSENT.trials;
  if (epochs.length === 0) absent.epochs = ABSENT.epochs;
  if (metricStream.length === 0) absent.metricStream = ABSENT.metricStream;
  if (barsSummary.length === 0) absent.bars = ABSENT.bars;
  if (metrics.length === 0) absent.metrics = ABSENT.metrics;
  if (calibration.length === 0) absent.calibration = ABSENT.calibration;
  if (daily.length === 0) absent.daily = ABSENT.daily;
  if (drawdowns.length === 0) absent.drawdowns = ABSENT.drawdowns;
  if (distributions.length === 0) absent.distributions = ABSENT.distributions;

  return {
    recipe: chosen, record, absent, predictionSummary, equity, barNetProfitUsd, forecastScatter, predictionProfile,
    trades, folds, trials, epochs, metricStream, barsSummary, metrics, calibration, confusion, daily, drawdowns, distributions,
  };
}

const handler: StudyHandler<typeof modelCycleRunsQuery, ModelCycleRunsBody> = {
  slug: "model-cycle-runs",
  datasets: DATASETS,
  query: modelCycleRunsQuery,
  cacheSeconds: 120,
  async run(query, context) {
    if (query.part === "run") return { part: "run", overview: null, run: await runBody(context, query.recipe, query.bins) };
    return { part: "overview", overview: await overviewBody(context), run: null };
  },
};

export default handler;
