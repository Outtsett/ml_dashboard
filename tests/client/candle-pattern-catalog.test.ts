import { describe, it, expect } from 'vitest';
import {
  CANDLE_PATTERNS,
  ALL_CANDLE_PATTERN_COLUMNS,
  BARS_READ_BY_COLUMN,
  PATTERN_TYPE_BY_COLUMN,
  chartLabelForColumn,
  isCandlePatternColumn,
} from '@/market/lib/candlePatternCatalog';

/**
 * The catalog is the single vocabulary the picker and the chart both read, so
 * these assert the two things a reader of the chart depends on: that every
 * pattern can be grouped by how many bars its rule reads, and that every drawn
 * label says what kind of claim the pattern is making.
 */

describe('candle pattern catalog', () => {
  it('holds one row per pattern with no duplicate columns', () => {
    const columns = CANDLE_PATTERNS.map(p => p.column);
    expect(new Set(columns).size).toBe(columns.length);
    expect(ALL_CANDLE_PATTERN_COLUMNS).toHaveLength(CANDLE_PATTERNS.length);
  });

  it('groups by bars read the way TA-Lib actually defines them', () => {
    const lake = CANDLE_PATTERNS.filter(p => p.source === 'lake');
    const byCount = new Map<number, number>();
    for (const pattern of lake) {
      byCount.set(pattern.candleCount, (byCount.get(pattern.candleCount) ?? 0) + 1);
    }
    // Taken from TA-Lib 0.7.1's own rules: 13 single-bar, 19 two-bar, 21
    // three-bar, 4 four-bar, 4 five-bar. Only 13 of 61 read a single candle.
    expect(byCount.get(1)).toBe(13);
    expect(byCount.get(2)).toBe(19);
    expect(byCount.get(3)).toBe(21);
    expect(byCount.get(4)).toBe(4);
    expect(byCount.get(5)).toBe(4);
  });

  it('knows the bar count for every selectable column', () => {
    for (const column of ALL_CANDLE_PATTERN_COLUMNS) {
      expect(BARS_READ_BY_COLUMN[column]).toBeDefined();
    }
  });

  it('assigns a pattern type to every selectable column', () => {
    for (const column of ALL_CANDLE_PATTERN_COLUMNS) {
      expect(PATTERN_TYPE_BY_COLUMN[column]).toBeTruthy();
    }
  });

  it('draws the pattern type in parentheses and drops the source marker', () => {
    // A reversal three-bar pattern.
    expect(chartLabelForColumn('talib:morningstar', 'Morning Star (TA-Lib)'))
      .toBe('Morning Star (reversal)');
    // An indecision single-bar pattern.
    expect(chartLabelForColumn('talib:doji', 'Doji (TA-Lib)'))
      .toBe('Doji (indecision)');
    // A continuation pattern.
    expect(chartLabelForColumn('talib:tasukigap', 'Tasuki Gap (TA-Lib)'))
      .toBe('Tasuki Gap (continuation)');
    // `colour_line` is an internal category name, not something to print.
    expect(chartLabelForColumn('talib:shortline', 'Short Line (TA-Lib)'))
      .toBe('Short Line (body)');
  });

  it('gives a browser fallback the same type as the lake pattern it replaces', () => {
    // CDL_ENGULFING_BULL stands in for TA-Lib's signed `engulfing` when the
    // lake has no coverage, so it must not read as a different kind of claim.
    expect(PATTERN_TYPE_BY_COLUMN.CDL_ENGULFING_BULL)
      .toBe(PATTERN_TYPE_BY_COLUMN['talib:engulfing']);
  });

  it('recognises columns from both sources and rejects anything else', () => {
    expect(isCandlePatternColumn('talib:doji')).toBe(true);
    expect(isCandlePatternColumn('CDL_TWEEZER_TOP')).toBe(true);
    expect(isCandlePatternColumn('rsi_14')).toBe(false);
  });
});
