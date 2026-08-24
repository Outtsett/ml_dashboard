import { describe, it, expect } from 'vitest';
import {
  computeCandleGeometry,
  toFeatureMatrix,
  Z_CLIP,
  FEATURE_NAMES,
} from '@/system/architecture-explorer/mechanism/data/candleGeometry';
import type { OHLCVBar } from '@shared/ohlcv';

function bar(
  i: number,
  o: number,
  h: number,
  l: number,
  c: number,
  v = 100,
): OHLCVBar {
  return {
    timestamp: 1_700_000_000 + i * 60,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v,
  };
}

describe('candle geometry — in-candle shape', () => {
  it('computes scale-free shape exactly as the Python does', () => {
    // range = 10. open_norm = (2-0)/10, close_norm = (8-0)/10,
    // body_norm = (8-2)/10, upper_norm = (10-8)/10, lower_norm = (2-0)/10
    const rows = computeCandleGeometry([bar(0, 2, 10, 0, 8)], 100);
    const r = rows[0]!;
    expect(r.open_norm).toBeCloseTo(0.2, 12);
    expect(r.close_norm).toBeCloseTo(0.8, 12);
    expect(r.body_norm).toBeCloseTo(0.6, 12);
    expect(r.upper_norm).toBeCloseTo(0.2, 12);
    expect(r.lower_norm).toBeCloseTo(0.2, 12);
  });

  it('is scale-invariant — a 100x bigger bar has identical shape', () => {
    const small = computeCandleGeometry([bar(0, 2, 10, 0, 8)], 100)[0]!;
    const big = computeCandleGeometry([bar(0, 200, 1000, 0, 800)], 100)[0]!;
    expect(big.body_norm).toBeCloseTo(small.body_norm, 12);
    expect(big.upper_norm).toBeCloseTo(small.upper_norm, 12);
    expect(big.lower_norm).toBeCloseTo(small.lower_norm, 12);
  });

  it('uses the neutral value for a zero-range bar, never NaN or a divide', () => {
    const r = computeCandleGeometry([bar(0, 5, 5, 5, 5)], 100)[0]!;
    expect(r.open_norm).toBe(0.5);
    expect(r.close_norm).toBe(0.5);
    expect(r.body_norm).toBe(0);
    expect(r.upper_norm).toBe(0);
    expect(r.lower_norm).toBe(0);
  });

  it('keeps body_norm within [-1, 1] and wick norms within [0, 1]', () => {
    // Bars must be well-formed (high >= max(o,c), low <= min(o,c)) — the same
    // invariant real OHLC always satisfies. The Python does not clamp malformed
    // bars either, so the port must not invent a guard the source lacks.
    const bars = Array.from({ length: 50 }, (_, i) => {
      const o = 100 + (i % 7);
      const c = 100 + (i % 3);
      return bar(i, o, Math.max(o, c) + (i % 5) + 1, Math.min(o, c) - (i % 4) - 1, c);
    });
    for (const r of computeCandleGeometry(bars, 100)) {
      expect(r.body_norm).toBeGreaterThanOrEqual(-1);
      expect(r.body_norm).toBeLessThanOrEqual(1);
      expect(r.upper_norm).toBeGreaterThanOrEqual(0);
      expect(r.upper_norm).toBeLessThanOrEqual(1);
      expect(r.lower_norm).toBeGreaterThanOrEqual(0);
      expect(r.lower_norm).toBeLessThanOrEqual(1);
    }
  });
});

