import { Router, Request, Response } from "express";

const router = Router();

// GET /api/features/sets — list named feature sets
router.get("/features/sets", async (_req: Request, res: Response) => {
  try {
    const { listFeatureSets, listFeaturePipelines } = await import("../../training/registry");
    res.json({
      featureSets: listFeatureSets(),
      pipelines: listFeaturePipelines(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to list feature sets" });
  }
});

export default router;
