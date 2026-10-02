/**
 * The Analytics page contract: four layers over one symbol and timeframe.
 *
 *   descriptive   — what is happening   (summarise and visualise the data)
 *   diagnostic    — why is it happening (root causes of the large moves)
 *   predictive    — what will happen    (outcomes and their probabilities)
 *   prescriptive  — what should we do   (the best action for a chosen goal)
 *
 * Every layer covers the market (bars, news scored by FinBERT) and the Model
 * Cycle runs on the same symbol. Times are epoch milliseconds in the chart's
 * stamping (futures: Pacific wall clock stored as UTC; forex: true UTC).
 */

import type { LensEightNumberSummary } from "../lens/types";

export type EightNumberSummary = LensEightNumberSummary;

export interface AnalyticsBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AnalyticsNewsItem {
  articleId: string;
  title: string;
  /** First time the article was known, epoch ms, in the chart's stamping. */
  seenAt: number;
  /** FinBERT score, p(positive) - p(negative), in [-1, 1]; null when unscored. */
  score: number | null;
}

/** The pricing of one round trip, from `packages/config/cost_model.json`; null for forex. */
export interface AnalyticsCost {
  pointValueUsd: number;
  roundTripCostUsd: number;
  roundTripCostPoints: number;
  tickSize: number;
  source: string;
}

export interface ModelRunSummary {
  modelId: string;
  recipe: string;
  modelLabel: string;
  timeframe: string;
  status: string;
  startedAt: number | null;
  netProfitUsd: number | null;
  winRate: number | null;
  accuracy: number | null;
  sharpeRatio: number | null;
  maximumDrawdownUsd: number | null;
  tradeCount: number | null;
}

export interface ModelSegmentRow {
  segmentKind: "side" | "exit_reason" | "entry_confidence";
  segmentValue: string;
  tradeCount: number | null;
  winRate: number | null;
  expectancyUsd: number | null;
  netProfitUsd: number | null;
}

export interface ModelCalibrationBin {
  probabilityLower: number;
  probabilityUpper: number;
  scoredBarCount: number;
  meanProbabilityUp: number | null;
  observedUpFraction: number | null;
}

export interface ModelHourRow {
  hour: number;
  netProfitUsd: number;
  exposedBarCount: number;
}

/** What the most recent run on the symbol recorded, read back from the lake. */
export interface ModelRunDetail {
  run: ModelRunSummary;
  segments: ModelSegmentRow[];
  calibration: ModelCalibrationBin[];
  hours: ModelHourRow[];
  lastPrediction: { timestamp: number; probabilityUp: number } | null;
}

// ── descriptive ────────────────────────────────────────────────────────────

export interface HistogramBin {
  lower: number;
  upper: number;
  count: number;
}

export interface HourProfileRow {
  hour: number;
  barCount: number;
  meanReturnPercent: number | null;
  meanAbsoluteReturnPercent: number | null;
  meanVolume: number | null;
}

export interface SessionDayRow {
  day: string;
  open: number;
  close: number;
  high: number;
  low: number;
  returnPercent: number;
  rangePoints: number;
  volume: number;
  articleCount: number;
  meanSentiment: number | null;
}

export interface Descriptive {
  firstBar: number;
  lastBar: number;
  barCount: number;
  lastClose: number;
  windowChangePoints: number;
  windowChangePercent: number;
  lastDayChangePercent: number | null;
  /** Bar-to-bar log returns in percent, gaps excluded. */
  returnPercent: EightNumberSummary;
  rangePoints: EightNumberSummary;
  volume: EightNumberSummary;
  returnHistogram: HistogramBin[];
  closeSeries: Array<{ timestamp: number; close: number }>;
  hourProfile: HourProfileRow[];
  sessionDays: SessionDayRow[];
  news: {
    articleCount: number;
    daysWithNews: number;
    meanSentiment: number | null;
    latest: AnalyticsNewsItem[];
  };
  runs: ModelRunSummary[];
}

// ── diagnostic ─────────────────────────────────────────────────────────────

export type CauseName = "session_gap" | "news" | "session_open" | "volume_surge" | "no_recorded_cause";

export interface MoveEvent {
  timestamp: number;
  returnPercent: number;
  /** The move in trailing standard deviations (100 bars, causal). */
  zScore: number;
  cause: CauseName;
  evidence: string[];
  gapMinutes: number | null;
  volumeRatio: number | null;
  newsCount: number;
  newsMeanSentiment: number | null;
  headline: string | null;
}

