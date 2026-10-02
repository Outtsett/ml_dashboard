/**
 * apps/api/tests/eval.test.ts
 *
 * W6.b coverage:
 *   - BootstrapRequest Zod validation (defaults, bounds, statistic enum)
 *   - bootstrap content-hash cache (same series + params → cached result)
 *   - bootstrap spawn handshake (mocked child_process.spawn)
 *   - aggregateRegimeMetrics pure-function (Sharpe, profit factor, win rate)
 *   - fetchRegimeBreakdown empty-table fallback (warning + skeleton)
 *
 * Strategy: mock `child_process.spawn` so the bootstrap path doesn't shell out
 * to the still-unbuilt `packages/ml-engine/packages/shared/src/bootstrap.py` (W6.a). Mock the Drizzle
 * `db` import for the regime-breakdown path so we don't need a populated
 * SQLite fixture for the tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// ── Mock child_process BEFORE importing the route module ────────────────────
type SpawnMockHandler = (args: string[], stdinPayload: string) => {
  stdout: string;
  stderr?: string;
  exitCode?: number | null;
  error?: Error;
};

let spawnHandler: SpawnMockHandler = () => ({ stdout: '', exitCode: 0 });
const spawnCalls: Array<{ command: string; args: string[]; stdin: string }> = [];

vi.mock('child_process', () => {
  return {
    spawn: vi.fn((command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { write: (data: string) => void; end: () => void };
        kill: (sig?: string) => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      let stdinBuffer = '';
      child.stdin = {
        write: (data: string) => { stdinBuffer += data; },
        end: () => {
          // Flush after end() so the route module has had time to attach
          // its 'data' / 'close' listeners.
          queueMicrotask(() => {
            spawnCalls.push({ command, args, stdin: stdinBuffer });
            const result = spawnHandler(args, stdinBuffer);
            if (result.error) {
              child.emit('error', result.error);
              return;
            }
            if (result.stdout) child.stdout.emit('data', Buffer.from(result.stdout, 'utf8'));
            if (result.stderr) child.stderr.emit('data', Buffer.from(result.stderr, 'utf8'));
            child.emit('close', result.exitCode ?? 0);
          });
        },
      };
      child.kill = () => { /* no-op for tests */ };
      return child;
    }),
  };
});

// ── Mock the database module so fetchRegimeBreakdown's `db.all()` is steerable ─
type DbAllResult = unknown[];
let dbAllImpl: (rawSql: { sql?: string; queryChunks?: unknown[] } | string) => DbAllResult = () => [];
vi.mock('../infrastructure/database/db', () => ({
  db: {
    all: vi.fn((q: unknown) => dbAllImpl(q as never)),
  },
  dbReadOnly: { all: vi.fn(() => []) },
}));

// ── Now import the route module (after mocks are registered) ────────────────
import {
  BootstrapRequest,
  runBootstrap,
  clearBootstrapCache,
  aggregateRegimeMetrics,
  fetchRegimeBreakdown,
  type BootstrapRequestInput,
} from '../ml/eval.router';

// ── BootstrapRequest Zod validation ─────────────────────────────────────────
describe('BootstrapRequest schema', () => {
  it('applies defaults for statistic, blockSizeMethod, nResamples, ci, randomState', () => {
    const r = BootstrapRequest.parse({ series: [0.1, -0.05, 0.2] });
    expect(r.statistic).toBe('mean');
    expect(r.blockSizeMethod).toBe('sqrt_n');
    expect(r.nResamples).toBe(10000);
    expect(r.ci).toBe(0.95);
    expect(r.randomState).toBeNull();
    expect(r.blockSize).toBeUndefined();
  });

  it('rejects series with fewer than 2 elements', () => {
    expect(BootstrapRequest.safeParse({ series: [1] }).success).toBe(false);
    expect(BootstrapRequest.safeParse({ series: [] }).success).toBe(false);
  });

  it('rejects nResamples > 50000', () => {
    expect(
      BootstrapRequest.safeParse({ series: [1, 2], nResamples: 50001 }).success,
    ).toBe(false);
  });

  it('rejects ci outside (0, 1)', () => {
    expect(BootstrapRequest.safeParse({ series: [1, 2], ci: 0 }).success).toBe(false);
    expect(BootstrapRequest.safeParse({ series: [1, 2], ci: 1 }).success).toBe(false);
    expect(BootstrapRequest.safeParse({ series: [1, 2], ci: 1.1 }).success).toBe(false);
    expect(BootstrapRequest.safeParse({ series: [1, 2], ci: 0.99 }).success).toBe(true);
  });

  it('rejects unknown statistic', () => {
    expect(
      BootstrapRequest.safeParse({ series: [1, 2], statistic: 'std' }).success,
    ).toBe(false);
  });
});

