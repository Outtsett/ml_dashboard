/**
 * Vector-space explainer: the body of `GET /api/studies/vector-space-explained`
 * and the pure maths the page and its tests share. Replaced
 * Trading/quant/model/notebooks/vector_space_explained.py.
 *
 * The data is the Lens run's own bar vectors (multimodal_MNQ_1h, 4,000 bars x 32
 * features, each feature z-scored over the run), landed by
 * packages/ml-engine/src/studies/vector_space_explained/build.py. Everything interactive is
 * computed here from those z-scores, exactly as the notebook did in numpy:
 *
 *   - a feature pair's centred cloud, its best direction (2x2 eigen) and the
 *     variance of the shadows on any direction (ddof = 1);
 *   - the eigen-decomposition of the feature covariance (cyclic Jacobi, the
 *     same method as the Lens router's `jacobiEigen` in server/lens/vectors.router.ts,
 *     which is not importable from the browser), signs pinned so the largest
 *     loading is positive;
 *   - the 220-bar HNSW walk: M-nearest links, layers drawn once by numpy
 *     (default_rng(3).geometric(0.5) - 1 clipped to 2, landed as walk_node_layers
 *     because numpy's generator cannot be reproduced here), greedy descent.
 *
 * Nothing here is a moving statistic across bars, so there is no look-ahead to
 * guard: the z-scores are the run's own, fitted over the whole run, the same
 * as the Lens panel the study explains.
 */

import { quantileSorted, sortedFinite } from "../lens/stats";

export const BLOCK_ORDER = ["geometry", "kinematics", "volume", "structure", "pattern_multihot"] as const;
export type BlockName = (typeof BLOCK_ORDER)[number];
export type Basis = "continuous" | "full";

/** The blocks each basis is made of (the notebook's BASES). `continuous` drops the 13 pattern flags. */
export const BASE_BLOCKS: Record<Basis, readonly string[]> = {
  continuous: ["geometry", "kinematics", "volume", "structure"],
  full: BLOCK_ORDER,
};

export interface SpectrumRow {
  basis: string;
  component_number: number;
  eigenvalue: number;
  variance_share: number;
  cumulative_variance_share: number;
}

export interface LoadingRow {
  basis: string;
  component_number: number;
  feature_name: string;
  block_name: string;
  loading: number;
}

export interface RecallRow {
  basis: string;
  neighbour_count: number;
  /** 0 is the exact (brute force) scan. */
  ef_search: number;
  recall_at_k: number;
  mean_query_milliseconds: number;
}

export interface RunInformation {
  source_run: string;
  source_location: string;
  source_built_on: string;
  source_script: string;
  bar_count: number;
  feature_count: number;
  continuous_dimension_count: number;
  full_dimension_count: number;
  neighbour_count: number;
  /** The smallest probe count that makes every recall a whole number of hits: a lower bound, not the measured count. */
  probe_count_inferred: number;
  walk_node_count: number;
  walk_layer_seed: number;
  loading_components_landed: number;
}

export interface VectorSpaceBody {
  run: RunInformation | null;
  /** 'block.field', in block order then name. */
  featureNames: string[];
  /** The block of each feature, same order. */
  featureBlocks: string[];
  /** The bar index of each row of `values`. */
  barIndex: number[];
  /** values[feature][bar]: z-scored over the run, rounded to 5 decimals. */
  values: number[][];
  spectrum: SpectrumRow[];
  /** Landed loadings (components 1 to 4 only): used as a check on the recomputed ones. */
  loadings: LoadingRow[];
  recall: RecallRow[];
  /** The layer (0, 1 or 2) of each of the walk demo's 220 nodes. */
  nodeLayers: number[];
}

export const EMPTY_BODY: VectorSpaceBody = {
  run: null, featureNames: [], featureBlocks: [], barIndex: [], values: [], spectrum: [], loadings: [], recall: [], nodeLayers: [],
};

// ── Part 1: a feature pair and the shadows on a direction ────────────────────

