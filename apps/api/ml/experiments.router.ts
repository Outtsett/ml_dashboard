import { Router } from "express";
import { pgDb } from "../infrastructure/database/pg_db";
import { experiments, trainingMetrics } from "@shared/pg_schema";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/experiments", async (req, res) => {
  try {
    const allExperiments = await pgDb.select().from(experiments);
    res.json(allExperiments);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get("/experiments/:id", async (req, res) => {
  try {
    const experiment = await pgDb
      .select()
      .from(experiments)
      .where(eq(experiments.experimentId, req.params.id))
      .limit(1);
    
    if (!experiment.length) {
      return res.status(404).json({ error: "Experiment not found" });
    }
    res.json(experiment[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get("/experiments/:id/metrics", async (req, res) => {
  try {
    const metrics = await pgDb
      .select()
      .from(trainingMetrics)
      .where(eq(trainingMetrics.experimentId, req.params.id))
      .orderBy(desc(trainingMetrics.timestamp))
      .limit(1000);
    
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

import { processManager } from "./processManager";

router.post("/experiments/launch", async (req, res) => {
  try {
    const config = req.body;
    
    // Create a unique job ID
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    await processManager.launchJob({
      jobId,
      model: config.model,
      dataset: config.dataset,
      features: config.features,
      hyperparameters: config.hyperparameters,
      validation: config.validation,
      isSweep: config.isSweep || false,
      instrument: config.instrument || "mnq",
      timeframe: config.timeframe || "1m",
      dataSize: config.dataSize ?? 0
    });
    
    res.json({ success: true, jobId });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post("/experiments/abort", async (req, res) => {
  try {
    processManager.abortAll();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
