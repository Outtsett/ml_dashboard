/**
 * The body of GET /api/studies/chart-cnn-arithmetic-patterns, shared by the
 * handler and the page, plus the small pure helpers both use.
 *
 * The study reads the control round landed by
 * packages/ml-engine/src/studies/chart_cnn_arithmetic_patterns/build.py: the SAME 48-bar chart
 * images and the SAME network as the direction experiment, but the label is an
 * arithmetic candle pattern (a pure function of the last one to three bars)
 * instead of the barrier direction. If the network reads these near-perfectly,
 * the direction result near 0.50 is a statement about the market.
 */

/** The 17 arithmetic patterns, in the order of the network's output head (patterns.py NAMES). */
export const PATTERN_NAMES = [
  "doji", "hammer", "shooting_star", "bull_marubozu", "bear_marubozu", "spinning_top", "wide_range_bar",
  "bull_engulfing", "bear_engulfing", "inside_bar", "outside_bar", "bull_harami", "bear_harami",
  "morning_star", "evening_star", "three_soldiers", "three_crows",
] as const;

export type PatternName = (typeof PATTERN_NAMES)[number];

export const DEFAULT_PATTERN: PatternName = "doji";
export const DEFAULT_TAG = "mnq5m";

/** The lake views this study reads (the last two belong to the direction-null-result study: the pairing). */
export const ARITHMETIC_VIEWS = {
  patternScores: "derived_study_chart_cnn_arithmetic_patterns_pattern_scores",
  windowScores: "derived_study_chart_cnn_arithmetic_patterns_window_scores",
} as const;

export const DIRECTION_VIEW = "derived_study_chart_cnn_direction_null_result_model_results";

/** The recipe each dataset tag lands under: `arithmetic_<tag>`. */
export function recipeForTag(tag: string): string {
  return `arithmetic_${tag}`;
}

export function scoreColumn(pattern: string): string {
  return `network_score_${pattern}`;
}

export function labelColumn(pattern: string): string {
  return `arithmetic_label_${pattern}`;
}

/** One row of pattern_results_<tag>.csv, full-word columns, plus the rule in words. */
export interface PatternScoreRow {
  pattern_name: string;
  pattern_bar_count: number;
  rule_in_words: string;
  window_count: number;
  positive_window_count: number;
  prevalence: number;
  area_under_curve: number;
  average_precision: number;
}

export interface MonthCount {
  month: string;
  window_count: number;
}

/** The direction experiment's 2D-image row for the same dataset tag (same images, same split), when landed. */
export interface DirectionPairing {
  testObservationCount: number;
  areaUnderCurve: number;
  intervalLow: number;
  intervalHigh: number;
  baseUpRate: number;
}

export interface OverviewBody {
  part: "overview";
  /** Dataset tags landed (recipes `arithmetic_<tag>`), the notebook's dropdown. */
  tags: string[];
  tag: string;
  patterns: PatternScoreRow[];
  windowCount: number;
  firstWindowTime: string | null;
  lastWindowTime: string | null;
  monthlyWindowCounts: MonthCount[];
  /** A hash-ordered sample of the windows frame (every column), columnar: names once. */
  windowSample: { columns: string[]; rows: Array<Array<number | string | null>> };
  direction: DirectionPairing | null;
}

export interface RocPoint {
  threshold: number;
  falsePositiveRate: number;
  truePositiveRate: number;
}

export interface ThresholdCounts {
  threshold: number;
  truePositives: number;
  falsePositives: number;
}

export interface ScoreGroup {
  group: number;
  windowCount: number;
  positiveFraction: number;
  lowestScore: number;
  highestScore: number;
}

export interface HistogramCount {
  bin: number;
  lower: number;
  upper: number;
  positives: number;
  negatives: number;
}

export interface ScoreSummary {
  count: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  skewness: number | null;
  kurtosis: number | null;
  percentile25: number | null;
  percentile75: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface PatternBody {
  part: "pattern";
  tag: string;
  pattern: string;
  ruleInWords: string;
  patternBarCount: number;
  windowCount: number;
  positiveWindowCount: number;
  /** AUC and AP recomputed in SQL from the stored scores (null when the pattern never fires). */
  areaUnderCurve: number | null;
  averagePrecision: number | null;
  roc: RocPoint[];
  thresholds: ThresholdCounts[];
  groups: ScoreGroup[];
  histogram: HistogramCount[];
  positiveScores: ScoreSummary;
  negativeScores: ScoreSummary;
}

export type ArithmeticBody = OverviewBody | PatternBody;

/**
 * The sizes numpy.array_split gives `count` items cut into `groups` pieces:
 * the first `count % groups` pieces hold one extra. The notebook's deciles
 * are this with groups = 10 over the score-sorted windows.
 */
export function arraySplitSizes(count: number, groups: number): number[] {
  const effective = Math.max(1, Math.min(groups, count));
  const base = Math.floor(count / effective);
  const extra = count % effective;
  return Array.from({ length: effective }, (_, index) => (index < extra ? base + 1 : base));
}

/** The 0-based group of the item at 0-based sorted position `index` under numpy.array_split. */
export function arraySplitGroup(index: number, count: number, groups: number): number {
  const effective = Math.max(1, Math.min(groups, count));
  const base = Math.floor(count / effective);
  const extra = count % effective;
  const boundary = extra * (base + 1);
  if (index < boundary) return Math.floor(index / (base + 1));
  return base === 0 ? extra - 1 : extra + Math.floor((index - boundary) / base);
}

/** Mean, median and how many clear a cut, over the finite AUCs: the page's headline. */
export function recognitionHeadline(rows: readonly PatternScoreRow[], cut = 0.95) {
  const scored = rows.map((row) => row.area_under_curve).filter((value) => Number.isFinite(value));
  const sorted = [...scored].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length === 0 ? null : sorted.length % 2 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return {
    scoredCount: scored.length,
    meanAreaUnderCurve: scored.length === 0 ? null : scored.reduce((sum, value) => sum + value, 0) / scored.length,
    medianAreaUnderCurve: median,
    minimumAreaUnderCurve: sorted[0] ?? null,
    maximumAreaUnderCurve: sorted[sorted.length - 1] ?? null,
    aboveCutCount: scored.filter((value) => value > cut).length,
  };
}

/** Average precision divided by prevalence: how many times better than a random score the top-ranked windows are. */
export function precisionLift(row: Pick<PatternScoreRow, "average_precision" | "prevalence">): number | null {
  return row.prevalence > 0 && Number.isFinite(row.average_precision) ? row.average_precision / row.prevalence : null;
}

/** Pattern name as words for a label: "bull_engulfing" becomes "bull engulfing". */
export function patternLabel(name: string): string {
  return name.replace(/_/g, " ");
}
