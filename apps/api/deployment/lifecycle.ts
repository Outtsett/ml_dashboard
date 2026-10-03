/**
 * Live deployment lifecycle (W9.b).
 *
 * Owns the per-deployment polling loop that:
 *   1. fetches the latest bar features for (symbol, timeframe)
 *   2. calls MLBridge.predict() to score that feature vector
 *   3. writes the prediction row to lake `prediction_log` (W9.d DDL)
 *   4. publishes `deployment.prediction` via publisher.ts (SSE fan-out + replay)
 *   5. updates SQLite `deployments` row (predictions_emitted, last_prediction_at,
 *      paper_pnl)
 *
 * Persistence cadence: SQLite is updated every tick. The deployments table is
 * small (one row per active deployment) and SQLite WAL gives us cheap writes;
 * batching would buy <1ms per tick and add lost-state risk on crash. ILP
 * batches at the Sender layer (auto_flush_rows=100).
 *
 * Circuit breaker: 3 consecutive predict() failures stop the deployment and
 * publish `deployment.failed`. The threshold is intentionally small — MLBridge
 * is a local Rust process, persistent failure is a real outage, not a blip.
 *
 * Gated by env `ENABLE_LIVE_DEPLOY=1`. Without the flag, `startLiveDeployment`
 * throws synchronously so the caller can decide whether to fail the request.
 */

import { eq } from 'drizzle-orm';
import { db } from '../infrastructure/database/db';
import { deployments, modelVersions } from '@shared/pg_schema';
import { queryLakeFast } from '../infrastructure/database/lake/connection';
import { getBaseTableForType, detectInstrumentType } from '../infrastructure/database/lake/marketData';
import { getMLBridgeClient, type MLBridgeClient } from './mlbridgeClient';
import { getPredictionLog, type PredictionLog } from './predictionLog';
import { publishDeploymentEvent, publishPrediction, publishPnlUpdate } from './publisher';
import { PaperPnLAccrual, loadCostModel } from './paperPnL';

interface LiveLoopState {
  abort: AbortController;
  consecutiveFailures: number;
  predictionsEmitted: number;
  paperPnlTotal: number;
  lastPredictionAt: string | null;
  // W9.c integration
  accrual: PaperPnLAccrual;
  lastPrediction: number | string | null;
  lastPnlPublishedAt: number; // epoch ms — throttle pnl_update events
}

// Throttle: publish a pnl_update event every N predictions OR every M ms,
// whichever fires first. Per-prediction events already carry running total,
// but pnl_update is the periodic snapshot the dashboard subscribes to for
// chart redraws.
const PNL_PUBLISH_EVERY_N = 10;
const PNL_PUBLISH_EVERY_MS = 30_000;

const liveLoops = new Map<number, LiveLoopState>();

// Default polling cadence. Production deployments override via the
// LIVE_DEPLOY_POLL_INTERVAL_MS env var. Anything lower than ~200ms risks
// hammering lake without yielding new bars.
const DEFAULT_POLL_INTERVAL_MS = 1000;
const MAX_CONSECUTIVE_FAILURES = 3;

function isLiveDeployEnabled(): boolean {
  const v = process.env.ENABLE_LIVE_DEPLOY;
  return v === '1' || v?.toLowerCase() === 'true';
}

function pollIntervalMs(): number {
  const raw = process.env.LIVE_DEPLOY_POLL_INTERVAL_MS;
  if (!raw) return DEFAULT_POLL_INTERVAL_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 100 ? n : DEFAULT_POLL_INTERVAL_MS;
}

/** Inspect the in-memory map (test/diagnostic surface). */
export function isDeploymentLoopActive(deploymentId: number): boolean {
  return liveLoops.has(deploymentId);
}

/**
 * Start the live polling loop for a deployment row that already exists in
 * SQLite with status='running' and mode='live'. Fire-and-forget — returns
 * once the loop is registered; the async tick continues in the background.
 */
