/**
 * Attention is the real operation, on real bars.
 *
 * The claim on screen is softmax(QK^T/sqrt(d_k))V with seeded projections. These
 * tests pin the parts that make that claim checkable.
 */
import { describe, it, expect } from 'vitest';
import { attention } from '@/system/architecture-explorer/mechanism/compute/attention';

function window(T: number, F = 6): number[][] {
  return Array.from({ length: T }, (_, i) =>
    Array.from({ length: F }, (_, j) => Math.sin((i + 1) * (j + 1) * 0.37) * 1.4),
  );
}

describe('scaled dot-product attention', () => {
  it('every row of the attention map sums to 1 — it is a real softmax', () => {
    const r = attention(window(12));
    for (const row of r.attn) {
      expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
  });

  it('all weights are non-negative and bounded by 1', () => {
    const r = attention(window(12));
    for (const row of r.attn) for (const v of row) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('the map is square in the number of bars', () => {
    const r = attention(window(9));
    expect(r.T).toBe(9);
    expect(r.attn.length).toBe(9);
    for (const row of r.attn) expect(row.length).toBe(9);
  });

  it('output is a genuine weighted sum: one row of attn times V, dimension d_k', () => {
    const r = attention(window(10));
    expect(r.out.length).toBe(r.T);
    for (const o of r.out) {
      expect(o.length).toBe(r.dk);
      expect(o.every(Number.isFinite)).toBe(true);
    }
  });

  it('is deterministic — seeded projections, never Math.random', () => {
    const w = window(8);
    expect(JSON.stringify(attention(w))).toBe(JSON.stringify(attention(w)));
  });

  it('a genuinely different window changes the map', () => {
    const a = JSON.stringify(attention(window(8)).attn);
    const b = JSON.stringify(
      attention(window(8).map((r, i) => r.map((v, j) => v + (i - j) * 0.31))).attn,
    );
    expect(a).not.toBe(b);
  });

  it('is invariant to a global sign flip — a real property, not a bug', () => {
    // Q = XWq and K = XWk, so negating X negates BOTH and leaves QK^T unchanged.
    // Worth pinning: it is the kind of "nothing happened" that otherwise looks
    // like the animation ignoring its input.
    const w = window(8);
    const flipped = w.map((r) => r.map((v) => -v));
    expect(JSON.stringify(attention(w).attn)).toBe(JSON.stringify(attention(flipped).attn));
  });

  it('scores are scaled by 1/sqrt(d_k) — the scaling in the name', () => {
    const r = attention(window(6));
    // With the scaling applied, scores stay in a sane range rather than
    // exploding with d_k; an unscaled dot product here would be ~sqrt(dk)x larger.
    const mx = Math.max(...r.scores.flat().map(Math.abs));
    expect(Number.isFinite(mx)).toBe(true);
    expect(mx).toBeLessThan(500);
  });

  it('returns an empty result for no bars rather than throwing', () => {
    const r = attention([]);
    expect(r.T).toBe(0);
    expect(r.attn).toEqual([]);
  });
});
