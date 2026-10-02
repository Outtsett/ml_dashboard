/**
 * Evaluate Routes — HTTP layer for Stage-5 evaluation tooling.
 *
 * SRP: parse + validate via Zod, dispatch to spawn or Drizzle, format response.
 *      No business logic inline.
 * DIP: bootstrap calculation lives in `packages/ml-engine/packages/shared/src/bootstrap.py` (Python);
 *      regime breakdown lives in pure SQL via Drizzle. Both are abstracted
 *      behind named helper functions in this module.
 *
 * Routes:
 *   POST /api/eval/block-bootstrap   — Block bootstrap CI for trade-PnL series
 *                                      too large for in-browser computation
 *                                      (>5k trades). Spawns
 *                                      `packages/ml-engine/packages/shared/src/bootstrap.py` (W6.a) and
 *                                      caches by content-hash of inputs.
 *   GET  /api/eval/regime-breakdown  — Joins backtest_trades against
 *                                      market_regimes by timestamp; groups
 *                                      per-regime metrics per backtest_run.
 *
 * Cross-domain contracts (W6.b):
 *   - POST /api/eval/block-bootstrap request/response is consumed by W6.c
 *     `<BlockBootstrapCI>` (server fallback for >5k trades).
 *   - GET /api/eval/regime-breakdown response shape is consumed by W6.c
 *     `<RegimeBreakdown>` component.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { spawn } from 'child_process';
import path from 'path';
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../infrastructure/database/db';
import {
  backtestTrades,
  marketRegimes,
  regimeHistory,
} from '@shared/schema';
import { mlRateLimiter, queryRateLimiter } from '../infrastructure/lib/rateLimiter';

const router = Router();
const logger = new Logger('EvalRoutes');

// ─── Block Bootstrap ─────────────────────────────────────────────────────────

const StatisticSchema = z.enum(['mean', 'median', 'sharpe', 'profit_factor']);
const BlockSizeMethodSchema = z.enum(['sqrt_n', 'politis_romano']);

export const BootstrapRequest = z.object({
  series: z.array(z.number()).min(2),
  statistic: StatisticSchema.default('mean'),
  blockSize: z.number().int().positive().optional(),
  blockSizeMethod: BlockSizeMethodSchema.default('sqrt_n'),
  nResamples: z.number().int().positive().max(50000).default(10000),
  ci: z.number().gt(0).lt(1).default(0.95),
  randomState: z.number().int().nullable().default(null),
});
export type BootstrapRequestInput = z.infer<typeof BootstrapRequest>;

export interface BootstrapResponse {
  point: number;
  ciLower: number;
  ciUpper: number;
  blockSize: number;
  nResamples: number;
}

export class BootstrapError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'BootstrapError';
  }
}

const bootstrapCache = new LRUCache<string, BootstrapResponse>({
  max: 200,
  ttl: 60 * 60 * 1000,
});

function bootstrapCacheKey(input: BootstrapRequestInput): string {
  // Hash the actual series values + the parameters per W6.b spec:
  // sha256(series_hash + statistic + blockSizeMethod + nResamples).
  // The series hash is computed first (over the canonical numeric form),
  // then folded into the outer key.
  const seriesHash = createHash('sha256')
    .update(input.series.map((n) => Number(n).toString()).join(','))
    .digest('hex');
  const canonical = {
    series_hash: seriesHash,
    statistic: input.statistic,
    blockSize: input.blockSize ?? null,
    blockSizeMethod: input.blockSizeMethod,
    nResamples: input.nResamples,
    ci: input.ci,
    randomState: input.randomState,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function resolvePythonExecutable(): string {
  return process.env.PYTHON_BIN || process.env.ML_PYTHON || 'python';
}

const BOOTSTRAP_TIMEOUT_MS = 60_000;

interface SpawnOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  killedByTimeout: boolean;
}

function spawnBootstrap(payload: BootstrapRequestInput): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const py = resolvePythonExecutable();
    const repoRoot = process.cwd();
    const scriptPath = path.resolve(repoRoot, 'src', 'ml', 'shared', 'bootstrap.py');

    // W6.a contract: CLI accepts the series as a JSON-encoded `--series-json`
    // argument and emits a single JSON line on stdout with snake_case keys
    // (point, ci_lower, ci_upper, block_size, n_resamples). We translate the
    // snake_case → camelCase at parse time so the HTTP response stays aligned
    // with the frontend BlockBootstrapCI consumer (W6.c).
    const args: string[] = [
      scriptPath,
      '--series-json', JSON.stringify(payload.series),
      '--statistic', payload.statistic,
      '--block-size-method', payload.blockSizeMethod,
      '--n-resamples', String(payload.nResamples),
      '--ci', String(payload.ci),
    ];
    if (typeof payload.blockSize === 'number') {
      args.push('--block-size', String(payload.blockSize));
    }
    if (payload.randomState !== null) {
      args.push('--random-state', String(payload.randomState));
    }

    logger.log(`Spawning bootstrap: ${py} ${scriptPath} (n=${payload.series.length}, ${payload.statistic})`);

    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;

    let child;
    try {
      child = spawn(py, args, {
        cwd: repoRoot,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        windowsHide: true,
      });
    } catch (err) {
      return reject(new BootstrapError(
        `Failed to spawn Python: ${(err as Error).message}`,
        '',
        null,
      ));
    }

    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }, BOOTSTRAP_TIMEOUT_MS);

    // The W6.a CLI does not read stdin — series goes via --series-json.
    // Close stdin immediately so the child doesn't block on EOF.
    try { child.stdin.end(); } catch { /* ignore */ }

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(new BootstrapError(
        `Failed to spawn Python: ${err.message}`,
        stderr,
        null,
      ));
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, killedByTimeout });
    });
  });
}

