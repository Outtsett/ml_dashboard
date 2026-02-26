import { Router, Request, Response } from "express";
import { runQuery } from "../../duckdb";
import { mlRateLimiter } from "../../lib/rateLimiter";
import { getString } from "../helpers";
import {
  isValidTimeframe, loadOHLCVBars, loadOHLCVBarsQuestDBOnly,
  deduplicateBars, resolveIndicatorConfig, buildIndicatorNameList,
  sanitizeSQLOptions,
} from "../../lib/indicators/realtimeCalculator";
const router = Router();

router.get("/indicators/list", async (req: Request, res: Response) => {
  try {
    const { listIndicators, getIndicatorsByCategory } = await import("../../lib/indicators");
    const category = req.query.category as string | undefined;
    if (category && ['trend', 'momentum', 'volatility', 'volume', 'overlap'].includes(category)) {
      res.json({ indicators: getIndicatorsByCategory(category as any) });
    } else { res.json({ indicators: listIndicators() }); }
  } catch (e: any) { res.status(500).json({ error: e.message || "Failed to list indicators" }); }
});

router.get("/indicators/:id", async (req: Request, res: Response, next) => {
  if (['catalog', 'data', 'patterns', 'presets'].includes(String(req.params.id))) return next();
  try {
    const { getIndicator } = await import("../../lib/indicators");
    const indicator = getIndicator(getString(req.params.id));
    if (!indicator) return res.status(404).json({ error: `Indicator not found: ${req.params.id}` });
    res.json({ indicator });
  } catch (e: any) { res.status(500).json({ error: e.message || "Failed to get indicator" }); }
});

router.post("/indicators/calculate", async (req: Request, res: Response) => {
  try {
    const { symbol, indicator, params = {}, timeframe = "1m", limit = 500 } = req.body;
    if (!symbol || !indicator) return res.status(400).json({ error: "symbol and indicator are required" });
    const { getIndicator, calculateIndicator } = await import("../../lib/indicators");
    const def = getIndicator(indicator);
    if (!def) return res.status(400).json({ error: `Unknown indicator: ${indicator}` });
    if (!isValidTimeframe(timeframe)) return res.status(400).json({ error: "Invalid timeframe. Valid: 1s, 1m, 5m, 15m, 30m, 1h, 4h, 1d" });
    const bars = await loadOHLCVBars(symbol, timeframe, limit);
    if (!bars.length) return res.status(404).json({ error: `No data found for ${symbol}` });
    const results = calculateIndicator({ indicator, bars, params });
    const startIdx = Math.max(0, (results[0]?.values.length ?? 0) - limit);
    res.json({
      symbol: symbol.toUpperCase(), indicator, timeframe,
      params: { ...def.defaultParams, ...params },
      timestamps: bars.slice(startIdx).map(b => b.timestamp),
      results: results.map(r => ({ name: r.name, values: r.values.slice(startIdx) })),
    });
  } catch (e: any) {
    console.error("Error calculating indicator:", e);
    res.status(500).json({ error: e.message || "Failed to calculate indicator" });
  }
});

router.post("/indicators/generate-sql", async (req: Request, res: Response) => {
  try {
    const { indicator, params = {}, tableName, symbolColumn, timestampColumn } = req.body;
    if (!indicator) return res.status(400).json({ error: "indicator is required" });
    const { generateIndicatorSQL, getIndicator } = await import("../../lib/indicators");
    const def = getIndicator(indicator);
    if (!def) return res.status(400).json({ error: `Unknown indicator: ${indicator}` });
    const sql = generateIndicatorSQL({ indicator, params, options: sanitizeSQLOptions({ tableName, symbolColumn, timestampColumn }) });
    res.json({ indicator, params: { ...def.defaultParams, ...params }, sql });
  } catch (e: any) { res.status(500).json({ error: e.message || "Failed to generate SQL" }); }
});

router.post("/indicators/generate-bulk-sql", async (req: Request, res: Response) => {
  try {
    const { request, tableName, symbolColumn, timestampColumn } = req.body;
    if (!request) return res.status(400).json({ error: "request object is required" });
    const { generateBulkIndicatorsSQL } = await import("../../lib/indicators");
    res.json({ sql: generateBulkIndicatorsSQL(request, sanitizeSQLOptions({ tableName, symbolColumn, timestampColumn })) });
  } catch (e: any) { res.status(500).json({ error: e.message || "Failed to generate bulk SQL" }); }
});

router.post("/indicators/compute", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const { symbol, indicators, preset, limit = 1000 } = req.body;
    if (!symbol) return res.status(400).json({ error: "Symbol is required" });
    const ohlcvData = await loadOHLCVBarsQuestDBOnly(symbol, '1m', limit);
    if (!ohlcvData.length) return res.status(404).json({ error: `No OHLCV data found for ${symbol}` });
    const bars = deduplicateBars(ohlcvData);
    const config = await resolveIndicatorConfig(preset, indicators);
    const { computeIndicatorsRealtime } = await import('../../lib/indicators/indicatorService');
    const results = computeIndicatorsRealtime(bars, { indicators: config });
    res.json({
      success: true, symbol, count: results.length, barsAvailable: bars.length,
      indicators: buildIndicatorNameList(config), data: results,
    });
  } catch (e) {
    console.error("Error computing indicators:", e);
    res.status(500).json({ error: "Failed to compute indicators", details: String(e) });
  }
});

router.get("/indicators/presets", (_req: Request, res: Response) => {
  import('../../lib/indicators/indicatorService').then(({ INDICATOR_PRESETS }) => {
    res.json(INDICATOR_PRESETS);
  }).catch(e => {
    console.error("Error fetching presets:", e);
    res.status(500).json({ error: "Failed to fetch presets" });
  });
});

router.post("/indicators/sql", async (req: Request, res: Response) => {
  try {
    const { symbol, indicators, tableName = 'ohlcv' } = req.body;
    if (!indicators) return res.status(400).json({ error: "Indicators configuration is required" });
    const { generateIndicatorSQL } = await import('../../lib/indicators/indicatorService');
    res.json({ success: true, sql: generateIndicatorSQL({ indicators }, tableName, symbol) });
  } catch (e) {
    console.error("Error generating SQL:", e);
    res.status(500).json({ error: "Failed to generate SQL" });
  }
});

router.post("/indicators/batch", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const { symbol, indicators, preset, limit = 10000 } = req.body;
    if (!symbol) return res.status(400).json({ error: "Symbol is required" });
    const config = await resolveIndicatorConfig(preset, indicators);
    const { generateIndicatorSQL } = await import('../../lib/indicators/indicatorService');
    const results = await runQuery(`${generateIndicatorSQL({ indicators: config }, 'ohlcv', symbol)} LIMIT ${limit}`);
    res.json({ success: true, symbol, count: results.length, data: results });
  } catch (e) {
    console.error("Error computing batch indicators:", e);
    res.status(500).json({ error: "Failed to compute batch indicators", details: String(e) });
  }
});

export default router;
