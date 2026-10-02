/**
 * Label audit: every supervised target in the quant workspace, measured on MNQ
 * 1m. Replaced Trading/quant/model/notebooks/label_audit.py.
 *
 * Live, over the stored labels `mnq_labels_1m` (2,340,445 span-aligned bars):
 * direction up-rate and majority baseline per horizon and per year, the flat
 * dead zone at any threshold, range-bucket occupancy at any bucket size, the
 * log-range distribution floored or masked, and the shift-arithmetic control at
 * any shift. Landed by packages/ml-engine/src/studies/label_audit_1m/build.py with the
 * notebook's own generators and pinned pre-2026-08-02 parameters, read from
 * `derived_study_label_audit_1m_<table>`: the persistence baselines, the
 * triple-barrier and swing sweeps, the inventory, the purge audit, the findings.
 */

import { z } from "zod";
import { ident, num } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  DIRECTION_HORIZONS, NOTEBOOK_FLAT_THRESHOLDS, TICK_POINTS, fillBuckets, flatCurve, flatPoint, magnitudeQuantile, majorityBaseline, rangeSummary,
  type BarrierRow, type Coverage, type DirectionHorizonRow, type DirectionYearRow, type FindingRow, type HistogramBin, type InventoryRow,
  type LabelAuditBody, type MagnitudeGroup, type ProvenanceRow, type PurgeAuditRow, type RangeBucketRow, type SwingRow,
  type VolatilityBaselineRow, type VolatilitySummary,
} from "@shared/studies/label-audit-1m";
import type { LensEightNumberSummary } from "@shared/lens/types";

const LABELS = "mnq_labels_1m";
const BARS = "mnq_ohlcv_1m";
const RECORD_TABLES = [
  "provenance", "inventory", "purge_audit", "findings", "volatility_summary", "volatility_baseline", "range_occupancy", "barrier_grid", "swing_grid",
] as const;
type RecordTable = (typeof RECORD_TABLES)[number];
const recordView = (table: RecordTable) => `derived_study_label_audit_1m_${table}`;
const RECORD_VIEWS = RECORD_TABLES.map(recordView);

/** The bars around the most recent zero-range bar, for the persistence-forecast walk-through. */
const SAMPLE_BARS = 120;

const onTickGrid = (value: number) => Math.abs(value / TICK_POINTS - Math.round(value / TICK_POINTS)) < 1e-9;

const querySchema = z.object({
  horizon: z.coerce.number().int().refine((value) => (DIRECTION_HORIZONS as readonly number[]).includes(value), "one of 1, 5, 15, 60, 90, 240, 1440").default(1440),
  flatThreshold: z.coerce.number().min(0).max(5000).refine(onTickGrid, "a multiple of 0.25 points").default(0),
  bucketSize: z.coerce.number().min(0.25).max(10).refine(onTickGrid, "a multiple of 0.25 points").default(2),
  bucketCount: z.coerce.number().int().min(3).max(61).refine((value) => value % 2 === 1, "odd, so zero has its own bucket").default(21),
  bins: z.coerce.number().int().min(10).max(240).default(120),
  cutoff: z.coerce.number().min(-22).max(2).default(-5),
  policy: z.enum(["floored", "masked"]).default("floored"),
  shiftBars: z.coerce.number().int().min(1).max(240).default(7),
});
type Query = z.infer<typeof querySchema>;

type Row = Record<string, unknown>;

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function count(value: unknown): number {
  return number(value) ?? 0;
}

/** The log-range expression for a zero-range policy: the pre-fix floor, or the stored masked value. */
function logRangeExpression(policy: Query["policy"]): string {
  return policy === "floored" ? `CASE WHEN "zero_range" THEN ln(1e-9) ELSE "logrange" END` : `"logrange"`;
}

