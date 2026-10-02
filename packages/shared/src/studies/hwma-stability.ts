/**
 * Holt-Winters moving average (HWMA) stability: the response body of
 * `GET /api/studies/hwma-stability` and the pure maths the page and its tests
 * share. Replaced notebooks/hwma_stability.py.
 *
 * The recursion here is `calcHWMA` (market/lib/calculators/overlay/averages.ts)
 * without its early `break`: the notebook keeps iterating past the bound to ask
 * "what would the recursion have done", and records where the chart's guard
 * would have stopped drawing. A test holds the guarded path equal to
 * `calcHWMA`'s own output, so there is one definition of the average.
 *
 * Statistics follow the notebook (scipy defaults): sample standard deviation
 * (n - 1), biased skewness g1 and biased EXCESS kurtosis g2, percentiles by
 * linear interpolation. Nothing here is a moving statistic; there is no
 * look-ahead to guard.
 */

import type { EightNumberSummary } from "../analytics/types";
import { quantileSorted, sortedFinite } from "../lens/stats";

/** One row of `derived_study_hwma_stability_grid`: one (na, nb, nc) measured on the closes. */
export interface HwmaGridRow {
  na: number;
  nb: number;
  nc: number;
  spectral_radius: number;
  spectrally_stable: boolean;
  bars_emitted: number;
  left_range_at_bar: number | null;
  emitted_minimum: number;
  emitted_maximum: number;
  unbounded_minimum: number;
  unbounded_maximum: number;
  went_negative_unbounded: boolean;
  went_negative_emitted: boolean;
}

/** One row of `derived_study_hwma_stability_price_series`. */
export interface HwmaPricePoint {
  bar_index: number;
  /** Epoch ms of the stamped instant (the lake stamps futures in Pacific wall clock). */
  timestamp_ms: number;
  close: number;
}

/** The single row of `derived_study_hwma_stability_run_information`. */
export interface HwmaRunInformation {
  generated_at_ms: number;
  symbol: string;
  bars: number;
  snapshot: string;
  grid_step: number;
  grid_size: number;
  default_na: number;
  default_nb: number;
  default_nc: number;
  default_spectral_radius: number;
  range_multiple: number;
  source: string;
  measures: string;
  build_seconds: number;
  recipe: string;
}

export interface HwmaStabilityBody {
  runInformation: HwmaRunInformation | null;
  prices: HwmaPricePoint[];
  grid: HwmaGridRow[];
}

// ---------------------------------------------------------------------------
// The state matrix and its eigenvalues
// ---------------------------------------------------------------------------

export type Matrix3 = [[number, number, number], [number, number, number], [number, number, number]];

export interface ComplexNumber {
  real: number;
  imaginary: number;
}

/**
 * Maps [level, velocity, acceleration] to its next value. The price is an input,
 * not part of the loop, so this matrix alone decides stability.
 */
export function stateMatrix(na: number, nb: number, nc: number): Matrix3 {
  const level = [1 - na, 1 - na, 0.5 * (1 - na)] as const;
  const levelChange = [level[0] - 1, level[1], level[2]] as const;
  const velocity = [nb * levelChange[0], nb * levelChange[1] + (1 - nb), nb * levelChange[2] + (1 - nb)] as const;
  const velocityChange = [velocity[0], velocity[1] - 1, velocity[2]] as const;
  const acceleration = [nc * velocityChange[0], nc * velocityChange[1], nc * velocityChange[2] + (1 - nc)] as const;
  return [[...level], [...velocity], [...acceleration]] as Matrix3;
}

function polish(root: ComplexNumber, a: number, b: number, c: number): ComplexNumber {
  // Newton on z^3 + a z^2 + b z + c in complex arithmetic, a few steps to clear the closed form's rounding.
  let { real: x, imaginary: y } = root;
  for (let step = 0; step < 4; step += 1) {
    const x2 = x * x - y * y;
    const y2 = 2 * x * y;
    const x3 = x2 * x - y2 * y;
    const y3 = x2 * y + y2 * x;
    const fr = x3 + a * x2 + b * x + c;
    const fi = y3 + a * y2 + b * y;
    const dr = 3 * x2 + 2 * a * x + b;
    const di = 3 * y2 + 2 * a * y;
    const denominator = dr * dr + di * di;
    if (!(denominator > 1e-300)) break;
    const stepReal = (fr * dr + fi * di) / denominator;
    const stepImaginary = (fi * dr - fr * di) / denominator;
    x -= stepReal;
    y -= stepImaginary;
  }
  return { real: x, imaginary: y };
}

