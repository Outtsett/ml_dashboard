/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampling for time-series.
 *
 * Reference: Sveinn Steinarsson, "Downsampling Time Series for Visual
 * Representation", 2013 (MSc thesis, Univ. of Iceland).
 *
 * Used by W6.c chart components to keep Recharts render fast when N > 5
 * experiments × hundreds of fold-equity points are overlaid simultaneously.
 * Target output size is ~200 points per series per the parent plan §6
 * "Recharts perf" risk row.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Downsample `data` to `targetCount` points using LTTB.
 * - Returns `data` unchanged when its length ≤ targetCount or targetCount < 3.
 * - Always preserves the first and last samples.
 * - Each retained inner point maximises the triangle area against the
 *   previously-retained point and the next bucket's average — preserving
 *   visual peaks/troughs better than uniform decimation.
 */
export function lttb<T extends Point>(data: readonly T[], targetCount: number): T[] {
  const n = data.length;
  if (targetCount >= n || targetCount < 3 || n < 3) {
    return [...data];
  }

  const sampled: T[] = new Array<T>(targetCount);
  // Bucket size for the inner buckets (first and last samples reserved).
  const bucketSize = (n - 2) / (targetCount - 2);

  let aIdx = 0;
  sampled[0] = data[0]!;

  for (let i = 0; i < targetCount - 2; i += 1) {
    // Range of points contributing to the next bucket's average.
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
    const rangeLen = rangeEnd - rangeStart;

    let avgX = 0;
    let avgY = 0;
    for (let j = rangeStart; j < rangeEnd; j += 1) {
      const p = data[j]!;
      avgX += p.x;
      avgY += p.y;
    }
    if (rangeLen > 0) {
      avgX /= rangeLen;
      avgY /= rangeLen;
    }

    // Range of points to choose this bucket's representative from.
    const bucketStart = Math.floor(i * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n);
    const a = data[aIdx]!;

    let maxArea = -1;
    let maxIdx = bucketStart;
    for (let j = bucketStart; j < bucketEnd; j += 1) {
      const p = data[j]!;
      // Twice the absolute triangle area is sufficient for ranking.
      const area = Math.abs(
        (a.x - avgX) * (p.y - a.y) - (a.x - p.x) * (avgY - a.y),
      );
      if (area > maxArea) {
        maxArea = area;
        maxIdx = j;
      }
    }

    sampled[i + 1] = data[maxIdx]!;
    aIdx = maxIdx;
  }

  sampled[targetCount - 1] = data[n - 1]!;
  return sampled;
}
