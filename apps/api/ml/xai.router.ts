import { Router, Request, Response } from "express";
import { sanitizeModelId, getModelShap } from "../infrastructure/lib/modelResults";
import { CACHE_STATIC } from "../infrastructure/cache/headers";
import { logInfo } from "../infrastructure/lib/log";
import type { XAIMethodKey } from "@shared/mlTaxonomy";

const router = Router();

// ============================================================
// EXPLAINABLE AI (XAI) API ENDPOINTS
// ============================================================

let xaiServiceModule: typeof import("../infrastructure/lib/xai/xaiService") | null = null;

async function getXAIService() {
  if (!xaiServiceModule) {
    xaiServiceModule = await import('../infrastructure/lib/xai/xaiService');
  }
  return xaiServiceModule.xaiService;
}

const MODELS_DIR = "data/models";

// List available XAI methods
router.get("/xai/methods", CACHE_STATIC, async (req: Request, res: Response) => {
  try {
    const xaiService = await getXAIService();
    const methods = xaiService.listMethods();
    res.json({ success: true, methods });
  } catch (error) {
    console.error("Error listing XAI methods:", error);
    res.status(500).json({ error: (error as Error).message || "Failed to list XAI methods" });
  }
});

// Generate explanation for a prediction
router.post("/xai/explain", async (req: Request, res: Response) => {
  try {
    const xaiService = await getXAIService();
    const { input, method, params, modelId, symbol } = req.body;

    let inputData = input;

    // If no input provided but symbol given, fetch recent OHLCV data from lake
    if ((!input || !Array.isArray(input) || input.length === 0) && symbol) {
      try {
        const { checkLakeHealth, getOHLCVSampleBy } = await import("../infrastructure/database/lake");
        const healthy = await checkLakeHealth();
        if (healthy) {
          const ohlcv = await getOHLCVSampleBy(symbol, '1m', undefined, undefined, 30);
          if (ohlcv && ohlcv.length > 0) {
            inputData = ohlcv.map((bar) => [
              Number(bar.open) || 0,
              Number(bar.high) || 0,
              Number(bar.low) || 0,
              Number(bar.close) || 0,
              Number(bar.volume) || 0
            ]);
          }
        }
      } catch (e) {
        logInfo('[XAI] Could not fetch real data, using synthetic:', (e as Error).message);
      }
    }

    // Generate synthetic data if still no input
    if (!inputData || !Array.isArray(inputData) || inputData.length === 0) {
      inputData = [];
      let price = 100 + Math.random() * 50;
      for (let t = 0; t < 30; t++) {
        const change = (Math.random() - 0.5) * 2;
        price += change;
        inputData.push([price, price + Math.random() * 2, price - Math.random() * 2, price + (Math.random() - 0.5), 1000 + Math.random() * 5000]);
      }
    }

    if (!method) {
      return res.status(400).json({ error: "XAI method required" });
    }

    const config = {
      method: method as XAIMethodKey,
      params: params || {}
    };

    const result = await xaiService.explainPrediction(
      inputData,
      config,
      modelId || 0
    );

    res.json({ success: true, prediction: result.prediction, explanation: result.explanation });
  } catch (error) {
    console.error("Error generating XAI explanation:", error);
    res.status(500).json({ error: (error as Error).message || "Failed to generate explanation" });
  }
});

// Batch explain multiple samples
router.post("/xai/explain-batch", async (req: Request, res: Response) => {
  try {
    const xaiService = await getXAIService();
    const { samples, method, params, modelId } = req.body;

    if (!samples || !Array.isArray(samples) || samples.length === 0) {
      return res.status(400).json({ error: "Samples array required" });
    }

    if (!method) {
      return res.status(400).json({ error: "XAI method required" });
    }

    const config = {
      method: method as XAIMethodKey,
      params: params || {}
    };

    const results = [];
    for (const sample of samples.slice(0, 10)) { // Limit to 10 samples
      const result = await xaiService.explainPrediction(
        sample,
        config,
        modelId || 0
      );
      results.push(result);
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error("Error generating batch XAI explanations:", error);
    res.status(500).json({ error: (error as Error).message || "Failed to generate batch explanations" });
  }
});

// ── Real SHAP importance for trained regime models (e.g. "MNQ_1m") ──────────

router.get("/xai/regime-importance/:modelId", async (req: Request, res: Response) => {
  try {
    const xaiService = await getXAIService();
    const modelId = String(req.params.modelId);
    sanitizeModelId(modelId); // validates format

    const importance = xaiService.getRegimeModelImportance(modelId);
    res.json({ success: true, importance });
  } catch (error) {
    const status = (error as Error).message?.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: (error as Error).message || "Failed to get regime model importance" });
  }
});

// ── Per-bar SHAP values (model_shap lake table removed — always returns 404)

router.get("/xai/shap/:modelId", async (req: Request, res: Response) => {
  try {
    const modelId = String(req.params.modelId);
    const result = await getModelShap(MODELS_DIR, modelId, {
      regime: req.query.regime !== undefined ? Number(req.query.regime) : undefined,
      limit: Number(req.query.limit) || undefined,
      offset: Number(req.query.offset) || undefined,
    });
    if (!result) return res.status(404).json({ error: `SHAP data not found for '${modelId}'` });
    res.json({ success: true, ...(result as Record<string, unknown>) });
  } catch (error) {
    const status = (error as Error).message?.includes("Invalid model ID") ? 400 : 500;
    res.status(status).json({ error: (error as Error).message || "Failed to get SHAP data" });
  }
});

export default router;

