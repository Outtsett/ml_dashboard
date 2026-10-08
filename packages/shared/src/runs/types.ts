/**
 * The run page's contract: one compact view of a Model Cycle run, built on the
 * server from the run's snapshot (live accumulator or the lake record) and read
 * by the `/training` page and by any external client (`GET /api/runs/:id`).
 *
 * It carries no bars: the chart of the run lives on the Market page. What is
 * here is what answers "how is this run doing and what is wrong with it".
 */
import type { CycleGateRouting, CycleLogLine, CycleLossSurface, CyclePhase, CycleRegimeForecast, CycleRunStatus, CycleTrial } from "../cycle/schema";

/** The six fixed sections every run page shows, in this order. */
export const RUN_CATEGORIES = ["configuration", "learning", "prediction", "trading", "tuning", "folds", "verdict"] as const;
export type RunCategory = (typeof RUN_CATEGORIES)[number];

export const RUN_CATEGORY_LABELS: Record<RunCategory, string> = {
  verdict: "Verdict",
  configuration: "Configuration",
  learning: "Learning",
  prediction: "Prediction quality",
  trading: "Trading result",
  tuning: "Hyperparameter search",
  folds: "Fold stability",
};

/** What each section answers, shown under its heading. */
export const RUN_CATEGORY_QUESTIONS: Record<RunCategory, string> = {
  verdict: "What is wrong with this run, and what to change.",
  configuration: "Every setting this run was given, and what each fold actually used.",
  learning: "Is the model learning, or memorising the training bars?",
  prediction: "Are its calls better than always guessing the common direction?",
  trading: "Did the calls make money after costs?",
  tuning: "Did the search find settings that beat the defaults?",
  folds: "Does the result hold in every test window, or in one?",
};

export type VerdictSeverity = "critical" | "warning" | "pass";

export interface RunVerdict {
  /** Stable rule id, e.g. `one_direction`. */
  rule: string;
  severity: VerdictSeverity;
  category: Exclude<RunCategory, "verdict" | "configuration">;
  /** The finding in one blunt sentence. */
  title: string;
  /** The measured numbers the finding rests on. */
  evidence: string;
  /** What to change. Empty for a pass. */
  action: string;
}

export type RunMetricUnit = "usd" | "ratio" | "fraction" | "count" | "points" | "loss";

export interface RunMetricTile {
  name: string;
  label: string;
  category: Exclude<RunCategory, "verdict" | "configuration">;
  value: number | null;
  unit: RunMetricUnit;
  /** Which way is good; `none` for a count or a baseline. */
  better: "higher" | "lower" | "none";
  /** The value this metric has to beat to mean anything, with what it is. */
  baseline: { value: number; label: string } | null;
}

/** One training step of a fold's final fit (never a tuning trial's fit). */
export interface RunEpochPoint {
  foldIndex: number;
  modelRole: "direction" | "price";
  step: number;
  trainLoss: number | null;
  validationLoss: number | null;
  validationAccuracy: number | null;
  validationF1Score: number | null;
  learningRate: number | null;
  gradientNorm: number | null;
  /** The step whose weights the fold kept. */
  isBest: boolean;
  secondsElapsed: number;
}

/** A fold's loss surface as the engine sent it (`cycle_loss_surface`), without the envelope. */
export type RunLossSurface = Omit<CycleLossSurface, "seq" | "ts">;
/** A fold's gate routing as the engine sent it (`cycle_gate_routing`), without the envelope. */
export type RunGateRouting = Omit<CycleGateRouting, "seq" | "ts">;
/** A fold's regime forecasts as the engine sent them (`cycle_regime_forecast`, stretches merged), without the envelope. */
export type RunRegimeForecast = Omit<CycleRegimeForecast, "seq" | "ts" | "run_id">;

export interface RunFoldRow {
  foldIndex: number;
  metrics: Record<string, number | null>;
}

export interface RunDailyRow {
  sessionDay: string;
  foldIndex: number | null;
  netProfitUsd: number | null;
  cumulativeNetProfitUsd: number | null;
  accuracy: number | null;
  tradeCount: number | null;
}

export interface RunCalibrationBin {
  binNumber: number;
  probabilityLower: number;
  probabilityUpper: number;
  scoredBarCount: number;
  meanProbabilityUp: number | null;
  observedUpFraction: number | null;
}

export interface RunConfusionCell {
  actualDirection: string;
  predictedDirection: string;
  barCount: number;
  shareOfScoredBars: number | null;
}

