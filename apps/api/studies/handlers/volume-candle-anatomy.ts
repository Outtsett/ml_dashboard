/**
 * Volume and the parts of a candle. Replaced datalake/notebooks/volume_candle_anatomy.py.
 *
 * part=board   reads derived_mnq_volume_candle_anatomy (8,800 rows, landed by
 *              datalake scripts/build_volume_candle_anatomy.py: five timeframes x four bar
 *              populations x five volume readings x eight candle parts x eleven deciles;
 *              decile -1 is the whole-population row) and computes the Panel G answer tables
 *              in SQL. The newest recipe wins when several are landed.
 * part=deciles the per-decile rows of one timeframe, population and reading (Panels D and E).
 * part=window  reads MNQ 5m bars of the 2025 holdout from derived_mnq_next_candles_5m, pages
 *              them by timestamp (not by scanning an OFFSET of full rows) and computes the
 *              five readings of a volume bar with the shared causal code.
 */

import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyHandler } from "../types";
import {
  ENCODING_ORDER, LEAD_IN_ROWS, POPULATIONS, TIMEFRAMES, volumeReadings, spearmanCorrelation,
  type BoardBody, type BoardDecileRow, type BoardOverallRow, type DecilesBody, type EncodingConclusion, type MeasureConclusion,
  type RawBar, type VolumeCandleAnatomyBody, type WindowBody,
} from "@shared/studies/volume-candle-anatomy";

const BOARD_VIEW = "derived_mnq_volume_candle_anatomy";
const BARS_VIEW = "derived_mnq_next_candles_5m";

const query = z.object({
  part: z.enum(["board", "deciles", "window"]).default("board"),
  timeframe: z.enum(TIMEFRAMES).default("5m"),
  population: z.enum(POPULATIONS.map((entry) => entry.value) as [string, ...string[]]).default("closes_inside_range"),
  encoding: z.enum(ENCODING_ORDER).default("volume_rank_trailing"),
  windowStart: z.coerce.number().int().min(0).max(10_000_000).default(400),
  windowLength: z.coerce.number().int().min(30).max(160).default(70),
});

const EMPTY: VolumeCandleAnatomyBody = { part: "board", board: null, deciles: null, window: null };

/** ROUND keeps the payload small; a NaN from the landing stays NaN and reaches the page as null. */
const r = (column: string) => `round(${ident(column)}, 6) AS ${ident(column)}`;

async function latestRecipe(context: Parameters<StudyHandler["run"]>[1], view: string): Promise<string | null> {
  const rows = await context.lake.query<{ recipe: string | null }>(`SELECT max(recipe) AS recipe FROM ${ident(view)}`);
  return rows[0]?.recipe ?? null;
}

async function board(context: Parameters<StudyHandler["run"]>[1]): Promise<BoardBody | null> {
  if ((await missingViews(context, [BOARD_VIEW])).length > 0) return null;
  const recipe = await latestRecipe(context, BOARD_VIEW);
  if (!recipe) return null;
  const from = `FROM ${ident(BOARD_VIEW)} WHERE recipe = ${text(recipe)}`;

  const overall = await context.lake.query<BoardOverallRow>(
    `SELECT timeframe, bar_population, volume_encoding, anatomy_measure, bar_count,
            ${["pearson_correlation", "spearman_correlation", "mutual_information_nats",
              "gaussian_equivalent_mutual_information_nats", "mutual_information_excess_ratio"].map(r).join(", ")},
            relationship_is_nonlinear, pairing_shares_a_construction_term,
            ${["anatomy_mean", "anatomy_median", "anatomy_standard_deviation", "anatomy_skewness", "anatomy_kurtosis",
              "anatomy_percentile_25", "anatomy_percentile_75", "anatomy_minimum", "anatomy_maximum"].map(r).join(", ")}
     ${from} AND volume_decile = -1
     ORDER BY timeframe, bar_population, volume_encoding, anatomy_measure`,
  );
  // The answer tables: bars closing inside their range, pairings that share no construction term.
  const honest = `${from} AND volume_decile = -1 AND bar_population = 'closes_inside_range' AND NOT pairing_shares_a_construction_term`;
  const byEncoding = await context.lake.query<EncodingConclusion>(
    `SELECT volume_encoding, avg(abs(spearman_correlation)) AS mean_absolute_spearman, count(*) AS pairing_count
     ${honest} GROUP BY volume_encoding ORDER BY mean_absolute_spearman DESC`,
  );
  const byMeasure = await context.lake.query<MeasureConclusion>(
    `SELECT anatomy_measure,
            max(abs(spearman_correlation)) AS best_absolute_spearman,
            arg_max(volume_encoding, abs(spearman_correlation)) AS best_volume_encoding
     ${honest} GROUP BY anatomy_measure ORDER BY best_absolute_spearman DESC`,
  );

  const rowCount = Number((await context.lake.query<{ n: number }>(`SELECT count(*) AS n ${from}`))[0]?.n ?? 0);
  const listed = new Set(overall.map((row) => row.timeframe));
  return {
    recipe, rowCount,
    timeframes: TIMEFRAMES.filter((timeframe) => listed.has(timeframe)),
    overall, byEncoding, byMeasure,
  };
}

