/**
 * Groups of bars that sit together on the scatter — k-means on the two axes,
 * each standardized to mean 0 and standard deviation 1 so neither unit
 * dominates the distance.
 *
 * Lloyd's algorithm, matching scikit-learn's `KMeans(algorithm="lloyd",
 * tol=0)` given the same starting centres: assign every point to its nearest
 * centre, move each centre to the mean of its points, stop when no point
 * changes group. Starting centres come from k-means++ (Arthur & Vassilvitskii
 * 2007) with a fixed seed, so the same data always gives the same groups.
 *
 * The number of groups is the k in 2..5 with the highest silhouette — for each
 * point, (b − a) / max(a, b), where a is its mean distance to its own group and
 * b to the nearest other group. Kaufman & Rousseeuw's reading of the average:
 * below 0.25 there is no substantial structure, 0.25–0.5 weak, 0.5–0.7
 * reasonable, above 0.7 strong. The silhouette is computed on a subset of
 * bars (it costs n² distances), and the centres are fitted on a subset of at
 * most FIT_SAMPLE bars, then every bar is assigned to its nearest centre — the
 * cost stays flat as the window grows, and a few thousand bars pin the centres
 * of at most five groups. Both subsets are seeded random draws, not every
 * m-th bar: a fixed stride can alias with a period in the bars (every fifth
 * daily bar is the same weekday) and sample one slice of the cloud.
 */

import { createRandom } from "../lens/bootstrap";

export interface KMeansResult {
  k: number;
  labels: Int32Array;
  centersX: number[];
  centersY: number[];
  /** Sum of squared distances from each point to its centre. */
  inertia: number;
  iterations: number;
}

export type ClusterStructure = "none" | "weak" | "reasonable" | "strong";

export interface ClusterSummary extends KMeansResult {
  /** Centres back in the data's own units (KMeansResult's centres are standardized). */
  centersDataX: number[];
  centersDataY: number[];
  silhouette: number;
  structure: ClusterStructure;
  /** Silhouette of every k tried, for the tooltip. */
  silhouetteByK: Array<{ k: number; silhouette: number }>;
  sizes: number[];
}

export const CLUSTER_SEED = 0x5bd1e995;
export const SILHOUETTE_SAMPLE = 500;
export const FIT_SAMPLE = 3000;

function squaredDistance(x: number, y: number, cx: number, cy: number): number {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy;
}

/** k-means++ seeding: each new centre drawn with probability proportional to its squared distance from the nearest existing one. */
export function kMeansPlusPlus(x: ArrayLike<number>, y: ArrayLike<number>, k: number, random: () => number): { centersX: number[]; centersY: number[] } {
  const n = x.length;
  const first = Math.min(n - 1, Math.floor(random() * n));
  const centersX = [x[first] as number];
  const centersY = [y[first] as number];
  const nearest = new Float64Array(n);
  for (let index = 0; index < n; index += 1) {
    nearest[index] = squaredDistance(x[index] as number, y[index] as number, centersX[0] as number, centersY[0] as number);
  }
  while (centersX.length < k) {
    let total = 0;
    for (const value of nearest) total += value;
    let chosen = n - 1;
    if (total > 0) {
      let target = random() * total;
      for (let index = 0; index < n; index += 1) {
        target -= nearest[index] as number;
        if (target < 0) {
          chosen = index;
          break;
        }
      }
    }
    const cx = x[chosen] as number;
    const cy = y[chosen] as number;
    centersX.push(cx);
    centersY.push(cy);
    for (let index = 0; index < n; index += 1) {
      const distance = squaredDistance(x[index] as number, y[index] as number, cx, cy);
      if (distance < (nearest[index] as number)) nearest[index] = distance;
    }
  }
  return { centersX, centersY };
}

function assign(x: ArrayLike<number>, y: ArrayLike<number>, centersX: number[], centersY: number[], labels: Int32Array, distances: Float64Array) {
  const n = x.length;
  const k = centersX.length;
  for (let index = 0; index < n; index += 1) {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let cluster = 0; cluster < k; cluster += 1) {
      const distance = squaredDistance(x[index] as number, y[index] as number, centersX[cluster] as number, centersY[cluster] as number);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = cluster;
      }
    }
    labels[index] = best;
    distances[index] = bestDistance;
  }
}