async function coverage(context: StudyContext): Promise<Coverage> {
  const [row] = await context.lake.query<Row>(
    `SELECT (SELECT count(*) FROM ${ident(BARS)}) AS lake_bar_count,
            (SELECT epoch_ms(min("timestamp")) FROM ${ident(BARS)}) AS lake_first_timestamp,
            (SELECT epoch_ms(max("timestamp")) FROM ${ident(BARS)}) AS lake_last_timestamp,
            count(*) AS labelled_bar_count,
            epoch_ms(min("timestamp")) AS labelled_first_timestamp,
            epoch_ms(max("timestamp")) AS labelled_last_timestamp
       FROM ${ident(LABELS)}`,
  );
  return {
    lake_bar_count: count(row?.lake_bar_count),
    lake_first_timestamp: number(row?.lake_first_timestamp),
    lake_last_timestamp: number(row?.lake_last_timestamp),
    labelled_bar_count: count(row?.labelled_bar_count),
    labelled_first_timestamp: number(row?.labelled_first_timestamp),
    labelled_last_timestamp: number(row?.labelled_last_timestamp),
  };
}

async function directionByHorizon(context: StudyContext): Promise<DirectionHorizonRow[]> {
  const columns = DIRECTION_HORIZONS.map((horizon) => {
    const column = ident(`dir_h${horizon}`);
    return `count(${column}) AS ${ident(`valid_${horizon}`)}, avg(${column}) AS ${ident(`up_${horizon}`)}`;
  }).join(", ");
  const [row] = await context.lake.query<Row>(`SELECT ${columns} FROM ${ident(LABELS)}`);
  return DIRECTION_HORIZONS.map((horizon) => {
    const upRate = number(row?.[`up_${horizon}`]);
    const baseline = majorityBaseline(upRate);
    return {
      horizon_bars: horizon,
      valid_bar_count: count(row?.[`valid_${horizon}`]),
      up_rate: upRate,
      majority_baseline: baseline,
      free_edge_over_coin_flip: baseline === null ? null : baseline - 0.5,
    };
  });
}

async function directionByYear(context: StudyContext, horizon: number): Promise<DirectionYearRow[]> {
  const column = ident(`dir_h${horizon}`);
  const rows = await context.lake.query<Row>(
    `SELECT year(timezone('UTC', "timestamp")) AS year, count(${column}) AS valid_bar_count, avg(${column}) AS up_rate
       FROM ${ident(LABELS)} WHERE ${column} IS NOT NULL GROUP BY 1 ORDER BY 1`,
  );
  return rows.map((row) => {
    const upRate = number(row.up_rate);
    return { year: count(row.year), valid_bar_count: count(row.valid_bar_count), up_rate: upRate, majority_baseline: majorityBaseline(upRate) };
  });
}

async function magnitudeGroups(context: StudyContext, horizon: number): Promise<MagnitudeGroup[]> {
  const delta = ident(`dir_delta_pts_h${horizon}`);
  const label = ident(`dir_h${horizon}`);
  const rows = await context.lake.query<Row>(
    `SELECT CAST(round(abs(${delta}) / ${num(TICK_POINTS)}) AS BIGINT) AS ticks, count(*) AS bar_count, sum(${label}) AS up_count
       FROM ${ident(LABELS)} WHERE ${delta} IS NOT NULL GROUP BY 1 ORDER BY 1`,
  );
  return rows.map((row) => ({ ticks: count(row.ticks), bar_count: count(row.bar_count), up_count: count(row.up_count) }));
}

async function rangeOccupancy(context: StudyContext, bucketSize: number, bucketCount: number): Promise<RangeBucketRow[]> {
  const delta = ident("dir_delta_pts_h1");
  const rows = await context.lake.query<Row>(
    `SELECT CAST(least(greatest(floor(${delta} / ${num(bucketSize)} + ${num((bucketCount - 1) / 2)} + 0.5), 0), ${num(bucketCount - 1)}) AS BIGINT) AS bucket_index,
            count(*) AS bar_count
       FROM ${ident(LABELS)} WHERE ${delta} IS NOT NULL GROUP BY 1 ORDER BY 1`,
  );
  return fillBuckets(rows.map((row) => ({ bucket_index: count(row.bucket_index), bar_count: count(row.bar_count) })), bucketSize, bucketCount);
}