/** The three eigenvalues of a 3 x 3 real matrix (closed-form cubic, then polished). */
export function eigenvalues(matrix: Matrix3): ComplexNumber[] {
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = matrix;
  const trace = m00 + m11 + m22;
  const minors = (m00 * m11 - m01 * m10) + (m00 * m22 - m02 * m20) + (m11 * m22 - m12 * m21);
  const determinant = m00 * (m11 * m22 - m12 * m21) - m01 * (m10 * m22 - m12 * m20) + m02 * (m10 * m21 - m11 * m20);
  // characteristic polynomial: lambda^3 + a lambda^2 + b lambda + c
  const a = -trace;
  const b = minors;
  const c = -determinant;
  const p = b - (a * a) / 3;
  const q = (2 * a * a * a) / 27 - (a * b) / 3 + c;
  const shift = a / 3;
  const discriminant = (q * q) / 4 + (p * p * p) / 27;
  const roots: ComplexNumber[] = [];
  if (discriminant > 0) {
    const root = Math.sqrt(discriminant);
    const u = Math.cbrt(-q / 2 + root);
    const v = Math.cbrt(-q / 2 - root);
    roots.push({ real: u + v - shift, imaginary: 0 });
    roots.push({ real: -(u + v) / 2 - shift, imaginary: (Math.sqrt(3) / 2) * (u - v) });
    roots.push({ real: -(u + v) / 2 - shift, imaginary: -(Math.sqrt(3) / 2) * (u - v) });
  } else if (p > -1e-300) {
    const t = Math.cbrt(-q);
    for (let k = 0; k < 3; k += 1) roots.push({ real: t - shift, imaginary: 0 });
  } else {
    const radius = 2 * Math.sqrt(-p / 3);
    const argument = Math.max(-1, Math.min(1, ((3 * q) / (2 * p)) * Math.sqrt(-3 / p)));
    const angle = Math.acos(argument) / 3;
    for (let k = 0; k < 3; k += 1) roots.push({ real: radius * Math.cos(angle - (2 * Math.PI * k) / 3) - shift, imaginary: 0 });
  }
  return roots.map((root) => polish(root, a, b, c));
}

export function spectralRadius(na: number, nb: number, nc: number): number {
  let largest = 0;
  for (const value of eigenvalues(stateMatrix(na, nb, nc))) largest = Math.max(largest, Math.hypot(value.real, value.imaginary));
  return largest;
}

// ---------------------------------------------------------------------------
// The recursion
// ---------------------------------------------------------------------------

export interface HwmaRun {
  level: Float64Array;
  velocity: Float64Array;
  acceleration: Float64Array;
  /** First bar whose level left [floor, ceiling] (or was not finite); null when it never did. */
  leftAt: number | null;
  floor: number;
  ceiling: number;
  /** Smallest / largest finite level over the whole unbounded run. */
  unboundedMinimum: number;
  unboundedMaximum: number;
}

/**
 * The HWMA recursion over `closes`, unbounded, plus where the chart's bound
 * (`rangeMultiple` data ranges beyond the closes' own low and high) first fails.
 */
export function hwmaRun(closes: ArrayLike<number>, na: number, nb: number, nc: number, rangeMultiple = 10): HwmaRun {
  const count = closes.length;
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const close = closes[i] as number;
    if (close < low) low = close;
    if (close > high) high = close;
  }
  const span = Math.max(high - low, Math.abs(high) * 1e-6, 1e-9);
  const floor = low - rangeMultiple * span;
  const ceiling = high + rangeMultiple * span;

  const level = new Float64Array(count);
  const velocity = new Float64Array(count);
  const acceleration = new Float64Array(count);
  let F = count > 0 ? (closes[0] as number) : 0;
  let V = 0;
  let A = 0;
  if (count > 0) level[0] = F;
  let leftAt: number | null = null;
  let unboundedMinimum = F;
  let unboundedMaximum = F;
  for (let i = 1; i < count; i += 1) {
    const previousF = F;
    const previousV = V;
    const previousA = A;
    F = (1 - na) * (previousF + previousV + 0.5 * previousA) + na * (closes[i] as number);
    V = (1 - nb) * (previousV + previousA) + nb * (F - previousF);
    A = (1 - nc) * previousA + nc * (V - previousV);
    level[i] = F;
    velocity[i] = V;
    acceleration[i] = A;
    if (Number.isFinite(F)) {
      if (F < unboundedMinimum) unboundedMinimum = F;
      if (F > unboundedMaximum) unboundedMaximum = F;
    }
    if (leftAt === null && (!Number.isFinite(F) || F < floor || F > ceiling)) leftAt = i;
  }
  return { level, velocity, acceleration, leftAt, floor, ceiling, unboundedMinimum, unboundedMaximum };
}

