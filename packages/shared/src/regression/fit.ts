/**
 * Simple linear regression y = a + b·x, with everything needed to judge it.
 *
 * The numbers are statsmodels' numbers — OLS, OLSInfluence, durbin_watson,
 * cov_type="HAC" with its default (no small-sample correction) — and
 * tests/shared/regression.test.ts holds them to that on five fixed datasets
 * produced by scripts/regression_parity_fixture.py.
 *
 * Inputs are assumed to be in TIME ORDER. Durbin-Watson, the lag-one residual
 * autocorrelation and the Newey-West error all read neighbouring residuals;
 * shuffle the input and they describe nothing.
 *
 *   n        points              x̄, ȳ   means
 *   Sxx      Σ(x − x̄)²           Sxy     Σ(x − x̄)(y − ȳ)
 *   b        Sxy / Sxx           a       ȳ − b·x̄
 *   e_i      y_i − (a + b·x_i)   RSS     Σ e²
 *   s        √(RSS / (n − 2))    SE(b)   s / √Sxx
 *   h_i      1/n + (x_i − x̄)² / Sxx                    leverage
 *   r_i      e_i / (s·√(1 − h_i))                        internally studentized
 *   t_i      r_i·√((n − 3) / (n − 2 − r_i²))             externally studentized, t(n − 3)
 *   D_i      r_i²/2 · h_i / (1 − h_i)                    Cook's distance
 *   band     ŷ₀ ± t·s·√(1/n + (x₀ − x̄)²/Sxx)             mean response
 *   band     ŷ₀ ± t·s·√(1 + 1/n + (x₀ − x̄)²/Sxx)         a new observation
 */

import { eightNumberSummary } from "../lens/stats";
import { pearsonCorrelation, spearmanCorrelation } from "./ranks";
import { studentTQuantile, studentTTwoSidedPValue } from "./student";
import type { RegressionFit, RegressionOptions, RegressionResult } from "./types";

export const DEFAULT_CONFIDENCE_LEVEL = 0.95;
export const DEFAULT_OUTLIER_FAMILY_ALPHA = 0.05;
export const DEFAULT_BAND_SAMPLES = 48;
/** Fewer than this and the externally studentized residual has no degrees of freedom. */
export const MINIMUM_POINTS = 4;

/** Newey-West (1994) automatic lag: floor(4 · (n/100)^(2/9)). */
export function neweyWestAutomaticLag(n: number): number {
  return Math.floor(4 * Math.pow(n / 100, 2 / 9));
}

