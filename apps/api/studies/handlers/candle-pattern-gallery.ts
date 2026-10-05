/**
 * Candle pattern gallery: example bars for each of the 61 TA-Lib candlestick
 * patterns on MNQ 5-minute bars. Replaced Trading/quant/chart_cnn/pkg/gallery.py.
 *
 * Reads three views landed by packages/ml-engine/src/studies/candle_pattern_gallery/build.py:
 *   derived_study_candle_pattern_gallery_summary      61 rows (every pattern, every request)
 *   derived_study_candle_pattern_gallery_examples     the selected pattern's 12 to 29 examples
 *   derived_study_candle_pattern_gallery_window_bars   their 48 bars each
 *
 * Only the pattern choice changes which rows are sent (at most 29 examples of
 * 48 bars); the view, the side and source filters and the tile size are
 * applied in the browser. Timestamps leave the database as epoch milliseconds
 * of the lake's own stamp (Pacific wall clock stored as UTC) read in UTC,
 * never as a Date, so the server's session time zone cannot shift them.
 */

import { z } from "zod";
import { ident, plainRow, text } from "../sql";
import { missingViews } from "../views";
import type { StudyHandler } from "../types";
import {
  EMPTY_BODY, groupWindows,
  type ExampleSource, type GalleryBody, type GalleryExample, type GallerySummaryRow, type PatternSide, type WindowBarRow,
} from "@shared/studies/candle-pattern-gallery";

export const SUMMARY_VIEW = "derived_study_candle_pattern_gallery_summary";
export const EXAMPLES_VIEW = "derived_study_candle_pattern_gallery_examples";
export const WINDOW_BARS_VIEW = "derived_study_candle_pattern_gallery_window_bars";

const DEFAULT_PATTERN = "CDLENGULFING";
const STAMP_MILLISECONDS = "epoch_ms(timezone('UTC', bar_timestamp))";

const query = z.object({
  pattern: z.string().regex(/^CDL[A-Z0-9_]{1,40}$/, "a TA-Lib pattern function name such as CDLENGULFING").default(DEFAULT_PATTERN),
});

interface ExampleRow {
  example_id: string;
  pattern_side: PatternSide;
  is_synthetic: boolean;
  example_source: ExampleSource;
  bar_index: number | null;
  pattern_bar_count: number;
  bar_timestamp_ms: number | null;
}

const handler: StudyHandler<typeof query, GalleryBody> = {
  slug: "candle-pattern-gallery",
  datasets: [SUMMARY_VIEW, EXAMPLES_VIEW, WINDOW_BARS_VIEW],
  query,
  cacheSeconds: 600,
  async run({ pattern: requested }, context) {
    if ((await missingViews(context, [SUMMARY_VIEW, EXAMPLES_VIEW, WINDOW_BARS_VIEW])).length > 0) return EMPTY_BODY;
    const { lake } = context;
    const summary = (
      await lake.query<GallerySummaryRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(SUMMARY_VIEW)} ORDER BY talib_function`)
    ).map(plainRow);
    const known = new Set(summary.map((row) => row.talib_function));
    const withExamples = summary.filter((row) => row.example_count > 0).map((row) => row.talib_function);
    let pattern: string | null = known.has(requested) ? requested : null;
    if (pattern === null) {
      pattern = withExamples[0] ?? null;
      if (pattern !== null) context.notes.push(`${requested} is not one of the ${summary.length} patterns in the gallery, so ${pattern} is shown instead.`);
    }
    if (pattern === null) return { ...EMPTY_BODY, summary };

    const [exampleRows, barRows] = await Promise.all([
      lake.query<ExampleRow>(
        // The notebook's tile order: real examples (bullish then bearish, oldest first), then the synthetic ones.
        `SELECT example_id, pattern_side, is_synthetic, example_source,
                CAST(bar_index AS BIGINT) AS bar_index, CAST(pattern_bar_count AS INTEGER) AS pattern_bar_count,
                ${STAMP_MILLISECONDS} AS bar_timestamp_ms
         FROM ${ident(EXAMPLES_VIEW)}
         WHERE talib_function = ${text(pattern)}
         ORDER BY is_synthetic, example_source, pattern_side DESC, bar_timestamp NULLS LAST, example_id`,
      ),
      lake.query<WindowBarRow>(
        `SELECT example_id, CAST(bars_before_firing AS INTEGER) AS bars_before_firing, is_pattern_bar,
                ${STAMP_MILLISECONDS} AS bar_timestamp_ms,
                absolute_open_price, absolute_high_price, absolute_low_price, absolute_close_price, volume
         FROM ${ident(WINDOW_BARS_VIEW)}
         WHERE talib_function = ${text(pattern)}
         ORDER BY example_id, window_position`,
      ),
    ]);
    const windows = groupWindows(barRows.map(plainRow));
    const examples: GalleryExample[] = exampleRows.map(plainRow).map((row) => ({
      ...row,
      bars: windows.get(row.example_id) ?? [],
    }));
    return { summary, pattern, examples };
  },
};

export default handler;
