/**
 * Marker placement: which bar a label timestamp lands on.
 *
 * `snapToCandle` is the only thing standing between a label's timestamp and
 * the bar it gets drawn on, so an error here puts a marker on the wrong
 * candle — the overlay still looks populated, it is just describing the wrong
 * bar, which is the hardest kind of chart bug to notice.
 *
 * The tolerance past the last bar exists on purpose: session-offset timeframes
 * (4h futures bars open at 22:00 UTC, and the final bar of a session can be
 * short) produce label timestamps slightly past the last bar open that still
 * belong to it. That tolerance must stop short of a full bar, because
 * `last + timeframe` is exactly the NEXT bar's open — a bar the chart has not
 * loaded — and folding it onto `last` stamps a foreign label on the rightmost
 * candle. The overlay routinely fetches labels past the loaded range (the
 * viewport query is padded 20% each side), so this is reachable, not
 * theoretical.
 */

import { describe, it, expect } from 'vitest';
import { snapToCandle, buildCandleTimes } from '@/market/components/useSeriesMarkers';
import type { Time } from 'lightweight-charts';

const HOUR = 3600;
/** Four 1h bars, in seconds, as the chart stores them. */
const BARS = [1000, 1000 + HOUR, 1000 + 2 * HOUR, 1000 + 3 * HOUR];
const LAST = BARS[BARS.length - 1]!;
const sec = (s: number) => s * 1000;

describe('buildCandleTimes', () => {
  it('projects candle times in the order given', () => {
    const candles = BARS.map(t => ({ time: t as Time }));
    expect(buildCandleTimes(candles)).toEqual(BARS);
  });
});

describe('snapToCandle', () => {
  it('is the identity on a timestamp that is already a bar open', () => {
    for (const t of BARS) {
      expect(snapToCandle(sec(t), BARS, HOUR)).toBe(t);
    }
  });

  it('snaps a mid-bar timestamp back to the bar containing it', () => {
    expect(snapToCandle(sec(BARS[1]! + 1), BARS, HOUR)).toBe(BARS[1]);
    expect(snapToCandle(sec(BARS[1]! + HOUR - 1), BARS, HOUR)).toBe(BARS[1]);
  });

  it('drops a timestamp before the first bar', () => {
    expect(snapToCandle(sec(BARS[0]! - 1), BARS, HOUR)).toBeNull();
  });

  it('keeps a short final session bar attached to the last bar', () => {
    expect(snapToCandle(sec(LAST + 1), BARS, HOUR)).toBe(LAST);
    expect(snapToCandle(sec(LAST + HOUR - 1), BARS, HOUR)).toBe(LAST);
  });

  // The regression: this timestamp is the next bar's open, not the last bar's.
  it('drops the next bar open rather than folding it onto the last bar', () => {
    expect(snapToCandle(sec(LAST + HOUR), BARS, HOUR)).toBeNull();
  });

  it('drops anything past the next bar open', () => {
    expect(snapToCandle(sec(LAST + HOUR + 1), BARS, HOUR)).toBeNull();
    expect(snapToCandle(sec(LAST + 5 * HOUR), BARS, HOUR)).toBeNull();
  });

  it('returns null when there are no bars at all', () => {
    expect(snapToCandle(sec(1000), [], HOUR)).toBeNull();
  });

  it('places every bar of a realistic series on itself', () => {
    const series = Array.from({ length: 500 }, (_, i) => 1_700_000_000 + i * HOUR);
    for (const t of series) {
      expect(snapToCandle(sec(t), series, HOUR)).toBe(t);
    }
  });
});
