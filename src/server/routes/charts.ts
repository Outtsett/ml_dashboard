/**
 * Chart data API — unified OHLCV endpoint for ALL chart rendering.
 *
 * Source: QuestDB (759M rows, concurrent reads, SAMPLE BY aggregation)
 *
 * Why QuestDB only?
 *  - No file lock — multiple queries can run in parallel
 *  - SAMPLE BY gives instant timeframe aggregation (no GROUP BY needed)
 *  - All time series data lives in QuestDB
 *
 * The client sends minutes-based timeframes (1, 5, 15, etc.) and ms-epoch timestamps.
 * This route normalises everything to a flat array of { timestamp, open, high, low, close, volume }.
 */
import { Router, Request, Response } from 'express';
import { getOHLCVSampleBy, getStitchedOHLCV, checkQuestDBHealth, queryQuestDB } from '../database/questdb';
import type { AdjustmentMode } from '@shared/ohlcv';
import { cachedQuery, OHLCVCache } from '../lib/ohlcvCache';
import { normalizeTimestamp, parseTimestampParam } from '../lib/normalize';
import { isFuturesRoot } from '../lib/futures';
import { CACHE_SEMI } from '../lib/cacheHeaders';
import { SYMBOL_REGEX } from '@shared/schema';

const router = Router();

// ── Timeframe helpers ────────────────────────────────────────

/** Minutes → QuestDB SAMPLE BY label */
const MINUTES_TO_SAMPLE: Record<number, string> = {
  1: '1m', 5: '5m', 15: '15m', 30: '30m',
  60: '1h', 240: '4h', 1440: '1d', 10080: '1w',
};

/** String label → QuestDB SAMPLE BY label (for backwards compat) */
const LABEL_TO_SAMPLE: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w',
};

/** Parse a timeframe value that may be minutes (number), label string, or seconds string */
function parseTimeframeMinutes(tf: string | undefined): number {
  if (!tf) return 1;
  // Pure number → treat as minutes
  const num = Number(tf);
  if (!isNaN(num) && num > 0) return num;
  // Label like "5m", "1h", "1d"
  const match = tf.match(/^(\d+)(s|m|h|d|w)?$/i);
  if (match) {
    const val = parseInt(match[1]!);
    const unit = (match[2] || 'm').toLowerCase();
    if (unit === 's') return val / 60;
    if (unit === 'm') return val;
    if (unit === 'h') return val * 60;
    if (unit === 'd') return val * 1440;
    if (unit === 'w') return val * 10080;
  }
  return 1;
}

/** Parse a timestamp param that may be ISO string, ms epoch, or seconds epoch */
function parseTimestamp(v: string | undefined): number | undefined {
  return parseTimestampParam(v);
}

/** Normalise a QuestDB row's timestamp to epoch-ms number */
function normaliseTimestamp(row: any): number {
  return normalizeTimestamp(row.timestamp);
}

// ── Cache for QuestDB health status (avoid checking every request) ──
let questdbHealthy = false;
let healthCheckedAt = 0;
const HEALTH_CHECK_INTERVAL_MS = 10_000; // Re-check every 10s

async function isQuestDBHealthy(): Promise<boolean> {
  if (Date.now() - healthCheckedAt < HEALTH_CHECK_INTERVAL_MS) return questdbHealthy;
  questdbHealthy = await checkQuestDBHealth();
  healthCheckedAt = Date.now();
  return questdbHealthy;
}