export function kMeans(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  initialX: number[],
  initialY: number[],
  maximumIterations = 300,
): KMeansResult {
  const n = x.length;
  const k = initialX.length;
  const centersX = initialX.slice();
  const centersY = initialY.slice();
  const labels = new Int32Array(n);
  const previous = new Int32Array(n).fill(-1);
  const distances = new Float64Array(n);
  let iterations = 0;
  for (; iterations < maximumIterations; iterations += 1) {
    assign(x, y, centersX, centersY, labels, distances);
    let unchanged = true;
    for (let index = 0; index < n; index += 1) {
      if (labels[index] !== previous[index]) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) break;
    previous.set(labels);
    const sumX = new Float64Array(k);
    const sumY = new Float64Array(k);
    const sizes = new Float64Array(k);
    for (let index = 0; index < n; index += 1) {
      const cluster = labels[index] as number;
      sumX[cluster] = (sumX[cluster] as number) + (x[index] as number);
      sumY[cluster] = (sumY[cluster] as number) + (y[index] as number);
      sizes[cluster] = (sizes[cluster] as number) + 1;
    }
    for (let cluster = 0; cluster < k; cluster += 1) {
      if ((sizes[cluster] as number) > 0) {
        centersX[cluster] = (sumX[cluster] as number) / (sizes[cluster] as number);
        centersY[cluster] = (sumY[cluster] as number) / (sizes[cluster] as number);
        continue;
      }
      // An emptied group restarts at the point farthest from its own centre.
      let farthest = 0;
      for (let index = 1; index < n; index += 1) {
        if ((distances[index] as number) > (distances[farthest] as number)) farthest = index;
      }
      centersX[cluster] = x[farthest] as number;
      centersY[cluster] = y[farthest] as number;
      distances[farthest] = 0;
    }
  }
  let inertia = 0;
  for (let index = 0; index < n; index += 1) {
    const cluster = labels[index] as number;
    inertia += squaredDistance(x[index] as number, y[index] as number, centersX[cluster] as number, centersY[cluster] as number);
  }
  return { k, labels, centersX, centersY, inertia, iterations };
}

/** Every point to its nearest centre of an existing fit; the centres do not move. */
export function assignToCentres(x: ArrayLike<number>, y: ArrayLike<number>, fit: KMeansResult): KMeansResult {
  const labels = new Int32Array(x.length);
  const distances = new Float64Array(x.length);
  assign(x, y, fit.centersX, fit.centersY, labels, distances);
  let inertia = 0;
  for (const distance of distances) inertia += distance;
  return { ...fit, labels, inertia };
}

/** Mean silhouette over the given points (all of them when `indices` is omitted). */
export function silhouetteScore(x: ArrayLike<number>, y: ArrayLike<number>, labels: ArrayLike<number>, indices?: ArrayLike<number>): number {
  const members = indices ? Array.from(indices) : Array.from({ length: x.length }, (_, index) => index);
  let k = 0;
  for (const index of members) k = Math.max(k, (labels[index] as number) + 1);
  const size = new Float64Array(k);
  for (const index of members) size[labels[index] as number] = (size[labels[index] as number] as number) + 1;
  let total = 0;
  const sums = new Float64Array(k);
  for (const i of members) {
    sums.fill(0);
    const xi = x[i] as number;
    const yi = y[i] as number;
    for (const j of members) {
      const cluster = labels[j] as number;
      sums[cluster] = (sums[cluster] as number) + Math.sqrt(squaredDistance(xi, yi, x[j] as number, y[j] as number));
    }
    const own = labels[i] as number;
    if ((size[own] as number) <= 1) continue; // a lone point scores 0
    const within = (sums[own] as number) / ((size[own] as number) - 1);
    let between = Number.POSITIVE_INFINITY;
    for (let cluster = 0; cluster < k; cluster += 1) {
      if (cluster === own || (size[cluster] as number) === 0) continue;
      between = Math.min(between, (sums[cluster] as number) / (size[cluster] as number));
    }
    const denominator = Math.max(within, between);
    if (Number.isFinite(between) && denominator > 0) total += (between - within) / denominator;
  }
  return total / members.length;
}

