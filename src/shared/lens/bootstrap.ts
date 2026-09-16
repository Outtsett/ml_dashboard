/**
 * Moving-block bootstrap over an ordered sample, with a seeded generator.
 *
 * Trades are not independent draws: they arrive in a sequence whose good and
 * bad stretches cluster, so resampling one trade at a time would understate the
 * interval. A moving block of length ceil(n ** (1/3)) keeps neighbouring trades
 * together, which is the standard choice for a stationary series.
 *
 * The generator is seeded with a fixed constant, so the same sample always
 * produces the same interval — the dashboard never shows a different CI for the
 * same controls.
 */

export const BOOTSTRAP_RESAMPLE_COUNT = 1000;
export const BOOTSTRAP_SEED = 0x9e3779b9;

/** mulberry32 — a small, fast, well-distributed 32-bit generator. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapBlockLength(sampleSize: number): number {
  if (sampleSize <= 0) return 1;
  return Math.max(1, Math.ceil(Math.cbrt(sampleSize)));
}

export interface BlockBootstrapStatistic {
  /** 2.5th percentile of the resampled statistic. */
  ciLow: number | null;
  /** 97.5th percentile of the resampled statistic. */
  ciHigh: number | null;
  /** Resamples on which the statistic was undefined and therefore excluded. */
  skippedResamples: number;
}

export interface BlockBootstrapResult {
  blockLength: number;
  resampleCount: number;
  statistics: Record<string, BlockBootstrapStatistic>;
}

/**
 * Draw `resampleCount` moving-block resamples of `sampleSize` indices and
 * evaluate every named statistic on each one. A statistic returning null is
 * excluded from its own interval and counted in `skippedResamples` — that is
 * how profit factor reports the resamples that contained no losing trade.
 */
export function blockBootstrap(
  sampleSize: number,
  statistics: Record<string, (indices: Int32Array) => number | null>,
  options: { resampleCount?: number; blockLength?: number; seed?: number } = {},
): BlockBootstrapResult {
  const resampleCount = options.resampleCount ?? BOOTSTRAP_RESAMPLE_COUNT;
  const blockLength = Math.max(1, Math.min(options.blockLength ?? bootstrapBlockLength(sampleSize), Math.max(1, sampleSize)));
  const names = Object.keys(statistics);
  const result: BlockBootstrapResult = { blockLength, resampleCount, statistics: {} };

  if (sampleSize <= 0) {
    for (const name of names) result.statistics[name] = { ciLow: null, ciHigh: null, skippedResamples: resampleCount };
    return result;
  }

  const random = createRandom(options.seed ?? BOOTSTRAP_SEED);
  const blockCount = Math.ceil(sampleSize / blockLength);
  const maximumStart = Math.max(1, sampleSize - blockLength + 1);
  const indices = new Int32Array(sampleSize);
  const draws: Record<string, number[]> = {};
  const skipped: Record<string, number> = {};
  for (const name of names) {
    draws[name] = [];
    skipped[name] = 0;
  }

  for (let resample = 0; resample < resampleCount; resample += 1) {
    let cursor = 0;
    for (let block = 0; block < blockCount && cursor < sampleSize; block += 1) {
      const start = Math.floor(random() * maximumStart);
      for (let offset = 0; offset < blockLength && cursor < sampleSize; offset += 1) {
        indices[cursor] = (start + offset) % sampleSize;
        cursor += 1;
      }
    }
    for (const name of names) {
      const statistic = statistics[name] as (values: Int32Array) => number | null;
      const value = statistic(indices);
      if (value === null || !Number.isFinite(value)) {
        skipped[name] = (skipped[name] as number) + 1;
      } else {
        (draws[name] as number[]).push(value);
      }
    }
  }

  for (const name of names) {
    const values = (draws[name] as number[]).slice().sort((a, b) => a - b);
    result.statistics[name] = {
      ciLow: percentileOfSorted(values, 0.025),
      ciHigh: percentileOfSorted(values, 0.975),
      skippedResamples: skipped[name] as number,
    };
  }
  return result;
}

function percentileOfSorted(sorted: number[], quantile: number): number | null {
  const count = sorted.length;
  if (count === 0) return null;
  if (count === 1) return sorted[0] as number;
  const position = quantile * (count - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] as number;
  if (lowerIndex === upperIndex) return lower;
  const upper = sorted[upperIndex] as number;
  return lower + (upper - lower) * (position - lowerIndex);
}
