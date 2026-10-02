import { Router, Request, Response } from "express";
import { storage } from "../infrastructure/storage";
import { mlRateLimiter } from "../infrastructure/lib/rateLimiter";
import { getString } from "../infrastructure/lib/routeHelpers";

const router = Router();

// ============================================================
// ML OBSERVATORY API ROUTES
// ============================================================

// ML Models CRUD
router.get("/ml/models", async (req: Request, res: Response) => {
  try {
    const status = getString(req.query.status as string) || undefined;
    const models = await storage.getMlModels(status);
    res.json(models);
  } catch (error) {
    console.error("Error fetching ML models:", error);
    res.status(500).json({ error: "Failed to fetch ML models" });
  }
});

router.get("/ml/models/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getString(req.params.id));
    const model = await storage.getMlModel(id);
    if (!model) return res.status(404).json({ error: "Model not found" });
    res.json(model);
  } catch (error) {
    console.error("Error fetching ML model:", error);
    res.status(500).json({ error: "Failed to fetch ML model" });
  }
});

router.post("/ml/models", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const model = await storage.createMlModel(req.body);
    res.status(201).json(model);
  } catch (error) {
    console.error("Error creating ML model:", error);
    res.status(500).json({ error: "Failed to create ML model" });
  }
});

router.put("/ml/models/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getString(req.params.id));
    await storage.updateMlModel(id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error("Error updating ML model:", error);
    res.status(500).json({ error: "Failed to update ML model" });
  }
});

// Feature Sets
router.get("/ml/feature-sets", async (req: Request, res: Response) => {
  try {
    const featureSets = await storage.getFeatureSets();
    res.json(featureSets);
  } catch (error) {
    console.error("Error fetching feature sets:", error);
    res.status(500).json({ error: "Failed to fetch feature sets" });
  }
});

router.post("/ml/feature-sets", async (req: Request, res: Response) => {
  try {
    const featureSet = await storage.createFeatureSet(req.body);
    res.status(201).json(featureSet);
  } catch (error) {
    console.error("Error creating feature set:", error);
    res.status(500).json({ error: "Failed to create feature set" });
  }
});

// Model Outputs
router.get("/ml/outputs/:modelId", async (req: Request, res: Response) => {
  try {
    const modelId = parseInt(getString(req.params.modelId));
    const symbol = getString(req.query.symbol as string) || undefined;
    const limit = parseInt(getString(req.query.limit as string) || '1000');
    const outputs = await storage.getModelOutputs(modelId, symbol, limit);
    res.json(outputs);
  } catch (error) {
    console.error("Error fetching model outputs:", error);
    res.status(500).json({ error: "Failed to fetch model outputs" });
  }
});

router.post("/ml/outputs", async (req: Request, res: Response) => {
  try {
    const output = await storage.saveModelOutput(req.body);
    res.status(201).json(output);
  } catch (error) {
    console.error("Error saving model output:", error);
    res.status(500).json({ error: "Failed to save model output" });
  }
});

router.post("/ml/outputs/batch", async (req: Request, res: Response) => {
  try {
    await storage.saveModelOutputBatch(req.body.outputs);
    res.status(201).json({ success: true, count: req.body.outputs?.length || 0 });
  } catch (error) {
    console.error("Error saving model outputs batch:", error);
    res.status(500).json({ error: "Failed to save model outputs" });
  }
});

// Coherence Analysis
router.get("/ml/coherence/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol);
    const startTime = parseInt(getString(req.query.startTime as string) || '0');
    const endTime = parseInt(getString(req.query.endTime as string) || String(Date.now()));

    const coherence = await storage.getModelCoherence(symbol, startTime, endTime);
    res.json(coherence);
  } catch (error) {
    console.error("Error fetching coherence:", error);
    res.status(500).json({ error: "Failed to fetch coherence data" });
  }
});

