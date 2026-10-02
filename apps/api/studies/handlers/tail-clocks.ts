/**
 * Tail clocks: how many of a futures series' fat tails does the calendar invent?
 * Replaced datalake/notebooks/tails.py.
 *
 * Reads three views landed by packages/ml-engine/src/studies/tail_clocks/build.py (the
 * notebook's own code path, run once for every root, bar size and clock):
 *   derived_study_tail_clocks_series_summary   one row per (root, bar size, clock)
 *   derived_study_tail_clocks_bar_returns      standardised returns of the first 80% of each series
 *   derived_study_tail_clocks_hourly_volume    contracts per calendar hour of the first 80%
 * Everything the page draws is aggregated here in SQL (histograms, gate counts,
 * moments, the extreme bars thinned to the largest per clock), so the browser
 * receives a few thousand numbers, never the 300,000 returns of a 15-minute series.
 */

import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  BAR_SIZES,
  CLOCK_NAMES,
  EMPTY_BODY,
  HISTOGRAM_BIN_COUNT,
  HISTOGRAM_BIN_WIDTH,
  HISTOGRAM_LOWER,
  LADDER_GATES,
  MINIMUM_ONE_MINUTE_BARS,
  emptyMoments,
  observedOverPredicted,
  predictedBeyond,
  shapeFromMoments,
  type ClockName,
  type ClockSeries,
  type ExtremeBar,
  type GateCount,
  type Moments,
  type TailClocksBody,
} from "@shared/studies/tail-clocks";

const SUMMARY = "derived_study_tail_clocks_series_summary";
const RETURNS = "derived_study_tail_clocks_bar_returns";
const HOURLY = "derived_study_tail_clocks_hourly_volume";

/** Largest bars kept per clock for the scatter and the tables (counts stay exact). */
const EXTREMES_CAP_PER_CLOCK = 1500;
const DEVELOPMENT_FRACTION = 0.8;

const query = z.object({
  root: z.string().regex(/^[A-Za-z0-9]{1,8}$/).default("MNQ"),
  size: z.enum(BAR_SIZES).default("4h"),
  sigma: z.coerce.number().min(1).max(8).default(4),
});

type Query = z.infer<typeof query>;

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface MomentRow {
  clock: string;
  observation_count: number;
  mean_value: number | null;
  median_value: number | null;
  standard_deviation: number | null;
  percentile_25: number | null;
  percentile_75: number | null;
  minimum_value: number | null;
  maximum_value: number | null;
  second_moment: number | null;
  third_moment: number | null;
  fourth_moment: number | null;
}

function momentsFrom(row: MomentRow | undefined): Moments {
  if (!row) return emptyMoments();
  const count = Number(row.observation_count);
  const shape = shapeFromMoments(Number(row.second_moment), Number(row.third_moment), Number(row.fourth_moment), count);
  return {
    count,
    mean: numberOrNull(row.mean_value),
    median: numberOrNull(row.median_value),
    standardDeviation: numberOrNull(row.standard_deviation),
    skewness: shape.skewness,
    kurtosis: shape.kurtosis,
    percentile25: numberOrNull(row.percentile_25),
    percentile75: numberOrNull(row.percentile_75),
    minimum: numberOrNull(row.minimum_value),
    maximum: numberOrNull(row.maximum_value),
  };
}

/** Central moments, quartiles and extremes of one column per clock, for one (root, size). */
function momentSql(column: string, where: string): string {
  const x = ident(column);
  return `
    WITH series AS (SELECT clock, ${x} AS value FROM ${ident(RETURNS)} WHERE ${where}),
    centre AS (SELECT clock, avg(value) AS mean_value FROM series GROUP BY clock)
    SELECT s.clock,
           count(*) AS observation_count,
           any_value(c.mean_value) AS mean_value,
           median(s.value) AS median_value,
           stddev_samp(s.value) AS standard_deviation,
           quantile_cont(s.value, 0.25) AS percentile_25,
           quantile_cont(s.value, 0.75) AS percentile_75,
           min(s.value) AS minimum_value,
           max(s.value) AS maximum_value,
           avg(power(s.value - c.mean_value, 2)) AS second_moment,
           avg(power(s.value - c.mean_value, 3)) AS third_moment,
           avg(power(s.value - c.mean_value, 4)) AS fourth_moment
    FROM series s JOIN centre c USING (clock)
    GROUP BY s.clock`;
}

