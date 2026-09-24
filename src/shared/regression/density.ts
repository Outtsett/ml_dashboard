/**
 * Where the bars actually sit: a 2-D kernel density on a grid, and the
 * contours that enclose the densest 50%, 80% and 95% of them.
 *
 * Binned kernel density estimate. Each point is spread over the four nearest
 * grid cells (linear binning), then the grid is blurred by a Gaussian with
 * Scott's bandwidth on each axis:
 *
 *   h_x = n^(-1/6) · σ_x        h_y = n^(-1/6) · σ_y
 *
 * (in two dimensions Scott's and Silverman's factors coincide). The kernel is
 * the product of the two — axis-aligned, not rotated by the x/y correlation.
 * Binning then blurring is the standard fast approximation to evaluating the
 * kernel at every cell; tests/shared/regression.test.ts compares it with the
 * exact product-kernel estimate.
 *
 * Highest-density regions, by Hyndman's (1996) density-quantile method:
 * evaluate the estimated density at every bar, and the contour for coverage p
 * is the (1 − p) quantile of those values. So the 50% contour encloses the
 * densest half of the actual bars — by construction, not by the smoothed
 * surface's mass, which the kernel spreads outward.
 */

export interface DensityLevel {
  /** Share of the bars inside this contour. */
  coverage: number;
  /** Cell mass at the contour. */
  threshold: number;
}

export interface DensityGrid {
  columns: number;
  rows: number;
  /** The grid spans [minimumX, maximumX] × [minimumY, maximumY]; cell (i, j) is centred at min + (index + 0.5) · cell. */
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
  /** Probability mass per cell, summing to 1; index i + j · columns, j counting up from minimumY. */
  values: Float64Array;
  bandwidthX: number;
  bandwidthY: number;
  levels: DensityLevel[];
  /** Density at the bars, at percentiles 0, 1, …, 100 — for "which region is this spot in". */
  pointPercentiles: Float64Array;
}

export interface DensityOptions {
  columns?: number;
  rows?: number;
  coverages?: number[];
}

export const DEFAULT_DENSITY_COVERAGES = [0.5, 0.8, 0.95];

function sampleDeviation(values: ArrayLike<number>, count: number): number {
  let sum = 0;
  for (let index = 0; index < count; index += 1) sum += values[index] as number;
  const mean = sum / count;
  let squares = 0;
  for (let index = 0; index < count; index += 1) {
    const delta = (values[index] as number) - mean;
    squares += delta * delta;
  }
  return Math.sqrt(squares / (count - 1));
}

function gaussianKernel(sigmaCells: number): Float64Array {
  const radius = Math.max(1, Math.ceil(4 * sigmaCells));
  const kernel = new Float64Array(2 * radius + 1);
  for (let offset = -radius; offset <= radius; offset += 1) {
    kernel[offset + radius] = Math.exp(-0.5 * (offset / sigmaCells) ** 2);
  }
  return kernel;
}

/** Blur along one axis; mass that would fall outside the grid is dropped. */
function blur(source: Float64Array, columns: number, rows: number, kernel: Float64Array, alongColumns: boolean): Float64Array {
  const out = new Float64Array(source.length);
  const radius = (kernel.length - 1) / 2;
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const value = source[i + j * columns] as number;
      if (value === 0) continue;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const ti = alongColumns ? i + offset : i;
        const tj = alongColumns ? j : j + offset;
        if (ti < 0 || ti >= columns || tj < 0 || tj >= rows) continue;
        out[ti + tj * columns] = (out[ti + tj * columns] as number) + value * (kernel[offset + radius] as number);
      }
    }
  }
  return out;
}

