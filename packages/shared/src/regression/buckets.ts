/**
 * Equal-count buckets of X and the mean Y inside each.
 *
 * A straight line can miss a relationship that lives only at the extremes —
 * a forward return that is flat for most of X and moves only in the top
 * fifth. The bucket means show that shape without assuming it, and the
 * top-minus-bottom spread is the number a trader would actually trade.
 *
 * Buckets are formed by sorting X ascending (ties in input order), cutting
 * into `bucketCount` runs whose sizes differ by at most one
 * (numpy.array_split), then moving any cut that lands inside a run of equal X
 * to the nearer end of that run, so one X value never sits in two buckets.
 * Without that, a discrete X (a flag, a small integer) had its ties split by
 * time order and the top-minus-bottom spread compared early bars with late
 * ones. A very discrete X therefore yields fewer than `bucketCount` buckets,
 * and one with a single value yields none. The interval on each mean is
 * t-based and assumes the observations inside a bucket are independent —
 * overlapping forward returns are not, so it is narrower than it should be
 * when the horizon exceeds one bar.
 */

import { studentTQuantile, studentTTwoSidedPValue } from "./student";
import type { QuantileBucket, QuantileBuckets } from "./types";

export function quantileBuckets(
  xValues: ArrayLike<number>,
  yValues: ArrayLike<number>,
  bucketCount = 5,
  confidenceLevel = 0.95,
): QuantileBuckets | null {
  const count = Math.min(xValues.length, yValues.length);
  if (count < bucketCount * 2) return null;
  const order = new Array<number>(count);
  for (let index = 0; index < count; index += 1) order[index] = index;
  order.sort((left, right) => (xValues[left] as number) - (xValues[right] as number) || left - right);

  const base = Math.floor(count / bucketCount);
  const larger = count % bucketCount;
  const sameX = (position: number) =>
    xValues[order[position] as number] === xValues[order[position - 1] as number];
  const cuts: number[] = [];
  let position = 0;
  for (let bucket = 0; bucket < bucketCount - 1; bucket += 1) {
    position += base + (bucket < larger ? 1 : 0);
    // Inside a run of equal X, move to the nearer end of the run (its start
    // on a tie), or to the other end when the nearer one is unusable.
    let start = position;
    while (start > 0 && start < count && sameX(start)) start -= 1;
    let end = position;
    while (end > 0 && end < count && sameX(end)) end += 1;
    const preferred = position - start <= end - position ? [start, end] : [end, start];
    for (const cut of preferred) {
      if (cut > 0 && cut < count && (cuts.length === 0 || cut > (cuts[cuts.length - 1] as number))) {
        cuts.push(cut);
        break;
      }
    }
  }
  const bounds = [0, ...cuts, count];
  const groups: number[][] = [];
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    const start = bounds[index] as number;
    const end = bounds[index + 1] as number;
    if (end > start) groups.push(order.slice(start, end));
  }
  if (groups.length < 2) return null;

  const summaries = groups.map((group) => summarize(group, xValues, yValues, confidenceLevel));
  const top = summaries[summaries.length - 1] as BucketWithVariance;
  const bottom = summaries[0] as BucketWithVariance;
  const topVariance = top.variance / top.count;
  const bottomVariance = bottom.variance / bottom.count;
  const spread = top.meanY - bottom.meanY;
  const spreadStandardError = Math.sqrt(topVariance + bottomVariance);
  const welchDegrees =
    (topVariance + bottomVariance) ** 2 /
    (topVariance ** 2 / (top.count - 1) + bottomVariance ** 2 / (bottom.count - 1));
  const spreadTStatistic = spreadStandardError > 0 ? spread / spreadStandardError : Number.NaN;

  return {
    buckets: summaries.map(({ variance: _variance, ...bucket }) => bucket),
    spread,
    spreadTStatistic,
    spreadPValue: studentTTwoSidedPValue(spreadTStatistic, welchDegrees),
  };
}

interface BucketWithVariance extends QuantileBucket {
  variance: number;
}

function summarize(
  group: number[],
  xValues: ArrayLike<number>,
  yValues: ArrayLike<number>,
  confidenceLevel: number,
): BucketWithVariance {
  const count = group.length;
  let sum = 0;
  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  for (const index of group) {
    sum += yValues[index] as number;
    const x = xValues[index] as number;
    if (x < minimumX) minimumX = x;
    if (x > maximumX) maximumX = x;
  }
  const meanY = sum / count;
  let squares = 0;
  for (const index of group) {
    const delta = (yValues[index] as number) - meanY;
    squares += delta * delta;
  }
  const variance = count > 1 ? squares / (count - 1) : 0;
  const standardError = Math.sqrt(variance / count);
  const critical = count > 1 ? studentTQuantile(1 - (1 - confidenceLevel) / 2, count - 1) : Number.NaN;
  return {
    count,
    minimumX,
    maximumX,
    meanY,
    standardError,
    lower: meanY - critical * standardError,
    upper: meanY + critical * standardError,
    variance,
  };
}
