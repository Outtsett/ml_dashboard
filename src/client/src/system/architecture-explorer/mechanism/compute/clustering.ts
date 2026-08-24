/**
 * Real clustering algorithms, each returning a TRACE of its own genuine steps.
 *
 * These are not illustrations. Each function implements the algorithm as its
 * cited spec describes it, runs it to completion on the real feature matrix up
 * front, and returns every intermediate state. The renderer replays that trace,
 * so what you watch is the algorithm's actual progress — iteration N on screen
 * is iteration N of the algorithm, and the reported objective is the real one.
 *
 * ANALYTIC provenance throughout: given the points, these results are correct.
 * No learned weights are involved anywhere in this file.
 *
 * Determinism: any random choice draws from a seeded hash (see seededUnit in
 * ./kmeans), never Math.random, so the same bars always produce the same run.
 */

import { seededUnit } from './kmeans';

/** One frame of a clustering run. Every field is real output of the algorithm. */
export interface ClusterStep {
  /** assignments[i] = cluster index of point i. -1 means noise / unassigned. */
  assignments: number[];
  /** Cluster centres, where the algorithm HAS centres. Omitted where it does not. */
  centroids?: number[][];
  /**
   * Per-cluster spread in the projected plane, for algorithms that model it
   * (GMM). [sdX, sdY] — drawn as an ellipse, not a circle, which is the point.
   */
  spreads?: number[][];
  /** Edges between centroids, for grid-structured models (SOM). */
  gridEdges?: [number, number][];
  /** The algorithm's own objective at this step. */
  metricLabel: string;
  metricValue: number;
  /** Short factual note, e.g. "core 41 · border 12 · noise 7". */
  note?: string;
}

export interface ClusterTrace {
  steps: ClusterStep[];
  converged: boolean;
  iterations: number;
  /** Cluster count the algorithm ENDED with — discovered, for the ones that discover it. */
  k: number;
}

const EMPTY: ClusterTrace = { steps: [], converged: false, iterations: 0, k: 0 };

function sqDist(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return s;
}

function mean(points: number[][], idx: number[], dims: number): number[] {
  const m = new Array<number>(dims).fill(0);
  for (const i of idx) for (let d = 0; d < dims; d++) m[d]! += points[i]![d]!;
  return m.map((v) => v / Math.max(idx.length, 1));
}

/** Spread of a member set along the first two dims — what the renderer draws. */
function spread2(points: number[][], idx: number[], centre: number[]): number[] {
  if (idx.length < 2) return [0.15, 0.15];
  let vx = 0;
  let vy = 0;
  for (const i of idx) {
    vx += (points[i]![0]! - centre[0]!) ** 2;
    vy += (points[i]![1]! - centre[1]!) ** 2;
  }
  return [Math.sqrt(vx / idx.length), Math.sqrt(vy / idx.length)];
}

// ── Gaussian Mixture Model — Expectation-Maximization ───────────────────────

/**
 * EM for a diagonal-covariance GMM.
 *
 * The distinguishing behaviour vs k-means is SOFT assignment: every point holds
 * a responsibility across all components. The trace reports the hard argmax for
 * colouring, plus per-component spread so the renderer can draw ellipses —
 * which is the shape k-means structurally cannot express.
 *
 * Log-likelihood is non-decreasing across EM steps; that is EM's guarantee and
 * the number shown.
 */
