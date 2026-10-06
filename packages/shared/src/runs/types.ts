/**
 * The run page's contract: one compact view of a Model Cycle run, built on the
 * server from the run's snapshot (live accumulator or the lake record) and read
 * by the `/training` page and by any external client (`GET /api/runs/:id`).
 *
 * It carries no bars: the chart of the run lives on the Market page. What is
 * here is what answers "how is this run doing and what is wrong with it".
 */
import type { CycleLogLine, CyclePhase, CycleRunStatus, CycleTrial } from "../cycle/schema";

/** The six fixed sections every run page shows, in this order. */
export const RUN_CATEGORIES = ["verdict", "learning", "prediction", "trading", "tuning", "folds"] as const;
export type RunCategory = (typeof RUN_CATEGORIES)[number];

export const RUN_CATEGORY_LABELS: Record<RunCategory, string> = {
  verdict: "Verdict",
  learning: "Learning",
  prediction: "Prediction quality",
  trading: "Trading result",
  tuning: "Hyperparameter search",
  folds: "Fold stability",
};

/** What each section answers, shown under its heading. */
export const RUN_CATEGORY_QUESTIONS: Record<RunCategory, string> = {
  verdict: "What is wrong with this run, and what to change.",
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
  category: Exclude<RunCategory, "verdict">;
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
  category: Exclude<RunCategory, "verdict">;
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
}

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
  progress: RunProgress | null;
  /** Which scoreboard the tiles come from: the finished run's, or the one still accumulating. */
  scoreScope: "final" | "running" | null;
  barsEvaluated: number;
  tiles: RunMetricTile[];
  verdicts: RunVerdict[];
  epochs: RunEpochPoint[];
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
  model: string;
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
