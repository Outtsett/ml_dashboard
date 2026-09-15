/**
 * Bar-stream control — start and stop the feed backing the chart.
 *
 *   GET  /api/market/replay/status
 *   POST /api/market/replay/start   { symbol, timeframe, mode?, ... }
 *   POST /api/market/replay/stop
 *
 * `mode` selects the source: `replay` walks stored history; `live` tails
 * `qt_bars_1m`, which QuantowerBridge wrote into QuestDB. That table was not
 * carried into the lake serving snapshot when QuestDB was retired
 * (2026-09-10), so `live` has no table to read. Default is `replay`, and a
 * live request is answered with that fact rather than a raw catalog error.
 *
 * One stream at a time, process-wide. Two concurrent streams would interleave
 * bars for different symbols onto one event channel, and the chart has no way
 * to tell them apart mid-stream.
 */

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { getEventBus } from '../../infrastructure/events/event-bus.js';
import { QuestDBReplaySource } from './questdbReplaySource.js';
import { QuestDBLiveSource, LIVE_BARS_TABLE } from './questdbLiveSource.js';
import type { BarSource, BarOrigin } from './barSource.js';

const router = Router();

let current: BarSource | null = null;
let currentLabel: string | null = null;

/** Matches the envelope every other emitter on this bus produces. */
function makeMetadata() {
  const id = crypto.randomUUID().slice(0, 12);
  return { correlationId: id, causationId: id, timestamp: Date.now() };
}

/**
 * Whether the live producer looks alive, judged by how recently it wrote.
 *
 * Reported rather than assumed: QuantowerBridge only writes while Quantower is
 * open, so "is there a live feed" is a runtime question with a changing answer.
 * A caller that assumed yes would show a frozen chart as a calm market.
 */
async function liveFeedHealth() {
  try {
    const { queryQuestDB } = await import(
      '../../infrastructure/database/questdb/connection.js'
    );
    const rows = await queryQuestDB<{ latest: string | null; n: number }>(
      // count() was QuestDB's spelling; DuckDB requires the argument.
      `SELECT max(timestamp) latest, count(*) n FROM ${LIVE_BARS_TABLE}`,
    );
    const latest = rows[0]?.latest ? Date.parse(rows[0].latest) : null;
    const ageSeconds = latest === null ? null : (Date.now() - latest) / 1000;

    // A timestamp in the FUTURE is a clock fault, not freshness. The first cut
    // of this check tested `ageSeconds < 300` and duly reported a feed running
    // fourteen hours ahead as healthy — negative is smaller than 300. Bars
    // cannot be written before they happen, so treat it as its own state.
    const clockSkewed = ageSeconds !== null && ageSeconds < -60;

    return {
      table: LIVE_BARS_TABLE,
      rows: rows[0]?.n ?? 0,
      latest: latest === null ? null : new Date(latest).toISOString(),
      ageSeconds,
      clockSkewed,
      clockSkewHours: clockSkewed ? Math.round((-ageSeconds / 3600) * 100) / 100 : null,
      // Bars land once a minute, so a few minutes of silence is normal; beyond
      // that Quantower is closed or the bridge is down.
      writing: ageSeconds !== null && ageSeconds >= -60 && ageSeconds < 300,
    };
  } catch (err) {
    return { table: LIVE_BARS_TABLE, writing: false, error: describeLiveFeedError(err) };
  }
}

/** A missing live table is a known state of this machine, not an internal error to echo. */
function describeLiveFeedError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/does not exist/i.test(message) && message.includes(LIVE_BARS_TABLE)) {
    return `${LIVE_BARS_TABLE} is not in the lake serving snapshot — live bar tailing ended with the QuestDB retirement on 2026-09-10.`;
  }
  console.warn('[replay] live feed probe failed:', message);
  return 'Live feed probe failed; see server log.';
}

router.get('/market/replay/status', async (_req: Request, res: Response) => {
  res.json({
    running: current?.running ?? false,
    source: currentLabel,
    description: current?.description ?? null,
    liveFeed: await liveFeedHealth(),
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

  const mode: BarOrigin = req.body?.mode === 'live' ? 'live' : 'replay';

  const source: BarSource =
    mode === 'live'
      ? new QuestDBLiveSource({
          symbol,
          timeframe,
          pollIntervalMs: Number(req.body?.pollIntervalMs ?? 2000),
        })
      : new QuestDBReplaySource({
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
          origin: mode,
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
    res.status(400).json({ error: mode === 'live' ? describeLiveFeedError(outcome) : outcome.message });
    return;
  }

  current = source;
  currentLabel = `${symbol} ${timeframe} (${mode})`;
  res.json({ running: true, mode, source: currentLabel, description: source.description });
});

router.post('/market/replay/stop', (_req: Request, res: Response) => {
  current?.stop();
  const stopped = currentLabel;
  current = null;
  currentLabel = null;
  res.json({ running: false, stopped });
});

export default router;
