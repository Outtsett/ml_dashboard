/**
 * Agent Dispatcher (W8.c) — Claude Agent SDK orchestration.
 *
 * SRP: this module owns ONLY the per-process job queue, the per-run ring
 *      buffer (consumed by W8.d's SSE replay path), the SDK call wrapper,
 *      the boot-time recovery sweep, and the server-side context-blob
 *      enrichment per agent (backend §8). It does NOT own routing/HTTP
 *      concerns (those live in `routes/agents.ts`).
 *
 * DIP: routes/agents.ts depends on the public API (`dispatch`, `getAgentRun`,
 *      `getReplayBuffer`); the queue + SDK wrapper are private.
 *
 * Public API (consumed by routes/agents.ts AND routes/eventsAgents.ts):
 *   - dispatch(agentId, contextBlob): create row, enqueue, return runId
 *   - getAgentRun(runId): row from agent_runs (typed)
 *   - getReplayBuffer(runId): per-run ring buffer for SSE replay
 *   - clearAgentDispatcher(): test/shutdown reset
 *
 * Concurrency:
 *   MAX_CONCURRENT = 2 (Claude SDK is rate-limited).  When the pool is full,
 *   incoming dispatches stay 'queued'; a tick after every completion pops the
 *   next job.
 *
 * Boot recovery:
 *   On first import, any rows with status IN ('queued','running') get marked
 *   'failed' with error='server restart' (per backend §10 risk row 10).
 *
 * Ring buffer:
 *   Per-run, 200 events max, FIFO eviction.  Each event carries a monotonic
 *   per-run `id` so the SSE route can resume past `Last-Event-ID`.  The
 *   buffer is also used to materialize the final agent.completed/failed
 *   payload before the row is updated.
 *
 * Context-blob enrichment (backend §8):
 *   The frontend sends a thin blob (symbol/timeframe/catalogId/etc.); this
 *   module enriches it server-side per agentId before handing to the SDK.
 *   When a data source isn't yet wired (e.g. `feature_correlations` table),
 *   the enrichment falls back gracefully with a `_unavailable` marker.
 *
 * Rate-limit handling (backend §10 risk row 6):
 *   SDK 429s are surfaced as a structured error JSON in `agent_runs.error`:
 *     {"code":"rate_limit","retry_after":<seconds>,"message":<sdk msg>}
 */

import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Logger } from '@nestjs/common';
import { sql, eq } from 'drizzle-orm';
import { db } from '../database/db';
import {
  agentRuns,
  type AgentId,
  type AgentRun,
  type AgentRunStatus,
  type AgentReport,
  type AgentTokenUsage,
} from '@shared/schema';
import { getEventBus } from '../events/event-bus';
import { childEnvironment } from '../../claude/session';
import type { DomainEvent } from '@shared/event-types';

const logger = new Logger('AgentDispatcher');

// ─── Configuration ──────────────────────────────────────────────────────────

/** Maximum SDK calls in flight at once (Claude rate-limit guardrail). */
export const MAX_CONCURRENT = 2;

/** Per-run ring-buffer cap (FIFO; consumed by SSE replay path). */
const RING_BUFFER_MAX = 200;

/** SDK call timeout (10 minutes — agents do deep analysis). */
const SDK_TIMEOUT_MS = 10 * 60_000;

/** The four ML Studio Workshop specialist agents. */
const VALID_AGENT_IDS = [
  'feature-curator',
  'arch-designer',
  'hpo-strategist',
  'eval-reviewer',
] as const satisfies readonly AgentId[];

// ─── Public types ───────────────────────────────────────────────────────────

/**
 * The thin context blob the frontend sends. Per agent, the dispatcher
 * enriches it server-side before handing to the SDK (backend §8).
 *
 * Permissive shape — the agent-specific enrichment functions read what
 * they need; routes/agents.ts validates only that it's a JSON object.
 */
export type AgentContextBlob = Record<string, unknown>;

/** Public buffered-event shape — mirrors the contract in routes/eventsAgents.ts. */
export interface BufferedAgentEvent {
  /** Monotonic per-run id, starts at 0. */
  id: number;
  /** Unprefixed wire type (e.g. `agent.token_chunk`); SSE route translates. */
  type: string;
  /** Payload (always carries `run_id`). */
  data: Record<string, unknown>;
  /** Epoch ms. */
  ts: number;
}

