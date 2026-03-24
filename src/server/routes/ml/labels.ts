import { Router, Request, Response } from "express";
import { mlRateLimiter } from "../../lib/rateLimiter";
import { getString } from "../helpers";

const router = Router();

// ============================================================
// LABEL GENERATION API
// ============================================================

let labelServiceModule: any = null;

async function getLabelService() {
  if (!labelServiceModule) {
    labelServiceModule = await import('../../lib/labels/labelService');
  }
  return labelServiceModule.labelService;
}

// Generate labels for a symbol
router.post("/labels/generate", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const labelService = await getLabelService();
    const { name, generatorType, symbol, modelId, params } = req.body;

    if (!name || !generatorType || !symbol) {
      return res.status(400).json({
        error: "Missing required fields: name, generatorType, symbol"
      });
    }

    const result = await labelService.generateLabels({
      name,
      generatorType,
      symbol,
      modelId,
      params: params || {},
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.status(201).json(result);
  } catch (error) {
    console.error("Error generating labels:", error);
    res.status(500).json({ error: "Failed to generate labels" });
  }
});

// Preview labels without storing
router.post("/labels/preview", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const labelService = await getLabelService();
    const { generatorType, symbol, params, limit, startTimestamp, endTimestamp, timeframeMinutes } = req.body;

    if (!generatorType || !symbol) {
      return res.status(400).json({
        error: "Missing required fields: generatorType, symbol"
      });
    }

    const result = await labelService.previewLabels({
      generatorType,
      symbol,
      params: params || {},
      limit: limit || 500,
      startTimestamp,
      endTimestamp,
      timeframeMinutes: timeframeMinutes || 1,
    });

    res.json(result);
  } catch (error) {
    console.error("Error previewing labels:", error);
    res.status(500).json({ error: "Failed to preview labels" });
  }
});

// Get all label sets
router.get("/labels", async (req: Request, res: Response) => {
  try {
    const labelService = await getLabelService();
    const labelSets = await labelService.getLabelSets({
      symbol: getString(req.query.symbol as string) || undefined,
      generatorType: getString(req.query.generatorType as string) || undefined,
      modelId: req.query.modelId ? parseInt(getString(req.query.modelId as string)) : undefined,
      status: getString(req.query.status as string) || undefined,
      limit: req.query.limit ? parseInt(getString(req.query.limit as string)) : 50,
    });
    res.json(labelSets);
  } catch (error) {
    console.error("Error fetching label sets:", error);
    res.status(500).json({ error: "Failed to fetch label sets" });
  }
});

// Get label history (MUST be before /:id to avoid route shadowing)
router.get("/labels/history", async (req: Request, res: Response) => {
  try {
    const labelService = await getLabelService();
    const labelSets = await labelService.getLabelSets({
      symbol: getString(req.query.symbol as string) || undefined,
      limit: req.query.limit ? parseInt(getString(req.query.limit as string)) : 50,
    });
    res.json({ history: labelSets ?? [] });
  } catch (error) {
    console.error("Error fetching label history:", error);
    res.json({ history: [] });
  }
});

// Get available label generators (MUST be before /:id to avoid route shadowing)
router.get("/labels/generators", async (_req: Request, res: Response) => {
  try {
    const { LABEL_GENERATORS } = await import('@shared/mlTaxonomy');
    res.json(LABEL_GENERATORS);
  } catch (error) {
    console.error("Error fetching generators:", error);
    res.status(500).json({ error: "Failed to fetch generators" });
  }
});

// Get specific label set
router.get("/labels/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const labelService = await getLabelService();
    const id = parseInt(req.params.id);
    const labelSet = await labelService.getLabelSetById(id);

    if (!labelSet) {
      return res.status(404).json({ error: "Label set not found" });
    }

    res.json(labelSet);
  } catch (error) {
    console.error("Error fetching label set:", error);
    res.status(500).json({ error: "Failed to fetch label set" });
  }
});

// Get contrastive pairs for a label set
router.get("/labels/:id/pairs", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const labelService = await getLabelService();
    const id = parseInt(req.params.id);
    const limitStr = req.query.limit;
    const limit = limitStr ? parseInt(typeof limitStr === 'string' ? limitStr : String(limitStr)) : 1000;

    const pairs = await labelService.getContrastivePairsForLabelSet(id, limit);
    res.json(pairs);
  } catch (error) {
    console.error("Error fetching contrastive pairs:", error);
    res.status(500).json({ error: "Failed to fetch contrastive pairs" });
  }
});

// Delete label set
router.delete("/labels/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const labelService = await getLabelService();
    const id = parseInt(req.params.id);
    await labelService.deleteLabelSet(id);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting label set:", error);
    res.status(500).json({ error: "Failed to delete label set" });
  }
});

export default router;