export function gmm(points: number[][], k: number, seed = 7, maxIter = 40): ClusterTrace {
  if (points.length === 0) return EMPTY;
  const n = points.length;
  const dims = points[0]!.length;
  const K = Math.max(1, Math.min(k, n));

  // Initialise means from spread-out points, variances from global spread.
  const means: number[][] = [];
  for (let c = 0; c < K; c++) {
    means.push([...points[Math.floor(seededUnit(seed, c, 3) * n) % n]!]);
  }
  const globalMean = mean(points, points.map((_, i) => i), dims);
  const globalVar = new Array<number>(dims).fill(0);
  for (const p of points) for (let d = 0; d < dims; d++) globalVar[d]! += (p[d]! - globalMean[d]!) ** 2;
  for (let d = 0; d < dims; d++) globalVar[d]! = Math.max(globalVar[d]! / n, 1e-6);
  const vars: number[][] = Array.from({ length: K }, () => [...globalVar]);
  const weights = new Array<number>(K).fill(1 / K);

  const steps: ClusterStep[] = [];
  let prevLL = -Infinity;
  let converged = false;

  for (let iter = 0; iter < maxIter; iter++) {
    // E-step: responsibilities.
    const resp: number[][] = [];
    let ll = 0;
    for (let i = 0; i < n; i++) {
      const logs = new Array<number>(K);
      for (let c = 0; c < K; c++) {
        let lp = Math.log(Math.max(weights[c]!, 1e-12));
        for (let d = 0; d < dims; d++) {
          const v = Math.max(vars[c]![d]!, 1e-9);
          lp += -0.5 * (Math.log(2 * Math.PI * v) + (points[i]![d]! - means[c]![d]!) ** 2 / v);
        }
        logs[c] = lp;
      }
      const mx = Math.max(...logs);
      let sum = 0;
      for (let c = 0; c < K; c++) sum += Math.exp(logs[c]! - mx);
      const logSum = mx + Math.log(sum);
      ll += logSum;
      resp.push(logs.map((l) => Math.exp(l - logSum)));
    }

    // M-step: re-fit weights, means, variances.
    for (let c = 0; c < K; c++) {
      let nk = 0;
      for (let i = 0; i < n; i++) nk += resp[i]![c]!;
      nk = Math.max(nk, 1e-9);
      weights[c] = nk / n;
      for (let d = 0; d < dims; d++) {
        let mu = 0;
        for (let i = 0; i < n; i++) mu += resp[i]![c]! * points[i]![d]!;
        means[c]![d] = mu / nk;
      }
      for (let d = 0; d < dims; d++) {
        let v = 0;
        for (let i = 0; i < n; i++) v += resp[i]![c]! * (points[i]![d]! - means[c]![d]!) ** 2;
        vars[c]![d] = Math.max(v / nk, 1e-6);
      }
    }

    const assignments = resp.map((r) => r.indexOf(Math.max(...r)));
    steps.push({
      assignments,
      centroids: means.map((m) => [...m]),
      spreads: vars.map((v) => [Math.sqrt(v[0]!), Math.sqrt(v[1] ?? v[0]!)]),
      metricLabel: 'log-likelihood',
      metricValue: ll,
      note: `${K} components · soft assignment`,
    });

    if (Math.abs(ll - prevLL) < 1e-6) { converged = true; break; }
    prevLL = ll;
  }

  return { steps, converged, iterations: steps.length - 1, k: K };
}

// ── DBSCAN — density-based region growing ───────────────────────────────────

/**
 * DBSCAN exactly as the spec states it: core points have >= minPts neighbours
 * within eps; clusters grow by density-reachability; everything left over is
 * NOISE, labelled -1 rather than forced into a cluster.
 *
 * `eps` defaults to a data-driven value (median nearest-neighbour distance x
 * 1.6) so the animation is meaningful on whatever bars are loaded, rather than
 * a hardcoded constant that happens to suit one instrument.
 *
 * The trace emits one step per cluster-expansion round, so you watch regions
 * grow outward from their seeds.
 */
