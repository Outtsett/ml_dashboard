import { Router, type Request, type Response } from 'express';
import { getEventBus } from '../infrastructure/events/event-bus.js';
import { SSEAdapter, type SSEChannel } from '../infrastructure/events/sse-adapter.js';

const router = Router();

// ── Lazy singleton SSEAdapter ───────────────────────────────
let sseAdapter: SSEAdapter | null = null;

function getSSEAdapter(): SSEAdapter {
  if (!sseAdapter) {
    sseAdapter = new SSEAdapter(getEventBus());
  }
  return sseAdapter;
}

// ── Valid channels ──────────────────────────────────────────
const VALID_CHANNELS = new Set<SSEChannel>(['pipeline', 'training', 'system']);

// ── GET /api/events/stats — client counts ───────────────────
// MUST be registered BEFORE the :channel param route
router.get('/events/stats', (_req: Request, res: Response) => {
  const adapter = getSSEAdapter();
  const stats: Record<SSEChannel, number> = {
    pipeline: adapter.clientCount('pipeline'),
    training: adapter.clientCount('training'),
    system: adapter.clientCount('system'),
  };
  res.json(stats);
});

// ── GET /api/events/:channel — SSE stream ───────────────────
router.get('/events/:channel', (req: Request, res: Response) => {
  const channel = req.params.channel as SSEChannel;

  if (!VALID_CHANNELS.has(channel)) {
    res.status(400).json({ error: `Invalid channel: ${channel}` });
    return;
  }

  getSSEAdapter().addClient(channel, res);
});

export default router;

/** Gracefully shut down the SSE adapter (close all client connections). */
export function shutdownSSE(): void {
  if (sseAdapter) {
    sseAdapter.shutdown();
    sseAdapter = null;
  }
}
