/**
 * Numeric primitives shared by every lens view.
 *
 * Conventions that hold everywhere in packages/shared/src/lens:
 *   - "standard deviation" means the SAMPLE standard deviation (divide by n-1).
 *   - Percentiles use linear interpolation between order statistics
 *     (index = quantile * (count - 1)), the numpy default.
 *   - Skewness is the sample-adjusted Fisher-Pearson G1 and kurtosis is the
 *     sample-adjusted EXCESS kurtosis G2 (both the pandas / Excel estimators),
 *     which is why they are null below 3 and 4 observations respectively.
 *   - An unknown value is null. Never 0, never NaN in an output object.
 */

import type { LensEightNumberSummary, LensEstimate } from "./types";

/** 95% two-sided normal quantile. */
export const NORMAL_95 = 1.959963984540054;

export function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

/** Copy the finite values of `values` into a fresh Float64Array. */
export function finiteValues(values: ArrayLike<number>): Float64Array {
  const out = new Float64Array(values.length);
  let count = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    if (Number.isFinite(value)) {
      out[count] = value;
      count += 1;
    }
  }
  return out.subarray(0, count) as Float64Array;
}

export function mean(values: ArrayLike<number>): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += values[i] as number;
  return total / values.length;
}

/** Sample standard deviation (n - 1). Null below two observations. */
export function standardDeviation(values: ArrayLike<number>): number | null {
  const count = values.length;
  if (count < 2) return null;
  const average = mean(values) as number;
  let sumSquares = 0;
  for (let i = 0; i < count; i += 1) {
    const delta = (values[i] as number) - average;
    sumSquares += delta * delta;
  }
  return Math.sqrt(sumSquares / (count - 1));
}

