// W8.d — SSE channel for live Claude Agent SDK run streaming.
//
//   GET /api/events/agents/:runId
//
// Per-run channel (one SSE connection per agent invocation). Unlike
// `/api/events/deployments` which multiplexes all deployments on a single
// stream, agent runs are short-lived (seconds → minutes), bursty
// (token-by-token), and the frontend opens one stream per modal/panel — so a
// dedicated channel keyed on `runId` is the right granularity.
//
// Wire format (see backend integration plan 2026-05-09 §8):
//
//   event: connected         data: { run_id, agent_id?, status, server_time }
//   event: agent.replay      data: { event, replay_index }       (per buffered event)
//   event: replay.completed  data: { replayed: <count>, last_event_id? }
//   event: agent.token_chunk data: { run_id, chunk: string, index: number }
//   event: agent.tool_call   data: { run_id, tool: string, args, call_id }
//   event: agent.completed   data: { run_id, output, duration_ms, token_usage }
//   event: agent.failed      data: { run_id, error, code? }
//   event: heartbeat         data: { ts }                        (every 15s)
//
// Reconnect protocol:
//   - Browser EventSource auto-sends `Last-Event-ID` after a drop.
//   - Replay walks the per-run ring buffer (W8.c) skipping ids ≤ Last-Event-ID.
//   - After replay → `replay.completed` → live tail attaches.
//   - Order matters: replay BEFORE bus subscription, otherwise live events
//     emitted between replay-end and subscription-start would be lost.
//
// Compression: `/events/` is excluded by the global compression filter in
// `main.ts` (W7.c fix). Verified — gzip-buffered SSE breaks per-event flush.
//
// Cleanup: ABORTS on `req.on('close')`. The bus listener is detached, the
// keepalive is dropped from the per-run client set, and (if this was the last
// listener for the runId) the upstream dispatcher subscription can be GC'd.

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../infrastructure/database/db';
import { getEventBus, type EventHandler } from '../infrastructure/events/event-bus';
import type { DomainEvent } from '@shared/event-types';

const router = Router();

// ── Param validation ────────────────────────────────────────
// runIds are server-generated UUIDs (W8.c will use crypto.randomUUID()), but
// stay permissive on shape — accept any non-empty short token to keep the
// route forward-compatible if the id format changes.
const RunIdParam = z.object({
  runId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_\-]+$/, {
    message: 'runId must be alphanumeric (with _ or -)',
  }),
});

// ── Replay buffer contract (provided by W8.c agentDispatcher) ──
// Defined here as the public contract so this route compiles even before W8.c
// lands. The dispatcher MUST export both functions from
// `../lib/agentDispatcher` with these signatures.
//
// Buffered event shape: the dispatcher pushes typed envelopes into a per-run
// ring buffer (default cap ~500 entries). Each envelope carries a monotonic
// `id` so reconnect-replay can resume past `Last-Event-ID`.
interface BufferedAgentEvent {
  id: number;                                // monotonic, per-run
  type: string;                              // e.g. 'agent.token_chunk'
  data: Record<string, unknown>;             // payload (run_id always present)
  ts: number;                                // epoch ms
}

interface AgentRunRow {
  runId: string;
  agentId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  output?: string | null;
  error?: string | null;
  completedAt?: string | null;
}

interface AgentDispatcherModule {
  getReplayBuffer(runId: string): BufferedAgentEvent[];
  getAgentRun?(runId: string): AgentRunRow | null;
}

// Lazy load — W8.c may land after this file. If the module is missing, the
// route returns 503 (instead of failing tsc/dev-server boot). When the module
// is available, the cached reference is reused.
let dispatcherModule: AgentDispatcherModule | null = null;
let dispatcherLoadAttempted = false;

async function loadDispatcher(): Promise<AgentDispatcherModule | null> {
  if (dispatcherModule) return dispatcherModule;
  if (dispatcherLoadAttempted) return dispatcherModule;
  dispatcherLoadAttempted = true;
  try {
    // W8.c has landed. The module lives at infrastructure/lib/ after the
    // domain-driven-flat reorg — the old '../lib/agentDispatcher' path
    // resolved to apps/api/lib/, which does not exist, and a @ts-ignore was
    // hiding the module-not-found so this route silently served 503 forever.
    const mod = (await import('../infrastructure/lib/agentDispatcher')) as unknown as AgentDispatcherModule;
    if (typeof mod.getReplayBuffer !== 'function') {
      console.warn('[sse:agents] agentDispatcher missing getReplayBuffer export');
      return null;
    }
    dispatcherModule = mod;
    return dispatcherModule;
  } catch (err) {
    console.warn('[sse:agents] agentDispatcher unavailable:', (err as Error).message);
    return null;
  }
}

