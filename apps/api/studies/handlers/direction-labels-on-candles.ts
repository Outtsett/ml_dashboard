/**
 * Direction labels on real candles. Replaced
 * Trading/quant/model/notebooks/direction_on_candles.py.
 *
 * Reads two snapshot views of the lake, `mnq_ohlcv_1m` (the bars) and
 * `mnq_labels_1m` (the stored labels, `dir_h{H}`), and joins them in DuckDB
 * exactly as the notebook did. Three parts, so the slow one-off scans are
 * cached apart from the window a control moves:
 *
 *   overview  counts, per-horizon up-rate and forward-move distribution, ranked sessions
 *   window    one window of joined bars (session preset or date, bar count)
 *   proof     every stored label re-derived from the joined closes (lead over the whole table)
 *
 * The aliases turn the lake's abbreviated columns (`dir_h15`, `range_pts`) into
 * full-word names in the body, per the column-naming rule.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler, StudyLake } from "../types";
import {
  DIRECTION_HORIZONS, ELIGIBLE_MINIMUM_BARS, addDays, emptyBars, isCalendarDate, modalSpacingSeconds, pickDays, upRate,
  type DayRow, type EightNumbers, type HistogramBar, type HorizonSummary, type OverviewBody, type ProofBody,
  type ProofHorizon, type WindowBars, type WindowBody, type WindowPreset,
} from "@shared/studies/direction-labels-on-candles";

const BARS_VIEW = "mnq_ohlcv_1m";
const LABELS_VIEW = "mnq_labels_1m";
const RANKING_SINCE = "2024-01-01";
const HISTOGRAM_BINS = 40;
const BARS_PER_SESSION = 1380;

type Part = "overview" | "window" | "proof";
export type DirectionLabelsBody = OverviewBody | WindowBody | ProofBody;

const querySchema = z.object({
  part: z.enum(["overview", "window", "proof"]).default("overview"),
  preset: z.enum(["busiest", "calmest", "median", "date"]).default("busiest"),
  date: z.string().refine(isCalendarDate, "a calendar date written YYYY-MM-DD").optional(),
  bars: z.coerce.number().int().min(240).max(6000).default(2600),
});
type Query = z.infer<typeof querySchema>;

function costModel(): { pointValueUsd: number; roundTripCostUsd: number } {
  try {
    const model = JSON.parse(readFileSync(path.resolve(process.cwd(), "packages/config/cost_model.json"), "utf8")) as Record<
      string, { point_value?: number; total_round_trip?: number }
    >;
    return { pointValueUsd: model.MNQ?.point_value ?? 2, roundTripCostUsd: model.MNQ?.total_round_trip ?? 2.78 };
  } catch {
    return { pointValueUsd: 2, roundTripCostUsd: 2.78 };
  }
}

const EMPTY_EIGHT: EightNumbers = {
  count: 0, mean: null, median: null, standardDeviation: null, skewness: null, kurtosis: null,
  percentile25: null, percentile75: null, minimum: null, maximum: null,
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ── SQL ──────────────────────────────────────────────────────────────────────

/** Sessions ranked by summed realised range since RANKING_SINCE, one row per calendar day. */
export function dayRankingSql(): string {
  return (
    "SELECT CAST(CAST(time_bucket(INTERVAL '1 day', timestamp) AS DATE) AS VARCHAR) AS day, " +
    "sum(range_pts) AS summed_range_points, count(*) AS bar_count " +
    `FROM ${ident(LABELS_VIEW)} WHERE timestamp > TIMESTAMP ${text(RANKING_SINCE)} GROUP BY 1 ORDER BY 1`
  );
}

/** Bars and labels joined on the timestamp, for [dayStart, dayEnd), oldest first, at most `limit` rows. */
export function windowSql(dayStart: string, dayEnd: string, limit: number): string {
  const labelColumns = DIRECTION_HORIZONS.map((h) => `l.${ident(`dir_h${h}`)} AS ${ident(`label_${h}`)}`).join(", ");
  return (
    "SELECT CAST(epoch(o.timestamp) AS BIGINT) AS timestamp_seconds, o.open, o.high, o.low, o.close, o.volume, " +
    `${labelColumns}, l.dir_delta_pts_h15 AS forward_change_points_horizon_15 ` +
    `FROM ${ident(BARS_VIEW)} o INNER JOIN ${ident(LABELS_VIEW)} l ON o.timestamp = l.timestamp ` +
    `WHERE o.timestamp >= TIMESTAMPTZ ${text(`${dayStart} 00:00:00+00`)} AND o.timestamp < TIMESTAMPTZ ${text(`${dayEnd} 00:00:00+00`)} ` +
    `ORDER BY o.timestamp LIMIT ${num(limit)}`
  );
}

