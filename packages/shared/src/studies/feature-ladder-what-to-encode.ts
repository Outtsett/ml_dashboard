/**
 * The body of GET /api/studies/feature-ladder-what-to-encode, shared by the
 * handler and the page, and the pure rules the page applies to it.
 *
 * The ladder: on 353,478 MNQ 5-minute bars (fitted 2021-2023, scored once on
 * 2025) each rung adds one named block of features to the rung below it, and
 * is scored on four targets. A block "earns its place" on a target when its
 * score beats the best of five shuffled copies of itself AND the increment
 * over the rung below is positive. Two orderings exist: the original
 * (derivatives before volume) and a re-run with volume ahead of both
 * derivatives, to see whether the order decides the answer.
 */

export const TICK_SIZE_POINTS = 0.25;

export type LadderOrdering = "derivatives_first" | "volume_first";

export const ORDERING_LABEL: Record<LadderOrdering, string> = {
  derivatives_first: "derivatives before volume",
  volume_first: "volume before derivatives",
};

export interface LadderRow {
  ordering: LadderOrdering;
  target: string;
  rung_index: number;
  block_added: string;
  feature_count: number;
  train_row_count: number;
  test_row_count: number;
  score_holdout: number;
  score_increment_over_previous_rung: number | null;
  shuffled_block_score_mean: number | null;
  shuffled_block_score_best_of_five: number | null;
  beats_its_shuffled_control: boolean;
  metric: string;
  timeframe: string;
  recipe: string;
}

export interface GapBin {
  lower: number;
  upper: number;
  count: number;
}

