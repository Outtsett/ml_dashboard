/**
 * Chart CNN, control round: does the image network read arithmetic candle
 * patterns? The same 48-bar images and the same network as the direction
 * experiment, the label changed to one of 17 deterministic one-to-three-bar
 * patterns. Replaced Trading/quant/chart_cnn/pkg/report_patterns.py.
 *
 * Reads the two tables landed by
 * packages/ml-engine/src/studies/chart_cnn_arithmetic_patterns/build.py
 * (derived_study_chart_cnn_arithmetic_patterns_*), and, for the pairing with
 * the direction result on the same windows, one row of the direction study's
 * model_results. Two parts:
 *   part=overview  the per-pattern table the notebook showed (landed as
 *                  pattern_results_<tag>.csv), the window span, windows per
 *                  month, a sample of the windows frame and the direction pairing
 *   part=pattern   one pattern's ROC, AUC and average precision recomputed from
 *                  the stored scores, counts at every threshold, score groups
 *                  split the way numpy.array_split splits them (the notebook's
 *                  deciles at groups=10), and the score histogram by verdict
 *                  with eight numbers each
 */

import { z } from "zod";
import { missingViews } from "../views";
import { ident, num, text } from "../sql";
import type { StudyContext, StudyHandler } from "../types";
import {
  ARITHMETIC_VIEWS as VIEWS, DEFAULT_PATTERN, DEFAULT_TAG, DIRECTION_VIEW, PATTERN_NAMES, labelColumn, recipeForTag, scoreColumn,
  type ArithmeticBody, type DirectionPairing, type HistogramCount, type OverviewBody, type PatternBody, type PatternScoreRow,
  type RocPoint, type ScoreGroup, type ScoreSummary, type ThresholdCounts,
} from "@shared/studies/chart-cnn-arithmetic-patterns";

const ROC_POINT_BUDGET = 400;
const WINDOW_SAMPLE_SIZE = 3000;

export const arithmeticQuery = z.object({
  part: z.enum(["overview", "pattern"]).default("overview"),
  tag: z.string().regex(/^[a-z0-9]{1,24}$/).default(DEFAULT_TAG),
  pattern: z.enum(PATTERN_NAMES).default(DEFAULT_PATTERN),
  groups: z.coerce.number().int().min(2).max(50).default(10),
  bins: z.coerce.number().int().min(5).max(100).default(40),
});

type Query = z.infer<typeof arithmeticQuery>;

/** Thresholds the page's slider steps through: every 0.01, then finer where a sigmoid output crowds near 1. */
export const THRESHOLDS: number[] = [
  ...Array.from({ length: 100 }, (_, index) => index / 100),
  ...Array.from({ length: 9 }, (_, index) => 0.991 + index / 1000),
  0.9995,
];

// ── SQL, exported so the parity check runs exactly what the page is served ──

/** The pattern's windows: score, arithmetic label (0/1) and id, for one landed tag. */
export function visibleSql(tag: string, pattern: string): string {
  return `SELECT window_id, CAST(${ident(scoreColumn(pattern))} AS DOUBLE) AS score, CAST(${ident(labelColumn(pattern))} AS BIGINT) AS label `
    + `FROM ${ident(VIEWS.windowScores)} WHERE recipe = ${text(recipeForTag(tag))}`;
}

/** Cumulative counts at every distinct score, highest first: the ROC's corners. */
function cornersSql(tag: string, pattern: string): string {
  return `v AS (${visibleSql(tag, pattern)}),
totals AS (SELECT SUM(label)::DOUBLE AS positives, (COUNT(*) - SUM(label))::DOUBLE AS negatives FROM v),
grouped AS (SELECT score, SUM(label)::DOUBLE AS true_at, (COUNT(*) - SUM(label))::DOUBLE AS false_at FROM v GROUP BY score),
corners AS (
  SELECT score,
         SUM(true_at) OVER (ORDER BY score DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS true_positives,
         SUM(false_at) OVER (ORDER BY score DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS false_positives,
         ROW_NUMBER() OVER (ORDER BY score DESC) AS position,
         COUNT(*) OVER () AS corner_count
  FROM grouped)`;
}

