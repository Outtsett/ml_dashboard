/**
 * The distribution along one axis — the marginal histograms drawn on the
 * scatter's top and right edges.
 *
 * Bin width by the Freedman–Diaconis rule, the same as numpy's `bins="fd"`:
 *
 *   width = 2 · IQR · n^(-1/3)
 *
 * IQR (the spread of the middle half) makes the width robust to the fat tails
 * price variables carry. When the IQR is 0 — a flag that is 0 on most bars —
 * numpy's "fd" collapses to a single bin, which would hide the rare value;
 * this falls back to Sturges' rule, range / (log₂ n + 1) — numpy's
 * bins="sturges", and R's default. Either way the count is clamped to 4–64 so
 * a strip stays readable.
 */

export interface MarginalHistogram {
  /** Left edge of the first bin. */
  minimum: number;
  binWidth: number;
  counts: Float64Array;
  total: number;
  rule: "freedman_diaconis" | "sturges" | "single_value";
  /** 25th percentile, median, 75th percentile (numpy's linear rule). */
  quartiles: [number, number, number];
}

export const MINIMUM_MARGINAL_BINS = 4;
export const MAXIMUM_MARGINAL_BINS = 64;

/** numpy's default ("linear") quantile of an already sorted array. */
export function sortedQuantile(sorted: ArrayLike<number>, probability: number): number {
  const count = sorted.length;
  if (count === 0) return Number.NaN;
  const position = probability * (count - 1);
  const lower = Math.floor(position);
  const upper = Math.min(count - 1, lower + 1);
  const fraction = position - lower;
  return (sorted[lower] as number) + ((sorted[upper] as number) - (sorted[lower] as number)) * fraction;
}

export function marginalHistogram(values: ArrayLike<number>): MarginalHistogram | null {
  const count = values.length;
  if (count === 0) return null;
  const sorted = Float64Array.from(values as ArrayLike<number>).sort();
  const low = sorted[0] as number;
  const high = sorted[count - 1] as number;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (high === low) {
    return { minimum: low - 0.5, binWidth: 1, counts: Float64Array.of(count), total: count, rule: "single_value", quartiles: [low, low, low] };
  }
  const range = high - low;
  const quartiles: [number, number, number] = [sortedQuantile(sorted, 0.25), sortedQuantile(sorted, 0.5), sortedQuantile(sorted, 0.75)];
  const interquartileRange = quartiles[2] - quartiles[0];
  let rule: MarginalHistogram["rule"] = "freedman_diaconis";
  let width = 2 * interquartileRange * Math.pow(count, -1 / 3);
  if (!(width > 0)) {
    rule = "sturges";
    width = range / (Math.log2(count) + 1);
  }
  const bins = Math.min(MAXIMUM_MARGINAL_BINS, Math.max(MINIMUM_MARGINAL_BINS, Math.ceil(range / width)));
  const binWidth = range / bins;
  const counts = new Float64Array(bins);
  for (let index = 0; index < count; index += 1) {
    // The top edge belongs to the last bin, as in numpy.
    const bin = Math.min(bins - 1, Math.floor(((sorted[index] as number) - low) / binWidth));
    counts[bin] = (counts[bin] as number) + 1;
  }
  return { minimum: low, binWidth, counts, total: count, rule, quartiles };
}