/** The level as the chart draws it: nothing from the bar it left the bound onward (when `guard`). */
export function emittedLevel(run: HwmaRun, guard: boolean): Array<number | null> {
  const out: Array<number | null> = [];
  for (let i = 0; i < run.level.length; i += 1) {
    const value = run.level[i] as number;
    if (guard && run.leftAt !== null && i >= run.leftAt) out.push(null);
    else out.push(Number.isFinite(value) ? value : null);
  }
  return out;
}

/** Round a slider value onto the 0.05 grid (slider arithmetic yields 0.15000000000000002). */
export function onGrid(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The measured grid row at (na, nb, nc), or null off the grid. */
export function gridRowAt(rows: readonly HwmaGridRow[], na: number, nb: number, nc: number): HwmaGridRow | null {
  for (const row of rows) {
    if (Math.abs(row.na - na) < 1e-9 && Math.abs(row.nb - nb) < 1e-9 && Math.abs(row.nc - nc) < 1e-9) return row;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-acceleration counts and the rho = 1 contour
// ---------------------------------------------------------------------------

export interface AccelerationCounts {
  nc: number;
  unstable: number;
  goesNegative: number;
  stoppedEarly: number;
  combinations: number;
}

export function countsByAcceleration(rows: readonly HwmaGridRow[]): AccelerationCounts[] {
  const byAcceleration = new Map<number, AccelerationCounts>();
  for (const row of rows) {
    const key = onGrid(row.nc);
    let entry = byAcceleration.get(key);
    if (!entry) {
      entry = { nc: key, unstable: 0, goesNegative: 0, stoppedEarly: 0, combinations: 0 };
      byAcceleration.set(key, entry);
    }
    entry.combinations += 1;
    if (!row.spectrally_stable) entry.unstable += 1;
    if (row.went_negative_unbounded) entry.goesNegative += 1;
    if (row.left_range_at_bar !== null) entry.stoppedEarly += 1;
  }
  return [...byAcceleration.values()].sort((a, b) => a.nc - b.nc);
}

/** One line segment of a contour, in (na, nb) data coordinates. */
export type Segment = [number, number, number, number];

/**
 * Marching squares for spectral radius = 1 at acceleration `nc`, over
 * [low, high]^2 at `steps` intervals per axis. The radius is analytic, so the
 * boundary is drawn from the eigenvalues, not interpolated between the 0.05 grid.
 */
export function radiusContour(nc: number, low = 0.05, high = 0.95, steps = 72, level = 1): Segment[] {
  const width = (high - low) / steps;
  const values: number[][] = [];
  for (let row = 0; row <= steps; row += 1) {
    const line: number[] = [];
    for (let column = 0; column <= steps; column += 1) line.push(spectralRadius(low + column * width, low + row * width, nc) - level);
    values.push(line);
  }
  const segments: Segment[] = [];
  const crossing = (x0: number, y0: number, v0: number, x1: number, y1: number, v1: number): [number, number] => {
    const t = v0 === v1 ? 0.5 : v0 / (v0 - v1);
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  };
  for (let row = 0; row < steps; row += 1) {
    for (let column = 0; column < steps; column += 1) {
      const x0 = low + column * width;
      const x1 = x0 + width;
      const y0 = low + row * width;
      const y1 = y0 + width;
      const v00 = values[row]![column]!;
      const v10 = values[row]![column + 1]!;
      const v11 = values[row + 1]![column + 1]!;
      const v01 = values[row + 1]![column]!;
      const points: Array<[number, number]> = [];
      if (v00 > 0 !== v10 > 0) points.push(crossing(x0, y0, v00, x1, y0, v10));
      if (v10 > 0 !== v11 > 0) points.push(crossing(x1, y0, v10, x1, y1, v11));
      if (v11 > 0 !== v01 > 0) points.push(crossing(x1, y1, v11, x0, y1, v01));
      if (v01 > 0 !== v00 > 0) points.push(crossing(x0, y1, v01, x0, y0, v00));
      if (points.length === 2) segments.push([points[0]![0], points[0]![1], points[1]![0], points[1]![1]]);
      else if (points.length === 4) {
        // a saddle: pair the crossings by the cell centre's side
        const centre = (v00 + v10 + v11 + v01) / 4 > 0;
        const pairs: Array<[number, number]> = centre === v00 > 0 ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
        for (const [i, j] of pairs) segments.push([points[i]![0], points[i]![1], points[j]![0], points[j]![1]]);
      }
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Per-column statistics and histograms (the notebook's definitions)
// ---------------------------------------------------------------------------

/** The eight numbers with scipy defaults; null where the notebook's guard makes one meaningless. */
export function columnSummary(values: ArrayLike<number>): EightNumberSummary {
  const sorted = sortedFinite(values);
  const count = sorted.length;
  if (count === 0) {
    return { count: 0, mean: null, median: null, standardDeviation: null, skewness: null, kurtosis: null, percentile25: null, percentile75: null, minimum: null, maximum: null };
  }
  let total = 0;
  for (let i = 0; i < count; i += 1) total += sorted[i] as number;
  const mean = total / count;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < count; i += 1) {
    const delta = (sorted[i] as number) - mean;
    const squared = delta * delta;
    m2 += squared;
    m3 += squared * delta;
    m4 += squared * squared;
  }
  m2 /= count;
  m3 /= count;
  m4 /= count;
  const minimum = sorted[0] as number;
  const maximum = sorted[count - 1] as number;
  const varied = maximum - minimum > 0;
  return {
    count,
    mean,
    median: quantileSorted(sorted, 0.5),
    standardDeviation: count > 1 ? Math.sqrt((m2 * count) / (count - 1)) : null,
    skewness: count > 2 && varied ? m3 / Math.pow(m2, 1.5) : null,
    kurtosis: count > 3 && varied ? m4 / (m2 * m2) - 3 : null,
    percentile25: quantileSorted(sorted, 0.25),
    percentile75: quantileSorted(sorted, 0.75),
    minimum,
    maximum,
  };
}

export interface ColumnBin {
  left: number;
  right: number;
  count: number;
}

export interface ColumnHistogram {
  /** True when the bins are over log10 |value| because the column spans orders of magnitude. */
  logScale: boolean;
  bins: ColumnBin[];
}

/**
 * Equal-width bins between the minimum and maximum. A column whose positive
 * values span more than four orders of magnitude is binned over log10 |value|,
 * so a tail at 1e90 does not collapse every ordinary value into one bar.
 */
export function columnHistogram(values: ArrayLike<number>, binCount = 40, logMode: "auto" | "always" | "never" = "auto"): ColumnHistogram {
  const finite = Array.from(sortedFinite(values));
  if (finite.length === 0) return { logScale: false, bins: [] };
  let smallestPositive = Infinity;
  let largestPositive = -Infinity;
  for (const value of finite) {
    if (value > 0) {
      if (value < smallestPositive) smallestPositive = value;
      if (value > largestPositive) largestPositive = value;
    }
  }
  const wide = largestPositive > -Infinity && largestPositive / Math.max(smallestPositive, 1e-12) > 1e4;
  const logScale = logMode === "always" || (logMode === "auto" && wide);
  const shown = logScale ? finite.map((value) => Math.log10(Math.abs(value) + 1e-12)).sort((a, b) => a - b) : finite;
  let lower = shown[0] as number;
  let upper = shown[shown.length - 1] as number;
  if (upper === lower) {
    lower -= 0.5;
    upper += 0.5;
  }
  const width = (upper - lower) / binCount;
  const bins: ColumnBin[] = Array.from({ length: binCount }, (_, i) => ({ left: lower + i * width, right: lower + (i + 1) * width, count: 0 }));
  for (const value of shown) {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((value - lower) / width)));
    (bins[index] as ColumnBin).count += 1;
  }
  return { logScale, bins };
}

/** The numeric (non-boolean) columns of the grid, in table order. */
export const GRID_NUMERIC_COLUMNS = [
  "na", "nb", "nc", "spectral_radius", "bars_emitted", "left_range_at_bar",
  "emitted_minimum", "emitted_maximum", "unbounded_minimum", "unbounded_maximum",
] as const satisfies ReadonlyArray<keyof HwmaGridRow>;

export type GridNumericColumn = (typeof GRID_NUMERIC_COLUMNS)[number];

export function columnValues(rows: readonly HwmaGridRow[], column: GridNumericColumn): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const value = row[column];
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out;
}