export interface PairAnalysis {
  /** Centred x and y, one entry per bar. */
  x: Float64Array;
  y: Float64Array;
  count: number;
  varianceX: number;
  varianceY: number;
  covariance: number;
  correlation: number;
  /** The angle (degrees, 0 to 180) of the direction that carries the most variance. */
  bestAngleDegrees: number;
  /** The largest eigenvalue of the pair's covariance: the most variance any direction can carry. */
  bestVariance: number;
  /** 1.15 x the 99.5th percentile of |centred value|, pinned per pair so the axes do not rescale as the line swings. */
  axisLimit: number;
}

function centre(values: ArrayLike<number>): Float64Array {
  const out = new Float64Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i] as number;
  const average = values.length > 0 ? sum / values.length : 0;
  for (let i = 0; i < values.length; i += 1) out[i] = (values[i] as number) - average;
  return out;
}

export function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function pairAnalysis(xs: ArrayLike<number>, ys: ArrayLike<number>): PairAnalysis {
  const count = Math.min(xs.length, ys.length);
  const x = centre(Array.from({ length: count }, (_, i) => xs[i] as number));
  const y = centre(Array.from({ length: count }, (_, i) => ys[i] as number));
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < count; i += 1) {
    sxx += (x[i] as number) ** 2;
    syy += (y[i] as number) ** 2;
    sxy += (x[i] as number) * (y[i] as number);
  }
  const denominator = Math.max(count - 1, 1);
  const varianceX = sxx / denominator;
  const varianceY = syy / denominator;
  const covariance = sxy / denominator;
  const correlation = varianceX > 0 && varianceY > 0 ? covariance / Math.sqrt(varianceX * varianceY) : 0;
  const half = (varianceX + varianceY) / 2;
  const radius = Math.sqrt(((varianceX - varianceY) / 2) ** 2 + covariance ** 2);
  const bestVariance = half + radius;
  const bestAngleDegrees = modulo((0.5 * Math.atan2(2 * covariance, varianceX - varianceY) * 180) / Math.PI, 180);
  const magnitudes = new Float64Array(2 * count);
  for (let i = 0; i < count; i += 1) {
    magnitudes[i] = Math.abs(x[i] as number);
    magnitudes[count + i] = Math.abs(y[i] as number);
  }
  const limit = (quantileSorted(sortedFinite(magnitudes), 0.995) ?? 1) * 1.15;
  return { x, y, count, varianceX, varianceY, covariance, correlation, bestAngleDegrees, bestVariance, axisLimit: limit };
}

export function unitDirection(angleDegrees: number): [number, number] {
  const theta = (angleDegrees * Math.PI) / 180;
  return [Math.cos(theta), Math.sin(theta)];
}

/** Var(w) = (1 / (n - 1)) Σ (x_i · w)², for the unit direction at `angleDegrees`. */
export function varianceAtAngle(pair: PairAnalysis, angleDegrees: number): number {
  const [c, s] = unitDirection(angleDegrees);
  return pair.varianceX * c * c + 2 * pair.covariance * s * c + pair.varianceY * s * s;
}

/** Within 2 degrees of the best direction (the notebook's "That is PC1"). Directions are lines, so 179 and 1 are 2 apart. */
export function isAtBest(angleDegrees: number, bestAngleDegrees: number): boolean {
  return Math.abs(modulo(angleDegrees - bestAngleDegrees + 90, 180) - 90) < 2;
}

/** x_i · w for every bar: how far along the line each bar's shadow lands. */
export function shadows(pair: PairAnalysis, angleDegrees: number): Float64Array {
  const [c, s] = unitDirection(angleDegrees);
  const out = new Float64Array(pair.count);
  for (let i = 0; i < pair.count; i += 1) out[i] = (pair.x[i] as number) * c + (pair.y[i] as number) * s;
  return out;
}

export interface TermSum {
  terms: number[];
  /** Σ of the first k terms over (k - 1): the running variance. */
  running: number;
  /** Variance over all bars. */
  full: number;
  /** The largest squared shadow among the first k bars, and its position (0-based). */
  peak: number;
  peakPosition: number;
}