/** One row of the forward-move eight numbers, up-rate and clip bounds for a horizon, over the whole labels table. */
export function horizonStatsSql(horizon: number): string {
  const label = ident(`dir_h${horizon}`);
  const move = ident(`dir_delta_pts_h${horizon}`);
  return (
    "WITH t AS (SELECT " +
    `CASE WHEN isfinite(${label}) THEN ${label} END AS label, ` +
    `CASE WHEN isfinite(${move}) THEN ${move} END AS move FROM ${ident(LABELS_VIEW)}) ` +
    "SELECT count(label) AS labeled_rows, avg(label) AS up_rate, count(move) AS move_count, avg(move) AS move_mean, " +
    "quantile_cont(move, 0.5) AS move_median, stddev_samp(move) AS move_standard_deviation, " +
    "skewness(move) AS move_skewness, kurtosis(move) AS move_kurtosis, " +
    "quantile_cont(move, 0.25) AS move_percentile_25, quantile_cont(move, 0.75) AS move_percentile_75, " +
    "min(move) AS move_minimum, max(move) AS move_maximum, " +
    "quantile_cont(move, 0.01) AS clip_low, quantile_cont(move, 0.99) AS clip_high, " +
    "quantile_cont(abs(move), 0.5) AS median_absolute_move FROM t"
  );
}

export function horizonHistogramSql(horizon: number, low: number, high: number): string {
  const move = ident(`dir_delta_pts_h${horizon}`);
  const width = (high - low) / HISTOGRAM_BINS;
  return (
    `SELECT CAST(least(greatest(floor((${move} - ${num(low)}) / ${num(width)}), 0), ${HISTOGRAM_BINS - 1}) AS INTEGER) AS bin, ` +
    `count(*) AS count FROM ${ident(LABELS_VIEW)} WHERE isfinite(${move}) GROUP BY 1 ORDER BY 1`
  );
}

/**
 * Every stored label re-derived from the joined closes over the whole table.
 * `lead(close, H)` is the close H bars later in timestamp order; the stored
 * label must equal (that close > this close). The negative control shifts the
 * stored label by one bar (`lag(label, 1)`), which has to disagree.
 */
export function proofSql(): string {
  const leads = DIRECTION_HORIZONS.map((h) => `lead(o.close, ${h}) OVER w AS close_ahead_${h}`).join(", ");
  const labels = DIRECTION_HORIZONS.map((h) => `l.${ident(`dir_h${h}`)} AS label_${h}, l.${ident(`dir_delta_pts_h${h}`)} AS delta_${h}, lag(l.${ident(`dir_h${h}`)}, 1) OVER w AS shifted_${h}`).join(", ");
  const aggregates = DIRECTION_HORIZONS.map((h) => {
    const known = `isfinite(label_${h}) AND close_ahead_${h} IS NOT NULL`;
    const shiftedKnown = `isfinite(shifted_${h}) AND close_ahead_${h} IS NOT NULL`;
    const deltaKnown = `isfinite(delta_${h}) AND close_ahead_${h} IS NOT NULL`;
    return (
      `count(*) FILTER (WHERE ${known}) AS compared_${h}, ` +
      `count(*) FILTER (WHERE ${known} AND label_${h} <> CAST(close_ahead_${h} > close AS DOUBLE)) AS mismatches_${h}, ` +
      `count(*) FILTER (WHERE ${deltaKnown}) AS delta_compared_${h}, ` +
      `max(abs(delta_${h} - (close_ahead_${h} - close))) FILTER (WHERE ${deltaKnown}) AS delta_error_${h}, ` +
      `count(*) FILTER (WHERE ${shiftedKnown}) AS control_compared_${h}, ` +
      `count(*) FILTER (WHERE ${shiftedKnown} AND shifted_${h} <> CAST(close_ahead_${h} > close AS DOUBLE)) AS control_mismatches_${h}`
    );
  }).join(", ");
  return (
    `WITH joined AS (SELECT o.timestamp, o.close, ${labels}, ${leads} ` +
    `FROM ${ident(BARS_VIEW)} o INNER JOIN ${ident(LABELS_VIEW)} l ON o.timestamp = l.timestamp ` +
    "WINDOW w AS (ORDER BY o.timestamp)) " +
    `SELECT count(*) AS joined_rows, ${aggregates} FROM joined`
  );
}

// ── loaders ──────────────────────────────────────────────────────────────────

const rankingCache = new WeakMap<StudyLake, { at: number; rows: DayRow[] }>();
const RANKING_TTL_MS = 10 * 60_000;

