/**
 * TA-Lib candlestick pattern firings, for drawing on the price chart.
 *
 * Reads `talib_candle_patterns` — a view in the lake serving layer over the
 * pinned snapshot, LONG-format, one row per (bar, pattern that fired), with no
 * zero rows. A bar with no row is a bar where nothing fired, not a gap.
 *
 * This is the C library's own output read back from storage, not the browser-side
 * approximations in `market/lib/candles/registry.ts`. The two disagree on bars,
 * so they are kept apart all the way to the UI.
 *
 * `value` is the pattern's own signed confidence in {-2, -1, -0.8, +0.8, +1, +2}
 * — TA-Lib emits +/-100 for most patterns, +/-80 for engulfing/harami/haramicross
 * and +/-200 for hikkake/hikkakemod, and the ingest scaled it by 100. Sign is
 * direction; magnitude is the pattern's own statement, so it passes through.
 *
 * A hammer on 5m bars is not a hammer on 1m bars, so `timeframe` is matched, never
 * assumed: a request for a timeframe that was never ingested returns an empty
 * series rather than silently falling back to 1m and marking the wrong bars.
 */
import { Router, Request, Response } from 'express';
import { queryQuestDB } from '../infrastructure/database/questdb';
import { CACHE_SEMI } from '../infrastructure/cache/headers';
import { isValidSymbol } from '@shared/validation';

const router = Router();

/** Table written by the quant workspace's structure pipeline, pinned in the snapshot. */
const PATTERN_TABLE = 'talib_candle_patterns';

/**
 * Pattern names are interpolated into SQL, so they are restricted to the shape
 * TA-Lib actually produces — lowercase letters and digits, after the `talib_`
 * prefix is stripped at ingest (`3whitesoldiers`, `engulfing`, `hikkakemod`).
 * Anything else is rejected rather than escaped: no legitimate pattern name
 * carries a quote, so a value that does is a bug or an injection attempt and both
 * deserve to fail loudly.
 */
const PATTERN_NAME = /^[a-z0-9]+$/;
const TIMEFRAME_LABEL = /^[0-9]+[smhdw]$/;

/**
 * TA-Lib 0.7.1's whole `Pattern Recognition` vocabulary, all 61 of it.
 *
 * Checked as well as the character shape because they catch different mistakes.
 * The regex stops an injection; this stops a typo. `CDLDOJI` lowercases to
 * `cdldoji`, which is shape-valid and matches nothing — without this the caller
 * gets an empty chart and no reason for it, which is the worst of both.
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
  'thrusting', 'tristar', 'unique3river', 'upsidegap2crows', 'xsidegap3methods'
]);

/**
 * The 13 single-candle patterns — the default when the caller names none.
 *
 * Kept in sync with `client/src/market/lib/talibPatternCatalog.ts`. Duplicated
 * rather than imported because the server does not pull from the client bundle,
 * and a 13-name list is cheaper to keep honest than a shared-module dependency.
 */
const SINGLE_CANDLE_PATTERNS = [
  'belthold', 'closingmarubozu', 'doji', 'dragonflydoji', 'gravestonedoji',
  'highwave', 'longleggeddoji', 'longline', 'marubozu', 'rickshawman',
  'shortline', 'spinningtop', 'takuri',
] as const;

/** Minutes -> the timeframe label the ingest keyed rows by. */
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
      `names such as 'doji' — the ingest strips the 'talib_' prefix.`,
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

interface PatternFiringRow {
  pattern: string;
  /** Unix SECONDS — what lightweight-charts wants, and what the client snaps on. */
  time: number;
  value: number;
}

export interface CandlePatternSeries {
  pattern: string;
  points: { time: number; value: number }[];
}

/**
 * GET /api/charts/candle-patterns
 *
 * Query: symbol (required), timeframe (minutes or label, default 1m),
 *        patterns (csv of bare names; omitted = the 13 single-candle patterns),
 *        from / to (unix ms, optional).
 *
 * Returns one series per pattern that fired at least once in range. A pattern
 * that never fired is absent rather than present-and-empty, so the client can
 * tell "nothing there" from "not asked for".
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
    return res.json({ symbol, timeframe, patterns: [], firingCount: 0 });
  }

  const fromMs = Number(req.query.from);
  const toMs = Number(req.query.to);
  const rangeClause = [
    Number.isFinite(fromMs) ? `AND timestamp >= to_timestamp(${Math.floor(fromMs / 1000)})` : '',
    Number.isFinite(toMs) ? `AND timestamp <= to_timestamp(${Math.floor(toMs / 1000)})` : '',
  ].filter(Boolean).join('\n    ');

  const nameList = patterns.map(p => `'${p}'`).join(', ');
  const sql = `
SELECT
  pattern,
  CAST(epoch(timestamp) AS BIGINT) AS time,
  sum(value) AS value
FROM ${PATTERN_TABLE}
WHERE symbol = '${symbol.replace(/'/g, "''")}'
  AND timeframe = '${timeframe}'
  AND pattern IN (${nameList})
  ${rangeClause}
GROUP BY pattern, timestamp
ORDER BY pattern, timestamp
`.trim();

  try {
    const rows = await queryQuestDB<PatternFiringRow>(sql);

    const byPattern = new Map<string, { time: number; value: number }[]>();
    for (const row of rows) {
      const points = byPattern.get(row.pattern) ?? [];
      points.push({ time: Number(row.time), value: Number(row.value) });
      byPattern.set(row.pattern, points);
    }

    const series: CandlePatternSeries[] = patterns
      .filter(p => byPattern.has(p))
      .map(p => ({ pattern: p, points: byPattern.get(p)! }));

    res.json({
      symbol,
      timeframe,
      requested: patterns.length,
      patterns: series,
      firingCount: rows.length,
    });
  } catch (error) {
    const message = (error as Error).message;
    // A missing view is a deployment fact, not a bad request: the snapshot this
    // serving layer pins may simply not carry the pattern table.
    const missing = /does not exist|not found/i.test(message);
    res.status(missing ? 503 : 500).json({
      error: missing
        ? `${PATTERN_TABLE} is not present in the lake serving layer — ${message}`
        : message,
    });
  }
});

export default router;
