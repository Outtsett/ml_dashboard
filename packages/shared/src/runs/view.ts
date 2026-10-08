/**
 * Build the run page's view from a Model Cycle snapshot (and, when the lake has
 * them, the run's report tables). Pure: the server calls it for
 * `GET /api/runs/:id`, the tests call it on fixtures.
 */
import type { CycleLogLine, CycleSnapshot } from "../cycle/schema";
import type {
  RunCalibrationBin,
  RunConfusionCell,
  RunDailyRow,
  RunEpochPoint,
  RunConfiguration,
  RunFoldRow,
  RunGateRouting,
  RunRegimeForecast,
  RunLossSurface,
  RunMetricTile,
  RunMetricUnit,
  RunView,
} from "./types";
import { COIN_FLIP_BRIER_SCORE, COIN_FLIP_LOG_LOSS, MINIMUM_TRADE_COUNT, judgeRun } from "./verdicts";
import { runName, runPurpose } from "./naming";

/** The report tables this view reads, as `loadCycleReport` serves them (camel-cased rows). */
export interface RunReportTables {
  dailyResults?: ReadonlyArray<Record<string, unknown>>;
  calibrationBins?: ReadonlyArray<Record<string, unknown>>;
  confusionMatrix?: ReadonlyArray<Record<string, unknown>>;
}

interface TileSpec {
  name: string;
  label: string;
  category: RunMetricTile["category"];
  unit: RunMetricUnit;
  better: RunMetricTile["better"];
  /** A fixed baseline, or the name of the metric that is the baseline. */
  baseline?: { value: number; label: string } | { metric: string; label: string };
}

/** The headline numbers of each section, in display order. Every one is a scoreboard metric. */
export const TILE_SPECS: readonly TileSpec[] = [
  { name: "accuracy", label: "Accuracy", category: "prediction", unit: "fraction", better: "higher", baseline: { metric: "majority_class_accuracy", label: "always the common direction" } },
  { name: "balanced_accuracy", label: "Balanced accuracy", category: "prediction", unit: "fraction", better: "higher", baseline: { value: 0.5, label: "no skill" } },
  { name: "roc_auc", label: "ROC AUC", category: "prediction", unit: "ratio", better: "higher", baseline: { value: 0.5, label: "random ordering" } },
  { name: "log_loss", label: "Log loss", category: "prediction", unit: "loss", better: "lower", baseline: { value: COIN_FLIP_LOG_LOSS, label: "always 50%" } },
  { name: "brier_score", label: "Brier score", category: "prediction", unit: "loss", better: "lower", baseline: { value: COIN_FLIP_BRIER_SCORE, label: "always 50%" } },
  { name: "price_forecast_skill", label: "Price forecast skill", category: "prediction", unit: "fraction", better: "higher", baseline: { value: 0, label: "copying the last close" } },
  { name: "net_profit_usd", label: "Net profit", category: "trading", unit: "usd", better: "higher", baseline: { metric: "buy_and_hold_net_profit_usd", label: "buy and hold" } },
  { name: "sharpe_ratio", label: "Sharpe ratio", category: "trading", unit: "ratio", better: "higher", baseline: { value: 0, label: "break even" } },
  { name: "maximum_drawdown_usd", label: "Worst drawdown", category: "trading", unit: "usd", better: "lower" },
  { name: "profit_factor", label: "Profit factor", category: "trading", unit: "ratio", better: "higher", baseline: { value: 1, label: "break even" } },
  { name: "win_rate", label: "Win rate", category: "trading", unit: "fraction", better: "higher" },
  { name: "trade_count", label: "Closed trades", category: "trading", unit: "count", better: "none", baseline: { value: MINIMUM_TRADE_COUNT, label: "minimum to judge" } },
  { name: "total_cost_usd", label: "Costs paid", category: "trading", unit: "usd", better: "lower" },
  { name: "exposure_fraction", label: "Time in market", category: "trading", unit: "fraction", better: "none" },
];

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function tilesOf(metrics: Record<string, number | null>, every = false): RunMetricTile[] {
  const tiles: RunMetricTile[] = [];
  for (const spec of TILE_SPECS) {
    if (!every && !(spec.name in metrics)) continue;
    let baseline: RunMetricTile["baseline"] = null;
    if (spec.baseline) {
      if ("metric" in spec.baseline) {
        const value = numberOrNull(metrics[spec.baseline.metric]);
        if (value !== null) baseline = { value, label: spec.baseline.label };
      } else {
        baseline = spec.baseline;
      }
    }
    tiles.push({
      name: spec.name,
      label: spec.label,
      category: spec.category,
      value: numberOrNull(metrics[spec.name]),
      unit: spec.unit,
      better: spec.better,
      baseline,
    });
  }
  return tiles;
}