async function rankedDays(lake: StudyLake): Promise<DayRow[]> {
  const cached = rankingCache.get(lake);
  if (cached && Date.now() - cached.at < RANKING_TTL_MS) return cached.rows;
  const rows = await lake.query<{ day: string; summed_range_points: number | null; bar_count: number }>(dayRankingSql());
  const days = rows.map((row) => ({
    day: String(row.day), summedRangePoints: finite(row.summed_range_points) ?? 0, barCount: Number(row.bar_count),
  }));
  rankingCache.set(lake, { at: Date.now(), rows: days });
  return days;
}

async function overview(context: StudyContext): Promise<OverviewBody> {
  const { lake } = context;
  const { pointValueUsd, roundTripCostUsd } = costModel();
  const [ohlcv] = await lake.query<{ n: number }>(`SELECT count(*) AS n FROM ${ident(BARS_VIEW)}`);
  const [labels] = await lake.query<{ n: number }>(`SELECT count(*) AS n FROM ${ident(LABELS_VIEW)}`);
  const [joined] = await lake.query<{ joined_rows: number; first_day: string | null; last_day: string | null }>(
    "SELECT count(*) AS joined_rows, CAST(CAST(min(o.timestamp) AS DATE) AS VARCHAR) AS first_day, " +
      `CAST(CAST(max(o.timestamp) AS DATE) AS VARCHAR) AS last_day FROM ${ident(BARS_VIEW)} o INNER JOIN ${ident(LABELS_VIEW)} l ON o.timestamp = l.timestamp`,
  );

  const horizons: HorizonSummary[] = [];
  for (const horizon of DIRECTION_HORIZONS) {
    const [stats] = await lake.query<Record<string, number | null>>(horizonStatsSql(horizon));
    const low = finite(stats?.clip_low);
    const high = finite(stats?.clip_high);
    let histogram: HistogramBar[] = [];
    if (low !== null && high !== null) {
      if (high > low) {
        const width = (high - low) / HISTOGRAM_BINS;
        const counts = await lake.query<{ bin: number; count: number }>(horizonHistogramSql(horizon, low, high));
        histogram = Array.from({ length: HISTOGRAM_BINS }, (_, i) => ({ lower: low + i * width, upper: low + (i + 1) * width, count: 0 }));
        for (const row of counts) {
          const bar = histogram[Number(row.bin)];
          if (bar) bar.count = Number(row.count);
        }
      } else {
        histogram = [{ lower: low, upper: high, count: Number(stats?.move_count ?? 0) }];
      }
    }
    horizons.push({
      horizon,
      labeledRows: Number(stats?.labeled_rows ?? 0),
      upRate: finite(stats?.up_rate),
      medianAbsoluteMovePoints: finite(stats?.median_absolute_move),
      move: stats
        ? {
            count: Number(stats.move_count ?? 0), mean: finite(stats.move_mean), median: finite(stats.move_median),
            standardDeviation: finite(stats.move_standard_deviation), skewness: finite(stats.move_skewness),
            kurtosis: finite(stats.move_kurtosis), percentile25: finite(stats.move_percentile_25),
            percentile75: finite(stats.move_percentile_75), minimum: finite(stats.move_minimum), maximum: finite(stats.move_maximum),
          }
        : EMPTY_EIGHT,
      histogram,
    });
  }

  const days = await rankedDays(lake);
  const picked = pickDays(days);
  context.notes.push(
    `${LABELS_VIEW} is the legacy label snapshot: abbreviated lake column names (shown here in full words) and no ingest manifest. ` +
      "Futures stamps are Pacific wall clock stored as UTC, so every time on this page is wall-clock digits, not UTC.",
  );
  const barCount = Number(ohlcv?.n ?? 0);
  const joinedRows = Number(joined?.joined_rows ?? 0);
  return {
    ohlcvRows: barCount,
    labelRows: Number(labels?.n ?? 0),
    joinedRows,
    droppedBars: barCount - joinedRows,
    firstDay: joined?.first_day ?? null,
    lastDay: joined?.last_day ?? null,
    horizons,
    rankingSince: RANKING_SINCE,
    eligibleMinimumBars: ELIGIBLE_MINIMUM_BARS,
    busiest: picked.busiest,
    calmest: picked.calmest,
    median: picked.median,
    dayCount: days.length,
    eligibleDayCount: picked.eligibleDayCount,
    pointValueUsd,
    roundTripCostUsd,
  };
}

function resolveDay(query: Query, days: DayRow[]): { day: string | null; row: DayRow | null } {
  if (query.preset === "date") {
    const day = query.date ?? null;
    return { day, row: day ? (days.find((row) => row.day === day) ?? null) : null };
  }
  const picked = pickDays(days);
  const row = query.preset === "busiest" ? (picked.busiest[0] ?? null) : query.preset === "calmest" ? picked.calmest : picked.median;
  return { day: row?.day ?? null, row };
}

type WindowRow = Record<string, number | null>;