/** The first `windowSize` squared shadows and the running total after `included` of them. */
export function termSum(pair: PairAnalysis, angleDegrees: number, included: number, windowSize = 400): TermSum {
  const projected = shadows(pair, angleDegrees);
  const size = Math.min(windowSize, pair.count);
  const terms = Array.from({ length: size }, (_, i) => (projected[i] as number) ** 2);
  const k = Math.min(Math.max(1, Math.round(included)), size);
  let running = 0, peak = -Infinity, peakPosition = 0;
  for (let i = 0; i < k; i += 1) {
    const term = terms[i] as number;
    running += term;
    if (term > peak) { peak = term; peakPosition = i; }
  }
  return { terms, running: running / Math.max(k - 1, 1), full: varianceAtAngle(pair, angleDegrees), peak, peakPosition };
}

// ── Part 1: the eigen-decomposition of the feature covariance ───────────────

/** Eigenvalues (diagonal of the rotated matrix) and eigenvectors (COLUMNS of `vectors`) of a symmetric matrix, by cyclic Jacobi rotation. */
export function jacobiEigen(input: number[][], sweeps = 100): { values: number[]; vectors: number[][] } {
  const n = input.length;
  const a = input.map((row) => row.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_unused, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n - 1; p += 1) for (let q = p + 1; q < n; q += 1) off += (a[p] as number[])[q]! ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = (a[p] as number[])[q] as number;
        if (Math.abs(apq) < 1e-18) continue;
        const theta = ((a[q] as number[])[q]! - (a[p] as number[])[p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const row = a[k] as number[];
          const akp = row[p] as number, akq = row[q] as number;
          row[p] = c * akp - s * akq;
          row[q] = s * akp + c * akq;
        }
        const rowP = a[p] as number[], rowQ = a[q] as number[];
        for (let k = 0; k < n; k += 1) {
          const apk = rowP[k] as number, aqk = rowQ[k] as number;
          rowP[k] = c * apk - s * aqk;
          rowQ[k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const row = v[k] as number[];
          const vkp = row[p] as number, vkq = row[q] as number;
          row[p] = c * vkp - s * vkq;
          row[q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i] as number), vectors: v };
}

export interface PrincipalComponents {
  /** Eigenvalues, largest first. */
  eigenvalues: number[];
  /** components[k][j]: the loading of feature j on component k (unit length, largest-magnitude loading positive). */
  components: number[][];
  /** share[k] = max(λ_k, 0) / Σ max(λ, 0). */
  shares: number[];
  cumulativeShares: number[];
}

/** Principal components of the given feature columns (each a z-scored series), covariance with ddof = 1. */
export function principalComponents(columns: ReadonlyArray<ArrayLike<number>>): PrincipalComponents {
  const dimensions = columns.length;
  const count = dimensions > 0 ? (columns[0] as ArrayLike<number>).length : 0;
  const centred = columns.map((column) => centre(column));
  const covariance: number[][] = Array.from({ length: dimensions }, () => new Array<number>(dimensions).fill(0));
  const denominator = Math.max(count - 1, 1);
  for (let p = 0; p < dimensions; p += 1) {
    for (let q = p; q < dimensions; q += 1) {
      const a = centred[p] as Float64Array, b = centred[q] as Float64Array;
      let sum = 0;
      for (let i = 0; i < count; i += 1) sum += (a[i] as number) * (b[i] as number);
      (covariance[p] as number[])[q] = sum / denominator;
      (covariance[q] as number[])[p] = sum / denominator;
    }
  }
  const { values, vectors } = jacobiEigen(covariance);
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
  const eigenvalues = order.map((entry) => entry.value);
  const components = order.map((entry) => {
    const column = vectors.map((row) => row[entry.index] as number);
    let peak = 0;
    for (let j = 1; j < column.length; j += 1) if (Math.abs(column[j] as number) > Math.abs(column[peak] as number)) peak = j;
    return (column[peak] as number) < 0 ? column.map((value) => -value) : column;
  });
  const total = eigenvalues.reduce((sum, value) => sum + Math.max(value, 0), 0) || 1;
  const shares = eigenvalues.map((value) => Math.max(value, 0) / total);
  let running = 0;
  const cumulativeShares = shares.map((share) => (running += share));
  return { eigenvalues, components, shares, cumulativeShares };
}

/** Components needed to reach `fraction` of the spread: the notebook's count(cumulative < fraction) + 1. */
export function componentsForShare(cumulativeShares: readonly number[], fraction: number): number {
  return Math.min(cumulativeShares.filter((share) => share < fraction).length + 1, cumulativeShares.length);
}

/** Each block's share of a component's squared loadings, largest first. */
export function blockShares(loadings: readonly number[], blocks: readonly string[]): Array<{ block: string; share: number }> {
  const byBlock = new Map<string, number>();
  let total = 0;
  loadings.forEach((loading, index) => {
    const block = blocks[index] ?? "unknown";
    byBlock.set(block, (byBlock.get(block) ?? 0) + loading * loading);
    total += loading * loading;
  });
  return [...byBlock.entries()].map(([block, square]) => ({ block, share: total > 0 ? square / total : 0 })).sort((a, b) => b.share - a.share);
}

// ── Part 2: HNSW ─────────────────────────────────────────────────────────────

export interface WalkWorld {
  /** The sampled bars' centred coordinates. */
  x: Float64Array;
  y: Float64Array;
  /** The bar index of each sampled bar. */
  bars: number[];
  /** The query: a real bar taken from between the sampled ones, so it is not in the graph. */
  queryX: number;
  queryY: number;
  queryBar: number;
  /** The position in the pair's cloud the query came from. */
  queryIndex: number;
  stride: number;
}

/** 220 evenly spaced bars of the pair's cloud, and one bar between them as the query. */
export function buildWalkWorld(pair: PairAnalysis, bars: readonly number[], nodeCount = 220): WalkWorld {
  const stride = Math.max(1, Math.floor(pair.count / nodeCount));
  const picked: number[] = [];
  for (let i = 0; i < pair.count && picked.length < nodeCount; i += stride) picked.push(i);
  const queryIndex = Math.min(Math.floor(stride / 2) + stride * 140, pair.count - 1);
  return {
    x: Float64Array.from(picked.map((i) => pair.x[i] as number)),
    y: Float64Array.from(picked.map((i) => pair.y[i] as number)),
    bars: picked.map((i) => bars[i] ?? i),
    queryX: pair.x[queryIndex] as number,
    queryY: pair.y[queryIndex] as number,
    queryBar: bars[queryIndex] ?? queryIndex,
    queryIndex,
    stride,
  };
}

/** Each node linked to its `links` nearest other nodes by squared distance. */
export function nearestLinks(world: Pick<WalkWorld, "x" | "y">, links: number): number[][] {
  const n = world.x.length;
  const out: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const order: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      order.push({ j, d: ((world.x[i] as number) - (world.x[j] as number)) ** 2 + ((world.y[i] as number) - (world.y[j] as number)) ** 2 });
    }
    order.sort((a, b) => a.d - b.d || a.j - b.j);
    out.push(order.slice(0, links).map((entry) => entry.j));
  }
  return out;
}