/** Shape returned by getAgentRun (subset of AgentRun for SSE route's use). */
export interface AgentRunSummary {
  runId: string;
  agentId: AgentId;
  status: AgentRunStatus;
  output?: AgentReport | null;
  error?: string | null;
  completedAt?: string | null;
}

// ─── Module state ───────────────────────────────────────────────────────────

interface QueueEntry {
  runId: string;
  agentId: AgentId;
  contextBlob: AgentContextBlob;
}

const queue: QueueEntry[] = [];
const running = new Set<string>();              // runIds currently executing
const ringBuffers = new Map<string, BufferedAgentEvent[]>();
const eventCounters = new Map<string, number>();   // monotonic id per runId

let bootRecoveryDone = false;
let schedulerTickPending = false;

// ─── Boot recovery (called lazily on first dispatch) ────────────────────────

/**
 * On boot, mark stale 'queued'/'running' rows as 'failed'. Idempotent —
 * subsequent calls are no-ops once `bootRecoveryDone` flips.
 *
 * The dispatcher cannot run on import-time (DI wiring isn't ready), so we
 * defer this to the first dispatch() call. After the sweep, future restarts
 * will see the same rows already-failed and the WHERE clause will match
 * zero rows.
 *
 * Catches "no such table" — the migration may not have run yet in dev.
 */
function ensureBootRecovery(): void {
  if (bootRecoveryDone) return;
  bootRecoveryDone = true;

  try {
    const result = db
      .update(agentRuns)
      .set({
        status: 'failed',
        error: 'server restart',
        completedAt: new Date().toISOString(),
      })
      .where(sql`${agentRuns.status} IN ('queued','running')`)
      .run();
    const changes = (result as { changes?: number })?.changes ?? 0;
    if (changes > 0) {
      logger.warn(`Boot recovery: marked ${changes} stale agent_runs as failed`);
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('no such table')) {
      // Migration not yet applied — skip silently. The first real dispatch
      // will INSERT and surface the missing table as a 500.
      return;
    }
    logger.warn(`Boot recovery sweep failed: ${msg}`);
  }
}

// ─── SDK loader (lazy, optional) ────────────────────────────────────────────

/** The advisors' tools: read and search, nothing that writes or sends. */
const ADVISOR_TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch'];
/** Denied even to Read/Grep/Glob: the credential stores on this machine. */
const ADVISOR_DENIED = [
  'WebFetch',
  'Bash',
  'Write',
  'Edit',
  'NotebookEdit',
  'Read(//e/source/repos/dotfiles/**)',
  'Read(**/secrets/**)',
  'Read(**/.env)',
  'Read(**/*.env)',
  'Read(**/.credentials.json)',
  'Read(**/.env.*)',
  'Read(//c/Users/*/.claude/**)',
  'Read(//c/Users/*/.claude.json)',
  'Read(//c/Users/*/.ssh/**)',
  'Read(//c/Users/*/AppData/Roaming/gh/**)',
  'Read(//c/Users/*/AppData/Roaming/GitHub CLI/**)',
  'Read(//c/Users/*/.aws/**)',
  'Read(//c/Users/*/.git-credentials)',
];

interface SDKQueryFn {
  (params: {
    prompt: string;
    options?: Record<string, unknown>;
  }): AsyncGenerator<unknown, void, unknown>;
}

/** Cached `query` reference once loaded (or null if SDK absent). */
let sdkQueryFn: SDKQueryFn | null = null;
let sdkLoadAttempted = false;

/**
 * Load `@anthropic-ai/claude-agent-sdk::query` lazily. The SDK is an ESM-only
 * package; we use dynamic import so the module can be excluded from bundles
 * that don't need it (e.g. test environments using the stub override below).
 */