function barsFromRows(rows: WindowRow[]): WindowBars {
  const bars = emptyBars();
  for (const horizon of DIRECTION_HORIZONS) bars.directionLabels[String(horizon)] = [];
  for (const row of rows) {
    bars.timestampSeconds.push(Number(row.timestamp_seconds));
    bars.open.push(Number(row.open));
    bars.high.push(Number(row.high));
    bars.low.push(Number(row.low));
    bars.close.push(Number(row.close));
    bars.volume.push(finite(row.volume));
    for (const horizon of DIRECTION_HORIZONS) {
      const value = finite(row[`label_${horizon}`]);
      bars.directionLabels[String(horizon)]?.push(value === 1 ? 1 : value === 0 ? 0 : null);
    }
    bars.forwardChangePointsHorizon15.push(finite(row.forward_change_points_horizon_15));
  }
  return bars;
}

async function windowPart(query: Query, context: StudyContext): Promise<WindowBody> {
  const { lake } = context;
  const days = await rankedDays(lake);
  const { day, row } = resolveDay(query, days);
  const empty: WindowBody = {
    preset: query.preset as WindowPreset, day, dayRow: row, requestedBars: query.bars, barCount: 0, bars: emptyBars(),
    modalSpacingSeconds: null, upRates: [],
  };
  if (!day) {
    context.notes.push(query.preset === "date" ? "Pick a date to draw." : "No session could be ranked for this preset.");
    return empty;
  }
  // Enough calendar days past the start that `bars` one-minute bars exist (a session holds ~1,380), as the notebook's four days did for 2,600.
  const dayEnd = addDays(day, Math.ceil(query.bars / BARS_PER_SESSION) + 2);
  const rows = await lake.query<WindowRow>(windowSql(day, dayEnd, query.bars));
  if (rows.length === 0) {
    context.notes.push(`No joined bars start on ${day}; the labels table ends where the bars continue (see the overview).`);
    return empty;
  }
  const bars = barsFromRows(rows);
  return {
    ...empty,
    barCount: rows.length,
    bars,
    modalSpacingSeconds: modalSpacingSeconds(bars.timestampSeconds),
    upRates: DIRECTION_HORIZONS.map((horizon) => {
      const { labeled, upRate: rate } = upRate(bars.directionLabels[String(horizon)] ?? []);
      return { horizon, labeledBars: labeled, upRate: rate };
    }),
  };
}

async function proofPart(context: StudyContext): Promise<ProofBody> {
  const [row] = await context.lake.query<Record<string, number | null>>(proofSql());
  const horizons: ProofHorizon[] = DIRECTION_HORIZONS.map((horizon) => ({
    horizon,
    compared: Number(row?.[`compared_${horizon}`] ?? 0),
    mismatches: Number(row?.[`mismatches_${horizon}`] ?? 0),
    deltaCompared: Number(row?.[`delta_compared_${horizon}`] ?? 0),
    deltaMaxAbsoluteErrorPoints: finite(row?.[`delta_error_${horizon}`]),
    negativeControlCompared: Number(row?.[`control_compared_${horizon}`] ?? 0),
    negativeControlMismatches: Number(row?.[`control_mismatches_${horizon}`] ?? 0),
  }));
  return { joinedRows: Number(row?.joined_rows ?? 0), horizons };
}

function emptyFor(part: Part): DirectionLabelsBody {
  if (part === "proof") return { joinedRows: 0, horizons: [] };
  if (part === "window") {
    return { preset: "busiest", day: null, dayRow: null, requestedBars: 0, barCount: 0, bars: emptyBars(), modalSpacingSeconds: null, upRates: [] };
  }
  const { pointValueUsd, roundTripCostUsd } = costModel();
  return {
    ohlcvRows: 0, labelRows: 0, joinedRows: 0, droppedBars: 0, firstDay: null, lastDay: null, horizons: [],
    rankingSince: RANKING_SINCE, eligibleMinimumBars: ELIGIBLE_MINIMUM_BARS, busiest: [], calmest: null, median: null,
    dayCount: 0, eligibleDayCount: 0, pointValueUsd, roundTripCostUsd,
  };
}

const handler: StudyHandler<typeof querySchema, DirectionLabelsBody> = {
  slug: "direction-labels-on-candles",
  datasets: [BARS_VIEW, LABELS_VIEW],
  query: querySchema,
  cacheSeconds: 1800,
  timeoutMs: 180_000,
  async run(query, context) {
    if ((await missingViews(context, [BARS_VIEW, LABELS_VIEW])).length > 0) return emptyFor(query.part);
    if (query.part === "window") return windowPart(query, context);
    if (query.part === "proof") return proofPart(context);
    return overview(context);
  },
};

export default handler;