export async function startLiveDeployment(
  deploymentId: number,
  opts: {
    mlBridge?: MLBridgeClient;
    predictionLog?: PredictionLog;
    pollIntervalMs?: number;
  } = {},
): Promise<void> {
  if (!isLiveDeployEnabled()) {
    throw new Error('live deployments disabled');
  }
  if (liveLoops.has(deploymentId)) {
    // Idempotent: re-starting an already-running loop is a no-op rather than
    // an error so HTTP retries don't spawn duplicate tickers.
    return;
  }

  const [row] = await db.select().from(deployments).where(eq(deployments.deploymentId, deploymentId));
  if (!row) {
    throw new Error(`deployment ${deploymentId} not found`);
  }
  if (row.mode !== 'live') {
    throw new Error(`deployment ${deploymentId} is not in live mode (mode=${row.mode})`);
  }
  if (row.status !== 'running') {
    throw new Error(`deployment ${deploymentId} is not running (status=${row.status})`);
  }

  // W9.c — proper cost-aware paper PnL accrual. Replaces the W9.b stub
  // estimatePaperPnlDelta (sign × confidence) with full half-round-trip cost
  // accounting on side flips. Cost model is loaded from data/cost_model.json
  // with MNQ defaults (round_trip $2.80, point_value $2.00).
  const costs = await loadCostModel();
  const accrual = new PaperPnLAccrual(deploymentId, costs.round_trip, costs.point_value);

  const state: LiveLoopState = {
    abort: new AbortController(),
    consecutiveFailures: 0,
    predictionsEmitted: row.predictionsEmitted ?? 0,
    paperPnlTotal: row.paperPnl ?? 0,
    lastPredictionAt: row.lastPredictionAt ?? null,
    accrual,
    lastPrediction: null,
    lastPnlPublishedAt: Date.now(),
  };
  liveLoops.set(deploymentId, state);

  // Publish the started event upfront (publisher persists + fans out).
  await publishDeploymentEvent({
    type: 'deployment.started',
    data: {
      deployment_id: deploymentId,
      version_id: row.versionId,
      mode: row.mode,
      symbol: row.symbol,
      timeframe: row.timeframe,
      started_at: row.startedAt,
    },
  });

  const mlBridge = opts.mlBridge ?? getMLBridgeClient();
  const predictionLog = opts.predictionLog ?? getPredictionLog();
  const interval = opts.pollIntervalMs ?? pollIntervalMs();

  // Detach the tick loop. Errors are caught inside; a stray rejection here
  // would otherwise crash the Node process via UnhandledRejection.
  void runLoop(deploymentId, state, mlBridge, predictionLog, interval).catch((err) => {
    console.error(`[deployments.lifecycle] loop ${deploymentId} crashed:`, err);
  });
}

/** Pause: signal abort + persist 'paused' state + publish event. */
export async function pauseLiveDeployment(deploymentId: number): Promise<void> {
  const state = liveLoops.get(deploymentId);
  if (!state) return;
  state.abort.abort();
  liveLoops.delete(deploymentId);
  await publishDeploymentEvent({
    type: 'deployment.paused',
    data: {
      deployment_id: deploymentId,
      paused_at: new Date().toISOString(),
    },
  });
}

/** Stop: signal abort + publish stopped. */
export async function stopLiveDeployment(deploymentId: number, reason?: string): Promise<void> {
  const state = liveLoops.get(deploymentId);
  if (state) {
    state.abort.abort();
    liveLoops.delete(deploymentId);
  }
  await publishDeploymentEvent({
    type: 'deployment.stopped',
    data: {
      deployment_id: deploymentId,
      stopped_at: new Date().toISOString(),
      reason,
    },
  });
}

// ─── Internal: tick loop ───────────────────────────────────────────────────

