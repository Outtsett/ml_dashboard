/**
 * The tree is a REAL CART grown on real rows — these pin the properties that
 * make the routing animation trustworthy.
 */
import { describe, it, expect } from 'vitest';
import { growTree, routePath, nextBarLabels } from '@/system/architecture-explorer/mechanism/compute/tree';

/** Rows where feature 0 cleanly predicts the next bar's return sign. */
function separable(n = 80): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const up = i % 2 === 0;
    // col 4 is return_z; a row's OWN col 0 encodes what the NEXT return will be.
    rows.push([up ? 1 : -1, (i % 7) / 7, (i % 5) / 5, (i % 3) / 3, up ? -1 : 1, (i % 4) / 4]);
  }
  return rows;
}

describe('growTree', () => {
  it('labels from the NEXT bar, dropping the row that has no successor', () => {
    const rows = separable(10);
    expect(nextBarLabels(rows, 4).length).toBe(rows.length - 1);
    expect(growTree(rows).samples).toBe(rows.length - 1);
  });

  it('finds the separating split and classifies it perfectly', () => {
    const t = growTree(separable(80));
    expect(t.root).not.toBeNull();
    expect(t.root!.feature).not.toBeNull();
    expect(t.trainAccuracy).toBeCloseTo(1, 5);
  });

  it('gini never increases from a parent to its weighted children', () => {
    const t = growTree(separable(80));
    const check = (n = t.root!) => {
      if (n.feature === null || !n.left || !n.right) return;
      const nl = n.left.counts[0] + n.left.counts[1];
      const nr = n.right.counts[0] + n.right.counts[1];
      const weighted = (nl * n.left.gini + nr * n.right.gini) / (nl + nr);
      expect(weighted).toBeLessThanOrEqual(n.gini + 1e-9);
      check(n.left); check(n.right);
    };
    check();
  });

  it('respects the depth cap', () => {
    expect(growTree(separable(120), 4, 3).maxDepth).toBeLessThanOrEqual(3);
  });

  it('routePath ends at a leaf and follows the real comparisons', () => {
    const rows = separable(80);
    const t = growTree(rows);
    const path = routePath(t.root, rows[0]!);
    expect(path.length).toBeGreaterThan(0);
    expect(path.at(-1)!.feature).toBeNull();
    for (let i = 0; i < path.length - 1; i++) {
      const n = path[i]!;
      const expected = rows[0]![n.feature!]! <= n.threshold ? n.left : n.right;
      expect(path[i + 1]).toBe(expected);
    }
  });

  it('is deterministic — no seeding, no randomness', () => {
    const rows = separable(60);
    expect(JSON.stringify(growTree(rows))).toBe(JSON.stringify(growTree(rows)));
  });

  it('returns an empty tree for too little data rather than throwing', () => {
    expect(growTree([[0, 0, 0, 0, 0, 0]]).root).toBeNull();
  });
});