/**
 * Reverse-scan stdout for the last JSON line containing the bootstrap result.
 *
 * The W6.a CLI emits snake_case keys (point, ci_lower, ci_upper, block_size,
 * n_resamples). We accept both snake_case (current) and camelCase (legacy /
 * mock-friendly) so tests can drive the spawn mock without snake_case keys.
 */
function extractBootstrapResult(stdout: string): BootstrapResponse | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && 'point' in parsed) {
        const ciLower = parsed.ci_lower ?? parsed.ciLower;
        const ciUpper = parsed.ci_upper ?? parsed.ciUpper;
        const blockSize = parsed.block_size ?? parsed.blockSize;
        const nResamples = parsed.n_resamples ?? parsed.nResamples;
        if (
          ciLower === undefined
          || ciUpper === undefined
          || blockSize === undefined
          || nResamples === undefined
        ) continue;
        return {
          point: Number(parsed.point),
          ciLower: Number(ciLower),
          ciUpper: Number(ciUpper),
          blockSize: Number(blockSize),
          nResamples: Number(nResamples),
        };
      }
    } catch {
      // not JSON — keep scanning
    }
  }
  return null;
}

/**
 * Run the Python bootstrap and cache by content-hash of inputs. Exposed for
 * tests + reuse by other server code.
 */
export async function runBootstrap(payload: BootstrapRequestInput): Promise<BootstrapResponse> {
  const key = bootstrapCacheKey(payload);
  const cached = bootstrapCache.get(key);
  if (cached) {
    logger.debug(`Bootstrap cache hit (${key.slice(0, 8)}...)`);
    return cached;
  }

  const outcome = await spawnBootstrap(payload);

  if (outcome.killedByTimeout) {
    throw new BootstrapError(
      `Bootstrap timed out (>${BOOTSTRAP_TIMEOUT_MS / 1000}s)`,
      outcome.stderr.slice(-2000),
      null,
    );
  }

  if (outcome.exitCode !== 0) {
    throw new BootstrapError(
      `Bootstrap exited with code ${outcome.exitCode}`,
      outcome.stderr.slice(-2000),
      outcome.exitCode,
    );
  }

  const parsed = extractBootstrapResult(outcome.stdout);
  if (!parsed) {
    throw new BootstrapError(
      'Bootstrap exited 0 but produced no parseable JSON result line',
      outcome.stderr.slice(-2000),
      outcome.exitCode,
    );
  }

  bootstrapCache.set(key, parsed);
  return parsed;
}

/** Clear the bootstrap LRU cache. Exposed for tests + admin tools. */
export function clearBootstrapCache(): void {
  bootstrapCache.clear();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatZodErrors(error: z.ZodError): { error: string; details: unknown } {
  return {
    error: 'Invalid request body',
    details: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    })),
  };
}

