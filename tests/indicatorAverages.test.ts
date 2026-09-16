/**
 * Overlay moving averages have to stay on the chart's scale.
 *
 * lightweight-charts asserts on any series value outside ±9.007e13 and the
 * assertion escapes to the React error boundary, so one diverging indicator
 * takes the whole Market page down. HWMA did exactly that: written without the
 * Holt-Winters carry terms it is a double integrator with positive feedback, and
 * on real MNQ 1-minute closes it passed 1e6 by bar 105 and reached 1e93.
 *
 * The regression test is the bound, not the formula: an average of a series that
 * stays inside a 200-point band must itself stay near that band, forever.
 */
import { describe, it, expect } from 'vitest';
import { calcHWMA, calcHMA, calcALMA } from '@/market/lib/calculators/overlay/averages';

/** 2,000 bars wandering inside ~25,650-25,800, the shape of real MNQ 1m closes. */
function syntheticBars(count = 2000) {
  const bars = [];
  let price = 25_700;
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-noise: no Math.random, so a failure reproduces.
    price += Math.sin(i / 7) * 3 + Math.cos(i / 31) * 2;
    bars.push({
      time: 1_700_000_000 + i * 60,
      open: price - 1, high: price + 2, low: price - 2, close: price, volume: 100 + (i % 17),
    });
  }
  return bars as never[];
}

describe('overlay averages stay plottable', () => {
  const bars = syntheticBars();
  const closes = (bars as unknown as { close: number }[]).map(b => b.close);
  const low = Math.min(...closes);
  const high = Math.max(...closes);

  it('HWMA tracks price instead of diverging', () => {
    const points = calcHWMA(bars, 0.2, 0.1, 0.1);
    expect(points.length).toBeGreaterThan(0);
    const values = points.map(p => p.value).filter((v): v is number => v !== null);
    expect(values.length).toBe(closes.length);
    for (const value of values) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // Generous band: an average may overshoot a turn, but not by 1000 points,
    // and certainly not by 1e13.
    expect(Math.min(...values)).toBeGreaterThan(low - 500);
    expect(Math.max(...values)).toBeLessThan(high + 500);
    // The last value is an average of recent price, so it sits near the close.
    expect(Math.abs(values[values.length - 1]! - closes[closes.length - 1]!)).toBeLessThan(200);
  });

  it('every overlay average stays inside the chart value limit', () => {
    const LIMIT = 9.007e13; // lightweight-charts' assertion bound
    const series = [
      ['HWMA', calcHWMA(bars, 0.2, 0.1, 0.1)],
      ['HMA', calcHMA(bars, 20)],
      ['ALMA', calcALMA(bars, 9, 0.85, 6)],
    ] as const;
    for (const [name, points] of series) {
      const worst = Math.max(...points.map(p => (p.value === null ? 0 : Math.abs(p.value))));
      expect(worst, `${name} produced ${worst}`).toBeLessThan(LIMIT);
    }
  });
});