// ── runBootstrap spawn + cache ──────────────────────────────────────────────
describe('runBootstrap', () => {
  beforeEach(() => {
    clearBootstrapCache();
    spawnCalls.length = 0;
    spawnHandler = () => ({
      stdout: JSON.stringify({
        point: 0.05,
        ciLower: -0.02,
        ciUpper: 0.12,
        blockSize: 4,
        nResamples: 1000,
      }) + '\n',
      exitCode: 0,
    });
  });

  it('parses the JSON result line returned on stdout', async () => {
    const payload: BootstrapRequestInput = {
      series: [0.1, -0.05, 0.2, 0.15, -0.1, 0.08, -0.02, 0.12],
      statistic: 'mean',
      blockSizeMethod: 'sqrt_n',
      nResamples: 1000,
      ci: 0.95,
      randomState: null,
    };
    const result = await runBootstrap(payload);
    expect(result.point).toBeCloseTo(0.05);
    expect(result.ciLower).toBeCloseTo(-0.02);
    expect(result.ciUpper).toBeCloseTo(0.12);
    expect(result.blockSize).toBe(4);
    expect(result.nResamples).toBe(1000);
  });

  it('passes the series + params via --series-json + named CLI flags (W6.a contract)', async () => {
    const payload: BootstrapRequestInput = {
      series: [0.1, -0.05, 0.2, 0.15],
      statistic: 'sharpe',
      blockSizeMethod: 'politis_romano',
      nResamples: 5000,
      ci: 0.9,
      randomState: 42,
    };
    await runBootstrap(payload);
    expect(spawnCalls.length).toBe(1);
    const call = spawnCalls[0]!;
    // Series rides on --series-json; W6.a CLI does not read stdin.
    const seriesIdx = call.args.indexOf('--series-json');
    expect(seriesIdx).toBeGreaterThanOrEqual(0);
    const seriesArg = call.args[seriesIdx + 1]!;
    expect(JSON.parse(seriesArg)).toEqual(payload.series);
    // CLI flags reflect the parameters
    expect(call.args).toContain('--statistic');
    expect(call.args).toContain('sharpe');
    expect(call.args).toContain('--block-size-method');
    expect(call.args).toContain('politis_romano');
    expect(call.args).toContain('--n-resamples');
    expect(call.args).toContain('5000');
    expect(call.args).toContain('--ci');
    expect(call.args).toContain('0.9');
    expect(call.args).toContain('--random-state');
    expect(call.args).toContain('42');
  });

  it('parses snake_case keys from the W6.a CLI output', async () => {
    spawnHandler = () => ({
      stdout: JSON.stringify({
        point: 0.07,
        ci_lower: -0.01,
        ci_upper: 0.15,
        block_size: 3,
        n_resamples: 2000,
      }) + '\n',
      exitCode: 0,
    });
    const result = await runBootstrap({
      series: [0.05, 0.1, -0.02, 0.08, 0.12, -0.04, 0.06, 0.09],
      statistic: 'mean',
      blockSizeMethod: 'sqrt_n',
      nResamples: 2000,
      ci: 0.95,
      randomState: null,
    });
    expect(result.point).toBeCloseTo(0.07);
    expect(result.ciLower).toBeCloseTo(-0.01);
    expect(result.ciUpper).toBeCloseTo(0.15);
    expect(result.blockSize).toBe(3);
    expect(result.nResamples).toBe(2000);
  });

  it('caches by content-hash of series + params (second call no spawn)', async () => {
    const payload: BootstrapRequestInput = {
      series: [0.1, -0.05, 0.2, 0.15],
      statistic: 'mean',
      blockSizeMethod: 'sqrt_n',
      nResamples: 1000,
      ci: 0.95,
      randomState: null,
    };
    await runBootstrap(payload);
    expect(spawnCalls.length).toBe(1);
    await runBootstrap({ ...payload });
    expect(spawnCalls.length).toBe(1); // still 1 — cached
  });

  it('changing nResamples invalidates cache', async () => {
    const base: BootstrapRequestInput = {
      series: [0.1, -0.05, 0.2, 0.15],
      statistic: 'mean',
      blockSizeMethod: 'sqrt_n',
      nResamples: 1000,
      ci: 0.95,
      randomState: null,
    };
    await runBootstrap(base);
    await runBootstrap({ ...base, nResamples: 5000 });
    expect(spawnCalls.length).toBe(2);
  });

  it('changing series invalidates cache (series_hash differs)', async () => {
    const a: BootstrapRequestInput = {
      series: [0.1, 0.2, 0.3],
      statistic: 'mean',
      blockSizeMethod: 'sqrt_n',
      nResamples: 1000,
      ci: 0.95,
      randomState: null,
    };
    await runBootstrap(a);
    await runBootstrap({ ...a, series: [0.1, 0.2, 0.4] });
    expect(spawnCalls.length).toBe(2);
  });

  it('throws BootstrapError on non-zero exit', async () => {
    spawnHandler = () => ({
      stdout: '',
      stderr: 'numpy import failed',
      exitCode: 1,
    });
    await expect(runBootstrap({
      series: [1, 2, 3, 4],
      statistic: 'mean',
      blockSizeMethod: 'sqrt_n',
      nResamples: 1000,
      ci: 0.95,
      randomState: null,
    })).rejects.toMatchObject({
      name: 'BootstrapError',
      stderr: expect.stringContaining('numpy import failed'),
    });
  });

  it('throws BootstrapError when stdout has no parseable result line', async () => {
    spawnHandler = () => ({ stdout: 'plain log line\nanother log\n', exitCode: 0 });
    await expect(runBootstrap({
      series: [1, 2, 3, 4],
      statistic: 'mean',
      blockSizeMethod: 'sqrt_n',
      nResamples: 1000,
      ci: 0.95,
      randomState: null,
    })).rejects.toMatchObject({
      name: 'BootstrapError',
      message: expect.stringContaining('no parseable JSON result line'),
    });
  });
});

