/**
 * Candlestick patterns presented as label generators.
 *
 * Guards the move off the indicator dropdown: all 61 patterns have to reach the
 * label picker, in their own id namespace, grouped by how many candles they
 * read. A pattern missing here is a pattern the user cannot select at all.
 */
import { describe, it, expect } from 'vitest';
import {
  CANDLE_PATTERN_GENERATORS,
  CANDLE_PATTERN_LABEL_PREFIX,
  candlePatternName,
  isCandlePatternGenerator,
} from '@/market/lib/candlePatternLabels';
import { TALIB_PATTERN_CATALOG } from '@/market/lib/talibPatternCatalog';

describe('candle patterns as label generators', () => {
  it('offers every one of TA-Lib\'s 61 patterns', () => {
    expect(TALIB_PATTERN_CATALOG).toHaveLength(61);
    expect(CANDLE_PATTERN_GENERATORS).toHaveLength(61);
  });

  it('keeps pattern ids in their own namespace so they cannot collide with a server generator', () => {
    for (const generator of CANDLE_PATTERN_GENERATORS) {
      expect(generator.id.startsWith(CANDLE_PATTERN_LABEL_PREFIX)).toBe(true);
      expect(isCandlePatternGenerator(generator.id)).toBe(true);
    }
    // The server-side generators this list is merged with must not be caught.
    expect(isCandlePatternGenerator('direction')).toBe(false);
    expect(isCandlePatternGenerator('talib_engulfing')).toBe(false);
    expect(isCandlePatternGenerator(null)).toBe(false);
  });

  it('round-trips an id back to the bare name the compute endpoint expects', () => {
    expect(candlePatternName('cdl:morningstar')).toBe('morningstar');
    expect(candlePatternName('cdl:3whitesoldiers')).toBe('3whitesoldiers');
    const ids = new Set(CANDLE_PATTERN_GENERATORS.map(g => candlePatternName(g.id)));
    for (const pattern of TALIB_PATTERN_CATALOG) {
      expect(ids.has(pattern.name)).toBe(true);
    }
  });

  it('groups by how many candles the pattern reads', () => {
    const counts: Record<string, number> = {};
    for (const generator of CANDLE_PATTERN_GENERATORS) {
      counts[generator.category] = (counts[generator.category] ?? 0) + 1;
    }
    // Mirrors the catalog's own candleCount split, so a regrouping that loses a
    // pattern fails here rather than quietly emptying a section of the picker.
    const expected: Record<string, number> = {};
    for (const pattern of TALIB_PATTERN_CATALOG) {
      const key = pattern.candleCount <= 1 ? 'candles · single bar'
        : pattern.candleCount === 2 ? 'candles · two bar'
        : pattern.candleCount === 3 ? 'candles · three bar'
        : 'candles · four to five bar';
      expected[key] = (expected[key] ?? 0) + 1;
    }
    expect(counts).toEqual(expected);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(61);
  });

  it('names the TA-Lib function in the description, so the source of the number is visible', () => {
    const morningStar = CANDLE_PATTERN_GENERATORS.find(g => g.id === 'cdl:morningstar');
    expect(morningStar).toBeDefined();
    expect(morningStar!.name).toBe('Morning Star');
    expect(morningStar!.description).toContain('CDLMORNINGSTAR');
    expect(morningStar!.description).toContain('3-bar reversal');
  });

  it('declares no parameters, so nothing has to be defaulted before a pattern can be drawn', () => {
    // The label pipeline resolves each generator's param defaults before it will
    // issue a request; a pattern takes only OHLC, so an empty list keeps it from
    // ever being blocked waiting on a default it does not have.
    for (const generator of CANDLE_PATTERN_GENERATORS) {
      expect(generator.params).toEqual([]);
    }
  });
});