export interface WalkStep {
  node: number;
  layer: number;
  distance: number;
  /** Distance computations spent before this step. */
  computations: number;
}

export interface WalkResult {
  path: WalkStep[];
  computations: number;
  exactNearest: number;
}

/** Enter at a top-layer node, hop to any closer linked neighbour within the layer, drop a layer when none is closer. */
export function greedyWalk(world: WalkWorld, adjacency: readonly number[][], layerOf: readonly number[]): WalkResult {
  const squared = (node: number) => ((world.x[node] as number) - world.queryX) ** 2 + ((world.y[node] as number) - world.queryY) ** 2;
  const path: WalkStep[] = [];
  let computations = 0;
  let topLayer = -Infinity;
  let current = 0;
  layerOf.forEach((layer, index) => {
    if (layer > topLayer) { topLayer = layer; current = index; }
  });
  for (const layer of [2, 1, 0]) {
    for (;;) {
      const here = squared(current);
      path.push({ node: current, layer, distance: here, computations });
      const candidates = (adjacency[current] ?? []).filter((node) => (layerOf[node] ?? 0) >= layer);
      if (candidates.length === 0) break;
      computations += candidates.length;
      let best = candidates[0] as number;
      let bestDistance = squared(best);
      for (const node of candidates) {
        const distance = squared(node);
        if (distance < bestDistance) { best = node; bestDistance = distance; }
      }
      if (bestDistance >= here) break;
      current = best;
    }
  }
  let exactNearest = 0;
  let exactDistance = Infinity;
  for (let node = 0; node < world.x.length; node += 1) {
    const distance = squared(node);
    if (distance < exactDistance) { exactDistance = distance; exactNearest = node; }
  }
  return { path, computations, exactNearest };
}

