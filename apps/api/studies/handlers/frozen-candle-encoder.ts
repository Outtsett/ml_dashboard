/**
 * Why not to freeze the candle recogniser as an encoder. Replaced
 * datalake/notebooks/frozen_candle_encoder.py.
 *
 * Reads two lake views:
 *   derived_mnq_frozen_encoder_probe   271 rows: five feature blocks scored on
 *       2025 direction at three horizons (with permutation nulls), plus 256
 *       rows of ridge R-squared per embedding coordinate. The table overloads
 *       feature_count and area_under_curve_test, so the rows are split by
 *       feature_block here (shared splitProbeRows), never plotted together.
 *   derived_mnq_next_candles_5m        MNQ 5-minute bars with the 61 TA-Lib
 *       columns, used for the real-window viewer.
 *
 * The notebook interpolated the pattern name and the anchor timestamp into its
 * SQL. Here the pattern is a Zod enum mapped to a quoted identifier, the index
 * and the window length are integers, and the anchor is found inside SQL by
 * firing number, so no timestamp ever travels through text.
 *
 * The embeddings themselves need the torch checkpoint and cannot run in a
 * web request; only the landed probe results are shown.
 */

import { z } from "zod";
import { ident, num } from "../sql";
import { missingViews } from "../views";
import type { StudyHandler } from "../types";
import {
  WINDOW_PATTERNS,
  splitProbeRows,
  type FrozenEncoderBody,
  type ProbeRow,
  type WindowBar,
  type WindowView,
} from "@shared/studies/frozen-candle-encoder";

const PROBE = "derived_mnq_frozen_encoder_probe";
const BARS = "derived_mnq_next_candles_5m";
const FIRINGS_LISTED = 30;

const querySchema = z.object({
  pattern: z.enum(WINDOW_PATTERNS).default("hammer"),
  index: z.coerce.number().int().min(0).max(FIRINGS_LISTED - 1).default(0),
  context: z.coerce.number().int().min(5).max(48).default(5),
});

const STAMP = "epoch_ms(timezone('UTC', timestamp))";

/** The first FIRINGS_LISTED holdout firings of one pattern, numbered from 1. */
function firingsCte(patternColumn: string): string {
  return `firings AS (
    SELECT timestamp, ${patternColumn} AS signal, row_number() OVER (ORDER BY timestamp) AS firing_number
    FROM (SELECT timestamp, ${patternColumn} FROM ${ident(BARS)}
          WHERE ${patternColumn} <> 0 AND sample_split = 'holdout' ORDER BY timestamp LIMIT ${num(FIRINGS_LISTED)})
  )`;
}

async function readWindow(
  lake: Parameters<StudyHandler["run"]>[1]["lake"],
  pattern: (typeof WINDOW_PATTERNS)[number],
  index: number,
  context: number,
): Promise<WindowView | null> {
  const patternColumn = ident(`candlestick_${pattern}`);
  const totals = await lake.query<{ firing_count: number }>(
    `SELECT count(*) AS firing_count FROM ${ident(BARS)} WHERE ${patternColumn} <> 0 AND sample_split = 'holdout'`,
  );
  const firingCount = Number(totals[0]?.firing_count ?? 0);
  if (firingCount === 0) return null;

  const listed = Math.min(firingCount, FIRINGS_LISTED);
  const firingIndex = Math.min(index, listed - 1);

  const anchorRows = await lake.query<{ anchor_timestamp_milliseconds: number; signal: number }>(
    `WITH ${firingsCte(patternColumn)}
     SELECT ${STAMP} AS anchor_timestamp_milliseconds, signal
     FROM firings WHERE firing_number = ${num(firingIndex + 1)}`,
  );
  const anchor = anchorRows[0];
  if (!anchor) return null;

  const bars = await lake.query<WindowBar>(
    `WITH ${firingsCte(patternColumn)},
     anchor AS (SELECT timestamp FROM firings WHERE firing_number = ${num(firingIndex + 1)}),
     window_bars AS (
       SELECT ${STAMP} AS timestamp_milliseconds, open, high, low, close, volume
       FROM ${ident(BARS)}
       WHERE timestamp <= (SELECT timestamp FROM anchor)
       ORDER BY timestamp DESC LIMIT ${num(context)}
     )
     SELECT * FROM window_bars ORDER BY timestamp_milliseconds`,
  );

  return {
    pattern,
    firing_index: firingIndex,
    firing_count: firingCount,
    anchor_timestamp_milliseconds: Number(anchor.anchor_timestamp_milliseconds),
    signal: Number(anchor.signal),
    bars,
  };
}

const handler: StudyHandler<typeof querySchema, FrozenEncoderBody> = {
  slug: "frozen-candle-encoder",
  datasets: [PROBE, BARS],
  query: querySchema,
  cacheSeconds: 600,
  async run(query, context) {
    const body: FrozenEncoderBody = { recipe: null, direction: [], coordinates: [], window: null };

    if ((await missingViews(context, [PROBE])).length === 0) {
      const rows = await context.lake.query<ProbeRow>(
        `SELECT feature_block, forward_candle_count, feature_count, train_row_count, test_row_count, test_up_rate,
                area_under_curve_test, permutation_null_95th_percentile, permutation_null_median,
                beats_permutation_null, area_above_null_95th, recipe
         FROM ${ident(PROBE)}
         ORDER BY feature_block, forward_candle_count, feature_count`,
      );
      const split = splitProbeRows(rows);
      body.direction = split.direction;
      body.coordinates = split.coordinates;
      const recipes = [...new Set(rows.map((row) => String(row.recipe)))];
      body.recipe = recipes[0] ?? null;
      if (recipes.length > 1) {
        context.notes.push(`The probe view holds ${recipes.length} recipes (${recipes.join(", ")}); every row is shown, so the blocks repeat.`);
      }
    }

    if ((await missingViews(context, [BARS])).length === 0) {
      body.window = await readWindow(context.lake, query.pattern, query.index, query.context);
      if (!body.window) context.notes.push(`${query.pattern} never fires in the holdout split of ${BARS}.`);
    }

    return body;
  },
};

export default handler;
