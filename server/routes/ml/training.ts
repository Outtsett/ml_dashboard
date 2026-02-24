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

// ============================================================
// ML TRAINING API (start/stop/status/stream)
// ============================================================

let trainerModule: any = null;

async function getTrainer() {
  if (!trainerModule) {
    trainerModule = await import('../../../ml/cnn/trainer');
  }
  return trainerModule.trainer;
}

router.post("/ml/train/start", async (req: Request, res: Response) => {
  try {
    const trainer = await getTrainer();
    if (trainer.isTraining()) {
      return res.status(400).json({ error: "Training already in progress" });
    }

    const {
      symbol = 'MNQ',
      epochs = 50,
      batchSize = 32,
      learningRate,
      dropout,
      sequenceLength,
      // Universal pipeline params
      pipeline = 'universal', // 'universal' or 'legacy'
      timeframeSec = 300,
      maxBars = 100000,
      labelType = 'direction',
      labelHorizon = 10,
      labelAtrMultiplier = 0.5,
      labelNumClasses = 3,
      takeProfitATR = 2.0,
      stopLossATR = 1.0,
      maxHoldingPeriod = 20,
    } = req.body;

    if (pipeline === 'universal') {
      // Build universal config
      const labelConfig = labelType === 'triple_barrier'
        ? { type: 'triple_barrier' as const, takeProfitATR, stopLossATR, maxHoldingPeriod }
        : { type: 'direction' as const, horizon: labelHorizon, atrMultiplier: labelAtrMultiplier, numClasses: labelNumClasses as 2 | 3 };

      const universalConfig = {
        symbol,
        timeframeSec,
        maxBars,
        sequenceLength: sequenceLength || 60,
        labels: labelConfig,
      };

      const cnnOverrides: any = {};
      if (learningRate) cnnOverrides.learningRate = learningRate;
      if (dropout) cnnOverrides.dropoutRate = dropout;

      const sessionId = await trainer.startUniversalTraining(
        symbol,
        epochs,
        batchSize,
        universalConfig,
        Object.keys(cnnOverrides).length > 0 ? cnnOverrides : undefined
      );

      res.json({
        sessionId,
        message: "Universal training started",
        pipeline: 'universal',
        labelType: labelConfig.type,
      });
    } else {
      // Legacy pipeline
      const cnnConfig = {
        ...(learningRate && { learningRate }),
        ...(dropout && { dropoutRate: dropout }),
        ...(sequenceLength && { sequenceLength }),
        numFeatures: 5, // Legacy uses 5 raw OHLCV features
      };

      const sessionId = await trainer.startTraining(
        symbol,
        epochs,
        batchSize,
        Object.keys(cnnConfig).length > 0 ? cnnConfig : undefined
      );

      res.json({
        sessionId,
        message: "Legacy training started",
        pipeline: 'legacy',
      });
    }
  } catch (error: any) {
    console.error("Error starting training:", error);
    res.status(500).json({ error: error.message || "Failed to start training" });
  }
});

router.post("/ml/train/stop", async (req: Request, res: Response) => {
  try {
    const trainer = await getTrainer();
    trainer.stopTraining();
    res.json({ message: "Training stop requested" });
  } catch (error: any) {
    console.error("Error stopping training:", error);
    res.status(500).json({ error: error.message || "Failed to stop training" });
  }
});

router.get("/ml/train/status", async (req: Request, res: Response) => {
  try {
    const trainer = await getTrainer();
    const session = trainer.getActiveSession();
    if (session) {
      res.json({
        isTraining: true,
        sessionId: session.id,
        symbol: session.symbol,
        status: session.status,
        progress: session.progress,
      });
    } else {
      res.json({ isTraining: false });
    }
  } catch (error: any) {
    console.error("Error getting training status:", error);
    res.status(500).json({ error: error.message || "Failed to get training status" });
  }
});

