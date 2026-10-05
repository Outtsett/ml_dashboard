// W7.d — SSE channel for live model deployment events.
//
//   GET /api/events/deployments
//     ?deployment_id=42      optional — filter to a single deployment
//     &after_id=<storedId>   optional — replay from EventStore before live tail
//
// Single channel, multiplexed by `deployment_id` in the event payload. The
// frontend filters by deployment_id; one connection serves the entire
// deployments page (10+ active deployments × 1-2 preds/sym/tf/sec ≈
// ~10 events/sec — well below per-channel-per-tab thresholds).
//
// Stream-id convention: `deployment-<deployment_id>` — one EventStore stream
// per deployment lets `?deployment_id=N&after_id=K` answer "what predictions
// did deployment N emit since event K?" with a single readStream() call.
//
// Replay headers:
//   - `Last-Event-ID` (standard EventSource header) supersedes `?after_id`
//   - Replayed events use the stored event id as the SSE `id:` field so
//     browsers auto-resume on reconnect via Last-Event-ID
//
// Compression must be skipped for `/events/` paths (see main.ts filter); a
// gzip-buffered SSE response never flushes per-event.

import { Router, type Request, type Response } from 'express';
import { db as sqliteDb } from '../infrastructure/database/sqlite';
import { EventStore } from '../infrastructure/events/event-store';
import { getEventBus } from '../infrastructure/events/event-bus';
import {
  deploymentStreamId,
} from './publisher';
import type { DomainEvent, StoredEvent } from '@shared/event-types';

const router = Router();

// ── Lazy singletons ────────────────────────────────────────
let storeInstance: EventStore | null = null;
function getStore(): EventStore {
  if (!storeInstance) {
    storeInstance = new EventStore(sqliteDb);
  }
  return storeInstance;
}

// ── Client tracking ────────────────────────────────────────
interface DeploymentSSEClient {
  res: Response;
  /** When set, only forward events whose data.deployment_id matches. */
  deploymentId: number | null;
  /** Cleanup function to detach this client's bus listener. */
  detach: () => void;
}

const clients = new Set<DeploymentSSEClient>();

// ── Keepalive (15s — well under most proxy idle timeouts) ──
const KEEPALIVE_MS = 15_000;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

function ensureKeepalive(): void {
  if (keepaliveTimer) return;
  keepaliveTimer = setInterval(() => {
    const ts = new Date().toISOString();
    // Both: SSE comment (proxy-friendly) AND a typed heartbeat event so the
    // frontend can drive UI "last seen N seconds ago" indicators.
    const comment = `: keepalive ${Date.now()}\n\n`;
    const heartbeat = `event: heartbeat\ndata: ${JSON.stringify({ ts })}\n\n`;
    for (const client of clients) {
      try {
        client.res.write(comment);
        client.res.write(heartbeat);
      } catch (err) {
        // Best-effort cleanup; the close handler will detach properly.
        console.warn('[sse:deployments] keepalive write failed:', (err as Error).message);
        client.detach();
        clients.delete(client);
      }
    }
    if (clients.size === 0) {
      clearInterval(keepaliveTimer!);
      keepaliveTimer = null;
    }
  }, KEEPALIVE_MS);
}

// ── Bus listener factory ───────────────────────────────────
function makeBusHandler(client: DeploymentSSEClient) {
  return (event: DomainEvent) => {
    if (!event.type.startsWith('deployment.')) return;
    const evtDeploymentId = (event.data as { deployment_id?: number }).deployment_id;
    if (
      client.deploymentId !== null &&
      evtDeploymentId !== client.deploymentId
    ) {
      return;
    }
    try {
      client.res.write(formatSSE(event));
    } catch (err) {
      console.warn('[sse:deployments] write failed:', (err as Error).message);
      client.detach();
      clients.delete(client);
    }
  };
}