/** `size` distinct indices from 0..n-1, drawn by a partial Fisher-Yates shuffle, in ascending order. */
export function seededSample(n: number, size: number, random: () => number): Int32Array {
  if (size >= n) return Int32Array.from({ length: n }, (_, index) => index);
  const pool = Int32Array.from({ length: n }, (_, index) => index);
  for (let index = 0; index < size; index += 1) {
    const swap = index + Math.floor(random() * (n - index));
    const held = pool[index] as number;
    pool[index] = pool[swap] as number;
    pool[swap] = held;
  }
  return pool.slice(0, size).sort();
}

export function structureOf(silhouette: number): ClusterStructure {
  if (silhouette > 0.7) return "strong";
  if (silhouette > 0.5) return "reasonable";
  if (silhouette >= 0.25) return "weak";
  return "none";
}

function standardize(values: ArrayLike<number>): { standardized: Float64Array; mean: number; deviation: number } {
  const n = values.length;
  let sum = 0;
  for (let index = 0; index < n; index += 1) sum += values[index] as number;
  const mean = sum / n;
  let squares = 0;
  for (let index = 0; index < n; index += 1) squares += ((values[index] as number) - mean) ** 2;
  const deviation = Math.sqrt(squares / Math.max(1, n - 1)) || 1;
  return { standardized: Float64Array.from(values as ArrayLike<number>, (value) => (value - mean) / deviation), mean, deviation };
}

/** k-means for k = 2..maximumK on the standardized axes; the k with the best silhouette wins. */
export function clusterPoints(
  xValues: ArrayLike<number>,
  yValues: ArrayLike<number>,
  options: { maximumK?: number; silhouetteSample?: number; fitSample?: number; seed?: number } = {},
): ClusterSummary | null {
  const n = Math.min(xValues.length, yValues.length);
  const maximumK = Math.min(options.maximumK ?? 5, Math.floor(n / 10));
  if (maximumK < 2) return null;
  const scaledX = standardize(xValues);
  const scaledY = standardize(yValues);
  const x = scaledX.standardized;
  const y = scaledY.standardized;
  const draw = createRandom((options.seed ?? CLUSTER_SEED) ^ 0x2545f491);
  const sample = seededSample(n, options.silhouetteSample ?? SILHOUETTE_SAMPLE, draw);
  const fitIndices = seededSample(n, options.fitSample ?? FIT_SAMPLE, draw);
  const fitSize = fitIndices.length;
  const fitX = Float64Array.from(fitIndices, (index) => x[index] as number);
  const fitY = Float64Array.from(fitIndices, (index) => y[index] as number);
  let best: ClusterSummary | null = null;
  const silhouetteByK: Array<{ k: number; silhouette: number }> = [];
  for (let k = 2; k <= maximumK; k += 1) {
    const random = createRandom((options.seed ?? CLUSTER_SEED) + k);
    const seeds = kMeansPlusPlus(fitX, fitY, k, random);
    const fitted = kMeans(fitX, fitY, seeds.centersX, seeds.centersY);
    // Every bar to its nearest fitted centre; with no subsample this is the fit itself.
    const result = fitSize === n ? fitted : assignToCentres(x, y, fitted);
    const silhouette = silhouetteScore(x, y, result.labels, sample);
    silhouetteByK.push({ k, silhouette });
    if (!best || silhouette > best.silhouette) {
      const sizes = new Array<number>(k).fill(0);
      for (const label of result.labels) sizes[label] = (sizes[label] as number) + 1;
      best = {
        ...result,
        centersDataX: result.centersX.map((value) => scaledX.mean + value * scaledX.deviation),
        centersDataY: result.centersY.map((value) => scaledY.mean + value * scaledY.deviation),
        silhouette,
        structure: structureOf(silhouette),
        silhouetteByK,
        sizes,
      };
    }
  }
  return best;
}
