import { Router, Request, Response } from "express";
import { mlRateLimiter } from "../../lib/rateLimiter";
import { getString } from "../helpers";
import {
  loadOHLCVBarsQuestDBOnly,
  deduplicateBars, resolveIndicatorConfig, buildIndicatorNameList,
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

export default router;