export function densityGrid(
  xValues: ArrayLike<number>,
  yValues: ArrayLike<number>,
  options: DensityOptions = {},
): DensityGrid | null {
  const count = Math.min(xValues.length, yValues.length);
  if (count < 3) return null;
  const columns = options.columns ?? 64;
  const rows = options.rows ?? 48;
  const deviationX = sampleDeviation(xValues, count);
  const deviationY = sampleDeviation(yValues, count);
  if (!(deviationX > 0) || !(deviationY > 0)) return null;
  const factor = Math.pow(count, -1 / 6);
  const bandwidthX = factor * deviationX;
  const bandwidthY = factor * deviationY;

  let lowX = Number.POSITIVE_INFINITY;
  let highX = Number.NEGATIVE_INFINITY;
  let lowY = Number.POSITIVE_INFINITY;
  let highY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const x = xValues[index] as number;
    const y = yValues[index] as number;
    if (x < lowX) lowX = x;
    if (x > highX) highX = x;
    if (y < lowY) lowY = y;
    if (y > highY) highY = y;
  }
  // Pad by three bandwidths so the kernel's tails stay on the grid.
  const minimumX = lowX - 3 * bandwidthX;
  const maximumX = highX + 3 * bandwidthX;
  const minimumY = lowY - 3 * bandwidthY;
  const maximumY = highY + 3 * bandwidthY;
  const cellX = (maximumX - minimumX) / columns;
  const cellY = (maximumY - minimumY) / rows;

  // Linear binning: each point's unit mass split over the four nearest cell centres.
  const binned = new Float64Array(columns * rows);
  const deposit = (i: number, j: number, weight: number) => {
    if (i < 0 || i >= columns || j < 0 || j >= rows) return;
    binned[i + j * columns] = (binned[i + j * columns] as number) + weight;
  };
  for (let index = 0; index < count; index += 1) {
    const gx = ((xValues[index] as number) - minimumX) / cellX - 0.5;
    const gy = ((yValues[index] as number) - minimumY) / cellY - 0.5;
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    const fx = gx - i0;
    const fy = gy - j0;
    deposit(i0, j0, (1 - fx) * (1 - fy));
    deposit(i0 + 1, j0, fx * (1 - fy));
    deposit(i0, j0 + 1, (1 - fx) * fy);
    deposit(i0 + 1, j0 + 1, fx * fy);
  }

  const blurred = blur(
    blur(binned, columns, rows, gaussianKernel(bandwidthX / cellX), true),
    columns,
    rows,
    gaussianKernel(bandwidthY / cellY),
    false,
  );
  let total = 0;
  for (const value of blurred) total += value;
  const values = new Float64Array(blurred.length);
  for (let index = 0; index < blurred.length; index += 1) values[index] = (blurred[index] as number) / total;

  const partial: DensityGrid = {
    columns, rows, minimumX, maximumX, minimumY, maximumY, values,
    bandwidthX, bandwidthY, levels: [], pointPercentiles: new Float64Array(0),
  };
  const atPoints = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    atPoints[index] = densityAt(partial, xValues[index] as number, yValues[index] as number);
  }
  atPoints.sort();
  const pointPercentiles = new Float64Array(101);
  for (let percentile = 0; percentile <= 100; percentile += 1) {
    const position = (percentile / 100) * (count - 1);
    const lower = Math.floor(position);
    const upper = Math.min(count - 1, lower + 1);
    pointPercentiles[percentile] = (atPoints[lower] as number) + ((atPoints[upper] as number) - (atPoints[lower] as number)) * (position - lower);
  }
  const levels = (options.coverages ?? DEFAULT_DENSITY_COVERAGES).map((coverage) => {
    const position = (1 - coverage) * (count - 1);
    const lower = Math.floor(position);
    const upper = Math.min(count - 1, lower + 1);
    const threshold = (atPoints[lower] as number) + ((atPoints[upper] as number) - (atPoints[lower] as number)) * (position - lower);
    return { coverage, threshold };
  });

  return {
    columns, rows, minimumX, maximumX, minimumY, maximumY, values,
    bandwidthX, bandwidthY, levels, pointPercentiles,
  };
}

/** Cell mass at a point, interpolated between cell centres; 0 off the grid. */
export function densityAt(grid: DensityGrid, x: number, y: number): number {
  const gx = ((x - grid.minimumX) / (grid.maximumX - grid.minimumX)) * grid.columns - 0.5;
  const gy = ((y - grid.minimumY) / (grid.maximumY - grid.minimumY)) * grid.rows - 0.5;
  if (!(gx >= -0.5 && gx <= grid.columns - 0.5 && gy >= -0.5 && gy <= grid.rows - 0.5)) return 0;
  const i0 = Math.max(0, Math.min(grid.columns - 2, Math.floor(gx)));
  const j0 = Math.max(0, Math.min(grid.rows - 2, Math.floor(gy)));
  const fx = Math.max(0, Math.min(1, gx - i0));
  const fy = Math.max(0, Math.min(1, gy - j0));
  const values = grid.values;
  const base = i0 + j0 * grid.columns;
  return (
    (values[base] as number) * (1 - fx) * (1 - fy) +
    (values[base + 1] as number) * fx * (1 - fy) +
    (values[base + grid.columns] as number) * (1 - fx) * fy +
    (values[base + grid.columns + 1] as number) * fx * fy
  );
}

/**
 * The smallest highest-density region containing this spot, as a share of
 * the bars: 0.3 means "inside the region holding the densest 30% of bars",
 * 1 means nowhere near them.
 */
export function densityRegionAt(grid: DensityGrid, x: number, y: number): number {
  const value = densityAt(grid, x, y);
  const percentiles = grid.pointPercentiles;
  if (!(value > (percentiles[0] as number))) return 1;
  if (value >= (percentiles[100] as number)) return 0;
  let percentile = 0;
  while (percentile < 100 && (percentiles[percentile + 1] as number) <= value) percentile += 1;
  const low = percentiles[percentile] as number;
  const high = percentiles[percentile + 1] as number;
  const fraction = high > low ? (value - low) / (high - low) : 0;
  return 1 - (percentile + fraction) / 100;
}