async function loadSdk(): Promise<SDKQueryFn | null> {
  if (sdkQueryFn) return sdkQueryFn;
  if (sdkLoadAttempted) return null;
  sdkLoadAttempted = true;
  try {
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    const fn = (mod as { query?: SDKQueryFn }).query;
    if (typeof fn !== 'function') {
      logger.warn('claude-agent-sdk loaded but `query` export missing');
      return null;
    }
    sdkQueryFn = fn;
    return sdkQueryFn;
  } catch (err) {
    logger.warn(`claude-agent-sdk unavailable: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Test/dev override — inject a fake SDK so unit tests don't hit the network.
 * The override takes precedence over the real SDK and is honored even after
 * `loadSdk()` returned null.
 */
let sdkOverride: SDKQueryFn | null = null;
export function _setSdkQueryForTests(fn: SDKQueryFn | null): void {
  sdkOverride = fn;
}

function getActiveSdk(): SDKQueryFn | null {
  return sdkOverride ?? sdkQueryFn;
}

// ─── Ring buffer ────────────────────────────────────────────────────────────

function pushBuffered(runId: string, type: string, data: Record<string, unknown>): BufferedAgentEvent {
  let buf = ringBuffers.get(runId);
  if (!buf) {
    buf = [];
    ringBuffers.set(runId, buf);
  }
  const id = (eventCounters.get(runId) ?? -1) + 1;
  eventCounters.set(runId, id);

  const evt: BufferedAgentEvent = {
    id,
    type,
    data: { ...data, run_id: runId, id },
    ts: Date.now(),
  };
  buf.push(evt);
  if (buf.length > RING_BUFFER_MAX) {
    buf.shift();
  }
  return evt;
}

/** Public read accessor (consumed by SSE replay path). */
export function getReplayBuffer(runId: string): BufferedAgentEvent[] {
  return ringBuffers.get(runId) ?? [];
}

/** Drop the per-run buffer (called on completion to bound memory). */
function dropReplayBuffer(runId: string): void {
  ringBuffers.delete(runId);
  eventCounters.delete(runId);
}

// ─── Bus emission (W8.d SSE channel: agent.<runId>.<event>) ─────────────────

function emitBus(runId: string, eventType: string, data: Record<string, unknown>): void {
  const buffered = pushBuffered(runId, `agent.${eventType}`, data);
  const bus = getEventBus();
  const domainEvent: DomainEvent = {
    type: `agent.${runId}.${eventType}`,
    data: buffered.data,
    metadata: {
      timestamp: buffered.ts,           // EventMetadata.timestamp = epoch ms (number), not ISO string
      correlationId: runId,
      causationId: runId,
    },
  };
  bus.emit(domainEvent);
}

// ─── Context-blob enrichment per agent (backend §8) ────────────────────────

const REPO_ROOT = process.cwd();

function safeReadJson<T>(absPath: string): T | null {
  try {
    if (!fs.existsSync(absPath)) return null;
    const raw = fs.readFileSync(absPath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn(`safeReadJson(${absPath}) failed: ${(err as Error).message}`);
    return null;
  }
}

interface RunnersJson {
  runners?: Record<string, {
    defaultSearchSpace?: Record<string, unknown>;
    defaultHyperparameters?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
}

/** Read the current `defaultSearchSpace` for a runner from src/config/runners.json. */
function readDefaultSearchSpace(runnerKey: string): Record<string, unknown> | null {
  const runnersPath = path.resolve(REPO_ROOT, 'src', 'config', 'runners.json');
  const cfg = safeReadJson<RunnersJson>(runnersPath);
  if (!cfg?.runners) return null;
  const entry = cfg.runners[runnerKey];
  return entry?.defaultSearchSpace ?? null;
}

/**
 * Best-effort dataset-preview lookup. The `dataPreviewId` is an opaque key
 * the frontend computed from the current pipeline; we map it to whatever
 * artifact lives at `data/feature_previews/<id>.json` if present.
 */
function loadDataPreview(dataPreviewId: string): unknown | null {
  if (!dataPreviewId || typeof dataPreviewId !== 'string') return null;
  // Sanitize — only word chars + dash + dot.
  if (!/^[A-Za-z0-9_.\-]+$/.test(dataPreviewId)) return null;
  const previewPath = path.resolve(REPO_ROOT, 'data', 'feature_previews', `${dataPreviewId}.json`);
  return safeReadJson<unknown>(previewPath);
}

/**
 * Best-effort redundant-pair findings. The `feature_correlations` table is
 * not yet wired (gated by future work); this returns null so the agent
 * receives an explicit `_unavailable: true` marker instead of fabricated data.
 */
function loadRedundantPairs(_symbol: string, _timeframe: string): unknown | null {
  // The table lookup would go here. Intentionally null until the upstream
  // table lands — we never invent correlation numbers.
  return null;
}

interface CatalogSpecLite {
  catalogId: string;
  found: boolean;
  text?: string;
  hyperparamHints?: Record<string, string>;
}

/**
 * Best-effort catalog spec lookup. The catalog is a TS map; we read the
 * machine-readable `mlTaxonomy.ts` if a cached JSON snapshot exists at
 * `data/cache/ml_taxonomy_snapshot.json`. Returns `{found:false}` otherwise.
 */
function loadCatalogSpec(catalogId: string): CatalogSpecLite {
  const snapshotPath = path.resolve(REPO_ROOT, 'data', 'cache', 'ml_taxonomy_snapshot.json');
  const snap = safeReadJson<{ specs?: Record<string, { description?: string; hyperparamHints?: Record<string, string> }> }>(snapshotPath);
  const spec = snap?.specs?.[catalogId];
  if (!spec) return { catalogId, found: false };
  return {
    catalogId,
    found: true,
    text: spec.description ?? undefined,
    hyperparamHints: spec.hyperparamHints ?? undefined,
  };
}

/**
 * Per-agent context enrichment. Pure function: receives the thin frontend
 * blob, returns the enriched blob the SDK will see. Each branch is
 * defensive — missing data sources surface as `_unavailable: true` markers
 * so the agent can decide what to do, never as fabricated values.
 */
export function enrichContextBlob(agentId: AgentId, blob: AgentContextBlob): AgentContextBlob {
  const enriched: AgentContextBlob = { ...blob, _enrichedAt: new Date().toISOString() };

  if (agentId === 'feature-curator') {
    const dataPreviewId = typeof blob.dataPreviewId === 'string' ? blob.dataPreviewId : '';
    const symbol = typeof blob.symbol === 'string' ? blob.symbol : '';
    const timeframe = typeof blob.timeframe === 'string' ? blob.timeframe : '';
    const dataPreview = dataPreviewId ? loadDataPreview(dataPreviewId) : null;
    const redundantPairs = symbol && timeframe ? loadRedundantPairs(symbol, timeframe) : null;
    enriched._serverEnrichment = {
      dataPreview: dataPreview ?? { _unavailable: true, reason: 'no preview at data/feature_previews/<id>.json' },
      redundantPairs: redundantPairs ?? { _unavailable: true, reason: 'feature_correlations table not yet wired' },
    };
  }

  if (agentId === 'arch-designer') {
    const catalogId = typeof blob.catalogId === 'string' ? blob.catalogId : '';
    const spec = catalogId ? loadCatalogSpec(catalogId) : { catalogId: '', found: false };
    // labelDistribution + n_train_samples typically come from the latest
    // training session for this (catalogId, symbol, tf). We surface what
    // the frontend sent in `labelDistribution` / `nTrainSamples` (if any).
    enriched._serverEnrichment = {
      catalogSpec: spec,
      labelDistribution: blob.labelDistribution ?? { _unavailable: true, reason: 'frontend did not provide labelDistribution' },
      nTrainSamples: typeof blob.nTrainSamples === 'number' ? blob.nTrainSamples : null,
    };
  }

  if (agentId === 'hpo-strategist') {
    const catalogId = typeof blob.catalogId === 'string' ? blob.catalogId : '';
    const spec = catalogId ? loadCatalogSpec(catalogId) : { catalogId: '', found: false };
    // Map catalogId → runner key. The frontend may have sent runnerKey
    // explicitly; fall back to catalogId+'_classifier' best-guess pattern
    // and surface _unavailable if no match.
    const explicitRunnerKey = typeof blob.runnerKey === 'string' ? blob.runnerKey : null;
    let searchSpace: Record<string, unknown> | null = null;
    const runnerKey = explicitRunnerKey;
    if (runnerKey) {
      searchSpace = readDefaultSearchSpace(runnerKey);
    }
    enriched._serverEnrichment = {
      catalogSpec: spec,
      hyperparamHints: spec.hyperparamHints ?? null,
      currentSearchSpace: searchSpace ?? { _unavailable: true, reason: runnerKey ? `runners.json has no entry for ${runnerKey}` : 'no runnerKey provided' },
      runnerKey,
    };
  }

  if (agentId === 'eval-reviewer') {
    const experimentIds = Array.isArray(blob.experimentIds) ? blob.experimentIds : [];
    // Comparison matrix + regime breakdown would join backtest_runs +
    // diagnostics.json — the join is non-trivial and lives in routes/eval
    // (W6.b). For now, surface an explicit pointer + the IDs the agent
    // should pull, so it can call /api/eval/regime-breakdown itself.
    enriched._serverEnrichment = {
      experimentIds,
      comparisonMatrix: { _unavailable: true, reason: 'use POST /api/eval/regime-breakdown to materialize' },
      regimeBreakdown: { _unavailable: true, reason: 'use POST /api/eval/regime-breakdown to materialize' },
    };
  }

  return enriched;
}

// ─── DB row helpers ─────────────────────────────────────────────────────────

function hashContextBlob(blob: AgentContextBlob): string {
  // Stable canonical sort so identical blobs hash identically.
  const sortObj = (val: unknown): unknown => {
    if (Array.isArray(val)) return val.map(sortObj);
    if (val && typeof val === 'object') {
      const obj = val as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort()) sorted[k] = sortObj(obj[k]);
      return sorted;
    }
    return val;
  };
  const canonical = sortObj(blob);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function insertAgentRunRow(runId: string, agentId: AgentId, blob: AgentContextBlob): void {
  db.insert(agentRuns)
    .values({
      runId,
      agentId,
      status: 'queued',
      contextBlob: JSON.stringify(blob),
      contextBlobHash: hashContextBlob(blob),
      requestedAt: new Date().toISOString(),
    })
    .run();
}

function updateRunStatus(
  runId: string,
  patch: {
    status?: AgentRunStatus;
    startedAt?: string | null;
    completedAt?: string | null;
    output?: AgentReport | null;
    error?: string | null;
    durationMs?: number | null;
    tokenUsage?: AgentTokenUsage | null;
  },
): void {
  // Drizzle's `set()` strips undefined fields; nulls are written through.
  db.update(agentRuns).set(patch).where(eq(agentRuns.runId, runId)).run();
}

/** Public typed lookup — used by SSE route + GET /runs/:id route. */
export function getAgentRun(runId: string): AgentRun | null {
  try {
    const rows = db.select().from(agentRuns).where(eq(agentRuns.runId, runId)).all();
    return rows[0] ?? null;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('no such table')) return null;
    throw err;
  }
}

/** Lighter wrapper for SSE route's optional getAgentRun contract. */
export function getAgentRunSummary(runId: string): AgentRunSummary | null {
  const row = getAgentRun(runId);
  if (!row) return null;
  return {
    runId: row.runId,
    agentId: row.agentId,
    status: row.status,
    output: row.output ?? null,
    error: row.error ?? null,
    completedAt: row.completedAt ?? null,
  };
}

// ─── SDK call wrapper ───────────────────────────────────────────────────────

/** Surface SDK errors with structured codes for downstream UI. */
export class AgentDispatchError extends Error {
  constructor(
    message: string,
    public readonly code: 'rate_limit' | 'sdk_unavailable' | 'sdk_error' | 'timeout',
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'AgentDispatchError';
  }
}

interface SdkCallResult {
  output: AgentReport;
  durationMs: number;
  tokenUsage: AgentTokenUsage;
}

/**
 * Build the per-agent system prompt. Kept small — the heavy lifting is the
 * enriched context blob which the SDK call materializes into the user msg.
 */
function buildAgentPrompt(agentId: AgentId, blob: AgentContextBlob): string {
  const role = {
    'feature-curator': 'a feature engineering reviewer for ML trading models',
    'arch-designer': 'a model architecture advisor for ML trading models',
    'hpo-strategist': 'a hyperparameter-optimization search-space designer',
    'eval-reviewer': 'a backtest results reviewer focused on robustness + leakage',
  }[agentId];

  return [
    `You are ${role}.`,
    '',
    'Respond with a JSON object matching the AgentReport contract:',
    '{',
    `  "agentId": "${agentId}",`,
    '  "status": "ok" | "error",',
    '  "summary": "<one-sentence headline>",',
    '  "body": "<markdown>",',
    '  "findings": [{ "severity":"info|warning|error", "category":"<short>", "message":"<text>", "evidence":{ "metric":"<name>", "value":<num>, "threshold"?:<num>, "reference"?:"<src>" } }],',
    '  "proposedActions": [{ "kind":"set-feature-pipeline|set-hyperparameter|add-experiment|set-search-space|apply-template-edit", "label":"<text>", "payload":{...} }]',
    '}',
    '',
    'Context blob (server-enriched):',
    '```json',
    JSON.stringify(blob, null, 2),
    '```',
  ].join('\n');
}

/** Coerce an unknown SDK result into an AgentReport. Defensive parsing. */
function coerceAgentReport(agentId: AgentId, raw: unknown): AgentReport {
  // Try parse if string; otherwise treat as object.
  let candidate: unknown = raw;
  if (typeof raw === 'string') {
    // Try strict JSON, else extract first {...} block.
    try {
      candidate = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          candidate = JSON.parse(match[0]);
        } catch {
          candidate = null;
        }
      } else {
        candidate = null;
      }
    }
  }

  const obj = (candidate && typeof candidate === 'object' ? candidate : {}) as Record<string, unknown>;
  const findings = Array.isArray(obj.findings) ? (obj.findings as AgentReport['findings']) : [];
  const actions = Array.isArray(obj.proposedActions) ? (obj.proposedActions as AgentReport['proposedActions']) : [];
  return {
    agentId,
    status: obj.status === 'error' ? 'error' : 'ok',
    summary: typeof obj.summary === 'string' ? obj.summary : 'Agent returned no structured summary',
    body: typeof obj.body === 'string' ? obj.body : (typeof raw === 'string' ? raw : JSON.stringify(raw)),
    findings,
    proposedActions: actions,
    diff: (obj.diff && typeof obj.diff === 'object') ? (obj.diff as AgentReport['diff']) : undefined,
  };
}

