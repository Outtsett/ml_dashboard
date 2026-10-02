/**
 * How do you know what to encode? The incremental feature ladder on MNQ
 * 5-minute bars, and the close-to-next-open gap it forecasts. Replaced
 * datalake/notebooks/what_to_encode.py.
 *
 * Reads three lake views, all already landed and served:
 *   derived_mnq_feature_ladder              4 targets x 7 rungs, derivatives before volume
 *   derived_mnq_feature_ladder_volume_first the same ladder with volume ahead of both derivatives
 *   derived_mnq_next_candles_5m             353,478 bars; the holdout rows carry the gap to the next open
 * The ladder views are 28 rows each and go to the page whole. The gap is
 * aggregated here (eight numbers per column over every holdout bar, two
 * histograms binned in SQL, the session-edge check) plus a one-in-twenty sample
 * for the page's per-column graphics; no per-bar row list leaves the server.
 */

import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  TICK_SIZE_POINTS,
  type ColumnSummary,
  type FeatureLadderBody,
  type GapBin,
  type GapBody,
  type LadderRow,
  type SessionEdgeCheck,
} from "@shared/studies/feature-ladder-what-to-encode";

const VIEW_DERIVATIVES_FIRST = "derived_mnq_feature_ladder";
const VIEW_VOLUME_FIRST = "derived_mnq_feature_ladder_volume_first";
const VIEW_BARS = "derived_mnq_next_candles_5m";

const query = z.object({
  bins: z.coerce.number().int().min(10).max(200).default(60),
  clip: z.coerce.number().min(0.02).max(1).default(0.2),
});

type Query = z.infer<typeof query>;

const GAP_RATIO = "abs(CAST(next_candle_1_open_from_close_in_average_ranges AS DOUBLE))";

/** Every holdout bar whose next open is known: the gap in average ranges, the bar's own average range in points. */
export function holdoutSql(): string {
  return `holdout AS (
    SELECT ${GAP_RATIO} AS gap_ratio,
           CAST(average_range_10_bars AS DOUBLE) AS range_points,
           "timestamp" AS bar_timestamp,
           coalesce(bars_until_session_break, 1000000) AS bars_until_session_break
    FROM ${ident(VIEW_BARS)}
    WHERE sample_split = 'holdout' AND next_candle_1_open_from_close_in_average_ranges IS NOT NULL
  )`;
}

const SUMMARY_COLUMNS: Array<{ column: string; expression: string }> = [
  { column: "gap_magnitude_in_average_ranges", expression: "gap_ratio" },
  { column: "average_range_10_bars_points", expression: "range_points" },
  { column: "gap_magnitude_points", expression: "gap_ratio * range_points" },
  { column: "gap_magnitude_ticks_per_bar", expression: `gap_ratio * range_points / ${TICK_SIZE_POINTS}` },
];

function statSql(expression: string, index: number): string {
  return [
    `count(${expression}) AS c${index}_count`,
    `avg(${expression}) AS c${index}_mean`,
    `median(${expression}) AS c${index}_median`,
    `stddev_samp(${expression}) AS c${index}_standard_deviation`,
    `skewness(${expression}) AS c${index}_skewness`,
    `kurtosis(${expression}) AS c${index}_kurtosis`,
    `quantile_cont(${expression}, 0.25) AS c${index}_percentile25`,
    `quantile_cont(${expression}, 0.75) AS c${index}_percentile75`,
    `min(${expression}) AS c${index}_minimum`,
    `max(${expression}) AS c${index}_maximum`,
  ].join(",\n           ");
}

/** One row of eight-number summaries for every column, the ratio's and range's means, and the session-edge aggregates. */
export function statisticsSql(): string {
  const edge = "bars_until_session_break <= 1";
  return `WITH ${holdoutSql()}
    SELECT count(*) AS gap_bar_count,
           avg(range_points) AS mean_range_points,
           count(*) FILTER (WHERE ${edge}) AS edge_bar_count,
           avg(gap_ratio) FILTER (WHERE ${edge}) AS edge_mean_gap_ratio,
           avg(gap_ratio) FILTER (WHERE NOT (${edge})) AS other_mean_gap_ratio,
           sum(gap_ratio * gap_ratio) FILTER (WHERE ${edge}) AS edge_squared_gap,
           sum(gap_ratio * gap_ratio) AS total_squared_gap,
           ${SUMMARY_COLUMNS.map((entry, index) => statSql(entry.expression, index)).join(",\n           ")}
    FROM holdout`;
}