export interface RunProgress {
  phase: CyclePhase;
  foldIndex: number | null;
  foldCount: number;
  trial: number | null;
  trialCount: number | null;
  overallFraction: number;
  elapsedSeconds: number;
}

export interface RunSetup {
  modelLabel: string;
  /** What the run is and does, in one line (`runPurpose`). */
  purpose: string;
  modelFamily: string;
  symbol: string;
  timeframe: string;
  device: string;
  barCount: number;
  featureCount: number;
  foldCount: number;
  labelHorizonBars: number;
  tuningTrialCount: number;
  tuningObjective: string | null;
  dataStart: number;
  dataEnd: number;
}

/** One parameter value as a run records it. */
export type RunParameterValue = number | string | boolean | null;

/** What a fold's models were fitted with, and how that was chosen (`cycle_parameters`). */
export interface RunFoldConfiguration {
  foldIndex: number;
  parameters: Record<string, RunParameterValue>;
  source: "tuned" | "manual" | "reviewed_defaults";
  objectiveName: string | null;
  bestTrial: number | null;
  bestValue: number | null;
  trialCount: number | null;
  pinned: string[];
}

/** Everything the run was given, from its plan, plus what each fold used. */
export interface RunConfiguration {
  /** The model's base hyperparameters as the run started (before any fold's search). */
  parameters: Record<string, RunParameterValue>;
  /** The run's own settings: label, purge and embargo, trading rule, tuning budget, device, data window. */
  settings: Record<string, RunParameterValue>;
  costModel: Record<string, RunParameterValue>;
  featureNames: string[];
  folds: RunFoldConfiguration[];
}

export interface RunView {
  id: string;
  /** `brisk-heron-41`: the run's memorable name, derived from its id. */
  name: string;
  /** Its ordinal among runs of the same model on the same symbol and timeframe, oldest = 1. */
  version: number | null;
  modelType: string;
  status: CycleRunStatus;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  setup: RunSetup | null;
  configuration: RunConfiguration | null;
  /** The run this one was relaunched from, when it was. */
  lineage: { parentRunId: string; parentName: string } | null;
  progress: RunProgress | null;
  /** Which scoreboard the tiles come from: the finished run's, or the one still accumulating. */
  scoreScope: "final" | "running" | null;
  barsEvaluated: number;
  tiles: RunMetricTile[];
  /** Every scoreboard metric of the run, by name, as the engine scored it. */
  metrics: Record<string, number | null>;
  verdicts: RunVerdict[];
  epochs: RunEpochPoint[];
  /** One per final neural fit; empty for a tree or linear model, which has no weights to perturb. */
  lossSurfaces: RunLossSurface[];
  /** One per fold of a mixture of experts; empty for every other kind. */
  gateRoutings: RunGateRouting[];
  /** One per fold of a regime Monte Carlo decision model; empty for every other kind. */
  regimeForecasts: RunRegimeForecast[];
  trials: CycleTrial[];
  folds: RunFoldRow[];
  daily: RunDailyRow[];
  calibration: RunCalibrationBin[];
  confusion: RunConfusionCell[];
  /** Lines after the client's last one, or the tail when the client's place was lost. */
  logs: CycleLogLine[];
  logsReset: boolean;
}

/** One row of the run list (`GET /api/runs`). */
export interface RunListItem {
  id: string;
  name: string;
  version: number;
  /** What the run is and does, in one line; empty when the run recorded no plan. */
  purpose: string;
  modelType: string;
  modelFamily: string | null;
  symbol: string | null;
  timeframe: string | null;
  status: CycleRunStatus;
  startedAt: number;
  finishedAt: number | null;
  sharpeRatio: number | null;
  tradeCount: number;
}

/** One launchable model (`GET /api/runs/models`). */
export interface RunnableModel {
  key: string;
  runnerKey: string;
  displayName: string;
  kind: string;
  category: string;
  speed: string | null;
  estimatedTrainingTime: string | null;
}

/** Body of `POST /api/runs`. `model` is a key, a runner key or a display name. */
export interface StartRunRequest {
  /** Relaunch a recorded run: its model, series, window and base parameters, with any field below overriding. */
  from?: string;
  model?: string;
  symbol?: string;
  timeframe?: string;
  dateStart?: string;
  dateEnd?: string;
  /** Any Model Cycle parameter, e.g. `{ "tuning_budget_trials": 5, "fold_limit": 2 }`. */
  parameters?: Record<string, number | string | boolean>;
}

export interface StartRunResponse {
  runId: string;
  name: string;
  modelType: string;
  /** The page that shows this run. */
  url: string;
}
