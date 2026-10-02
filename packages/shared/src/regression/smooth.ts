/**
 * The local trend: a straight line fitted afresh around every X, so a
 * relationship that bends, flattens or reverses shows up where the single
 * straight fit would average it away.
 *
 * LOWESS without robustness iterations — exactly statsmodels'
 * `lowess(y, x, frac=span, it=0, delta=0, xvals=grid)`, whose source this
 * follows line for line (_smoothers_lowess.pyx):
 *
 *   k       = int(span · n + 1e-10) nearest bars, clamped to [2, n]
 *   window  = [left, right) of k sorted bars, slid right while x0 > (x[left] + x[right]) / 2
 *   radius  = max(x0 − x[left], x[right−1] − x0)
 *   w_j     = (1 − (|x_j − x0| / radius)³)³, then divided by Σ w
 *   x̄_w     = Σ w_j x_j            S = Σ w_j (x_j − x̄_w)²
 *   p_j     = w_j · (1 + (x0 − x̄_w)(x_j − x̄_w) / S)          ŷ(x0) = Σ p_j y_j
 *   m_j     = w_j (x_j − x̄_w) / S                               slope(x0) = Σ m_j y_j
 *
 * The band: Var ŷ(x0) = σ² Σ p_j² and Var slope(x0) = σ² Σ m_j², with
 * σ² = RSS / (n − ν), ν = trace of the smoother (its effective number of
 * parameters). RSS uses the fitted curve interpolated at every bar; ν is
 * estimated from the smoother's own weight on each of up to 256 evenly
 * spaced bars — both approximations, stated where they are shown.
 *
 * Given the straight line's residuals, it also reports their local spread,
 * √(Σ w_j r_j²) with the same weights: how far bars typically miss the line
 * around each X. A spread that changes across X is heteroskedasticity — the
 * straight line's bands, which assume one spread everywhere, are then too
 * wide in one place and too narrow in another.
 */

import { studentTQuantile } from "./student";

export interface LocalTrend {
  span: number;
  neighbours: number;
  /** Estimated trace of the smoother matrix. */
  effectiveParameters: number;
  degreesOfFreedom: number;
  residualStandardError: number;
  confidenceLevel: number;
  x: number[];
  fitted: number[];
  lower: number[];
  upper: number[];
  slope: number[];
  slopeStandardError: number[];
  /** Kish effective number of bars behind each local fit: (Σ w)² / Σ w². */
  effectiveCount: number[];
  /** Local root-mean-square of the supplied residuals; empty when none were supplied. */
  residualSpread: number[];
  /** Root-mean-square of all the supplied residuals, for comparison; NaN when none were supplied. */
  overallResidualSpread: number;
}

export interface LocalTrendOptions {
  span?: number;
  evaluationPoints?: number;
  confidenceLevel?: number;
  /** Bars at which the smoother's self-weight is measured to estimate ν. */
  parameterSamples?: number;
  /** The straight line's residuals, in the same order as x and y, for the local spread. */
  residuals?: ArrayLike<number>;
}

export const DEFAULT_TREND_SPAN = 0.3;

interface LocalFit {
  fitted: number;
  slope: number;
  sumSquaredProjection: number;
  sumSquaredSlopeWeights: number;
  effectiveCount: number;
  /** √(Σ w r²) of the residuals, when given. */
  residualSpread: number;
  /** Projection weight on a given sorted index, if it falls in the window; NaN otherwise. */
  weightOn: (sortedIndex: number) => number;
}

/**
 * Sorted-x helper holding the sliding window between calls (x0 must not
 * decrease). The weight buffer is reused, so a fit's `weightOn` is valid only
 * until the next call.
 */
class Neighbourhood {
  left = 0;
  right: number;
  private readonly weights: Float64Array;
  constructor(private readonly x: Float64Array, k: number) {
    this.right = k;
    this.weights = new Float64Array(k);
  }

