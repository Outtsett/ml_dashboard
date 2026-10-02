import { Router, Request, Response } from "express";
import { storage } from "../infrastructure/storage";
import { getString } from "../infrastructure/lib/routeHelpers";
import { CACHE_STATIC } from "../infrastructure/cache/headers";

const router = Router();

// Instrument metadata APIs
router.get("/instruments", CACHE_STATIC, async (req: Request, res: Response) => {
  try {
    const type = getString(req.query.type as string);
    if (type === 'futures' || type === 'forex') {
      const instruments = await storage.getInstrumentsByType(type);
      res.json(instruments);
    } else {
      const instruments = await storage.getAllInstruments();
      res.json(instruments);
    }
  } catch (error) {
    console.error("Error fetching instruments:", error);
    res.status(500).json({ error: "Failed to fetch instruments" });
  }
});

router.get("/instruments/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol);
    const instrument = await storage.getInstrument(symbol);
    if (!instrument) {
      return res.status(404).json({ error: "Instrument not found" });
    }
    res.json(instrument);
  } catch (error) {
    console.error("Error fetching instrument:", error);
    res.status(500).json({ error: "Failed to fetch instrument" });
  }
});

// Get feature importance for a model
router.get("/features/:modelName", async (req: Request, res: Response) => {
  try {
    const modelName = getString(req.params.modelName);
    const features = await storage.getFeatureImportance(modelName);
    res.json(features);
  } catch (error) {
    console.error("Error fetching feature importance:", error);
    res.status(500).json({ error: "Failed to fetch feature importance" });
  }
});

// Save feature importance
router.post("/features", async (req: Request, res: Response) => {
  try {
    const features = req.body;
    await storage.saveFeatureImportance(features);
    res.json({ message: "Feature importance saved" });
  } catch (error) {
    console.error("Error saving feature importance:", error);
    res.status(500).json({ error: "Failed to save feature importance" });
  }
});

export default router;
