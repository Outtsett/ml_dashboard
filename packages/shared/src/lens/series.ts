/**
 * Row-range resolution over a LensSeries.
 *
 * Every view is computed over an inclusive row range. The range is resolved
 * once, from the optional start/end timestamps, and then passed around — so
 * "row i of the range" always means the same bar in every view.
 */

import { LENS_QUANTILE_LEVELS, type LensEvaluationParams, type LensIntervalCoverage, type LensSeries } from "./types";

export interface LensRowRange {
  firstRowIndex: number;
  lastRowIndex: number;
  barCount: number;
  firstTimestampSeconds: number;
  lastTimestampSeconds: number;
}

/** First index whose timestamp is >= `target` (timestamps ascend). */
function lowerBound(timestamps: Float64Array, length: number, target: number): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((timestamps[middle] as number) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** First index whose timestamp is > `target`. */
function upperBound(timestamps: Float64Array, length: number, target: number): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((timestamps[middle] as number) <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function resolveRange(series: LensSeries, params: LensEvaluationParams): LensRowRange {
  const length = series.length;
  if (length === 0) {
    return { firstRowIndex: 0, lastRowIndex: -1, barCount: 0, firstTimestampSeconds: 0, lastTimestampSeconds: 0 };
  }
  let first = 0;
  let last = length - 1;
  if (params.startTimestampSeconds !== undefined) {
    first = lowerBound(series.timestampSeconds, length, params.startTimestampSeconds);
  }
  if (params.endTimestampSeconds !== undefined) {
    last = upperBound(series.timestampSeconds, length, params.endTimestampSeconds) - 1;
  }
  if (first > last) {
    return {
      firstRowIndex: Math.min(first, length - 1),
      lastRowIndex: Math.min(first, length - 1) - 1,
      barCount: 0,
      firstTimestampSeconds: 0,
      lastTimestampSeconds: 0,
    };
  }
  return {
    firstRowIndex: first,
    lastRowIndex: last,
    barCount: last - first + 1,
    firstTimestampSeconds: series.timestampSeconds[first] as number,
    lastTimestampSeconds: series.timestampSeconds[last] as number,
  };
}

/** Quantile column indices carrying the requested two-sided coverage. */
export function coverageQuantileIndices(coverage: LensIntervalCoverage): { lower: number; upper: number } {
  const tail = (1 - coverage) / 2;
  let lower = 0;
  let upper = LENS_QUANTILE_LEVELS.length - 1;
  for (let i = 0; i < LENS_QUANTILE_LEVELS.length; i += 1) {
    if (Math.abs((LENS_QUANTILE_LEVELS[i] as number) - tail) < 1e-9) lower = i;
    if (Math.abs((LENS_QUANTILE_LEVELS[i] as number) - (1 - tail)) < 1e-9) upper = i;
  }
  return { lower, upper };
}

/** Index of the median (0.50) quantile column. */
export const MEDIAN_QUANTILE_INDEX = LENS_QUANTILE_LEVELS.indexOf(0.5);

/** Read a nullable float column: NaN on disk means "unknown". */
export function readNullable(column: Float32Array | Float64Array, index: number): number | null {
  const value = column[index] as number;
  return Number.isFinite(value) ? value : null;
}

/** Label column: -1 means "no label". */
export function readLabel(series: LensSeries, index: number): 0 | 1 | null {
  const value = series.label[index] as number;
  if (value === 0) return 0;
  if (value === 1) return 1;
  return null;
}
