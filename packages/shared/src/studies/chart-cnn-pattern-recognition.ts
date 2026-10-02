/**
 * The body of GET /api/studies/chart-cnn-pattern-recognition, shared by the
 * handler and the page, plus the small pure helpers both use.
 *
 * The study reads the chart-CNN round landed by
 * packages/ml-engine/src/studies/chart_cnn_pattern_recognition/build.py:
 * a network trained only on synthetic candles that TA-Lib verifies, scored on
 * 126,624 real MNQ 5-minute windows from 2024 on that it never saw.
 */

/** The 61 TA-Lib patterns the network scores, in the order of its output head. */
export const PATTERN_NAMES = [
  "CDL2CROWS", "CDL3BLACKCROWS", "CDL3INSIDE", "CDL3LINESTRIKE", "CDL3OUTSIDE", "CDL3STARSINSOUTH", "CDL3WHITESOLDIERS",
  "CDLABANDONEDBABY", "CDLADVANCEBLOCK", "CDLBELTHOLD", "CDLBREAKAWAY", "CDLCLOSINGMARUBOZU", "CDLCONCEALBABYSWALL",
  "CDLCOUNTERATTACK", "CDLDARKCLOUDCOVER", "CDLDOJI", "CDLDOJISTAR", "CDLDRAGONFLYDOJI", "CDLENGULFING",
  "CDLEVENINGDOJISTAR", "CDLEVENINGSTAR", "CDLGAPSIDESIDEWHITE", "CDLGRAVESTONEDOJI", "CDLHAMMER", "CDLHANGINGMAN",
  "CDLHARAMI", "CDLHARAMICROSS", "CDLHIGHWAVE", "CDLHIKKAKE", "CDLHIKKAKEMOD", "CDLHOMINGPIGEON", "CDLIDENTICAL3CROWS",
  "CDLINNECK", "CDLINVERTEDHAMMER", "CDLKICKING", "CDLKICKINGBYLENGTH", "CDLLADDERBOTTOM", "CDLLONGLEGGEDDOJI",
  "CDLLONGLINE", "CDLMARUBOZU", "CDLMATCHINGLOW", "CDLMATHOLD", "CDLMORNINGDOJISTAR", "CDLMORNINGSTAR", "CDLONNECK",
  "CDLPIERCING", "CDLRICKSHAWMAN", "CDLRISEFALL3METHODS", "CDLSEPARATINGLINES", "CDLSHOOTINGSTAR", "CDLSHORTLINE",
  "CDLSPINNINGTOP", "CDLSTALLEDPATTERN", "CDLSTICKSANDWICH", "CDLTAKURI", "CDLTASUKIGAP", "CDLTHRUSTING", "CDLTRISTAR",
  "CDLUNIQUE3RIVER", "CDLUPSIDEGAP2CROWS", "CDLXSIDEGAP3METHODS",
] as const;

export type PatternName = (typeof PATTERN_NAMES)[number];

export const DEFAULT_PATTERN: PatternName = "CDLENGULFING";

/** The lake views this study reads. */
export const CHART_CNN_VIEWS = {
  patternScores: "derived_study_chart_cnn_pattern_recognition_pattern_scores",
  windows: "derived_study_chart_cnn_pattern_recognition_windows",
  windowScores: "derived_study_chart_cnn_pattern_recognition_window_scores",
  embeddingProjection: "derived_study_chart_cnn_pattern_recognition_embedding_projection",
  embeddingComponents: "derived_study_chart_cnn_pattern_recognition_embedding_components",
} as const;

/** One row of real_test_results.csv, full-word columns. AUC and AP are null when the pattern never fired. */
export interface PatternScoreRow {
  pattern_name: string;
  pattern_bar_count: number;
  visible_window_count: number;
  positive_window_count: number;
  area_under_curve: number | null;
  average_precision: number | null;
  prevalence: number | null;
}

export interface CountRow {
  value: string;
  window_count: number;
}

/** The embedding sample, columnar so 20,000 points stay small on the wire. */
export interface EmbeddingProjection {
  windowId: number[];
  principalComponent1: number[];
  principalComponent2: number[];
  /** Index into `targets`. */
  target: number[];
  sign: number[];
  barCount: number[];
  /** Target names by index, most frequent in the whole test set first. */
  targets: string[];
  explainedVarianceRatio: number[];
  embeddingDimensionCount: number;
}