async function runLoop(
  deploymentId: number,
  state: LiveLoopState,
  mlBridge: MLBridgeClient,
  predictionLog: PredictionLog,
  intervalMs: number,
): Promise<void> {
  while (!state.abort.signal.aborted) {
    try {
      await tick(deploymentId, state, mlBridge, predictionLog);
      state.consecutiveFailures = 0;
    } catch (err) {
      state.consecutiveFailures += 1;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[deployments.lifecycle] tick failed for deployment ${deploymentId} ` +
          `(${state.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${errMsg}`,
      );

      // Record last_error so the UI surfaces the failure even before circuit-trip.
      try {
        db.update(deployments)
          .set({ lastError: errMsg })
          .where(eq(deployments.deploymentId, deploymentId))
          .execute();
      } catch {
        /* ignore — the loop must keep counting failures */
      }

      if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        await tripCircuitBreaker(deploymentId, errMsg);
        return;
      }
    }

    await sleep(intervalMs, state.abort.signal);
  }
}

async function tick(
  deploymentId: number,
  state: LiveLoopState,
  mlBridge: MLBridgeClient,
  predictionLog: PredictionLog,
): Promise<void> {
  // Reload latest row each tick so external pause/stop transitions take
  // effect at the next iteration (belt-and-suspenders against AbortController
  // being missed — e.g. /pause sets status without aborting).
  const [row] = await db.select().from(deployments).where(eq(deployments.deploymentId, deploymentId));
  if (!row || row.status !== 'running') {
    state.abort.abort();
    return;
  }

  // Pull latest bar features via lake. For W9.b we use OHLC+volume as the
  // simplest feature vector — the model version's feature_pipeline will
  // describe the real engineered set, but plumbing the full feature engine
  // into the tick loop is W9.e. The 5-dim vector is enough to round-trip
  // through MLBridge end-to-end.
  const features = await fetchLatestFeatures(row.symbol, row.timeframe);
  if (!features) {
    // No bars yet — not a failure, just wait for the next tick.
    return;
  }

  const reply = await mlBridge.predict({
    version_id: row.versionId,
    symbol: row.symbol,
    timeframe: row.timeframe,
    features: features.vector,
    ts: features.tsMs,
  });

  const tsIso = new Date(features.tsMs).toISOString();

  // W9.c — proper paper PnL accrual. The accrual class handles:
  //   1. side mapping (string 'long'/'short' OR numeric ±0.5 threshold)
  //   2. confidence floor (< 0.5 → flat / no trade)
  //   3. price-delta × side × point_value bookkeeping
  //   4. half-round-trip cost on every side change
  //   5. first-bar baseline (no trade on bar 0 — establishes lastPrice)
  // The 4th vector element is the bar close — see fetchLatestFeatures()
  // which assembles [open, high, low, close, volume].
  const currentPrice = features.vector[3];
  const { delta: paperPnlDelta, total: paperPnlTotal } = state.accrual.onPrediction(
    reply.prediction,
    reply.confidence,
    currentPrice ?? Number.NaN,
    state.lastPrediction,
  );
  state.lastPrediction = reply.prediction;
  state.paperPnlTotal = paperPnlTotal;
  state.predictionsEmitted += 1;
  state.lastPredictionAt = tsIso;

  // ILP write — Sender batches via auto_flush_rows. Numeric predictions are
  // forwarded as-is; string predictions still write a row but their P&L
  // contribution (computed above) honors the side mapping.
  const predictionNumericForLog =
    typeof reply.prediction === 'number' ? reply.prediction : Number.NaN;
  if (Number.isFinite(predictionNumericForLog)) {
    await predictionLog.write({
      deployment_id: deploymentId,
      prediction: predictionNumericForLog,
      confidence: reply.confidence,
      paper_pnl_delta: paperPnlDelta,
      paper_pnl_total: paperPnlTotal,
      ts: features.tsMs,
    });
  }

  // SQLite — small writes, WAL-buffered, fine to do per tick.
  db.update(deployments)
    .set({
      predictionsEmitted: state.predictionsEmitted,
      paperPnl: paperPnlTotal,
      lastPredictionAt: tsIso,
      lastError: null,
    })
    .where(eq(deployments.deploymentId, deploymentId))
    .execute();

  // SSE + event-store: one prediction event per tick.
  await publishPrediction({
    deployment_id: deploymentId,
    ts: tsIso,
    prediction: reply.prediction,
    confidence: reply.confidence,
    paper_pnl_delta: paperPnlDelta,
    paper_pnl_total: paperPnlTotal,
  });

  // Throttled snapshot — every N predictions OR every M ms. Lets dashboards
  // bind to a low-frequency channel for chart redraws without consuming every
  // per-bar event.
  const now = Date.now();
  if (
    state.predictionsEmitted % PNL_PUBLISH_EVERY_N === 0 ||
    now - state.lastPnlPublishedAt >= PNL_PUBLISH_EVERY_MS
  ) {
    await publishPnlUpdate({
      deployment_id: deploymentId,
      paper_pnl_total: paperPnlTotal,
      predictions_emitted: state.predictionsEmitted,
      last_prediction_at: tsIso,
    });
    state.lastPnlPublishedAt = now;
  }
}

/**
 * Pull the latest closed bar's OHLCV for (symbol, timeframe). Returns null if
 * no bars exist yet (cold-start deployment with no data).
 *
 * Uses queryLakeFast for the HTTP-streaming path — sub-ms even at full
 * table scan because of lake's columnar storage + timestamp DESC index.
 */
async function fetchLatestFeatures(
  symbol: string,
  timeframe: string,
): Promise<{ vector: number[]; tsMs: number } | null> {
  const table = getBaseTableForType(detectInstrumentType(symbol));
  // SAMPLE BY would aggregate; we want the most recent ALREADY-SAMPLED bar
  // for the requested timeframe. The ohlcv tables store raw 1m bars; W9.e
  // wires per-timeframe materialized views. For now we LIMIT 1 at the raw
  // table and treat `timeframe` as a metadata pass-through to MLBridge.
  void timeframe;
  const sql = `SELECT timestamp, open, high, low, close, volume FROM ${table} WHERE symbol = '${escapeSymbol(symbol)}' ORDER BY timestamp DESC LIMIT 1`;
  const rows = await queryLakeFast<{
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>(sql);
  if (!rows.length || !rows[0]) return null;
  const r = rows[0];
  const tsMs = new Date(r.timestamp).getTime();
  if (!Number.isFinite(tsMs)) return null;
  return {
    vector: [Number(r.open), Number(r.high), Number(r.low), Number(r.close), Number(r.volume)],
    tsMs,
  };
}

/** Defang single-quote injection at the SQL layer (lake has no parameterized HTTP /exec). */
function escapeSymbol(s: string): string {
  return s.replace(/'/g, "''");
}

async function tripCircuitBreaker(deploymentId: number, error: string): Promise<void> {
  liveLoops.delete(deploymentId);
  const failedAt = new Date().toISOString();
  try {
    db.update(deployments)
      .set({ status: 'failed', stoppedAt: failedAt, lastError: error })
      .where(eq(deployments.deploymentId, deploymentId))
      .execute();
  } catch (err) {
    console.error(`[deployments.lifecycle] failed to persist failed state for ${deploymentId}:`, err);
  }
  await publishDeploymentEvent({
    type: 'deployment.failed',
    data: {
      deployment_id: deploymentId,
      failed_at: failedAt,
      error,
    },
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ─── Unused-import guard (drizzle eq referenced by ESM tree-shaker only) ───
void modelVersions;



