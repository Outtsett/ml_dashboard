import { describe, it, expect } from 'vitest';
import { kmeans } from '@/system/architecture-explorer/mechanism/compute/kmeans';

/** Three well-separated blobs, deterministic — no RNG in the fixture. */
function blobs(): number[][] {
  const centers = [
    [0, 0],
    [10, 10],
    [0, 10],
  ];
  const pts: number[][] = [];
  for (let c = 0; c < centers.length; c++) {
    for (let i = 0; i < 20; i++) {
      const jitter = ((i * 37) % 11) / 20 - 0.275; // deterministic, |j| < 0.3
      pts.push([centers[c]![0]! + jitter, centers[c]![1]! - jitter]);
    }
  }
  return pts;
}

describe('kmeans', () => {
  it('recovers three separated blobs', () => {
    const t = kmeans(blobs(), 3, { seed: 7 });
    expect(t.converged).toBe(true);
    // `|| 0` normalizes -0 to 0; Math.round(-1e-9) is -0, which toEqual
    // distinguishes from 0 and which carries no meaning here.
    const finals = t.steps[t.steps.length - 1]!.centroids
      .map((c) => [Math.round(c[0]!) || 0, Math.round(c[1]!) || 0])
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    expect(finals).toEqual([
      [0, 0],
      [0, 10],
      [10, 10],
    ]);
  });

  it('assigns every point to exactly one cluster in range', () => {
    const pts = blobs();
    const t = kmeans(pts, 3, { seed: 7 });
    const last = t.steps[t.steps.length - 1]!;
    expect(last.assignments.length).toBe(pts.length);
    for (const a of last.assignments) {
      expect(Number.isInteger(a)).toBe(true);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(3);
    }
  });

  it('never increases inertia — the convergence guarantee', () => {
    const t = kmeans(blobs(), 3, { seed: 7 });
    for (let i = 1; i < t.steps.length; i++) {
      expect(t.steps[i]!.inertia).toBeLessThanOrEqual(t.steps[i - 1]!.inertia + 1e-9);
    }
  });

  it('is deterministic — same seed and points give an identical trace', () => {
    const a = kmeans(blobs(), 3, { seed: 42 });
    const b = kmeans(blobs(), 3, { seed: 42 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('records every real iteration, starting from the init step', () => {
    const t = kmeans(blobs(), 3, { seed: 7 });
    expect(t.steps.length).toBeGreaterThanOrEqual(2);
    expect(t.iterations).toBe(t.steps.length - 1);
  });

  it('handles k larger than the point count without emitting empty centroids', () => {
    const t = kmeans(
      [
        [0, 0],
        [1, 1],
      ],
      5,
      { seed: 3 },
    );
    expect(t.steps[t.steps.length - 1]!.centroids.length).toBeLessThanOrEqual(2);
  });

  it('returns an empty trace for no points rather than throwing', () => {
    const t = kmeans([], 3, { seed: 1 });
    expect(t.steps).toEqual([]);
    expect(t.converged).toBe(false);
  });
});
