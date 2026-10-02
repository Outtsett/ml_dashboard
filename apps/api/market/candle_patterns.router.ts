/**
 * TA-Lib candlestick patterns, COMPUTED on demand from the bars.
 *
 * This endpoint used to `SELECT ... FROM talib_candle_patterns`, a materialized
 * view in the lake serving layer. That made an indicator into a table, with the
 * consequences a table brings: the snapshot only ever carried 1m/5m/15m across a
 * three-month window, so a daily chart got nothing back and the client silently
 * fell through to hand-written browser approximations that disagree with TA-Lib
 * on real bars. Coverage was a property of whoever last ran the ingest.
 *
 * It now runs the actual TA-Lib C library over whatever bars the chart is
 * holding, the way MotiveWave, NinjaTrader and TradingView compute an
 * indicator: select it and it is calculated. There is no table, no ingest, no
 * coverage window, and the numbers are the reference implementation's rather than
 * a rewrite's. Measured on 500 MNQ daily bars: all 61 patterns in 3.6ms.
 *
 * `value` is the pattern's own signed confidence in {-2, -1, -0.8, +0.8, +1, +2}
 * — TA-Lib emits ±100 for most patterns, ±80 for engulfing/harami/haramicross
 * and ±200 for hikkake/hikkakemod, scaled by 100 here. Sign is direction;
 * magnitude is the pattern's own statement, so it passes through.
 *
 * A hammer on 5m bars is not a hammer on 1m bars, so the patterns are computed
 * on bars sampled at the requested timeframe, never borrowed from another one.
 */
import { Router, Request, Response } from 'express';
import { getOHLCVSampleBy } from '../infrastructure/database/lake';
import { CACHE_SEMI } from '../infrastructure/cache/headers';
import { isValidSymbol } from '@shared/validation';
import {
  candlePatternCatalog,
  computeCandlePatterns,
  type PatternBar,
} from './candlePatternService';

const router = Router();

/**
 * Pattern names are checked against the shape TA-Lib actually produces —
 * lowercase letters and digits, after the `CDL` prefix is stripped
 * (`3whitesoldiers`, `engulfing`, `hikkakemod`). Kept now that the value no
 * longer reaches SQL, because it still catches a typo before it reaches the
 * worker and comes back as an opaque failure.
 */
const PATTERN_NAME = /^[a-z0-9]+$/;
const TIMEFRAME_LABEL = /^[0-9]+[smhdw]$/;

/**
 * TA-Lib 0.8.1's whole `Pattern Recognition` vocabulary, all 61 of it.
 *
 * Checked as well as the character shape because they catch different mistakes.
 * The regex stops a malformed name; this stops a plausible one. `CDLDOJI`
 * lowercases to `cdldoji`, which is shape-valid and matches nothing — without
 * this the caller gets an empty chart and no reason for it.
 */
const KNOWN_PATTERNS = new Set([
  '2crows', '3blackcrows', '3inside', '3linestrike', '3outside', '3starsinsouth',
  '3whitesoldiers', 'abandonedbaby', 'advanceblock', 'belthold', 'breakaway',
  'closingmarubozu', 'concealbabyswall', 'counterattack', 'darkcloudcover', 'doji',
  'dojistar', 'dragonflydoji', 'engulfing', 'eveningdojistar', 'eveningstar',
  'gapsidesidewhite', 'gravestonedoji', 'hammer', 'hangingman', 'harami', 'haramicross',
  'highwave', 'hikkake', 'hikkakemod', 'homingpigeon', 'identical3crows', 'inneck',
  'invertedhammer', 'kicking', 'kickingbylength', 'ladderbottom', 'longleggeddoji',
  'longline', 'marubozu', 'matchinglow', 'mathold', 'morningdojistar', 'morningstar',
  'onneck', 'piercing', 'rickshawman', 'risefall3methods', 'separatinglines', 'shootingstar',
  'shortline', 'spinningtop', 'stalledpattern', 'sticksandwich', 'takuri', 'tasukigap',
  'thrusting', 'tristar', 'unique3river', 'upsidegap2crows', 'xsidegap3methods',
]);

/**
 * The 13 single-candle patterns — the default when the caller names none.
 *
 * Kept in sync with `client/src/market/lib/talibPatternCatalog.ts`.
 */
const SINGLE_CANDLE_PATTERNS = [
  'belthold', 'closingmarubozu', 'doji', 'dragonflydoji', 'gravestonedoji',
  'highwave', 'longleggeddoji', 'longline', 'marubozu', 'rickshawman',
  'shortline', 'spinningtop', 'takuri',
] as const;

/**
 * How many bars to score when the caller gives no explicit range.
 *
 * TA-Lib needs trailing history for its rolling thresholds, so this is a floor
 * on correctness as much as a cap on work.
 */
const DEFAULT_BAR_LIMIT = 2000;

