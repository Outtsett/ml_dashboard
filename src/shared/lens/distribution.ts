/**
 * Return distributions — predicted against realised — plus the two checks that
 * expose an interval that is decorative rather than informative:
 *
 *   tailCoverage         how often the realised return fell outside the
 *                        interval the model claimed. A 90% interval should be
 *                        missed about 10% of the time; missing it far more
 *                        means the interval is too narrow, far less means it is
 *                        too wide to say anything.
 *   intervalWidthByDecile mean interval width per probability decile. If the
 *                        width is flat across deciles then "confidence" is not
 *                        changing the forecast at all — the number moves but
 *                        the interval does not.
 *
 * Both histograms share one set of edges so the two shapes can be read on top
 * of each other; values outside the 0.5th..99.5th percentile span of the union
 * are folded into the edge bins rather than dropped, so every observation is
 * counted somewhere.
 */

import { coverageQuantileIndices, readNullable, type LensRowRange } from "./series";
import { eightNumberSummary, quantileSorted, sortedFinite } from "./stats";
import { MEDIAN_QUANTILE_INDEX } from "./series";
import type { LensDistribution, LensEvaluationParams, LensSeries } from "./types";

export const LENS_HISTOGRAM_BIN_COUNT = 40;
export const LENS_HISTOGRAM_LOWER_PERCENTILE = 0.005;
export const LENS_HISTOGRAM_UPPER_PERCENTILE = 0.995;
export const LENS_INTERVAL_DECILE_COUNT = 10;

export function computeDistribution(
  series: LensSeries,
  params: LensEvaluationParams,
  range: LensRowRange,
): LensDistribution {
  const medianQuantile = series.predictedQuantilesBasisPoints[MEDIAN_QUANTILE_INDEX];
  // Typed buffers: this runs over half a million rows on the largest model, and
  // plain arrays of boxed numbers dominate the cost at that size.
  const capacity = Math.max(0, range.barCount);
  const realizedBuffer = new Float64Array(capacity);
  const predictedBuffer = new Float64Array(capacity);
  let realizedCount = 0;
  let predictedCount = 0;
  for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
    const actual = series.realizedReturnBasisPoints[row] as number;
    if (Number.isFinite(actual)) {
      realizedBuffer[realizedCount] = actual;
      realizedCount += 1;
    }
    if (medianQuantile) {
      const forecast = medianQuantile[row] as number;
      if (Number.isFinite(forecast)) {
        predictedBuffer[predictedCount] = forecast;
        predictedCount += 1;
      }
    }
  }
  const realized = realizedBuffer.subarray(0, realizedCount);
  const predicted = predictedBuffer.subarray(0, predictedCount);

  const hasPredicted = predictedCount > 0;
  const union = new Float64Array(realizedCount + predictedCount);
  union.set(realized, 0);
  if (hasPredicted) union.set(predicted, realizedCount);
  const sortedUnion = sortedFinite(union);
  const lower = quantileSorted(sortedUnion, LENS_HISTOGRAM_LOWER_PERCENTILE);
  const upper = quantileSorted(sortedUnion, LENS_HISTOGRAM_UPPER_PERCENTILE);
  const edges = buildEdges(lower, upper);

  return {
    realized: eightNumberSummary(realized),
    predicted: hasPredicted ? eightNumberSummary(predicted) : null,
    histogram: {
      edgesBasisPoints: edges,
      realizedCounts: binCounts(realized, edges),
      predictedCounts: hasPredicted ? binCounts(predicted, edges) : null,
    },
    tailCoverage: computeTailCoverage(series, params, range),
    intervalWidthByDecile: computeIntervalWidthByDecile(series, params, range),
  };
}

function buildEdges(lower: number | null, upper: number | null): number[] {
  let low = lower ?? -1;
  let high = upper ?? 1;
  if (!(high > low)) {
    const centre = Number.isFinite(low) ? low : 0;
    low = centre - 1;
    high = centre + 1;
  }
  const width = (high - low) / LENS_HISTOGRAM_BIN_COUNT;
  const edges: number[] = [];
  for (let index = 0; index <= LENS_HISTOGRAM_BIN_COUNT; index += 1) edges.push(low + width * index);
  return edges;
}