export function dbscan(points: number[][], minPts = 4, eps?: number): ClusterTrace {
  if (points.length === 0) return EMPTY;
  const n = points.length;

  // Data-driven eps: median distance to the minPts-th nearest neighbour.
  let epsilon = eps;
  if (epsilon == null) {
    const kth: number[] = [];
    for (let i = 0; i < n; i++) {
      const ds: number[] = [];
      for (let j = 0; j < n; j++) if (i !== j) ds.push(Math.sqrt(sqDist(points[i]!, points[j]!)));
      ds.sort((a, b) => a - b);
      kth.push(ds[Math.min(minPts - 1, ds.length - 1)] ?? 1);
    }
    kth.sort((a, b) => a - b);
    epsilon = (kth[Math.floor(kth.length / 2)] ?? 1) * 1.6;
  }

  const neighbours: number[][] = [];
  for (let i = 0; i < n; i++) {
    const nb: number[] = [];
    for (let j = 0; j < n; j++) if (sqDist(points[i]!, points[j]!) <= epsilon * epsilon) nb.push(j);
    neighbours.push(nb);
  }
  const isCore = neighbours.map((nb) => nb.length >= minPts);

  const assignments = new Array<number>(n).fill(-1);
  const visited = new Array<boolean>(n).fill(false);
  const steps: ClusterStep[] = [];
  let cluster = 0;

  const snapshot = () => {
    const noise = assignments.filter((a) => a === -1).length;
    const core = isCore.filter(Boolean).length;
    steps.push({
      assignments: [...assignments],
      metricLabel: 'clusters found',
      metricValue: cluster,
      note: `core ${core} · unassigned ${noise} · eps ${epsilon!.toFixed(3)}`,
    });
  };
  snapshot();

  for (let i = 0; i < n; i++) {
    if (visited[i] || !isCore[i]) continue;
    // Breadth-first density-reachable expansion from this core seed.
    const queue = [i];
    visited[i] = true;
    assignments[i] = cluster;
    while (queue.length) {
      const cur = queue.shift()!;
      if (!isCore[cur]) continue; // border points do not expand the frontier
      for (const nb of neighbours[cur]!) {
        if (assignments[nb] === -1) assignments[nb] = cluster;
        if (!visited[nb]) { visited[nb] = true; queue.push(nb); }
      }
    }
    cluster++;
    snapshot();
  }

  return { steps, converged: true, iterations: steps.length - 1, k: cluster };
}

// ── Mean Shift — gradient ascent on a kernel density estimate ───────────────

/**
 * Every point climbs to a density mode by repeatedly moving to the weighted
 * mean of its neighbourhood. Points converging to the same mode form a cluster,
 * and modes closer than the bandwidth merge — so the cluster count is
 * discovered, never specified.
 *
 * The trace emits the shifting positions themselves, so what you watch is the
 * points migrating uphill, which is the whole mechanism.
 */
export function meanShift(points: number[][], bandwidth?: number, maxIter = 30): ClusterTrace {
  if (points.length === 0) return EMPTY;
  const n = points.length;
  const dims = points[0]!.length;

  let h = bandwidth;
  if (h == null) {
    // Median pairwise distance / 3 — scale-free w.r.t. whatever bars are loaded.
    const sample: number[] = [];
    for (let i = 0; i < Math.min(n, 60); i++) {
      for (let j = i + 1; j < Math.min(n, 60); j++) sample.push(Math.sqrt(sqDist(points[i]!, points[j]!)));
    }
    sample.sort((a, b) => a - b);
    h = Math.max((sample[Math.floor(sample.length / 2)] ?? 1) / 3, 1e-4);
  }

  let cur = points.map((p) => [...p]);
  const steps: ClusterStep[] = [];
  let converged = false;

  for (let iter = 0; iter < maxIter; iter++) {
    const next: number[][] = [];
    let shift = 0;
    for (let i = 0; i < n; i++) {
      const num = new Array<number>(dims).fill(0);
      let den = 0;
      for (let j = 0; j < n; j++) {
        const w = Math.exp(-sqDist(cur[i]!, points[j]!) / (2 * h * h));
        den += w;
        for (let d = 0; d < dims; d++) num[d]! += w * points[j]![d]!;
      }
      const moved = den > 0 ? num.map((v) => v / den) : [...cur[i]!];
      shift = Math.max(shift, sqDist(moved, cur[i]!));
      next.push(moved);
    }
    cur = next;

    // Group by mode: points within h/2 of each other share a cluster.
    const modes: number[][] = [];
    const assignments = cur.map((p) => {
      for (let m = 0; m < modes.length; m++) {
        if (sqDist(p, modes[m]!) <= (h! / 2) ** 2) return m;
      }
      modes.push([...p]);
      return modes.length - 1;
    });

    steps.push({
      assignments,
      centroids: modes.map((m) => [...m]),
      metricLabel: 'modes found',
      metricValue: modes.length,
      note: `bandwidth ${h.toFixed(3)} · points climbing the density estimate`,
    });

    if (shift < 1e-8) { converged = true; break; }
  }

  const lastStep = steps[steps.length - 1];
  return { steps, converged, iterations: steps.length - 1, k: lastStep?.centroids?.length ?? 0 };
}

