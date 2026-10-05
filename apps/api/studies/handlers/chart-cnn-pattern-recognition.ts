/**
 * Chart CNN pattern recognition: a network trained only on synthetic candles
 * that TA-Lib verifies, scored on 126,624 real MNQ 5-minute windows from 2024
 * on that it never saw. Replaced Trading/quant/chart_cnn/synth/report_synth.py.
 *
 * Reads the five tables landed by
 * packages/ml-engine/src/studies/chart_cnn_pattern_recognition/build.py
 * (derived_study_chart_cnn_pattern_recognition_*). Two parts:
 *   part=overview  the per-pattern table, window counts, a window sample and
 *                  the 20,000-point embedding projection (fixed; cached long)
 *   part=pattern   one pattern's ROC, AUC and average precision recomputed from
 *                  the stored scores, counts at every threshold, score groups
 *                  split the way numpy.array_split splits them, the score
 *                  histogram by TA-Lib verdict with eight numbers each, and the
 *                  example windows (most confident hits, false positives, misses)
 *
 * A window shows its last `window_bar_count` bars; a pattern is scored only on
 * windows showing at least as many bars as the pattern needs, as the notebook did.
 */

import { z } from "zod";
import { missingViews } from "../views";
import { ident, num, text } from "../sql";
import type { StudyContext, StudyHandler } from "../types";
import {
  CHART_CNN_VIEWS as VIEWS, DEFAULT_PATTERN, PATTERN_NAMES,
  type ChartCnnBody, type CountRow, type EmbeddingProjection, type ExampleWindow, type HistogramCount, type OverviewBody,
  type PatternBody, type PatternScoreRow, type RocPoint, type ScoreGroup, type ScoreSummary, type ThresholdCounts,
} from "@shared/studies/chart-cnn-pattern-recognition";

const ROC_POINT_BUDGET = 400;
const WINDOW_SAMPLE_SIZE = 2000;

export const chartCnnQuery = z.object({
  part: z.enum(["overview", "pattern"]).default("overview"),
  pattern: z.enum(PATTERN_NAMES).default(DEFAULT_PATTERN),
  groups: z.coerce.number().int().min(2).max(50).default(10),
  bins: z.coerce.number().int().min(5).max(100).default(40),
  examples: z.coerce.number().int().min(1).max(24).default(8),
});

type Query = z.infer<typeof chartCnnQuery>;

/** Thresholds the page's slider steps through: every 0.01, then finer where a sigmoid output crowds near 1. */
export const THRESHOLDS: number[] = [
  ...Array.from({ length: 100 }, (_, index) => index / 100),
  ...Array.from({ length: 9 }, (_, index) => 0.991 + index / 1000),
  0.9995,
];

// ── SQL, exported so the parity check runs exactly what the page is served ──

export function scoreColumn(pattern: string): string {
  return ident(`network_score_${pattern.toLowerCase()}`);
}

export function labelColumn(pattern: string): string {
  return ident(`talib_fires_${pattern.toLowerCase()}`);
}

/** The windows a pattern is scored on: score, TA-Lib verdict (0/1) and id. */
export function visibleSql(pattern: string, patternBarCount: number): string {
  return `SELECT window_id, CAST(${scoreColumn(pattern)} AS DOUBLE) AS score, CAST(${labelColumn(pattern)} AS BIGINT) AS label `
    + `FROM ${ident(VIEWS.windowScores)} WHERE window_bar_count >= ${num(patternBarCount)}`;
}