export interface CauseShare {
  cause: CauseName;
  eventCount: number;
  share: number;
}

export interface LiftRow {
  key: string;
  barCount: number;
  largeMoveCount: number;
  /** P(large move | key) / P(large move). 1 = no different from any bar. */
  lift: number | null;
  meanAbsoluteReturnPercent: number | null;
}

export interface Diagnostic {
  zThreshold: number;
  eventCount: number;
  largestMoves: MoveEvent[];
  causes: CauseShare[];
  hourLift: LiftRow[];
  weekdayLift: LiftRow[];
  newsEffect: {
    /** Only bars on days the news record covers. */
    coveredBarCount: number;
    afterNews: { barCount: number; meanAbsoluteReturnPercent: number | null };
    withoutNews: { barCount: number; meanAbsoluteReturnPercent: number | null };
    ratio: number | null;
    /** Why there is no ratio, when there is none. */
    note: string | null;
  };
  model: ModelRunDetail | null;
}

// ── predictive ─────────────────────────────────────────────────────────────

export type VolatilityRegime = "high" | "low";
export type TrendRegime = "up" | "down";

export interface Probability {
  value: number | null;
  low: number | null;
  high: number | null;
  count: number;
  total: number;
  /** The independent observations the interval is computed on: overlapping
   *  forward windows of `horizon` bars share bars, so total / horizon. */
  effectiveTotal: number;
}

export interface OutcomeDistribution {
  label: string;
  sampleCount: number;
  probabilityUp: Probability;
  probabilityBeatsCostUp: Probability;
  probabilityBeatsCostDown: Probability;
  probabilityLargeUp: Probability;
  probabilityLargeDown: Probability;
  /** Forward move in points: 10th, 25th, 50th, 75th, 90th percentiles. */
  quantilesPoints: { p10: number | null; p25: number | null; p50: number | null; p75: number | null; p90: number | null };
  meanPoints: number | null;
  histogram: HistogramBin[];
}

export interface Predictive {
  horizonBars: number;
  asOf: number;
  state: { volatility: VolatilityRegime | null; trend: TrendRegime | null; label: string };
  /** The move counted as large: one standard deviation of the forward move. */
  largeMovePoints: number | null;
  costPoints: number | null;
  current: OutcomeDistribution;
  unconditional: OutcomeDistribution;
  byState: OutcomeDistribution[];
  model: {
    modelId: string;
    modelLabel: string;
    probabilityUp: number;
    timestamp: number;
    calibratedUpFraction: number | null;
    calibrationBin: string | null;
  } | null;
}

// ── prescriptive ───────────────────────────────────────────────────────────

export type Goal = "profit" | "win_rate" | "risk";
export type ActionName = "long" | "short" | "flat";

export interface ActionOutcome {
  action: ActionName;
  expectedNetUsd: number | null;
  expectedNetPoints: number | null;
  probabilityProfit: Probability;
  downsideP10Usd: number | null;
  upsideP90Usd: number | null;
  /** Expected net divided by the size of the 10th-percentile loss. */
  rewardToRisk: number | null;
  /** Half-Kelly fraction of risk capital, 0-0.25; null for flat. */
  kellyFraction: number | null;
}

export interface GoalRecommendation {
  goal: Goal;
  action: ActionName;
  reason: string;
  run: { modelId: string; modelLabel: string; metric: string; value: number | null } | null;
  confidenceBuckets: { keep: string[]; skip: string[] };
  hoursToAvoid: number[];
}

export interface Prescriptive {
  horizonBars: number;
  /** The last bar the state is read from. */
  asOf: number;
  costPriced: boolean;
  actions: ActionOutcome[];
  recommendations: GoalRecommendation[];
  caveats: string[];
}

export interface AnalyticsResponse {
  symbol: string;
  timeframe: string;
  assetClass: "futures" | "forex";
  clock: string;
  cost: AnalyticsCost | null;
  descriptive: Descriptive;
  diagnostic: Diagnostic;
  predictive: Predictive;
  prescriptive: Prescriptive;
  notes: string[];
}

export const GOAL_LABEL: Record<Goal, string> = {
  profit: "Most expected profit per trade",
  win_rate: "Highest chance a trade wins",
  risk: "Best reward for the risk taken",
};

export const CAUSE_LABEL: Record<CauseName, string> = {
  session_gap: "Reopen after a gap",
  news: "News",
  session_open: "Session open",
  volume_surge: "Volume surge",
  no_recorded_cause: "No recorded cause",
};
