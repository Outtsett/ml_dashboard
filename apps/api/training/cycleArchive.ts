/**
 * Model Cycle archive — past runs read back from the lake.
 *
 * Think of it as: the filing cabinet behind the accumulator's desk. `cycle.ts`
 * keeps the five most recent runs in memory for the live page; every run the
 * Python process ever finished (or crashed out of) sits in the lake under
 * `s3://derived/model_cycle_runs/recipe=<run>/table=<name>/`, one manifest line
 * per table, and the serving DuckDB exposes each table as
 * `derived_model_cycle_runs_<table>`. This module lists those runs and rebuilds
 * a `CycleSnapshot` from them, so any run id reopens on `/cycle` after a server
 * restart, from another machine, or six months later.
 *
 * Runs landed before 2026-09-26 have only `predictions`, `trades` and `folds`
 * (no `runs`, `bars`, `epochs`, `trials`, `metrics`, `parameters`): they rebuild
 * with the bars the model was tested on and no plan, which the page draws as a
 * finished run without fold bands. Log lines are not landed; the terminal says so.
 */
import { ORPHANED_RUN_REASON } from "@shared/runs/orphans";
import {
emptyBarColumns,
type CycleBarColumns,
type CycleBarSpan,
  type CycleEpoch,
  type CycleParameters,
  type CyclePlan,
  type CycleRunStatus,
  type CycleRunSummary,
  type CycleScoreboard,
  type CycleSnapshot,
  type CycleTrade,
  type CycleTrial,
  CYCLE_METRIC_NAMES,
} from "@shared/cycle/schema";
import { derivedViews, queryLake } from "../infrastructure/database/lake";

const DATASET_VIEW_PREFIX = "derived_model_cycle_runs_";
const CYCLE_RUNNER_SUFFIX = "+walk_forward_cycle";

/** A lake recipe spells the runner key's "+" as "_" (some S3 clients read "+" as a space). */
export function recipeOfModelId(modelId: string): string {
  return modelId.replace(/\+/g, "_");
}

function modelIdOfRecipe(recipe: string): string {
  // `<symbol>_<timeframe>_<key>_walk_forward_cycle_<stamp>` → `<symbol>_<timeframe>_<key>+walk_forward_cycle_<stamp>`
  return recipe.replace(/_walk_forward_cycle_/, `${CYCLE_RUNNER_SUFFIX}_`);
}

const MODEL_ID_PATTERN = /^([A-Z0-9]+)_([0-9]+[a-z]+)_(.+?)(\+walk_forward_cycle|_walk_forward_cycle)_(\d{8}T\d{6})$/;

/** The UTC start stamped into a run id (`…_20260927T094307`), epoch milliseconds, or null. */
export function startedAtOfModelId(modelId: string): number | null {
  const stamp = MODEL_ID_PATTERN.exec(modelId)?.[5];
  if (!stamp) return null;
  return Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8),
    +stamp.slice(9, 11), +stamp.slice(11, 13), +stamp.slice(13, 15));
}

/** A run's start: the record's own when it has one (runs landed before 2026-09-27 carry NULL), else its id's stamp. */
function startedAtOf(startedAtSeconds: unknown, modelId: string): number {
  const recorded = numberOrNull(startedAtSeconds);
  return recorded !== null ? recorded * 1000 : startedAtOfModelId(modelId) ?? 0;
}

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function hasView(name: string): boolean {
  return derivedViews().some((view) => view.viewName === name);
}

function view(table: string): string {
  return `${DATASET_VIEW_PREFIX}${table}`;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  return n === null ? null : Math.trunc(n);
}

function direction(value: unknown): 1 | 0 | -1 | null {
  const n = intOrNull(value);
  return n === 1 || n === 0 || n === -1 ? n : null;
}

