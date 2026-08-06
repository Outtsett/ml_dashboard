/**
 * K-Means (Lloyd's algorithm) with k-means++ initialization.
 *
 * ANALYTIC provenance: given the points and the seed, this result is the
 * genuinely correct clustering — there are no learned weights involved, so what
 * the animation shows is a true convergence, not an illustration of one.
 *
 * The whole run is computed up front and returned as a TRACE of every real
 * iteration. The sketch replays those steps; it never invents intermediate
 * frames or paces progress off a timer.
 *
 * Determinism: initialization draws from a seeded hash, never Math.random, so
 * the same bars and seed always produce the same run.
 */

export interface KMeansStep {
  /** Centroid positions at the END of this step. */
  centroids: number[][];
  /** assignments[i] = cluster index of points[i]. */
  assignments: number[];
  /** Sum of squared distances to the assigned centroid. Never increases. */
  inertia: number;
}

export interface KMeansTrace {
  steps: KMeansStep[];
  converged: boolean;
  /** Lloyd iterations run (steps.length - 1; step 0 is the init assignment). */
  iterations: number;
  k: number;
}

export interface KMeansOptions {
  maxIter?: number;
  /** Integer seed. Same seed + same points => identical trace. */
  seed?: number;
  /** Centroid movement below this ends the run. */
  tol?: number;
}

/** Deterministic hash -> [0,1). The RNG substitute; no Math.random anywhere. */
export function seededUnit(a: number, b: number, c: number): number {
  let h = 2166136261 ^ (a * 374761393 + b * 668265263 + c * 2246822519);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

function sqDist(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return s;
}

/** k-means++ : first centre seeded, each next drawn proportional to D^2. */
function kmeansPlusPlus(points: number[][], k: number, seed: number): number[][] {
  const centroids: number[][] = [];
  const firstIdx =
    Math.floor(seededUnit(seed, 0, 0) * points.length) % points.length;
  centroids.push([...points[firstIdx]!]);

  while (centroids.length < k) {
    const d2 = points.map((p) => {
      let best = Infinity;
      for (const c of centroids) {
        const d = sqDist(p, c);
        if (d < best) best = d;
      }
      return best;
    });
    const total = d2.reduce((s, v) => s + v, 0);
    if (total <= 0) break; // every point already coincides with a centre

    const target = seededUnit(seed, centroids.length, 1) * total;
    let acc = 0;
    let chosen = points.length - 1;
    for (let i = 0; i < points.length; i++) {
      acc += d2[i]!;
      if (acc >= target) {
        chosen = i;
        break;
      }
    }
    centroids.push([...points[chosen]!]);
  }
  return centroids;
}

function assign(
  points: number[][],
  centroids: number[][],
): { assignments: number[]; inertia: number } {
  const assignments = new Array<number>(points.length).fill(0);
  let inertia = 0;
  for (let i = 0; i < points.length; i++) {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const d = sqDist(points[i]!, centroids[c]!);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    assignments[i] = best;
    inertia += bestD;
  }
  return { assignments, inertia };
}

/**
 * Recompute each centroid as the mean of its members. An empty cluster keeps
 * its previous position — dropping or randomly re-seeding it would make the
 * inertia-never-increases guarantee false.
 */
function update(
  points: number[][],
  assignments: number[],
  centroids: number[][],
): number[][] {
  const dims = points[0]!.length;
  const sums = centroids.map(() => new Array<number>(dims).fill(0));
  const counts = new Array<number>(centroids.length).fill(0);

  for (let i = 0; i < points.length; i++) {
    const c = assignments[i]!;
    counts[c]!++;
    for (let d = 0; d < dims; d++) sums[c]![d]! += points[i]![d]!;
  }

  return centroids.map((prev, c) =>
    counts[c] === 0 ? [...prev] : sums[c]!.map((s) => s / counts[c]!),
  );
}

export function kmeans(
  points: number[][],
  k: number,
  opts: KMeansOptions = {},
): KMeansTrace {
  const { maxIter = 40, seed = 1, tol = 1e-6 } = opts;

  if (points.length === 0) {
    return { steps: [], converged: false, iterations: 0, k: 0 };
  }
  const effectiveK = Math.max(1, Math.min(k, points.length));

  let centroids = kmeansPlusPlus(points, effectiveK, seed);
  const steps: KMeansStep[] = [];

  // Step 0: the initial assignment against the k-means++ centres.
  let { assignments, inertia } = assign(points, centroids);
  steps.push({
    centroids: centroids.map((c) => [...c]),
    assignments: [...assignments],
    inertia,
  });

  let converged = false;
  for (let iter = 0; iter < maxIter; iter++) {
    const next = update(points, assignments, centroids);
    let shift = 0;
    for (let i = 0; i < next.length; i++) {
      const d = sqDist(next[i]!, centroids[i]!);
      if (d > shift) shift = d;
    }
    centroids = next;

    ({ assignments, inertia } = assign(points, centroids));
    steps.push({
      centroids: centroids.map((c) => [...c]),
      assignments: [...assignments],
      inertia,
    });

    if (shift <= tol) {
      converged = true;
      break;
    }
  }

  return { steps, converged, iterations: steps.length - 1, k: centroids.length };
}
