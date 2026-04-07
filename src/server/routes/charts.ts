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
import { getOHLCVSampleBy, getStitchedOHLCV, checkQuestDBHealth, queryQuestDB, queryQuestDBFast } from '../database/questdb';
import type { AdjustmentMode } from '@shared/ohlcv';
import { cachedQuery, OHLCVCache } from '../cache/ohlcv';
import { getCachedAnchor, setCachedAnchor } from '../cache/anchor';
import { getSymbolsCatalogCache, setSymbolsCatalogCache } from '../cache/symbols';
import { CACHE_SEMI } from '../cache/headers';
import { normalizeTimestamp, parseTimestampParam } from '../lib/normalize';
import { isFuturesRoot } from '../lib/futures';
import { isValidSymbol } from '@shared/validation';
import { encode as msgpackEncode } from '@msgpack/msgpack';

// Re-export cache functions for backward compat (infrastructure.ts imports from here)
export { clearAnchorCache } from '../cache/anchor';
export { clearSymbolsCatalogCache, warmSymbolsCatalog } from '../cache/symbols';

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
  // Track client disconnection — abort heavy queries when the user switches symbols
  let clientDisconnected = false;
  req.on('close', () => { clientDisconnected = true; });

  // Route-level timeout: fail fast instead of leaving UI frozen
  const routeTimeout = setTimeout(() => {
    if (!res.headersSent) {
      console.warn('[charts] /ohlcv route timeout (15s):', req.query.symbol);
      res.status(504).json({ error: 'Chart data request timed out (15s)' });
    }
  }, 15_000);

  try {
    const symbol = (req.query.symbol as string)?.trim()?.toUpperCase();
    if (!symbol || typeof symbol !== 'string' || !isValidSymbol(symbol)) {
      clearTimeout(routeTimeout);
      return res.status(400).json({ error: 'Invalid symbol parameter' });
    }

    const tfMinutes = parseTimeframeMinutes(req.query.timeframe as string);
    const startMs = parseTimestamp(req.query.startTime as string) ?? parseTimestamp(req.query.start as string);
    const endMs   = parseTimestamp(req.query.endTime as string)   ?? parseTimestamp(req.query.end as string);
    const rowLimit = Math.min(parseInt(req.query.limit as string) || 10000, 100000);
    const orderDesc = (req.query.order as string)?.toLowerCase() !== 'asc';
    const adjustmentRaw = (req.query.adjustment as string)?.toLowerCase();
    const adjustment: AdjustmentMode = adjustmentRaw === 'panama' ? 'panama'
      : adjustmentRaw === 'ratio' ? 'ratio' : 'none';

    const sampleLabel = MINUTES_TO_SAMPLE[tfMinutes]
      || LABEL_TO_SAMPLE[(req.query.timeframe as string)?.toLowerCase() ?? '']
      || '1m';

    // ── Estimate a reasonable time window when none is provided ──
    // Without this, SAMPLE BY scans ALL data for the symbol (millions of rows).
    // ALWAYS compute a window when no explicit bounds are given, regardless of order.
    let effectiveStart = startMs;
    const effectiveEnd   = endMs;

    // Start health check + anchor query in parallel (avoid sequential await)
    const healthPromise = isQuestDBHealthy();
    let anchorPromise: Promise<number> | null = null;

    if (!effectiveStart && !effectiveEnd) {
      anchorPromise = (async () => {
        // Check in-memory cache first (5-min TTL)
        const cached = getCachedAnchor(symbol);
        if (cached !== undefined) return cached;

        try {
          const safeEsc = symbol.replace(/'/g, "''");
          let anchorQuery: string;
          if (isFuturesRoot(symbol)) {
            anchorQuery = `SELECT max(timestamp) as latest FROM ohlcv WHERE root = '${safeEsc}' AND asset_class = 'futures'`;
          } else {
            anchorQuery = `SELECT max(timestamp) as latest FROM ohlcv WHERE symbol = '${safeEsc}'`;
          }
          const [row] = await queryQuestDBFast(anchorQuery); // 10s timeout for anchor
          if (row?.latest) {
            const latestDate = row.latest instanceof Date ? row.latest.getTime() : new Date(String(row.latest)).getTime();
            if (!isNaN(latestDate)) {
              setCachedAnchor(symbol, latestDate);
              return latestDate;
            }
          }
        } catch { /* fall through */ }
        return Date.now();
      })();
    }

    // Await both in parallel
    const [healthy, anchorMs] = await Promise.all([
      healthPromise,
      anchorPromise ?? Promise.resolve(null),
    ]);

    if (!healthy) {
      clearTimeout(routeTimeout);
      return res.status(503).json({ error: 'QuestDB is not available' });
    }

    if (anchorMs !== null) {
      // Multiplier accounts for non-trading hours: 3x covers weekends + overnight gaps
      // (was 10x which caused SAMPLE BY to scan 70+ days for a 10k bar request)
      const estimatedMinutesNeeded = rowLimit * tfMinutes * 3;
      effectiveStart = anchorMs - estimatedMinutesNeeded * 60_000;
    }

    const cacheKey = OHLCVCache.key('chart', symbol, tfMinutes, {
      startTime: effectiveStart, endTime: effectiveEnd, limit: rowLimit,
      extra: isFuturesRoot(symbol) ? adjustment : undefined,
    });

    // Bail out if client already disconnected (e.g. user switched symbols)
    if (clientDisconnected) {
      clearTimeout(routeTimeout);
      return;
    }

    const isFR = isFuturesRoot(symbol);

    const queryFn = isFR
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
      // Anatomy
      body_magnitude: Number(r.body_magnitude || 0),
      upper_wick_pct: Number(r.upper_wick_pct || 0),
      lower_wick_pct: Number(r.lower_wick_pct || 0),
      is_bullish: !!r.is_bullish,
      ...(r.activeContract ? { activeContract: r.activeContract } : {}),
    }));
    // Sort: QuestDB returns ASC; reverse if caller wants DESC
    if (orderDesc) data.reverse();
    clearTimeout(routeTimeout);
    if (res.headersSent) return; // route timeout already fired

    // MessagePack binary response if client requests it (~50% smaller than JSON)
    const accept = req.headers['accept'] || '';
    if (accept.includes('application/msgpack')) {
      const packed = msgpackEncode(data);
      res.setHeader('Content-Type', 'application/msgpack');
      return res.send(Buffer.from(packed));
    }

    return res.json(data);
  } catch (error: any) {
    clearTimeout(routeTimeout);
    if (res.headersSent) return;
    console.error('[charts]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/charts/symbols
 * Returns available symbols from the `symbols` table (904 rows, instant).
 * Cached for 1 hour — symbol catalog rarely changes.
 */
router.get('/symbols', CACHE_SEMI, async (_req: Request, res: Response) => {
  try {
    const healthy = await isQuestDBHealthy();
    if (!healthy) {
      return res.status(503).json({ error: 'QuestDB is not available' });
    }

    const cached = getSymbolsCatalogCache();
    if (cached) {
      return res.json(cached.data);
    }

    const symbols = await queryQuestDB(`
      SELECT symbol, asset_class, root
      FROM symbols
      ORDER BY symbol
    `);
    const result = symbols.map((s: any) => ({
      symbol: s.symbol,
      asset_class: s.asset_class,
      root: s.root,
    }));

    setSymbolsCatalogCache(result);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
