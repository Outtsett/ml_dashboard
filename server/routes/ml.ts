import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { mlRateLimiter } from "../lib/rateLimiter";
import { getString } from "./helpers";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const router = Router();

// ============================================================
// ML FEATURE GENERATION
// ============================================================

// Generate ML features from parquet data
router.post("/ml/features/:symbol/generate", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol).toUpperCase();
    const timeframe = req.body?.timeframe || "1m";
    const config = req.body?.config || {};

    const { generateMLFeatures } = await import("../duckdb");

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

    const { getMLFeaturesPreview } = await import("../duckdb");
    const data = await getMLFeaturesPreview(symbol, timeframe, limit);

    res.json({ symbol, timeframe, rowCount: data.length, data });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get ML features" });
  }
});

// List available parquet files
router.get("/ml/parquet-files", async (req: Request, res: Response) => {
  try {
    const { getAvailableParquetFiles } = await import("../duckdb");
    const files = await getAvailableParquetFiles();
    res.json({ files });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to list parquet files" });
  }
});

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
// ML TRAINING API
// ============================================================

let trainerModule: any = null;

async function getTrainer() {
  if (!trainerModule) {
    trainerModule = await import('../ml/trainer');
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
    const { getFeatureNames, DEFAULT_FEATURE_CONFIG } = await import('../ml/universalPipeline');
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
        startTime: new Date(dbModel.created_at).getTime(),
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
      const { predictLatest } = await import('../ml/inferenceService');
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

// ============================================================
// LABEL GENERATION API
// ============================================================

let labelServiceModule: any = null;

async function getLabelService() {
  if (!labelServiceModule) {
    labelServiceModule = await import('../lib/labels/labelService');
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

// Get available label generators
router.get("/labels/generators", async (_req: Request, res: Response) => {
  try {
    const { LABEL_GENERATORS } = await import('@shared/mlTaxonomy');
    res.json(LABEL_GENERATORS);
  } catch (error) {
    console.error("Error fetching generators:", error);
    res.status(500).json({ error: "Failed to fetch generators" });
  }
});

// ============================================================
// EXPLAINABLE AI (XAI) API ENDPOINTS
// ============================================================

let xaiServiceModule: any = null;

async function getXAIService() {
  if (!xaiServiceModule) {
    xaiServiceModule = await import('../lib/xai/xaiService');
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
        const { checkQuestDBHealth, getOHLCVSampleBy } = await import("../questdb");
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

// ============================================================
// PRE-TRAINED MODEL FORECASTING (Chronos)
// ============================================================

const FORECASTS_DIR = path.join(process.cwd(), "data", "forecasts");
const PYTHON_EXE = path.join(process.cwd(), ".venv", "Scripts", "python.exe");
const FORECAST_SCRIPT = path.join(process.cwd(), "scripts", "pretrained-forecast.py");

/** GET /api/ml/forecasts — list all saved forecast files */
router.get("/ml/forecasts", async (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(FORECASTS_DIR)) {
      return res.json([]);
    }
    const files = fs.readdirSync(FORECASTS_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        const filePath = path.join(FORECASTS_DIR, f);
        const stat = fs.statSync(filePath);
        // Read just the metadata from each forecast
        try {
          const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          return {
            filename: f,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            metadata: raw.metadata,
            metrics: raw.metrics,
          };
        } catch {
          return { filename: f, size: stat.size, modified: stat.mtime.toISOString() };
        }
      });
    res.json(files);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /api/ml/forecasts/:filename — get a specific forecast result */
router.get("/ml/forecasts/:filename", async (req: Request, res: Response) => {
  try {
    const filename = getString(req.params.filename);
    if (!filename || !filename.endsWith(".json")) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    // Prevent path traversal
    const safeName = path.basename(filename);
    const filePath = path.join(FORECASTS_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Forecast not found" });
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/ml/forecast — run a new Chronos forecast */
router.post("/ml/forecast", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const { symbol, timeframe = 3600, context = 500, horizon = 24, modelSize = "small", samples = 20 } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: "symbol is required" });
    }

    const validSizes = ["tiny", "mini", "small", "base", "large"];
    if (!validSizes.includes(modelSize)) {
      return res.status(400).json({ error: `modelSize must be one of: ${validSizes.join(", ")}` });
    }

    // Validate numeric params
    const ctx = Math.min(Math.max(50, Number(context)), 2000);
    const hz = Math.min(Math.max(5, Number(horizon)), 100);
    const smp = Math.min(Math.max(5, Number(samples)), 100);
    const tf = Number(timeframe);

    console.log(`[forecast] Starting Chronos ${modelSize} forecast: ${symbol} @ ${tf}s, ctx=${ctx}, hz=${hz}`);

    // Run the Python script as a child process
    const args = [
      FORECAST_SCRIPT,
      "--symbol", symbol,
      "--timeframe", String(tf),
      "--context", String(ctx),
      "--horizon", String(hz),
      "--model-size", modelSize,
      "--samples", String(smp),
    ];

    const child = spawn(PYTHON_EXE, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    const exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 1));
    });

    if (exitCode !== 0) {
      console.error(`[forecast] Script failed (exit ${exitCode}):`, stderr || stdout);
      return res.status(500).json({
        error: "Forecast script failed",
        details: (stderr || stdout).slice(-1000),
      });
    }

    // Read the output file
    const tfLabels: Record<number, string> = { 60: "1m", 300: "5m", 900: "15m", 1800: "30m", 3600: "1h", 14400: "4h", 86400: "1d" };
    const tfLabel = tfLabels[tf] || `${tf}s`;
    const outFile = path.join(FORECASTS_DIR, `chronos_${symbol}_${tfLabel}_${modelSize}.json`);

    if (!fs.existsSync(outFile)) {
      return res.status(500).json({ error: "Forecast completed but output file not found" });
    }

    const result = JSON.parse(fs.readFileSync(outFile, "utf-8"));
    console.log(`[forecast] Done: MAE=${result.metrics?.mae}, Dir=${result.metrics?.direction_accuracy}%`);
    res.json(result);
  } catch (error: any) {
    console.error("[forecast] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
