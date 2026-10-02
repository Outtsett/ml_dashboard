/**
 * The candlestick-pattern hover card: which candles an arrow is about, and
 * which textbook drawing it is compared against.
 *
 * The window is the part that can silently lie. A pattern fires on the bar
 * that completes it but reads the N bars before, and sessions have gaps, so a
 * window stepped back in TIME lands on the wrong candles on any chart with a
 * weekend in it. These tests pin the window to the bars that exist.
 */
import { describe, it, expect } from 'vitest';
import {
  CONTEXT_BARS,
  allPatternTemplates,
  confirmedPatternTime,
  parsePatternMarkerId,
  patternDirection,
  patternHoverInfo,
  patternMarkerId,
  patternWindow,
  templateFor,
  type MiniBar,
} from '@/market/lib/patternHover';
import { TALIB_PATTERN_CATALOG } from '@/market/lib/talibPatternCatalog';
import templatesFile from '@shared/candlePatternTemplates.json';

const HOUR = 3600;

/** Bars at the given times, each a plain up candle so only time matters. */
function barsAt(times: number[]): MiniBar[] {
  return times.map((time, i) => ({ time, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i }));
}

describe('pattern marker ids', () => {
  it('round-trips the bar time through the id lightweight-charts reports on hover', () => {
    expect(parsePatternMarkerId(patternMarkerId(1_700_000_000))).toBe(1_700_000_000);
  });

  it('ignores every other hovered object', () => {
    expect(parsePatternMarkerId(undefined)).toBeNull();
    expect(parsePatternMarkerId('trade-17')).toBeNull();
    expect(parsePatternMarkerId(42)).toBeNull();
    expect(parsePatternMarkerId('cdl-marker:not-a-time')).toBeNull();
  });
});

describe('pattern window', () => {
  // Friday 20:00, 21:00, then Monday 00:00, 01:00, 02:00: a weekend in the middle.
  const friday = 1_758_916_800;
  const monday = friday + 52 * HOUR;
  const bars = barsAt([friday - 2 * HOUR, friday - HOUR, friday, friday + HOUR, monday, monday + HOUR, monday + 2 * HOUR]);

  it('takes the N bars ending at the marker by index, across a session gap', () => {
    const window = patternWindow(bars, monday + HOUR, 3, 2)!;
    expect(window.pattern.map(b => b.time)).toEqual([friday + HOUR, monday, monday + HOUR]);
    expect(window.context.map(b => b.time)).toEqual([friday - HOUR, friday]);
  });

  it('draws fewer context bars rather than none near the left edge', () => {
    const window = patternWindow(bars, friday + HOUR, 3, CONTEXT_BARS)!;
    expect(window.pattern.map(b => b.time)).toEqual([friday - HOUR, friday, friday + HOUR]);
    expect(window.context.map(b => b.time)).toEqual([friday - 2 * HOUR]);
  });

  it('refuses a window the chart does not hold all of', () => {
    expect(patternWindow(bars, friday - HOUR, 3)).toBeNull();
  });

  it('refuses a marker time that is not a bar on the chart', () => {
    expect(patternWindow(bars, friday + 30 * 60, 1)).toBeNull();
  });
});

describe('direction', () => {
  it('reads the sign for directional patterns and the colour-coded ones', () => {
    expect(patternDirection('engulfing', 0.8)).toBe('bullish');
    expect(patternDirection('engulfing', -1)).toBe('bearish');
    expect(patternDirection('spinningtop', -1)).toBe('bearish');
  });

  it('never calls an undirected flag bullish', () => {
    for (const name of ['doji', 'dragonflydoji', 'gravestonedoji', 'longleggeddoji', 'rickshawman', 'takuri']) {
      expect(patternDirection(name, 1)).toBe('neutral');
    }
  });
});

describe('hikkake confirmation', () => {
  const bars = barsAt([0, HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR, 5 * HOUR]);

  it('anchors a +/-2 confirmation on the +/-1 pattern bar up to three bars back', () => {
    const firings = [{ time: HOUR, value: 1 }, { time: 3 * HOUR, value: 2 }];
    expect(confirmedPatternTime(firings, 3 * HOUR, 2, bars)).toBe(HOUR);
  });

  it('does not anchor on a pattern bar of the opposite sign', () => {
    const firings = [{ time: 2 * HOUR, value: -1 }, { time: 3 * HOUR, value: 2 }];
    expect(confirmedPatternTime(firings, 3 * HOUR, 2, bars)).toBeNull();
  });

  it('draws the confirmed pattern, not the three bars before the confirmation', () => {
    const info = patternHoverInfo('hikkake', 2, 4 * HOUR, bars, 2 * HOUR)!;
    expect(info.isConfirmation).toBe(true);
    expect(info.window.pattern.map(b => b.time)).toEqual([0, HOUR, 2 * HOUR]);
  });
});

describe('textbook templates', () => {
  const templates = allPatternTemplates();
  // Which directions TA-Lib can emit per pattern, copied into the templates file
  // from datalake/scripts/talib_candlestick_rules.json when it was built.
  const required = (templatesFile as { required_directions: Record<string, string[]> }).required_directions;

  it('covers every one of the 61 patterns', () => {
    const covered = new Set(templates.map(t => t.pattern));
    const missing = TALIB_PATTERN_CATALOG.filter(p => !covered.has(p.name)).map(p => p.name);
    expect(missing).toEqual([]);
  });

  it('draws each pattern with exactly the bars TA-Lib reads', () => {
    for (const template of templates) {
      const entry = TALIB_PATTERN_CATALOG.find(p => p.name === template.pattern)!;
      expect(template.patternBars, template.pattern).toHaveLength(entry.candleCount);
      expect(template.candleCaptions, template.pattern).toHaveLength(entry.candleCount);
    }
  });

  it('has a drawing for every direction TA-Lib can fire each pattern in', () => {
    for (const entry of TALIB_PATTERN_CATALOG) {
      const directions = required[entry.name];
      expect(directions, entry.name).toBeDefined();
      for (const direction of directions!) {
        const value = direction === 'bearish' ? -1 : 1;
        expect(templateFor(entry.name, value)?.direction, `${entry.name} ${direction}`).toBe(direction);
      }
    }
  });

  it('only draws valid candles', () => {
    for (const template of templates) {
      for (const bar of [...template.context, ...template.patternBars]) {
        expect(bar.low, template.pattern).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
        expect(bar.high, template.pattern).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      }
    }
  });

  it('shows at least the drawn context bars before every pattern', () => {
    for (const template of templates) {
      expect(template.context.length, template.pattern).toBeGreaterThanOrEqual(CONTEXT_BARS);
    }
  });
});