const RANGE_QUANTILES = [0.5, 0.68, 0.9, 0.99] as const;

async function rangeQuantiles(context: StudyContext): Promise<Array<{ quantile: number; points: number | null }>> {
  const delta = ident("dir_delta_pts_h1");
  const columns = RANGE_QUANTILES.map((quantile, index) => `quantile_cont(abs(${delta}), ${num(quantile)}) AS ${ident(`q${index}`)}`).join(", ");
  const [row] = await context.lake.query<Row>(`SELECT ${columns} FROM ${ident(LABELS)} WHERE ${delta} IS NOT NULL`);
  return RANGE_QUANTILES.map((quantile, index) => ({ quantile, points: number(row?.[`q${index}`]) }));
}

async function logRangeEight(context: StudyContext, policy: Query["policy"]): Promise<LensEightNumberSummary> {
  const [row] = await context.lake.query<Row>(
    `WITH values_ AS (SELECT ${logRangeExpression(policy)} AS x FROM ${ident(LABELS)})
     SELECT count(x) AS count, avg(x) AS mean, median(x) AS median, stddev_pop(x) AS standard_deviation, skewness(x) AS skewness,
            kurtosis(x) AS kurtosis, quantile_cont(x, 0.25) AS percentile25, quantile_cont(x, 0.75) AS percentile75, min(x) AS minimum, max(x) AS maximum
       FROM values_`,
  );
  return {
    count: count(row?.count),
    mean: number(row?.mean),
    median: number(row?.median),
    standardDeviation: number(row?.standard_deviation),
    skewness: number(row?.skewness),
    kurtosis: number(row?.kurtosis),
    percentile25: number(row?.percentile25),
    percentile75: number(row?.percentile75),
    minimum: number(row?.minimum),
    maximum: number(row?.maximum),
  };
}

/**
 * The forward target's histogram: the next bar's log-range is log_range[t + 1],
 * so the values are the contemporaneous series without its first bar.
 */
async function logRangeHistogram(context: StudyContext, query: Query) {
  const rows = await context.lake.query<Row>(
    `WITH values_ AS (
        SELECT ${logRangeExpression(query.policy)} AS x FROM ${ident(LABELS)}
         WHERE "timestamp" > (SELECT min("timestamp") FROM ${ident(LABELS)})
     ), shown AS (SELECT x FROM values_ WHERE x > ${num(query.cutoff)}),
     bounds AS (SELECT min(x) AS lower_edge, max(x) AS upper_edge, median(x) AS middle FROM shown)
     SELECT coalesce(least(CAST(floor((x - lower_edge) / nullif(upper_edge - lower_edge, 0) * ${num(query.bins)}) AS BIGINT), ${num(query.bins - 1)}), 0) AS bin,
            count(*) AS count, any_value(lower_edge) AS lower_edge, any_value(upper_edge) AS upper_edge, any_value(middle) AS middle,
            (SELECT count(*) FROM values_ WHERE x <= ${num(query.cutoff)}) AS below_cutoff
       FROM shown, bounds GROUP BY 1 ORDER BY 1`,
  );
  const first = rows[0];
  const lower = number(first?.lower_edge);
  const upper = number(first?.upper_edge);
  const width = lower !== null && upper !== null ? (upper - lower) / query.bins : 0;
  const byBin = new Map(rows.map((row) => [count(row.bin), count(row.count)]));
  const histogram: HistogramBin[] = [];
  if (lower !== null && upper !== null) {
    for (let bin = 0; bin < query.bins; bin += 1) {
      histogram.push({ lower: lower + bin * width, upper: lower + (bin + 1) * width, count: byBin.get(bin) ?? 0 });
    }
  }
  return {
    histogram,
    histogramMedian: number(first?.middle),
    shownCount: rows.reduce((sum, row) => sum + count(row.count), 0),
    belowCutoffCount: count(first?.below_cutoff),
  };
}

