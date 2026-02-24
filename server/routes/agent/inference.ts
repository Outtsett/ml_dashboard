/**
 * Trading Agent — Inference & Signal Routes
 *
 * Routes:
 *   POST /api/agent/predict         — single prediction (latest bar)
 *   POST /api/agent/predict/batch   — batch predictions over time range
 *   POST /api/agent/signals         — generate signals from batch predictions
 */

import { Router, Request, Response } from 'express';
import { mlRateLimiter } from '../../lib/rateLimiter';
import {
  predictLatest,
  predictBatch,
  type InferenceConfig,
  type BatchInferenceConfig,
} from '../../../ml/inference/inferenceService';
import {
  SignalGenerator,
} from '../../../ml/inference/signalGenerator';

const router = Router();

/**
 * POST /api/agent/predict
 * Single prediction on the latest available data.
 */
router.post('/agent/predict', mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const { modelName, symbol, timeframeSec, includeFeatures } = req.body;

    if (!modelName || !symbol) {
      return res.status(400).json({ error: 'modelName and symbol are required' });
    }

    const config: InferenceConfig = {
      modelName,
      symbol: symbol.toUpperCase(),
      timeframeSec,
      includeFeatures: includeFeatures ?? true,
    };

    const prediction = await predictLatest(config);
    res.json(prediction);
  } catch (error: any) {
    console.error('[Agent] Prediction error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/predict/batch
 * Batch predictions over a time range for backtesting or analysis.
 */
router.post('/agent/predict/batch', mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const {
      modelName,
      symbol,
      timeframeSec,
      startTimestamp,
      endTimestamp,
      maxBars,
      stepSize,
      includeFeatures,
    } = req.body;

    if (!modelName || !symbol) {
      return res.status(400).json({ error: 'modelName and symbol are required' });
    }

    const config: BatchInferenceConfig = {
      modelName,
      symbol: symbol.toUpperCase(),
      timeframeSec,
      startTimestamp,
      endTimestamp,
      maxBars: maxBars || 20000,
      stepSize: stepSize || 1,
      includeFeatures: includeFeatures ?? false,
    };

    const result = await predictBatch(config);
    res.json(result);
  } catch (error: any) {
    console.error('[Agent] Batch prediction error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/signals
 * Generate trade signals from batch predictions.
 */
router.post('/agent/signals', mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const {
      modelName,
      symbol,
      timeframeSec,
      maxBars,
      signalConfig,
      startTimestamp,
      endTimestamp,
    } = req.body;

    if (!modelName || !symbol) {
      return res.status(400).json({ error: 'modelName and symbol are required' });
    }

    // 1. Get batch predictions
    const batchResult = await predictBatch({
      modelName,
      symbol: symbol.toUpperCase(),
      timeframeSec,
      startTimestamp,
      endTimestamp,
      maxBars: maxBars || 20000,
      includeFeatures: true,
    });

    // 2. Generate signals
    const sg = new SignalGenerator(signalConfig);
    const signals = sg.processBatch(batchResult.predictions);
    const stats = sg.getStats(signals);

    res.json({
      signals: signals.filter(s => s.direction !== 'no_signal'),
      allSignals: signals.length,
      stats,
      modelName,
      symbol: symbol.toUpperCase(),
      timeRange: batchResult.timeRange,
      barsProcessed: batchResult.barsProcessed,
    });
  } catch (error: any) {
    console.error('[Agent] Signal generation error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