  fit(x0: number, y: Float64Array, residuals?: Float64Array): LocalFit | null {
    const x = this.x;
    const n = x.length;
    while (this.right < n && x0 > ((x[this.left] as number) + (x[this.right] as number)) / 2) {
      this.left += 1;
      this.right += 1;
    }
    const left = this.left;
    const right = this.right;
    const radius = Math.max(x0 - (x[left] as number), (x[right - 1] as number) - x0);
    // Every neighbour tied at x0: statsmodels divides 0 by 0 here and returns
    // NaN. So does this — any finite answer would depend on which of the tied
    // bars the window happened to include.
    if (!(radius > 0)) return null;
    const weights = this.weights;
    let sumWeights = 0;
    let nonZero = 0;
    for (let j = left; j < right; j += 1) {
      const distance = Math.abs((x[j] as number) - x0) / radius;
      const inner = 1 - distance * distance * distance;
      const weight = inner * inner * inner;
      weights[j - left] = weight;
      sumWeights += weight;
      if (weight > 1e-12) nonZero += 1;
    }
    if (nonZero < 2 || !(sumWeights > 0)) return null;
    let weightedMeanX = 0;
    let sumSquaredWeights = 0;
    for (let j = left; j < right; j += 1) {
      const weight = (weights[j - left] as number) / sumWeights;
      weights[j - left] = weight;
      weightedMeanX += weight * (x[j] as number);
      sumSquaredWeights += weight * weight;
    }
    let spread = 0;
    for (let j = left; j < right; j += 1) {
      spread += (weights[j - left] as number) * ((x[j] as number) - weightedMeanX) ** 2;
    }
    spread = Math.max(spread, 1e-12);
    let fitted = 0;
    let slope = 0;
    let sumSquaredProjection = 0;
    let sumSquaredSlopeWeights = 0;
    let weightedSquaredResidual = 0;
    for (let j = left; j < right; j += 1) {
      const weight = weights[j - left] as number;
      if (residuals) weightedSquaredResidual += weight * (residuals[j] as number) ** 2;
      const centred = (x[j] as number) - weightedMeanX;
      const projection = weight * (1 + ((x0 - weightedMeanX) * centred) / spread);
      const slopeWeight = (weight * centred) / spread;
      fitted += projection * (y[j] as number);
      slope += slopeWeight * (y[j] as number);
      sumSquaredProjection += projection * projection;
      sumSquaredSlopeWeights += slopeWeight * slopeWeight;
    }
    return {
      fitted,
      slope,
      sumSquaredProjection,
      sumSquaredSlopeWeights,
      effectiveCount: 1 / sumSquaredWeights,
      residualSpread: residuals ? Math.sqrt(weightedSquaredResidual) : Number.NaN,
      weightOn: (sortedIndex: number) => {
        if (sortedIndex < left || sortedIndex >= right) return Number.NaN;
        const weight = weights[sortedIndex - left] as number;
        return weight * (1 + ((x0 - weightedMeanX) * ((x[sortedIndex] as number) - weightedMeanX)) / spread);
      },
    };
  }
}