/**
 * Drive the SDK async generator to completion, emitting per-message SSE
 * events on the bus. Returns the final structured AgentReport.
 *
 * Surfaces 429 / rate_limit / overloaded errors as AgentDispatchError with
 * code='rate_limit' and a parsed retry-after when present.
 */
async function callSdk(
  runId: string,
  agentId: AgentId,
  enrichedBlob: AgentContextBlob,
): Promise<SdkCallResult> {
  const sdkFn = getActiveSdk() ?? (await loadSdk());
  if (!sdkFn) {
    throw new AgentDispatchError(
      'Claude Agent SDK not loaded; install @anthropic-ai/claude-agent-sdk and set ANTHROPIC_API_KEY',
      'sdk_unavailable',
    );
  }

  const prompt = buildAgentPrompt(agentId, enrichedBlob);
  const startedAt = Date.now();

  let finalText = '';
  let chunkIndex = 0;
  let tokenUsage: AgentTokenUsage = { input: 0, output: 0, cached: 0 };
  let durationMs = 0;
  let resultPayload: unknown = null;
  let resultIsError = false;
  let resultErrorMessage: string | null = null;
  let rateLimited = false;
  let retryAfter: number | undefined;

  // Read-only advisors, run unattended (dontAsk: anything not allowed here is
  // refused, never asked). Their only tools are reading and searching: no
  // WebFetch, because an injected instruction in a page could otherwise read a
  // file and send it to any URL with nobody watching; and secret stores are
  // denied by path. No setting sources: the project's hooks (the Stop quality
  // gate) would spend minutes of every run in verify.mjs and replace the
  // advisor's report with its reply to the gate. Same child environment as the
  // Claude panel (src/server/claude/session.ts): the dashboard may have been
  // started from a Claude Code session, whose variables would make this a
  // nested sub-session.
  const abort = new AbortController();
  const iter = sdkFn({
    prompt,
    options: {
      cwd: process.cwd(),
      tools: ADVISOR_TOOLS,
      allowedTools: ADVISOR_TOOLS,
      disallowedTools: ADVISOR_DENIED,
      permissionMode: 'dontAsk',
      settingSources: [],
      maxTurns: 30,
      env: childEnvironment(),
      abortController: abort,
    },
  });

  // Race the iterator against a timeout; a timed-out run stops its child
  // instead of spending tokens and emitting events for a run already failed.
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new AgentDispatchError(`SDK call timed out (>${SDK_TIMEOUT_MS / 1000}s)`, 'timeout'));
    }, SDK_TIMEOUT_MS);
    timer.unref();
  });

  try {
    await Promise.race([
      (async () => {
        for await (const msg of iter) {
          const m = msg as { type?: string; [key: string]: unknown };
          if (m.type === 'assistant') {
            // Extract incremental text content for token-chunk SSE.
            const inner = (m.message as { content?: unknown })?.content;
            if (Array.isArray(inner)) {
              for (const block of inner) {
                const b = block as { type?: string; text?: string; name?: string; input?: unknown; id?: string };
                if (b.type === 'text' && typeof b.text === 'string') {
                  finalText += b.text;
                  emitBus(runId, 'token_chunk', { chunk: b.text, index: chunkIndex++ });
                } else if (b.type === 'tool_use') {
                  emitBus(runId, 'tool_call', { tool: b.name ?? 'unknown', args: b.input ?? null, call_id: b.id ?? null });
                }
              }
            }
            // Detect SDK-side rate-limit signal embedded on assistant errors.
            const err = m.error as string | undefined;
            if (err === 'rate_limit') {
              rateLimited = true;
            }
          } else if (m.type === 'result') {
            durationMs = (m.duration_ms as number) ?? Date.now() - startedAt;
            const usage = m.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined;
            tokenUsage = {
              input: usage?.input_tokens ?? 0,
              output: usage?.output_tokens ?? 0,
              cached: (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
            };
            resultIsError = Boolean(m.is_error);
            const subtype = m.subtype as string | undefined;
            if (subtype && subtype.startsWith('error_')) {
              resultIsError = true;
              resultErrorMessage = subtype;
            }
            resultPayload = m.result ?? m.structured_output ?? null;
            // Best-effort retry-after extraction from API error status payload.
            const apiStatus = m.api_error_status as number | null | undefined;
            if (apiStatus === 429) {
              rateLimited = true;
            }
          } else if (m.type === 'rate_limit') {
            rateLimited = true;
            const info = (m as { rateLimitInfo?: { retry_after_s?: number } }).rateLimitInfo;
            if (typeof info?.retry_after_s === 'number') retryAfter = info.retry_after_s;
          }
        }
      })(),
      timeoutPromise,
    ]);
  } catch (err) {
    if (err instanceof AgentDispatchError) throw err;
    const msg = (err as Error).message;
    if (/429|rate.?limit|overloaded/i.test(msg)) {
      throw new AgentDispatchError(msg, 'rate_limit', retryAfter);
    }
    throw new AgentDispatchError(msg, 'sdk_error');
  } finally {
    if (timer) clearTimeout(timer);
    if (!abort.signal.aborted) abort.abort();
    // Not awaited: after a timeout a next() may still be pending, and return()
    // queues behind it; the abort above is what ends the child.
    void iter.return?.(undefined).catch(() => undefined);
  }

  if (rateLimited) {
    throw new AgentDispatchError('Claude Agent SDK reported rate_limit', 'rate_limit', retryAfter);
  }

  if (resultIsError) {
    throw new AgentDispatchError(
      resultErrorMessage ?? 'SDK returned is_error=true',
      'sdk_error',
    );
  }

  const report = coerceAgentReport(agentId, resultPayload ?? finalText);
  return { output: report, durationMs: durationMs || (Date.now() - startedAt), tokenUsage };
}

