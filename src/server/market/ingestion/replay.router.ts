/**
 * Replay control — start and stop the stored-bar feed.
 *
 *   GET  /api/market/replay/status
 *   POST /api/market/replay/start   { symbol, timeframe, framesPerBar?, frameIntervalMs?, maxBars? }
 *   POST /api/market/replay/stop
 *
 * One replay at a time, process-wide. Two concurrent replays would interleave
 * bars for different symbols onto one event channel, and the chart has no way
 * to tell them apart mid-stream.
 */

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { getEventBus } from '../../infrastructure/events/event-bus.js';
import { QuestDBReplaySource } from './questdbReplaySource.js';
import { UnconfiguredLiveSource, type BarSource } from './barSource.js';

const router = Router();

let current: BarSource | null = null;
let currentLabel: string | null = null;

/** The live feed that does not exist yet — surfaced so /status can say so. */
const liveSource = new UnconfiguredLiveSource();

/** Matches the envelope every other emitter on this bus produces. */
function makeMetadata() {
  const id = crypto.randomUUID().slice(0, 12);
  return { correlationId: id, causationId: id, timestamp: Date.now() };
}

router.get('/market/replay/status', (_req: Request, res: Response) => {
  res.json({
    running: current?.running ?? false,
    source: currentLabel,
    description: current?.description ?? null,
    liveFeedAvailable: false,
    liveFeedReason: liveSource.description,
  });
});

router.post('/market/replay/start', async (req: Request, res: Response) => {
  if (current?.running) {
    res.status(409).json({ error: 'A replay is already running.', source: currentLabel });
    return;
  }

  const symbol = String(req.body?.symbol ?? '').trim();
  const timeframe = String(req.body?.timeframe ?? '1m').trim();
  if (!symbol) {
    res.status(400).json({ error: 'symbol is required' });
    return;
  }

  const source = new QuestDBReplaySource({
    symbol,
    timeframe,
    framesPerBar: Number(req.body?.framesPerBar ?? 4),
    frameIntervalMs: Number(req.body?.frameIntervalMs ?? 250),
    maxBars: Number(req.body?.maxBars ?? 500),
  });

  const bus = getEventBus();

  // Resolve the request before the replay finishes — it runs for as long as
  // the caller asked for, and holding the HTTP response open for it would time
  // out. Errors after this point surface on /status, not to this caller.
  const started = source
    .start((frame) => {
      bus.emit({
        type: 'market.bar',
        data: {
          symbol: frame.symbol,
          timeframe,
          timestamp: frame.timestamp,
          open: frame.open,
          high: frame.high,
          low: frame.low,
          close: frame.close,
          volume: frame.volume,
          progress: frame.progress,
          isClosed: frame.isClosed,
          origin: 'replay',
        },
        metadata: makeMetadata(),
      });
    })
    .catch((err: unknown) => {
      current = null;
      currentLabel = null;
      throw err;
    });

  // Give the source a moment to fail fast on a bad symbol or missing table, so
  // the caller learns about it here rather than by polling status.
  const outcome = await Promise.race([
    started.then(() => 'finished' as const).catch((e: Error) => e),
    new Promise<'pending'>((r) => setTimeout(() => r('pending'), 400)),
  ]);

  if (outcome instanceof Error) {
    res.status(400).json({ error: outcome.message });
    return;
  }

  current = source;
  currentLabel = `${symbol} ${timeframe}`;
  res.json({ running: true, source: currentLabel, description: source.description });
});

router.post('/market/replay/stop', (_req: Request, res: Response) => {
  current?.stop();
  const stopped = currentLabel;
  current = null;
  currentLabel = null;
  res.json({ running: false, stopped });
});

export default router;