/** A fold's final fits only: a tuning trial's curve is one of many candidates, not what the fold used. */
export function finalFitEpochs(snapshot: Pick<CycleSnapshot, "epochs">): RunEpochPoint[] {
  const points: RunEpochPoint[] = [];
  for (const epoch of snapshot.epochs) {
    if (epoch.trial !== null && epoch.trial !== undefined) continue;
    points.push({
      foldIndex: epoch.foldIndex ?? 0,
      modelRole: epoch.modelRole ?? "direction",
      step: epoch.epoch,
      trainLoss: epoch.trainLoss,
      validationLoss: epoch.validationLoss,
      validationAccuracy: epoch.validationAccuracy,
      validationF1Score: epoch.validationF1Score ?? null,
      learningRate: epoch.learningRate ?? null,
      gradientNorm: epoch.gradientNorm ?? null,
      isBest: epoch.isBest === true,
      secondsElapsed: epoch.secondsElapsed ?? 0,
    });
  }
  return points;
}

/** Everything the run was given (its plan) and what each fold fitted with (`cycle_parameters`). */
export function configurationOf(snapshot: Pick<CycleSnapshot, "plan" | "parameters">): RunConfiguration | null {
  const plan = snapshot.plan;
  if (!plan) return null;
  const tuning = plan.tuning;
  return {
    parameters: { ...plan.parameters },
    settings: {
      symbol: plan.symbol,
      timeframe: plan.timeframe,
      data_start: new Date(plan.dataStart * 1000).toISOString().slice(0, 10),
      data_end: new Date(plan.dataEnd * 1000).toISOString().slice(0, 10),
      bar_count: plan.barCount,
      fold_count: plan.folds.length,
      label_horizon_bars: plan.labelHorizonBars,
      label_kind: plan.labelKind ?? "direction",
      label_threshold_ticks: plan.labelThresholdTicks,
      label_gap_multiple: plan.labelGapMultiple ?? null,
      purge_bars: plan.purgeBars,
      embargo_bars: plan.embargoBars,
      direction_mode: plan.directionMode ?? null,
      has_price_model: plan.hasPriceModel ?? null,
      long_only: plan.trading.longOnly,
      holding_bars: plan.trading.holdingBars,
      stop_loss_ticks: plan.trading.stopLossTicks,
      take_profit_ticks: plan.trading.takeProfitTicks,
      contracts: plan.trading.contracts,
      tuning_mode: tuning?.mode ?? (tuning ? "tuned" : "reviewed_defaults"),
      tuning_objective: tuning?.objective ?? null,
      tuning_trial_count: tuning?.trialCount ?? 0,
      tuning_budget_seconds: tuning?.budgetSeconds ?? null,
      tuning_inner_fold_count: tuning?.innerFoldCount ?? null,
      tuning_pinned: tuning?.pinned?.join(", ") ?? "",
      price_adjustment: plan.priceAdjustment?.method ?? "none",
      device: plan.deviceName ?? plan.device,
      bars_per_second: plan.barsPerSecond,
    },
    costModel: { ...plan.costModel },
    featureNames: [...plan.featureNames],
    folds: (snapshot.parameters ?? [])
      .map((entry) => ({
        foldIndex: entry.foldIndex ?? 0,
        parameters: { ...entry.parameters },
        source: entry.source,
        objectiveName: entry.objectiveName ?? null,
        bestTrial: entry.bestTrial ?? null,
        bestValue: entry.bestValue ?? null,
        trialCount: entry.trialCount ?? null,
        pinned: [...entry.pinned],
      }))
      .sort((a, b) => a.foldIndex - b.foldIndex),
  };
}

/** The gate routings without their wire envelope, in fold order. */
export function gateRoutingsOf(snapshot: Pick<CycleSnapshot, "gateRoutings">): RunGateRouting[] {
  return (snapshot.gateRoutings ?? [])
    .map(({ seq: _seq, ts: _ts, ...routing }) => routing)
    .sort((a, b) => (a.foldIndex ?? 0) - (b.foldIndex ?? 0));
}