// ─── Scheduler tick + worker ────────────────────────────────────────────────

function scheduleTick(): void {
  if (schedulerTickPending) return;
  schedulerTickPending = true;
  // Defer to microtask so `dispatch()` returns before workers start running.
  queueMicrotask(() => {
    schedulerTickPending = false;
    void tick();
  });
}

async function tick(): Promise<void> {
  while (running.size < MAX_CONCURRENT && queue.length > 0) {
    const entry = queue.shift()!;
    running.add(entry.runId);
    void runJob(entry).finally(() => {
      running.delete(entry.runId);
      // Try to pop the next queued job after this one completes.
      scheduleTick();
    });
  }
}

async function runJob(entry: QueueEntry): Promise<void> {
  const { runId, agentId, contextBlob } = entry;
  const startedAt = new Date().toISOString();
  updateRunStatus(runId, { status: 'running', startedAt });
  emitBus(runId, 'started', { agent_id: agentId, started_at: startedAt });

  let enriched: AgentContextBlob;
  try {
    enriched = enrichContextBlob(agentId, contextBlob);
  } catch (err) {
    const msg = `enrichContextBlob failed: ${(err as Error).message}`;
    logger.error(msg);
    updateRunStatus(runId, {
      status: 'failed',
      error: JSON.stringify({ code: 'enrichment_failed', message: msg }),
      completedAt: new Date().toISOString(),
    });
    emitBus(runId, 'failed', { error: msg, code: 'enrichment_failed' });
    dropReplayBuffer(runId);
    return;
  }

  try {
    const result = await callSdk(runId, agentId, enriched);
    updateRunStatus(runId, {
      status: 'completed',
      output: result.output,
      durationMs: result.durationMs,
      tokenUsage: result.tokenUsage,
      completedAt: new Date().toISOString(),
    });
    emitBus(runId, 'completed', {
      output: result.output,
      duration_ms: result.durationMs,
      token_usage: result.tokenUsage,
    });
  } catch (err) {
    const dispatchErr = err instanceof AgentDispatchError ? err : new AgentDispatchError(
      (err as Error).message,
      'sdk_error',
    );
    const errorPayload = JSON.stringify({
      code: dispatchErr.code,
      message: dispatchErr.message,
      ...(dispatchErr.retryAfter !== undefined ? { retry_after: dispatchErr.retryAfter } : {}),
    });
    updateRunStatus(runId, {
      status: 'failed',
      error: errorPayload,
      completedAt: new Date().toISOString(),
    });
    emitBus(runId, 'failed', {
      error: dispatchErr.message,
      code: dispatchErr.code,
      ...(dispatchErr.retryAfter !== undefined ? { retry_after: dispatchErr.retryAfter } : {}),
    });
  } finally {
    // Keep the buffer briefly so reconnecting SSE clients can replay the
    // terminal events; drop after a short delay so memory stays bounded.
    setTimeout(() => dropReplayBuffer(runId), 60_000).unref();
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function isValidAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (VALID_AGENT_IDS as readonly string[]).includes(value);
}

/**
 * Enqueue a new agent run. Writes the row, primes the ring buffer, kicks
 * the scheduler. Returns the new runId synchronously.
 */
export function dispatch(agentId: AgentId, contextBlob: AgentContextBlob): string {
  ensureBootRecovery();
  const runId = randomUUID();
  insertAgentRunRow(runId, agentId, contextBlob);
  // Prime the buffer with a `queued` event so an immediate SSE subscribe
  // sees something to replay.
  emitBus(runId, 'queued', { agent_id: agentId, requested_at: new Date().toISOString() });
  queue.push({ runId, agentId, contextBlob });
  scheduleTick();
  return runId;
}

/**
 * Test/shutdown reset — clears in-memory state. Does NOT touch the DB.
 * The boot-recovery flag is also reset so the next dispatch re-runs the
 * sweep (useful in tests after fixture inserts).
 */
export function clearAgentDispatcher(): void {
  queue.length = 0;
  running.clear();
  ringBuffers.clear();
  eventCounters.clear();
  bootRecoveryDone = false;
  schedulerTickPending = false;
}

/** Diagnostics — current queue depth + running count. */
export function getDispatcherStats(): { queued: number; running: number; bufferedRuns: number } {
  return { queued: queue.length, running: running.size, bufferedRuns: ringBuffers.size };
}