function byClock<T extends { clock: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [String(row.clock), row]));
}

async function readSeries(query_: Query, gates: number[], context: StudyContext): Promise<ClockSeries[]> {
  const where = `root = ${text(query_.root)} AND bar_size = ${text(query_.size)}`;
  const summaryRows = await context.lake.query<Record<string, unknown>>(
    `SELECT clock, calibration_target_bar_count, bar_count, development_bar_count, return_count, threshold_per_bar, threshold_unit,
            log_return_mean, log_return_standard_deviation, epoch_ms(development_first_bar_timestamp) AS first_milliseconds, epoch_ms(development_last_bar_timestamp) AS last_milliseconds
     FROM ${ident(SUMMARY)} WHERE ${where}`,
  );
  if (summaryRows.length === 0) return [];
  const summaries = byClock(summaryRows as Array<{ clock: string }>);

  const gateColumns = gates
    .map((gate, index) => `count(*) FILTER (WHERE abs(standardised_return) > ${num(gate)}) AS gate_${index}`)
    .join(", ");
  const [standardisedRows, percentRows, gateRows, histogramRows] = await Promise.all([
    context.lake.query<MomentRow>(momentSql("standardised_return", where)),
    context.lake.query<MomentRow>(momentSql("percent_return", where)),
    context.lake.query<Record<string, unknown>>(
      `SELECT clock, count(*) AS return_count, max(abs(standardised_return)) AS biggest_move, ${gateColumns}
       FROM ${ident(RETURNS)} WHERE ${where} GROUP BY clock`,
    ),
    context.lake.query<{ clock: string; bin: number; bar_count: number }>(
      `SELECT clock,
              least(${HISTOGRAM_BIN_COUNT - 1}, floor((standardised_return - ${num(HISTOGRAM_LOWER)}) / ${num(HISTOGRAM_BIN_WIDTH)})::INTEGER) AS bin,
              count(*) AS bar_count
       FROM ${ident(RETURNS)}
       WHERE ${where} AND standardised_return >= ${num(HISTOGRAM_LOWER)} AND standardised_return <= ${num(-HISTOGRAM_LOWER)}
       GROUP BY clock, bin`,
    ),
  ]);
  const standardisedByClock = byClock(standardisedRows);
  const percentByClock = byClock(percentRows);
  const gatesByClock = byClock(gateRows as Array<{ clock: string }>);
  const histogramByClock = new Map<string, number[]>();
  for (const row of histogramRows) {
    const counts = histogramByClock.get(String(row.clock)) ?? new Array<number>(HISTOGRAM_BIN_COUNT).fill(0);
    const bin = Number(row.bin);
    if (bin >= 0 && bin < HISTOGRAM_BIN_COUNT) counts[bin] = Number(row.bar_count);
    histogramByClock.set(String(row.clock), counts);
  }

  const series: ClockSeries[] = [];
  for (const clock of CLOCK_NAMES) {
    const summary = summaries.get(clock) as Record<string, unknown> | undefined;
    const gateRow = gatesByClock.get(clock) as Record<string, unknown> | undefined;
    if (!summary || !gateRow) continue;
    const returnCount = Number(gateRow.return_count);
    const gateCounts: GateCount[] = gates.map((sigma, index) => {
      const observed = Number(gateRow[`gate_${index}`]);
      const predicted = predictedBeyond(returnCount, sigma);
      return { sigma, observed, predicted, ratio: observedOverPredicted(observed, predicted) };
    });
    const selected = gateCounts.find((gate) => gate.sigma === query_.sigma) as GateCount;
    const counts = histogramByClock.get(clock) ?? new Array<number>(HISTOGRAM_BIN_COUNT).fill(0);
    const inRange = counts.reduce((sum, value) => sum + value, 0);
    const threshold = numberOrNull(summary.threshold_per_bar);
    const unit = String(summary.threshold_unit);
    series.push({
      clock,
      producedBarCount: Number(summary.bar_count),
      calibrationTargetBarCount: Number(summary.calibration_target_bar_count),
      developmentBarCount: Number(summary.development_bar_count),
      returnCount,
      // The calendar's "threshold" is its bar length, which the lake view stores as NaN (null here).
      thresholdPerBar: clock === "time" ? barSeconds(query_.size) : threshold,
      thresholdUnit: clock === "time" ? "seconds" : unit,
      firstTimestamp: numberOrNull(summary.first_milliseconds),
      lastTimestamp: numberOrNull(summary.last_milliseconds),
      logReturnMean: numberOrNull(summary.log_return_mean),
      logReturnStandardDeviation: numberOrNull(summary.log_return_standard_deviation),
      standardised: momentsFrom(standardisedByClock.get(clock)),
      percent: momentsFrom(percentByClock.get(clock)),
      gates: gateCounts,
      beyond: { sigma: selected.sigma, observed: selected.observed, predicted: selected.predicted, ratio: selected.ratio },
      biggestMoveSigma: numberOrNull(gateRow.biggest_move),
      histogramCounts: counts,
      outsideHistogramCount: returnCount - inRange,
    });
  }
  return series;
}

