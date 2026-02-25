import { Router, Request, Response } from "express";
import { getString } from "../helpers";

const router = Router();

// Generate ML features from parquet data
router.post("/ml/features/:symbol/generate", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = req.body?.timeframe || "1m";
    const config = req.body?.config || {};

    const { generateMLFeatures } = await import("../../duckdb");

    console.log(`[routes] Generating ML features for ${symbol} (${timeframe})...`);
    const result = await generateMLFeatures(symbol, timeframe, config);

    res.json({
      success: true,
      symbol,
      timeframe,
      path: result.path,
      rowCount: result.rowCount,
      featureCount: result.features.length,
      features: result.features
    });
  } catch (error: any) {
    console.error("Error generating ML features:", error);
    res.status(500).json({ error: error.message || "Failed to generate ML features" });
  }
});

// Get ML features preview
router.get("/ml/features/:symbol/preview", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = (req.query.timeframe as string) || "1m";
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);

    const { getMLFeaturesPreview } = await import("../../duckdb");
    const data = await getMLFeaturesPreview(symbol, timeframe, limit);

    res.json({ symbol, timeframe, rowCount: data.length, data });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get ML features" });
  }
});

// List available parquet files
router.get("/ml/parquet-files", async (req: Request, res: Response) => {
  try {
    const { getAvailableParquetFiles } = await import("../../duckdb");
    const files = await getAvailableParquetFiles();
    res.json({ files });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to list parquet files" });
  }
});

export default router;
