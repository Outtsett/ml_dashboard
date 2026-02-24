/**
 * Trading Agent — Model Management & Strategy Configuration
 *
 * Routes:
 *   GET  /api/agent/models          — list available models for inference
 *   POST /api/agent/models/unload   — unload a cached model
 *   GET  /api/agent/strategy/config — get current strategy config
 *   PUT  /api/agent/strategy/config — update strategy config
 */

import { Router, Request, Response } from 'express';
import {
  listAvailableModels,
  unloadModel,
  unloadAllModels,
} from '../../../ml/inference/inferenceService';
import {
  signalGenerator,
  DEFAULT_SIGNAL_CONFIG,
} from '../../../ml/inference/signalGenerator';
import {
  strategyEngine,
  DEFAULT_STRATEGY_CONFIG,
} from '../../../ml/inference/strategyEngine';

const router = Router();

// ============================================================
// MODEL MANAGEMENT
// ============================================================

/** GET /api/agent/models — List models available for inference */
router.get('/agent/models', async (_req: Request, res: Response) => {
  try {
    const models = listAvailableModels();
    res.json({ models, count: models.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/agent/models/unload — Unload a cached model */
router.post('/agent/models/unload', async (req: Request, res: Response) => {
  try {
    const { modelName } = req.body;
    if (modelName === '*') {
      unloadAllModels();
      res.json({ message: 'All models unloaded' });
    } else if (modelName) {
      const success = unloadModel(modelName);
      res.json({ message: success ? `Model ${modelName} unloaded` : `Model ${modelName} not cached` });
    } else {
      res.status(400).json({ error: 'modelName required (or "*" to unload all)' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// STRATEGY CONFIGURATION
// ============================================================

/** GET /api/agent/strategy/config — Get current strategy config */
router.get('/agent/strategy/config', async (_req: Request, res: Response) => {
  res.json({
    signalConfig: DEFAULT_SIGNAL_CONFIG,
    strategyConfig: DEFAULT_STRATEGY_CONFIG,
    state: strategyEngine.getState(),
  });
});

/** PUT /api/agent/strategy/config — Update strategy config */
router.put('/agent/strategy/config', async (req: Request, res: Response) => {
  try {
    const { signalConfig, strategyConfig: stratCfg } = req.body;

    if (signalConfig) {
      signalGenerator.updateConfig(signalConfig);
    }
    if (stratCfg) {
      strategyEngine.updateConfig(stratCfg);
    }

    res.json({
      message: 'Strategy config updated',
      signalConfig: { ...DEFAULT_SIGNAL_CONFIG, ...signalConfig },
      strategyConfig: { ...DEFAULT_STRATEGY_CONFIG, ...stratCfg },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