function barSeconds(size: (typeof BAR_SIZES)[number]): number {
  return { "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400 }[size];
}

async function readExtremes(query_: Query, context: StudyContext) {
  const where = `root = ${text(query_.root)} AND bar_size = ${text(query_.size)} AND abs(standardised_return) > ${num(query_.sigma)}`;
  const [barRows, hourRows, yearRows] = await Promise.all([
    context.lake.query<Record<string, unknown>>(
      `SELECT clock, epoch_ms(bar_timestamp) AS bar_milliseconds, standardised_return, percent_return, hour(bar_timestamp) AS bar_hour, year(bar_timestamp) AS bar_year
       FROM (SELECT *, row_number() OVER (PARTITION BY clock ORDER BY abs(standardised_return) DESC) AS size_rank
             FROM ${ident(RETURNS)} WHERE ${where})
       WHERE size_rank <= ${EXTREMES_CAP_PER_CLOCK}
       ORDER BY clock, size_rank`,
    ),
    context.lake.query<{ clock: string; bar_hour: number; bar_count: number }>(
      `SELECT clock, hour(bar_timestamp) AS bar_hour, count(*) AS bar_count FROM ${ident(RETURNS)} WHERE ${where} GROUP BY ALL ORDER BY clock, bar_hour`,
    ),
    context.lake.query<{ clock: string; bar_year: number; bar_count: number }>(
      `SELECT clock, year(bar_timestamp) AS bar_year, count(*) AS bar_count FROM ${ident(RETURNS)} WHERE ${where} GROUP BY ALL ORDER BY clock, bar_year`,
    ),
  ]);
  const extremes: ExtremeBar[] = barRows.map((row) => ({
    clock: String(row.clock) as ClockName,
    timestamp: Number(row.bar_milliseconds),
    standardisedReturn: Number(row.standardised_return),
    percentReturn: Number(row.percent_return),
    hour: Number(row.bar_hour),
    year: Number(row.bar_year),
  }));
  return {
    extremes,
    countByHour: hourRows.map((row) => ({ clock: String(row.clock) as ClockName, hour: Number(row.bar_hour), count: Number(row.bar_count) })),
    countByYear: yearRows.map((row) => ({ clock: String(row.clock) as ClockName, year: Number(row.bar_year), count: Number(row.bar_count) })),
  };
}

async function readActivity(query_: Query, context: StudyContext): Promise<TailClocksBody["activity"]> {
  const where = `root = ${text(query_.root)}`;
  const [hourRows, profileRows, summaryRows, histogramRows] = await Promise.all([
    context.lake.query<{ hour_milliseconds: number; contracts_traded: number }>(
      `SELECT epoch_ms(hour_timestamp) AS hour_milliseconds, contracts_traded FROM ${ident(HOURLY)} WHERE ${where} ORDER BY hour_timestamp`,
    ),
    context.lake.query<{ hour_of_day: number; median_contracts: number }>(
      `SELECT hour(hour_timestamp) AS hour_of_day, median(contracts_traded) AS median_contracts FROM ${ident(HOURLY)} WHERE ${where} GROUP BY ALL ORDER BY hour_of_day`,
    ),
    context.lake.query<MomentRow>(
      `WITH series AS (SELECT contracts_traded AS value FROM ${ident(HOURLY)} WHERE ${where}), centre AS (SELECT avg(value) AS mean_value FROM series)
       SELECT 'hourly' AS clock, count(*) AS observation_count, any_value(c.mean_value) AS mean_value, median(s.value) AS median_value,
              stddev_samp(s.value) AS standard_deviation, quantile_cont(s.value, 0.25) AS percentile_25, quantile_cont(s.value, 0.75) AS percentile_75,
              min(s.value) AS minimum_value, max(s.value) AS maximum_value,
              avg(power(s.value - c.mean_value, 2)) AS second_moment, avg(power(s.value - c.mean_value, 3)) AS third_moment,
              avg(power(s.value - c.mean_value, 4)) AS fourth_moment
       FROM series s CROSS JOIN centre c`,
    ),
    context.lake.query<{ bin: number; hour_count: number }>(
      `SELECT floor(log10(contracts_traded) * 4)::INTEGER AS bin, count(*) AS hour_count FROM ${ident(HOURLY)} WHERE ${where} AND contracts_traded >= 1 GROUP BY bin ORDER BY bin`,
    ),
  ]);
  return {
    hourCount: hourRows.length,
    hours: { timestamps: hourRows.map((row) => Number(row.hour_milliseconds)), contracts: hourRows.map((row) => Number(row.contracts_traded)) },
    hourOfDayMedian: profileRows.map((row) => ({ hour: Number(row.hour_of_day), medianContracts: Number(row.median_contracts) })),
    summary: momentsFrom(summaryRows[0]),
    logHistogram: histogramRows.map((row) => ({ lowerLog10: Number(row.bin) / 4, upperLog10: (Number(row.bin) + 1) / 4, count: Number(row.hour_count) })),
  };
}

const handler: StudyHandler<typeof query, TailClocksBody> = {
  slug: "tail-clocks",
  datasets: [SUMMARY, RETURNS, HOURLY],
  query,
  cacheSeconds: 600,
  timeoutMs: 120_000,
  async run(query_, context) {
    if ((await missingViews(context, [SUMMARY, RETURNS, HOURLY])).length > 0) return EMPTY_BODY;

    const rootRows = await context.lake.query<{ root: string; one_minute_bar_count: number }>(
      `SELECT root, max(one_minute_bar_count) AS one_minute_bar_count FROM ${ident(SUMMARY)}
       WHERE one_minute_bar_count >= ${MINIMUM_ONE_MINUTE_BARS} GROUP BY root ORDER BY one_minute_bar_count DESC, root`,
    );
    const roots = rootRows.map((row) => ({ root: String(row.root), oneMinuteBarCount: Number(row.one_minute_bar_count) }));
    if (!roots.some((entry) => entry.root === query_.root)) {
      context.notes.push(`Root ${query_.root} is not in the landed series (landed: ${roots.map((entry) => entry.root).join(", ") || "none"}).`);
      return { ...EMPTY_BODY, roots, selection: { root: query_.root, barSize: query_.size, sigma: query_.sigma } };
    }

    const gates = [...new Set<number>([...LADDER_GATES, query_.sigma])].sort((a, b) => a - b);
    const [series, extremes, activity] = await Promise.all([readSeries(query_, gates, context), readExtremes(query_, context), readActivity(query_, context)]);
    if (series.length === 0) context.notes.push(`No ${query_.size} series landed for ${query_.root}.`);
    if (extremes.extremes.length > 0 && series.some((entry) => entry.beyond.observed > EXTREMES_CAP_PER_CLOCK)) {
      context.notes.push(`The scatter and the ten-biggest table keep the ${EXTREMES_CAP_PER_CLOCK.toLocaleString("en-US")} largest bars per clock; every count is exact.`);
    }
    context.notes.push("Returns are standardised with the mean and standard deviation of the whole first 80% of each series (not causal, descriptive only); the final 20% is sealed and not landed.");
    return {
      roots,
      selection: { root: query_.root, barSize: query_.size, sigma: query_.sigma },
      series,
      ...extremes,
      extremesCapPerClock: EXTREMES_CAP_PER_CLOCK,
      activity,
      developmentFraction: DEVELOPMENT_FRACTION,
    };
  },
};

export default handler;
