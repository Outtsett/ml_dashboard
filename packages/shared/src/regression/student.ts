/**
 * Student's t distribution: density, upper tail and quantile.
 *
 * Every p-value, every confidence and prediction band, and every outlier
 * cut-off in the regression tab runs through these three functions, so they
 * are checked against scipy.stats.t to 1e-9 in tests/shared/regression.test.ts.
 *
 * The tail is the regularized incomplete beta function,
 *
 *   P(T > t) = ½ · I_x(ν/2, ½),   x = ν / (ν + t²),
 *
 * evaluated with the modified Lentz continued fraction (Numerical Recipes
 * §6.4). The quantile inverts the tail by Newton's method on its logarithm,
 * inside a bracket that bisection falls back to, so a tail as small as the
 * Bonferroni cut-off for 20,000 points (1.25e-6) is solved to full precision.
 */

const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** Natural logarithm of the gamma function (Lanczos, g = 7). */
export function logGamma(value: number): number {
  if (value < 0.5) {
    // Reflection: Γ(z)Γ(1−z) = π / sin(πz).
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * value))) - logGamma(1 - value);
  }
  const shifted = value - 1;
  let series = LANCZOS_COEFFICIENTS[0] as number;
  for (let index = 1; index < LANCZOS_COEFFICIENTS.length; index += 1) {
    series += (LANCZOS_COEFFICIENTS[index] as number) / (shifted + index);
  }
  const base = shifted + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(base) - base + Math.log(series);
}

const TINY = 1e-300;
const CONTINUED_FRACTION_EPSILON = 3e-16;
const CONTINUED_FRACTION_ITERATIONS = 20_000;

/** The continued fraction for I_x(a, b); converges fast when x < (a+1)/(a+b+2). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const sum = a + b;
  const plusOne = a + 1;
  const minusOne = a - 1;
  let c = 1;
  let d = 1 - (sum * x) / plusOne;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let result = d;
  for (let step = 1; step <= CONTINUED_FRACTION_ITERATIONS; step += 1) {
    const doubled = 2 * step;
    let coefficient = (step * (b - step) * x) / ((minusOne + doubled) * (a + doubled));
    d = 1 + coefficient * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + coefficient / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    result *= d * c;
    coefficient = (-(a + step) * (sum + step) * x) / ((a + doubled) * (plusOne + doubled));
    d = 1 + coefficient * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + coefficient / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) < CONTINUED_FRACTION_EPSILON) return result;
  }
  return result;
}

/**
 * Regularized incomplete beta I_x(a, b). `complement` is 1 − x, passed in
 * separately so a caller that knows it exactly (t² / (ν + t²)) never loses it
 * to cancellation.
 */
export function regularizedIncompleteBeta(a: number, b: number, x: number, complement = 1 - x): number {
  if (x <= 0) return 0;
  if (complement <= 0) return 1;
  const logFront =
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(complement);
  if (x < (a + 1) / (a + b + 2)) {
    return (Math.exp(logFront) * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (Math.exp(logFront) * betaContinuedFraction(b, a, complement)) / b;
}

/** P(T > t) for Student's t with `degreesOfFreedom` degrees of freedom. */
export function studentTUpperTail(t: number, degreesOfFreedom: number): number {
  if (Number.isNaN(t)) return Number.NaN;
  if (t === Number.POSITIVE_INFINITY) return 0;
  if (t === Number.NEGATIVE_INFINITY) return 1;
  if (t === 0) return 0.5;
  const squared = t * t;
  const denominator = degreesOfFreedom + squared;
  const half =
    0.5 * regularizedIncompleteBeta(degreesOfFreedom / 2, 0.5, degreesOfFreedom / denominator, squared / denominator);
  return t > 0 ? half : 1 - half;
}

/** Two-sided p-value for a t statistic. */
export function studentTTwoSidedPValue(t: number, degreesOfFreedom: number): number {
  if (Number.isNaN(t)) return Number.NaN;
  return Math.min(1, 2 * studentTUpperTail(Math.abs(t), degreesOfFreedom));
}

/** Probability density of Student's t. */
export function studentTDensity(t: number, degreesOfFreedom: number): number {
  const logDensity =
    logGamma((degreesOfFreedom + 1) / 2) -
    logGamma(degreesOfFreedom / 2) -
    0.5 * Math.log(degreesOfFreedom * Math.PI) -
    ((degreesOfFreedom + 1) / 2) * Math.log1p((t * t) / degreesOfFreedom);
  return Math.exp(logDensity);
}

/** Inverse standard normal (Acklam). Used only as the Newton starting point. */
function normalQuantileApproximation(probability: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (probability > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/**
 * The t value with `probability` of the distribution below it — scipy's
 * `t.ppf(probability, df)`.
 */
export function studentTQuantile(probability: number, degreesOfFreedom: number): number {
  if (!(probability >= 0 && probability <= 1) || !(degreesOfFreedom > 0)) return Number.NaN;
  if (probability === 0) return Number.NEGATIVE_INFINITY;
  if (probability === 1) return Number.POSITIVE_INFINITY;
  if (probability === 0.5) return 0;
  if (probability < 0.5) return -upperTailQuantile(probability, degreesOfFreedom);
  return upperTailQuantile(1 - probability, degreesOfFreedom);
}

/** The t > 0 whose upper tail is `tail` (0 < tail < 0.5). */
function upperTailQuantile(tail: number, degreesOfFreedom: number): number {
  if (degreesOfFreedom === 1) return Math.tan(Math.PI * (0.5 - tail));
  if (degreesOfFreedom === 2) return (1 - 2 * tail) / Math.sqrt(2 * tail * (1 - tail));

  // Cornish-Fisher expansion of the normal quantile as the starting point.
  const z = normalQuantileApproximation(1 - tail);
  const z3 = z * z * z;
  let t = z + (z3 + z) / (4 * degreesOfFreedom) +
    (5 * z3 * z * z + 16 * z3 + 3 * z) / (96 * degreesOfFreedom * degreesOfFreedom);
  if (!(t > 0) || !Number.isFinite(t)) t = 1;

  // Bracket: the tail falls from 0.5 at t = 0 towards 0.
  let low = 0;
  let high = Math.max(2 * t, 1);
  while (studentTUpperTail(high, degreesOfFreedom) > tail) {
    low = high;
    high *= 2;
    if (high > 1e300) return Number.POSITIVE_INFINITY;
  }
  if (!(t > low && t < high)) t = 0.5 * (low + high);

  const logTarget = Math.log(tail);
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const current = studentTUpperTail(t, degreesOfFreedom);
    if (current > tail) low = t;
    else high = t;
    // Newton on log(tail): d/dt log P(T > t) = −f(t) / P(T > t).
    const slope = -studentTDensity(t, degreesOfFreedom) / current;
    let next = t - (Math.log(current) - logTarget) / slope;
    if (!(next > low && next < high) || !Number.isFinite(next)) next = 0.5 * (low + high);
    if (Math.abs(next - t) <= 1e-15 * Math.max(1, Math.abs(t))) return next;
    t = next;
  }
  return t;
}