/** Linear-interpolated quantile of an ASCENDING-sorted array. */
export function quantileSorted(sorted: ArrayLike<number>, quantile: number): number | null {
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

/** Sorted ascending copy of the finite values. */
export function sortedFinite(values: ArrayLike<number>): Float64Array {
  const finite = finiteValues(values);
  const copy = new Float64Array(finite);
  copy.sort();
  return copy;
}

const EMPTY_SUMMARY: LensEightNumberSummary = {
  count: 0,
  mean: null,
  median: null,
  standardDeviation: null,
  skewness: null,
  kurtosis: null,
  percentile25: null,
  percentile75: null,
  minimum: null,
  maximum: null,
};

/**
 * All eight distribution numbers plus the count. Non-finite inputs are dropped
 * before anything is computed, so `count` is the number of usable observations.
 */
export function eightNumberSummary(values: ArrayLike<number>): LensEightNumberSummary {
  const sorted = sortedFinite(values);
  const count = sorted.length;
  if (count === 0) return { ...EMPTY_SUMMARY };

  const average = mean(sorted) as number;
  const deviation = standardDeviation(sorted);

  let skewness: number | null = null;
  let kurtosis: number | null = null;
  if (deviation !== null && deviation > 0) {
    let sumCubed = 0;
    let sumFourth = 0;
    for (let i = 0; i < count; i += 1) {
      const standardised = ((sorted[i] as number) - average) / deviation;
      const squared = standardised * standardised;
      sumCubed += squared * standardised;
      sumFourth += squared * squared;
    }
    if (count >= 3) {
      skewness = (count / ((count - 1) * (count - 2))) * sumCubed;
    }
    if (count >= 4) {
      const scale = (count * (count + 1)) / ((count - 1) * (count - 2) * (count - 3));
      const correction = (3 * (count - 1) * (count - 1)) / ((count - 2) * (count - 3));
      kurtosis = scale * sumFourth - correction;
    }
  } else if (deviation !== null) {
    // A constant series: both shape numbers are defined and zero-variance.
    if (count >= 3) skewness = 0;
    if (count >= 4) kurtosis = 0;
  }

  return {
    count,
    mean: average,
    median: quantileSorted(sorted, 0.5),
    standardDeviation: deviation,
    skewness,
    kurtosis,
    percentile25: quantileSorted(sorted, 0.25),
    percentile75: quantileSorted(sorted, 0.75),
    minimum: sorted[0] as number,
    maximum: sorted[count - 1] as number,
  };
}

/** An estimate with no observations behind it. */
export function emptyEstimate(method: string): LensEstimate {
  return { value: null, ciLow: null, ciHigh: null, n: 0, method };
}

/**
 * Normal-approximation interval for a share, widened for overlapping labels:
 * the effective sample size is `count / horizonBars`, because a horizon of H
 * rows means consecutive labels reuse the same price move.
 */
export function proportionEstimate(
  successes: number,
  count: number,
  horizonBars: number,
  methodLabel = "normal approximation, effective sample size = count / horizon",
): LensEstimate {
  if (count <= 0) return emptyEstimate(methodLabel);
  const share = successes / count;
  const effective = Math.max(1, count / Math.max(1, horizonBars));
  const standardError = Math.sqrt((share * (1 - share)) / effective);
  const half = NORMAL_95 * standardError;
  return {
    value: share,
    ciLow: Math.max(0, share - half),
    ciHigh: Math.min(1, share + half),
    n: count,
    method: methodLabel,
  };
}

/** Normal-approximation interval for a mean, with the same overlap correction. */
export function meanEstimate(
  values: ArrayLike<number>,
  horizonBars: number,
  methodLabel = "normal approximation, effective sample size = count / horizon",
): LensEstimate {
  const finite = finiteValues(values);
  const count = finite.length;
  if (count === 0) return emptyEstimate(methodLabel);
  const average = mean(finite) as number;
  const deviation = standardDeviation(finite);
  if (deviation === null || deviation === 0) {
    return { value: average, ciLow: average, ciHigh: average, n: count, method: methodLabel };
  }
  const effective = Math.max(1, count / Math.max(1, horizonBars));
  const half = (NORMAL_95 * deviation) / Math.sqrt(effective);
  return { value: average, ciLow: average - half, ciHigh: average + half, n: count, method: methodLabel };
}

/**
 * Rank-based area under the ROC curve with tied probabilities sharing the
 * average rank. Null when either class is empty.
 */
export function areaUnderCurve(scores: ArrayLike<number>, positives: ArrayLike<number>): number | null {
  const count = scores.length;
  if (count === 0) return null;
  const sortable = new Int32Array(count);
  for (let i = 0; i < count; i += 1) sortable[i] = i;
  sortable.sort((a, b) => (scores[a] as number) - (scores[b] as number));

  let positiveCount = 0;
  let negativeCount = 0;
  for (let i = 0; i < count; i += 1) {
    if ((positives[i] as number) > 0) positiveCount += 1;
    else negativeCount += 1;
  }
  if (positiveCount === 0 || negativeCount === 0) return null;

  let positiveRankSum = 0;
  let index = 0;
  while (index < count) {
    let end = index + 1;
    const value = scores[sortable[index] as number] as number;
    while (end < count && (scores[sortable[end] as number] as number) === value) end += 1;
    const averageRank = (index + 1 + end) / 2; // ranks are 1-based
    for (let k = index; k < end; k += 1) {
      if ((positives[sortable[k] as number] as number) > 0) positiveRankSum += averageRank;
    }
    index = end;
  }
  return (positiveRankSum - (positiveCount * (positiveCount + 1)) / 2) / (positiveCount * negativeCount);
}

/** Probabilities are clipped before any log is taken. */
export const PROBABILITY_CLIP = 1e-7;

export function clipProbability(probability: number): number {
  if (probability < PROBABILITY_CLIP) return PROBABILITY_CLIP;
  if (probability > 1 - PROBABILITY_CLIP) return 1 - PROBABILITY_CLIP;
  return probability;
}

/** Ordinary least squares of y on x. Null when fewer than two usable pairs. */
export function ordinaryLeastSquares(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): { slope: number; intercept: number; rSquared: number | null; residualStandardDeviation: number | null; n: number } | null {
  const count = Math.min(x.length, y.length);
  if (count < 2) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < count; i += 1) {
    sumX += x[i] as number;
    sumY += y[i] as number;
  }
  const meanX = sumX / count;
  const meanY = sumY / count;
  let covariance = 0;
  let varianceX = 0;
  for (let i = 0; i < count; i += 1) {
    const deltaX = (x[i] as number) - meanX;
    covariance += deltaX * ((y[i] as number) - meanY);
    varianceX += deltaX * deltaX;
  }
  if (varianceX === 0) return null;
  const slope = covariance / varianceX;
  const intercept = meanY - slope * meanX;

  let residualSumSquares = 0;
  let totalSumSquares = 0;
  for (let i = 0; i < count; i += 1) {
    const predicted = intercept + slope * (x[i] as number);
    const residual = (y[i] as number) - predicted;
    residualSumSquares += residual * residual;
    const centred = (y[i] as number) - meanY;
    totalSumSquares += centred * centred;
  }
  return {
    slope,
    intercept,
    rSquared: totalSumSquares > 0 ? 1 - residualSumSquares / totalSumSquares : null,
    residualStandardDeviation: count > 2 ? Math.sqrt(residualSumSquares / (count - 2)) : null,
    n: count,
  };
}