function boolOrNull(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

function parseJson<T>(text: unknown): T | null {
  if (typeof text !== "string" || text.length === 0) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function statusOf(value: unknown): CycleRunStatus {
  return value === "failed" || value === "stopped" || value === "running" ? value : "complete";
}

/** A run is read from the lake only when it is not live in this server; a record still
 * saying "running" is a run whose process died under it (the dev server restarts on a
 * server-file save and tree-kills its children), so it is reported as stopped, with the reason. */

function archivedStatusOf(value: unknown): CycleRunStatus {
  const status = statusOf(value);
  return status === "running" ? "stopped" : status;
}

async function rows<T>(sql: string): Promise<T[]> {
  try {
    return await queryLake<T>(sql, 60_000);
  } catch (error) {
    // A view that is not defined yet (no manifest line) reads as no rows, not as a failure.
    if (String(error).includes("does not exist") || String(error).includes("not found")) return [];
    throw error;
  }
}

// ─── the list ───────────────────────────────────────────────────────────────

interface RunRow {
  model_id: string;
  recipe: string;
  status: string;
  symbol: string;
  timeframe: string;
  model_key: string;
  started_at_timestamp: unknown;
  finished_at_timestamp: unknown;
  bars_processed: unknown;
  closed_trade_count: unknown;
  final_metrics?: unknown;
  plan?: unknown;
}

/** Every archived run, newest first: the `runs` table where it exists, the older three-table runs after it. */
export async function listArchivedCycleRuns(limit = 200): Promise<CycleRunSummary[]> {
  const out: CycleRunSummary[] = [];
  const seen = new Set<string>();
  if (hasView(view("runs"))) {
    const runs = await rows<RunRow>(
      `SELECT model_id, recipe, status, symbol, timeframe, model_key, started_at_timestamp, finished_at_timestamp,
              bars_processed, closed_trade_count, final_metrics, plan
       FROM ${view("runs")} ORDER BY started_at_timestamp DESC NULLS LAST LIMIT ${Math.max(1, limit)}`,
    );
    for (const run of runs) {
      seen.add(run.recipe);
      const finalMetrics = parseJson<Record<string, number | null>>(run.final_metrics);
      const parsedPlan = parseJson<{ folds?: unknown[]; labelHorizonBars?: number; directionMode?: "classifier" | "from_price"; hasPriceModel?: boolean; tuning?: { objective?: string; trialCount?: number } | null }>(run.plan);
      const dirEdge = finalMetrics?.price_forecast_direction_accuracy != null
        ? Number(finalMetrics.price_forecast_direction_accuracy) * 100
        : finalMetrics?.win_rate != null
        ? Number(finalMetrics.win_rate) * 100
        : null;
      out.push({
        modelId: run.model_id,
        modelType: `${run.model_key}${CYCLE_RUNNER_SUFFIX}`,
        symbol: run.symbol,
        timeframe: run.timeframe,
        modelFamily: run.model_key as CycleRunSummary["modelFamily"],
        status: archivedStatusOf(run.status),
        startedAt: startedAtOf(run.started_at_timestamp, run.model_id),
        finishedAt: numberOrNull(run.finished_at_timestamp) === null ? null : numberOrNull(run.finished_at_timestamp)! * 1000,
        barCount: intOrNull(run.bars_processed) ?? 0,
        tradeCount: intOrNull(run.closed_trade_count) ?? 0,
        foldCount: Array.isArray(parsedPlan?.folds) ? parsedPlan.folds.length : null,
        directionalEdge: dirEdge,
        confidenceEdge: numberOrNull(finalMetrics?.roc_auc),
        nllLoss: numberOrNull(finalMetrics?.log_loss),
        sharpeRatio: numberOrNull(finalMetrics?.sharpe_ratio),
        labelHorizonBars: intOrNull(parsedPlan?.labelHorizonBars),
        directionMode: parsedPlan?.directionMode ?? null,
        hasPriceModel: typeof parsedPlan?.hasPriceModel === "boolean" ? parsedPlan.hasPriceModel : null,
        tuningObjective: parsedPlan?.tuning?.objective ?? null,
        tuningTrialCount: intOrNull(parsedPlan?.tuning?.trialCount),
      });
    }
  }
  if (hasView(view("folds"))) {
    // runs landed before the `runs` table existed: one row per recipe from the folds
    const older = await rows<{ recipe: string; model_id: string; test_end: unknown; trade_count: unknown; bars: unknown; fold_count: unknown }>(
      `SELECT f.recipe, arg_max(f.model_id, f.fold_index) AS model_id, max(f.test_end) AS test_end,
              sum(f.test_bar_count) AS bars, count(distinct f.fold_index) AS fold_count
       FROM ${view("folds")} f GROUP BY f.recipe ORDER BY test_end DESC LIMIT ${Math.max(1, limit)}`,
    );
    for (const run of older) {
      if (seen.has(run.recipe)) continue;
      const modelId = run.model_id || modelIdOfRecipe(run.recipe);
      const parts = MODEL_ID_PATTERN.exec(modelId);
      out.push({
        modelId,
        modelType: parts ? `${parts[3]}${CYCLE_RUNNER_SUFFIX}` : CYCLE_RUNNER_SUFFIX.slice(1),
        symbol: parts?.[1] ?? null,
        timeframe: parts?.[2] ?? null,
        modelFamily: (parts?.[3] ?? null) as CycleRunSummary["modelFamily"],
        status: "complete",
        startedAt: startedAtOfModelId(modelId) ?? (numberOrNull(run.test_end) ?? 0) * 1000,
        // these runs never recorded when they finished (test_end is the last bar tested, not a wall-clock time)
        finishedAt: null,
        barCount: intOrNull(run.bars) ?? 0,
        tradeCount: intOrNull(run.trade_count) ?? 0,
        foldCount: intOrNull(run.fold_count) ?? 1,
        directionalEdge: null,
        confidenceEdge: null,
        nllLoss: null,
        sharpeRatio: null,
      });
    }
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out.slice(0, limit);
}

// ─── one run ────────────────────────────────────────────────────────────────

interface PredictionRow {
  timestamp: unknown;
  fold_index: unknown;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
  probability_up: unknown;
  predicted_direction: unknown;
  position?: unknown;
  target_position?: unknown;
  position_held?: unknown;
  equity_usd: unknown;
  actual_direction: unknown;
  correct: unknown;
  predicted_close: unknown;
  forecast_timestamp: unknown;
}

interface BarRow {
  timestamp: unknown;
  fold_index: unknown;
  role: string;
  /** Which walk emitted the bar; absent in a record written before the validation replay existed. */
  span?: string | null;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
}

function barColumnsFrom(bars: BarRow[], predictions: PredictionRow[]): CycleBarColumns {
  const columns = emptyBarColumns();
  const byTimestamp = new Map<number, PredictionRow>();
  for (const row of predictions) byTimestamp.set(intOrNull(row.timestamp) ?? -1, row);
  const source: Array<{ row: BarRow | PredictionRow; role: "context" | "processed"; span: CycleBarSpan }> = bars.length
    ? bars.map((row) => ({
        row,
        role: row.role === "processed" ? "processed" : "context",
        span: row.span === "replay" ? "replay" : "test",
      }))
    : predictions.map((row) => ({ row, role: "processed" as const, span: "test" as const }));
  let last = -Infinity;
  for (const { row, role, span } of source) {
    const t = intOrNull(row.timestamp);
    if (t === null || t <= last) continue;
    last = t;
    // a replay bar is in sample, so it carries no row in `predictions`: the scored walk
    // owns that table, and a replay bar must never borrow another bar's numbers
    const prediction = role === "processed" && span === "test" ? byTimestamp.get(t) ?? null : null;
    columns.timestamps.push(t);
    columns.open.push(numberOrNull(row.open) ?? 0);
    columns.high.push(numberOrNull(row.high) ?? 0);
    columns.low.push(numberOrNull(row.low) ?? 0);
    columns.close.push(numberOrNull(row.close) ?? 0);
    columns.volume.push(numberOrNull(row.volume) ?? 0);
    columns.role.push(role);
    columns.span.push(span);
    columns.foldIndex.push(intOrNull(row.fold_index));
    columns.probabilityUp.push(prediction ? numberOrNull(prediction.probability_up) : null);
    columns.predictedDirection.push(prediction ? direction(prediction.predicted_direction) : null);
    columns.position.push(prediction ? direction(prediction.target_position ?? prediction.position) : null);
    columns.positionHeld.push(prediction ? direction(prediction.position_held) : null);
    columns.equityUsd.push(prediction ? numberOrNull(prediction.equity_usd) : null);
    columns.predictedClose.push(prediction ? numberOrNull(prediction.predicted_close) : null);
    columns.forecastTimestamp.push(prediction ? intOrNull(prediction.forecast_timestamp) : null);
    columns.actualDirection.push(prediction ? direction(prediction.actual_direction) : null);
    columns.correct.push(prediction ? boolOrNull(prediction.correct) : null);
  }
  return columns;
}

interface TradeRow {
  trade_number: unknown;
  fold_index: unknown;
  side: string;
  contracts: unknown;
  entry_timestamp: unknown;
  entry_price: unknown;
  exit_timestamp: unknown;
  exit_price: unknown;
  bars_held: unknown;
  probability_up_at_entry: unknown;
  gross_profit_usd: unknown;
  cost_usd: unknown;
  net_profit_usd: unknown;
  exit_reason: string | null;
}

function tradeFrom(row: TradeRow, seq: number): CycleTrade {
  return {
    seq,
    tradeNumber: intOrNull(row.trade_number) ?? 0,
    foldIndex: intOrNull(row.fold_index) ?? 0,
    side: row.side === "short" ? "short" : "long",
    status: numberOrNull(row.exit_timestamp) === null ? "open" : "closed",
    contracts: intOrNull(row.contracts) ?? 1,
    entryTimestamp: intOrNull(row.entry_timestamp) ?? 0,
    entryPrice: numberOrNull(row.entry_price) ?? 0,
    exitTimestamp: intOrNull(row.exit_timestamp),
    exitPrice: numberOrNull(row.exit_price),
    barsHeld: intOrNull(row.bars_held) ?? 0,
    probabilityUpAtEntry: Math.min(1, Math.max(0, numberOrNull(row.probability_up_at_entry) ?? 0.5)),
    grossProfitUsd: numberOrNull(row.gross_profit_usd),
    costUsd: numberOrNull(row.cost_usd),
    netProfitUsd: numberOrNull(row.net_profit_usd),
    exitReason: (row.exit_reason as CycleTrade["exitReason"]) ?? null,
  } as CycleTrade;
}

interface FoldRow {
  fold_index: unknown;
  test_bar_count: unknown;
  metrics: unknown;
  status: unknown;
  parameters: unknown;
  tuning_objective: unknown;
  tuning_trial_count: unknown;
  tuning_best_trial: unknown;
  tuning_best_value: unknown;
}

const EMPTY_DISTRIBUTION = {
  count: 0, mean: null, median: null, standardDeviation: null, skewness: null, kurtosis: null,
  percentile25: null, percentile75: null, minimum: null, maximum: null,
};

function scoreboardFrom(scope: "fold" | "final", foldIndex: number | null, metrics: Record<string, number | null>, barsEvaluated: number, seq: number): CycleScoreboard {
  const ordered: Record<string, number | null> = {};
  for (const name of CYCLE_METRIC_NAMES) ordered[name] = metrics[name] ?? null;
  return {
    seq, scope, foldIndex, barsEvaluated, barsScored: 0, metrics: ordered, tradeDistribution: EMPTY_DISTRIBUTION,
    notes: ["rebuilt from the lake record; trade distribution and scored-bar count were not landed"],
  } as CycleScoreboard;
}

/** The snapshot of an archived run, or null when the lake holds nothing under its recipe. */
export async function loadArchivedCycleSnapshot(modelId: string): Promise<CycleSnapshot | null> {
  const recipe = recipeOfModelId(modelId);
  const where = `WHERE recipe = ${literal(recipe)}`;
  const runRows = hasView(view("runs"))
    ? await rows<Record<string, unknown>>(`SELECT * FROM ${view("runs")} ${where} LIMIT 1`)
    : [];
  const run = runRows[0] ?? null;
  const [predictions, bars, trades, folds, epochs, trials] = await Promise.all([
    hasView(view("predictions")) ? rows<PredictionRow>(`SELECT * FROM ${view("predictions")} ${where} ORDER BY timestamp`) : [],
    hasView(view("bars")) ? rows<BarRow>(`SELECT * FROM ${view("bars")} ${where} ORDER BY timestamp`) : [],
    hasView(view("trades")) ? rows<TradeRow>(`SELECT * FROM ${view("trades")} ${where} ORDER BY trade_number`) : [],
    hasView(view("folds")) ? rows<FoldRow>(`SELECT * FROM ${view("folds")} ${where} ORDER BY fold_index`) : [],
    hasView(view("epochs")) ? rows<Record<string, unknown>>(`SELECT * FROM ${view("epochs")} ${where} ORDER BY fold_index, trial, epoch`) : [],
    hasView(view("trials")) ? rows<Record<string, unknown>>(`SELECT * FROM ${view("trials")} ${where} ORDER BY fold_index, trial`) : [],
  ]);
  if (!run && predictions.length === 0 && folds.length === 0) return null;

  const plan = run ? parseJson<CyclePlan>(run.plan) : null;
  const finalMetrics = run ? parseJson<Record<string, number | null>>(run.final_metrics) : null;
  let seq = 0;
  const foldBoards: CycleScoreboard[] = [];
  const parameters: CycleParameters[] = [];
  for (const fold of folds) {
    const metrics = parseJson<Record<string, number | null>>(fold.metrics) ?? {};
    const foldIndex = intOrNull(fold.fold_index) ?? 0;
    if (Object.keys(metrics).length) foldBoards.push(scoreboardFrom("fold", foldIndex, metrics, intOrNull(fold.test_bar_count) ?? 0, ++seq));
    const used = parseJson<Record<string, number | string | boolean | null>>(fold.parameters);
    if (used) {
      parameters.push({
        seq: ++seq,
        foldIndex,
        parameters: used,
        source: numberOrNull(fold.tuning_trial_count) ? "tuned" : "reviewed_defaults",
        objectiveName: (fold.tuning_objective as CycleParameters["objectiveName"]) ?? null,
        bestTrial: intOrNull(fold.tuning_best_trial),
        bestValue: numberOrNull(fold.tuning_best_value),
        trialCount: intOrNull(fold.tuning_trial_count),
        pinned: plan?.tuning?.pinned ?? [],
      } as CycleParameters);
    }
  }
  const startedAt = startedAtOf(run?.started_at_timestamp, modelId);
  const finishedAt = numberOrNull(run?.finished_at_timestamp);
  const status = run ? archivedStatusOf(run.status) : "complete";
  const orphaned = run ? statusOf(run.status) === "running" : false;
  const barsEvaluated = predictions.length;
  return {
    modelId,
    modelType: run ? `${String(run.model_key)}${CYCLE_RUNNER_SUFFIX}` : CYCLE_RUNNER_SUFFIX.slice(1),
    status,
    startedAt,
    finishedAt: finishedAt === null ? null : finishedAt * 1000,
    error: orphaned ? ORPHANED_RUN_REASON : run && typeof run.error === "string" ? run.error : null,
    lastSequence: seq,
    plan,
    cursor: null,
    bars: barColumnsFrom(bars, predictions),
    trades: trades.map((row) => tradeFrom(row, ++seq)),
    scoreboards: {
      running: null,
      folds: foldBoards,
      final: finalMetrics ? scoreboardFrom("final", null, finalMetrics, barsEvaluated, ++seq) : null,
    },
    epochs: epochs.map((row) => ({
      seq: ++seq,
      foldIndex: intOrNull(row.fold_index),
      trial: intOrNull(row.trial),
      epoch: intOrNull(row.epoch) ?? 0,
      epochCount: intOrNull(row.epoch_count) ?? 0,
      stepUnit: (row.step_unit as CycleEpoch["stepUnit"]) ?? "epoch",
      modelRole: (row.model_role as CycleEpoch["modelRole"]) ?? "direction",
      trainLoss: numberOrNull(row.train_loss),
      validationLoss: numberOrNull(row.validation_loss),
      validationAccuracy: numberOrNull(row.validation_accuracy),
      validationF1Score: numberOrNull(row.validation_f1_score),
      learningRate: numberOrNull(row.learning_rate),
      gradientNorm: numberOrNull(row.gradient_norm),
      isBest: Boolean(row.is_best),
      secondsElapsed: numberOrNull(row.seconds_elapsed) ?? 0,
    }) as CycleEpoch),
    trials: trials.map((row) => ({
      seq: ++seq,
      trial: intOrNull(row.trial) ?? 0,
      trialCount: Math.max(1, trials.filter((t) => t.fold_index === row.fold_index).length),
      state: (row.state as CycleTrial["state"]) ?? "complete",
      parameters: parseJson<Record<string, number | string | boolean>>(row.parameters) ?? {},
      objectiveName: (row.objective_name as CycleTrial["objectiveName"]) ?? "sharpe_ratio",
      objectiveValue: numberOrNull(row.objective_value),
      bestValue: numberOrNull(row.best_value),
      bestTrial: intOrNull(row.best_trial),
      foldIndex: intOrNull(row.fold_index),
    }) as CycleTrial),
    parameters,
    logs: [{
      seq: null, level: "info", receivedAt: Date.now(),
      message: `[archive] rebuilt ${modelId} from the lake record (s3://derived/model_cycle_runs/recipe=${recipe}/); terminal lines are not landed`,
    }],
  };
}
