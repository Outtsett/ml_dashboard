/**
 * PCA is exact, and is the optimal linear autoencoder — both are claims the
 * animation makes on screen, so both are pinned here.
 */
import { describe, it, expect } from 'vitest';
import { pca, encode, decode, reconstructionError } from '@/system/architecture-explorer/mechanism/compute/pca';

/** Points on a known axis: variance concentrated on one direction. */
function alongAxis(n = 120): number[][] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i - n / 2) / 10;
    return [t, t * 0.0001, t * 0.0001];
  });
}

describe('pca', () => {
  it('explained variance sums to 1 and is descending', () => {
    const p = pca(alongAxis());
    expect(p.explained.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
    for (let i = 1; i < p.explained.length; i++) {
      expect(p.explained[i]!).toBeLessThanOrEqual(p.explained[i - 1]! + 1e-12);
    }
  });

  it('finds the true dominant axis', () => {
    const p = pca(alongAxis());
    expect(p.explained[0]!).toBeGreaterThan(0.99);
    // First component aligned with x, up to sign.
    expect(Math.abs(p.components[0]![0]!)).toBeGreaterThan(0.99);
  });

  it('components are unit length and mutually orthogonal', () => {
    const p = pca(alongAxis());
    for (const c of p.components) {
      expect(Math.sqrt(c.reduce((s, v) => s + v * v, 0))).toBeCloseTo(1, 8);
    }
    for (let i = 0; i < p.components.length; i++) {
      for (let j = i + 1; j < p.components.length; j++) {
        const dot = p.components[i]!.reduce((s, v, d) => s + v * p.components[j]![d]!, 0);
        expect(Math.abs(dot)).toBeLessThan(1e-6);
      }
    }
  });

  it('full-width encode/decode is lossless — the reconstruction identity', () => {
    const rows = alongAxis(40);
    const p = pca(rows);
    for (const r of rows.slice(0, 8)) {
      const back = decode(encode(r, p, p.components.length), p);
      for (let i = 0; i < r.length; i++) expect(back[i]!).toBeCloseTo(r[i]!, 6);
    }
  });

  it('reconstruction error falls monotonically as the bottleneck widens', () => {
    const rows = alongAxis(80);
    const p = pca(rows);
    let prev = Infinity;
    for (let k = 1; k <= p.components.length; k++) {
      const e = reconstructionError(rows, p, k);
      expect(e).toBeLessThanOrEqual(prev + 1e-9);
      prev = e;
    }
    expect(prev).toBeCloseTo(0, 6);
  });

  it('handles an empty input rather than throwing', () => {
    const p = pca([]);
    expect(p.components).toEqual([]);
    expect(reconstructionError([], p, 1)).toBe(0);
  });
});