/** The regime forecasts without their wire envelope, in fold order. */
export function regimeForecastsOf(snapshot: Pick<CycleSnapshot, "regimeForecasts">): RunRegimeForecast[] {
  return (snapshot.regimeForecasts ?? [])
    .map(({ seq: _seq, ts: _ts, run_id: _runId, ...forecast }) => forecast)
    .sort((a, b) => (a.foldIndex ?? 0) - (b.foldIndex ?? 0));
}

/** The surfaces without their wire envelope, in fold order then role. */
export function lossSurfacesOf(snapshot: Pick<CycleSnapshot, "lossSurfaces">): RunLossSurface[] {
  return (snapshot.lossSurfaces ?? [])
    .map(({ seq: _seq, ts: _ts, ...surface }) => surface)
    .sort((a, b) => (a.foldIndex ?? 0) - (b.foldIndex ?? 0) || a.modelRole.localeCompare(b.modelRole));
}

function runScopeRows(rows: ReadonlyArray<Record<string, unknown>> | undefined): Record<string, unknown>[] {
  return (rows ?? []).filter((row) => row.scope === "run" || row.scope === undefined);
}

function dailyOf(report: RunReportTables | null): RunDailyRow[] {
  return (report?.dailyResults ?? [])
    .map((row) => ({
      sessionDay: String(row.sessionDay ?? ""),
      foldIndex: numberOrNull(row.foldIndex),
      netProfitUsd: numberOrNull(row.netProfitUsd),
      cumulativeNetProfitUsd: numberOrNull(row.cumulativeNetProfitUsd),
      accuracy: numberOrNull(row.accuracy),
      tradeCount: numberOrNull(row.tradeCount),
    }))
    .filter((row) => row.sessionDay.length > 0)
    .sort((a, b) => a.sessionDay.localeCompare(b.sessionDay));
}

function calibrationOf(report: RunReportTables | null): RunCalibrationBin[] {
  return runScopeRows(report?.calibrationBins)
    .map((row) => ({
      binNumber: numberOrNull(row.binNumber) ?? 0,
      probabilityLower: numberOrNull(row.probabilityLower) ?? 0,
      probabilityUpper: numberOrNull(row.probabilityUpper) ?? 0,
      scoredBarCount: numberOrNull(row.scoredBarCount) ?? 0,
      meanProbabilityUp: numberOrNull(row.meanProbabilityUp),
      observedUpFraction: numberOrNull(row.observedUpFraction),
    }))
    .sort((a, b) => a.binNumber - b.binNumber);
}

function confusionOf(report: RunReportTables | null): RunConfusionCell[] {
  return runScopeRows(report?.confusionMatrix).map((row) => ({
    actualDirection: String(row.actualDirection ?? ""),
    predictedDirection: String(row.predictedDirection ?? ""),
    barCount: numberOrNull(row.barCount) ?? 0,
    shareOfScoredBars: numberOrNull(row.shareOfScoredBars),
  }));
}

/** The client's place in the terminal: the last line it holds. */
export interface LogCursor {
  receivedAt: number;
  seq: number | null;
}

/** How many lines a client that lost its place (or has none) is sent. */
export const LOG_TAIL_LINES = 2000;

/**
 * The lines after the client's last one. The server's buffer is a ring, so a
 * position by count would drift once it is full; the last line itself is the
 * cursor, found from the end. A cursor that is no longer in the buffer gets the
 * tail and `reset`, and the client replaces what it holds.
 */
export function logsAfter(logs: readonly CycleLogLine[], cursor: LogCursor | null): { lines: CycleLogLine[]; reset: boolean } {
  if (cursor === null) return { lines: logs.slice(-LOG_TAIL_LINES), reset: true };
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const line = logs[index]!;
    if (line.receivedAt === cursor.receivedAt && line.seq === cursor.seq) {
      return { lines: logs.slice(index + 1), reset: false };
    }
    if (line.receivedAt < cursor.receivedAt) break;
  }
  return { lines: logs.slice(-LOG_TAIL_LINES), reset: true };
}

