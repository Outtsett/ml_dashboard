import { Router, Request, Response } from "express";
import { storage } from "../../storage";
import { mlRateLimiter } from "../../lib/rateLimiter";
import { getString } from "../helpers";

const router = Router();

// ============================================================
// TRAINING SESSION APIS
// ============================================================

router.get("/training/active", async (req: Request, res: Response) => {
  try {
    const session = await storage.getActiveTrainingSession();
    if (!session) {
      return res.json(null);
    }
    res.json(session);
  } catch (error) {
    console.error("Error fetching active session:", error);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

router.get("/training/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getString(req.params.id));
    const session = await storage.getTrainingSession(id);
    res.json(session);
  } catch (error) {
    console.error("Error fetching session:", error);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

router.post("/training", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const session = await storage.createTrainingSession(req.body);
    res.json(session);
  } catch (error) {
    console.error("Error creating session:", error);
    res.status(500).json({ error: "Failed to create session" });
  }
});

router.patch("/training/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getString(req.params.id));
    await storage.updateTrainingSession(id, req.body);
    const updated = await storage.getTrainingSession(id);
    res.json(updated);
  } catch (error) {
    console.error("Error updating session:", error);
    res.status(500).json({ error: "Failed to update session" });
  }
});

// Loss history APIs
router.get("/training/:id/loss", async (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(getString(req.params.id));
    const history = await storage.getLossHistory(sessionId);
    res.json(history);
  } catch (error) {
    console.error("Error fetching loss history:", error);
    res.status(500).json({ error: "Failed to fetch loss history" });
  }
});

router.post("/training/:id/loss", async (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(getString(req.params.id));
    const entry = await storage.addLossHistory({
      sessionId,
      epoch: req.body.epoch,
      loss: req.body.loss,
      valLoss: req.body.valLoss,
    });
    res.json(entry);
  } catch (error) {
    console.error("Error adding loss history:", error);
    res.status(500).json({ error: "Failed to add loss history" });
  }
});

// Get feature importance for a model
router.get("/ml/feature-importance/:modelName", async (req: Request, res: Response) => {
  try {
    const modelName = getString(req.params.modelName);
    const data = await storage.getFeatureImportance(modelName);
    res.json(data.map(f => ({
      feature: f.featureName,
      importance: f.importance,
      category: f.category || (f.featureName === 'volume' ? 'volume' : 'price'),
    })));
  } catch (error: any) {
    console.error("Error getting feature importance:", error);
    res.status(500).json({ error: error.message || "Failed to get feature importance" });
  }
});

export default router;
