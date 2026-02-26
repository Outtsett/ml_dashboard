import { Router, Request, Response } from "express";
import { getString } from "../helpers";
import {
  getCatalog,
  getIndicatorData,
  getPatternData,
} from "../../lib/indicators/precomputedService";
import { CACHE_STATIC, CACHE_SEMI } from "../../lib/cacheHeaders";

const router = Router();

// Get catalog of all pre-computed indicator columns
router.get("/indicators/catalog", CACHE_STATIC, async (_req: Request, res: Response) => {
  try {
    const result = await getCatalog();
    res.json(result);
  } catch (error: any) {
    console.error("Error fetching indicator catalog:", error);
    res.status(500).json({ error: error.message || "Failed to fetch indicator catalog" });
  }
});

// Get pre-computed indicator data for a symbol
router.get("/indicators/data/:symbol", CACHE_SEMI, async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = (req.query.timeframe as string) || "1m";
    const columns = req.query.columns as string | undefined;
    const limitStr = req.query.limit as string | undefined;
    const limit = limitStr ? Math.min(parseInt(limitStr), 10000) : 2000;

    const result = await getIndicatorData(symbol, timeframe, columns, limit);

    if ("notFound" in result) {
      return res.status(404).json(result.notFound);
    }
    res.json(result.data);
  } catch (error: any) {
    console.error("Error fetching indicator data:", error);
    res.status(500).json({ error: error.message || "Failed to fetch indicator data" });
  }
});

// Get candle pattern data only (CDL_* columns)
router.get("/indicators/patterns/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = (req.query.timeframe as string) || "1d";
    const limitStr = req.query.limit as string | undefined;
    const limit = limitStr ? Math.min(parseInt(limitStr), 5000) : 2000;

    const result = await getPatternData(symbol, timeframe, limit);

    if ("notFound" in result) {
      return res.status(404).json(result.notFound);
    }
    res.json(result.data);
  } catch (error: any) {
    console.error("Error fetching pattern data:", error);
    res.status(500).json({ error: error.message || "Failed to fetch pattern data" });
  }
});

export default router;