/** AUC by the trapezoid rule over the corners, and average precision as sklearn defines it. */
export function areaSql(tag: string, pattern: string): string {
  return `WITH ${cornersSql(tag, pattern)},
steps AS (
  SELECT true_positives, false_positives,
         LAG(true_positives, 1, 0) OVER (ORDER BY score DESC) AS previous_true,
         LAG(false_positives, 1, 0) OVER (ORDER BY score DESC) AS previous_false
  FROM corners)
SELECT CASE WHEN t.positives > 0 AND t.negatives > 0
            THEN SUM((s.false_positives - s.previous_false) * (s.true_positives + s.previous_true) / 2.0) / (t.positives * t.negatives) END AS area_under_curve,
       CASE WHEN t.positives > 0
            THEN SUM((s.true_positives - s.previous_true) * s.true_positives / (s.true_positives + s.false_positives)) / t.positives END AS average_precision,
       ANY_VALUE(t.positives) AS positives, ANY_VALUE(t.negatives) AS negatives
FROM steps s, totals t GROUP BY t.positives, t.negatives`;
}

/** The ROC thinned to about ROC_POINT_BUDGET corners, keeping the first 60 (where rare patterns rise). */
export function rocSql(tag: string, pattern: string): string {
  return `WITH ${cornersSql(tag, pattern)}
SELECT c.score AS threshold, c.false_positives / t.negatives AS false_positive_rate, c.true_positives / t.positives AS true_positive_rate
FROM corners c, totals t
WHERE t.positives > 0 AND t.negatives > 0
  AND (c.position <= 60 OR c.position = c.corner_count
       OR c.position % GREATEST(1, CAST(CEIL(c.corner_count / ${num(ROC_POINT_BUDGET)}.0) AS BIGINT)) = 0)
ORDER BY c.position`;
}

export function thresholdSql(tag: string, pattern: string): string {
  const values = THRESHOLDS.map((value) => `(${num(value)})`).join(", ");
  return `WITH v AS (${visibleSql(tag, pattern)}),
t(threshold) AS (VALUES ${values})
SELECT t.threshold,
       SUM(CASE WHEN v.score >= t.threshold THEN v.label ELSE 0 END) AS true_positives,
       SUM(CASE WHEN v.score >= t.threshold THEN 1 - v.label ELSE 0 END) AS false_positives
FROM t CROSS JOIN v GROUP BY t.threshold ORDER BY t.threshold`;
}

/**
 * Sort by score and split into `groups` the way numpy.array_split does (the
 * notebook's np.array_split(np.argsort(p), 10)): the first count % groups
 * groups hold one extra window. Ties are broken by window id.
 */
export function groupsSql(tag: string, pattern: string, windowCount: number, groups: number): string {
  const effective = Math.max(1, Math.min(groups, windowCount));
  const base = Math.floor(windowCount / effective);
  const extra = windowCount % effective;
  const boundary = extra * (base + 1);
  return `WITH v AS (${visibleSql(tag, pattern)}),
ranked AS (SELECT score, label, ROW_NUMBER() OVER (ORDER BY score, window_id) - 1 AS position FROM v),
split AS (
  SELECT score, label,
         CASE WHEN position < ${num(boundary)} THEN position // ${num(base + 1)}
              ELSE ${num(extra)} + (position - ${num(boundary)}) // ${num(Math.max(1, base))} END AS score_group
  FROM ranked)
SELECT score_group + 1 AS score_group, COUNT(*) AS window_count, AVG(label) AS positive_fraction,
       MIN(score) AS lowest_score, MAX(score) AS highest_score
FROM split GROUP BY score_group ORDER BY score_group`;
}