async function logRangeSample(context: StudyContext, policy: Query["policy"]) {
  const rows = await context.lake.query<Row>(
    `SELECT epoch_ms("timestamp") AS time, ${logRangeExpression(policy)} AS log_range, "zero_range" AS zero_range
       FROM ${ident(LABELS)}
      WHERE "timestamp" >= (SELECT max("timestamp") FROM ${ident(LABELS)} WHERE "zero_range") - INTERVAL ${num(SAMPLE_BARS / 2)} MINUTE
      ORDER BY "timestamp" LIMIT ${num(SAMPLE_BARS)}`,
  );
  return rows.map((row) => ({ time: count(row.time), log_range: number(row.log_range), zero_range: row.zero_range === true }));
}

async function shiftControl(context: StudyContext, shiftBars: number) {
  const base = ident("dir_h15");
  const [row] = await context.lake.query<Row>(
    `WITH shifted AS (
        SELECT lead(${base}, ${num(shiftBars)}) OVER ordered AS by_lead,
               lag(${base}, ${num(shiftBars)}) OVER ordered AS by_lag,
               first_value(${base}) OVER (ORDER BY "timestamp" ROWS BETWEEN ${num(shiftBars)} FOLLOWING AND ${num(shiftBars)} FOLLOWING) AS future
          FROM ${ident(LABELS)} WINDOW ordered AS (ORDER BY "timestamp")
     )
     SELECT max(abs(by_lead - future)) AS honest_maximum, max(abs(by_lag - future)) AS leaky_maximum,
            count(*) FILTER (WHERE by_lag <> future) AS leaky_mismatch_count,
            count(*) FILTER (WHERE by_lag IS NOT NULL AND future IS NOT NULL) AS compared_count
       FROM shifted`,
  );
  return {
    horizon: 15,
    shiftBars,
    honestMaximum: number(row?.honest_maximum),
    leakyMaximum: number(row?.leaky_maximum),
    leakyMismatchCount: count(row?.leaky_mismatch_count),
    comparedCount: count(row?.compared_count),
  };
}

async function record<T>(context: StudyContext, table: RecordTable, orderBy: string): Promise<T[]> {
  return context.lake.query<T>(`SELECT * EXCLUDE (recipe) FROM ${ident(recordView(table))} ORDER BY ${orderBy}`);
}

function emptyBody(query: Query): LabelAuditBody {
  const buckets = fillBuckets([], query.bucketSize, query.bucketCount);
  return {
    labelsServed: false,
    recordServed: false,
    coverage: null,
    provenance: null,
    inventory: [],
    purgeAudit: [],
    findings: [],
    direction: { horizons: [], horizon: query.horizon, years: [], flatCurve: [], flatPinned: [], flatSelected: null, flatCurveMaximum: 0 },
    volatility: { summary: null, baselines: [], policy: query.policy, cutoff: query.cutoff, eight: null, histogram: [], histogramMedian: null, shownCount: 0, belowCutoffCount: 0, sample: [] },
    range: { bucketSize: query.bucketSize, bucketCount: query.bucketCount, occupancy: buckets, summary: rangeSummary(buckets), quantiles: [], suggestedBucketSize: null, pinned: [] },
    barrier: [],
    swing: [],
    shift: null,
  };
}