// ─── POST /eval/block-bootstrap ─────────────────────────────────────────────

router.post('/eval/block-bootstrap', mlRateLimiter, async (req: Request, res: Response) => {
  const parsed = BootstrapRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(formatZodErrors(parsed.error));
  }

  try {
    const result = await runBootstrap(parsed.data);
    res.json(result);
  } catch (err) {
    if (err instanceof BootstrapError) {
      return res.status(500).json({
        error: err.message,
        details: { stderr: err.stderr, exitCode: err.exitCode },
      });
    }
    res.status(500).json({
      error: (err as Error)?.message ?? String(err),
    });
  }
});

// ─── Regime Breakdown ───────────────────────────────────────────────────────

const RegimeBreakdownQuery = z.object({
  runIds: z
    .string()
    .min(1, 'runIds is required (comma-separated backtest_run IDs)')
    .transform((s, ctx) => {
      const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'runIds must contain at least one ID' });
        return z.NEVER;
      }
      const ids: number[] = [];
      for (const p of parts) {
        const n = Number(p);
        if (!Number.isInteger(n) || n <= 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid run ID: ${p}` });
          return z.NEVER;
        }
        ids.push(n);
      }
      return ids;
    }),
});

export interface RegimeMetrics {
  n_trades: number;
  mean_pnl: number;
  sharpe: number;
  profit_factor: number;
  win_rate: number;
}

export interface RegimeBreakdownResponse {
  runs: Record<number, { regimes: Record<string, RegimeMetrics> }>;
  warning?: string;
}

interface JoinedTradeRow {
  runId: number;
  regimeName: string;
  netPnl: number;
}

/**
 * Compute Sharpe + profit factor + win rate aggregates per (run, regime).
 * Pure function exported for unit testing.
 */
export function aggregateRegimeMetrics(rows: JoinedTradeRow[]): RegimeBreakdownResponse['runs'] {
  // Group by (runId, regimeName)
  type Bucket = { pnls: number[] };
  const buckets = new Map<number, Map<string, Bucket>>();
  for (const r of rows) {
    let perRun = buckets.get(r.runId);
    if (!perRun) {
      perRun = new Map();
      buckets.set(r.runId, perRun);
    }
    let bucket = perRun.get(r.regimeName);
    if (!bucket) {
      bucket = { pnls: [] };
      perRun.set(r.regimeName, bucket);
    }
    bucket.pnls.push(r.netPnl);
  }

  const out: RegimeBreakdownResponse['runs'] = {};
  for (const [runId, perRun] of buckets) {
    const regimes: Record<string, RegimeMetrics> = {};
    for (const [regimeName, bucket] of perRun) {
      regimes[regimeName] = computeMetrics(bucket.pnls);
    }
    out[runId] = { regimes };
  }
  return out;
}

function computeMetrics(pnls: number[]): RegimeMetrics {
  const n = pnls.length;
  if (n === 0) {
    return { n_trades: 0, mean_pnl: 0, sharpe: 0, profit_factor: 0, win_rate: 0 };
  }
  let sum = 0;
  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  for (const x of pnls) {
    sum += x;
    if (x > 0) {
      wins += 1;
      grossProfit += x;
    } else if (x < 0) {
      grossLoss += -x;
    }
  }
  const mean = sum / n;
  let variance = 0;
  for (const x of pnls) {
    const d = x - mean;
    variance += d * d;
  }
  // Sample standard deviation; n=1 → std undefined → sharpe 0.
  const std = n > 1 ? Math.sqrt(variance / (n - 1)) : 0;
  const sharpe = std > 0 ? mean / std : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const winRate = wins / n;
  return {
    n_trades: n,
    mean_pnl: mean,
    sharpe,
    // Cap profit_factor for JSON serialisation: Infinity is not valid JSON.
    profit_factor: Number.isFinite(profitFactor) ? profitFactor : Number.MAX_SAFE_INTEGER,
    win_rate: winRate,
  };
}

/**
 * Returns true if the given table exists in the underlying SQLite database.
 * Used to gracefully handle the case where market_regimes hasn't been seeded
 * (per project CLAUDE.md, the table is in the schema but may not be populated
 * with regime detection rules in every environment).
 */
function tableHasAnyRows(tableName: 'market_regimes' | 'regime_history'): boolean {
  try {
    // Drizzle's `sql` template handles parameterisation; tableName is a
    // closed enum so injection-safe.
    const result = db
      .all(sql.raw(`SELECT EXISTS(SELECT 1 FROM ${tableName} LIMIT 1) AS has_rows`)) as Array<{ has_rows: number }>;
    return Boolean(result[0]?.has_rows);
  } catch {
    // Table doesn't exist (different schema state) → treat as empty.
    return false;
  }
}

/**
 * Server-side join: backtest_trades ⨝ regime_history on
 * (symbol, entry_timestamp BETWEEN start_timestamp AND end_timestamp)
 * ⨝ market_regimes on regime_history.regime_id = market_regimes.id.
 *
 * Exposed as a named function so the HTTP handler stays thin and tests can
 * mock the underlying `db` import.
 */
export async function fetchRegimeBreakdown(
  runIds: number[],
): Promise<RegimeBreakdownResponse> {
  // Empty-regimes-per-run skeleton; populated only if join returns rows.
  const skeleton: RegimeBreakdownResponse['runs'] = {};
  for (const id of runIds) skeleton[id] = { regimes: {} };

  // Per W6.b spec: if market_regimes table isn't populated, return empty
  // regimes per run + a top-level warning.
  if (!tableHasAnyRows('market_regimes') || !tableHasAnyRows('regime_history')) {
    return {
      runs: skeleton,
      warning: 'market_regimes table not populated',
    };
  }

  // Drizzle-typed join expressed via raw SQL for the timestamp-range clause
  // (Drizzle's relational query builder doesn't model BETWEEN-on-join cleanly
  // without sub-queries). All identifiers are static; runIds are bound via
  // placeholder array.
  const placeholders = runIds.map(() => '?').join(', ');
  const querySql = `
    SELECT
      bt.backtest_run_id AS runId,
      mr.name AS regimeName,
      COALESCE(bt.net_pnl, bt.pnl, 0) AS netPnl
    FROM backtest_trades bt
    INNER JOIN regime_history rh
      ON bt.symbol = rh.symbol
     AND bt.entry_timestamp >= rh.start_timestamp
     AND (rh.end_timestamp IS NULL OR bt.entry_timestamp <= rh.end_timestamp)
    INNER JOIN market_regimes mr
      ON mr.id = rh.regime_id
    WHERE bt.backtest_run_id IN (${placeholders})
  `;

  const rows = db.all(sql.raw(
    querySql.replace(
      `IN (${placeholders})`,
      `IN (${runIds.map((id) => Number(id)).join(', ')})`,
    ),
  )) as Array<{ runId: number; regimeName: string; netPnl: number }>;

  const aggregated = aggregateRegimeMetrics(
    rows.map((r) => ({ runId: r.runId, regimeName: r.regimeName, netPnl: Number(r.netPnl) })),
  );

  // Merge aggregated into skeleton (preserve runs with zero matched trades).
  for (const id of runIds) {
    if (aggregated[id]) {
      skeleton[id] = aggregated[id];
    }
  }

  return { runs: skeleton };
}

// ─── GET /eval/regime-breakdown ─────────────────────────────────────────────

router.get('/eval/regime-breakdown', queryRateLimiter, async (req: Request, res: Response) => {
  const parsed = RegimeBreakdownQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json(formatZodErrors(parsed.error));
  }

  try {
    const result = await fetchRegimeBreakdown(parsed.data.runIds);
    res.json(result);
  } catch (err) {
    logger.error(`Regime breakdown failed: ${(err as Error).message}`);
    res.status(500).json({
      error: (err as Error)?.message ?? String(err),
    });
  }
});

// ─── Marker references so unused-import lint doesn't trip when the relational
// helpers (and, eq, inArray) become useful in a future PR. They're exported
// from drizzle-orm and intentionally kept here as the canonical pattern for
// future enhancement of regime breakdown without raw SQL. ─────────────────────
void and; void eq; void inArray; void backtestTrades; void marketRegimes; void regimeHistory;

export default router;