describe('candle geometry — causal rolling z-scores', () => {
  const bars = Array.from({ length: 40 }, (_, i) =>
    bar(i, 100 + i, 102 + i, 99 + i, 101 + i, 1000 + i * 10),
  );

  it('leaves warmup rows null, not zero', () => {
    const rows = computeCandleGeometry(bars, 10);
    for (let i = 0; i < 9; i++) expect(rows[i]!.return_z).toBeNull();
  });

  it('is causal — a future bar cannot change an earlier z-score', () => {
    const a = computeCandleGeometry(bars, 10);
    const b = computeCandleGeometry(
      [...bars, bar(99, 500, 900, 100, 800, 9e6)],
      10,
    );
    for (let i = 0; i < bars.length; i++) {
      expect(b[i]!.return_z).toBe(a[i]!.return_z);
      expect(b[i]!.body_z).toBe(a[i]!.body_z);
    }
  });

  it('uses population std (ddof=0), matching r.std(ddof=0)', () => {
    // range = high - low = n, so log_range = log(n) after eps flooring.
    const seq = [1, 2, 3, 4].map((n, i) => bar(i, 0, n, 0, 0, 1));
    const rows = computeCandleGeometry(seq, 4);
    const logs = [1, 2, 3, 4].map((n) => Math.log(n));
    const mean = logs.reduce((s, v) => s + v, 0) / 4;
    const sd = Math.sqrt(
      logs.reduce((s, v) => s + (v - mean) ** 2, 0) / 4,
    );
    expect(rows[3]!.range_z).toBeCloseTo((logs[3]! - mean) / sd, 10);
  });

  it('clips to +/- Z_CLIP', () => {
    const spiky = [
      ...Array.from({ length: 30 }, (_, i) => bar(i, 100, 100.5, 99.5, 100, 1000)),
      bar(30, 100, 400, 1, 100, 1000),
    ];
    const rows = computeCandleGeometry(spiky, 30);
    const last = rows[30]!.range_z!;
    expect(Math.abs(last)).toBeLessThanOrEqual(Z_CLIP);
  });

  it('yields null when the trailing window has zero variance (0/0)', () => {
    const flat = Array.from({ length: 20 }, (_, i) =>
      bar(i, 100, 101, 99, 100, 1000),
    );
    const rows = computeCandleGeometry(flat, 10);
    expect(rows[19]!.range_z).toBeNull();
  });
});

describe('feature matrix', () => {
  it('drops rows with any null feature and reports the warmup count', () => {
    const bars = Array.from({ length: 30 }, (_, i) =>
      bar(i, 100 + i, 103 + i + (i % 3), 99 + i, 101 + (i % 4), 900 + (i % 7) * 20),
    );
    const rows = computeCandleGeometry(bars, 10);
    const m = toFeatureMatrix(rows, FEATURE_NAMES);
    expect(m.columns).toEqual(FEATURE_NAMES);
    expect(m.rows.length).toBeLessThan(bars.length);
    expect(m.warmup).toBe(bars.length - m.rows.length);
    for (const r of m.rows) {
      expect(r.values.every((v) => Number.isFinite(v))).toBe(true);
      expect(r.values.length).toBe(FEATURE_NAMES.length);
    }
  });
});

// ── Parity with the Python ────────────────────────────────────────────────
// Fixture generated by scripts/candle_geometry.py on 300 real MNQ 1m bars.
// This is the check that makes the TypeScript port trustworthy: same bars in,
// same numbers out, column for column, including where the Python yields NaN.
import parity from './candleGeometry.parity.json';

interface ParityFixture {
  bars: OHLCVBar[];
  columns: string[];
  expected: (number | null)[][];
}

describe('candle geometry — parity with scripts/candle_geometry.py', () => {
  it('matches the Python column for column on real MNQ bars', () => {
    const fx = parity as unknown as ParityFixture;
    const rows = computeCandleGeometry(fx.bars, 100);
    expect(rows.length).toBe(fx.bars.length);

    let compared = 0;
    fx.columns.forEach((col, ci) => {
      const expected = fx.expected[ci]!;
      rows.forEach((r, ri) => {
        const got = (r as unknown as Record<string, number | null>)[col];
        const want = expected[ri];
        if (want === null || want === undefined) {
          expect(got, `${col}[${ri}] should be null`).toBeNull();
        } else {
          expect(got as number, `${col}[${ri}]`).toBeCloseTo(want, 9);
          compared++;
        }
      });
    });
    // Guard against a vacuous pass if the fixture were all nulls.
    expect(compared).toBeGreaterThan(1000);
  });
});