/** The eight numbers (plus the count) of one column, computed over every holdout bar in the lake. */
export interface ColumnSummary {
  column: string;
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

export interface SessionEdgeCheck {
  /** Bars one or none bars before the session break (the notebook's "session edge"). */
  edgeBarCount: number;
  edgeShare: number | null;
  meanGapRatioAtEdge: number | null;
  meanGapRatioElsewhere: number | null;
  edgeMultiple: number | null;
  /** Share of the total squared close-to-next-open gap carried by the edge bars. */
  squaredGapShare: number | null;
}

export interface GapBody {
  holdoutBarCount: number;
  /** Holdout bars whose next open is known (the last bar of a session has none). */
  gapBarCount: number;
  meanRangePoints: number | null;
  /** The notebook's number: mean |gap| in average ranges times the mean average range, in ticks. */
  notebookMeanGapTicks: number | null;
  notebookMedianGapTicks: number | null;
  /** The same gap measured bar by bar, each gap times its own bar's average range, in ticks. */
  perBarMeanGapTicks: number | null;
  perBarMedianGapTicks: number | null;
  /** The notebook's axis: every |gap| rescaled by the ONE mean range, clipped at `clipAverageRanges`. */
  histogramAtMeanRange: GapBin[];
  keptShareAtMeanRange: number | null;
  /** The honest axis: every |gap| times its own bar's range. */
  histogramPerBar: GapBin[];
  keptSharePerBar: number | null;
  clipAverageRanges: number;
  clipTicks: number;
  summaries: ColumnSummary[];
  sessionEdge: SessionEdgeCheck | null;
  /** A deterministic sample of holdout bars for the per-column graphics, one array per column (columnar keeps the body small). */
  sampleColumns: Record<string, number[]>;
  sampleFraction: number;
}

export interface FeatureLadderBody {
  ladder: LadderRow[];
  totalBarCount: number | null;
  gap: GapBody | null;
}

/** Figures the notebook quotes that no table or script in the lake produces. Shown as cited, never recomputed. */
export const CITED_FIGURES = {
  quotedSpreadTicks: 2.04,
  quotedSpreadPoints: 0.51054,
  quotedTickCount: 1_348_266,
  notebookGapToSpreadRatio: 0.981,
} as const;

export const TARGETS = [
  { key: "next_bar_direction", label: "next bar's direction (up or down)", short: "direction" },
  { key: "next_bar_range", label: "next bar's range (how far it travels)", short: "range" },
  { key: "next_open_gap", label: "close to next open, signed", short: "signed gap" },
  { key: "next_open_gap_magnitude", label: "close to next open, magnitude", short: "gap magnitude" },
] as const;

export type TargetKey = (typeof TARGETS)[number]["key"];

export function targetLabel(key: string): string {
  return TARGETS.find((target) => target.key === key)?.label ?? key;
}

export function targetShort(key: string): string {
  return TARGETS.find((target) => target.key === key)?.short ?? key;
}

/** The blocks after the intercept, in the original ladder's order. */
export const BLOCK_ORDER = [
  "range_memory",
  "momentum_level",
  "volatility_rate_of_change",
  "momentum_rate_of_change",
  "volume_level",
  "volume_conditioned_body",
] as const;

/** The order Panel F draws the blocks in (volume ahead of both derivatives). */
export const ROBUSTNESS_BLOCK_ORDER = [
  "range_memory",
  "momentum_level",
  "volume_level",
  "volatility_rate_of_change",
  "momentum_rate_of_change",
  "volume_conditioned_body",
] as const;

export function blockLabel(block: string): string {
  return block.replace(/_/g, " ");
}

export function metricLabel(metric: string): string {
  if (metric === "area_under_curve") return "area under the curve";
  if (metric === "r_squared") return "R squared";
  return metric.replace(/_/g, " ");
}

/**
 * A block earns its place when the increment over the rung below is positive
 * (and above `minimumIncrement`, 0 by default, which is the notebook's rule)
 * AND its score beat the best of five shuffled copies of itself.
 */
export function isEarned(row: LadderRow, minimumIncrement = 0): boolean {
  return (
    row.rung_index > 0 &&
    row.beats_its_shuffled_control &&
    row.score_increment_over_previous_rung !== null &&
    row.score_increment_over_previous_rung > minimumIncrement
  );
}

export function rungsOf(rows: readonly LadderRow[], ordering: LadderOrdering, target: string): LadderRow[] {
  return rows.filter((row) => row.ordering === ordering && row.target === target).sort((a, b) => a.rung_index - b.rung_index);
}

export interface BlockSummary {
  block: string;
  targetsEarnedOn: number;
  targetCount: number;
  bestIncrement: number | null;
  earnedTargets: string[];
}

/** Per block: on how many targets it earns its place and its best earned increment (the notebook's decision table). */
export function blockSummaries(rows: readonly LadderRow[], ordering: LadderOrdering, minimumIncrement = 0): BlockSummary[] {
  const ladder = rows.filter((row) => row.ordering === ordering && row.rung_index > 0);
  const blocks = [...new Set(ladder.map((row) => row.block_added))];
  const targetCount = new Set(ladder.map((row) => row.target)).size;
  const summaries = blocks.map((block) => {
    const earned = ladder.filter((row) => row.block_added === block && isEarned(row, minimumIncrement));
    const best = earned.reduce<number | null>((top, row) => {
      const value = row.score_increment_over_previous_rung as number;
      return top === null || value > top ? value : top;
    }, null);
    return { block, targetsEarnedOn: earned.length, targetCount, bestIncrement: best, earnedTargets: earned.map((row) => row.target) };
  });
  return summaries.sort((a, b) => b.targetsEarnedOn - a.targetsEarnedOn || (b.bestIncrement ?? -Infinity) - (a.bestIncrement ?? -Infinity));
}

export interface RobustnessRow {
  block: string;
  derivativesFirst: number | null;
  volumeFirst: number | null;
  difference: number | null;
  derivativesFirstEarned: boolean;
  volumeFirstEarned: boolean;
}

/** One block's increment under both orderings on one target. */
export function robustnessRows(rows: readonly LadderRow[], target: string): RobustnessRow[] {
  const pick = (ordering: LadderOrdering, block: string) => rows.find((row) => row.ordering === ordering && row.target === target && row.block_added === block && row.rung_index > 0);
  return ROBUSTNESS_BLOCK_ORDER.map((block) => {
    const first = pick("derivatives_first", block);
    const second = pick("volume_first", block);
    const a = first?.score_increment_over_previous_rung ?? null;
    const b = second?.score_increment_over_previous_rung ?? null;
    return {
      block,
      derivativesFirst: a,
      volumeFirst: b,
      difference: a !== null && b !== null ? b - a : null,
      derivativesFirstEarned: first ? isEarned(first) : false,
      volumeFirstEarned: second ? isEarned(second) : false,
    };
  });
}

/** The score at the top rung of one ordering on one target (the ladder's final score). */
export function finalScore(rows: readonly LadderRow[], ordering: LadderOrdering, target: string): number | null {
  const rungs = rungsOf(rows, ordering, target);
  return rungs.length > 0 ? (rungs[rungs.length - 1] as LadderRow).score_holdout : null;
}

/** An absolute close-to-next-open gap (in average ranges) as ticks at a stated range in points. */
export function gapTicks(gapInAverageRanges: number, rangePoints: number): number {
  return (Math.abs(gapInAverageRanges) * rangePoints) / TICK_SIZE_POINTS;
}

/** The decimal places a score needs: AUC and R squared increments are read to four places. */
export function signed(value: number | null | undefined, decimals = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(decimals)}`;
}

/** Columnar sample to the row objects the per-column grid reads. */
export function sampleRowsOf(columns: Record<string, number[]>): Array<Record<string, number>> {
  const names = Object.keys(columns);
  const length = Math.max(0, ...names.map((name) => columns[name]?.length ?? 0));
  return Array.from({ length }, (_, index) => Object.fromEntries(names.map((name) => [name, (columns[name] as number[])[index] as number])));
}