/** Counts per bin of |gap|, in ticks at ONE range (the notebook's axis) or at each bar's own range. */
export function histogramSql(mode: "mean_range" | "per_bar", bins: number, clip: number, meanRangePoints: number): string {
  const maxTicks = (clip * meanRangePoints) / TICK_SIZE_POINTS;
  const ticks = mode === "mean_range" ? `gap_ratio * ${num(meanRangePoints)} / ${TICK_SIZE_POINTS}` : `gap_ratio * range_points / ${TICK_SIZE_POINTS}`;
  return `WITH ${holdoutSql()}
    SELECT bin, count(*) AS bar_count
    FROM (
      SELECT least(CAST(floor((${ticks}) / ${num(maxTicks)} * ${num(bins)}) AS INTEGER), ${num(bins - 1)}) AS bin
      FROM holdout
      WHERE (${ticks}) <= ${num(maxTicks)}
    )
    GROUP BY bin ORDER BY bin`;
}

export function sampleSql(): string {
  return `WITH ${holdoutSql()}
    SELECT round(gap_ratio, 5) AS gap_magnitude_in_average_ranges,
           round(range_points, 4) AS average_range_10_bars_points,
           round(gap_ratio * range_points, 4) AS gap_magnitude_points,
           round(gap_ratio * range_points / ${TICK_SIZE_POINTS}, 3) AS gap_magnitude_ticks_per_bar
    FROM holdout
    WHERE range_points IS NOT NULL AND hash(bar_timestamp) % 20 = 0
    ORDER BY bar_timestamp`;
}

function ladderSql(ordering: "derivatives_first" | "volume_first", view: string): string {
  return `SELECT ${text(ordering)} AS ordering, CAST(rung_index AS INTEGER) AS rung_index, block_added,
            CAST(feature_count AS INTEGER) AS feature_count, CAST(train_row_count AS INTEGER) AS train_row_count,
            CAST(test_row_count AS INTEGER) AS test_row_count, score_holdout, score_increment_over_previous_rung,
            shuffled_block_score_mean, shuffled_block_score_best_of_five, beats_its_shuffled_control,
            metric, timeframe, recipe, target
     FROM ${ident(view)}`;
}

function toBins(counts: Array<{ bin: number; bar_count: number }>, bins: number, maxTicks: number): GapBin[] {
  const width = maxTicks / bins;
  const byBin = new Map(counts.map((row) => [Number(row.bin), Number(row.bar_count)]));
  return Array.from({ length: bins }, (_, index) => ({ lower: index * width, upper: (index + 1) * width, count: byBin.get(index) ?? 0 }));
}