// ── aggregateRegimeMetrics pure function ───────────────────────────────────
describe('aggregateRegimeMetrics', () => {
  it('groups by (runId, regimeName) and computes win_rate, sharpe, profit_factor', () => {
    const rows = [
      { runId: 1, regimeName: 'trend_up', netPnl: 10 },
      { runId: 1, regimeName: 'trend_up', netPnl: -5 },
      { runId: 1, regimeName: 'trend_up', netPnl: 20 },
      { runId: 1, regimeName: 'chop', netPnl: -3 },
      { runId: 1, regimeName: 'chop', netPnl: 1 },
      { runId: 2, regimeName: 'trend_up', netPnl: 7 },
      { runId: 2, regimeName: 'trend_up', netPnl: 3 },
    ];
    const out = aggregateRegimeMetrics(rows);
    expect(out[1]!.regimes['trend_up']!.n_trades).toBe(3);
    expect(out[1]!.regimes['trend_up']!.mean_pnl).toBeCloseTo((10 - 5 + 20) / 3, 6);
    expect(out[1]!.regimes['trend_up']!.win_rate).toBeCloseTo(2 / 3, 6);
    // grossProfit = 30, grossLoss = 5 → PF = 6
    expect(out[1]!.regimes['trend_up']!.profit_factor).toBeCloseTo(6, 6);
    expect(out[1]!.regimes['chop']!.n_trades).toBe(2);
    expect(out[2]!.regimes['trend_up']!.n_trades).toBe(2);
  });

  it('returns 0 sharpe when n=1 (std undefined)', () => {
    const rows = [{ runId: 1, regimeName: 'r', netPnl: 5 }];
    const out = aggregateRegimeMetrics(rows);
    expect(out[1]!.regimes['r']!.sharpe).toBe(0);
    expect(out[1]!.regimes['r']!.win_rate).toBe(1);
  });

  it('returns 0 profit_factor when no trades', () => {
    const out = aggregateRegimeMetrics([]);
    expect(Object.keys(out)).toHaveLength(0);
  });

  it('clamps profit_factor to MAX_SAFE_INTEGER when grossLoss is 0 but grossProfit > 0', () => {
    const rows = [
      { runId: 1, regimeName: 'r', netPnl: 5 },
      { runId: 1, regimeName: 'r', netPnl: 3 },
    ];
    const out = aggregateRegimeMetrics(rows);
    expect(out[1]!.regimes['r']!.profit_factor).toBe(Number.MAX_SAFE_INTEGER);
  });
});

// ── fetchRegimeBreakdown empty-table fallback ──────────────────────────────
describe('fetchRegimeBreakdown', () => {
  beforeEach(() => {
    dbAllImpl = () => [];
  });

  it('returns warning + empty regimes per run when market_regimes is empty', async () => {
    // db.all returns [] for the EXISTS probe → tableHasAnyRows returns false.
    dbAllImpl = () => [{ has_rows: 0 }];
    const result = await fetchRegimeBreakdown([1, 2, 3]);
    expect(result.warning).toBe('market_regimes table not populated');
    expect(result.runs[1]).toEqual({ regimes: {} });
    expect(result.runs[2]).toEqual({ regimes: {} });
    expect(result.runs[3]).toEqual({ regimes: {} });
  });

  it('returns warning when the EXISTS probe throws (table missing)', async () => {
    dbAllImpl = () => { throw new Error('no such table: market_regimes'); };
    const result = await fetchRegimeBreakdown([1]);
    expect(result.warning).toBe('market_regimes table not populated');
    expect(result.runs[1]).toEqual({ regimes: {} });
  });

  it('aggregates regime metrics when both probe and join return rows', async () => {
    let callIdx = 0;
    dbAllImpl = () => {
      callIdx += 1;
      if (callIdx <= 2) return [{ has_rows: 1 }]; // both EXISTS probes succeed
      // Third call is the actual join.
      return [
        { runId: 1, regimeName: 'trend_up', netPnl: 10 },
        { runId: 1, regimeName: 'trend_up', netPnl: -5 },
        { runId: 1, regimeName: 'chop', netPnl: 2 },
      ];
    };
    const result = await fetchRegimeBreakdown([1, 2]);
    expect(result.warning).toBeUndefined();
    expect(result.runs[1]!.regimes['trend_up']!.n_trades).toBe(2);
    expect(result.runs[1]!.regimes['chop']!.n_trades).toBe(1);
    // Run 2 had no matched trades → empty regimes object preserved.
    expect(result.runs[2]).toEqual({ regimes: {} });
  });
});
