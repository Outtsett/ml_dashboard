import { Router, Request, Response } from "express";
import { getString } from "../helpers";

const router = Router();

// ============================================================
// EXPLAINABLE AI (XAI) API ENDPOINTS
// ============================================================

let xaiServiceModule: any = null;

async function getXAIService() {
  if (!xaiServiceModule) {
    xaiServiceModule = await import('../../lib/xai/xaiService');
  }
  return xaiServiceModule.xaiService;
}

// List available XAI methods
router.get("/xai/methods", async (req: Request, res: Response) => {
  try {
    const xaiService = await getXAIService();
    const methods = xaiService.listMethods();
    res.json({ success: true, methods });
  } catch (error: any) {
    console.error("Error listing XAI methods:", error);
    res.status(500).json({ error: error.message || "Failed to list XAI methods" });
  }
});

// Generate explanation for a prediction
router.post("/xai/explain", async (req: Request, res: Response) => {
  try {
    const xaiService = await getXAIService();
    const { input, method, params, modelId, symbol } = req.body;

    let inputData = input;

    // If no input provided but symbol given, fetch recent OHLCV data from QuestDB
    if ((!input || !Array.isArray(input) || input.length === 0) && symbol) {
      try {
        const { checkQuestDBHealth, getOHLCVSampleBy } = await import("../../questdb");
        const healthy = await checkQuestDBHealth();
        if (healthy) {
          const ohlcv = await getOHLCVSampleBy(symbol, '1m', undefined, undefined, 30);
          if (ohlcv && ohlcv.length > 0) {
            inputData = ohlcv.map((bar: any) => [
              Number(bar.open) || 0,
              Number(bar.high) || 0,
              Number(bar.low) || 0,
              Number(bar.close) || 0,
              Number(bar.volume) || 0
            ]);
          }
        }
      } catch (e) {
        console.log('[XAI] Could not fetch real data, using synthetic');
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
      method: method as any,
      params: params || {}
    };

    const result = await xaiService.explainPrediction(
      inputData,
      config,
      modelId || 0
    );

    res.json({ success: true, prediction: result.prediction, explanation: result.explanation });
  } catch (error: any) {
    console.error("Error generating XAI explanation:", error);
    res.status(500).json({ error: error.message || "Failed to generate explanation" });
  }
});

// Get feature importance for a specific model
router.get("/xai/importance/:modelId", async (req: Request, res: Response) => {
  try {
    const xaiService = await getXAIService();
    const modelIdParam = req.params.modelId as string;
    const modelId = parseInt(modelIdParam);

    if (isNaN(modelId)) {
      return res.status(400).json({ error: "Valid model ID required" });
    }

    const importance = await xaiService.getFeatureImportanceForModel(modelId);
    res.json({ success: true, importance });
  } catch (error: any) {
    console.error("Error getting feature importance:", error);
    res.status(500).json({ error: error.message || "Failed to get feature importance" });
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
      method: method as any,
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
  } catch (error: any) {
    console.error("Error generating batch XAI explanations:", error);
    res.status(500).json({ error: error.message || "Failed to generate batch explanations" });
  }
});

export default router;