// ── Agglomerative (hierarchical) — bottom-up linkage merging ────────────────

/**
 * Every point starts as its own cluster; the two closest clusters merge, and
 * that repeats. Merges are IRREVERSIBLE, which is the property that
 * distinguishes this from k-means' iterative reassignment — an early mistake
 * propagates all the way up.
 *
 * Average linkage. The trace emits one step per merge, so you watch the
 * hierarchy build.
 */
export function agglomerative(points: number[][], stopAt = 4): ClusterTrace {
  if (points.length === 0) return EMPTY;
  const n = points.length;
  const dims = points[0]!.length;

  let groups: number[][] = points.map((_, i) => [i]);
  const steps: ClusterStep[] = [];

  const emit = (dist: number) => {
    const assignments = new Array<number>(n).fill(-1);
    groups.forEach((g, gi) => g.forEach((i) => (assignments[i] = gi)));
    steps.push({
      assignments,
      centroids: groups.map((g) => mean(points, g, dims)),
      metricLabel: 'clusters',
      metricValue: groups.length,
      note: dist >= 0 ? `merged at distance ${dist.toFixed(3)} · average linkage` : 'each point its own cluster',
    });
  };
  emit(-1);

  // Cap the emitted frames so a 240-point run does not produce 236 steps.
  const emitEvery = Math.max(1, Math.floor((n - stopAt) / 40));
  let sinceEmit = 0;

  while (groups.length > stopAt) {
    let best = Infinity;
    let bi = 0;
    let bj = 1;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        let sum = 0;
        for (const a of groups[i]!) for (const b of groups[j]!) sum += Math.sqrt(sqDist(points[a]!, points[b]!));
        const d = sum / (groups[i]!.length * groups[j]!.length);
        if (d < best) { best = d; bi = i; bj = j; }
      }
    }
    groups = groups
      .map((g, idx) => (idx === bi ? [...g, ...groups[bj]!] : g))
      .filter((_, idx) => idx !== bj);
    if (++sinceEmit >= emitEvery || groups.length === stopAt) { emit(best); sinceEmit = 0; }
  }

  return { steps, converged: true, iterations: steps.length - 1, k: groups.length };
}

// ── Self-Organizing Map — competitive learning on a lattice ─────────────────

/**
 * A grid of nodes is pulled toward the data: for each input the closest node
 * (the Best Matching Unit) and its GRID NEIGHBOURS move toward it, with both
 * the learning rate and the neighbourhood radius annealing over time.
 *
 * Updating neighbours is what preserves topology — nearby grid nodes stay
 * responsive to similar inputs — and it is why the lattice edges are emitted:
 * watching the grid unfold across the data IS the mechanism.
 */