export function fitSimpleRegression(
  xValues: ArrayLike<number>,
  yValues: ArrayLike<number>,
  options: RegressionOptions = {},
): RegressionResult {
  const n = Math.min(xValues.length, yValues.length);
  if (n < MINIMUM_POINTS) {
    return { ok: false, n, reason: `needs at least ${MINIMUM_POINTS} points, has ${n}` };
  }
  const confidenceLevel = options.confidenceLevel ?? DEFAULT_CONFIDENCE_LEVEL;
  const familyAlpha = options.outlierFamilyAlpha ?? DEFAULT_OUTLIER_FAMILY_ALPHA;
  const bandSamples = Math.max(2, options.bandSamples ?? DEFAULT_BAND_SAMPLES);

  let sumX = 0;
  let sumY = 0;
  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < n; index += 1) {
    const x = xValues[index] as number;
    sumX += x;
    sumY += yValues[index] as number;
    if (x < minimumX) minimumX = x;
    if (x > maximumX) maximumX = x;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let sumSquaresX = 0;
  let sumSquaresY = 0;
  let crossProduct = 0;
  for (let index = 0; index < n; index += 1) {
    const deltaX = (xValues[index] as number) - meanX;
    const deltaY = (yValues[index] as number) - meanY;
    sumSquaresX += deltaX * deltaX;
    sumSquaresY += deltaY * deltaY;
    crossProduct += deltaX * deltaY;
  }
  if (!Number.isFinite(sumSquaresX) || !Number.isFinite(sumSquaresY)) {
    return { ok: false, n, reason: "X or Y is too large to square in double precision" };
  }
  if (!(sumSquaresX > 0)) {
    return { ok: false, n, reason: "X takes a single value, so no line can be fitted" };
  }

  const slope = crossProduct / sumSquaresX;
  const intercept = meanY - slope * meanX;
  const fitted = new Float64Array(n);
  const residuals = new Float64Array(n);
  let residualSumSquares = 0;
  for (let index = 0; index < n; index += 1) {
    const prediction = intercept + slope * (xValues[index] as number);
    const residual = (yValues[index] as number) - prediction;
    fitted[index] = prediction;
    residuals[index] = residual;
    residualSumSquares += residual * residual;
  }

  const degreesOfFreedom = n - 2;
  const residualVariance = residualSumSquares / degreesOfFreedom;
  const residualStandardError = Math.sqrt(residualVariance);
  const slopeStandardError = residualStandardError / Math.sqrt(sumSquaresX);
  const interceptStandardError = residualStandardError * Math.sqrt(1 / n + (meanX * meanX) / sumSquaresX);
  const slopeTStatistic = slopeStandardError > 0 ? slope / slopeStandardError : signedInfinity(slope);
  const slopePValue = studentTTwoSidedPValue(slopeTStatistic, degreesOfFreedom);
  const tCritical = studentTQuantile(1 - (1 - confidenceLevel) / 2, degreesOfFreedom);

  const rSquared = sumSquaresY > 0 ? 1 - residualSumSquares / sumSquaresY : null;
  const adjustedRSquared = rSquared === null ? null : 1 - ((1 - rSquared) * (n - 1)) / degreesOfFreedom;

  // ── Influence ──────────────────────────────────────────────────────────
  const leverage = new Float64Array(n);
  const studentizedInternal = new Float64Array(n);
  const studentizedExternal = new Float64Array(n);
  const cookDistance = new Float64Array(n);
  const verticalOutlier = new Uint8Array(n);
  const influential = new Uint8Array(n);
  const verticalOutlierCutoff = studentTQuantile(1 - familyAlpha / (2 * n), n - 3);
  const cookCutoff = options.cookCutoff === "one" ? 1 : 4 / n;
  let verticalOutlierCount = 0;
  let influentialCount = 0;
  for (let index = 0; index < n; index += 1) {
    const deltaX = (xValues[index] as number) - meanX;
    const hat = 1 / n + (deltaX * deltaX) / sumSquaresX;
    leverage[index] = hat;
    const remaining = 1 - hat;
    const internal = remaining > 0 && residualStandardError > 0
      ? (residuals[index] as number) / (residualStandardError * Math.sqrt(remaining))
      : Number.NaN;
    studentizedInternal[index] = internal;
    const external = internal * Math.sqrt((n - 3) / (n - 2 - internal * internal));
    studentizedExternal[index] = external;
    const cook = remaining > 0 ? ((internal * internal) / 2) * (hat / remaining) : Number.NaN;
    cookDistance[index] = cook;
    if (Math.abs(external) > verticalOutlierCutoff) {
      verticalOutlier[index] = 1;
      verticalOutlierCount += 1;
    }
    if (cook > cookCutoff) {
      influential[index] = 1;
      influentialCount += 1;
    }
  }

  // ── Autocorrelation in time order ──────────────────────────────────────
  let squaredSteps = 0;
  let laggedProduct = 0;
  for (let index = 1; index < n; index += 1) {
    const step = (residuals[index] as number) - (residuals[index - 1] as number);
    squaredSteps += step * step;
    laggedProduct += (residuals[index] as number) * (residuals[index - 1] as number);
  }
  const durbinWatson = residualSumSquares > 0 ? squaredSteps / residualSumSquares : Number.NaN;
  const residualLagOneAutocorrelation = residualSumSquares > 0 ? laggedProduct / residualSumSquares : Number.NaN;

  // ── Newey-West slope error ─────────────────────────────────────────────
  // Score of the slope: u_t = (x_t − x̄)·e_t. Long-run variance of Σu with
  // Bartlett weights 1 − l/(L + 1); Var(b) = that / Sxx².
  const neweyWestLag = Math.min(n - 1, options.neweyWestLag ?? neweyWestAutomaticLag(n));
  const score = new Float64Array(n);
  for (let index = 0; index < n; index += 1) {
    score[index] = ((xValues[index] as number) - meanX) * (residuals[index] as number);
  }
  let longRun = 0;
  for (let index = 0; index < n; index += 1) longRun += (score[index] as number) * (score[index] as number);
  for (let lag = 1; lag <= neweyWestLag; lag += 1) {
    let autocovariance = 0;
    for (let index = lag; index < n; index += 1) {
      autocovariance += (score[index] as number) * (score[index - lag] as number);
    }
    longRun += 2 * (1 - lag / (neweyWestLag + 1)) * autocovariance;
  }
  const slopeStandardErrorNeweyWest = longRun > 0 ? Math.sqrt(longRun) / sumSquaresX : 0;
  const slopeTStatisticNeweyWest = slopeStandardErrorNeweyWest > 0
    ? slope / slopeStandardErrorNeweyWest
    : signedInfinity(slope);
  const slopePValueNeweyWest = studentTTwoSidedPValue(slopeTStatisticNeweyWest, degreesOfFreedom);

  // ── Bands along X ──────────────────────────────────────────────────────
  const band: RegressionFit["band"] = {
    x: [], fitted: [], meanLower: [], meanUpper: [], predictionLower: [], predictionUpper: [],
  };
  for (let sample = 0; sample < bandSamples; sample += 1) {
    const x0 = minimumX + ((maximumX - minimumX) * sample) / (bandSamples - 1);
    const center = intercept + slope * x0;
    const distance = ((x0 - meanX) * (x0 - meanX)) / sumSquaresX;
    const meanHalfWidth = tCritical * residualStandardError * Math.sqrt(1 / n + distance);
    const predictionHalfWidth = tCritical * residualStandardError * Math.sqrt(1 + 1 / n + distance);
    band.x.push(x0);
    band.fitted.push(center);
    band.meanLower.push(center - meanHalfWidth);
    band.meanUpper.push(center + meanHalfWidth);
    band.predictionLower.push(center - predictionHalfWidth);
    band.predictionUpper.push(center + predictionHalfWidth);
  }

  const fit: RegressionFit = {
    n,
    degreesOfFreedom,
    confidenceLevel,
    intercept,
    slope,
    interceptStandardError,
    slopeStandardError,
    slopeTStatistic,
    slopePValue,
    slopeConfidenceInterval: [slope - tCritical * slopeStandardError, slope + tCritical * slopeStandardError],
    rSquared,
    adjustedRSquared,
    pearsonCorrelation: pearsonCorrelation(xValues, yValues),
    spearmanCorrelation: spearmanCorrelation(sliceOf(xValues, n), sliceOf(yValues, n)),
    residualStandardError,
    tCritical,
    meanX,
    meanY,
    sumSquaresX,
    minimumX,
    maximumX,
    durbinWatson,
    residualLagOneAutocorrelation,
    spuriousRegressionSuspected: rSquared !== null && Number.isFinite(durbinWatson) && rSquared > durbinWatson,
    neweyWestLag,
    slopeStandardErrorNeweyWest,
    slopeTStatisticNeweyWest,
    slopePValueNeweyWest,
    fitted,
    residuals,
    leverage,
    studentizedInternal,
    studentizedExternal,
    cookDistance,
    verticalOutlier,
    influential,
    verticalOutlierCutoff,
    cookCutoff,
    verticalOutlierCount,
    influentialCount,
    band,
    residualSummary: eightNumberSummary(residuals),
  };
  return { ok: true, fit };
}

function signedInfinity(value: number): number {
  if (value > 0) return Number.POSITIVE_INFINITY;
  if (value < 0) return Number.NEGATIVE_INFINITY;
  return 0;
}

function sliceOf(values: ArrayLike<number>, count: number): ArrayLike<number> {
  return values.length === count ? values : Array.prototype.slice.call(values, 0, count);
}

/**
 * Refit on the points NOT flagged by `exclude`, so a panel can show how much
 * of the line a handful of points was holding up.
 */
export function refitWithout(
  xValues: ArrayLike<number>,
  yValues: ArrayLike<number>,
  exclude: ArrayLike<number>,
  options: RegressionOptions = {},
): RegressionResult {
  const keptX: number[] = [];
  const keptY: number[] = [];
  const count = Math.min(xValues.length, yValues.length);
  for (let index = 0; index < count; index += 1) {
    if (exclude[index]) continue;
    keptX.push(xValues[index] as number);
    keptY.push(yValues[index] as number);
  }
  return fitSimpleRegression(keptX, keptY, options);
}