export function localLinearTrend(
  xValues: ArrayLike<number>,
  yValues: ArrayLike<number>,
  options: LocalTrendOptions = {},
): LocalTrend | null {
  const n = Math.min(xValues.length, yValues.length);
  if (n < 5) return null;
  const span = options.span ?? DEFAULT_TREND_SPAN;
  const evaluationPoints = Math.max(2, options.evaluationPoints ?? 60);
  const confidenceLevel = options.confidenceLevel ?? 0.95;

  const order = new Uint32Array(n);
  for (let index = 0; index < n; index += 1) order[index] = index;
  order.sort((left, right) => (xValues[left] as number) - (xValues[right] as number) || left - right);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const supplied = options.residuals;
  const residuals = supplied && supplied.length >= n ? new Float64Array(n) : undefined;
  for (let index = 0; index < n; index += 1) {
    const source = order[index] as number;
    x[index] = xValues[source] as number;
    y[index] = yValues[source] as number;
    if (residuals) residuals[index] = supplied![source] as number;
  }
  let overallResidualSpread = Number.NaN;
  if (residuals) {
    let squares = 0;
    for (const value of residuals) squares += value * value;
    overallResidualSpread = Math.sqrt(squares / n);
  }
  const minimumX = x[0] as number;
  const maximumX = x[n - 1] as number;
  if (!(maximumX > minimumX)) return null;
  const k = Math.min(n, Math.max(2, Math.floor(span * n + 1e-10)));

  // ── The curve on an even grid ─────────────────────────────────────────
  const grid: number[] = [];
  const fits: Array<LocalFit | null> = [];
  const curve = new Neighbourhood(x, k);
  for (let index = 0; index < evaluationPoints; index += 1) {
    const x0 = minimumX + ((maximumX - minimumX) * index) / (evaluationPoints - 1);
    grid.push(x0);
    fits.push(curve.fit(x0, y, residuals));
  }

  // ── σ² = RSS / (n − ν) ────────────────────────────────────────────────
  const fittedAt = (value: number): number => {
    const position = ((value - minimumX) / (maximumX - minimumX)) * (evaluationPoints - 1);
    const lower = Math.max(0, Math.min(evaluationPoints - 2, Math.floor(position)));
    const fraction = position - lower;
    const a = fits[lower]?.fitted ?? Number.NaN;
    const b = fits[lower + 1]?.fitted ?? Number.NaN;
    return a + (b - a) * fraction;
  };
  let residualSumSquares = 0;
  let residualCount = 0;
  for (let index = 0; index < n; index += 1) {
    const residual = (y[index] as number) - fittedAt(x[index] as number);
    if (Number.isFinite(residual)) {
      residualSumSquares += residual * residual;
      residualCount += 1;
    }
  }
  const samples = Math.min(n, options.parameterSamples ?? 256);
  const selfWeights = new Neighbourhood(x, k);
  let selfWeightSum = 0;
  let selfWeightCount = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const sortedIndex = Math.round((sample * (n - 1)) / Math.max(1, samples - 1));
    const fit = selfWeights.fit(x[sortedIndex] as number, y);
    const weight = fit?.weightOn(sortedIndex);
    if (weight !== undefined && Number.isFinite(weight)) {
      selfWeightSum += weight;
      selfWeightCount += 1;
    }
  }
  const effectiveParameters = selfWeightCount > 0 ? (n * selfWeightSum) / selfWeightCount : 2;
  const degreesOfFreedom = Math.max(1, residualCount - effectiveParameters);
  const residualStandardError = Math.sqrt(residualSumSquares / degreesOfFreedom);
  const critical = studentTQuantile(1 - (1 - confidenceLevel) / 2, degreesOfFreedom);

  const fitted: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];
  const slope: number[] = [];
  const slopeStandardError: number[] = [];
  const effectiveCount: number[] = [];
  const residualSpread: number[] = [];
  for (const fit of fits) {
    if (!fit) {
      fitted.push(Number.NaN); lower.push(Number.NaN); upper.push(Number.NaN);
      slope.push(Number.NaN); slopeStandardError.push(Number.NaN); effectiveCount.push(Number.NaN);
      if (residuals) residualSpread.push(Number.NaN);
      continue;
    }
    if (residuals) residualSpread.push(fit.residualSpread);
    const halfWidth = critical * residualStandardError * Math.sqrt(fit.sumSquaredProjection);
    fitted.push(fit.fitted);
    lower.push(fit.fitted - halfWidth);
    upper.push(fit.fitted + halfWidth);
    slope.push(fit.slope);
    slopeStandardError.push(residualStandardError * Math.sqrt(fit.sumSquaredSlopeWeights));
    effectiveCount.push(fit.effectiveCount);
  }

  return {
    span, neighbours: k, effectiveParameters, degreesOfFreedom, residualStandardError, confidenceLevel,
    x: grid, fitted, lower, upper, slope, slopeStandardError, effectiveCount, residualSpread, overallResidualSpread,
  };
}

/** The trend's values at the grid point nearest x (for a tooltip). */
export function trendAt(trend: LocalTrend, value: number): {
  x: number; fitted: number; lower: number; upper: number; slope: number; slopeStandardError: number; effectiveCount: number;
  residualSpread: number;
} | null {
  const count = trend.x.length;
  if (count === 0) return null;
  const first = trend.x[0] as number;
  const last = trend.x[count - 1] as number;
  const index = Math.max(0, Math.min(count - 1, Math.round(((value - first) / (last - first || 1)) * (count - 1))));
  const fitted = trend.fitted[index] as number;
  if (!Number.isFinite(fitted)) return null;
  return {
    x: trend.x[index] as number,
    fitted,
    lower: trend.lower[index] as number,
    upper: trend.upper[index] as number,
    slope: trend.slope[index] as number,
    slopeStandardError: trend.slopeStandardError[index] as number,
    effectiveCount: trend.effectiveCount[index] as number,
    residualSpread: trend.residualSpread[index] ?? Number.NaN,
  };
}