/** Cumulative counts at every distinct score, highest first: the ROC's corners. */
function cornersSql(pattern: string, patternBarCount: number): string {
  return `v AS (${visibleSql(pattern, patternBarCount)}),
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
export function areaSql(pattern: string, patternBarCount: number): string {
  return `WITH ${cornersSql(pattern, patternBarCount)},
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
export function rocSql(pattern: string, patternBarCount: number): string {
  return `WITH ${cornersSql(pattern, patternBarCount)}
SELECT c.score AS threshold, c.false_positives / t.negatives AS false_positive_rate, c.true_positives / t.positives AS true_positive_rate
FROM corners c, totals t
WHERE t.positives > 0 AND t.negatives > 0
  AND (c.position <= 60 OR c.position = c.corner_count
       OR c.position % GREATEST(1, CAST(CEIL(c.corner_count / ${num(ROC_POINT_BUDGET)}.0) AS BIGINT)) = 0)
ORDER BY c.position`;
}

export function thresholdSql(pattern: string, patternBarCount: number): string {
  const values = THRESHOLDS.map((value) => `(${num(value)})`).join(", ");
  return `WITH v AS (${visibleSql(pattern, patternBarCount)}),
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
export function groupsSql(pattern: string, patternBarCount: number, visibleCount: number, groups: number): string {
  const effective = Math.max(1, Math.min(groups, visibleCount));
  const base = Math.floor(visibleCount / effective);
  const extra = visibleCount % effective;
  const boundary = extra * (base + 1);
  return `WITH v AS (${visibleSql(pattern, patternBarCount)}),
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

export function histogramSql(pattern: string, patternBarCount: number, bins: number): string {
  return `WITH v AS (${visibleSql(pattern, patternBarCount)})
SELECT LEAST(CAST(FLOOR(score * ${num(bins)}) AS BIGINT), ${num(bins - 1)}) AS bin,
       SUM(label) AS positives, COUNT(*) - SUM(label) AS negatives
FROM v GROUP BY bin ORDER BY bin`;
}

export function summarySql(pattern: string, patternBarCount: number): string {
  return `WITH v AS (${visibleSql(pattern, patternBarCount)})
SELECT label, COUNT(*) AS count, AVG(score) AS mean, MEDIAN(score) AS median, STDDEV_SAMP(score) AS standard_deviation,
       SKEWNESS(score) AS skewness, KURTOSIS(score) AS kurtosis,
       QUANTILE_CONT(score, 0.25) AS percentile_25, QUANTILE_CONT(score, 0.75) AS percentile_75,
       MIN(score) AS minimum, MAX(score) AS maximum
FROM v GROUP BY label ORDER BY label`;
}

const BAR_COLUMNS = [1, 2, 3, 4, 5].flatMap((bar) => ["open", "high", "low", "close"].map((field) => `w.bar_${bar}_${field}`));

/** Most confident hits (label 1, highest score), false positives (label 0, highest) or misses (label 1, lowest). */
export function examplesSql(pattern: string, patternBarCount: number, kind: "hits" | "falsePositives" | "misses", count: number): string {
  const label = kind === "falsePositives" ? 0 : 1;
  const order = kind === "misses" ? "score ASC" : "score DESC";
  return `WITH v AS (${visibleSql(pattern, patternBarCount)}),
picked AS (SELECT window_id, score FROM v WHERE label = ${num(label)} ORDER BY ${order}, window_id LIMIT ${num(count)})
SELECT p.window_id, p.score, w.window_time_new_york, w.target_pattern, w.window_bar_count, ${BAR_COLUMNS.join(", ")}
FROM picked p JOIN ${ident(VIEWS.windows)} w ON w.window_id = p.window_id
ORDER BY ${kind === "misses" ? "p.score ASC" : "p.score DESC"}, p.window_id`;
}

/** Text like '2024-07-25 00:40:00-04:00' as a comparable instant, without the ICU extension. */
const WINDOW_INSTANT = "(CAST(LEFT(window_time_new_york, 19) AS TIMESTAMP) - TO_HOURS(CAST(SUBSTR(window_time_new_york, 20, 3) AS INTEGER)))";

export function spanSql(): string {
  return `SELECT COUNT(*) AS window_count,
       ARG_MIN(window_time_new_york, ${WINDOW_INSTANT}) AS first_window_time,
       ARG_MAX(window_time_new_york, ${WINDOW_INSTANT}) AS last_window_time
FROM ${ident(VIEWS.windows)}`;
}

// ── Row shaping ──

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
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

function toExample(row: Record<string, unknown>): ExampleWindow {
  return {
    windowId: finite(row.window_id) ?? 0,
    score: finite(row.score) ?? 0,
    time: String(row.window_time_new_york ?? ""),
    targetPattern: String(row.target_pattern ?? ""),
    barCount: finite(row.window_bar_count) ?? 5,
    bars: [1, 2, 3, 4, 5].map((bar) => ({
      open: finite(row[`bar_${bar}_open`]) ?? 0,
      high: finite(row[`bar_${bar}_high`]) ?? 0,
      low: finite(row[`bar_${bar}_low`]) ?? 0,
      close: finite(row[`bar_${bar}_close`]) ?? 0,
    })),
  };
}

function toCounts(rows: Array<Record<string, unknown>>): CountRow[] {
  return rows.map((row) => ({ value: String(row.value), window_count: finite(row.window_count) ?? 0 }));
}

// ── Parts ──

function emptyOverview(): OverviewBody {
  return {
    part: "overview", patterns: [], windowCount: 0, firstWindowTime: null, lastWindowTime: null,
    targetCounts: [], signCounts: [], barCountCounts: [], windowSample: { columns: [], rows: [] }, projection: null,
  };
}

async function overview(context: StudyContext): Promise<OverviewBody> {
  const needed = [VIEWS.patternScores, VIEWS.windows, VIEWS.embeddingProjection, VIEWS.embeddingComponents];
  if ((await missingViews(context, needed)).length > 0) return emptyOverview();
  const lake = context.lake;
  const windows = ident(VIEWS.windows);
  const [patterns, span, targetCounts, signCounts, barCountCounts, sample, projectionRows, components] = await Promise.all([
    lake.query<PatternScoreRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.patternScores)} ORDER BY pattern_name`),
    lake.query<Record<string, unknown>>(spanSql()),
    lake.query<Record<string, unknown>>(`SELECT target_pattern AS value, COUNT(*) AS window_count FROM ${windows} GROUP BY target_pattern ORDER BY window_count DESC, value`),
    lake.query<Record<string, unknown>>(`SELECT CAST(pattern_sign AS VARCHAR) AS value, COUNT(*) AS window_count FROM ${windows} GROUP BY pattern_sign ORDER BY pattern_sign`),
    lake.query<Record<string, unknown>>(`SELECT CAST(window_bar_count AS VARCHAR) AS value, COUNT(*) AS window_count FROM ${windows} GROUP BY window_bar_count ORDER BY window_bar_count`),
    lake.query<Record<string, number | string | null>>(`SELECT * EXCLUDE (recipe) FROM ${windows} ORDER BY HASH(window_id), window_id LIMIT ${num(WINDOW_SAMPLE_SIZE)}`),
    lake.query<Record<string, unknown>>(`SELECT window_id, target_pattern, target_frequency_rank, pattern_sign, window_bar_count, principal_component_1, principal_component_2 FROM ${ident(VIEWS.embeddingProjection)} ORDER BY sample_order`),
    lake.query<Record<string, unknown>>(`SELECT component_number, explained_variance_ratio, embedding_dimension_count FROM ${ident(VIEWS.embeddingComponents)} ORDER BY component_number`),
  ]);

  const ranks = new Map<string, number>();
  for (const row of projectionRows) ranks.set(String(row.target_pattern), finite(row.target_frequency_rank) ?? Number.MAX_SAFE_INTEGER);
  const targets = [...ranks.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  const targetIndex = new Map(targets.map((name, index) => [name, index]));
  const projection: EmbeddingProjection = {
    windowId: projectionRows.map((row) => finite(row.window_id) ?? 0),
    // Four decimals is far below a pixel on the scatter and halves the 20,000-point payload.
    principalComponent1: projectionRows.map((row) => round4(finite(row.principal_component_1) ?? 0)),
    principalComponent2: projectionRows.map((row) => round4(finite(row.principal_component_2) ?? 0)),
    target: projectionRows.map((row) => targetIndex.get(String(row.target_pattern)) ?? 0),
    sign: projectionRows.map((row) => finite(row.pattern_sign) ?? 0),
    barCount: projectionRows.map((row) => finite(row.window_bar_count) ?? 0),
    targets,
    explainedVarianceRatio: components.map((row) => finite(row.explained_variance_ratio) ?? 0),
    embeddingDimensionCount: finite(components[0]?.embedding_dimension_count) ?? 0,
  };

  return {
    part: "overview",
    patterns: patterns.map((row) => ({
      ...row,
      area_under_curve: finite(row.area_under_curve),
      average_precision: finite(row.average_precision),
      prevalence: finite(row.prevalence),
    })),
    windowCount: finite(span[0]?.window_count) ?? 0,
    firstWindowTime: span[0]?.first_window_time == null ? null : String(span[0].first_window_time),
    lastWindowTime: span[0]?.last_window_time == null ? null : String(span[0].last_window_time),
    targetCounts: toCounts(targetCounts),
    signCounts: toCounts(signCounts),
    barCountCounts: toCounts(barCountCounts),
    windowSample: {
      columns: Object.keys(sample[0] ?? {}),
      rows: sample.map((row) => Object.values(row)),
    },
    projection,
  };
}

function emptyPattern(pattern: string): PatternBody {
  const none: ScoreSummary = {
    count: 0, mean: null, median: null, standardDeviation: null, skewness: null, kurtosis: null,
    percentile25: null, percentile75: null, minimum: null, maximum: null,
  };
  return {
    part: "pattern", pattern, patternBarCount: 0, visibleWindowCount: 0, positiveWindowCount: 0,
    areaUnderCurve: null, averagePrecision: null, roc: [], thresholds: [], groups: [], histogram: [],
    positiveScores: none, negativeScores: none, truePositives: [], falsePositives: [], misses: [],
  };
}

async function patternPart(query: Query, context: StudyContext): Promise<PatternBody> {
  const pattern = query.pattern;
  if ((await missingViews(context, [VIEWS.patternScores, VIEWS.windows, VIEWS.windowScores])).length > 0) return emptyPattern(pattern);
  const lake = context.lake;
  const [meta] = await lake.query<Record<string, unknown>>(
    `SELECT pattern_bar_count FROM ${ident(VIEWS.patternScores)} WHERE pattern_name = ${text(pattern)}`,
  );
  const patternBarCount = finite(meta?.pattern_bar_count);
  if (patternBarCount === null) {
    context.notes.push(`${pattern} is not in the landed pattern table.`);
    return emptyPattern(pattern);
  }

  const [area] = await lake.query<Record<string, unknown>>(areaSql(pattern, patternBarCount));
  const positives = finite(area?.positives) ?? 0;
  const negatives = finite(area?.negatives) ?? 0;
  const visible = positives + negatives;
  if (positives === 0) {
    context.notes.push(`TA-Lib never fires ${pattern} on the ${visible.toLocaleString("en-US")} real windows that show enough bars for it, so its ROC, AUC and average precision are undefined; the score groups and false positives are still shown.`);
  }

  const [roc, thresholds, groups, histogram, summaries, hits, falsePositives, misses] = await Promise.all([
    lake.query<Record<string, unknown>>(rocSql(pattern, patternBarCount)),
    lake.query<Record<string, unknown>>(thresholdSql(pattern, patternBarCount)),
    visible > 0 ? lake.query<Record<string, unknown>>(groupsSql(pattern, patternBarCount, visible, query.groups)) : Promise.resolve([]),
    lake.query<Record<string, unknown>>(histogramSql(pattern, patternBarCount, query.bins)),
    lake.query<Record<string, unknown>>(summarySql(pattern, patternBarCount)),
    lake.query<Record<string, unknown>>(examplesSql(pattern, patternBarCount, "hits", query.examples)),
    lake.query<Record<string, unknown>>(examplesSql(pattern, patternBarCount, "falsePositives", query.examples)),
    lake.query<Record<string, unknown>>(examplesSql(pattern, patternBarCount, "misses", query.examples)),
  ]);

  const rocPoints: RocPoint[] = roc.length === 0 ? [] : [
    { threshold: Number.POSITIVE_INFINITY, falsePositiveRate: 0, truePositiveRate: 0 },
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
    pattern,
    patternBarCount,
    visibleWindowCount: visible,
    positiveWindowCount: positives,
    areaUnderCurve: finite(area?.area_under_curve),
    averagePrecision: finite(area?.average_precision),
    // JSON has no Infinity: the (0, 0) corner ("flag nothing") carries threshold 1, the top of the score range.
    roc: rocPoints.map((point) => ({ ...point, threshold: Number.isFinite(point.threshold) ? point.threshold : 1 })),
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
    truePositives: hits.map(toExample),
    falsePositives: falsePositives.map(toExample),
    misses: misses.map(toExample),
  };
}

const handler: StudyHandler<typeof chartCnnQuery, ChartCnnBody> = {
  slug: "chart-cnn-pattern-recognition",
  datasets: Object.values(VIEWS),
  query: chartCnnQuery,
  cacheSeconds: 1800,
  async run(query, context) {
    return query.part === "overview" ? overview(context) : patternPart(query, context);
  },
};

export default handler;