/** Format a domain event as an SSE message (no `id:` — used for live tail). */
function formatSSE(event: DomainEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Format a stored (replayed) event with `id:` so browsers track resume cursor. */
function formatStoredSSE(stored: StoredEvent): string {
  const envelope = {
    type: stored.type,
    data: stored.data,
    metadata: stored.metadata,
  };
  return `id: ${stored.id}\nevent: ${stored.type}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

// ── Replay helpers ─────────────────────────────────────────
async function replayForClient(
  res: Response,
  deploymentId: number | null,
  afterId: number,
): Promise<number> {
  const store = getStore();
  let lastReplayedId = afterId;

  if (deploymentId !== null) {
    // Single-stream replay — fastest path.
    const events = await store.readStream(deploymentStreamId(deploymentId));
    for (const evt of events) {
      if (evt.id <= afterId) continue;
      try {
        res.write(formatStoredSSE(evt));
        lastReplayedId = evt.id;
      } catch (err) {
        console.warn('[sse:deployments] replay write failed:', (err as Error).message);
        return lastReplayedId;
      }
    }
  } else {
    // Cross-deployment replay — paginate by id from the events table.
    const events = await store.readAll(afterId);
    for (const evt of events) {
      if (!evt.type.startsWith('deployment.')) continue;
      try {
        res.write(formatStoredSSE(evt));
        lastReplayedId = evt.id;
      } catch (err) {
        console.warn('[sse:deployments] replay write failed:', (err as Error).message);
        return lastReplayedId;
      }
    }
  }
  return lastReplayedId;
}

function parseAfterId(req: Request): number {
  // `Last-Event-ID` (auto-set by EventSource on reconnect) supersedes query.
  const headerVal = req.headers['last-event-id'];
  if (typeof headerVal === 'string' && headerVal.length > 0) {
    const n = Number.parseInt(headerVal, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const queryVal = req.query.after_id;
  if (typeof queryVal === 'string' && queryVal.length > 0) {
    const n = Number.parseInt(queryVal, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return -1;
}

function parseDeploymentId(req: Request): number | null {
  const raw = req.query.deployment_id;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// ── GET /api/events/deployments/stats — connected client count ─
// Registered before the SSE GET so it doesn't get matched as a stream.
router.get('/events/deployments/stats', (_req: Request, res: Response) => {
  const byDeployment: Record<string, number> = {};
  let total = 0;
  for (const c of clients) {
    total += 1;
    const key = c.deploymentId === null ? 'all' : String(c.deploymentId);
    byDeployment[key] = (byDeployment[key] ?? 0) + 1;
  }
  res.json({ total, byDeployment });
});

// ── GET /api/events/deployments — SSE channel ──────────────────
router.get('/events/deployments', async (req: Request, res: Response) => {
  // SSE headers — must be flushed before any other write.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');     // disable nginx buffering
  res.flushHeaders();

  const deploymentId = parseDeploymentId(req);
  const afterId = parseAfterId(req);

  // Initial handshake — gives the frontend the active subscription params.
  res.write(`event: connected\ndata: ${JSON.stringify({
    channel: 'deployments',
    deployment_id: deploymentId,
    server_time: new Date().toISOString(),
  })}\n\n`);

  // Replay first, then attach live tail. Order matters: if we attached the bus
  // listener before replay, an in-flight live event whose id ≤ replay tail
  // could be duplicated. By replaying first and tracking lastReplayedId, the
  // bus handler picks up only events emitted after replay completes.
  let lastReplayed = afterId;
  if (afterId >= 0) {
    try {
      lastReplayed = await replayForClient(res, deploymentId, afterId);
      res.write(`event: replay.completed\ndata: ${JSON.stringify({
        last_event_id: lastReplayed,
      })}\n\n`);
    } catch (err) {
      console.error('[sse:deployments] replay failed:', err);
      res.write(`event: replay.failed\ndata: ${JSON.stringify({
        error: (err as Error).message,
      })}\n\n`);
    }
  }

  // Live tail.
  const bus = getEventBus();
  const client: DeploymentSSEClient = {
    res,
    deploymentId,
    detach: () => {
      bus.off('deployment.*', handler);
    },
  };
  const handler = makeBusHandler(client);
  bus.on('deployment.*', handler);
  clients.add(client);
  ensureKeepalive();

  // Cleanup on client disconnect.
  req.on('close', () => {
    client.detach();
    clients.delete(client);
  });
});

export default router;

/** Test/shutdown hook — closes all SSE connections. */
export function shutdownDeploymentsSSE(): void {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
  for (const c of clients) {
    c.detach();
    try { c.res.end(); } catch { /* already closed */ }
  }
  clients.clear();
  storeInstance = null;
}

/** Test introspection — current connected client count. */
export function deploymentsClientCount(): number {
  return clients.size;
}