export function histogramSql(tag: string, pattern: string, bins: number): string {
  return `WITH v AS (${visibleSql(tag, pattern)})
SELECT LEAST(CAST(FLOOR(score * ${num(bins)}) AS BIGINT), ${num(bins - 1)}) AS bin,
       SUM(label) AS positives, COUNT(*) - SUM(label) AS negatives
FROM v GROUP BY bin ORDER BY bin`;
}

export function summarySql(tag: string, pattern: string): string {
  return `WITH v AS (${visibleSql(tag, pattern)})
SELECT label, COUNT(*) AS count, AVG(score) AS mean, MEDIAN(score) AS median, STDDEV_SAMP(score) AS standard_deviation,
       SKEWNESS(score) AS skewness, KURTOSIS(score) AS kurtosis,
       QUANTILE_CONT(score, 0.25) AS percentile_25, QUANTILE_CONT(score, 0.75) AS percentile_75,
       MIN(score) AS minimum, MAX(score) AS maximum
FROM v GROUP BY label ORDER BY label`;
}

export function spanSql(tag: string): string {
  return `SELECT COUNT(*) AS window_count, MIN(window_time_new_york) AS first_window_time, MAX(window_time_new_york) AS last_window_time `
    + `FROM ${ident(VIEWS.windowScores)} WHERE recipe = ${text(recipeForTag(tag))}`;
}

export function monthlySql(tag: string): string {
  return `SELECT SUBSTR(window_time_new_york, 1, 7) AS month, COUNT(*) AS window_count FROM ${ident(VIEWS.windowScores)} `
    + `WHERE recipe = ${text(recipeForTag(tag))} GROUP BY month ORDER BY month`;
}

export function sampleSql(tag: string): string {
  return `SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.windowScores)} WHERE recipe = ${text(recipeForTag(tag))} `
    + `ORDER BY HASH(window_id), window_id LIMIT ${num(WINDOW_SAMPLE_SIZE)}`;
}

export function directionSql(tag: string): string {
  return `SELECT test_observation_count, area_under_curve, area_under_curve_interval_low, area_under_curve_interval_high, base_up_rate `
    + `FROM ${ident(DIRECTION_VIEW)} WHERE dataset_tag = ${text(tag)} AND model_name = '2D image' LIMIT 1`;
}

// ── Row shaping ──

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function toSummary(row: Record<string, unknown> | undefined): ScoreSummary {
  return {
    count: finite(row?.count) ?? 0,
    mean: finite(row?.mean),
    median: finite(row?.median),
    standardDeviation: finite(row?.standard_deviation),
    skewness: finite(row?.skewness),
    kurtosis: finite(row?.kurtosis),
    percentile25: finite(row?.percentile_25),
    percentile75: finite(row?.percentile_75),
    minimum: finite(row?.minimum),
    maximum: finite(row?.maximum),
  };
}

function toPatternRow(row: Record<string, unknown>): PatternScoreRow {
  return {
    pattern_name: String(row.pattern_name),
    pattern_bar_count: finite(row.pattern_bar_count) ?? 0,
    rule_in_words: String(row.rule_in_words ?? ""),
    window_count: finite(row.window_count) ?? 0,
    positive_window_count: finite(row.positive_window_count) ?? 0,
    prevalence: finite(row.prevalence) ?? 0,
    area_under_curve: finite(row.area_under_curve) ?? Number.NaN,
    average_precision: finite(row.average_precision) ?? Number.NaN,
  };
}

// ── Parts ──

function emptyOverview(tag: string, tags: string[] = []): OverviewBody {
  return {
    part: "overview", tags, tag, patterns: [], windowCount: 0, firstWindowTime: null, lastWindowTime: null,
    monthlyWindowCounts: [], windowSample: { columns: [], rows: [] }, direction: null,
  };
}