/**
 * The page's shape with nothing in it: every section, every tile and readout at
 * "—", so the analytics are on screen before a run exists and fill in as one runs.
 */
export function emptyRunView(): RunView {
  return {
    id: "",
    name: "No run yet",
    version: null,
    modelType: "",
    status: "complete",
    error: null,
    startedAt: 0,
    finishedAt: null,
    setup: null,
    configuration: null,
    lineage: null,
    progress: null,
    scoreScope: null,
    barsEvaluated: 0,
    tiles: tilesOf({}, true),
    metrics: {},
    verdicts: [],
    epochs: [],
    lossSurfaces: [],
    gateRoutings: [],
    regimeForecasts: [],
    trials: [],
    folds: [],
    daily: [],
    calibration: [],
    confusion: [],
    logs: [],
    logsReset: true,
  };
}

export function buildRunView(
  snapshot: CycleSnapshot,
  report: RunReportTables | null,
  cursor: LogCursor | null,
  version: number | null = null,
  lineage: RunView["lineage"] = null,
): RunView {
  const scoreboard = snapshot.scoreboards.final ?? snapshot.scoreboards.running;
  const scoreScope: RunView["scoreScope"] = snapshot.scoreboards.final ? "final" : snapshot.scoreboards.running ? "running" : null;
  const metrics = scoreboard?.metrics ?? {};
  const epochs = finalFitEpochs(snapshot);
  const folds: RunFoldRow[] = snapshot.scoreboards.folds.map((fold) => ({ foldIndex: fold.foldIndex ?? 0, metrics: fold.metrics }));
  const plan = snapshot.plan;
  const tuning = plan?.tuning as { trialCount?: number; objective?: string } | null | undefined;
  const { lines, reset } = logsAfter(snapshot.logs, cursor);

  return {
    id: snapshot.modelId,
    name: runName(snapshot.modelId),
    version,
    modelType: snapshot.modelType,
    status: snapshot.status,
    error: snapshot.error,
    startedAt: snapshot.startedAt,
    finishedAt: snapshot.finishedAt,
    setup: plan
      ? {
          modelLabel: plan.modelLabel,
          purpose: runPurpose({
            modelLabel: plan.modelLabel,
            symbol: plan.symbol,
            timeframe: plan.timeframe,
            directionMode: plan.directionMode ?? null,
            hasPriceModel: plan.hasPriceModel ?? null,
            labelHorizonBars: plan.labelHorizonBars,
            labelKind: plan.labelKind ?? "direction",
            tuningObjective: tuning?.objective ?? null,
            tuningTrialCount: tuning?.trialCount ?? 0,
          }),
          modelFamily: plan.modelFamily,
          symbol: plan.symbol,
          timeframe: plan.timeframe,
          device: plan.deviceName ?? plan.device,
          barCount: plan.barCount,
          featureCount: plan.featureNames.length,
          foldCount: plan.folds.length,
          labelHorizonBars: plan.labelHorizonBars,
          tuningTrialCount: tuning?.trialCount ?? 0,
          tuningObjective: tuning?.objective ?? null,
          dataStart: plan.dataStart,
          dataEnd: plan.dataEnd,
        }
      : null,
    configuration: configurationOf(snapshot),
    lineage,
    progress: snapshot.cursor
      ? {
          phase: snapshot.cursor.phase,
          foldIndex: snapshot.cursor.foldIndex,
          foldCount: snapshot.cursor.foldCount,
          trial: snapshot.cursor.trial,
          trialCount: snapshot.cursor.trialCount,
          overallFraction: snapshot.cursor.overallFraction,
          elapsedSeconds: snapshot.cursor.elapsedSeconds,
        }
      : null,
    scoreScope,
    barsEvaluated: scoreboard?.barsEvaluated ?? 0,
    tiles: tilesOf(metrics),
    metrics,
    verdicts: judgeRun({ status: snapshot.status, error: snapshot.error, metrics, epochs, trials: snapshot.trials, folds }),
    epochs,
    lossSurfaces: lossSurfacesOf(snapshot),
    gateRoutings: gateRoutingsOf(snapshot),
    regimeForecasts: regimeForecastsOf(snapshot),
    trials: snapshot.trials,
    folds,
    daily: dailyOf(report),
    calibration: calibrationOf(report),
    confusion: confusionOf(report),
    logs: lines,
    logsReset: reset,
  };
}