export interface OverviewBody {
  part: "overview";
  patterns: PatternScoreRow[];
  windowCount: number;
  firstWindowTime: string | null;
  lastWindowTime: string | null;
  targetCounts: CountRow[];
  signCounts: CountRow[];
  barCountCounts: CountRow[];
  /** A 2,000-window sample of the windows frame, every column, for the per-column grid (columnar: names once). */
  windowSample: { columns: string[]; rows: Array<Array<number | string | null>> };
  projection: EmbeddingProjection | null;
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

export interface ExampleWindow {
  windowId: number;
  score: number;
  time: string;
  targetPattern: string;
  barCount: number;
  /** Five bars, oldest first; the network saw only the last `barCount`. */
  bars: Array<{ open: number; high: number; low: number; close: number }>;
}

export interface PatternBody {
  part: "pattern";
  pattern: string;
  patternBarCount: number;
  visibleWindowCount: number;
  positiveWindowCount: number;
  /** AUC and AP recomputed in SQL from the stored scores (null when the pattern never fired). */
  areaUnderCurve: number | null;
  averagePrecision: number | null;
  roc: RocPoint[];
  thresholds: ThresholdCounts[];
  groups: ScoreGroup[];
  histogram: HistogramCount[];
  positiveScores: ScoreSummary;
  negativeScores: ScoreSummary;
  truePositives: ExampleWindow[];
  falsePositives: ExampleWindow[];
  misses: ExampleWindow[];
}

export type ChartCnnBody = OverviewBody | PatternBody;

/**
 * numpy.array_split of `count` sorted items into `groups`: the first
 * `count % groups` groups hold one extra item. Returns the 0-based group of
 * the item at 0-based position `index`.
 */
export function arraySplitGroup(index: number, count: number, groups: number): number {
  const base = Math.floor(count / groups);
  const extra = count % groups;
  const boundary = extra * (base + 1);
  if (index < boundary) return Math.floor(index / (base + 1));
  return base === 0 ? extra - 1 : extra + Math.floor((index - boundary) / base);
}

/** Pattern name without the TA-Lib "CDL" prefix, for axis labels. */
export function shortPatternName(name: string): string {
  return name.startsWith("CDL") ? name.slice(3) : name;
}

/** Mean, median and count above a cut of the finite AUCs: the notebook's headline. */
export function recognitionHeadline(rows: readonly PatternScoreRow[], cut = 0.95) {
  const scored = rows.map((row) => row.area_under_curve).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const sorted = [...scored].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length === 0 ? null : sorted.length % 2 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return {
    scoredCount: scored.length,
    unscoredCount: rows.length - scored.length,
    meanAreaUnderCurve: scored.length === 0 ? null : scored.reduce((sum, value) => sum + value, 0) / scored.length,
    medianAreaUnderCurve: median,
    aboveCutCount: scored.filter((value) => value > cut).length,
  };
}

/**
 * Correlation ratio (eta squared): the share of `values`' variance that the
 * group means explain, between-group sum of squares over total. 0 = the
 * groups do not separate the values at all, 1 = every group is one value.
 */
export function correlationRatio(values: readonly number[], groups: readonly (string | number)[]): number | null {
  const count = Math.min(values.length, groups.length);
  if (count < 2) return null;
  let total = 0;
  for (let index = 0; index < count; index += 1) total += values[index] as number;
  const mean = total / count;
  const sums = new Map<string | number, { sum: number; count: number }>();
  let totalSquares = 0;
  for (let index = 0; index < count; index += 1) {
    const value = values[index] as number;
    totalSquares += (value - mean) ** 2;
    const entry = sums.get(groups[index] as string | number) ?? { sum: 0, count: 0 };
    entry.sum += value;
    entry.count += 1;
    sums.set(groups[index] as string | number, entry);
  }
  if (!(totalSquares > 0)) return null;
  let between = 0;
  for (const entry of sums.values()) between += entry.count * (entry.sum / entry.count - mean) ** 2;
  return between / totalSquares;
}