async function landedTags(context: StudyContext): Promise<string[]> {
  const rows = await context.lake.query<Record<string, unknown>>(`SELECT DISTINCT recipe FROM ${ident(VIEWS.patternScores)} ORDER BY recipe`);
  return rows.map((row) => String(row.recipe)).filter((recipe) => recipe.startsWith("arithmetic_")).map((recipe) => recipe.slice("arithmetic_".length));
}

async function direction(tag: string, context: StudyContext): Promise<DirectionPairing | null> {
  if (!(await context.lake.hasView(DIRECTION_VIEW))) return null;
  const [row] = await context.lake.query<Record<string, unknown>>(directionSql(tag));
  if (!row) return null;
  return {
    testObservationCount: finite(row.test_observation_count) ?? 0,
    areaUnderCurve: finite(row.area_under_curve) ?? Number.NaN,
    intervalLow: finite(row.area_under_curve_interval_low) ?? Number.NaN,
    intervalHigh: finite(row.area_under_curve_interval_high) ?? Number.NaN,
    baseUpRate: finite(row.base_up_rate) ?? Number.NaN,
  };
}

async function overview(query: Query, context: StudyContext): Promise<OverviewBody> {
  if ((await missingViews(context, [VIEWS.patternScores, VIEWS.windowScores])).length > 0) return emptyOverview(query.tag);
  const lake = context.lake;
  const tags = await landedTags(context);
  if (!tags.includes(query.tag)) {
    context.notes.push(`No arithmetic-pattern round is landed for the dataset tag ${JSON.stringify(query.tag)}; landed: ${tags.join(", ") || "none"}.`);
    return emptyOverview(query.tag, tags);
  }
  const recipe = recipeForTag(query.tag);
  const [patterns, span, months, sample, pairing] = await Promise.all([
    lake.query<Record<string, unknown>>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.patternScores)} WHERE recipe = ${text(recipe)} ORDER BY area_under_curve DESC, pattern_name`),
    lake.query<Record<string, unknown>>(spanSql(query.tag)),
    lake.query<Record<string, unknown>>(monthlySql(query.tag)),
    lake.query<Record<string, number | string | null>>(sampleSql(query.tag)),
    direction(query.tag, context),
  ]);
  return {
    part: "overview",
    tags,
    tag: query.tag,
    patterns: patterns.map(toPatternRow),
    windowCount: finite(span[0]?.window_count) ?? 0,
    firstWindowTime: span[0]?.first_window_time == null ? null : String(span[0].first_window_time),
    lastWindowTime: span[0]?.last_window_time == null ? null : String(span[0].last_window_time),
    monthlyWindowCounts: months.map((row) => ({ month: String(row.month), window_count: finite(row.window_count) ?? 0 })),
    windowSample: { columns: Object.keys(sample[0] ?? {}), rows: sample.map((row) => Object.values(row)) },
    direction: pairing,
  };
}

function emptyPattern(query: Query): PatternBody {
  const none: ScoreSummary = {
    count: 0, mean: null, median: null, standardDeviation: null, skewness: null, kurtosis: null,
    percentile25: null, percentile75: null, minimum: null, maximum: null,
  };
  return {
    part: "pattern", tag: query.tag, pattern: query.pattern, ruleInWords: "", patternBarCount: 0, windowCount: 0, positiveWindowCount: 0,
    areaUnderCurve: null, averagePrecision: null, roc: [], thresholds: [], groups: [], histogram: [],
    positiveScores: none, negativeScores: none,
  };
}

async function patternPart(query: Query, context: StudyContext): Promise<PatternBody> {
  if ((await missingViews(context, [VIEWS.patternScores, VIEWS.windowScores])).length > 0) return emptyPattern(query);
  const lake = context.lake;
  const [meta] = await lake.query<Record<string, unknown>>(
    `SELECT pattern_bar_count, rule_in_words FROM ${ident(VIEWS.patternScores)} WHERE pattern_name = ${text(query.pattern)} AND recipe = ${text(recipeForTag(query.tag))}`,
  );
  if (!meta) {
    context.notes.push(`${query.pattern} is not in the landed pattern table for the tag ${JSON.stringify(query.tag)}.`);
    return emptyPattern(query);
  }
  const [area] = await lake.query<Record<string, unknown>>(areaSql(query.tag, query.pattern));
  const positives = finite(area?.positives) ?? 0;
  const negatives = finite(area?.negatives) ?? 0;
  const windowCount = positives + negatives;
  if (positives === 0) {
    context.notes.push(`The arithmetic rule never fires ${query.pattern} on these ${windowCount.toLocaleString("en-US")} windows, so its ROC, AUC and average precision are undefined.`);
  }

  const [roc, thresholds, groups, histogram, summaries] = await Promise.all([
    lake.query<Record<string, unknown>>(rocSql(query.tag, query.pattern)),
    lake.query<Record<string, unknown>>(thresholdSql(query.tag, query.pattern)),
    windowCount > 0 ? lake.query<Record<string, unknown>>(groupsSql(query.tag, query.pattern, windowCount, query.groups)) : Promise.resolve([]),
    lake.query<Record<string, unknown>>(histogramSql(query.tag, query.pattern, query.bins)),
    lake.query<Record<string, unknown>>(summarySql(query.tag, query.pattern)),
  ]);

  const rocPoints: RocPoint[] = roc.length === 0 ? [] : [
    // The (0, 0) corner ("flag nothing"): its threshold is 1, the top of a sigmoid's range (JSON has no Infinity).
    { threshold: 1, falsePositiveRate: 0, truePositiveRate: 0 },
    ...roc.map((row) => ({
      threshold: finite(row.threshold) ?? 0,
      falsePositiveRate: finite(row.false_positive_rate) ?? 0,
      truePositiveRate: finite(row.true_positive_rate) ?? 0,
    })),
  ];
  const byBin = new Map(histogram.map((row) => [finite(row.bin) ?? 0, row]));
  const bins: HistogramCount[] = Array.from({ length: query.bins }, (_, bin) => ({
    bin,
    lower: bin / query.bins,
    upper: (bin + 1) / query.bins,
    positives: finite(byBin.get(bin)?.positives) ?? 0,
    negatives: finite(byBin.get(bin)?.negatives) ?? 0,
  }));

  return {
    part: "pattern",
    tag: query.tag,
    pattern: query.pattern,
    ruleInWords: String(meta.rule_in_words ?? ""),
    patternBarCount: finite(meta.pattern_bar_count) ?? 0,
    windowCount,
    positiveWindowCount: positives,
    areaUnderCurve: finite(area?.area_under_curve),
    averagePrecision: finite(area?.average_precision),
    roc: rocPoints,
    thresholds: thresholds.map((row): ThresholdCounts => ({
      threshold: finite(row.threshold) ?? 0,
      truePositives: finite(row.true_positives) ?? 0,
      falsePositives: finite(row.false_positives) ?? 0,
    })),
    groups: groups.map((row): ScoreGroup => ({
      group: finite(row.score_group) ?? 0,
      windowCount: finite(row.window_count) ?? 0,
      positiveFraction: finite(row.positive_fraction) ?? 0,
      lowestScore: finite(row.lowest_score) ?? 0,
      highestScore: finite(row.highest_score) ?? 0,
    })),
    histogram: bins,
    positiveScores: toSummary(summaries.find((row) => finite(row.label) === 1)),
    negativeScores: toSummary(summaries.find((row) => finite(row.label) === 0)),
  };
}

const handler: StudyHandler<typeof arithmeticQuery, ArithmeticBody> = {
  slug: "chart-cnn-arithmetic-patterns",
  datasets: [...Object.values(VIEWS), DIRECTION_VIEW],
  query: arithmeticQuery,
  cacheSeconds: 1800,
  async run(query, context) {
    return query.part === "overview" ? overview(query, context) : patternPart(query, context);
  },
};

export default handler;
