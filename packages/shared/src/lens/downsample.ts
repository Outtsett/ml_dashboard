/**
 * Transport thinning. Two different shapes, because they protect two different
 * things:
 *   - `bucketLastIndices` keeps the last point of each bucket, which is right
 *     for a slowly-moving line (a rolling hit rate) where the latest value in a
 *     bucket is the one that belongs at that x position;
 *   - `extremeIndices` keeps the minimum AND maximum of each bucket, which is
 *     what an equity curve needs: thinning by stride would quietly erase the
 *     bottom of a drawdown, and the drawdown is the whole point of the chart.
 * Both are deterministic and both always keep the first and last point.
 */

/** Evenly spaced stride for sampling `count` items down to `maximum`. */
export function samplingStride(count: number, maximum: number): number {
  if (maximum <= 0 || count <= maximum) return 1;
  return Math.ceil(count / maximum);
}

/** Indices of the last item in each of at most `maximum` equal buckets. */
export function bucketLastIndices(count: number, maximum: number): Int32Array {
  if (count <= 0) return new Int32Array(0);
  if (maximum <= 0 || count <= maximum) {
    const all = new Int32Array(count);
    for (let i = 0; i < count; i += 1) all[i] = i;
    return all;
  }
  const out = new Int32Array(maximum);
  let written = 0;
  for (let bucket = 0; bucket < maximum; bucket += 1) {
    const end = Math.floor(((bucket + 1) * count) / maximum) - 1;
    const index = Math.max(0, Math.min(count - 1, end));
    if (written === 0 || (out[written - 1] as number) !== index) {
      out[written] = index;
      written += 1;
    }
  }
  if (written === 0 || (out[written - 1] as number) !== count - 1) {
    if (written < maximum) {
      out[written] = count - 1;
      written += 1;
    } else {
      out[written - 1] = count - 1;
    }
  }
  return out.subarray(0, written) as Int32Array;
}

/**
 * Indices keeping the extremes of `values` in each bucket, in ascending index
 * order, with the first and last index always present. Emits at most
 * `maximum` indices (two per bucket).
 */
export function extremeIndices(values: ArrayLike<number>, maximum: number): Int32Array {
  const count = values.length;
  if (count <= 0) return new Int32Array(0);
  if (maximum <= 0 || count <= maximum) {
    const all = new Int32Array(count);
    for (let i = 0; i < count; i += 1) all[i] = i;
    return all;
  }
  // Two slots are reserved for the first and last index, which are always kept,
  // so the emitted count can never exceed `maximum`.
  const bucketCount = Math.max(1, Math.floor((maximum - 2) / 2));
  const kept = new Set<number>();
  kept.add(0);
  kept.add(count - 1);
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor((bucket * count) / bucketCount);
    const end = Math.min(count, Math.floor(((bucket + 1) * count) / bucketCount));
    if (start >= end) continue;
    let minimumIndex = start;
    let maximumIndex = start;
    for (let i = start + 1; i < end; i += 1) {
      const value = values[i] as number;
      if (value < (values[minimumIndex] as number)) minimumIndex = i;
      if (value > (values[maximumIndex] as number)) maximumIndex = i;
    }
    kept.add(minimumIndex);
    kept.add(maximumIndex);
  }
  const out = Int32Array.from(kept);
  out.sort();
  return out;
}