function binCounts(values: ArrayLike<number>, edges: number[]): number[] {
  const counts = new Array<number>(LENS_HISTOGRAM_BIN_COUNT).fill(0);
  const low = edges[0] as number;
  const high = edges[edges.length - 1] as number;
  const width = (high - low) / LENS_HISTOGRAM_BIN_COUNT;
  if (!(width > 0)) return counts;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    if (!Number.isFinite(value)) continue;
    let bin = Math.floor((value - low) / width);
    if (bin < 0) bin = 0;
    if (bin >= LENS_HISTOGRAM_BIN_COUNT) bin = LENS_HISTOGRAM_BIN_COUNT - 1;
    counts[bin] = (counts[bin] as number) + 1;
  }
  return counts;
}

function computeTailCoverage(
  series: LensSeries,
  params: LensEvaluationParams,
  range: LensRowRange,
): LensDistribution["tailCoverage"] {
  const { lower, upper } = coverageQuantileIndices(params.intervalCoverage);
  const lowerColumn = series.predictedQuantilesBasisPoints[lower];
  const upperColumn = series.predictedQuantilesBasisPoints[upper];
  if (!lowerColumn || !upperColumn) return null;

  let n = 0;
  let below = 0;
  let above = 0;
  for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
    const actual = readNullable(series.realizedReturnBasisPoints, row);
    if (actual === null) continue;
    const low = readNullable(lowerColumn, row);
    const high = readNullable(upperColumn, row);
    if (low === null || high === null) continue;
    n += 1;
    if (actual < low) below += 1;
    else if (actual > high) above += 1;
  }
  if (n === 0) return null;
  return {
    coverage: params.intervalCoverage,
    nominalOutsideShare: 1 - params.intervalCoverage,
    observedOutsideShare: (below + above) / n,
    belowLowerShare: below / n,
    aboveUpperShare: above / n,
    n,
  };
}

function computeIntervalWidthByDecile(
  series: LensSeries,
  params: LensEvaluationParams,
  range: LensRowRange,
): LensDistribution["intervalWidthByDecile"] {
  const { lower, upper } = coverageQuantileIndices(params.intervalCoverage);
  const lowerColumn = series.predictedQuantilesBasisPoints[lower];
  const upperColumn = series.predictedQuantilesBasisPoints[upper];
  const empty: LensDistribution["intervalWidthByDecile"] = [];
  for (let index = 0; index < LENS_INTERVAL_DECILE_COUNT; index += 1) {
    empty.push({ decile: index + 1, meanWidthBasisPoints: null, count: 0 });
  }
  if (!lowerColumn || !upperColumn) return empty;

  const rowBuffer = new Int32Array(Math.max(0, range.barCount));
  let rowCount = 0;
  for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
    if (!Number.isFinite(lowerColumn[row] as number) || !Number.isFinite(upperColumn[row] as number)) continue;
    rowBuffer[rowCount] = row;
    rowCount += 1;
  }
  if (rowCount === 0) return empty;

  const rows = rowBuffer.subarray(0, rowCount);
  rows.sort((a, b) => (series.probabilityUp[a] as number) - (series.probabilityUp[b] as number));
  const result: LensDistribution["intervalWidthByDecile"] = [];
  for (let index = 0; index < LENS_INTERVAL_DECILE_COUNT; index += 1) {
    const start = Math.floor((index * rows.length) / LENS_INTERVAL_DECILE_COUNT);
    const end = Math.floor(((index + 1) * rows.length) / LENS_INTERVAL_DECILE_COUNT);
    let total = 0;
    let count = 0;
    for (let k = start; k < end; k += 1) {
      const row = rows[k] as number;
      total += (upperColumn[row] as number) - (lowerColumn[row] as number);
      count += 1;
    }
    result.push({
      decile: index + 1,
      meanWidthBasisPoints: count > 0 ? total / count : null,
      count,
    });
  }
  return result;
}
