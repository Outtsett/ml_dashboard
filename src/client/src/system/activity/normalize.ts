/**
 * DomainEvent → ActivityEntry normalization.
 *
 * The SSE adapter writes `event: <type>` frames whose data payload is the whole
 * DomainEvent envelope ({ type, data, metadata }). EventSource only delivers
 * NAMED events to listeners registered for that exact name, so the rail has to
 * enumerate the types it wants — a catch-all `onmessage` receives none of them.
 */

import type { ActivityEntry, ActivityLevel, ActivityMetric } from './types';

/**
 * Every domain event type the rail subscribes to, mirroring the unions in
 * `@shared/event-types`. `cache.invalidate` is deliberately excluded: it is
 * plumbing for TanStack Query, fires constantly, and says nothing about what
 * the dashboard is doing.
 */
export const ACTIVITY_EVENT_TYPES = [
  'pipeline.started', 'pipeline.step.started', 'pipeline.step.completed',
  'pipeline.step.failed', 'pipeline.completed', 'pipeline.failed',
  'pipeline.compensating', 'pipeline.compensated', 'pipeline.paused',
  'pipeline.resumed',
  'training.epoch.completed', 'training.checkpoint.saved', 'training.heartbeat',
  'training.event',
  'ingestion.file.received', 'ingestion.validated', 'ingestion.completed',
  'model.registered', 'model.promoted', 'model.retired',
  'system.startup', 'system.shutdown', 'system.matrix', 'system.gpu',
] as const;

// NOTE: `deployment.*` is absent on purpose. CHANNEL_PATTERNS in the server's
// sse-adapter routes only pipeline./market./training./cache./system./model./
// ingestion. prefixes, so deployment events never reach these three channels —
// they have their own /api/events/deployments stream with EventStore replay.
// Listening for them here would register handlers that can never fire.

/** Event types that are pure telemetry — feed the metric strip, not the log. */
const TELEMETRY_ONLY = new Set<string>([
  'system.gpu', 'system.matrix', 'training.heartbeat', 'deployment.pnl_update',
]);

interface Envelope {
  type?: string;
  data?: Record<string, unknown>;
  metadata?: { timestamp?: number; correlationId?: string };
}

function levelFor(type: string, data: Record<string, unknown>): ActivityLevel {
  if (type.endsWith('.failed') || type === 'system.shutdown') return 'error';
  // A training.event carries its own inner discriminator.
  const inner = typeof data.type === 'string' ? data.type : '';
  if (inner === 'error') return 'error';
  if (inner === 'warn' || inner === 'warning') return 'warn';
  if (type.endsWith('.compensating') || type.endsWith('.compensated') || type.endsWith('.paused')) {
    return 'warn';
  }
  if (
    type.endsWith('.completed') || type === 'model.promoted' ||
    type === 'model.registered' || type === 'training.checkpoint.saved' ||
    type === 'deployment.started' || type === 'system.startup'
  ) {
    return 'success';
  }
  return 'info';
}

function firstString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/** Human summary per event type. Falls back to the most descriptive field present. */
function summarize(type: string, data: Record<string, unknown>): string {
  const explicit = firstString(data, ['error', 'message', 'reason']);
  if (explicit) return explicit;

  switch (type) {
    case 'pipeline.started':        return `Pipeline ${data.pipelineType ?? ''} started`.trim();
    case 'pipeline.completed':      return `Pipeline ${data.pipelineType ?? ''} completed`.trim();
    case 'pipeline.step.started':   return `Step ${data.step ?? '?'} started`;
    case 'pipeline.step.completed': return `Step ${data.step ?? '?'} completed`;
    case 'training.epoch.completed':return `Epoch ${data.epoch ?? '?'} completed`;
    case 'training.checkpoint.saved': return `Checkpoint saved — ${data.path ?? ''}`.trim();
    case 'training.event':          return `${data.type ?? 'event'} · ${data.modelId ?? ''}`.trim();
    case 'ingestion.file.received': return `File received — ${data.filename ?? data.uploadId ?? ''}`.trim();
    case 'ingestion.validated':     return `Upload validated — ${data.uploadId ?? ''}`.trim();
    case 'ingestion.completed':     return `Ingestion completed — ${data.rowCount ?? '?'} rows`;
    case 'model.registered':        return `Model registered — ${data.modelId ?? ''}`.trim();
    case 'model.promoted':          return `Model promoted — ${data.modelId ?? ''}`.trim();
    case 'model.retired':           return `Model retired — ${data.modelId ?? ''}`.trim();
    case 'deployment.started':      return `Deployment started — ${data.mode ?? ''}`.trim();
    case 'deployment.stopped':      return `Deployment stopped`;
    case 'deployment.prediction':   return `Prediction ${data.prediction ?? ''}`.trim();
    case 'system.startup':          return 'Server started';
    case 'system.shutdown':         return 'Server shutting down';
    default:                        return type;
  }
}

let nextId = 0;

/**
 * Convert one SSE payload into a rail entry.
 * Returns null for telemetry-only events, which belong in the metric strip.
 */
export function toEntry(type: string, raw: unknown): ActivityEntry | null {
  if (TELEMETRY_ONLY.has(type)) return null;

  const env = (raw ?? {}) as Envelope;
  // The adapter broadcasts the full envelope, but tolerate a bare data object.
  const data = (env.data ?? (env as Record<string, unknown>)) as Record<string, unknown>;
  const ts = env.metadata?.timestamp ?? Date.now();

  const full = summarize(type, data);
  // Split multi-line payloads: a Python traceback or a JS stack arrives as one
  // string with newlines. First line is the summary, the rest collapses.
  const lines = full.split('\n').map((l) => l.replace(/\s+$/, ''));
  const message = lines[0] || type;
  const detail = lines.slice(1).filter((l) => l.trim().length > 0);

  // A separate stack field (if the emitter supplied one) appends to the detail.
  const stack = firstString(data, ['stack', 'traceback']);
  if (stack) detail.push(...stack.split('\n').filter((l) => l.trim().length > 0));

  return {
    id: nextId++,
    ts,
    level: levelFor(type, data),
    source: type.split('.')[0] ?? 'system',
    type,
    message,
    detail,
  };
}

/** Pull any numeric telemetry out of an event for the metric strip. */
export function toMetrics(type: string, raw: unknown): ActivityMetric[] {
  const env = (raw ?? {}) as Envelope;
  const data = (env.data ?? (env as Record<string, unknown>)) as Record<string, unknown>;
  const ts = env.metadata?.timestamp ?? Date.now();
  const source = type.split('.')[0] ?? 'system';
  const out: ActivityMetric[] = [];

  const push = (key: string, value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      out.push({ key, value, ts, source });
    }
  };

  if (type === 'training.epoch.completed') {
    push('epoch', data.epoch);
    const metrics = data.metrics as Record<string, unknown> | undefined;
    if (metrics) for (const [k, v] of Object.entries(metrics)) push(k, v);
  } else if (type === 'training.heartbeat') {
    push('epoch', data.epoch);
    push('progress', data.progress);
  } else if (type === 'system.gpu') {
    push('gpu_util_pct', data.utilization ?? data.utilizationPct);
    push('vram_mb', data.memoryUsed ?? data.memoryUsedMb);
    push('gpu_temp_c', data.temperature ?? data.temperatureC);
  } else if (type === 'deployment.pnl_update') {
    push('pnl', data.pnl ?? data.realizedPnl);
    push('position', data.position);
  }

  return out;
}