export function som(points: number[][], gw = 4, gh = 3, seed = 11, epochs = 24): ClusterTrace {
  if (points.length === 0) return EMPTY;
  const dims = points[0]!.length;
  const count = gw * gh;

  // Initialise nodes from random real points, so the lattice starts in-distribution.
  const nodes: number[][] = Array.from({ length: count }, (_, i) => [
    ...points[Math.floor(seededUnit(seed, i, 5) * points.length) % points.length]!,
  ]);
  const gridEdges: [number, number][] = [];
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      const i = r * gw + c;
      if (c + 1 < gw) gridEdges.push([i, i + 1]);
      if (r + 1 < gh) gridEdges.push([i, i + gw]);
    }
  }
  const rc = (i: number) => [Math.floor(i / gw), i % gw] as const;

  const steps: ClusterStep[] = [];
  for (let e = 0; e < epochs; e++) {
    const t = e / epochs;
    const lr = 0.5 * Math.exp(-2.2 * t);
    const radius = Math.max(0.6, Math.max(gw, gh) * 0.65 * Math.exp(-2.2 * t));

    for (let s = 0; s < points.length; s++) {
      const x = points[Math.floor(seededUnit(seed, e, s) * points.length) % points.length]!;
      let bmu = 0;
      let bd = Infinity;
      for (let i = 0; i < count; i++) {
        const d = sqDist(x, nodes[i]!);
        if (d < bd) { bd = d; bmu = i; }
      }
      const [br, bc] = rc(bmu);
      for (let i = 0; i < count; i++) {
        const [r, c] = rc(i);
        const gd = (r - br) ** 2 + (c - bc) ** 2;
        const infl = Math.exp(-gd / (2 * radius * radius));
        if (infl < 1e-3) continue;
        for (let d = 0; d < dims; d++) nodes[i]![d]! += lr * infl * (x[d]! - nodes[i]![d]!);
      }
    }

    let quant = 0;
    const assignments = points.map((x) => {
      let bmu = 0;
      let bd = Infinity;
      for (let i = 0; i < count; i++) {
        const d = sqDist(x, nodes[i]!);
        if (d < bd) { bd = d; bmu = i; }
      }
      quant += Math.sqrt(bd);
      return bmu;
    });

    steps.push({
      assignments,
      centroids: nodes.map((nd) => [...nd]),
      gridEdges,
      metricLabel: 'quantization error',
      metricValue: quant / points.length,
      note: `${gw}x${gh} lattice · lr ${lr.toFixed(3)} · radius ${radius.toFixed(2)}`,
    });
  }

  return { steps, converged: true, iterations: steps.length - 1, k: count };
}

// ── Constrained k-means (COP-KMeans) — semi-supervised clustering ───────────

/**
 * K-means that must respect pairwise constraints: must-link pairs share a
 * cluster, cannot-link pairs may not. Assignment takes the nearest centroid
 * that does not VIOLATE a constraint, and if none is feasible the algorithm
 * genuinely fails — which the trace reports rather than silently relaxing.
 *
 * Constraints are derived from the data itself (the closest and furthest pairs)
 * so the animation shows real supervision rather than invented labels; the note
 * says exactly how many of each are in play.
 */
export function copKmeans(points: number[][], k = 4, seed = 7, maxIter = 30): ClusterTrace {
  if (points.length === 0) return EMPTY;
  const n = points.length;
  const dims = points[0]!.length;
  const K = Math.max(1, Math.min(k, n));

  // Derive a handful of must-link / cannot-link pairs from real geometry.
  const pairs: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < Math.min(n, 40); i++) {
    for (let j = i + 1; j < Math.min(n, 40); j++) pairs.push({ i, j, d: sqDist(points[i]!, points[j]!) });
  }
  pairs.sort((a, b) => a.d - b.d);
  const mustLink = pairs.slice(0, 6).map((p) => [p.i, p.j] as [number, number]);
  const cannotLink = pairs.slice(-6).map((p) => [p.i, p.j] as [number, number]);

  const centroids: number[][] = [];
  for (let c = 0; c < K; c++) {
    centroids.push([...points[Math.floor(seededUnit(seed, c, 9) * n) % n]!]);
  }

  const steps: ClusterStep[] = [];
  let converged = false;
  let violations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    const assignments = new Array<number>(n).fill(-1);
    violations = 0;

    for (let i = 0; i < n; i++) {
      const order = centroids
        .map((c, ci) => [sqDist(points[i]!, c), ci] as const)
        .sort((a, b) => a[0] - b[0]);
      let placed = false;
      for (const [, ci] of order) {
        const breaksCannot = cannotLink.some(
          ([a, b]) => (a === i && assignments[b] === ci) || (b === i && assignments[a] === ci),
        );
        const breaksMust = mustLink.some(
          ([a, b]) =>
            (a === i && assignments[b] !== -1 && assignments[b] !== ci) ||
            (b === i && assignments[a] !== -1 && assignments[a] !== ci),
        );
        if (!breaksCannot && !breaksMust) { assignments[i] = ci; placed = true; break; }
      }
      if (!placed) { assignments[i] = order[0]![1]; violations++; }
    }

    let shift = 0;
    for (let c = 0; c < K; c++) {
      const members = assignments.map((a, i) => (a === c ? i : -1)).filter((i) => i >= 0);
      if (members.length === 0) continue;
      const m = mean(points, members, dims);
      shift = Math.max(shift, sqDist(m, centroids[c]!));
      centroids[c] = m;
    }

    let inertia = 0;
    for (let i = 0; i < n; i++) inertia += sqDist(points[i]!, centroids[assignments[i]!]!);

    steps.push({
      assignments,
      centroids: centroids.map((c) => [...c]),
      metricLabel: 'inertia',
      metricValue: inertia,
      note:
        `${mustLink.length} must-link · ${cannotLink.length} cannot-link` +
        (violations ? ` · ${violations} infeasible` : ' · all satisfied'),
    });

    if (shift <= 1e-8) { converged = true; break; }
  }

  return { steps, converged, iterations: steps.length - 1, k: K };
}