// ── Recall ───────────────────────────────────────────────────────────────────

export interface RecallSummary {
  indexed: RecallRow[];
  brute: RecallRow | null;
  best: RecallRow | null;
  worst: RecallRow | null;
  fastestMilliseconds: number | null;
  slowestMilliseconds: number | null;
  /** True when some indexed setting returns exactly the exact answer on every probe. */
  reachesPerfect: boolean;
  /** The smallest ef_search at which recall is 1. */
  firstPerfectEf: number | null;
}

export function recallSummary(rows: readonly RecallRow[], basis: string): RecallSummary {
  const ofBasis = rows.filter((row) => row.basis === basis).sort((a, b) => a.ef_search - b.ef_search);
  const indexed = ofBasis.filter((row) => row.ef_search > 0);
  const brute = ofBasis.find((row) => row.ef_search === 0) ?? null;
  let best: RecallRow | null = null;
  let worst: RecallRow | null = null;
  for (const row of indexed) {
    if (best === null || row.recall_at_k > best.recall_at_k) best = row;
    if (worst === null || row.recall_at_k < worst.recall_at_k) worst = row;
  }
  const times = indexed.map((row) => row.mean_query_milliseconds);
  const perfect = indexed.find((row) => row.recall_at_k >= 0.9999) ?? null;
  return {
    indexed, brute, best, worst,
    fastestMilliseconds: times.length ? Math.min(...times) : null,
    slowestMilliseconds: times.length ? Math.max(...times) : null,
    reachesPerfect: perfect !== null,
    firstPerfectEf: perfect?.ef_search ?? null,
  };
}

/** `1 / (1 - recall) / k`: roughly one query in this many returns one wrong neighbour. */
export function queriesPerMiss(recall: number, neighbours: number): number {
  return 1 / Math.max(1 - recall, 1e-9) / neighbours;
}

// ── Helpers shared with the handler ─────────────────────────────────────────

/** Parses a comma-joined series. Returns null when any entry is not a finite number. */
export function parseSeries(text: unknown): number[] | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const parts = text.split(",");
  const out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i += 1) {
    const value = Number(parts[i]);
    if (!Number.isFinite(value)) return null;
    out[i] = value;
  }
  return out;
}

export function blockRank(block: string): number {
  const index = (BLOCK_ORDER as readonly string[]).indexOf(block);
  return index === -1 ? BLOCK_ORDER.length : index;
}

/** The feature columns of a basis, in body order. */
export function basisColumns(body: Pick<VectorSpaceBody, "featureBlocks" | "values" | "featureNames">, basis: Basis): { names: string[]; blocks: string[]; columns: number[][] } {
  const allowed = new Set(BASE_BLOCKS[basis]);
  const names: string[] = [];
  const blocks: string[] = [];
  const columns: number[][] = [];
  body.featureNames.forEach((name, index) => {
    const block = body.featureBlocks[index] as string;
    if (!allowed.has(block)) return;
    names.push(name);
    blocks.push(block);
    columns.push(body.values[index] as number[]);
  });
  return { names, blocks, columns };
}
