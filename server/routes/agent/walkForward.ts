/**
 * Trading Agent — Walk-Forward Validation Routes
 *
 * Routes:
 *   POST /api/agent/walk-forward       — run walk-forward validation (async)
 *   POST /api/agent/walk-forward/stop  — stop walk-forward
 *   GET  /api/agent/walk-forward/stream — SSE for walk-forward progress
 */

import { Router, Request, Response } from 'express';
import { mlRateLimiter } from '../../lib/rateLimiter';
import {
  walkForwardValidator,
  type WalkForwardConfig,
} from '../../../ml/inference/walkForward';

const router = Router();

/**
 * POST /api/agent/walk-forward
 * Run walk-forward validation (async with SSE progress).
 */
router.post('/agent/walk-forward', mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const {
      symbol,
      mode = 'anchored',
      numFolds = 5,
      testSize = 0.1,
      gapBars = 0,
      epochsPerFold = 15,
      batchSize = 32,
      universalConfig,
      cnnConfig,
    } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: 'symbol is required' });
    }

    const config: WalkForwardConfig = {
      symbol: symbol.toUpperCase(),
      mode,
      numFolds,
      testSize,
      gapBars,
      epochsPerFold,
      batchSize,
      universalConfig,
      cnnConfig,
    };

    // Run asynchronously — client gets progress via SSE
    const resultPromise = walkForwardValidator.run(config);

    // Return immediately with confirmation
    res.json({
      status: 'started',
      message: `Walk-forward validation started: ${numFolds} folds, ${mode} mode`,
      config,
    });

    // The result will be available via SSE stream
    resultPromise.catch(err => {
      console.error('[WalkForward] Error:', err.message);
    });
  } catch (error: any) {
    console.error('[Agent] Walk-forward error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/agent/walk-forward/stop — Stop walk-forward validation */
router.post('/agent/walk-forward/stop', async (_req: Request, res: Response) => {
  walkForwardValidator.stop();
  res.json({ message: 'Walk-forward stop requested' });
});

/** GET /api/agent/walk-forward/stream — SSE for walk-forward progress */
router.get('/agent/walk-forward/stream', async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const onStatus = (data: any) => {
    res.write(`event: status\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onFoldStart = (data: any) => {
    res.write(`event: fold-start\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onFoldProgress = (data: any) => {
    res.write(`event: fold-progress\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onFoldComplete = (data: any) => {
    res.write(`event: fold-complete\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onComplete = (data: any) => {
    const summary = {
      ...data,
      folds: data.folds?.map((f: any) => ({
        ...f,
        predictions: f.predictions?.length || 0,
      })),
    };
    res.write(`event: complete\ndata: ${JSON.stringify(summary)}\n\n`);
    cleanup();
    res.end();
  };

  function cleanup() {
    walkForwardValidator.off('status', onStatus);
    walkForwardValidator.off('fold-start', onFoldStart);
    walkForwardValidator.off('fold-progress', onFoldProgress);
    walkForwardValidator.off('fold-complete', onFoldComplete);
    walkForwardValidator.off('complete', onComplete);
  }

  walkForwardValidator.on('status', onStatus);
  walkForwardValidator.on('fold-start', onFoldStart);
  walkForwardValidator.on('fold-progress', onFoldProgress);
  walkForwardValidator.on('fold-complete', onFoldComplete);
  walkForwardValidator.on('complete', onComplete);

  // Send connection confirmation
  res.write(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);

  _req.on('close', cleanup);
});

export default router;
