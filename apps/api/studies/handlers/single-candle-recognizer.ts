/**
 * Recognising TA-Lib's 13 single-candle patterns. Replaced
 * datalake/notebooks/single_candle_recognizer.py.
 *
 * Two reads:
 *  - no query: the 104-row study table, derived_mnq_single_candle_recognizer_study
 *    (13 patterns x 4 models x 2 feature sets, built once by datalake
 *    scripts/build_single_candle_recognizer_study.py), every row to the page;
 *  - `candlePattern` (one of the 13, allowlisted): one real MNQ candle on which
 *    the lake's TA-Lib column fired, and the ten bars before it, from
 *    derived_mnq_next_candles_<timeframe>, with the lake's TA-Lib output for all
 *    thirteen patterns on each bar. Bars are numbered within their own contract,
 *    and only firings REAL_FIRST_POSITION or more bars in are offered: the
 *    lake's column was computed across contract changes, so in a contract's
 *    first ~20 bars its window reached into the previous contract (12 of
 *    246,818 bar-pattern pairs on MNQM4 5m differ, all in bars 12-19).
 */

import { z } from "zod";
import { ident } from "../sql";
import { missingViews } from "../views";
import type { StudyHandler } from "../types";
import {
  REAL_FIRST_POSITION, REAL_TIMEFRAMES, SINGLE_CANDLE_PATTERNS, TRAILING_BARS,
  type RealBar, type RealCandle, type RealTimeframe, type RecognizerBody, type StudyRow,
} from "@shared/studies/single-candle-recognizer";

export const STUDY_VIEW = "derived_mnq_single_candle_recognizer_study";

const CANDLE_VIEWS = new Map<RealTimeframe, string>(REAL_TIMEFRAMES.map((timeframe) => [timeframe, `derived_mnq_next_candles_${timeframe}`]));

const query = z.object({
  candlePattern: z.enum(SINGLE_CANDLE_PATTERNS).optional(),
  candleTimeframe: z.enum(REAL_TIMEFRAMES).default("5m"),
  candleIndex: z.coerce.number().int().min(0).max(10_000_000).default(0),
});

interface CandleRow {
  timestamp_milliseconds: number;
  contract_symbol: string;
  sample_split: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
  fired_index: number;
  fired_count: number;
  /** stored_<pattern>: the lake's TA-Lib output for each of the thirteen. */
  [storedColumn: string]: unknown;
}

/** The read for the `index`-th firing of `pattern` in time order (clamped to the last), with the ten bars before it. */
export function realCandleSql(view: string, pattern: string, index: number): string {
  const column = ident(`candlestick_${pattern}`);
  const stored = SINGLE_CANDLE_PATTERNS.map((name) => `${ident(`candlestick_${name}`)} AS ${ident(`stored_${name}`)}`).join(", ");
  const storedOut = SINGLE_CANDLE_PATTERNS.map((name) => `o.${ident(`stored_${name}`)}`).join(", ");
  return `
WITH ordered AS (
  SELECT timestamp, contract_symbol, sample_split, open, high, low, close, ${column} AS signal, ${stored},
         row_number() OVER (PARTITION BY contract_symbol ORDER BY timestamp) AS position
  FROM ${ident(view)}
), fired AS (
  SELECT contract_symbol, position,
         row_number() OVER (ORDER BY timestamp, contract_symbol) - 1 AS fired_index
  FROM ordered
  WHERE signal IS NOT NULL AND signal <> 0 AND position > ${REAL_FIRST_POSITION}
), total AS (
  SELECT count(*) AS fired_count FROM fired
), chosen AS (
  SELECT f.contract_symbol, f.position, f.fired_index, t.fired_count
  FROM fired f CROSS JOIN total t
  WHERE f.fired_index = LEAST(${Math.trunc(index)}, t.fired_count - 1)
)
SELECT epoch_ms(o.timestamp) AS timestamp_milliseconds, o.contract_symbol, o.sample_split,
       o.open, o.high, o.low, o.close, ${storedOut}, c.fired_index, c.fired_count
FROM ordered o
JOIN chosen c ON o.contract_symbol = c.contract_symbol AND o.position BETWEEN c.position - ${TRAILING_BARS} AND c.position
ORDER BY o.position`;
}

function toRealCandle(rows: CandleRow[], pattern: RealCandle["pattern"], timeframe: RealTimeframe): RealCandle | null {
  const last = rows[rows.length - 1];
  if (!last || rows.length !== TRAILING_BARS + 1) return null;
  const bars: RealBar[] = rows.map((row) => ({
    timestamp: row.timestamp_milliseconds,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    stored: Object.fromEntries(SINGLE_CANDLE_PATTERNS.map((name) => [name, (row[`stored_${name}`] as number | null | undefined) ?? null])),
  }));
  return {
    pattern, timeframe, contractSymbol: last.contract_symbol, sampleSplit: last.sample_split,
    firedIndex: last.fired_index, firedCount: last.fired_count, bars,
  };
}

const handler: StudyHandler<typeof query, RecognizerBody> = {
  slug: "single-candle-recognizer",
  datasets: [STUDY_VIEW, ...CANDLE_VIEWS.values()],
  query,
  cacheSeconds: 600,
  async run(parsed, context) {
    if (parsed.candlePattern) {
      const view = CANDLE_VIEWS.get(parsed.candleTimeframe) as string;
      if ((await missingViews(context, [view])).length > 0) return { rows: [], real: null };
      const rows = await context.lake.query<CandleRow>(realCandleSql(view, parsed.candlePattern, parsed.candleIndex));
      const real = toRealCandle(rows, parsed.candlePattern, parsed.candleTimeframe);
      if (!real) context.notes.push(`No ${parsed.candlePattern} firing with ${TRAILING_BARS} bars behind it in ${view}.`);
      return { rows: [], real };
    }
    if ((await missingViews(context, [STUDY_VIEW])).length > 0) return { rows: [], real: null };
    const rows = await context.lake.query<StudyRow>(
      `SELECT * FROM ${ident(STUDY_VIEW)} ORDER BY feature_set, model_name, pattern_name`,
    );
    return { rows, real: null };
  },
};

export default handler;
