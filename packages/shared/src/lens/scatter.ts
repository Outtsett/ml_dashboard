/**
 * Prediction against reality.
 *
 *   points      — one dot per row, predicted (the conformal median forward
 *                 return) against what actually happened. Thinned by a
 *                 deterministic stride so the picture is reproducible.
 *   deciles     — rows grouped into ten equal-count buckets by RANK of
 *                 probability_up, each with the mean realised return and its
 *                 interval. A model with an edge shows a monotone staircase.
 *   fit         — realised regressed on predicted. Slope 1 and intercept 0 is a
 *                 perfectly scaled forecast; slope near 0 means the prediction
 *                 moves without reality following.
 *   bias        — mean(realised - predicted), with the interval widened for
 *                 overlapping labels.
 *   reliability — ten equal-WIDTH probability bins against the observed up
 *                 rate, the classification counterpart of the same question.
 */

import { samplingStride } from "./downsample";
import { MEDIAN_QUANTILE_INDEX, readLabel, readNullable, type LensRowRange } from "./series";
import { emptyEstimate, mean, meanEstimate, ordinaryLeastSquares, standardDeviation, NORMAL_95 } from "./stats";
import type { LensDecile, LensScatter, LensScatterPoint, LensSeries } from "./types";

export const LENS_MAX_SCATTER_POINTS = 4000;
export const LENS_DECILE_COUNT = 10;
export const LENS_RELIABILITY_BIN_COUNT = 10;

export function computeScatter(series: LensSeries, range: LensRowRange): LensScatter {
  const medianQuantile = series.predictedQuantilesBasisPoints[MEDIAN_QUANTILE_INDEX];
  const horizon = Math.max(1, series.horizonBars);

  // Rows with a realised return are the only ones that can be plotted. Typed
  // arrays throughout: this runs over half a million rows on the largest model.
  const eligibleBuffer = new Int32Array(Math.max(0, range.barCount));
  let eligibleCount = 0;
  for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
    if (Number.isFinite(series.realizedReturnBasisPoints[row] as number)) {
      eligibleBuffer[eligibleCount] = row;
      eligibleCount += 1;
    }
  }
  const eligible = eligibleBuffer.subarray(0, eligibleCount);

  const stride = samplingStride(eligible.length, LENS_MAX_SCATTER_POINTS);
  const points: LensScatterPoint[] = [];
  for (let i = 0; i < eligible.length; i += stride) {
    const row = eligible[i] as number;
    points.push({
      rowIndex: row,
      probabilityUp: series.probabilityUp[row] as number,
      predictedReturnBasisPoints: medianQuantile ? readNullable(medianQuantile, row) : null,
      realizedReturnBasisPoints: series.realizedReturnBasisPoints[row] as number,
    });
  }

  return {
    points,
    sampled: stride > 1,
    deciles: computeDeciles(series, eligible, medianQuantile, horizon),
    fit: computeFit(series, eligible, medianQuantile, horizon),
    reliability: computeReliability(series, range),
  };
}

function computeDeciles(
  series: LensSeries,
  eligible: Int32Array,
  medianQuantile: Float32Array | undefined,
  horizon: number,
): LensDecile[] {
  const deciles: LensDecile[] = [];
  const count = eligible.length;
  if (count === 0) {
    for (let index = 0; index < LENS_DECILE_COUNT; index += 1) {
      deciles.push({
        decile: index + 1,
        probabilityLow: 0,
        probabilityHigh: 0,
        count: 0,
        upRate: null,
        meanRealizedBasisPoints: emptyEstimate("no rows in this decile"),
        meanPredictedBasisPoints: null,
      });
    }
    return deciles;
  }

  const ordered = eligible.slice().sort((a, b) => (series.probabilityUp[a] as number) - (series.probabilityUp[b] as number));

  for (let index = 0; index < LENS_DECILE_COUNT; index += 1) {
    const start = Math.floor((index * count) / LENS_DECILE_COUNT);
    const end = Math.floor(((index + 1) * count) / LENS_DECILE_COUNT);
    const rows = ordered.slice(start, end);
    if (rows.length === 0) {
      deciles.push({
        decile: index + 1,
        probabilityLow: 0,
        probabilityHigh: 0,
        count: 0,
        upRate: null,
        meanRealizedBasisPoints: emptyEstimate("no rows in this decile"),
        meanPredictedBasisPoints: null,
      });
      continue;
    }
    const realized: number[] = [];
    const predicted: number[] = [];
    let labelled = 0;
    let up = 0;
    for (const row of rows) {
      realized.push(series.realizedReturnBasisPoints[row] as number);
      if (medianQuantile) {
        const value = readNullable(medianQuantile, row);
        if (value !== null) predicted.push(value);
      }
      const label = readLabel(series, row);
      if (label !== null) {
        labelled += 1;
        if (label === 1) up += 1;
      }
    }
    deciles.push({
      decile: index + 1,
      probabilityLow: series.probabilityUp[rows[0] as number] as number,
      probabilityHigh: series.probabilityUp[rows[rows.length - 1] as number] as number,
      count: rows.length,
      upRate: labelled > 0 ? up / labelled : null,
      meanRealizedBasisPoints: meanEstimate(
        realized,
        horizon,
        "normal approximation, effective sample size = count / horizon",
      ),
      meanPredictedBasisPoints: predicted.length > 0 ? mean(predicted) : null,
    });
  }
  return deciles;
}