function columnsOf(rows: Array<Record<string, number>>): Record<string, number[]> {
  const columns: Record<string, number[]> = {};
  for (const row of rows) for (const [name, value] of Object.entries(row)) (columns[name] ??= []).push(Number(value));
  return columns;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ratio(top: number | null, bottom: number | null): number | null {
  return top !== null && bottom !== null && bottom !== 0 ? top / bottom : null;
}

async function gapBody(context: StudyContext, parameters: Query): Promise<GapBody | null> {
  const totals = await context.lake.query<{ holdout_bar_count: number }>(
    `SELECT count(*) AS holdout_bar_count FROM ${ident(VIEW_BARS)} WHERE sample_split = 'holdout'`,
  );
  const holdoutBarCount = Number(totals[0]?.holdout_bar_count ?? 0);
  const stats = (await context.lake.query<Record<string, unknown>>(statisticsSql()))[0];
  if (!stats) return null;
  const gapBarCount = Number(stats.gap_bar_count ?? 0);
  const meanRangePoints = numberOrNull(stats.mean_range_points);
  if (gapBarCount === 0 || meanRangePoints === null) {
    context.notes.push("The holdout has no bar with a known next open; the gap section is empty.");
    return null;
  }

  const summaries: ColumnSummary[] = SUMMARY_COLUMNS.map((entry, index) => ({
    column: entry.column,
    count: Number(stats[`c${index}_count`] ?? 0),
    mean: numberOrNull(stats[`c${index}_mean`]),
    median: numberOrNull(stats[`c${index}_median`]),
    standardDeviation: numberOrNull(stats[`c${index}_standard_deviation`]),
    skewness: numberOrNull(stats[`c${index}_skewness`]),
    kurtosis: numberOrNull(stats[`c${index}_kurtosis`]),
    percentile25: numberOrNull(stats[`c${index}_percentile25`]),
    percentile75: numberOrNull(stats[`c${index}_percentile75`]),
    minimum: numberOrNull(stats[`c${index}_minimum`]),
    maximum: numberOrNull(stats[`c${index}_maximum`]),
  }));
  const ratioSummary = summaries[0] as ColumnSummary;
  const perBarSummary = summaries[3] as ColumnSummary;

  const maxTicks = (parameters.clip * meanRangePoints) / TICK_SIZE_POINTS;
  const [meanRangeCounts, perBarCounts, sample] = await Promise.all([
    context.lake.query<{ bin: number; bar_count: number }>(histogramSql("mean_range", parameters.bins, parameters.clip, meanRangePoints)),
    context.lake.query<{ bin: number; bar_count: number }>(histogramSql("per_bar", parameters.bins, parameters.clip, meanRangePoints)),
    context.lake.query<Record<string, number>>(sampleSql()),
  ]);
  const histogramAtMeanRange = toBins(meanRangeCounts, parameters.bins, maxTicks);
  const histogramPerBar = toBins(perBarCounts, parameters.bins, maxTicks);
  const keptAtMeanRange = histogramAtMeanRange.reduce((total, bin) => total + bin.count, 0);
  const keptPerBar = histogramPerBar.reduce((total, bin) => total + bin.count, 0);

  const edgeBarCount = Number(stats.edge_bar_count ?? 0);
  const edgeMean = numberOrNull(stats.edge_mean_gap_ratio);
  const otherMean = numberOrNull(stats.other_mean_gap_ratio);
  const sessionEdge: SessionEdgeCheck = {
    edgeBarCount,
    edgeShare: gapBarCount > 0 ? edgeBarCount / gapBarCount : null,
    meanGapRatioAtEdge: edgeMean,
    meanGapRatioElsewhere: otherMean,
    edgeMultiple: ratio(edgeMean, otherMean),
    squaredGapShare: ratio(numberOrNull(stats.edge_squared_gap), numberOrNull(stats.total_squared_gap)),
  };

  return {
    holdoutBarCount,
    gapBarCount,
    meanRangePoints,
    notebookMeanGapTicks: ratioSummary.mean === null ? null : (ratioSummary.mean * meanRangePoints) / TICK_SIZE_POINTS,
    notebookMedianGapTicks: ratioSummary.median === null ? null : (ratioSummary.median * meanRangePoints) / TICK_SIZE_POINTS,
    perBarMeanGapTicks: perBarSummary.mean,
    perBarMedianGapTicks: perBarSummary.median,
    histogramAtMeanRange,
    keptShareAtMeanRange: keptAtMeanRange / gapBarCount,
    histogramPerBar,
    keptSharePerBar: perBarSummary.count > 0 ? keptPerBar / perBarSummary.count : null,
    clipAverageRanges: parameters.clip,
    clipTicks: maxTicks,
    summaries,
    sessionEdge,
    sampleColumns: columnsOf(sample),
    sampleFraction: 0.05,
  };
}

const handler: StudyHandler<typeof query, FeatureLadderBody> = {
  slug: "feature-ladder-what-to-encode",
  datasets: [VIEW_DERIVATIVES_FIRST, VIEW_VOLUME_FIRST, VIEW_BARS],
  query,
  cacheSeconds: 600,
  async run(parameters, context) {
    const missing = await missingViews(context, [VIEW_DERIVATIVES_FIRST, VIEW_VOLUME_FIRST, VIEW_BARS]);
    const ladderParts: string[] = [];
    if (!missing.includes(VIEW_DERIVATIVES_FIRST)) ladderParts.push(ladderSql("derivatives_first", VIEW_DERIVATIVES_FIRST));
    if (!missing.includes(VIEW_VOLUME_FIRST)) ladderParts.push(ladderSql("volume_first", VIEW_VOLUME_FIRST));

    const ladder: LadderRow[] =
      ladderParts.length === 0
        ? []
        : await context.lake.query<LadderRow>(`${ladderParts.join("\nUNION ALL\n")}\nORDER BY ordering, target, rung_index`);

    if (missing.includes(VIEW_BARS)) return { ladder, totalBarCount: null, gap: null };
    const total = await context.lake.query<{ total_bar_count: number }>(`SELECT count(*) AS total_bar_count FROM ${ident(VIEW_BARS)}`);
    return { ladder, totalBarCount: Number(total[0]?.total_bar_count ?? 0), gap: await gapBody(context, parameters) };
  },
};

export default handler;