/** Minutes -> the SAMPLE BY label the lake fetch takes. */
export function timeframeLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/** A timeframe param that may arrive as minutes (`5`) or as a label (`5m`). */
export function parseTimeframe(raw: string | undefined): string {
  if (!raw) return '1m';
  const minutes = Number(raw);
  if (Number.isFinite(minutes) && minutes > 0) return timeframeLabel(minutes);
  const label = String(raw).toLowerCase();
  if (!TIMEFRAME_LABEL.test(label)) {
    throw new Error(`Invalid timeframe '${raw}'. Expected minutes (5) or a label (5m).`);
  }
  return label;
}

/** Comma-separated pattern names, validated; empty input means the 13 singles. */
export function parsePatterns(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [...SINGLE_CANDLE_PATTERNS];
  const names = raw.split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
  const malformed = names.filter(n => !PATTERN_NAME.test(n));
  if (malformed.length > 0) {
    throw new Error(
      `Invalid pattern name(s): ${malformed.join(', ')}. Expected bare lowercase ` +
      `names such as 'doji' — the 'CDL' prefix is stripped.`,
    );
  }
  const unknown = names.filter(n => !KNOWN_PATTERNS.has(n));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown TA-Lib pattern(s): ${unknown.join(', ')}. TA-Lib defines 61 ` +
      `candlestick patterns and none is named that.`,
    );
  }
  return [...new Set(names)];
}

export interface CandlePatternSeries {
  pattern: string;
  points: { time: number; value: number }[];
}

/** Normalize the lake's `Date | string` timestamp to epoch milliseconds. */
function toMillis(timestamp: Date | string | number): number {
  if (timestamp instanceof Date) return timestamp.getTime();
  if (typeof timestamp === 'number') return timestamp;
  return new Date(timestamp).getTime();
}

/**
 * GET /api/charts/candle-patterns/catalog
 *
 * The 61 patterns as TA-Lib itself defines them, each with the lookback it
 * refuses to score inside. Declared before the bare `/candle-patterns` route so
 * the literal path is not shadowed.
 */
router.get('/candle-patterns/catalog', CACHE_SEMI, async (_req: Request, res: Response) => {
  try {
    res.json({ patterns: await candlePatternCatalog() });
  } catch (error) {
    res.status(503).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/charts/candle-patterns
 *
 * Query: symbol (required), timeframe (minutes or label, default 1m),
 *        patterns (csv of bare names; omitted = the 13 single-candle patterns),
 *        from / to (unix ms, optional), limit (bars to score, default 2000).
 *
 * Returns one series per pattern that fired at least once. A pattern that never
 * fired is absent rather than present-and-empty, so the client can tell "nothing
 * there" from "not asked for".
 */
router.get('/candle-patterns', CACHE_SEMI, async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol ?? '').toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return res.status(400).json({ error: `Invalid symbol '${req.query.symbol ?? ''}'` });
  }

  let timeframe: string;
  let patterns: string[];
  try {
    timeframe = parseTimeframe(req.query.timeframe as string | undefined);
    patterns = parsePatterns(req.query.patterns as string | undefined);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
  if (patterns.length === 0) {
    return res.json({ symbol, timeframe, patterns: [], firingCount: 0, barCount: 0 });
  }

  const fromMs = Number(req.query.from);
  const toMs = Number(req.query.to);
  const limit = Number(req.query.limit);

  try {
    const rows = await getOHLCVSampleBy(
      symbol,
      timeframe,
      Number.isFinite(fromMs) ? fromMs : undefined,
      Number.isFinite(toMs) ? toMs : undefined,
      Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_BAR_LIMIT,
    );

    // TA-Lib walks the array forward and its rolling thresholds assume time
    // order. The lake may hand back newest-first depending on the limit path,
    // so order is asserted here rather than assumed.
    const bars: PatternBar[] = rows
      .map(row => ({
        timestamp: toMillis((row as { timestamp: Date | string }).timestamp),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
      }))
      .filter(b =>
        Number.isFinite(b.timestamp) && Number.isFinite(b.open) && Number.isFinite(b.high)
        && Number.isFinite(b.low) && Number.isFinite(b.close))
      .sort((a, b) => a.timestamp - b.timestamp);

    if (bars.length === 0) {
      return res.json({
        symbol, timeframe, requested: patterns.length,
        patterns: [], firingCount: 0, barCount: 0,
      });
    }

    const computed = await computeCandlePatterns(bars, patterns);

    const series: CandlePatternSeries[] = patterns
      .filter(p => computed.has(p))
      .map(p => ({ pattern: p, points: computed.get(p)! }));
    const firingCount = series.reduce((total, s) => total + s.points.length, 0);

    res.json({
      symbol,
      timeframe,
      requested: patterns.length,
      patterns: series,
      firingCount,
      barCount: bars.length,
    });
  } catch (error) {
    const message = (error as Error).message;
    // A worker that will not start is a deployment fact (TA-Lib missing from
    // .venv), not a bad request — say so rather than returning a bare 500.
    const unavailable = /worker (exited|failed to start|timed out|shut down)/i.test(message);
    res.status(unavailable ? 503 : 500).json({ error: message });
  }
});

export default router;