// ───────────────────────────────────────────────────────────────
// GET /api/charts/ohlcv
//
// Query params:
//   symbol     (required) e.g. "ES", "EURUSD", "ESH5"
//   timeframe  minutes (1,5,15,60…) OR label ("5m","1h","1d")
//   startTime  epoch ms (or ISO string)
//   endTime    epoch ms (or ISO string)
//   start / end  aliases for startTime / endTime (ISO dates)
//   limit      max rows (default 5000, max 50000)
//   order      "asc" | "desc" (default: desc = most-recent first)
// ───────────────────────────────────────────────────────────────
router.get('/ohlcv', async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string)?.trim()?.toUpperCase();
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });
    if (!SYMBOL_REGEX.test(symbol)) return res.status(400).json({ error: 'Invalid symbol format' });

    const tfMinutes = parseTimeframeMinutes(req.query.timeframe as string);
    const startMs = parseTimestamp(req.query.startTime as string) ?? parseTimestamp(req.query.start as string);
    const endMs   = parseTimestamp(req.query.endTime as string)   ?? parseTimestamp(req.query.end as string);
    const rowLimit = Math.min(parseInt(req.query.limit as string) || 5000, 50000);
    const orderDesc = (req.query.order as string)?.toLowerCase() !== 'asc';
    const adjustmentRaw = (req.query.adjustment as string)?.toLowerCase();
    const adjustment: AdjustmentMode = adjustmentRaw === 'panama' ? 'panama'
      : adjustmentRaw === 'ratio' ? 'ratio' : 'none';

    const sampleLabel = MINUTES_TO_SAMPLE[tfMinutes]
      || LABEL_TO_SAMPLE[(req.query.timeframe as string)?.toLowerCase() ?? '']
      || '1m';

    // ── Estimate a reasonable time window when none is provided ──
    // Without this, SAMPLE BY scans ALL data for the symbol (millions of rows)
    // For DESC order (initial chart load), find the symbol's latest timestamp first,
    // then estimate a window backwards from that point.
    let effectiveStart = startMs;
    let effectiveEnd   = endMs;
    if (!effectiveStart && !effectiveEnd && orderDesc) {
      let anchorMs = Date.now();
      try {
        const safeEsc = symbol.replace(/'/g, "''");
        let anchorQuery: string;
        if (isFuturesRoot(symbol)) {
          // For futures roots, find latest bar across all matching contracts
          const contractRegex = `^${safeEsc}[FGHJKMNQUVXZ][0-9]{1,2}$`;
          anchorQuery = `SELECT max(timestamp) as latest FROM ohlcv WHERE symbol ~ '${contractRegex}'`;
        } else {
          anchorQuery = `SELECT max(timestamp) as latest FROM ohlcv WHERE symbol = '${safeEsc}'`;
        }
        const [row] = await queryQuestDB(anchorQuery);
        if (row?.latest) {
          const latestDate = row.latest instanceof Date ? row.latest.getTime() : new Date(String(row.latest)).getTime();
          if (!isNaN(latestDate)) anchorMs = latestDate;
        }
      } catch { /* fall through to Date.now() anchor */ }
      const estimatedMinutesNeeded = rowLimit * tfMinutes * 3;
      effectiveStart = anchorMs - estimatedMinutesNeeded * 60_000;
    }

    const cacheKey = OHLCVCache.key('chart', symbol, tfMinutes, {
      startTime: effectiveStart, endTime: effectiveEnd, limit: rowLimit,
      extra: isFuturesRoot(symbol) ? adjustment : undefined,
    });

    const healthy = await isQuestDBHealthy();
    if (!healthy) {
      return res.status(503).json({ error: 'QuestDB is not available' });
    }

    const queryFn = isFuturesRoot(symbol)
      ? () => getStitchedOHLCV(symbol, sampleLabel, effectiveStart, effectiveEnd, rowLimit, adjustment)
      : () => getOHLCVSampleBy(symbol, sampleLabel, effectiveStart, effectiveEnd, rowLimit);

    const raw = await cachedQuery(cacheKey, queryFn);
    const data = raw.map((r: any) => ({
      timestamp: normaliseTimestamp(r),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
      ...(r.activeContract ? { activeContract: r.activeContract } : {}),
    }));
    // Sort: QuestDB returns ASC; reverse if caller wants DESC
    if (orderDesc) data.reverse();
    return res.json(data);
  } catch (error: any) {
    console.error('[charts]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/charts/symbols
 * Returns available symbols with row counts and time ranges from QuestDB.
 */
router.get('/symbols', CACHE_SEMI, async (_req: Request, res: Response) => {
  try {
    const healthy = await isQuestDBHealthy();
    if (!healthy) {
      return res.status(503).json({ error: 'QuestDB is not available' });
    }

    const symbols = await queryQuestDB(`
      SELECT symbol,
             count() as row_count,
             min(timestamp) as first_bar,
             max(timestamp) as last_bar
      FROM ohlcv
      ORDER BY symbol
    `);
    return res.json(symbols.map((s: any) => ({
      symbol: s.symbol,
      row_count: Number(s.row_count),
      first_bar: s.first_bar instanceof Date ? s.first_bar.toISOString() : String(s.first_bar),
      last_bar: s.last_bar instanceof Date ? s.last_bar.toISOString() : String(s.last_bar),
    })));
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
