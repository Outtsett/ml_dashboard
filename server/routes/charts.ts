/**
 * Chart data API — serves OHLCV candles from QuestDB.
 * QuestDB's SAMPLE BY handles timeframe aggregation on the fly.
 * Falls back to DuckDB if QuestDB is unavailable.
 */
import { Router, Request, Response } from 'express';
import { getOHLCVSampleBy, checkQuestDBHealth } from '../questdb';
import { marketQuery } from '../duckdb/market';
import { cachedQuery, OHLCVCache } from '../lib/ohlcvCache';

const router = Router();

const VALID_TIMEFRAMES = ['1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d'];

/**
 * GET /api/charts/ohlcv?symbol=MNQ&timeframe=5m&start=2024-01-01&end=2024-12-31&limit=5000
 */
router.get('/ohlcv', async (req: Request, res: Response) => {
  try {
    const { symbol, timeframe = '1m', start, end, limit } = req.query;

    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ error: 'symbol is required' });
    }

    if (!VALID_TIMEFRAMES.includes(timeframe as string)) {
      return res.status(400).json({ error: `Invalid timeframe. Valid: ${VALID_TIMEFRAMES.join(', ')}` });
    }

    const startMs = start ? new Date(start as string).getTime() : undefined;
    const endMs = end ? new Date(end as string).getTime() : undefined;
    const rowLimit = limit ? parseInt(limit as string) : 5000;

    const chartCacheKey = OHLCVCache.key('chart', symbol, timeframe as string, {
      startTime: startMs, endTime: endMs, limit: rowLimit
    });

    // Try QuestDB first (optimized for chart serving with SAMPLE BY)
    const questdbHealthy = await checkQuestDBHealth();

    if (questdbHealthy) {
      const data = await cachedQuery(chartCacheKey, () =>
        getOHLCVSampleBy(symbol, timeframe as string, startMs, endMs, rowLimit)
      );
      return res.json({ source: 'questdb', count: data.length, data });
    }

    // Fallback: DuckDB (no SAMPLE BY, return raw data)
    console.warn('[charts] QuestDB unavailable, falling back to DuckDB');
    const safeSymbol = symbol.replace(/'/g, "''");
    let sql = `SELECT ts::VARCHAR as timestamp, symbol, open, high, low, close, volume FROM ohlcv WHERE symbol = '${safeSymbol}'`;
    if (startMs) sql += ` AND ts >= '${new Date(startMs).toISOString()}'`;
    if (endMs) sql += ` AND ts <= '${new Date(endMs).toISOString()}'`;
    sql += ` ORDER BY ts LIMIT ${rowLimit}`;

    const data = await cachedQuery(chartCacheKey + ':duckdb', () => marketQuery(sql));
    return res.json({ source: 'duckdb', count: data.length, data });
  } catch (error: any) {
    console.error('[charts]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/charts/symbols
 * Returns available symbols with row counts and time ranges.
 */
router.get('/symbols', async (_req: Request, res: Response) => {
  try {
    const symbols = await marketQuery(`
      SELECT symbol,
             COUNT(*) as row_count,
             MIN(ts)::VARCHAR as first_bar,
             MAX(ts)::VARCHAR as last_bar
      FROM ohlcv
      GROUP BY symbol
      ORDER BY symbol
    `);
    return res.json(symbols.map((s: any) => ({
      ...s,
      row_count: Number(s.row_count),
    })));
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