router.get("/ml/train/stream", async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const trainer = await getTrainer();

    const onProgress = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    trainer.on('progress', onProgress);

    req.on('close', () => {
      trainer.off('progress', onProgress);
    });

    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  } catch (error: any) {
    console.error("Error in training stream:", error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
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

// List saved models on disk
router.get("/ml/saved-models", async (req: Request, res: Response) => {
  try {
    const trainer = await getTrainer();
    const models = trainer.listSavedModels();
    res.json({ models });
  } catch (error: any) {
    console.error("Error listing saved models:", error);
    res.status(500).json({ error: error.message || "Failed to list saved models" });
  }
});

// Get universal pipeline feature names
router.get("/ml/universal/features", async (_req: Request, res: Response) => {
  try {
    const { getFeatureNames, DEFAULT_FEATURE_CONFIG } = await import('../../../ml/cnn/universalPipeline');
    const featureNames = getFeatureNames(DEFAULT_FEATURE_CONFIG);
    res.json({
      count: featureNames.length,
      features: featureNames,
      categories: {
        returns: featureNames.filter(f => f.startsWith('log_ret') || f === 'intrabar_ret'),
        candle: featureNames.filter(f => ['bar_range_pct', 'upper_shadow_pct', 'lower_shadow_pct', 'body_pct'].includes(f)),
        momentum: featureNames.filter(f => f.startsWith('rsi_') || f.startsWith('stoch_') || f === 'williams_r' || f.startsWith('roc_')),
        trend: featureNames.filter(f => f.startsWith('bb_') || f === 'macd_hist_norm' || f.startsWith('close_vs_sma')),
        volatility: featureNames.filter(f => f === 'vol_ratio' || f === 'realized_vol'),
        volume: featureNames.filter(f => f === 'rel_volume' || f === 'vol_trend'),
        time: featureNames.filter(f => f.endsWith('_sin') || f.endsWith('_cos')),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get last trained model info (from in-memory session or database)
router.get("/ml/train/last", async (req: Request, res: Response) => {
  try {
    const trainer = await getTrainer();
    const symbol = getString(req.query.symbol as string);

    // First check in-memory sessions
    const session = trainer.getLastTrainedModel(symbol || undefined);
    if (session) {
      res.json({
        id: session.id,
        symbol: session.symbol,
        status: session.status,
        savedModelId: session.savedModelId,
        modelPath: session.modelPath,
        featureNames: session.featureNames,
        config: session.config,
        universalConfig: session.universalConfig,
        progress: session.progress,
        startTime: session.startTime,
        source: 'memory',
      });
      return;
    }

    // Fall back to database
    const models = await storage.getMlModels('active');
    const dbModel = symbol
      ? models.find((m: any) => m.name?.includes(symbol))
      : models[0];

    if (dbModel) {
      // Parse metrics from database (handle double-encoded JSON)
      let metrics: any = {};
      try {
        let metricsStr = dbModel.metrics || '{}';
        // Handle double-encoded JSON strings
        if (metricsStr.startsWith('"')) {
          metricsStr = JSON.parse(metricsStr);
        }
        metrics = typeof metricsStr === 'string' ? JSON.parse(metricsStr) : metricsStr;
      } catch (e) {
        console.log('Failed to parse metrics:', e);
      }

      // Parse hyperparameters (handle double-encoded JSON)
      let config: any = {};
      try {
        let configStr = dbModel.hyperparameters || '{}';
        if (configStr.startsWith('"')) {
          configStr = JSON.parse(configStr);
        }
        config = typeof configStr === 'string' ? JSON.parse(configStr) : configStr;
      } catch (e) {
        console.log('Failed to parse hyperparameters:', e);
      }

      res.json({
        id: `db_${dbModel.id}`,
        symbol: dbModel.name?.replace('CNN-', '') || symbol,
        status: 'completed',
        savedModelId: dbModel.id,
        config,
        progress: metrics.finalAccuracy ? [{
          epoch: metrics.epochs || 1,
          totalEpochs: metrics.epochs || 1,
          loss: metrics.finalLoss || 0,
          valLoss: metrics.finalValLoss || 0,
          accuracy: metrics.finalAccuracy || 0,
          valAccuracy: metrics.finalAccuracy || 0,
          learningRate: 0.001,
          batchSize: 32,
          status: 'completed',
        }] : [],
        startTime: new Date(dbModel.createdAt).getTime(),
        source: 'database',
        runtimeModelAvailable: false,
      });
      return;
    }

    res.json(null);
  } catch (error: any) {
    console.error("Error getting last trained model:", error);
    res.status(500).json({ error: error.message || "Failed to get last trained model" });
  }
});

// Generate predictions with trained model
router.post("/ml/predict", async (req: Request, res: Response) => {
  try {
    const trainer = await getTrainer();
    const { symbol, data, modelName } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: "Missing symbol" });
    }

    // Try in-memory trainer first (fast path, works during active training sessions)
    if (data) {
      try {
        const predictions = await trainer.predict(symbol, data);
        return res.json(predictions);
      } catch (_predError: any) {
        // Fall through to inference service
      }
    }

    // Fall through to inference service for saved models
    try {
      const { predictLatest } = await import('../../../ml/inference/inferenceService');
      const resolvedModel = modelName || symbol;
      const prediction = await predictLatest({
        modelName: resolvedModel,
        symbol: symbol.toUpperCase(),
        includeFeatures: true,
      });
      return res.json(prediction);
    } catch (infError: any) {
      // Check if there's a model in the database
      const models = await storage.getMlModels('active');
      const dbModel = models.find((m: any) => m.name?.includes(symbol));

      if (dbModel) {
        return res.status(503).json({
          error: "Model exists in database but could not be loaded for inference. Check model files in data/models/.",
          modelId: dbModel.id,
          modelName: dbModel.name,
          inferenceError: infError.message,
        });
      }
      throw infError;
    }
  } catch (error: any) {
    console.error("Error generating predictions:", error);
    res.status(500).json({ error: error.message || "Failed to generate predictions" });
  }
});

export default router;