router.post("/ml/coherence/snapshot", async (req: Request, res: Response) => {
  try {
    const snapshot = await storage.saveCoherenceSnapshot(req.body);
    res.status(201).json(snapshot);
  } catch (error) {
    console.error("Error saving coherence snapshot:", error);
    res.status(500).json({ error: "Failed to save coherence snapshot" });
  }
});

// Ensemble Configs
router.get("/ml/ensembles", async (req: Request, res: Response) => {
  try {
    const ensembles = await storage.getEnsembleConfigs();
    res.json(ensembles);
  } catch (error) {
    console.error("Error fetching ensembles:", error);
    res.status(500).json({ error: "Failed to fetch ensembles" });
  }
});

router.post("/ml/ensembles", async (req: Request, res: Response) => {
  try {
    const ensemble = await storage.createEnsembleConfig(req.body);
    res.status(201).json(ensemble);
  } catch (error) {
    console.error("Error creating ensemble:", error);
    res.status(500).json({ error: "Failed to create ensemble" });
  }
});

router.get("/ml/ensembles/:id/simulate", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getString(req.params.id));
    const symbol = getString(req.query.symbol as string);
    const startTime = parseInt(getString(req.query.startTime as string) || '0');
    const endTime = parseInt(getString(req.query.endTime as string) || String(Date.now()));

    if (!symbol) return res.status(400).json({ error: "Symbol is required" });

    const signals = await storage.simulateEnsemble(id, symbol, startTime, endTime);
    res.json(signals);
  } catch (error) {
    console.error("Error simulating ensemble:", error);
    res.status(500).json({ error: "Failed to simulate ensemble" });
  }
});

// Trades
router.get("/ml/trades", async (req: Request, res: Response) => {
  try {
    const options = {
      symbol: getString(req.query.symbol as string) || undefined,
      modelId: req.query.modelId ? parseInt(getString(req.query.modelId as string)) : undefined,
      status: getString(req.query.status as string) || undefined,
      limit: parseInt(getString(req.query.limit as string) || '100')
    };
    const trades = await storage.getTrades(options);
    res.json(trades);
  } catch (error) {
    console.error("Error fetching trades:", error);
    res.status(500).json({ error: "Failed to fetch trades" });
  }
});

router.post("/ml/trades", async (req: Request, res: Response) => {
  try {
    const trade = await storage.createTrade(req.body);
    res.status(201).json(trade);
  } catch (error) {
    console.error("Error creating trade:", error);
    res.status(500).json({ error: "Failed to create trade" });
  }
});

router.put("/ml/trades/:id/close", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getString(req.params.id));
    const { exitPrice, exitTimestamp } = req.body;
    const trade = await storage.closeTrade(id, exitPrice, exitTimestamp);
    if (!trade) return res.status(404).json({ error: "Trade not found" });
    res.json(trade);
  } catch (error) {
    console.error("Error closing trade:", error);
    res.status(500).json({ error: "Failed to close trade" });
  }
});

// Market Regimes
router.get("/ml/regimes", async (req: Request, res: Response) => {
  try {
    const regimes = await storage.getMarketRegimes();
    res.json(regimes);
  } catch (error) {
    console.error("Error fetching regimes:", error);
    res.status(500).json({ error: "Failed to fetch regimes" });
  }
});

router.post("/ml/regimes", async (req: Request, res: Response) => {
  try {
    const regime = await storage.createMarketRegime(req.body);
    res.status(201).json(regime);
  } catch (error) {
    console.error("Error creating regime:", error);
    res.status(500).json({ error: "Failed to create regime" });
  }
});

router.post("/ml/regimes/history", async (req: Request, res: Response) => {
  try {
    const history = await storage.recordRegimeHistory(req.body);
    res.status(201).json(history);
  } catch (error) {
    console.error("Error recording regime history:", error);
    res.status(500).json({ error: "Failed to record regime history" });
  }
});

export default router;