async function deciles(context: Parameters<StudyHandler["run"]>[1], timeframe: string, population: string, encoding: string): Promise<DecilesBody | null> {
  if ((await missingViews(context, [BOARD_VIEW])).length > 0) return null;
  const recipe = await latestRecipe(context, BOARD_VIEW);
  if (!recipe) return null;
  const populations = [...new Set([population, "rising_candles_inside_range", "falling_candles_inside_range"])];
  const rows = await context.lake.query<BoardDecileRow>(
    `SELECT timeframe, bar_population, volume_encoding, anatomy_measure, volume_decile, bar_count,
            ${["anatomy_mean", "anatomy_median", "anatomy_standard_deviation", "anatomy_skewness", "anatomy_kurtosis",
              "anatomy_percentile_25", "anatomy_percentile_75", "anatomy_minimum", "anatomy_maximum"].map(r).join(", ")}
     FROM ${ident(BOARD_VIEW)}
     WHERE recipe = ${text(recipe)} AND volume_decile >= 0 AND timeframe = ${text(timeframe)}
       AND volume_encoding = ${text(encoding)} AND bar_population IN (${populations.map(text).join(", ")})
     ORDER BY bar_population, anatomy_measure, volume_decile`,
  );
  return { recipe, timeframe, population, encoding, rows };
}

async function barsWindow(context: Parameters<StudyHandler["run"]>[1], start: number, length: number): Promise<WindowBody | null> {
  if ((await missingViews(context, [BARS_VIEW])).length > 0) return null;
  const recipe = await latestRecipe(context, BARS_VIEW);
  if (!recipe) return null;
  const holdout = `FROM ${ident(BARS_VIEW)} WHERE recipe = ${text(recipe)} AND sample_split = 'holdout'`;

  const count = Number((await context.lake.query<{ n: number }>(`SELECT count(*) AS n ${holdout}`))[0]?.n ?? 0);
  const rowsNeeded = length + LEAD_IN_ROWS;
  const windowStart = Math.max(0, Math.min(start, count - rowsNeeded));
  if (count < rowsNeeded) {
    context.notes.push(`The 2025 holdout has only ${count} bars, fewer than the ${rowsNeeded} one window reads.`);
    return { recipe, holdoutBarCount: count, windowStart: 0, windowLength: length, bars: [], spearmanRawAgainstHeight: null };
  }
  if (windowStart !== start) context.notes.push(`Scroll position ${start} is past the end of the holdout; showing the last window (start ${windowStart}).`);

  // The first timestamp is read from one column (an OFFSET over the timestamp alone), then the bars by timestamp range.
  const raw = await context.lake.query<RawBar>(
    `SELECT epoch_ms(timestamp) AS timestamp, open, high, low, close, volume
     ${holdout}
       AND timestamp >= (SELECT timestamp ${holdout} ORDER BY timestamp LIMIT 1 OFFSET ${num(windowStart)})
     ORDER BY timestamp LIMIT ${num(rowsNeeded)}`,
  );
  const bars = volumeReadings(raw, length);
  const spearman = spearmanCorrelation(
    bars.map((bar) => bar.volume_contracts),
    bars.map((bar) => bar.volume_bar_height_in_window),
  );
  return { recipe, holdoutBarCount: count, windowStart, windowLength: length, bars, spearmanRawAgainstHeight: spearman };
}

const handler: StudyHandler<typeof query, VolumeCandleAnatomyBody> = {
  slug: "volume-candle-anatomy",
  datasets: [BOARD_VIEW, BARS_VIEW],
  query,
  cacheSeconds: 600,
  async run(parsed, context) {
    if (parsed.part === "window") {
      return { ...EMPTY, part: "window", window: await barsWindow(context, parsed.windowStart, parsed.windowLength) };
    }
    if (parsed.part === "deciles") {
      return { ...EMPTY, part: "deciles", deciles: await deciles(context, parsed.timeframe, parsed.population, parsed.encoding) };
    }
    return { ...EMPTY, board: await board(context) };
  },
};

export default handler;