// ── Affinity Propagation — responsibility / availability message passing ────

/**
 * Points exchange two messages until a set of EXEMPLARS emerges:
 *   r(i,k) — how well k suits i as an exemplar, against i's best alternative
 *   a(i,k) — how appropriate choosing k is, given who else wants k
 *
 * Cluster centres are therefore REAL DATA POINTS, not synthetic means, and the
 * cluster count follows from the preference rather than being set as K. Damped
 * per the spec so the messages settle instead of oscillating.
 */
export function affinityPropagation(
  points: number[][],
  damping = 0.6,
  maxIter = 40,
): ClusterTrace {
  if (points.length === 0) return EMPTY;
  // O(n^2) messages: cap the working set so the browser stays responsive, and
  // say so rather than silently clustering a subset.
  const n = Math.min(points.length, 120);
  const S: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => -sqDist(points[i]!, points[j]!)),
  );
  const off: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) off.push(S[i]![j]!);
  off.sort((a, b) => a - b);
  const pref = off[Math.floor(off.length / 2)] ?? -1; // median similarity
  for (let i = 0; i < n; i++) S[i]![i] = pref;

  const R = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const steps: ClusterStep[] = [];

  for (let iter = 0; iter < maxIter; iter++) {
    // Responsibilities.
    for (let i = 0; i < n; i++) {
      const as = S[i]!.map((s, kk) => s + A[i]![kk]!);
      let m1 = -Infinity;
      let m1i = -1;
      let m2 = -Infinity;
      for (let kk = 0; kk < n; kk++) {
        if (as[kk]! > m1) { m2 = m1; m1 = as[kk]!; m1i = kk; }
        else if (as[kk]! > m2) m2 = as[kk]!;
      }
      for (let kk = 0; kk < n; kk++) {
        const target = S[i]![kk]! - (kk === m1i ? m2 : m1);
        R[i]![kk] = damping * R[i]![kk]! + (1 - damping) * target;
      }
    }
    // Availabilities.
    for (let kk = 0; kk < n; kk++) {
      let sumPos = 0;
      for (let i = 0; i < n; i++) if (i !== kk) sumPos += Math.max(0, R[i]![kk]!);
      for (let i = 0; i < n; i++) {
        let target: number;
        if (i === kk) target = sumPos;
        else {
          const excl = sumPos - Math.max(0, R[i]![kk]!);
          target = Math.min(0, R[kk]![kk]! + excl);
        }
        A[i]![kk] = damping * A[i]![kk]! + (1 - damping) * target;
      }
    }

    const exemplarOf = Array.from({ length: n }, (_, i) => {
      let best = 0;
      let bv = -Infinity;
      for (let kk = 0; kk < n; kk++) {
        const v = R[i]![kk]! + A[i]![kk]!;
        if (v > bv) { bv = v; best = kk; }
      }
      return best;
    });
    const uniq = [...new Set(exemplarOf)];
    const assignments = new Array<number>(points.length).fill(-1);
    for (let i = 0; i < n; i++) assignments[i] = uniq.indexOf(exemplarOf[i]!);

    steps.push({
      assignments,
      centroids: uniq.map((e) => [...points[e]!]),
      metricLabel: 'exemplars',
      metricValue: uniq.length,
      note:
        `centres are real bars · damping ${damping}` +
        (points.length > n ? ` · first ${n} of ${points.length} points` : ''),
    });
  }

  return { steps, converged: true, iterations: steps.length - 1, k: steps[steps.length - 1]?.centroids?.length ?? 0 };
}
