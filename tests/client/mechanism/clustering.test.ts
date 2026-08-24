/**
 * The clustering kernels are REAL algorithms, and different ones.
 *
 * These tests pin the behaviour that distinguishes each from k-means — the
 * behaviour that makes drawing them separately worth doing at all.
 */
import { describe, it, expect } from 'vitest';
import {
  gmm, dbscan, meanShift, agglomerative, som, copKmeans, affinityPropagation,
} from '@/system/architecture-explorer/mechanism/compute/clustering';

/** Three separated blobs, deterministic. */
function blobs(): number[][] {
  const centers = [[0, 0], [10, 10], [0, 10]];
  const pts: number[][] = [];
  for (let c = 0; c < centers.length; c++) {
    for (let i = 0; i < 18; i++) {
      const j = ((i * 37) % 11) / 20 - 0.275;
      pts.push([centers[c]![0]! + j, centers[c]![1]! - j]);
    }
  }
  return pts;
}
/** Blobs plus far-flung outliers, for the density methods. */
function blobsWithNoise(): number[][] {
  return [...blobs(), [40, -30], [-35, 42], [55, 55]];
}

describe('GMM', () => {
  it('log-likelihood never decreases — the EM guarantee', () => {
    const t = gmm(blobs(), 3);
    for (let i = 1; i < t.steps.length; i++) {
      expect(t.steps[i]!.metricValue).toBeGreaterThanOrEqual(t.steps[i - 1]!.metricValue - 1e-6);
    }
  });
  it('reports per-component spread — the ellipse k-means cannot express', () => {
    const last = gmm(blobs(), 3).steps.at(-1)!;
    expect(last.spreads).toBeDefined();
    expect(last.spreads!.length).toBe(last.centroids!.length);
    for (const s of last.spreads!) expect(s.every((v) => v >= 0)).toBe(true);
  });
});

describe('DBSCAN', () => {
  it('labels far-flung points as noise instead of forcing them into a cluster', () => {
    const pts = blobsWithNoise();
    const last = dbscan(pts, 4).steps.at(-1)!;
    // The three planted outliers are the last three points.
    const outliers = last.assignments.slice(-3);
    expect(outliers.every((a) => a === -1)).toBe(true);
  });
  it('discovers the cluster count rather than being given one', () => {
    const t = dbscan(blobs(), 4);
    expect(t.k).toBeGreaterThanOrEqual(2);
  });
});

describe('Mean Shift', () => {
  it('discovers modes without being told k, and separates the blobs', () => {
    const t = meanShift(blobs());
    expect(t.k).toBeGreaterThanOrEqual(2);
    const last = t.steps.at(-1)!;
    expect(new Set(last.assignments).size).toBeGreaterThanOrEqual(2);
  });
});

describe('Agglomerative', () => {
  it('cluster count decreases monotonically — merges are irreversible', () => {
    const t = agglomerative(blobs(), 3);
    for (let i = 1; i < t.steps.length; i++) {
      expect(t.steps[i]!.metricValue).toBeLessThanOrEqual(t.steps[i - 1]!.metricValue);
    }
    expect(t.steps.at(-1)!.metricValue).toBe(3);
  });
});

describe('SOM', () => {
  it('quantization error improves as the lattice anneals', () => {
    const t = som(blobs(), 3, 2);
    expect(t.steps.at(-1)!.metricValue).toBeLessThan(t.steps[0]!.metricValue);
  });
  it('emits lattice edges — the topology it preserves', () => {
    const last = som(blobs(), 3, 2).steps.at(-1)!;
    expect(last.gridEdges!.length).toBeGreaterThan(0);
  });
});

describe('COP-KMeans', () => {
  it('reports its constraint state rather than silently relaxing', () => {
    const last = copKmeans(blobs(), 3).steps.at(-1)!;
    expect(last.note).toMatch(/must-link/);
    expect(last.note).toMatch(/cannot-link/);
  });
});

describe('Affinity Propagation', () => {
  it('centres are real data points, not synthetic means', () => {
    const pts = blobs();
    const last = affinityPropagation(pts).steps.at(-1)!;
    for (const c of last.centroids!) {
      expect(pts.some((p) => p[0] === c[0] && p[1] === c[1])).toBe(true);
    }
  });
});

describe('the kernels are genuinely different algorithms', () => {
  it('do not all produce identical assignments on the same points', () => {
    const pts = blobs();
    const sigs = [
      gmm(pts, 3), dbscan(pts, 4), meanShift(pts), agglomerative(pts, 3),
      som(pts, 3, 2), copKmeans(pts, 3), affinityPropagation(pts),
    ].map((t) => JSON.stringify(t.steps.at(-1)!.assignments));
    expect(new Set(sigs).size).toBeGreaterThan(1);
  });
  it('every kernel returns an empty trace for no points rather than throwing', () => {
    for (const t of [gmm([], 3), dbscan([]), meanShift([]), agglomerative([]), som([]), copKmeans([]), affinityPropagation([])]) {
      expect(t.steps).toEqual([]);
    }
  });
});