// ── DB row lookup (graceful when agent_runs table doesn't exist) ──
// W8.b owns the migrations/0003_agent_runs.sql. This helper survives the
// pre-migration window by catching the SQLITE_ERROR for a missing table.
function lookupAgentRun(runId: string): AgentRunRow | null {
  // Prefer dispatcher-supplied lookup if present (avoids cross-domain SQL).
  if (dispatcherModule?.getAgentRun) {
    try {
      return dispatcherModule.getAgentRun(runId);
    } catch (err) {
      console.warn('[sse:agents] dispatcher.getAgentRun failed:', (err as Error).message);
    }
  }
  try {
    const sqliteDb = (db as unknown as { $client?: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } } }).$client;
    if (!sqliteDb) return null;
    const row = sqliteDb
      .prepare(
        'SELECT run_id as runId, agent_id as agentId, status, output, error, completed_at as completedAt FROM agent_runs WHERE run_id = ?',
      )
      .get(runId) as AgentRunRow | undefined;
    return row ?? null;
  } catch (err) {
    // Table doesn't exist yet — treat as "no row" so the route returns 404.
    const msg = (err as Error).message;
    if (msg.includes('no such table')) return null;
    console.warn('[sse:agents] agent_runs lookup failed:', msg);
    return null;
  }
}

// ── Per-run client tracking ─────────────────────────────────
interface AgentSSEClient {
  runId: string;
  res: Response;
  /** Last event id forwarded — used to skip duplicates after replay. */
  lastEventId: number;
  /** Cleanup callback — detaches bus listener. */
  detach: () => void;
}

// Map<runId, Set<client>> — multiple frontend tabs can subscribe to the same
// runId; each gets its own response stream and its own bus listener.
const clientsByRun = new Map<string, Set<AgentSSEClient>>();

function addClient(client: AgentSSEClient): void {
  let set = clientsByRun.get(client.runId);
  if (!set) {
    set = new Set();
    clientsByRun.set(client.runId, set);
  }
  set.add(client);
}

function removeClient(client: AgentSSEClient): void {
  const set = clientsByRun.get(client.runId);
  if (!set) return;
  set.delete(client);
  if (set.size === 0) {
    clientsByRun.delete(client.runId);
  }
}

// ── Keepalive (15s — under most proxy idle timeouts) ────────
const KEEPALIVE_MS = 15_000;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

function totalClients(): number {
  let n = 0;
  for (const set of clientsByRun.values()) n += set.size;
  return n;
}

function ensureKeepalive(): void {
  if (keepaliveTimer) return;
  keepaliveTimer = setInterval(() => {
    const ts = new Date().toISOString();
    const comment = `: keepalive ${Date.now()}\n\n`;
    const heartbeat = `event: heartbeat\ndata: ${JSON.stringify({ ts })}\n\n`;
    for (const set of clientsByRun.values()) {
      for (const client of set) {
        try {
          client.res.write(comment);
          client.res.write(heartbeat);
        } catch (err) {
          console.warn('[sse:agents] keepalive write failed:', (err as Error).message);
          client.detach();
          removeClient(client);
        }
      }
    }
    if (totalClients() === 0) {
      clearInterval(keepaliveTimer!);
      keepaliveTimer = null;
    }
  }, KEEPALIVE_MS);
}

// ── Bus listener factory ────────────────────────────────────
// Channel pattern: `agent.<runId>.*` — W8.c agentDispatcher worker MUST emit
// events on this namespace (e.g. `agent.<runId>.token_chunk`,
// `agent.<runId>.tool_call`, `agent.<runId>.completed`, `agent.<runId>.failed`).
// We translate the wire `type` back to `agent.<event_kind>` on emit so the
// frontend sees `event: agent.token_chunk` (not the namespaced internal name).
function makeBusHandler(client: AgentSSEClient): EventHandler {
  return (event: DomainEvent) => {
    // Defensive: only forward events that match this run's channel and carry
    // a `run_id` field equal to ours. EventEmitter2 wildcard already filters
    // by the registered pattern, but the second check guards against
    // accidental cross-run leaks if the dispatcher mis-namespaces an emit.
    const data = event.data as { run_id?: string; id?: number };
    if (data.run_id !== undefined && data.run_id !== client.runId) return;

    const eventId = typeof data.id === 'number' ? data.id : -1;
    if (eventId >= 0 && eventId <= client.lastEventId) return;

    // Strip the `agent.<runId>.` namespace prefix if present for wire format.
    const wireType = event.type.startsWith(`agent.${client.runId}.`)
      ? `agent.${event.type.slice(`agent.${client.runId}.`.length)}`
      : event.type;

    const payload = formatLiveSSE(wireType, event, eventId >= 0 ? eventId : null);
    try {
      client.res.write(payload);
      if (eventId >= 0) client.lastEventId = eventId;
    } catch (err) {
      console.warn('[sse:agents] live write failed:', (err as Error).message);
      client.detach();
      removeClient(client);
    }
  };
}

function formatLiveSSE(wireType: string, event: DomainEvent, id: number | null): string {
  const idLine = id !== null ? `id: ${id}\n` : '';
  return `${idLine}event: ${wireType}\ndata: ${JSON.stringify(event)}\n\n`;
}