function computeFit(
  series: LensSeries,
  eligible: Int32Array,
  medianQuantile: Float32Array | undefined,
  horizon: number,
): LensScatter["fit"] {
  if (!medianQuantile) return null;
  const predicted: number[] = [];
  const realized: number[] = [];
  const difference: number[] = [];
  for (const row of eligible) {
    const forecast = readNullable(medianQuantile, row);
    if (forecast === null) continue;
    const actual = series.realizedReturnBasisPoints[row] as number;
    predicted.push(forecast);
    realized.push(actual);
    difference.push(actual - forecast);
  }
  if (predicted.length === 0) return null;

  const regression = ordinaryLeastSquares(predicted, realized);
  const biasMean = mean(difference);
  const biasDeviation = standardDeviation(difference);
  const effective = Math.max(1, difference.length / horizon);
  const half = biasDeviation === null ? 0 : (NORMAL_95 * biasDeviation) / Math.sqrt(effective);

  return {
    n: predicted.length,
    bias: {
      value: biasMean,
      ciLow: biasMean === null ? null : biasMean - half,
      ciHigh: biasMean === null ? null : biasMean + half,
      n: difference.length,
      method: "normal approximation, effective sample size = count / horizon",
    },
    slope: regression?.slope ?? null,
    intercept: regression?.intercept ?? null,
    residualStandardDeviationBasisPoints: regression?.residualStandardDeviation ?? null,
    rSquared: regression?.rSquared ?? null,
  };
}

function computeReliability(series: LensSeries, range: LensRowRange): LensScatter["reliability"] {
  const counts = new Float64Array(LENS_RELIABILITY_BIN_COUNT);
  const probabilitySum = new Float64Array(LENS_RELIABILITY_BIN_COUNT);
  const upCount = new Float64Array(LENS_RELIABILITY_BIN_COUNT);
  for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
    const label = readLabel(series, row);
    if (label === null) continue;
    const probability = series.probabilityUp[row] as number;
    if (!Number.isFinite(probability)) continue;
    let bin = Math.floor(probability * LENS_RELIABILITY_BIN_COUNT);
    if (bin < 0) bin = 0;
    if (bin >= LENS_RELIABILITY_BIN_COUNT) bin = LENS_RELIABILITY_BIN_COUNT - 1;
    counts[bin] = (counts[bin] as number) + 1;
    probabilitySum[bin] = (probabilitySum[bin] as number) + probability;
    if (label === 1) upCount[bin] = (upCount[bin] as number) + 1;
  }
  const bins: LensScatter["reliability"] = [];
  for (let index = 0; index < LENS_RELIABILITY_BIN_COUNT; index += 1) {
    const count = counts[index] as number;
    bins.push({
      binLow: index / LENS_RELIABILITY_BIN_COUNT,
      binHigh: (index + 1) / LENS_RELIABILITY_BIN_COUNT,
      count,
      meanProbability: count > 0 ? (probabilitySum[index] as number) / count : null,
      observedUpRate: count > 0 ? (upCount[index] as number) / count : null,
    });
  }
  return bins;
}