const handler: StudyHandler<typeof querySchema, LabelAuditBody> = {
  slug: "label-audit-1m",
  datasets: [LABELS, BARS, ...RECORD_VIEWS],
  query: querySchema,
  cacheSeconds: 600,
  async run(query, context) {
    const body = emptyBody(query);
    const missing = await missingViews(context, [LABELS, BARS, ...RECORD_VIEWS]);
    body.labelsServed = !missing.includes(LABELS) && !missing.includes(BARS);
    body.recordServed = RECORD_VIEWS.every((view) => !missing.includes(view));

    if (body.labelsServed) {
      const [covered, horizons, years, groups, occupancy, quantiles, eight, histogram, sample, shift] = await Promise.all([
        coverage(context),
        directionByHorizon(context),
        directionByYear(context, query.horizon),
        magnitudeGroups(context, query.horizon),
        rangeOccupancy(context, query.bucketSize, query.bucketCount),
        rangeQuantiles(context),
        logRangeEight(context, query.policy),
        logRangeHistogram(context, query),
        logRangeSample(context, query.policy),
        shiftControl(context, query.shiftBars),
      ]);
      const curveMaximum = magnitudeQuantile(groups, 0.95) ?? 0;
      const sixtyEighth = quantiles.find((row) => row.quantile === 0.68)?.points ?? null;
      body.coverage = covered;
      body.direction = {
        horizons,
        horizon: query.horizon,
        years,
        flatCurve: flatCurve(groups, curveMaximum),
        flatPinned: NOTEBOOK_FLAT_THRESHOLDS.map((threshold) => flatPoint(groups, threshold)),
        flatSelected: flatPoint(groups, query.flatThreshold),
        flatCurveMaximum: curveMaximum,
      };
      body.volatility = { ...body.volatility, eight, ...histogram, sample };
      body.range = {
        ...body.range,
        occupancy,
        summary: rangeSummary(occupancy),
        quantiles,
        suggestedBucketSize: sixtyEighth === null ? null : sixtyEighth / 3,
      };
      body.shift = shift;
      if (covered.lake_bar_count > covered.labelled_bar_count) {
        context.notes.push(
          `${covered.labelled_bar_count.toLocaleString("en-US")} of the lake's ${covered.lake_bar_count.toLocaleString("en-US")} MNQ 1m bars carry labels: the loader clipped the series to the span every timeframe shares.`,
        );
      }
    }

    if (body.recordServed) {
      const [provenance, inventory, purgeAudit, findings, summary, baselines, pinned, barrier, swing] = await Promise.all([
        record<ProvenanceRow>(context, "provenance", `"built_at"`),
        record<InventoryRow>(context, "inventory", `"is_supervised_label" DESC, "module_path"`),
        record<PurgeAuditRow>(context, "purge_audit", `"reach_covered" DESC, "script"`),
        record<FindingRow>(context, "findings", `"finding_number"`),
        record<VolatilitySummary>(context, "volatility_summary", `"total_bar_count"`),
        record<VolatilityBaselineRow>(context, "volatility_baseline", `"zero_range_policy", "exponential_smoothing_factor"`),
        record<RangeBucketRow>(context, "range_occupancy", `"bucket_index"`),
        record<BarrierRow>(context, "barrier_grid", `"is_shipped_default_before_fix" DESC, "vertical_barrier_bars" DESC, "take_profit_multiple_of_average_true_range"`),
        record<SwingRow>(context, "swing_grid", `"fractal_period_bars", "vertical_barrier_bars"`),
      ]);
      body.provenance = provenance[provenance.length - 1] ?? null;
      body.inventory = inventory;
      body.purgeAudit = purgeAudit;
      body.findings = findings;
      body.volatility.summary = summary[0] ?? null;
      body.volatility.baselines = baselines;
      body.range.pinned = pinned;
      body.barrier = barrier;
      body.swing = swing;
      if (body.provenance && body.provenance.current_loader_bar_count !== body.provenance.audited_bar_count) {
        context.notes.push(
          `The notebook's loader (shared.data.load_ohlcv_arrays) now returns ${body.provenance.current_loader_bar_count.toLocaleString("en-US")} bars from ${body.provenance.current_loader_first_timestamp.slice(0, 10)}, not the ${body.provenance.audited_bar_count.toLocaleString("en-US")} it returned when the audit and the stored labels were made; this page measures the ${body.provenance.audited_bar_count.toLocaleString("en-US")}.`,
        );
      }
    }
    return body;
  },
};

export default handler;
