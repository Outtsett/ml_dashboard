/// <reference lib="webworker" />
/**
 * Block-bootstrap Web Worker — in-browser CI95 estimator for ≤5k trade returns.
 *
 * Mirrors the server response shape `{ point, ciLower, ciUpper, blockSize,
 * nResamples }` so callers don't need to branch on transport. Larger
 * datasets are routed to `POST /api/eval/block-bootstrap` server-side.
 *
 * Algorithm:
 *   1. Bootstrap a moving-block sample of length matching the source.
 *   2. Compute the requested statistic on each resample.
 *   3. Return point estimate + 2.5 / 97.5 percentiles + diagnostics.
 *
 * Per the W6.c spec: keep the worker output compatible with the server route,
 * so the `BlockBootstrapCI` consumer renders without needing transport-aware
 * branches.
 */

export type BootstrapStatistic = "mean" | "sharpe" | "profitFactor" | "winRate";

export interface BootstrapRequest {
  /** Stable id echoed back in the response for request/response matching. */
  id: string;
  /** Per-trade returns (preferred) — used for mean / sharpe / winRate. */
  returns: number[];
  /** Optional per-trade PnL when computing profit factor. */
  pnl?: number[];
  statistic: BootstrapStatistic;
  /** Resample count — defaults to 2000 in line with the server route. */
  nResamples?: number;
  /** Moving block length; defaults to ceil(n^(1/3)). */
  blockSize?: number;
  /** RNG seed — deterministic when supplied. */
  seed?: number;
}

export interface BootstrapResponse {
  id: string;
  statistic: BootstrapStatistic;
  point: number;
  ciLower: number;
  ciUpper: number;
  blockSize: number;
  nResamples: number;
  source: "worker";
}

export interface BootstrapErrorResponse {
  id: string;
  error: string;
  source: "worker";
}

// ─── Mulberry32 — small deterministic PRNG (avoids Math.random for reproducibility)

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Statistics ──────────────────────────────────────────────────────────────

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < xs.length; i += 1) sum += xs[i]!;
  return sum / xs.length;
}

function stdev(xs: readonly number[], avg?: number): number {
  if (xs.length < 2) return 0;
  const m = avg ?? mean(xs);
  let v = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const d = xs[i]! - m;
    v += d * d;
  }
  return Math.sqrt(v / (xs.length - 1));
}

function sharpe(xs: readonly number[]): number {
  const m = mean(xs);
  const s = stdev(xs, m);
  return s === 0 ? 0 : (m / s) * Math.sqrt(252);
}

function winRate(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let wins = 0;
  for (let i = 0; i < xs.length; i += 1) if (xs[i]! > 0) wins += 1;
  return wins / xs.length;
}

function profitFactor(pnl: readonly number[]): number {
  let gains = 0;
  let losses = 0;
  for (let i = 0; i < pnl.length; i += 1) {
    const v = pnl[i]!;
    if (v > 0) gains += v;
    else losses -= v;
  }
  if (losses === 0) return gains > 0 ? Infinity : 0;
  return gains / losses;
}

function computeStat(stat: BootstrapStatistic, returns: readonly number[], pnl?: readonly number[]): number {
  switch (stat) {
    case "mean":
      return mean(returns);
    case "sharpe":
      return sharpe(returns);
    case "winRate":
      return winRate(returns);
    case "profitFactor":
      return profitFactor(pnl ?? returns);
  }
}

// ─── Block-bootstrap resample ────────────────────────────────────────────────

function movingBlockResample(
  source: readonly number[],
  blockSize: number,
  rng: () => number,
): number[] {
  const n = source.length;
  const out = new Array<number>(n);
  let i = 0;
  while (i < n) {
    const start = Math.floor(rng() * (n - blockSize + 1));
    const end = Math.min(start + blockSize, n);
    for (let j = start; j < end && i < n; j += 1, i += 1) {
      out[i] = source[j]!;
    }
  }
  return out;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function runBootstrap(req: BootstrapRequest): BootstrapResponse {
  const returns = req.returns;
  if (!Array.isArray(returns) || returns.length === 0) {
    throw new Error("returns array is empty");
  }
  const nResamples = req.nResamples ?? 2000;
  const blockSize = Math.max(
    1,
    Math.min(returns.length, req.blockSize ?? Math.ceil(Math.cbrt(returns.length))),
  );
  const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = mulberry32(seed);

  const point = computeStat(req.statistic, returns, req.pnl);
  const samples = new Array<number>(nResamples);

  if (req.statistic === "profitFactor" && req.pnl && req.pnl.length === returns.length) {
    // Resample paired (return, pnl) blocks together so PnL stays aligned.
    const n = returns.length;
    for (let r = 0; r < nResamples; r += 1) {
      const resampledRet = new Array<number>(n);
      const resampledPnl = new Array<number>(n);
      let i = 0;
      while (i < n) {
        const start = Math.floor(rng() * (n - blockSize + 1));
        const end = Math.min(start + blockSize, n);
        for (let j = start; j < end && i < n; j += 1, i += 1) {
          resampledRet[i] = returns[j]!;
          resampledPnl[i] = req.pnl[j]!;
        }
      }
      samples[r] = computeStat(req.statistic, resampledRet, resampledPnl);
    }
  } else {
    for (let r = 0; r < nResamples; r += 1) {
      const resample = movingBlockResample(returns, blockSize, rng);
      samples[r] = computeStat(req.statistic, resample);
    }
  }

  const sorted = samples.slice().sort((a, b) => a - b);
  return {
    id: req.id,
    statistic: req.statistic,
    point,
    ciLower: percentile(sorted, 0.025),
    ciUpper: percentile(sorted, 0.975),
    blockSize,
    nResamples,
    source: "worker",
  };
}

// ─── Worker message bridge ───────────────────────────────────────────────────
// Guarded so the file remains importable from non-worker contexts (tests, SSR).

declare const self: DedicatedWorkerGlobalScope | undefined;

if (typeof self !== "undefined" && typeof (self as DedicatedWorkerGlobalScope).postMessage === "function") {
  const ctx = self as DedicatedWorkerGlobalScope;
  ctx.onmessage = (event: MessageEvent<BootstrapRequest>) => {
    const req = event.data;
    try {
      const result = runBootstrap(req);
      ctx.postMessage(result);
    } catch (err) {
      const payload: BootstrapErrorResponse = {
        id: req?.id ?? "unknown",
        error: err instanceof Error ? err.message : String(err),
        source: "worker",
      };
      ctx.postMessage(payload);
    }
  };
}