function formatBufferedSSE(buffered: BufferedAgentEvent, runId: string): string {
  // Replay payload mirrors live shape so frontend handlers stay uniform.
  // The wrapping `agent.replay` event carries the original event nested inside
  // `data.event` so the frontend's reducer can update without ambiguity.
  const wireType = buffered.type.startsWith(`agent.${runId}.`)
    ? `agent.${buffered.type.slice(`agent.${runId}.`.length)}`
    : buffered.type;
  const envelope = {
    type: wireType,
    data: buffered.data,
    metadata: { timestamp: buffered.ts, correlationId: runId, causationId: runId },
  };
  return `id: ${buffered.id}\nevent: agent.replay\ndata: ${JSON.stringify({
    event: envelope,
    replay_index: buffered.id,
  })}\n\n`;
}

// ── Last-Event-ID parsing (with optional ?after_id= fallback) ──
function parseLastEventId(req: Request): number {
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

// ── Diagnostics endpoint — connected-client snapshot ────────
// Registered before the SSE GET so it doesn't get matched as a stream.
router.get('/events/agents/_stats', (_req: Request, res: Response) => {
  const byRun: Record<string, number> = {};
  let total = 0;
  for (const [runId, set] of clientsByRun) {
    byRun[runId] = set.size;
    total += set.size;
  }
  res.json({ total, byRun });
});

// ── GET /api/events/agents/:runId — SSE channel ─────────────
router.get('/events/agents/:runId', async (req: Request, res: Response) => {
  // 1. Validate param.
  const parsed = RunIdParam.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid runId',
      details: parsed.error.flatten(),
    });
    return;
  }
  const runId = parsed.data.runId;

  // 2. Ensure the run exists. If neither the dispatcher nor the DB knows about
  //    this run, return 404 (per spec). This protects against stale URLs from
  //    closed browser tabs or after server restart wiped in-memory state.
  const dispatcher = await loadDispatcher();
  const row = lookupAgentRun(runId);
  const buffer = dispatcher?.getReplayBuffer(runId) ?? [];

  // If the dispatcher is unavailable AND no DB row exists, this run truly
  // doesn't exist. If the dispatcher exists but the buffer is empty AND no
  // row exists, same result.
  if (!row && buffer.length === 0) {
    if (!dispatcher) {
      res.status(503).json({
        error: 'Agent dispatcher unavailable',
        runId,
        hint: 'W8.c agentDispatcher module not yet loaded',
      });
      return;
    }
    res.status(404).json({ error: 'Agent run not found', runId });
    return;
  }

  // 3. SSE headers — must flush before any other write.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');     // disable nginx buffering
  res.flushHeaders();

  const lastEventId = parseLastEventId(req);

  // 4. Initial handshake — frontend uses this to confirm subscription params.
  res.write(`event: connected\ndata: ${JSON.stringify({
    run_id: runId,
    agent_id: row?.agentId ?? null,
    status: row?.status ?? 'unknown',
    server_time: new Date().toISOString(),
  })}\n\n`);

  // 5. Replay from ring buffer (if any). Skip events the client already saw.
  let lastReplayedId = lastEventId;
  let replayed = 0;
  for (const evt of buffer) {
    if (evt.id <= lastEventId) continue;
    try {
      res.write(formatBufferedSSE(evt, runId));
      lastReplayedId = evt.id;
      replayed += 1;
    } catch (err) {
      console.warn('[sse:agents] replay write failed:', (err as Error).message);
      try { res.end(); } catch { /* ignore */ }
      return;
    }
  }
  res.write(`event: replay.completed\ndata: ${JSON.stringify({
    replayed,
    last_event_id: lastReplayedId,
  })}\n\n`);

  // 6. Terminal-state shortcut. If the run is already finished AND replay
  //    just delivered its terminal event, the SSE adapter could close
  //    immediately — but EventSource expects open streams to stay open. We
  //    leave the connection open so the frontend can drive its own close.

  // 7. Live tail. Subscribe AFTER replay so we don't double-deliver events
  //    emitted while replay was paginating.
  const bus = getEventBus();
  const channelPattern = `agent.${runId}.*`;
  const client: AgentSSEClient = {
    runId,
    res,
    lastEventId: lastReplayedId,
    detach: () => {
      bus.off(channelPattern, handler);
    },
  };
  const handler = makeBusHandler(client);
  bus.on(channelPattern, handler);
  addClient(client);
  ensureKeepalive();

  // 8. Cleanup on disconnect — ABORTS the bus listener and drops client state.
  req.on('close', () => {
    client.detach();
    removeClient(client);
  });
});

export default router;

// ── Test / shutdown hooks ───────────────────────────────────
/** Closes all SSE connections; called from main.ts graceful shutdown. */
export function shutdownAgentsSSE(): void {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
  for (const set of clientsByRun.values()) {
    for (const c of set) {
      c.detach();
      try { c.res.end(); } catch { /* already closed */ }
    }
  }
  clientsByRun.clear();
  dispatcherModule = null;
  dispatcherLoadAttempted = false;
}

/** Test introspection — current connected client count across all runs. */
export function agentsClientCount(): number {
  return totalClients();
}

/** Test introspection — connected clients for a specific runId. */
export function agentsClientCountForRun(runId: string): number {
  return clientsByRun.get(runId)?.size ?? 0;
}
